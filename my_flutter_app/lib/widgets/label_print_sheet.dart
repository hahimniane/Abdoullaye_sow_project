import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../l10n/app_localizations.dart';
import '../services/container_packages.dart'
    show
        PackageLabelsLoader,
        PackageLabelsPdfPrinter,
        loadPackageLabels,
        printPackageLabelsPdf;
import '../services/label_printer.dart';
import '../services/label_printer_ble.dart' show sharedLabelPrinter;
import '../services/package_codes.dart';
import '../services/package_label_bitmap.dart';
import '../services/package_labels.dart';
import '../services/tag_labels.dart' show tagSizeCustom;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import 'label_printer_widgets.dart';
import 'lot_sheets.dart';

/// Where the last way of printing is kept, so a yard with a label printer is
/// not asked to switch away from letter sheets every time. Per device: a
/// convenience, never a record. Holds `sheet` / `thermal` (the label page in
/// the browser) or `printer` / `system` (printed from the phone).
const labelFormatPreferenceKey = 'containerLabelFormat';

/// How package labels print.
enum LabelPrintMethod {
  /// Straight to the Phomemo M221 over Bluetooth.
  labelPrinter('printer'),

  /// A 4 x 6 in PDF through the system print dialog (AirPrint / Android).
  systemPrint('system'),

  /// The label page in the browser, letter sheets (Avery 5524).
  browserSheet(labelFormatSheet),

  /// The label page in the browser, 4 x 6 thermal.
  browserThermal(labelFormatThermal);

  const LabelPrintMethod(this.saved);

  /// What [labelFormatPreferenceKey] stores.
  final String saved;

  bool get onPhone => this == labelPrinter || this == systemPrint;

  /// Labels per package unless changed: one on the label printer (a pickup,
  /// a torn label), two everywhere else (two sides of a barrel).
  int get defaultCopies =>
      this == labelPrinter ? packageLabelCopiesPrinter : packageLabelCopiesSheet;

  static LabelPrintMethod? fromSaved(String? value) {
    for (final m in values) {
      if (m.saved == value) return m;
    }
    return null;
  }
}

/// Opens the label printer's settings (pick the printer, sizes, alignment).
typedef PrinterSettingsOpener = Future<void> Function(
  BuildContext context,
  LabelPrinterController printer,
);

/// Choose how package labels print, then print them.
///
/// Always: the label page in the browser, as letter sheets or a 4 x 6 thermal
/// roll, one or two per package - [onPrint] fetches the page and opens it.
/// With a [target], also from the phone itself: straight to the shop's label
/// printer over Bluetooth (one label per package by default, the package
/// label size its own saved choice), or a 4 x 6 PDF through the system print
/// dialog (two per package, like the console). Both read the labels from
/// `getPackageLabels`.
///
/// The button shows progress while the work runs and ignores a second tap; a
/// failure is said in place.
///
/// Opened for a whole container (every package) or for one line (a
/// reprint); [subtitle] says which.
class LabelPrintSheet extends StatefulWidget {
  const LabelPrintSheet({
    super.key,
    required this.subtitle,
    required this.onPrint,
    this.initial = const LabelPrintChoice(),
    this.rememberFormat = true,
    this.target,
    this.loader = loadPackageLabels,
    this.pdfPrinter = printPackageLabelsPdf,
    this.printer,
    this.renderer = renderPackageLabelBitmap,
    this.openPrinterSettings,
  });

  final String subtitle;
  final Future<void> Function(LabelPrintChoice choice) onPrint;
  final LabelPrintChoice initial;

  /// Off in tests that should not touch device storage.
  final bool rememberFormat;

  /// The labels to print from the phone; without it only the browser page
  /// is offered.
  final PackageLabelsTarget? target;
  final PackageLabelsLoader loader;
  final PackageLabelsPdfPrinter pdfPrinter;

  /// The app's label printer unless a test passes its own.
  final LabelPrinterController? printer;
  final PackageLabelBitmapRenderer renderer;
  final PrinterSettingsOpener? openPrinterSettings;

  @override
  State<LabelPrintSheet> createState() => _LabelPrintSheetState();
}

enum _Busy { none, opening, preparing, printing }

class _LabelPrintSheetState extends State<LabelPrintSheet> {
  late LabelPrintMethod _method = widget.initial.format == labelFormatThermal
      ? LabelPrintMethod.browserThermal
      : LabelPrintMethod.browserSheet;
  late int _copies = widget.initial.copies == 1 ? 1 : 2;
  _Busy _busy = _Busy.none;
  String _error = '';
  String _done = '';
  bool _sizeValid = true;
  bool _stop = false;
  int _printed = 0;
  int _total = 0;
  LabelPrinterController? _printerCache;

  bool get _phone => widget.target != null;
  bool get _working => _busy != _Busy.none;

  LabelPrinterController get _printer =>
      _printerCache ??= widget.printer ?? sharedLabelPrinter();

  @override
  void initState() {
    super.initState();
    if (widget.rememberFormat) _loadFormat();
    if (_phone) unawaited(_printer.load());
  }

  Future<void> _loadFormat() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = LabelPrintMethod.fromSaved(
        prefs.getString(labelFormatPreferenceKey),
      );
      if (!mounted || _working || saved == null) return;
      if (saved.onPhone && !_phone) return;
      setState(() {
        _method = saved;
        _copies = saved.defaultCopies;
      });
    } catch (_) {
      // No storage: the default stands.
    }
  }

  Future<void> _saveFormat() async {
    if (!widget.rememberFormat) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(labelFormatPreferenceKey, _method.saved);
    } catch (_) {}
  }

  void _pickMethod(LabelPrintMethod next) {
    if (_working) return;
    AppHaptics.selection();
    setState(() {
      _method = next;
      _copies = next.defaultCopies;
      _error = '';
      _done = '';
    });
  }

  void _pickCopies(int copies) {
    if (_working) return;
    AppHaptics.selection();
    setState(() {
      _copies = copies;
      _error = '';
      _done = '';
    });
  }

  void _start(_Busy what) => setState(() {
        _busy = what;
        _error = '';
        _done = '';
        _stop = false;
        _printed = 0;
        _total = 0;
      });

  void _finish() {
    if (mounted) setState(() => _busy = _Busy.none);
  }

  Future<void> _print() async {
    if (_working) return;
    switch (_method) {
      case LabelPrintMethod.browserSheet:
      case LabelPrintMethod.browserThermal:
        await _openPage();
      case LabelPrintMethod.systemPrint:
        await _printSystem();
      case LabelPrintMethod.labelPrinter:
        await _printToPrinter();
    }
  }

  Future<void> _openPage() async {
    final l10n = AppLocalizations.of(context)!;
    _start(_Busy.opening);
    try {
      await widget.onPrint(LabelPrintChoice(
        format: _method == LabelPrintMethod.browserThermal
            ? labelFormatThermal
            : labelFormatSheet,
        copies: _copies,
      ));
      await _saveFormat();
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = l10n.ctrLabelsCouldNotOpen);
    } finally {
      _finish();
    }
  }

  /// The labels from the server, or null after saying why there are none.
  Future<PackageLabelSet?> _load(AppLocalizations l10n) async {
    final PackageLabelSet set;
    try {
      set = await widget.loader(widget.target!.request(_copies));
    } catch (_) {
      if (mounted) {
        AppHaptics.refuse();
        setState(() => _error = l10n.pkgLabelsCouldNotLoad);
      }
      return null;
    }
    if (set.isEmpty) {
      if (mounted) {
        AppHaptics.refuse();
        setState(() => _error = l10n.pkgLabelsNone);
      }
      return null;
    }
    return set;
  }

  Future<void> _printSystem() async {
    final l10n = AppLocalizations.of(context)!;
    _start(_Busy.preparing);
    try {
      final set = await _load(l10n);
      if (set == null || !mounted) return;
      final bytes = await buildPackageLabelsPdf(set);
      final printed = await widget.pdfPrinter(bytes, packageLabelsPdfName(set));
      await _saveFormat();
      if (!mounted) return;
      if (printed) {
        AppHaptics.commit();
        Navigator.of(context).pop(true);
      }
      // Cancelled in the dialog: nothing to say, the sheet stays.
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = l10n.pkgLabelsPrintFailed);
    } finally {
      _finish();
    }
  }

  Future<void> _printToPrinter() async {
    final l10n = AppLocalizations.of(context)!;
    if (!_sizeValid) return;
    if (!_printer.settings.hasPrinter) {
      AppHaptics.refuse();
      setState(() => _error =
          labelPrinterFailureText(l10n, PrintFailure.noPrinterChosen));
      return;
    }
    if (!await ensureBluetoothExplained(context)) return;
    if (!mounted) return;
    _start(_Busy.preparing);
    try {
      final set = await _load(l10n);
      if (set == null || !mounted) return;
      final size = _printer.settings.packageSize;
      setState(() {
        _busy = _Busy.printing;
        _total = set.labels.length;
      });
      PrintFailure? failure;
      var cancelled = false;
      for (final run in packageLabelRuns(set.labels)) {
        if (_stop) {
          cancelled = true;
          break;
        }
        final image = await widget.renderer(layoutPackageLabel(
          run.label,
          size: size,
          businessName: set.businessName,
          businessPhone: set.businessPhone,
          reference: set.reference,
        ));
        final outcome = await _printer.printLabels(
          image: image,
          copies: run.copies,
          what: 'package ${run.label.code}',
        );
        if (!mounted) return;
        setState(() => _printed += outcome.printed);
        if (outcome.cancelled) {
          cancelled = true;
          break;
        }
        if (!outcome.ok) {
          failure = outcome.failure ?? PrintFailure.writeFailed;
          break;
        }
      }
      await _saveFormat();
      if (!mounted) return;
      setState(() {
        if (failure != null) {
          AppHaptics.refuse();
          final reason = labelPrinterFailureText(l10n, failure);
          _error = _printed > 0
              ? '$reason ${l10n.printTagsPartial(_printed, _total)}'
              : reason;
        } else if (cancelled) {
          _done = l10n.printTagsStopped(_printed, _total);
        } else {
          AppHaptics.commit();
          _done = l10n.pkgLabelsPrinted(_printed);
        }
      });
    } catch (e) {
      _printer.log.add('package labels: failed $e');
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = l10n.pkgLabelsPrintFailed);
    } finally {
      _finish();
    }
  }

  void _requestStop() {
    if (_busy != _Busy.printing || _stop) return;
    setState(() => _stop = true);
    _printer.requestCancel();
  }

  Future<void> _sizeChanged(String id, double? w, double? h) async {
    setState(() {
      _sizeValid = id != tagSizeCustom || (w != null && h != null);
      _error = '';
      _done = '';
    });
    if (!_sizeValid) return;
    await _printer.updateSettings(
      _printer.settings.copyWith(
        packageSizeId: id,
        packageWidthMm: w,
        packageHeightMm: h,
      ),
    );
  }

  Future<void> _openSettings() async {
    final open = widget.openPrinterSettings;
    if (_working || open == null) return;
    await open(context, _printer);
    if (mounted) setState(() {});
  }

  String _buttonLabel(AppLocalizations l10n) {
    switch (_method) {
      case LabelPrintMethod.browserSheet:
      case LabelPrintMethod.browserThermal:
        return l10n.ctrLabelPrintButton;
      case LabelPrintMethod.systemPrint:
        return l10n.pkgLabelsPrintButton;
      case LabelPrintMethod.labelPrinter:
        if (_busy == _Busy.preparing) return l10n.pkgLabelsPreparing;
        if (_busy != _Busy.printing) return l10n.printTagsToPrinter;
        if (_stop) return l10n.pkgLabelsStopping;
        if (_printer.status == PrinterStatus.connecting && _printed == 0) {
          return l10n.printTagsConnecting;
        }
        final now = _printed + _printer.progressDone + 1;
        return l10n.printTagsProgress(now.clamp(1, _total), _total);
    }
  }

  String _busyLabel(AppLocalizations l10n) => switch (_method) {
        LabelPrintMethod.browserSheet ||
        LabelPrintMethod.browserThermal =>
          l10n.ctrLabelOpening,
        LabelPrintMethod.systemPrint => l10n.pkgLabelsPreparing,
        LabelPrintMethod.labelPrinter => _buttonLabel(l10n),
      };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (!_phone) return _shell(l10n);
    return ListenableBuilder(
      listenable: _printer,
      builder: (context, _) => _shell(l10n),
    );
  }

  Widget _shell(AppLocalizations l10n) => LotSheetShell(
        title: l10n.ctrPrintLabels,
        subtitle: widget.subtitle,
        footer: _footer(l10n),
        body: _body(l10n),
      );

  Widget _footer(AppLocalizations l10n) {
    final printing = _busy == _Busy.printing;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error.isNotEmpty) ...[
          _ErrorNote(key: const Key('labels-error'), text: _error),
          const SizedBox(height: AppSpacing.sm),
        ],
        if (_done.isNotEmpty) ...[
          PrinterDoneNote(key: const Key('labels-done'), text: _done),
          const SizedBox(height: AppSpacing.sm),
        ],
        Row(
          children: [
            Expanded(
              child: LotSheetButton(
                key: const Key('labels-print'),
                label: _buttonLabel(l10n),
                busy: _working,
                busyLabel: _busyLabel(l10n),
                onTap: _method == LabelPrintMethod.labelPrinter && !_sizeValid
                    ? null
                    : _print,
              ),
            ),
            if (printing) ...[
              const SizedBox(width: AppSpacing.sm),
              OutlinedButton(
                key: const Key('labels-stop'),
                onPressed: _stop ? null : _requestStop,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 50),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  ),
                ),
                child: Text(l10n.printTagsStop),
              ),
            ],
          ],
        ),
        if (printing && _total > 1) ...[
          const SizedBox(height: AppSpacing.sm),
          LinearProgressIndicator(
            key: const Key('labels-progress'),
            value: (_printed + _printer.progressDone) / _total,
            minHeight: 3,
            color: AppColors.cobalt,
            backgroundColor: AppColors.rule,
          ),
        ],
      ],
    );
  }

  Widget _body(AppLocalizations l10n) {
    final settings = _phone ? _printer.settings : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionLabel(_phone ? l10n.pkgLabelsHow : l10n.ctrLabelPaper),
        if (_phone) ...[
          LotChoiceCard(
            key: const Key('labels-method-printer'),
            title: l10n.pkgLabelsMethodPrinter,
            note: settings != null && settings.hasPrinter
                ? l10n.pkgLabelsMethodPrinterNoteNamed(
                    settings.deviceName,
                    settings.packageSize.mmText,
                  )
                : l10n.pkgLabelsMethodPrinterNote,
            selected: _method == LabelPrintMethod.labelPrinter,
            enabled: !_working,
            onTap: () => _pickMethod(LabelPrintMethod.labelPrinter),
          ),
          LotChoiceCard(
            key: const Key('labels-method-system'),
            title: l10n.pkgLabelsMethodSystem,
            note: l10n.pkgLabelsMethodSystemNote,
            selected: _method == LabelPrintMethod.systemPrint,
            enabled: !_working,
            onTap: () => _pickMethod(LabelPrintMethod.systemPrint),
          ),
        ],
        LotChoiceCard(
          key: const Key('labels-format-sheet'),
          title: l10n.ctrLabelSheet,
          note: l10n.ctrLabelSheetNote,
          selected: _method == LabelPrintMethod.browserSheet,
          enabled: !_working,
          onTap: () => _pickMethod(LabelPrintMethod.browserSheet),
        ),
        LotChoiceCard(
          key: const Key('labels-format-thermal'),
          title: l10n.ctrLabelThermal,
          note: l10n.ctrLabelThermalNote,
          selected: _method == LabelPrintMethod.browserThermal,
          enabled: !_working,
          onTap: () => _pickMethod(LabelPrintMethod.browserThermal),
        ),
        if (_method == LabelPrintMethod.labelPrinter && settings != null) ...[
          const SizedBox(height: AppSpacing.sm),
          if (_printer.loaded)
            LabelSizePicker(
              key: const Key('labels-package-size'),
              kind: LabelSizeKind.package,
              settings: settings,
              enabled: !_working,
              onChanged: _sizeChanged,
            ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Icon(
                _printer.isConnected
                    ? Icons.bluetooth_connected
                    : Icons.print_outlined,
                size: 18,
                color: AppColors.muted,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  settings.hasPrinter
                      ? l10n.printTagsPrinterLine(settings.deviceName)
                      : l10n.printTagsNoPrinter,
                  key: const Key('labels-printer-line'),
                  style: const TextStyle(fontSize: 13, color: AppColors.ink),
                ),
              ),
            ],
          ),
          if (widget.openPrinterSettings != null)
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                key: const Key('labels-printer-settings'),
                onPressed: _working ? null : _openSettings,
                icon: const Icon(Icons.tune, size: 18),
                label: Text(l10n.printTagsPrinterSettings),
              ),
            ),
        ],
        const SizedBox(height: AppSpacing.sm),
        _SectionLabel(l10n.ctrLabelCopies),
        LotChoiceCard(
          key: const Key('labels-copies-2'),
          title: l10n.ctrLabelTwo,
          note: l10n.ctrLabelTwoNote,
          selected: _copies == 2,
          enabled: !_working,
          onTap: () => _pickCopies(2),
        ),
        LotChoiceCard(
          key: const Key('labels-copies-1'),
          title: l10n.ctrLabelOne,
          note: _method == LabelPrintMethod.labelPrinter
              ? l10n.pkgLabelsOneNotePrinter
              : l10n.ctrLabelOneNote,
          selected: _copies == 1,
          enabled: !_working,
          onTap: () => _pickCopies(1),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          switch (_method) {
            LabelPrintMethod.labelPrinter => l10n.pkgLabelsTipPrinter,
            LabelPrintMethod.systemPrint => l10n.pkgLabelsTipSystem,
            _ => l10n.ctrLabelTip,
          },
          key: const Key('labels-tip'),
          style: const TextStyle(
            fontSize: 12,
            height: 1.35,
            color: AppColors.muted,
          ),
        ),
      ],
    );
  }
}

class _ErrorNote extends StatelessWidget {
  const _ErrorNote({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.errorRed.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: AppColors.errorRed.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, size: 16, color: AppColors.errorRed),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: AppColors.errorRed,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 2, bottom: AppSpacing.sm),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.4,
          color: AppColors.muted,
        ),
      ),
    );
  }
}

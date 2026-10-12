import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:printing/printing.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart' show readTagCopies;
import '../services/inventory_service.dart';
import '../services/label_printer.dart';
import '../services/label_printer_ble.dart';
import '../services/m221_protocol.dart';
import '../services/tag_labels.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/label_printer_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'containers_screen.dart' show ContainerActionButton;
import 'label_printer_settings_screen.dart';

/// Hands a finished PDF to the system share sheet (where Print Master, Files
/// or AirDrop take it). [origin] anchors the popover on an iPad.
typedef TagPdfSharer =
    Future<void> Function(Uint8List bytes, String fileName, Rect origin);

Future<void> shareTagPdf(Uint8List bytes, String fileName, Rect origin) async {
  await Printing.sharePdf(bytes: bytes, filename: fileName, bounds: origin);
}

/// Print tags for one product: N copies of its one code, straight to the
/// shop's label printer, or as an exact-size PDF to share, or (as before)
/// the tag page in the browser.
Future<void> showPrintTagsSheet(
  BuildContext context, {
  required String businessId,
  required String itemId,
  required String code,
  required String title,
  InventoryTagOpener opener = openInventoryTags,
  LabelPrinterController? printer,
  TagPdfSharer sharer = shareTagPdf,
}) => showLotSheet<void>(
  context,
  PrintTagsSheet(
    businessId: businessId,
    itemId: itemId,
    code: code,
    title: title,
    opener: opener,
    printer: printer,
    sharer: sharer,
  ),
);

class PrintTagsSheet extends StatefulWidget {
  const PrintTagsSheet({
    super.key,
    required this.businessId,
    required this.itemId,
    required this.code,
    required this.title,
    this.opener = openInventoryTags,
    this.printer,
    this.sharer = shareTagPdf,
  });

  final String businessId;
  final String itemId;
  final String code;
  final String title;
  final InventoryTagOpener opener;

  /// The app's printer unless a test passes its own.
  final LabelPrinterController? printer;
  final TagPdfSharer sharer;

  @override
  State<PrintTagsSheet> createState() => _PrintTagsSheetState();
}

enum _Busy { none, printing, sharing, opening }

class _PrintTagsSheetState extends State<PrintTagsSheet> {
  late final LabelPrinterController _printer =
      widget.printer ?? sharedLabelPrinter();
  final _copies = TextEditingController(text: '1');
  final _shareKey = GlobalKey();
  _Busy _busy = _Busy.none;
  bool _invalidCopies = false;
  bool _sizeValid = true;
  String _error = '';
  String _done = '';

  @override
  void initState() {
    super.initState();
    unawaited(_printer.load());
  }

  @override
  void dispose() {
    _copies.dispose();
    super.dispose();
  }

  bool get _working => _busy != _Busy.none;

  int? _readCopies() {
    final copies = readTagCopies(_copies.text);
    if (copies == null) {
      AppHaptics.refuse();
      setState(() => _invalidCopies = true);
    }
    return copies;
  }

  void _setChip(int n) {
    if (_working) return;
    AppHaptics.selection();
    _copies.text = '$n';
    setState(() {
      _invalidCopies = false;
      _error = '';
      _done = '';
    });
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
        sizeId: id,
        customWidthMm: w,
        customHeightMm: h,
      ),
    );
  }

  void _start(_Busy what) => setState(() {
    _busy = what;
    _error = '';
    _done = '';
  });

  void _finish() {
    if (mounted) setState(() => _busy = _Busy.none);
  }

  Future<void> _print() async {
    if (_working || !_sizeValid) return;
    final copies = _readCopies();
    if (copies == null) return;
    final l10n = AppLocalizations.of(context)!;
    if (!_printer.settings.hasPrinter) {
      AppHaptics.refuse();
      setState(
        () => _error = labelPrinterFailureText(
          l10n,
          PrintFailure.noPrinterChosen,
        ),
      );
      return;
    }
    if (!await ensureBluetoothExplained(context)) return;
    if (!mounted) return;
    _start(_Busy.printing);
    try {
      final image = tagBitmapFor(widget.code, _printer.settings.size);
      final outcome = await _printer.printLabels(
        image: image,
        copies: copies,
        what: 'tag ${widget.code}',
      );
      if (!mounted) return;
      setState(() {
        if (outcome.ok) {
          AppHaptics.commit();
          _done = l10n.printTagsDone(outcome.printed);
        } else if (outcome.cancelled) {
          _done = l10n.printTagsStopped(outcome.printed, outcome.requested);
        } else {
          AppHaptics.refuse();
          final reason = labelPrinterFailureText(l10n, outcome.failure!);
          _error = outcome.printed > 0
              ? '$reason ${l10n.printTagsPartial(outcome.printed, outcome.requested)}'
              : reason;
        }
      });
    } finally {
      _finish();
    }
  }

  Rect _shareOrigin() {
    final box = _shareKey.currentContext?.findRenderObject();
    if (box is RenderBox && box.hasSize) {
      return box.localToGlobal(Offset.zero) & box.size;
    }
    return Rect.zero;
  }

  Future<void> _share() async {
    if (_working || !_sizeValid) return;
    final copies = _readCopies();
    if (copies == null) return;
    final l10n = AppLocalizations.of(context)!;
    _start(_Busy.sharing);
    try {
      final size = _printer.settings.size;
      final bytes = await buildTagPdf(
        link: inventoryTagLink(widget.code),
        size: size,
        copies: copies,
      );
      await widget.sharer(
        bytes,
        tagPdfFileName(widget.code, size),
        _shareOrigin(),
      );
      _printer.log.add('pdf: shared $copies x ${size.id} for ${widget.code}');
    } catch (e) {
      _printer.log.add('pdf: failed $e');
      if (mounted) {
        AppHaptics.refuse();
        setState(() => _error = l10n.printTagsPdfFailed);
      }
    } finally {
      _finish();
    }
  }

  Future<void> _openPage() async {
    if (_working) return;
    final copies = _readCopies();
    if (copies == null) return;
    final l10n = AppLocalizations.of(context)!;
    _start(_Busy.opening);
    try {
      await widget.opener(
        businessId: widget.businessId,
        itemId: widget.itemId,
        copies: copies,
      );
      if (mounted) AppHaptics.commit();
    } catch (_) {
      if (mounted) {
        AppHaptics.refuse();
        setState(() => _error = l10n.inventoryTagsCouldNotOpen);
      }
    } finally {
      _finish();
    }
  }

  Future<void> _openSettings() async {
    if (_working) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => LabelPrinterSettingsScreen(printer: _printer),
      ),
    );
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: _printer,
      builder: (context, _) => LotSheetShell(
        title: l10n.inventoryPrintTags,
        subtitle: '${widget.title} · ${widget.code}',
        footer: _footer(l10n),
        body: _body(l10n),
      ),
    );
  }

  Widget _body(AppLocalizations l10n) {
    final settings = _printer.settings;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.printTagsNote,
          style: const TextStyle(
            fontSize: 13,
            height: 1.4,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        TextField(
          key: const Key('inv-tags-copies'),
          controller: _copies,
          enabled: !_working,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          onChanged: (_) {
            if (_invalidCopies) setState(() => _invalidCopies = false);
          },
          decoration: InputDecoration(
            labelText: l10n.inventoryTagCopies,
            helperText: l10n.inventoryTagCopiesHelp,
            helperMaxLines: 3,
            errorText: _invalidCopies ? l10n.inventoryTagCopiesError : null,
            errorMaxLines: 3,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.xs,
          children: [
            for (final n in const [1, 5, 10, 25])
              ChoiceChip(
                key: Key('inv-tags-chip-$n'),
                label: Text('$n'),
                selected: _copies.text.trim() == '$n',
                onSelected: _working ? null : (_) => _setChip(n),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        if (_printer.loaded)
          LabelSizePicker(
            key: const Key('inv-tags-size'),
            settings: settings,
            enabled: !_working,
            onChanged: _sizeChanged,
          ),
        const SizedBox(height: AppSpacing.lg),
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
                key: const Key('inv-tags-printer'),
                style: const TextStyle(fontSize: 13, color: AppColors.ink),
              ),
            ),
          ],
        ),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton.icon(
            key: const Key('inv-tags-settings'),
            onPressed: _working ? null : _openSettings,
            icon: const Icon(Icons.tune, size: 18),
            label: Text(l10n.printTagsPrinterSettings),
          ),
        ),
      ],
    );
  }

  Widget _footer(AppLocalizations l10n) {
    final printing = _busy == _Busy.printing;
    final connecting = printing && _printer.status == PrinterStatus.connecting;
    String printLabel;
    if (!printing) {
      printLabel = l10n.printTagsToPrinter;
    } else if (_printer.cancelRequested) {
      printLabel = l10n.printTagsStopping;
    } else if (connecting && _printer.progressDone == 0) {
      printLabel = l10n.printTagsConnecting;
    } else {
      printLabel = l10n.printTagsProgress(
        (_printer.progressDone + 1).clamp(1, _printer.progressTotal),
        _printer.progressTotal,
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_error.isNotEmpty) ...[
          InventoryNote(key: const Key('inv-tags-error'), text: _error),
          const SizedBox(height: AppSpacing.sm),
        ],
        if (_done.isNotEmpty) ...[
          PrinterDoneNote(key: const Key('inv-tags-done'), text: _done),
          const SizedBox(height: AppSpacing.sm),
        ],
        Row(
          children: [
            Expanded(
              child: LotSheetButton(
                key: const Key('inv-tags-print'),
                label: printLabel,
                busy: printing,
                onTap: _sizeValid ? _print : null,
              ),
            ),
            if (printing) ...[
              const SizedBox(width: AppSpacing.sm),
              OutlinedButton(
                key: const Key('inv-tags-stop'),
                onPressed: _printer.cancelRequested
                    ? null
                    : _printer.requestCancel,
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
        if (printing && _printer.progressTotal > 1) ...[
          const SizedBox(height: AppSpacing.sm),
          LinearProgressIndicator(
            key: const Key('inv-tags-progress'),
            value: _printer.progressDone / _printer.progressTotal,
            minHeight: 3,
            color: AppColors.cobalt,
            backgroundColor: AppColors.rule,
          ),
        ],
        const SizedBox(height: AppSpacing.sm),
        KeyedSubtree(
          key: _shareKey,
          child: ContainerActionButton(
            key: const Key('inv-tags-share'),
            icon: Icons.ios_share,
            label: _busy == _Busy.sharing
                ? l10n.printTagsSharing
                : l10n.printTagsSharePdf,
            busy: _busy == _Busy.sharing,
            enabled: !_working && _sizeValid,
            onTap: _share,
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(top: AppSpacing.xs),
          child: Text(
            l10n.printTagsShareHint,
            style: const TextStyle(
              fontSize: 11.5,
              height: 1.35,
              color: AppColors.muted,
            ),
          ),
        ),
        if (widget.itemId.isNotEmpty)
          Align(
            alignment: Alignment.center,
            child: TextButton(
              key: const Key('inv-tags-open'),
              onPressed: _working ? null : _openPage,
              child: Text(
                _busy == _Busy.opening
                    ? l10n.inventoryTagsOpening
                    : l10n.printTagsOpenPage,
              ),
            ),
          ),
      ],
    );
  }
}

/// The printer dots a tag of [size] takes, for a preview or a test.
LabelBitmap tagBitmapFor(String code, TagLabelSize size) => renderTagBitmap(
  tagQrMatrix(inventoryTagLink(code)),
  size.widthDots,
  size.heightDots,
);

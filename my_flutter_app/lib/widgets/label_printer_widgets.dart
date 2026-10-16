import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../l10n/app_localizations.dart';
import '../services/label_printer.dart';
import '../services/package_labels.dart' show PackageLabelSizes;
import '../services/tag_labels.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'inventory_widgets.dart' show InventoryNote;

/// What a printer failure says to the shop.
String labelPrinterFailureText(AppLocalizations l10n, PrintFailure failure) =>
    switch (failure) {
      PrintFailure.bluetoothOff => l10n.labelPrinterErrorBluetoothOff,
      PrintFailure.bluetoothUnsupported => l10n.labelPrinterErrorUnsupported,
      PrintFailure.permissionDenied => l10n.labelPrinterErrorPermission,
      PrintFailure.locationOff => l10n.labelPrinterErrorLocation,
      PrintFailure.noPrinterChosen => l10n.labelPrinterErrorNoPrinter,
      PrintFailure.notFound => l10n.labelPrinterErrorNotFound,
      PrintFailure.connectFailed => l10n.labelPrinterErrorConnect,
      PrintFailure.notAPrinter => l10n.labelPrinterErrorNotAPrinter,
      PrintFailure.connectionLost => l10n.labelPrinterErrorLost,
      PrintFailure.noCompletion => l10n.labelPrinterErrorNoCompletion,
      PrintFailure.outOfPaper => l10n.labelPrinterErrorOutOfPaper,
      PrintFailure.writeFailed => l10n.labelPrinterErrorWrite,
      PrintFailure.busy => l10n.labelPrinterErrorBusy,
    };

String tagSizeName(AppLocalizations l10n, String sizeId) => switch (sizeId) {
  tagSize40x30mm => l10n.printTagsSize40x30,
  tagSize50x30mm => l10n.printTagsSize50x30,
  tagSizeCustom => l10n.printTagsSizeCustom,
  _ => l10n.printTagsSize2x1,
};

/// Asked once per phone, right before the first scan or print: why the app
/// wants Bluetooth, so the system prompt that follows makes sense.
const labelPrinterExplainedKey = 'labelPrinterBluetoothExplained';

Future<bool> ensureBluetoothExplained(BuildContext context) async {
  SharedPreferences? prefs;
  try {
    prefs = await SharedPreferences.getInstance().timeout(
      const Duration(seconds: 3),
    );
    if (prefs.getBool(labelPrinterExplainedKey) == true) return true;
  } catch (_) {}
  if (!context.mounted) return false;
  final l10n = AppLocalizations.of(context)!;
  final ok = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      key: const Key('label-printer-explain'),
      title: Text(l10n.labelPrinterPermissionTitle),
      content: Text(l10n.labelPrinterPermissionBody),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: const Key('label-printer-explain-continue'),
          style: FilledButton.styleFrom(minimumSize: const Size(64, 44)),
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(l10n.labelPrinterPermissionContinue),
        ),
      ],
    ),
  );
  if (ok == true) {
    try {
      await prefs?.setBool(labelPrinterExplainedKey, true);
    } catch (_) {}
    return true;
  }
  return false;
}

/// Which size a [LabelSizePicker] sets: the shop tag's, or the package
/// label's (its own saved choice on the same printer).
enum LabelSizeKind { tag, package }

/// The label size: the common sizes and a custom width x height. Reports
/// every change; [onChanged] gets null custom values while a typed custom
/// size is not valid. [kind] picks which of the two saved sizes it shows -
/// the shop tag's (2 x 1 in, 40 x 30, 50 x 30 mm) or the package label's
/// (70 x 80, 50 x 80, 62 x 100 mm); custom has the same limits for both.
class LabelSizePicker extends StatefulWidget {
  const LabelSizePicker({
    super.key,
    required this.settings,
    required this.onChanged,
    this.enabled = true,
    this.kind = LabelSizeKind.tag,
  });

  final LabelPrinterSettings settings;
  final void Function(String sizeId, double? widthMm, double? heightMm)
  onChanged;
  final bool enabled;
  final LabelSizeKind kind;

  @override
  State<LabelSizePicker> createState() => _LabelSizePickerState();
}

class _LabelSizePickerState extends State<LabelSizePicker> {
  bool get _package => widget.kind == LabelSizeKind.package;

  String _savedId(LabelPrinterSettings s) =>
      _package ? s.packageSizeId : s.sizeId;

  late String _sizeId = _savedId(widget.settings);
  late final _width = TextEditingController(
    text: _num(
      _package
          ? widget.settings.packageWidthMm
          : widget.settings.customWidthMm,
    ),
  );
  late final _height = TextEditingController(
    text: _num(
      _package
          ? widget.settings.packageHeightMm
          : widget.settings.customHeightMm,
    ),
  );
  bool _invalid = false;

  /// Keys stay `label-size-*` for the tag picker; the package picker's are
  /// `package-size-*`, so both can sit on the settings screen.
  String get _keyPrefix => _package ? 'package-size' : 'label-size';

  static String _num(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  List<String> get _ids => _package
      ? [for (final s in PackageLabelSizes.presets) s.id, tagSizeCustom]
      : const [tagSize2x1in, tagSize40x30mm, tagSize50x30mm, tagSizeCustom];

  String _name(AppLocalizations l10n, String id) {
    if (!_package) return tagSizeName(l10n, id);
    if (id == tagSizeCustom) return l10n.printTagsSizeCustom;
    // A size is not copy: the same "70 × 80 mm" in English and French.
    return PackageLabelSizes.resolve(id).mmText;
  }

  @override
  void didUpdateWidget(LabelSizePicker old) {
    super.didUpdateWidget(old);
    final was = _savedId(old.settings);
    final now = _savedId(widget.settings);
    if (was != now && now != _sizeId) _sizeId = now;
  }

  @override
  void dispose() {
    _width.dispose();
    _height.dispose();
    super.dispose();
  }

  void _report() {
    if (_sizeId != tagSizeCustom) {
      setState(() => _invalid = false);
      widget.onChanged(_sizeId, null, null);
      return;
    }
    final w = readTagMm(_width.text, min: tagMinMm, max: tagMaxWidthMm);
    final h = readTagMm(_height.text, min: tagMinMm, max: tagMaxHeightMm);
    setState(() => _invalid = w == null || h == null);
    widget.onChanged(tagSizeCustom, w, h);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          _package ? l10n.pkgLabelSizeLabel : l10n.printTagsSizeLabel,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.xs,
          children: [
            for (final id in _ids)
              ChoiceChip(
                key: Key('$_keyPrefix-$id'),
                label: Text(_name(l10n, id)),
                selected: id == _sizeId,
                onSelected: widget.enabled
                    ? (_) {
                        _sizeId = id;
                        _report();
                      }
                    : null,
              ),
          ],
        ),
        if (_sizeId == tagSizeCustom) ...[
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: Key('$_keyPrefix-width'),
                  controller: _width,
                  enabled: widget.enabled,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  onChanged: (_) => _report(),
                  decoration: InputDecoration(
                    labelText: l10n.printTagsCustomWidth,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: TextField(
                  key: Key('$_keyPrefix-height'),
                  controller: _height,
                  enabled: widget.enabled,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  onChanged: (_) => _report(),
                  decoration: InputDecoration(
                    labelText: l10n.printTagsCustomHeight,
                  ),
                ),
              ),
            ],
          ),
          if (_invalid) ...[
            const SizedBox(height: AppSpacing.sm),
            InventoryNote(
              key: Key('$_keyPrefix-error'),
              text: l10n.printTagsCustomError,
            ),
          ],
        ],
      ],
    );
  }
}

/// A number with a minus and a plus button: density, speed, offsets.
class PrinterStepper extends StatelessWidget {
  const PrinterStepper({
    super.key,
    required this.keyPrefix,
    required this.label,
    required this.valueText,
    required this.onLess,
    required this.onMore,
    this.help,
  });

  final String keyPrefix;
  final String label;
  final String valueText;
  final String? help;
  final VoidCallback? onLess;
  final VoidCallback? onMore;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                if (help != null)
                  Text(
                    help!,
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.35,
                      color: AppColors.muted,
                    ),
                  ),
              ],
            ),
          ),
          IconButton(
            key: Key('$keyPrefix-less'),
            tooltip: l10n.labelPrinterLess,
            onPressed: onLess,
            icon: const Icon(Icons.remove_circle_outline),
          ),
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 64),
            child: Text(
              valueText,
              key: Key('$keyPrefix-value'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
          IconButton(
            key: Key('$keyPrefix-more'),
            tooltip: l10n.labelPrinterMore,
            onPressed: onMore,
            icon: const Icon(Icons.add_circle_outline),
          ),
        ],
      ),
    );
  }
}

/// A green "it worked" line in place (an error uses [InventoryNote]).
class PrinterDoneNote extends StatelessWidget {
  const PrinterDoneNote({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.sage.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: AppColors.sage.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.check_circle_outline,
            size: 16,
            color: AppColors.sage,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: AppColors.sage,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

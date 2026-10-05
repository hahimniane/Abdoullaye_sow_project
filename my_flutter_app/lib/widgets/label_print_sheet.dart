import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../l10n/app_localizations.dart';
import '../services/package_codes.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import 'lot_sheets.dart';

/// Where the last paper choice is kept, so a yard with a thermal printer is
/// not asked to switch away from letter sheets every time. Per device: a
/// convenience, never a record.
const labelFormatPreferenceKey = 'containerLabelFormat';

/// Choose how package labels print - letter sheets or a 4x6 thermal roll,
/// one or two per package - then open them. [onPrint] fetches the label
/// page and opens it; the sheet shows progress on its button while that
/// runs, closes when it succeeds and says so in place when it fails.
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
  });

  final String subtitle;
  final Future<void> Function(LabelPrintChoice choice) onPrint;
  final LabelPrintChoice initial;

  /// Off in tests that should not touch device storage.
  final bool rememberFormat;

  @override
  State<LabelPrintSheet> createState() => _LabelPrintSheetState();
}

class _LabelPrintSheetState extends State<LabelPrintSheet> {
  late LabelPrintChoice _choice = widget.initial;
  bool _busy = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    if (widget.rememberFormat) _loadFormat();
  }

  Future<void> _loadFormat() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(labelFormatPreferenceKey);
      if (!mounted || _busy) return;
      if (saved == labelFormatSheet || saved == labelFormatThermal) {
        setState(() => _choice = _choice.copyWith(format: saved));
      }
    } catch (_) {
      // No storage: the default stands.
    }
  }

  Future<void> _saveFormat(String format) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(labelFormatPreferenceKey, format);
    } catch (_) {}
  }

  void _pick(LabelPrintChoice next) {
    if (_busy) return;
    AppHaptics.selection();
    setState(() {
      _choice = next;
      _failed = false;
    });
  }

  Future<void> _print() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _failed = false;
    });
    try {
      await widget.onPrint(_choice);
      if (widget.rememberFormat) await _saveFormat(_choice.format);
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: l10n.ctrPrintLabels,
      subtitle: widget.subtitle,
      footer: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_failed) ...[
            Container(
              key: const Key('labels-error'),
              padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md, vertical: AppSpacing.sm),
              decoration: BoxDecoration(
                color: AppColors.errorRed.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                border: Border.all(
                    color: AppColors.errorRed.withValues(alpha: 0.35)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.error_outline,
                      size: 16, color: AppColors.errorRed),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      l10n.ctrLabelsCouldNotOpen,
                      style: const TextStyle(
                        fontSize: 12.5,
                        height: 1.35,
                        color: AppColors.errorRed,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('labels-print'),
            label: l10n.ctrLabelPrintButton,
            busy: _busy,
            busyLabel: l10n.ctrLabelOpening,
            onTap: _print,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SectionLabel(l10n.ctrLabelPaper),
          LotChoiceCard(
            key: const Key('labels-format-sheet'),
            title: l10n.ctrLabelSheet,
            note: l10n.ctrLabelSheetNote,
            selected: _choice.format == labelFormatSheet,
            enabled: !_busy,
            onTap: () => _pick(_choice.copyWith(format: labelFormatSheet)),
          ),
          LotChoiceCard(
            key: const Key('labels-format-thermal'),
            title: l10n.ctrLabelThermal,
            note: l10n.ctrLabelThermalNote,
            selected: _choice.format == labelFormatThermal,
            enabled: !_busy,
            onTap: () => _pick(_choice.copyWith(format: labelFormatThermal)),
          ),
          const SizedBox(height: AppSpacing.sm),
          _SectionLabel(l10n.ctrLabelCopies),
          LotChoiceCard(
            key: const Key('labels-copies-2'),
            title: l10n.ctrLabelTwo,
            note: l10n.ctrLabelTwoNote,
            selected: _choice.copies == 2,
            enabled: !_busy,
            onTap: () => _pick(_choice.copyWith(copies: 2)),
          ),
          LotChoiceCard(
            key: const Key('labels-copies-1'),
            title: l10n.ctrLabelOne,
            note: l10n.ctrLabelOneNote,
            selected: _choice.copies == 1,
            enabled: !_busy,
            onTap: () => _pick(_choice.copyWith(copies: 1)),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            l10n.ctrLabelTip,
            style: const TextStyle(
              fontSize: 12,
              height: 1.35,
              color: AppColors.muted,
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

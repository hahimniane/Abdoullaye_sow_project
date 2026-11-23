import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/package_price_mode.dart';
import '../services/package_price_mode_source.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import 'package_receipt_widgets.dart' show PackageModeTile;

/// Settings: how this business prices a package (docs/PACKAGE_ONE_PRICE.md)
/// - a price for each item, or one price for the whole package. The owner or
/// an admin changes it; others see it read only. Always resolves: a safety
/// timeout turns a read that never answers into a "could not load" line.
class PackagePriceModeCard extends StatefulWidget {
  const PackagePriceModeCard({
    super.key,
    required this.businessId,
    required this.canEdit,
    required this.source,
    this.timeout = const Duration(seconds: 15),
  });

  final String businessId;
  final bool canEdit;
  final PackagePriceModeSource source;
  final Duration timeout;

  @override
  State<PackagePriceModeCard> createState() => _PackagePriceModeCardState();
}

class _PackagePriceModeCardState extends State<PackagePriceModeCard> {
  StreamSubscription<String>? _sub;
  Timer? _safety;
  String? _mode;
  bool _failed = false;
  bool _saving = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _safety = Timer(widget.timeout, () {
      if (mounted && _mode == null) setState(() => _failed = true);
    });
    _sub = widget.source
        .watch(widget.businessId)
        .listen(
          (mode) {
            if (!mounted) return;
            _safety?.cancel();
            // While a save is in flight the choice shown is the one tapped.
            setState(() {
              if (!_saving) _mode = mode;
              _failed = false;
            });
          },
          onError: (Object _) {
            _safety?.cancel();
            if (mounted && _mode == null) setState(() => _failed = true);
          },
        );
  }

  @override
  void dispose() {
    _sub?.cancel();
    _safety?.cancel();
    super.dispose();
  }

  Future<void> _choose(String mode) async {
    if (_saving || !widget.canEdit || mode == _mode) return;
    final l10n = AppLocalizations.of(context)!;
    final before = _mode;
    setState(() {
      _saving = true;
      _error = '';
      _mode = mode;
    });
    try {
      final kept = await widget.source.save(widget.businessId, mode);
      if (!mounted) return;
      AppHaptics.commit();
      setState(() => _mode = kept);
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() {
        _mode = before;
        _error = l10n.prcSettingsFailed;
      });
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final mode = _mode;
    final enabled = widget.canEdit && !_saving;
    return Container(
      key: const Key('price-mode-card'),
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.ppmSettingsTitle,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            l10n.ppmSettingsNote,
            style: const TextStyle(
              fontSize: 12.5,
              height: 1.35,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (mode == null && !_failed)
            const Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else if (mode == null)
            Text(
              l10n.prcSettingsLoadFailed,
              key: const Key('price-mode-load-failed'),
              style: const TextStyle(fontSize: 13, color: AppColors.errorRed),
            )
          else ...[
            PackageModeTile(
              tileKey: 'price-mode-piece',
              label: l10n.ppmModePiece,
              selected: mode == packagePriceModePiece,
              onTap: enabled ? () => _choose(packagePriceModePiece) : null,
            ),
            PackageModeTile(
              tileKey: 'price-mode-package',
              label: l10n.ppmModePackage,
              selected: mode == packagePriceModePackage,
              onTap: enabled ? () => _choose(packagePriceModePackage) : null,
            ),
          ],
          if (!widget.canEdit)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                l10n.prcSettingsOwnerOnly,
                key: const Key('price-mode-owner-only'),
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ),
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                _error,
                key: const Key('price-mode-error'),
                style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
              ),
            ),
        ],
      ),
    );
  }
}

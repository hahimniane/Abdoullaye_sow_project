import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/container_manifest.dart'
    show containerShipModeAir, containerShipModeSea, containerShipModeOf;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';

/// "Ships by: Sea · Air" at the top of a package form (docs/AIR_PACKAGES.md
/// §7), shown only to a business that ships by air
/// (`businesses/{id}.shipsByAir`). Sea is the form as it always was; Air
/// adds the proof section (photos, what is inside, weight, declared value).
/// The same words and icons as the container form's Sea / Air choice.
class ShipModeChoice extends StatelessWidget {
  const ShipModeChoice({
    super.key,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });

  /// "sea" or "air".
  final String value;
  final ValueChanged<String> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          l10n.shipsByLabel,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        SegmentedButton<String>(
          key: const Key('ship-mode-choice'),
          segments: [
            ButtonSegment(
              value: containerShipModeSea,
              label: Text(l10n.airModeSea, key: const Key('ship-mode-sea')),
              icon: const Icon(Icons.directions_boat_outlined, size: 18),
            ),
            ButtonSegment(
              value: containerShipModeAir,
              label: Text(l10n.airModeAir, key: const Key('ship-mode-air')),
              icon: const Icon(Icons.flight, size: 18),
            ),
          ],
          selected: {containerShipModeOf(value)},
          showSelectedIcon: false,
          onSelectionChanged: !enabled
              ? null
              : (picked) {
                  AppHaptics.selection();
                  onChanged(picked.first);
                },
        ),
      ],
    );
  }
}

/// The small "Air" badge with a plane on a package marked to fly.
class AirPackageBadge extends StatelessWidget {
  const AirPackageBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('air-package-badge'),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.mist,
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.flight, size: 12, color: AppColors.cobaltDeep),
          const SizedBox(width: 3),
          Text(
            l10n.shipsByAirBadge,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: AppColors.cobaltDeep,
            ),
          ),
        ],
      ),
    );
  }
}

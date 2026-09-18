import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;

import '../l10n/app_localizations.dart';
import '../services/container_manifest.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

/// "In MSKU1234567 · sailed 3 Oct" / "Loading in Sailing 3 Oct, box 2".
///
/// Where a car is, said beside the car - on the parked-car row, on its
/// detail, on a ledger activity - so nobody opens the containers screen to
/// answer "did that one go yet". The text is the same on every surface, so
/// it is written once here.
String containerLinkText(
  AppLocalizations l10n,
  ContainerVinLink link,
  String localeTag,
) {
  if (!link.isShipped) return l10n.ctrLinkLoading(link.containerName);
  final sailed = link.sailedAt;
  if (sailed == null) return l10n.ctrLinkShippedNoDate(link.containerName);
  return l10n.ctrLinkShipped(
    link.containerName,
    DateFormat.MMMd(localeTag).format(sailed),
  );
}

class ContainerLinkChip extends StatelessWidget {
  const ContainerLinkChip({super.key, required this.link, this.onTap});

  final ContainerVinLink link;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final text = containerLinkText(
      l10n,
      link,
      Localizations.localeOf(context).toLanguageTag(),
    );
    final color = link.isShipped ? AppColors.cobalt : AppColors.warn;
    final chip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            link.isShipped
                ? Icons.directions_boat_outlined
                : Icons.inventory_2_outlined,
            size: 12,
            color: color,
          ),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.1,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return chip;
    return GestureDetector(onTap: onTap, child: chip);
  }
}

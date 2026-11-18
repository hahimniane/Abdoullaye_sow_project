import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/business_service.dart' show BusinessServiceKey;
import '../services/business_home.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/service_catalog_localization.dart';

/// The name of a work, in the words the service list already uses.
String homeWorkLabel(AppLocalizations l10n, HomeWork work) => switch (work) {
  HomeWork.parking => businessServiceLabel(l10n, BusinessServiceKey.carParking),
  HomeWork.shipping => l10n.hubShipping,
  HomeWork.shop => businessServiceLabel(l10n, BusinessServiceKey.inventory),
  HomeWork.carSales => businessServiceLabel(l10n, BusinessServiceKey.carSales),
  HomeWork.transport => businessServiceLabel(
    l10n,
    BusinessServiceKey.carTransport,
  ),
};

/// Business profile, Services panel: which of the business's works the
/// app's home opens on. One single-choice row per work the business has
/// switched on; nothing at all when it has fewer than two (there is nothing
/// to choose). [selected] null means "not chosen": no row is marked and the
/// home keeps its usual order.
class MainWorkPicker extends StatelessWidget {
  const MainWorkPicker({
    super.key,
    required this.works,
    required this.selected,
    required this.enabled,
    required this.onChanged,
  });

  final List<HomeWork> works;
  final HomeWork? selected;
  final bool enabled;
  final ValueChanged<HomeWork> onChanged;

  @override
  Widget build(BuildContext context) {
    if (works.length < 2) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    return Column(
      key: const Key('main-work-picker'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: AppSpacing.lg),
        Text(
          l10n.nhmMainWorkTitle,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          l10n.nhmMainWorkHelp,
          style: const TextStyle(
            fontSize: 13,
            height: 1.3,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        for (final work in works)
          _MainWorkRow(
            key: Key('main-work-${work.key}'),
            label: homeWorkLabel(l10n, work),
            selected: work == selected,
            onTap: enabled ? () => onChanged(work) : null,
          ),
      ],
    );
  }
}

class _MainWorkRow extends StatelessWidget {
  const _MainWorkRow({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      inMutuallyExclusiveGroup: true,
      label: label,
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                    color: AppColors.ink,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Icon(
                selected
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked,
                color: selected ? AppColors.cobalt : AppColors.muted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

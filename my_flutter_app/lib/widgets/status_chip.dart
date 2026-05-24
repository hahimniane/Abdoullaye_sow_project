import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

enum ServiceCategory { parking, barrels, transport, sales, all }

class StatusChip extends StatelessWidget {
  const StatusChip({
    super.key,
    required this.label,
    required this.category,
  });

  final String label;
  final ServiceCategory category;

  static Color colorFor(ServiceCategory category) {
    switch (category) {
      case ServiceCategory.parking:
        return AppColors.categoryParking;
      case ServiceCategory.barrels:
        return AppColors.categoryBarrels;
      case ServiceCategory.transport:
        return AppColors.categoryTransport;
      case ServiceCategory.sales:
        return AppColors.categorySales;
      case ServiceCategory.all:
        return AppColors.brandRed;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = colorFor(category);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

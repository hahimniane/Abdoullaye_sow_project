import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// A small "★ 4.6 (128)" chip shown wherever a business is listed for
/// selection. Renders nothing for a business with no reviews yet, so callers
/// can place it unconditionally.
class RatingSummaryBadge extends StatelessWidget {
  const RatingSummaryBadge({
    super.key,
    required this.average,
    required this.count,
    this.onTap,
  });

  final double average;
  final int count;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return const SizedBox.shrink();
    final child = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.star_rounded, size: 14, color: AppColors.saffron),
        const SizedBox(width: 3),
        Text(
          '${average.toStringAsFixed(1)} ($count)',
          style: const TextStyle(
            color: AppColors.muted,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
    if (onTap == null) return child;
    return GestureDetector(onTap: onTap, child: child);
  }
}

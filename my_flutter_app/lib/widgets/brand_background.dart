import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// Full-page paper background.
class BrandBackground extends StatelessWidget {
  const BrandBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(color: AppColors.cream),
      child: child,
    );
  }
}

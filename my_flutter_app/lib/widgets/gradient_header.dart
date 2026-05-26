import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

/// Wouri-style header with optional back button, title, and actions.
class GradientHeader extends StatelessWidget {
  const GradientHeader({
    super.key,
    required this.title,
    this.showBack = false,
    this.actions,
    this.onBack,
  });

  final String title;
  final bool showBack;
  final List<Widget>? actions;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: AppColors.headerGradient,
        border: Border(bottom: BorderSide(color: AppColors.rule)),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.md,
          ),
          child: Row(
            children: [
              if (showBack)
                IconButton(
                  icon: const Icon(Icons.arrow_back, color: Colors.white),
                  onPressed: onBack ?? () => Navigator.maybePop(context),
                )
              else
                const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(
                    context,
                  ).textTheme.displaySmall?.copyWith(color: Colors.white),
                  textAlign: TextAlign.center,
                ),
              ),
              if (actions != null)
                Row(mainAxisSize: MainAxisSize.min, children: actions!)
              else
                const SizedBox(width: 48),
            ],
          ),
        ),
      ),
    );
  }
}

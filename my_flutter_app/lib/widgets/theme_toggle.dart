import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../l10n/app_localizations.dart';
import '../providers/theme_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

class ThemeToggle extends StatelessWidget {
  const ThemeToggle({super.key, this.onDarkBackground = true});

  /// When true, uses light-on-dark styling (headers). When false, uses theme colors.
  final bool onDarkBackground;

  @override
  Widget build(BuildContext context) {
    return Consumer<ThemeProvider>(
      builder: (context, themeProvider, child) {
        final l10n = AppLocalizations.of(context)!;
        final fg =
            onDarkBackground ? Colors.white : Theme.of(context).colorScheme.onSurface;
        final bg =
            onDarkBackground
                ? Colors.white.withValues(alpha: 0.12)
                : Theme.of(context).colorScheme.surfaceContainerHighest;
        final border =
            onDarkBackground
                ? Colors.white.withValues(alpha: 0.25)
                : Theme.of(context).colorScheme.outline;

        return Container(
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: border),
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: () => themeProvider.toggleTheme(),
              borderRadius: BorderRadius.circular(20),
              splashFactory: NoSplash.splashFactory,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.lg,
                  vertical: AppSpacing.sm,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      themeProvider.isDark ? Icons.dark_mode : Icons.light_mode,
                      color: onDarkBackground ? AppColors.chrome : AppColors.brandRed,
                      size: 20,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      themeProvider.isDark ? l10n.darkMode : l10n.lightMode,
                      style: TextStyle(
                        color: fg,
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

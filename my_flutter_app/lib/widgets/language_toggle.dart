import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/language_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

class LanguageToggle extends StatelessWidget {
  const LanguageToggle({super.key, this.onDarkBackground = true});

  final bool onDarkBackground;

  @override
  Widget build(BuildContext context) {
    return Consumer<LanguageProvider>(
      builder: (context, languageProvider, child) {
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
              onTap: () => languageProvider.toggleLanguage(),
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
                      Icons.language,
                      color: onDarkBackground ? AppColors.chrome : AppColors.brandRed,
                      size: 20,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      languageProvider.getLanguageName(),
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

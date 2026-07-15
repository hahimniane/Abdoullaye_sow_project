import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  bool _hasNavigated = false;

  void _maybeNavigate(AuthProvider authProvider) {
    if (_hasNavigated ||
        !mounted ||
        authProvider.isInitializing ||
        authProvider.initializationIssue != null) {
      return;
    }

    _hasNavigated = true;
    final targetRoute = authProvider.isAuthenticated
        ? (authProvider.hasBusinessDashboardAccess
              ? '/staff-home'
              : '/customer_home')
        : '/customer_home';

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      Navigator.of(context).pushReplacementNamed(targetRoute);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final displayFontSize = (MediaQuery.sizeOf(context).width * 0.18).clamp(
      52.0,
      88.0,
    );
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Consumer<AuthProvider>(
        builder: (context, authProvider, child) {
          _maybeNavigate(authProvider);
          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.xl),
              child: Stack(
                children: [
                  Positioned(
                    top: 32,
                    left: 0,
                    right: 0,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        _SplashCaption(l10n.splashMarketplace),
                        const _SplashCaption('MMXXVI'),
                      ],
                    ),
                  ),
                  Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        RichText(
                          text: TextSpan(
                            style: Theme.of(context).textTheme.displayLarge
                                ?.copyWith(
                                  fontSize: displayFontSize,
                                  height: 0.86,
                                  color: AppColors.ink,
                                ),
                            children: [
                              TextSpan(text: l10n.services),
                              TextSpan(
                                text: '.',
                                style: const TextStyle(
                                  color: AppColors.oxblood,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 18),
                        Text(
                          l10n.splashTagline,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(color: AppColors.muted, height: 1.55),
                        ),
                        if (authProvider.initializationIssue != null) ...[
                          const SizedBox(height: 24),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(AppSpacing.lg),
                            decoration: BoxDecoration(
                              color: AppColors.paper,
                              border: Border.all(color: AppColors.lightOutline),
                              borderRadius: BorderRadius.circular(
                                AppSpacing.radiusLg,
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  authProvider.initializationIssue ==
                                          AuthInitializationIssue.profileMissing
                                      ? l10n.accountProfileMissing
                                      : l10n.accountProfileUnavailable,
                                  style: Theme.of(context).textTheme.bodyMedium
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  l10n.accountProfileRetryHelp,
                                  style: Theme.of(context).textTheme.bodySmall
                                      ?.copyWith(color: AppColors.muted),
                                ),
                                const SizedBox(height: 14),
                                FilledButton.icon(
                                  onPressed: authProvider.isInitializing
                                      ? null
                                      : authProvider.retryInitialization,
                                  icon: authProvider.isInitializing
                                      ? const SizedBox.square(
                                          dimension: 16,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                          ),
                                        )
                                      : const Icon(Icons.refresh),
                                  label: Text(l10n.retry),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 42,
                    child: Row(
                      children: [
                        const SizedBox(
                          width: 24,
                          child: Divider(color: AppColors.ink),
                        ),
                        const SizedBox(width: 10),
                        _SplashCaption(l10n.splashOpening),
                        const Spacer(),
                        if (authProvider.initializationIssue == null)
                          const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppColors.oxblood,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _SplashCaption extends StatelessWidget {
  const _SplashCaption(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: Theme.of(context).textTheme.labelMedium?.copyWith(
        color: AppColors.muted,
        fontSize: 10,
        letterSpacing: 1.3,
      ),
    );
  }
}

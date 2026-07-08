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
    if (_hasNavigated || !mounted || authProvider.isInitializing) {
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
                  const Positioned(
                    top: 32,
                    left: 0,
                    right: 0,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        _SplashCaption('MARKETPLACE'),
                        _SplashCaption('MMXXVI'),
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
                                  fontSize: 104,
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
                      ],
                    ),
                  ),
                  const Positioned(
                    left: 0,
                    right: 0,
                    bottom: 42,
                    child: Row(
                      children: [
                        SizedBox(
                          width: 24,
                          child: Divider(color: AppColors.ink),
                        ),
                        SizedBox(width: 10),
                        _SplashCaption('OPENING THE ATELIER'),
                        Spacer(),
                        SizedBox(
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

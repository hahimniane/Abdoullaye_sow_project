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

  Future<void> _sendVerificationEmail(
    AuthProvider authProvider,
    AppLocalizations l10n,
  ) async {
    try {
      await authProvider.sendCurrentUserEmailVerification();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.invitationVerificationEmailSent)),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.invitationVerificationEmailFailed)),
      );
    }
  }

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
                          _InitializationIssueCard(
                            authProvider: authProvider,
                            l10n: l10n,
                            onSendVerification: () =>
                                _sendVerificationEmail(authProvider, l10n),
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

class _InitializationIssueCard extends StatelessWidget {
  const _InitializationIssueCard({
    required this.authProvider,
    required this.l10n,
    required this.onSendVerification,
  });

  final AuthProvider authProvider;
  final AppLocalizations l10n;
  final VoidCallback onSendVerification;

  @override
  Widget build(BuildContext context) {
    final isInvitationSetup =
        authProvider.initializationIssue ==
            AuthInitializationIssue.profileMissing &&
        authProvider.isAuthenticated &&
        !authProvider.emailVerified;
    final email = authProvider.userEmail?.trim();

    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(maxWidth: 640),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border.all(color: AppColors.lightOutline),
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                isInvitationSetup
                    ? Icons.mark_email_unread_outlined
                    : Icons.cloud_off_outlined,
                color: AppColors.oxblood,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isInvitationSetup
                          ? l10n.invitationProfileSetupTitle
                          : authProvider.initializationIssue ==
                                AuthInitializationIssue.profileMissing
                          ? l10n.accountProfileMissing
                          : l10n.accountProfileUnavailable,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      isInvitationSetup
                          ? l10n.invitationProfileSetupHelp
                          : l10n.accountProfileRetryHelp,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.muted,
                        height: 1.4,
                      ),
                    ),
                    if (isInvitationSetup &&
                        email != null &&
                        email.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Text(
                        email,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              if (isInvitationSetup)
                OutlinedButton.icon(
                  onPressed: authProvider.isEmailVerificationSending
                      ? null
                      : onSendVerification,
                  icon: authProvider.isEmailVerificationSending
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.outgoing_mail),
                  label: Text(
                    authProvider.isEmailVerificationSending
                        ? l10n.sendingVerificationEmail
                        : l10n.verifyInvitedEmail,
                  ),
                ),
              FilledButton.icon(
                onPressed: authProvider.isInitializing
                    ? null
                    : authProvider.retryInitialization,
                icon: authProvider.isInitializing
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(
                        isInvitationSetup
                            ? Icons.verified_outlined
                            : Icons.refresh,
                      ),
                label: Text(
                  isInvitationSetup ? l10n.iVerifiedContinue : l10n.retry,
                ),
              ),
            ],
          ),
        ],
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

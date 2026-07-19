import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart' as firebase_auth;
import 'package:cloud_functions/cloud_functions.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../screens/support_inbox_screen.dart';
import '../services/support_service.dart';
import '../services/biometric_lock_service.dart';
import '../theme/app_colors.dart';
import '../utils/action_confirmation.dart';
import '../widgets/app_back_button.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    this.onOpenWallet,
    this.onOpenAccountProfile,
    this.showBackButton = false,
    this.onBack,
  });

  final VoidCallback? onOpenWallet;
  final VoidCallback? onOpenAccountProfile;
  final bool showBackButton;
  final VoidCallback? onBack;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _deletingAccount = false;

  Future<void> _openLegalUrl({required bool privacy}) async {
    final isFrench = Localizations.localeOf(context).languageCode == 'fr';
    final page = privacy
        ? (isFrench ? 'privacy.html' : 'privacy-en.html')
        : (isFrench ? 'terms.html' : 'terms-en.html');
    final opened = await launchUrl(
      Uri.parse('https://laawoldigital.com/$page'),
      mode: LaunchMode.inAppBrowserView,
    );
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.openLegalLinkFailed),
        ),
      );
    }
  }

  String _accountDeletionError(Object error, AppLocalizations l10n) {
    if (error is firebase_auth.FirebaseAuthException) {
      if (error.code == 'wrong-password' ||
          error.code == 'invalid-credential' ||
          error.code == 'invalid-login-credentials') {
        return l10n.accountDeletionWrongPassword;
      }
      if (error.code == 'requires-recent-login') {
        return l10n.accountDeletionRecentLoginRequired;
      }
    }
    if (error is FirebaseFunctionsException) {
      if (error.code == 'permission-denied') {
        return l10n.accountDeletionAdminBlocked;
      }
      if (error.message == 'recent-login-required') {
        return l10n.accountDeletionRecentLoginRequired;
      }
    }
    return l10n.accountDeletionFailed;
  }

  Future<void> _handleDeleteAccount() async {
    if (_deletingAccount) return;
    final l10n = AppLocalizations.of(context)!;
    final passwordController = TextEditingController();
    final password = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: const Icon(Icons.warning_amber_rounded, color: Colors.red),
        title: Text(l10n.deleteAccountTitle),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.deleteAccountExplanation),
              const SizedBox(height: 12),
              Text(
                l10n.deleteAccountRetentionNotice,
                style: Theme.of(dialogContext).textTheme.bodySmall,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: passwordController,
                autofocus: true,
                obscureText: true,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.password],
                decoration: InputDecoration(
                  labelText: l10n.enterPasswordToDelete,
                  prefixIcon: const Icon(Icons.lock_outline),
                ),
                onSubmitted: (value) {
                  if (value.trim().isNotEmpty) {
                    Navigator.of(dialogContext).pop(value);
                  }
                },
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () {
              final value = passwordController.text;
              if (value.trim().isNotEmpty) {
                Navigator.of(dialogContext).pop(value);
              }
            },
            child: Text(l10n.confirmDeleteAccount),
          ),
        ],
      ),
    );
    passwordController.dispose();
    if (password == null || password.isEmpty || !mounted) return;

    setState(() => _deletingAccount = true);
    try {
      final authProvider = context.read<AuthProvider>();
      await authProvider.requestOwnAccountDeletion(password: password);
      await BiometricLockService().setEnabled(false);
      await authProvider.logout();
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          icon: const Icon(Icons.check_circle_outline, color: AppColors.sage),
          title: Text(l10n.accountDeletionRequestedTitle),
          content: Text(l10n.accountDeletionRequestedMessage),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(l10n.close),
            ),
          ],
        ),
      );
      if (mounted) {
        Navigator.pushNamedAndRemoveUntil(context, '/', (route) => false);
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_accountDeletionError(error, l10n))),
        );
      }
    } finally {
      if (mounted) setState(() => _deletingAccount = false);
    }
  }

  void _handleLogout() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.signOutQuestion,
      message: l10n.signOutConfirmMessage,
      confirmLabel: l10n.confirmSignOut,
      icon: Icons.logout,
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    await authProvider.logout();

    if (mounted) {
      Navigator.pushNamedAndRemoveUntil(context, '/', (route) => false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = context.watch<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    final roleLabel = authProvider.isAdmin
        ? l10n.admin
        : authProvider.isBusinessOwner
        ? l10n.businessAdmin
        : authProvider.isStaff
        ? l10n.staff
        : l10n.customer;

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
              child: Row(
                children: [
                  if (widget.showBackButton) ...[
                    AppBackButton(onPressed: widget.onBack),
                    const SizedBox(width: 4),
                  ],
                  Expanded(
                    child: Text(
                      l10n.settings,
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                  ),
                  const LanguageToggle(),
                ],
              ),
            ),

            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                children: [
                  if (authProvider.isAuthenticated)
                    _AccountPanel(
                      title: authProvider.customerName?.isNotEmpty == true
                          ? authProvider.customerName!
                          : authProvider.userEmail ?? l10n.account,
                      subtitle: authProvider.userEmail ?? '',
                      role: roleLabel,
                      onTap:
                          widget.onOpenAccountProfile ??
                          () =>
                              Navigator.pushNamed(context, '/account-profile'),
                    )
                  else
                    _SignedOutPanel(
                      message: l10n.accountOptionalMessage,
                      onSignIn: () => Navigator.pushNamed(context, '/login'),
                      onSignUp: () => Navigator.pushNamed(context, '/signup'),
                    ),

                  const SizedBox(height: 14),
                  _SettingsGroup(
                    children: [
                      if (!authProvider.hasBusinessDashboardAccess) ...[
                        _SettingRow(
                          icon: Icons.favorite_border,
                          title: l10n.favoriteCars,
                          subtitle: l10n.favoriteCarsSubtitle,
                          onTap: () =>
                              Navigator.pushNamed(context, '/favorite-cars'),
                        ),
                        const Divider(height: 1),
                        _SettingRow(
                          icon: Icons.account_balance_wallet_outlined,
                          title: l10n.walletTitle,
                          subtitle: l10n.walletSubtitle,
                          onTap:
                              widget.onOpenWallet ??
                              () => Navigator.pushNamed(context, '/wallet'),
                        ),
                        if (authProvider.isAuthenticated)
                          const Divider(height: 1),
                      ],
                      if (authProvider.isAuthenticated) ...[
                        _SettingRow(
                          icon: Icons.support_agent_outlined,
                          title: l10n.supportCenter,
                          subtitle: l10n.supportInboxSubtitle,
                          onTap: () => Navigator.pushNamed(
                            context,
                            '/support',
                            arguments: const SupportInboxArguments(
                              scope: SupportInboxScope.customer,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),

                  if (authProvider.hasBusinessDashboardAccess) ...[
                    const SizedBox(height: 14),
                    _SettingsGroup(
                      children: [
                        _SettingRow(
                          icon: Icons.support_agent_outlined,
                          title: l10n.supportInbox,
                          subtitle: l10n.supportInboxSubtitle,
                          onTap: () => Navigator.pushNamed(
                            context,
                            '/support',
                            arguments: SupportInboxArguments(
                              scope: authProvider.isAdmin
                                  ? SupportInboxScope.admin
                                  : SupportInboxScope.business,
                            ),
                          ),
                        ),
                        const Divider(height: 1),
                        if (authProvider.isAdmin) ...[
                          _SettingRow(
                            icon: Icons.storefront_outlined,
                            title: l10n.businesses,
                            subtitle: l10n.businessesSubtitle,
                            onTap: () =>
                                Navigator.pushNamed(context, '/businesses'),
                          ),
                          const Divider(height: 1),
                        ],
                        if (!authProvider.isAdmin) ...[
                          _SettingRow(
                            icon: Icons.storefront_outlined,
                            title: l10n.businessProfile,
                            subtitle: l10n.businessProfileSubtitle,
                            onTap: () => Navigator.pushNamed(
                              context,
                              '/business-profile',
                            ),
                          ),
                        ],
                        if (authProvider.isAdmin) ...[
                          _SettingRow(
                            icon: Icons.public,
                            title: l10n.destinationCountries,
                            subtitle: l10n.manageDestinationCountries,
                            onTap: () => Navigator.pushNamed(
                              context,
                              '/destination-countries',
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],

                  const SizedBox(height: 14),
                  _SettingsSectionLabel(label: l10n.legalAndPrivacy),
                  const SizedBox(height: 8),
                  _SettingsGroup(
                    children: [
                      _SettingRow(
                        icon: Icons.privacy_tip_outlined,
                        title: l10n.privacyPolicy,
                        subtitle: l10n.privacyPolicySubtitle,
                        onTap: () => _openLegalUrl(privacy: true),
                      ),
                      const Divider(height: 1),
                      _SettingRow(
                        icon: Icons.description_outlined,
                        title: l10n.termsOfService,
                        subtitle: l10n.termsOfServiceSubtitle,
                        onTap: () => _openLegalUrl(privacy: false),
                      ),
                    ],
                  ),

                  if (authProvider.isAuthenticated &&
                      !authProvider.isAdmin) ...[
                    const SizedBox(height: 14),
                    _SettingsSectionLabel(label: l10n.accountManagement),
                    const SizedBox(height: 8),
                    _SettingsGroup(
                      children: [
                        _SettingRow(
                          icon: Icons.delete_forever_outlined,
                          iconColor: Colors.red,
                          title: l10n.deleteAccount,
                          titleColor: Colors.red,
                          subtitle: l10n.deleteAccountSubtitle,
                          trailing: _deletingAccount
                              ? const SizedBox.square(
                                  dimension: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : null,
                          onTap: _deletingAccount ? null : _handleDeleteAccount,
                        ),
                      ],
                    ),
                  ],

                  if (authProvider.isAuthenticated) ...[
                    const SizedBox(height: 14),
                    _SettingsGroup(
                      children: [
                        _SettingRow(
                          icon: Icons.logout,
                          title: l10n.logout,
                          subtitle: l10n.signOutOfAccount,
                          onTap: _handleLogout,
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AccountPanel extends StatelessWidget {
  const _AccountPanel({
    required this.title,
    required this.subtitle,
    required this.role,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final String role;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return _SettingsGroup(
      children: [
        _SettingRow(
          icon: Icons.person_outline,
          title: title,
          subtitle: subtitle,
          trailing: _RolePill(label: role),
          onTap: onTap,
        ),
      ],
    );
  }
}

class _SignedOutPanel extends StatelessWidget {
  const _SignedOutPanel({
    required this.message,
    required this.onSignIn,
    required this.onSignUp,
  });

  final String message;
  final VoidCallback onSignIn;
  final VoidCallback onSignUp;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _SettingsGroup(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
          child: Text(
            message,
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: AppColors.lightMuted),
          ),
        ),
        _SettingRow(
          icon: Icons.login,
          title: l10n.signIn,
          subtitle: l10n.signInToAccount,
          onTap: onSignIn,
        ),
        const Divider(height: 1),
        _SettingRow(
          icon: Icons.person_add_alt,
          title: l10n.signUp,
          subtitle: l10n.signUpToGetStarted,
          onTap: onSignUp,
        ),
      ],
    );
  }
}

class _SettingsGroup extends StatelessWidget {
  const _SettingsGroup({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.lightSurface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.lightOutline),
      ),
      child: Column(children: children),
    );
  }
}

class _SettingsSectionLabel extends StatelessWidget {
  const _SettingsSectionLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
          color: AppColors.lightMuted,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _SettingRow extends StatelessWidget {
  const _SettingRow({
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.iconColor,
    this.titleColor,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? iconColor;
  final Color? titleColor;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppColors.brandRed.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                icon,
                color: iconColor ?? AppColors.brandRed,
                size: 18,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: titleColor,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.grey.shade600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            ?trailing,
            if (trailing == null && onTap != null)
              Icon(
                Icons.arrow_forward_ios,
                color: Colors.grey.shade400,
                size: 14,
              ),
          ],
        ),
      ),
    );
  }
}

class _RolePill extends StatelessWidget {
  const _RolePill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.brandRed.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: AppColors.brandRed,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

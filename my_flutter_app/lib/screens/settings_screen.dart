import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../widgets/language_toggle.dart';
import '../widgets/theme_toggle.dart';
import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
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
                        const Divider(height: 1),
                      ],
                      _SettingRow(
                        icon: Icons.dark_mode_outlined,
                        title: l10n.themeLabel,
                        trailing: const ThemeToggle(onDarkBackground: false),
                      ),
                    ],
                  ),

                  if (authProvider.hasBusinessDashboardAccess) ...[
                    const SizedBox(height: 14),
                    _SettingsGroup(
                      children: [
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

class _SettingRow extends StatelessWidget {
  const _SettingRow({
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

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
              child: Icon(icon, color: AppColors.brandRed, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
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
            if (trailing != null) trailing!,
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

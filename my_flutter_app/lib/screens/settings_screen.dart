import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  void _handleLogout() async {
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

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF667eea), Color(0xFF764ba2)],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              // Header
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        AppLocalizations.of(context)!.settings,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const LanguageToggle(),
                  ],
                ),
              ),

              // Settings content
              Expanded(
                child: Container(
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(30),
                      topRight: Radius.circular(30),
                    ),
                  ),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (authProvider.isAuthenticated) ...[
                          _buildSection(
                            title: l10n.account,
                            children: [
                              _buildSettingItem(
                                icon: Icons.person,
                                title: l10n.email,
                                subtitle: authProvider.userEmail ?? '',
                              ),
                              _buildSettingItem(
                                icon: Icons.badge,
                                title: l10n.role,
                                subtitle: authProvider.isAdmin
                                    ? l10n.admin
                                    : authProvider.isStaff
                                        ? l10n.staff
                                        : l10n.customer,
                              ),
                              _buildSettingItem(
                                icon: Icons.logout,
                                title: l10n.logout,
                                subtitle: l10n.signOutOfAccount,
                                onTap: _handleLogout,
                              ),
                            ],
                          ),
                          const SizedBox(height: 24),
                        ] else ...[
                          Padding(
                            padding: const EdgeInsets.only(bottom: 16),
                            child: Text(
                              l10n.accountOptionalMessage,
                              style: TextStyle(
                                fontSize: 14,
                                color: Colors.grey.shade600,
                              ),
                            ),
                          ),
                          _buildSection(
                            title: l10n.account,
                            children: [
                              _buildSettingItem(
                                icon: Icons.login,
                                title: l10n.signIn,
                                subtitle: l10n.signInToAccount,
                                onTap: () => Navigator.pushNamed(
                                  context,
                                  '/login',
                                ),
                              ),
                              const Divider(height: 1),
                              _buildSettingItem(
                                icon: Icons.person_add_alt,
                                title: l10n.signUp,
                                subtitle: l10n.signUpToGetStarted,
                                onTap: () => Navigator.pushNamed(
                                  context,
                                  '/signup',
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 24),
                        ],

                        // App Info Section
                        _buildSection(
                          title: l10n.appInformation,
                          children: [
                            _buildSettingItem(
                              icon: Icons.info_outline,
                              title: l10n.appVersion,
                              subtitle: '1.0.0',
                            ),
                            _buildSettingItem(
                              icon: Icons.business,
                              title: l10n.companyName,
                              subtitle: 'Business Services',
                            ),
                          ],
                        ),

                        const SizedBox(height: 24),

                        // Contact Section
                        _buildSection(
                          title: l10n.contactUs,
                          children: [
                            _buildSettingItem(
                              icon: Icons.phone,
                              title: l10n.phoneNumber,
                              subtitle: '+1 (555) 123-4567',
                              onTap: () {
                                // Handle phone call
                              },
                            ),
                            _buildSettingItem(
                              icon: Icons.email,
                              title: l10n.emailAddress,
                              subtitle: 'info@businessservices.com',
                              onTap: () {
                                // Handle email
                              },
                            ),
                          ],
                        ),

                        const SizedBox(height: 24),

                        // About Section
                        _buildSection(
                          title: l10n.about,
                          children: [
                            _buildSettingItem(
                              icon: Icons.description,
                              title: l10n.privacyPolicy,
                              onTap: () {
                                // Handle privacy policy
                              },
                            ),
                            _buildSettingItem(
                              icon: Icons.description,
                              title: l10n.termsOfService,
                              onTap: () {
                                // Handle terms of service
                              },
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSection({
    required String title,
    required List<Widget> children,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: Color(0xFF667eea),
          ),
        ),
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            color: Colors.grey.shade50,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.grey.shade200),
          ),
          child: Column(children: children),
        ),
      ],
    );
  }

  Widget _buildSettingItem({
    required IconData icon,
    required String title,
    String? subtitle,
    VoidCallback? onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: const Color(0xFF667eea).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: const Color(0xFF667eea), size: 20),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 14,
                        color: Colors.grey.shade600,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (onTap != null)
              Icon(
                Icons.arrow_forward_ios,
                color: Colors.grey.shade400,
                size: 16,
              ),
          ],
        ),
      ),
    );
  }
}

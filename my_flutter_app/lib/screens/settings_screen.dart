import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import 'login_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  int _tapCount = 0;
  bool _showLoginOption = false;

  void _handleVersionTap() {
    setState(() {
      _tapCount++;
      if (_tapCount >= 5) {
        _showLoginOption = true;
      }
    });
  }

  void _handleLogout() async {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    await authProvider.logout();

    if (mounted) {
      Navigator.pushNamedAndRemoveUntil(context, '/', (route) => false);
    }
  }

  @override
  Widget build(BuildContext context) {
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
                        // User Info Section (if logged in)
                        Consumer<AuthProvider>(
                          builder: (context, authProvider, child) {
                            if (authProvider.isAuthenticated) {
                              return Column(
                                children: [
                                  _buildSection(
                                    title:
                                        AppLocalizations.of(context)!.account,
                                    children: [
                                      _buildSettingItem(
                                        icon: Icons.person,
                                        title:
                                            AppLocalizations.of(context)!.email,
                                        subtitle: authProvider.userEmail ?? '',
                                      ),
                                      _buildSettingItem(
                                        icon: Icons.badge,
                                        title:
                                            AppLocalizations.of(context)!.role,
                                        subtitle:
                                            authProvider.isAdmin
                                                ? AppLocalizations.of(
                                                  context,
                                                )!.admin
                                                : authProvider.isStaff
                                                ? AppLocalizations.of(
                                                  context,
                                                )!.staff
                                                : AppLocalizations.of(
                                                  context,
                                                )!.customer,
                                      ),
                                      _buildSettingItem(
                                        icon: Icons.logout,
                                        title:
                                            AppLocalizations.of(
                                              context,
                                            )!.logout,
                                        subtitle:
                                            AppLocalizations.of(
                                              context,
                                            )!.signOutOfAccount,
                                        onTap: _handleLogout,
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 24),
                                ],
                              );
                            }
                            return const SizedBox.shrink();
                          },
                        ),

                        // App Info Section
                        _buildSection(
                          title: AppLocalizations.of(context)!.appInformation,
                          children: [
                            _buildSettingItem(
                              icon: Icons.info_outline,
                              title: AppLocalizations.of(context)!.appVersion,
                              subtitle: '1.0.0',
                              onTap: _handleVersionTap,
                            ),
                            _buildSettingItem(
                              icon: Icons.business,
                              title: AppLocalizations.of(context)!.companyName,
                              subtitle: 'Business Services',
                            ),
                          ],
                        ),

                        const SizedBox(height: 24),

                        // Hidden Login Section (appears after 5 taps on version)
                        if (_showLoginOption) ...[
                          _buildSection(
                            title: AppLocalizations.of(context)!.staffAccess,
                            children: [
                              _buildSettingItem(
                                icon: Icons.admin_panel_settings,
                                title: AppLocalizations.of(context)!.staffLogin,
                                subtitle:
                                    AppLocalizations.of(
                                      context,
                                    )!.accessStaffFeatures,
                                onTap: () {
                                  Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (context) => const LoginScreen(),
                                    ),
                                  );
                                },
                              ),
                            ],
                          ),
                          const SizedBox(height: 24),
                        ],

                        // Contact Section
                        _buildSection(
                          title: AppLocalizations.of(context)!.contactUs,
                          children: [
                            _buildSettingItem(
                              icon: Icons.phone,
                              title: AppLocalizations.of(context)!.phoneNumber,
                              subtitle: '+1 (555) 123-4567',
                              onTap: () {
                                // Handle phone call
                              },
                            ),
                            _buildSettingItem(
                              icon: Icons.email,
                              title: AppLocalizations.of(context)!.emailAddress,
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
                          title: AppLocalizations.of(context)!.about,
                          children: [
                            _buildSettingItem(
                              icon: Icons.description,
                              title:
                                  AppLocalizations.of(context)!.privacyPolicy,
                              onTap: () {
                                // Handle privacy policy
                              },
                            ),
                            _buildSettingItem(
                              icon: Icons.description,
                              title:
                                  AppLocalizations.of(context)!.termsOfService,
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
                color: const Color(0xFF667eea).withOpacity(0.1),
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

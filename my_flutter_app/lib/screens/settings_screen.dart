import 'package:flutter/material.dart';
import '../widgets/language_toggle.dart';
import '../generated/l10n.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

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
                        S.of(context).settings,
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
                        // App Info Section
                        _buildSection(
                          title: S.of(context).appInformation,
                          children: [
                            _buildSettingItem(
                              icon: Icons.info_outline,
                              title: S.of(context).appVersion,
                              subtitle: '1.0.0',
                            ),
                            _buildSettingItem(
                              icon: Icons.business,
                              title: S.of(context).companyName,
                              subtitle: 'Business Services',
                            ),
                          ],
                        ),

                        const SizedBox(height: 24),

                        // Contact Section
                        _buildSection(
                          title: S.of(context).contactUs,
                          children: [
                            _buildSettingItem(
                              icon: Icons.phone,
                              title: S.of(context).phoneNumber,
                              subtitle: '+1 (555) 123-4567',
                              onTap: () {
                                // Handle phone call
                              },
                            ),
                            _buildSettingItem(
                              icon: Icons.email,
                              title: S.of(context).emailAddress,
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
                          title: S.of(context).about,
                          children: [
                            _buildSettingItem(
                              icon: Icons.description,
                              title: S.of(context).privacyPolicy,
                              onTap: () {
                                // Handle privacy policy
                              },
                            ),
                            _buildSettingItem(
                              icon: Icons.description,
                              title: S.of(context).termsOfService,
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

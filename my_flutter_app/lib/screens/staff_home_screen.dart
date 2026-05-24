import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../l10n/app_localizations.dart';
import '../widgets/app_bottom_nav.dart';
import 'home_menu.dart';
import 'settings_screen.dart';
import 'staff_car_management_screen.dart';
import 'staff_purchase_management_screen.dart';
import 'user_management_screen.dart';

class StaffHomeScreen extends StatefulWidget {
  const StaffHomeScreen({super.key});

  @override
  State<StaffHomeScreen> createState() => _StaffHomeScreenState();
}

class _StaffHomeScreenState extends State<StaffHomeScreen> {
  int _currentIndex = 0;

  List<Widget> _buildScreens(bool isAdmin) {
    return [
      const HomeMenu(),
      const StaffCarManagementScreen(),
      const StaffPurchaseManagementScreen(),
      if (isAdmin) const UserManagementScreen(),
      const SettingsScreen(),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final isAdmin = authProvider.isAdmin;
    final screens = _buildScreens(isAdmin);
    final l10n = AppLocalizations.of(context)!;

    if (_currentIndex >= screens.length) {
      _currentIndex = 0;
    }

    final items = <AppBottomNavItem>[
      AppBottomNavItem(icon: Icons.home, label: l10n.home),
      AppBottomNavItem(icon: Icons.directions_car, label: l10n.manageCars),
      AppBottomNavItem(icon: Icons.receipt_long, label: l10n.purchases),
      if (isAdmin) AppBottomNavItem(icon: Icons.people, label: l10n.users),
      AppBottomNavItem(icon: Icons.settings, label: l10n.settings),
    ];

    return Scaffold(
      body: screens[_currentIndex],
      bottomNavigationBar: AppBottomNav(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        items: items,
      ),
    );
  }
}

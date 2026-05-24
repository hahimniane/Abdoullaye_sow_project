import 'package:flutter/material.dart';
import '../l10n/app_localizations.dart';
import '../widgets/app_bottom_nav.dart';
import 'sell_cars_screen.dart';
import 'tracking_screen.dart';
import 'settings_screen.dart';
import 'my_purchases_screen.dart';

class CustomerHomeScreen extends StatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  State<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends State<CustomerHomeScreen> {
  int _currentIndex = 0;

  final List<Widget> _screens = [
    const SellCarsScreen(),
    const MyPurchasesScreen(),
    const TrackingScreen(),
    const SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      body: _screens[_currentIndex],
      bottomNavigationBar: AppBottomNav(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        items: [
          AppBottomNavItem(icon: Icons.directions_car, label: l10n.cars),
          AppBottomNavItem(icon: Icons.receipt_long, label: l10n.myPurchases),
          AppBottomNavItem(icon: Icons.local_shipping, label: l10n.tracking),
          AppBottomNavItem(icon: Icons.settings, label: l10n.settings),
        ],
      ),
    );
  }
}

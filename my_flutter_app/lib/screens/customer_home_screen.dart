import 'package:flutter/material.dart';
import '../l10n/app_localizations.dart';
import '../widgets/app_bottom_nav.dart';
import 'sell_cars_screen.dart';
import 'tracking_screen.dart';
import 'settings_screen.dart';
import 'my_purchases_screen.dart';
import 'send_barrel_screen.dart';
import 'wallet_screen.dart';
import 'account_profile_screen.dart';

class CustomerHomeScreen extends StatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  State<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends State<CustomerHomeScreen> {
  int _currentIndex = 0;
  Widget? _settingsDetailScreen;

  void _selectTab(int index) {
    setState(() {
      _currentIndex = index;
      _settingsDetailScreen = null;
    });
  }

  void _openSettingsDetail(Widget screen) {
    setState(() {
      _currentIndex = 4;
      _settingsDetailScreen = screen;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final screens = [
      const SellCarsScreen(),
      const SendBarrelScreen(showBackButton: false),
      const MyPurchasesScreen(),
      const TrackingScreen(),
      _settingsDetailScreen ??
          SettingsScreen(
            onOpenWallet: () =>
                _openSettingsDetail(WalletScreen(onBack: () => _selectTab(4))),
            onOpenAccountProfile: () => _openSettingsDetail(
              AccountProfileScreen(onBack: () => _selectTab(4)),
            ),
          ),
    ];
    return Scaffold(
      body: screens[_currentIndex],
      bottomNavigationBar: AppBottomNav(
        currentIndex: _currentIndex,
        onTap: _selectTab,
        items: [
          AppBottomNavItem(
            icon: Icons.directions_car_outlined,
            selectedIcon: Icons.directions_car,
            label: l10n.cars,
          ),
          AppBottomNavItem(
            icon: Icons.local_shipping_outlined,
            selectedIcon: Icons.local_shipping,
            label: l10n.sendBarrels,
          ),
          AppBottomNavItem(
            icon: Icons.receipt_long_outlined,
            selectedIcon: Icons.receipt_long,
            label: l10n.myPurchases,
          ),
          AppBottomNavItem(
            icon: Icons.route_outlined,
            selectedIcon: Icons.route,
            label: l10n.tracking,
          ),
          AppBottomNavItem(
            icon: Icons.settings_outlined,
            selectedIcon: Icons.settings,
            label: l10n.settings,
          ),
        ],
      ),
    );
  }
}

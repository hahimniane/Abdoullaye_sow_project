import 'package:flutter/material.dart';
import '../l10n/app_localizations.dart';
import '../models/customer_service_catalog.dart';
import '../services/nav_prefs.dart';
import '../widgets/app_bottom_nav.dart';
import 'settings_screen.dart';
import 'services_hub_screen.dart';
import 'wallet_screen.dart';
import 'account_profile_screen.dart';

class CustomerHomeScreen extends StatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  State<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends State<CustomerHomeScreen> {
  final _navPrefs = NavPrefs();

  // _currentIndex is only ever Home (0) or Settings (last); pinned items in
  // between are quick shortcuts that push their own screen.
  int _currentIndex = 0;
  Widget? _settingsDetailScreen;
  List<String> _pinned = List<String>.from(defaultPinnedServiceIds);

  int get _settingsIndex => 1 + _pinned.length;

  @override
  void initState() {
    super.initState();
    _loadPinned();
  }

  Future<void> _loadPinned() async {
    final pinned = await _navPrefs.pinned();
    if (!mounted) return;
    setState(() => _pinned = pinned);
  }

  void _onTap(int index) {
    if (index == 0) {
      setState(() {
        _currentIndex = 0;
        _settingsDetailScreen = null;
      });
    } else if (index == _settingsIndex) {
      setState(() {
        _currentIndex = _settingsIndex;
        _settingsDetailScreen = null;
      });
    } else {
      final service = serviceById(_pinned[index - 1]);
      if (service != null) Navigator.pushNamed(context, service.route);
    }
  }

  void _openSettingsDetail(Widget screen) {
    setState(() {
      _currentIndex = _settingsIndex;
      _settingsDetailScreen = screen;
    });
  }

  Future<void> _openCustomize() async {
    await Navigator.pushNamed(context, '/customize-navbar');
    await _loadPinned();
    if (mounted) {
      setState(() {
        _currentIndex = 0;
        _settingsDetailScreen = null;
      });
    }
  }

  Widget _buildBody() {
    if (_currentIndex == _settingsIndex) {
      return _settingsDetailScreen ??
          SettingsScreen(
            onOpenWallet: () => _openSettingsDetail(
              WalletScreen(onBack: () => _onTap(_settingsIndex)),
            ),
            onOpenAccountProfile: () => _openSettingsDetail(
              AccountProfileScreen(onBack: () => _onTap(_settingsIndex)),
            ),
          );
    }
    return ServicesHubScreen(onCustomize: _openCustomize);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      body: _buildBody(),
      bottomNavigationBar: AppBottomNav(
        currentIndex: _currentIndex,
        onTap: _onTap,
        items: [
          const AppBottomNavItem(
            icon: Icons.home_outlined,
            selectedIcon: Icons.home,
            label: 'Home',
          ),
          for (final id in _pinned)
            if (serviceById(id) != null)
              AppBottomNavItem(
                icon: serviceById(id)!.icon,
                label: serviceById(id)!.label,
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

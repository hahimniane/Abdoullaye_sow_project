import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../l10n/app_localizations.dart';
import '../theme/app_colors.dart';
import '../widgets/app_bottom_nav.dart';
import '../models/business_profile.dart';
import '../models/business_service.dart';
import '../models/platform_access.dart';
import '../utils/business_permissions.dart';
import 'business_profile_screen.dart';
import 'home_menu.dart';
import 'platform_admin_dashboard_screen.dart';
import 'settings_screen.dart';
import 'staff_car_management_screen.dart';
import 'staff_purchase_management_screen.dart';
import 'support_inbox_screen.dart';
import 'user_management_screen.dart';

class StaffHomeScreen extends StatefulWidget {
  const StaffHomeScreen({super.key});

  @override
  State<StaffHomeScreen> createState() => _StaffHomeScreenState();
}

class _StaffHomeScreenState extends State<StaffHomeScreen> {
  int _currentIndex = 0;

  int _safeIndex(int length) {
    if (length <= 0) return 0;
    if (_currentIndex < 0) return 0;
    if (_currentIndex >= length) return length - 1;
    return _currentIndex;
  }

  List<Widget> _buildScreens(
    bool isAdmin,
    List<String> services, {
    required bool canManageListings,
    required bool canManagePurchases,
    required bool canManageProfile,
    required bool canManageSupport,
    required bool canViewPeople,
    required bool canViewPlatformSupport,
  }) {
    final hasCarSales = hasBusinessService(
      services,
      BusinessServiceKey.carSales,
    );
    return [
      if (isAdmin) const PlatformAdminDashboardScreen() else const HomeMenu(),
      if (hasCarSales && canManageListings) const StaffCarManagementScreen(),
      if (hasCarSales && canManagePurchases)
        const StaffPurchaseManagementScreen(),
      if (!isAdmin && canManageProfile) const BusinessProfileScreen(),
      if (isAdmin && canViewPeople) const UserManagementScreen(),
      if (isAdmin && canViewPlatformSupport)
        const SupportInboxScreen.admin()
      else if (canManageSupport)
        const SupportInboxScreen.business(),
      const SettingsScreen(),
    ];
  }

  List<AppBottomNavItem> _buildItems(
    AppLocalizations l10n,
    bool isAdmin,
    List<String> services, {
    required bool canManageListings,
    required bool canManagePurchases,
    required bool canManageProfile,
    required bool canManageSupport,
    required bool canViewPeople,
    required bool canViewPlatformSupport,
  }) {
    final hasCarSales = hasBusinessService(
      services,
      BusinessServiceKey.carSales,
    );
    return [
      AppBottomNavItem(
        icon: Icons.home_outlined,
        selectedIcon: Icons.home,
        label: l10n.home,
      ),
      if (hasCarSales && canManageListings)
        AppBottomNavItem(
          icon: Icons.directions_car_outlined,
          selectedIcon: Icons.directions_car,
          label: l10n.manageCars,
        ),
      if (hasCarSales && canManagePurchases)
        AppBottomNavItem(
          icon: Icons.receipt_long_outlined,
          selectedIcon: Icons.receipt_long,
          label: l10n.purchases,
        ),
      if (!isAdmin && canManageProfile)
        AppBottomNavItem(
          icon: Icons.storefront_outlined,
          selectedIcon: Icons.storefront,
          label: l10n.business,
        ),
      if (isAdmin && canViewPeople)
        AppBottomNavItem(
          icon: Icons.people_outline,
          selectedIcon: Icons.people,
          label: l10n.users,
        ),
      if ((isAdmin && canViewPlatformSupport) || (!isAdmin && canManageSupport))
        AppBottomNavItem(
          icon: Icons.support_agent_outlined,
          selectedIcon: Icons.support_agent,
          label: l10n.support,
        ),
      AppBottomNavItem(
        icon: Icons.settings_outlined,
        selectedIcon: Icons.settings,
        label: l10n.settings,
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final isAdmin = authProvider.isAdmin;
    final l10n = AppLocalizations.of(context)!;
    final canManageListings = authProvider.hasBusinessPermission(
      BusinessPermission.listings,
    );
    final canManagePurchases = authProvider.hasBusinessPermission(
      BusinessPermission.purchases,
    );
    final canManageProfile = authProvider.hasBusinessPermission(
      BusinessPermission.profile,
    );
    final canManageSupport = authProvider.hasBusinessPermission(
      BusinessPermission.support,
    );
    final canViewPeople = authProvider.canViewPlatformSection(
      PlatformSection.people,
    );
    final canViewPlatformSupport = authProvider.canViewPlatformSection(
      PlatformSection.support,
    );
    if (isAdmin || (authProvider.businessId ?? '').isEmpty) {
      final services = defaultBusinessServiceValues;
      final screens = _buildScreens(
        isAdmin,
        services,
        canManageListings: canManageListings,
        canManagePurchases: canManagePurchases,
        canManageProfile: canManageProfile,
        canManageSupport: canManageSupport,
        canViewPeople: canViewPeople,
        canViewPlatformSupport: canViewPlatformSupport,
      );
      final items = _buildItems(
        l10n,
        isAdmin,
        services,
        canManageListings: canManageListings,
        canManagePurchases: canManagePurchases,
        canManageProfile: canManageProfile,
        canManageSupport: canManageSupport,
        canViewPeople: canViewPeople,
        canViewPlatformSupport: canViewPlatformSupport,
      );
      final currentIndex = _safeIndex(screens.length);
      return _StaffScaffold(
        currentIndex: currentIndex,
        screens: screens,
        items: items,
        onTap: (index) => setState(() => _currentIndex = index),
      );
    }

    return StreamBuilder<DocumentSnapshot>(
      stream: FirebaseFirestore.instance
          .collection('businesses')
          .doc(authProvider.businessId)
          .snapshots(),
      builder: (context, snapshot) {
        final business = snapshot.hasData && snapshot.data!.exists
            ? BusinessProfile.fromFirestore(snapshot.data!)
            : null;
        final services =
            business?.enabledServices ??
            (authProvider.businessServices.isEmpty
                ? defaultBusinessServiceValues
                : authProvider.businessServices);
        final screens = _buildScreens(
          isAdmin,
          services,
          canManageListings: canManageListings,
          canManagePurchases: canManagePurchases,
          canManageProfile: canManageProfile,
          canManageSupport: canManageSupport,
          canViewPeople: canViewPeople,
          canViewPlatformSupport: canViewPlatformSupport,
        );
        final items = _buildItems(
          l10n,
          isAdmin,
          services,
          canManageListings: canManageListings,
          canManagePurchases: canManagePurchases,
          canManageProfile: canManageProfile,
          canManageSupport: canManageSupport,
          canViewPeople: canViewPeople,
          canViewPlatformSupport: canViewPlatformSupport,
        );
        final currentIndex = _safeIndex(screens.length);
        return _StaffScaffold(
          currentIndex: currentIndex,
          screens: screens,
          items: items,
          onTap: (index) => setState(() => _currentIndex = index),
          banner: business == null
              ? null
              : _PendingBusinessBanner.fromBusiness(business),
        );
      },
    );
  }
}

class _StaffScaffold extends StatelessWidget {
  const _StaffScaffold({
    required this.currentIndex,
    required this.screens,
    required this.items,
    required this.onTap,
    this.banner,
  });

  final int currentIndex;
  final List<Widget> screens;
  final List<AppBottomNavItem> items;
  final ValueChanged<int> onTap;
  final Widget? banner;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          ?banner,
          Expanded(child: screens[currentIndex]),
        ],
      ),
      bottomNavigationBar: AppBottomNav(
        currentIndex: currentIndex,
        onTap: onTap,
        items: items,
      ),
    );
  }
}

class _PendingBusinessBanner extends StatelessWidget {
  const _PendingBusinessBanner({required this.businessId}) : business = null;
  const _PendingBusinessBanner.fromBusiness(this.business) : businessId = null;

  final String? businessId;
  final BusinessProfile? business;

  @override
  Widget build(BuildContext context) {
    final providedBusiness = business;
    if (providedBusiness != null) {
      return _buildBanner(context, providedBusiness.status);
    }
    return StreamBuilder<DocumentSnapshot>(
      stream: FirebaseFirestore.instance
          .collection('businesses')
          .doc(businessId)
          .snapshots(),
      builder: (context, snapshot) {
        if (!snapshot.hasData || !snapshot.data!.exists) {
          return const SizedBox.shrink();
        }
        final data = snapshot.data!.data() as Map<String, dynamic>? ?? {};
        final status = (data['status'] ?? 'pending') as String;
        return _buildBanner(context, status);
      },
    );
  }

  Widget _buildBanner(BuildContext context, String status) {
    if (status == 'approved') return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    return Material(
      color: AppColors.saffron.withValues(alpha: 0.14),
      child: SafeArea(
        bottom: false,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Row(
            children: [
              const Icon(Icons.hourglass_top, color: AppColors.warn),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  status == 'changes_requested'
                      ? l10n.businessChangesRequestedBanner
                      : l10n.businessPendingApprovalBanner,
                  style: const TextStyle(
                    color: AppColors.warn,
                    fontWeight: FontWeight.w800,
                    height: 1.25,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

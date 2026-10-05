import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../l10n/app_localizations.dart';
import '../theme/app_colors.dart';
import '../widgets/app_bottom_nav.dart';
import '../widgets/lazy_indexed_stack.dart';
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
  /// The selected tab, remembered by id rather than position: the bar gains
  /// or loses tabs when the business's services load, and an index would
  /// silently move the person to a different tab.
  String? _selectedTabId;

  /// The business document, listened to once per business. Built inside
  /// `build` it was a new stream on every rebuild, and StreamBuilder dropped
  /// and re-opened the listener each time.
  Stream<DocumentSnapshot<Map<String, dynamic>>>? _businessStream;
  String? _businessStreamId;

  Stream<DocumentSnapshot<Map<String, dynamic>>> _businessStreamFor(
    String businessId,
  ) {
    final existing = _businessStream;
    if (existing != null && _businessStreamId == businessId) return existing;
    _businessStreamId = businessId;
    return _businessStream = FirebaseFirestore.instance
        .collection('businesses')
        .doc(businessId)
        .snapshots();
  }

  List<_StaffTab> _buildTabs(
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
      _StaffTab(
        isAdmin ? 'platform' : 'home',
        isAdmin ? const PlatformAdminDashboardScreen() : const HomeMenu(),
        AppBottomNavItem(
          icon: Icons.home_outlined,
          selectedIcon: Icons.home,
          label: l10n.home,
        ),
      ),
      if (hasCarSales && canManageListings)
        _StaffTab(
          'listings',
          const StaffCarManagementScreen(),
          AppBottomNavItem(
            icon: Icons.directions_car_outlined,
            selectedIcon: Icons.directions_car,
            label: l10n.manageCars,
          ),
        ),
      if (hasCarSales && canManagePurchases)
        _StaffTab(
          'purchases',
          const StaffPurchaseManagementScreen(),
          AppBottomNavItem(
            icon: Icons.receipt_long_outlined,
            selectedIcon: Icons.receipt_long,
            label: l10n.purchases,
          ),
        ),
      if (!isAdmin && canManageProfile)
        _StaffTab(
          'profile',
          const BusinessProfileScreen(),
          AppBottomNavItem(
            icon: Icons.storefront_outlined,
            selectedIcon: Icons.storefront,
            label: l10n.business,
          ),
        ),
      if (isAdmin && canViewPeople)
        _StaffTab(
          'people',
          const UserManagementScreen(),
          AppBottomNavItem(
            icon: Icons.people_outline,
            selectedIcon: Icons.people,
            label: l10n.users,
          ),
        ),
      if (isAdmin && canViewPlatformSupport)
        _StaffTab(
          'support-admin',
          const SupportInboxScreen.admin(),
          AppBottomNavItem(
            icon: Icons.support_agent_outlined,
            selectedIcon: Icons.support_agent,
            label: l10n.support,
          ),
        )
      else if (!isAdmin && canManageSupport)
        _StaffTab(
          'support',
          const SupportInboxScreen.business(),
          AppBottomNavItem(
            icon: Icons.support_agent_outlined,
            selectedIcon: Icons.support_agent,
            label: l10n.support,
          ),
        ),
      _StaffTab(
        'settings',
        const SettingsScreen(),
        AppBottomNavItem(
          icon: Icons.settings_outlined,
          selectedIcon: Icons.settings,
          label: l10n.settings,
        ),
      ),
    ];
  }

  Widget _scaffold(List<_StaffTab> tabs, {Widget? banner}) {
    final ids = [for (final tab in tabs) tab.id];
    return _StaffScaffold(
      currentIndex: staffTabIndex(ids, _selectedTabId),
      tabs: tabs,
      onTap: (index) => setState(() => _selectedTabId = ids[index]),
      banner: banner,
    );
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
    final businessId = authProvider.businessId ?? '';
    if (isAdmin || businessId.isEmpty) {
      return _scaffold(
        _buildTabs(
          l10n,
          isAdmin,
          defaultBusinessServiceValues,
          canManageListings: canManageListings,
          canManagePurchases: canManagePurchases,
          canManageProfile: canManageProfile,
          canManageSupport: canManageSupport,
          canViewPeople: canViewPeople,
          canViewPlatformSupport: canViewPlatformSupport,
        ),
      );
    }

    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: _businessStreamFor(businessId),
      builder: (context, snapshot) {
        final business = snapshot.hasData && snapshot.data!.exists
            ? BusinessProfile.fromFirestore(snapshot.data!)
            : null;
        final services =
            business?.enabledServices ??
            (authProvider.businessServices.isEmpty
                ? defaultBusinessServiceValues
                : authProvider.businessServices);
        return _scaffold(
          _buildTabs(
            l10n,
            isAdmin,
            services,
            canManageListings: canManageListings,
            canManagePurchases: canManagePurchases,
            canManageProfile: canManageProfile,
            canManageSupport: canManageSupport,
            canViewPeople: canViewPeople,
            canViewPlatformSupport: canViewPlatformSupport,
          ),
          banner: business == null
              ? null
              : _PendingBusinessBanner.fromBusiness(business),
        );
      },
    );
  }
}

/// Which tab to show: the one last chosen, wherever it now sits, or the
/// first tab when it is gone (or nothing was chosen yet).
@visibleForTesting
int staffTabIndex(List<String> tabIds, String? selectedId) {
  if (tabIds.isEmpty || selectedId == null) return 0;
  final index = tabIds.indexOf(selectedId);
  return index < 0 ? 0 : index;
}

class _StaffTab {
  const _StaffTab(this.id, this.screen, this.item);

  final String id;
  final Widget screen;
  final AppBottomNavItem item;
}

class _StaffScaffold extends StatelessWidget {
  const _StaffScaffold({
    required this.currentIndex,
    required this.tabs,
    required this.onTap,
    this.banner,
  });

  final int currentIndex;
  final List<_StaffTab> tabs;
  final ValueChanged<int> onTap;
  final Widget? banner;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          ?banner,
          // Each tab is built on first visit and kept from then on: leaving
          // the business home no longer tears down its listeners, scroll and
          // filters, and coming back costs no reads.
          Expanded(
            child: LazyIndexedStack(
              index: currentIndex,
              children: [
                for (final tab in tabs)
                  KeyedSubtree(
                    key: ValueKey<String>(tab.id),
                    child: tab.screen,
                  ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: AppBottomNav(
        currentIndex: currentIndex,
        onTap: onTap,
        items: [for (final tab in tabs) tab.item],
      ),
    );
  }
}

class _PendingBusinessBanner extends StatelessWidget {
  const _PendingBusinessBanner.fromBusiness(this.business);

  final BusinessProfile business;

  // Always handed the business the shell already listens to; the banner
  // never opens a stream of its own (it used to be able to, from `build`).
  @override
  Widget build(BuildContext context) => _buildBanner(context, business.status);

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

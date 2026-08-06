import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/app_gate_provider.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';

/// The content of each persistent-navbar tab. Services of the same nature live
/// together: Shipping, Cars, and Activity. These are the *roots* of the tab
/// navigators in [CustomerHomeScreen] — opening any row pushes onto the same
/// (nested) navigator, so the bottom bar stays visible throughout.

String _greeting(AppLocalizations l10n) {
  final hour = DateTime.now().hour;
  if (hour < 12) return l10n.goodMorning;
  if (hour < 17) return l10n.goodAfternoon;
  return l10n.goodEvening;
}

/// Home tab — greeting and a few quick actions.
class HomeTab extends StatelessWidget {
  const HomeTab({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 28),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
              child: _GreetingHeader(auth: auth),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
              child: _BalanceCard(auth: auth),
            ),
            _SectionHeader(l10n.hubQuickActions),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: _ServicesSection(
                items: [
                  _HubItem(
                    l10n.hubSendBarrel,
                    l10n.hubShipFullBarrel,
                    Icons.local_shipping_outlined,
                    AppColors.cobalt,
                    '/barrel',
                  ),
                  _HubItem(
                    l10n.hubBrowseCars,
                    l10n.hubBuyVerifiedCar,
                    Icons.directions_car_outlined,
                    AppColors.cobaltMid,
                    '/sell',
                  ),
                  _HubItem(
                    l10n.trackShipment,
                    l10n.hubFollowShipments,
                    Icons.route_outlined,
                    AppColors.sage,
                    '/tracking',
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Shipping tab — everything you send home.
class ShippingTab extends StatelessWidget {
  const ShippingTab({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final sharedBarrelsEnabled = context.watch<AppGateProvider>().sharedBarrelsEnabled;
    return _CategoryTab(
      title: l10n.hubShipping,
      subtitle: l10n.hubShippingSubtitle,
      items: [
        _HubItem(
          l10n.hubSendBarrel,
          l10n.hubShipFullBarrel,
          Icons.local_shipping_outlined,
          AppColors.cobalt,
          '/barrel',
        ),
        if (sharedBarrelsEnabled)
          _HubItem(
            l10n.hubSharedBarrels,
            l10n.hubSharedBarrelsSubtitle,
            Icons.group_add_outlined,
            AppColors.saffron,
            '/open-barrels',
          ),
        _HubItem(
          l10n.orderTypeFreight,
          l10n.hubFreightSubtitle,
          Icons.inventory_2_outlined,
          AppColors.sage,
          '/send-freight',
        ),
        _HubItem(
          l10n.hubTransportCar,
          l10n.hubShipCarHome,
          Icons.car_rental_outlined,
          AppColors.cobaltMid,
          '/request-transport',
        ),
      ],
    );
  }
}

/// Cars tab — buy and store vehicles.
class CarsTab extends StatelessWidget {
  const CarsTab({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _CategoryTab(
      title: l10n.cars,
      subtitle: l10n.hubCarsSubtitle,
      items: [
        _HubItem(
          l10n.hubBrowseCars,
          l10n.hubBuyVerifiedCar,
          Icons.directions_car_outlined,
          AppColors.cobalt,
          '/sell',
        ),
        _HubItem(
          l10n.parkACar,
          l10n.hubParkCarSubtitle,
          Icons.local_parking_outlined,
          AppColors.cobaltMid,
          '/park',
        ),
      ],
    );
  }
}

/// Activity tab — orders, tracking, and money.
class ActivityTab extends StatelessWidget {
  const ActivityTab({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 28),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 20, 22, 4),
              child: _CategoryHeader(
                title: l10n.activity,
                subtitle: l10n.hubActivitySubtitle,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
              child: _BalanceCard(auth: auth),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: _ServicesSection(
                items: [
                  _HubItem(
                    l10n.trackShipment,
                    l10n.hubFollowShipments,
                    Icons.route_outlined,
                    AppColors.cobalt,
                    '/tracking',
                  ),
                  _HubItem(
                    l10n.myOrders,
                    l10n.hubOrdersSubtitle,
                    Icons.receipt_long_outlined,
                    AppColors.cobaltMid,
                    '/orders',
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A simple category landing: big title + a card of service rows.
class _CategoryTab extends StatelessWidget {
  const _CategoryTab({
    required this.title,
    required this.subtitle,
    required this.items,
  });

  final String title;
  final String subtitle;
  final List<_HubItem> items;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 28),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 20, 22, 4),
              child: _CategoryHeader(title: title, subtitle: subtitle),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: _ServicesSection(items: items),
            ),
          ],
        ),
      ),
    );
  }
}

class _CategoryHeader extends StatelessWidget {
  const _CategoryHeader({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w900,
            color: AppColors.ink,
            letterSpacing: -0.3,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: const TextStyle(color: AppColors.muted, fontSize: 14),
        ),
      ],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 26, 22, 12),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w800,
          color: AppColors.ink,
          letterSpacing: 0.1,
        ),
      ),
    );
  }
}

class _GreetingHeader extends StatelessWidget {
  const _GreetingHeader({required this.auth});

  final AuthProvider auth;

  @override
  Widget build(BuildContext context) {
    final signedIn = auth.isAuthenticated;
    final name = signedIn
        ? auth.buyerName
        : AppLocalizations.of(context)!.hubGuestName;
    final photo = auth.profileImageUrl;
    final initial = (name.isNotEmpty ? name[0] : '?').toUpperCase();

    return Row(
      children: [
        Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: AppColors.headerGradient,
            image: photo != null && photo.isNotEmpty
                ? DecorationImage(image: NetworkImage(photo), fit: BoxFit.cover)
                : null,
          ),
          alignment: Alignment.center,
          child: photo != null && photo.isNotEmpty
              ? null
              : Text(
                  initial,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 18,
                  ),
                ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _greeting(AppLocalizations.of(context)!),
                style: const TextStyle(
                  color: AppColors.muted,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.ink,
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Signed-out visitors still get a sign-in prompt here. The wallet balance
/// this card used to show is gone with the wallet itself
/// (docs/PLAN-2026-08-backlog.md #3).
class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.auth});

  final AuthProvider auth;

  @override
  Widget build(BuildContext context) {
    final user = auth.user;
    if (user == null) {
      return _SignInPromptCard(
        onTap: () => Navigator.pushNamed(context, '/login'),
      );
    }
    return const SizedBox.shrink();
  }
}

class _SignInPromptCard extends StatelessWidget {
  const _SignInPromptCard({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            gradient: AppColors.headerGradient,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: AppColors.cobaltDeep.withValues(alpha: 0.28),
                blurRadius: 22,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(22, 20, 18, 20),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        AppLocalizations.of(context)!.signInToYourWallet,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        AppLocalizations.of(context)!.walletSignInSubtitle,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.85),
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.arrow_forward_rounded, color: Colors.white),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HubItem {
  const _HubItem(this.title, this.subtitle, this.icon, this.color, this.route);
  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final String route;
}

/// A rounded white card holding the rows of one section, separated by light
/// dividers.
class _ServicesSection extends StatelessWidget {
  const _ServicesSection({required this.items});

  final List<_HubItem> items;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.rule),
        boxShadow: [
          BoxShadow(
            color: AppColors.ink.withValues(alpha: 0.04),
            blurRadius: 14,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0)
              const Divider(
                height: 1,
                thickness: 1,
                indent: 72,
                endIndent: 16,
                color: AppColors.rule,
              ),
            _ServiceRow(item: items[i]),
          ],
        ],
      ),
    );
  }
}

class _ServiceRow extends StatelessWidget {
  const _ServiceRow({required this.item});

  final _HubItem item;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => Navigator.pushNamed(context, item.route),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: item.color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(item.icon, color: item.color, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    item.title,
                    style: const TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.subtitle,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.muted,
                      height: 1.2,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.chevron_right_rounded,
              color: AppColors.muted,
              size: 24,
            ),
          ],
        ),
      ),
    );
  }
}

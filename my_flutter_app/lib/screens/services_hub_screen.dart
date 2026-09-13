import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/app_gate_provider.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../widgets/customer_notification_bell.dart';

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

/// Home tab — who you are, the one thing the app is for, and the way in.
///
/// This screen used to be a greeting, a sign-in slab and three rows, with the
/// bottom half of the phone left blank. The hero now carries the purpose, the
/// quick actions stay as the shortcuts they are, and the quieter rows below
/// fill the page with things a person actually reaches for.
class HomeTab extends StatelessWidget {
  const HomeTab({super.key, this.onShip});

  /// Opens the same chooser the raised Ship button opens, so the hero and the
  /// button are one action in two places rather than two similar ones.
  final VoidCallback? onShip;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    final signedIn = auth.user != null;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 28),
          children: [
            RiseIn(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 8, 4),
                child: Row(
                  children: [
                    Expanded(child: _GreetingHeader(auth: auth)),
                    const CustomerNotificationBell(),
                  ],
                ),
              ),
            ),
            RiseIn(
              index: 1,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 0),
                child: _ShipHero(onTap: onShip),
              ),
            ),
            RiseIn(index: 2, child: _SectionHeader(l10n.hubQuickActions)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: _ServicesSection(
                startIndex: 3,
                items: [
                  _HubItem(
                    l10n.hubBrowseCars,
                    l10n.hubBuyVerifiedCar,
                    Icons.directions_car_outlined,
                    AppColors.cobalt,
                    '/sell',
                  ),
                  _HubItem(
                    l10n.trackShipment,
                    l10n.hubFollowShipments,
                    Icons.route_outlined,
                    AppColors.cobaltMid,
                    '/tracking',
                  ),
                  _HubItem(
                    l10n.myOrders,
                    l10n.hubOrdersSubtitle,
                    Icons.receipt_long_outlined,
                    AppColors.sage,
                    '/orders',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                children: [
                  if (!signedIn) ...[
                    RiseIn(
                      index: 6,
                      child: _QuietRow(
                        icon: Icons.person_outline,
                        tint: AppColors.cobalt,
                        title: l10n.signInToYourAccount,
                        subtitle: l10n.homeSignInSubtitle,
                        onTap: () => Navigator.pushNamed(context, '/login'),
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  RiseIn(
                    index: 7,
                    child: _QuietRow(
                      icon: Icons.chat_bubble_outline,
                      tint: AppColors.saffron,
                      title: l10n.homeHelpTitle,
                      subtitle: l10n.homeHelpSubtitle,
                      onTap: () => Navigator.pushNamed(context, '/support'),
                    ),
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

/// The purpose of the app, said once, in the only gradient on the screen.
///
/// Everything else in the customer area is paper and hairlines, so this is the
/// one thing the eye lands on — and it opens exactly what the raised Ship
/// button opens.
class _ShipHero extends StatelessWidget {
  const _ShipHero({this.onTap});

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Semantics(
      button: true,
      label: '${l10n.homeHeroTitle}. ${l10n.homeHeroSubtitle}',
      child: PressableScale(
        scale: 0.985,
        onTap: onTap == null
            ? null
            : () {
                AppHaptics.commit();
                onTap!();
              },
        child: Container(
          decoration: BoxDecoration(
            gradient: AppColors.headerGradient,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: AppColors.cobaltDeep.withValues(alpha: 0.3),
                blurRadius: 26,
                offset: const Offset(0, 12),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              // A glyph big enough to read as texture, not as an icon, so the
              // card has depth without another element competing for the eye.
              Positioned(
                right: -26,
                bottom: -34,
                child: Icon(
                  Icons.local_shipping_rounded,
                  size: 158,
                  color: Colors.white.withValues(alpha: 0.09),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(22, 22, 22, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      l10n.homeHeroTitle,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        height: 1.12,
                        // Large text reads too loose at default tracking.
                        letterSpacing: -0.4,
                      ),
                    ),
                    const SizedBox(height: 6),
                    SizedBox(
                      width: 250,
                      child: Text(
                        l10n.homeHeroSubtitle,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.88),
                          fontSize: 13.5,
                          height: 1.35,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            l10n.homeHeroCta,
                            style: const TextStyle(
                              color: AppColors.cobaltDeep,
                              fontSize: 14,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(width: 4),
                          const Icon(
                            Icons.arrow_forward_rounded,
                            size: 17,
                            color: AppColors.cobaltDeep,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A standalone row in the same language as [_ServiceRow], for the one-off
/// destinations that do not belong inside a grouped card.
class _QuietRow extends StatelessWidget {
  const _QuietRow({
    required this.icon,
    required this.tint,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final Color tint;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '$title. $subtitle',
      child: PressableScale(
        scale: 0.985,
        onTap: () {
          AppHaptics.selection();
          onTap();
        },
        child: Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            color: AppColors.paper,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.rule),
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: tint.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(icon, color: tint, size: 21),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.muted,
                        height: 1.25,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(
                Icons.chevron_right_rounded,
                size: 22,
                color: AppColors.muted,
              ),
            ],
          ),
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
      showBell: true,
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
            RiseIn(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(22, 20, 8, 4),
                child: _CategoryHeader(
                  title: l10n.activity,
                  subtitle: l10n.hubActivitySubtitle,
                  trailing: const CustomerNotificationBell(),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: _ServicesSection(
                startIndex: 1,
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
                  // Its own row rather than a filter inside My orders: a
                  // viewing needs answering, sometimes today, and burying it
                  // among barrels and freight is how a proposal goes stale.
                  _HubItem(
                    l10n.myCarViewings,
                    l10n.hubViewingsSubtitle,
                    Icons.event_available_outlined,
                    AppColors.sage,
                    '/my-viewings',
                  ),
                ],
              ),
            ),
            if (auth.user == null) ...[
              const SizedBox(height: 18),
              RiseIn(
                index: 4,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _QuietRow(
                    icon: Icons.person_outline,
                    tint: AppColors.cobalt,
                    title: l10n.signInToYourAccount,
                    subtitle: l10n.homeSignInSubtitle,
                    onTap: () => Navigator.pushNamed(context, '/login'),
                  ),
                ),
              ),
            ],
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
    this.showBell = false,
  });

  final String title;
  final String subtitle;
  final List<_HubItem> items;
  final bool showBell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 28),
          children: [
            RiseIn(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(22, 20, 8, 4),
                child: _CategoryHeader(
                  title: title,
                  subtitle: subtitle,
                  trailing: showBell ? const CustomerNotificationBell() : null,
                ),
              ),
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
  const _CategoryHeader({
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final String title;
  final String subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
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
          ),
        ),
        ?trailing,
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
  const _ServicesSection({required this.items, this.startIndex = 1});

  final List<_HubItem> items;

  /// Where this card sits in the screen's entrance order, so a card under a
  /// header keeps arriving after it rather than racing it.
  final int startIndex;

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
            // The rows arrive in reading order, one just behind the next, so
            // the card assembles itself instead of being stamped down whole.
            RiseIn(index: startIndex + i, child: _ServiceRow(item: items[i])),
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
    // PressableScale over InkWell: the row answers on finger-down instead of
    // waiting for the release, which is what makes a tap feel direct.
    return PressableScale(
      scale: 0.975,
      onTap: () {
        AppHaptics.selection();
        Navigator.pushNamed(context, item.route);
      },
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

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/app_gate_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../widgets/app_bottom_nav.dart';
import '../widgets/ship_sheet.dart';
import 'services_hub_screen.dart';
import 'settings_screen.dart';

// Customer service screens, reachable in-tab so the bottom navbar stays put.
import 'send_barrel_screen.dart';
import 'open_barrels_screen.dart';
import 'send_freight_screen.dart';
import 'sell_cars_screen.dart';
import 'park_car_screen.dart';
import 'request_transport_screen.dart';
import 'tracking_screen.dart';
import 'my_purchases_screen.dart';
import 'orders_screen.dart';
import 'freight_quote_details_screen.dart';
import 'review_composer_screen.dart';
import 'business_management_screen.dart';
import 'business_profile_screen.dart';
import 'add_staff_screen.dart';
import 'favorite_cars_screen.dart';
import 'account_profile_screen.dart';
import 'destination_countries_screen.dart';
import 'login_screen.dart';
import 'signup_screen.dart';
import '../models/parked_car.dart';
import 'parked_car_details_screen.dart';
import '../models/barrel_shipment.dart';
import 'barrel_shipment_details_screen.dart';
import '../models/transport_request.dart';
import 'transport_request_details_screen.dart';
import 'support_inbox_screen.dart';
import 'support_thread_screen.dart';
import '../services/notification_routing.dart';

/// Builds the customer-area screens for the *nested* tab navigators. Keeping
/// these in the tab navigator (instead of the root navigator) is what lets the
/// bottom navbar stay visible while a service is open. Returns null for routes
/// that aren't part of the customer area.
Route<dynamic>? _customerTabRoute(RouteSettings settings) {
  Widget? page;
  switch (settings.name) {
    case '/barrel':
      page = const SendBarrelScreen();
      break;
    case '/open-barrels':
      page = const OpenBarrelsScreen();
      break;
    case '/send-freight':
      page = const SendFreightScreen();
      break;
    case '/sell':
      page = const SellCarsScreen(showBackButton: true);
      break;
    case '/park':
      page = const ParkCarScreen();
      break;
    case '/request-transport':
      page = const RequestTransportScreen();
      break;
    case '/tracking':
      final args = settings.arguments is TrackingScreenArguments
          ? settings.arguments as TrackingScreenArguments
          : null;
      page = TrackingScreen(
        showBackButton: true,
        focusShipmentId: args?.shipmentId,
      );
      break;
    case '/my-purchases':
      page = const MyPurchasesScreen(showBackButton: true);
      break;
    // Registered here as well as in main.dart for the same reason as
    // /leave-review below: a route pushed from inside the tab navigator is
    // resolved by this table, and an unknown one falls through to the tab
    // root - which reads as "tapping my viewing took me back to Activity".
    case '/my-viewings':
      page = const MyPurchasesScreen(
        showBackButton: true,
        scope: PurchaseListScope.viewings,
      );
      break;
    case '/orders':
      page = OrdersScreen(
        showBackButton: true,
        initialArgs: settings.arguments is OrdersScreenArguments
            ? settings.arguments as OrdersScreenArguments
            : null,
      );
      break;
    case '/freight-quote':
      final quoteArgs = settings.arguments;
      if (quoteArgs is FreightQuoteScreenArguments) {
        page = FreightQuoteDetailsScreen(
          requestId: quoteArgs.requestId,
          trackingCode: quoteArgs.trackingCode,
        );
      } else {
        page = const OrdersScreen(showBackButton: true);
      }
      break;
    // Pushed from a completed order card (OrdersScreen) and from
    // TrackingScreen, both of which live inside a tab navigator - so the route
    // has to be resolvable here, not only in main.dart's root routes table.
    // Without this case the unknown-route fallback below silently replaced the
    // review composer with the tab root, which read as "tapping Review takes
    // me back to Activity".
    case '/leave-review':
      final reviewArgs = settings.arguments;
      if (reviewArgs is ReviewComposerArguments) {
        page = ReviewComposerScreen(arguments: reviewArgs);
      }
      break;
    case '/favorite-cars':
      page = const FavoriteCarsScreen();
      break;
    case '/account-profile':
      page = const AccountProfileScreen();
      break;
    case '/support':
      page = const SupportInboxScreen.customer();
      break;
    // Pushed from the Settings tab root, which is itself inside a tab
    // navigator - same silent-fallback trap as '/leave-review' above.
    case '/businesses':
      page = const BusinessManagementScreen();
      break;
    case '/business-profile':
      page = const BusinessProfileScreen();
      break;
    // Reachable once '/business-profile' resolves in-tab, since that screen
    // pushes it.
    case '/add-staff':
      page = const AddStaffScreen();
      break;
    case '/support-thread':
      page = SupportThreadScreen(caseId: settings.arguments as String);
      break;
    case '/destination-countries':
      page = const DestinationCountriesScreen();
      break;
    case '/login':
      page = const LoginScreen();
      break;
    case '/signup':
      page = const SignUpScreen();
      break;
    case '/parked-car-details':
      page = ParkedCarDetailsScreen(parkedCar: settings.arguments as ParkedCar);
      break;
    case '/barrel-shipment-details':
      page = BarrelShipmentDetailsScreen(
        shipment: settings.arguments as BarrelShipment,
      );
      break;
    case '/transport-request-details':
      page = TransportRequestDetailsScreen(
        request: settings.arguments as TransportRequest,
      );
      break;
  }
  if (page == null) return null;
  return MaterialPageRoute(builder: (_) => page!, settings: settings);
}

/// The customer shell: a persistent bottom navbar over five tabs, each with its
/// own nested navigator so opening a service never hides the bar. Services of
/// the same nature are grouped under one tab (Shipping, Cars, Activity).
class CustomerHomeScreen extends StatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  State<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends State<CustomerHomeScreen> {
  static const _tabCount = 5;

  /// The shipping tab is no longer one of the bar's equals — it is what the
  /// raised Ship button opens into — so the bar shows these four and the
  /// button stands for the fifth.
  static const _shippingTab = 1;
  static const _visibleTabs = <int>[0, 2, 3, 4];

  int _index = 0;
  final List<GlobalKey<NavigatorState>> _navKeys = List.generate(
    _tabCount,
    (_) => GlobalKey<NavigatorState>(),
  );

  Widget _root(int index) {
    switch (index) {
      case 0:
        return const HomeTab();
      case 1:
        return const ShippingTab();
      case 2:
        return const CarsTab();
      case 3:
        return const ActivityTab();
      default:
        return Builder(
          builder: (context) => SettingsScreen(
            onOpenAccountProfile: () =>
                Navigator.of(context).pushNamed('/account-profile'),
          ),
        );
    }
  }

  void _onTap(int index) {
    if (index == _index) {
      // Tapping the active tab again returns to its root.
      _navKeys[index].currentState?.popUntil((route) => route.isFirst);
    } else {
      setState(() => _index = index);
    }
  }

  /// Ship asks what, then takes them straight there.
  ///
  /// The flow opens inside the shipping tab's own navigator, so the bar stays
  /// put and backing out lands on the shipping hub — every service in one
  /// place — rather than dumping them on Home.
  Future<void> _openShip() async {
    final l10n = AppLocalizations.of(context)!;
    final sharedBarrels = context.read<AppGateProvider>().sharedBarrelsEnabled;
    final route = await showShipSheet(
      context,
      title: l10n.shipSheetTitle,
      subtitle: l10n.shipSheetSubtitle,
      options: [
        ShipOption(
          route: '/barrel',
          icon: Icons.local_shipping_outlined,
          title: l10n.hubSendBarrel,
          subtitle: l10n.hubShipFullBarrel,
          tint: AppColors.cobalt,
        ),
        if (sharedBarrels)
          ShipOption(
            route: '/open-barrels',
            icon: Icons.group_add_outlined,
            title: l10n.hubSharedBarrels,
            subtitle: l10n.hubSharedBarrelsSubtitle,
            tint: AppColors.cobaltMid,
          ),
        // The tints have to be told apart at a glance, and the palette's
        // teals read as one colour at 13% alpha — so the four options step
        // teal, bright teal, amber, slate rather than four shades of green.
        ShipOption(
          route: '/send-freight',
          icon: Icons.inventory_2_outlined,
          title: l10n.orderTypeFreight,
          subtitle: l10n.hubFreightSubtitle,
          tint: AppColors.saffron,
        ),
        ShipOption(
          route: '/request-transport',
          icon: Icons.car_rental_outlined,
          title: l10n.hubTransportCar,
          subtitle: l10n.hubShipCarHome,
          tint: AppColors.ink,
        ),
      ],
    );
    if (route == null || !mounted) return;
    setState(() => _index = _shippingTab);
    final nav = _navKeys[_shippingTab].currentState;
    nav?.popUntil((r) => r.isFirst);
    nav?.pushNamed(route);
  }

  Widget _tab(int index) {
    return Navigator(
      key: _navKeys[index],
      onGenerateRoute: (settings) {
        if (settings.name == null || settings.name == '/') {
          return MaterialPageRoute(
            builder: (_) => _root(index),
            settings: settings,
          );
        }
        // Unknown routes fall back to the tab root rather than crashing.
        return _customerTabRoute(settings) ??
            MaterialPageRoute(builder: (_) => _root(index), settings: settings);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        final nav = _navKeys[_index].currentState;
        if (nav != null && nav.canPop()) {
          nav.pop();
        } else if (_index != 0) {
          setState(() => _index = 0);
        }
      },
      child: Scaffold(
        body: _TabSwap(
          index: _index,
          // IndexedStack keeps every tab's navigator alive, so the swap is
          // instant by construction; this plays the arriving tab in over it so
          // the change reads as a move rather than a cut.
          child: IndexedStack(
            index: _index,
            children: [for (var i = 0; i < _tabCount; i++) _tab(i)],
          ),
        ),
        bottomNavigationBar: AppBottomNav(
          // -1 while a shipping flow is open: no tab owns that place, the
          // raised button does, and it lights up instead.
          currentIndex: _visibleTabs.indexOf(_index),
          onTap: (visible) => _onTap(_visibleTabs[visible]),
          action: AppBottomNavAction(
            icon: Icons.local_shipping_rounded,
            label: l10n.navShip,
            active: _index == _shippingTab,
            onTap: _openShip,
          ),
          items: [
            AppBottomNavItem(
              icon: Icons.home_outlined,
              selectedIcon: Icons.home,
              label: l10n.home,
            ),
            AppBottomNavItem(
              icon: Icons.directions_car_outlined,
              selectedIcon: Icons.directions_car,
              label: l10n.cars,
            ),
            AppBottomNavItem(
              icon: Icons.receipt_long_outlined,
              selectedIcon: Icons.receipt_long,
              label: l10n.activity,
            ),
            AppBottomNavItem(
              icon: Icons.settings_outlined,
              selectedIcon: Icons.settings,
              label: l10n.settings,
            ),
          ],
        ),
      ),
    );
  }
}

/// Plays the incoming tab in whenever [index] changes.
///
/// The travel is small and downward-to-rest: enough to say "this is new
/// content", not enough to make switching tabs feel slow. Under reduced motion
/// it is a cross-fade with no travel.
class _TabSwap extends StatefulWidget {
  const _TabSwap({required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  State<_TabSwap> createState() => _TabSwapState();
}

class _TabSwapState extends State<_TabSwap>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 300),
    value: 1,
  );

  @override
  void didUpdateWidget(_TabSwap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.index != widget.index) {
      _controller.duration = AppMotion.reduced(context)
          ? const Duration(milliseconds: 140)
          : const Duration(milliseconds: 300);
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final flat = AppMotion.reduced(context);
    final curved = CurvedAnimation(
      parent: _controller,
      curve: AppMotion.standard,
    );
    return AnimatedBuilder(
      animation: curved,
      builder: (context, child) {
        final t = curved.value;
        return Opacity(
          opacity: 0.35 + 0.65 * t,
          child: flat
              ? child
              : Transform.translate(
                  offset: Offset(0, (1 - t) * 10),
                  child: child,
                ),
        );
      },
      child: widget.child,
    );
  }
}

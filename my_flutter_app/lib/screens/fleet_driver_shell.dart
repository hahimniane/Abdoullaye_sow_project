import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_driver_app.dart';
import '../services/fleet_driver_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_bottom_nav.dart';
import '../widgets/fleet_widgets.dart';
import 'fleet_driver_tabs.dart';
import 'settings_screen.dart';

Future<bool> _launchOutside(Uri uri) =>
    launchUrl(uri, mode: LaunchMode.externalApplication);

/// A Fleet driver's own account (docs/FLEET.md section 11): Home (what they
/// owe and how to pay), Payments, My plate and, when the business shows its
/// drivers Fleet and nothing else of Laawol ([locked]), Settings.
///
/// Locked, this IS the app for the driver: it stands where the customer home
/// would. Not locked, it is opened from the customer home's "Your plate" card
/// and carries a way back instead of Settings.
class FleetDriverShell extends StatefulWidget {
  const FleetDriverShell({
    super.key,
    required this.controller,
    this.locked = true,
    this.openLink = _launchOutside,
    this.settings,
  });

  final FleetDriverController controller;
  final bool locked;
  final DriverLinkOpener openLink;

  /// The Settings tab; tests hand in a stand-in.
  final WidgetBuilder? settings;

  @override
  State<FleetDriverShell> createState() => _FleetDriverShellState();
}

class _FleetDriverShellState extends State<FleetDriverShell> {
  int _index = 0;
  String? _businessId;

  /// The businesses this shell may show: Fleet-only ones when locked (the
  /// others are reached from the customer home they keep), else all.
  List<DriverFleet> _fleets(DriverHome home) => [
    for (final f in home.fleets)
      if (!widget.locked || f.onlyFleet) f,
  ];

  DriverFleet? _current(DriverHome home) {
    final fleets = _fleets(home);
    for (final f in fleets) {
      if (f.businessId == _businessId) return f;
    }
    if (widget.locked) return home.lockedFleet;
    return fleets.isEmpty ? null : fleets.first;
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) => _build(context),
    );
  }

  Widget _build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final controller = widget.controller;
    final home = controller.home;
    final fleet = _current(home);
    final back = widget.locked
        ? null
        : AppBackButton(onPressed: () => Navigator.of(context).maybePop());
    if (fleet == null) return _empty(context, l10n, back);

    final fleets = _fleets(home);
    final switcher = fleets.length < 2
        ? null
        : PopupMenuButton<String>(
            key: const Key('fleet-driver-switch'),
            tooltip: l10n.fdrSwitchBusiness,
            icon: const Icon(Icons.swap_horiz_rounded),
            onSelected: (id) => setState(() => _businessId = id),
            itemBuilder: (_) => [
              for (final f in fleets)
                PopupMenuItem(value: f.businessId, child: Text(f.businessName)),
            ],
          );
    final tabs = <Widget>[
      FleetDriverHomeTab(
        fleet: fleet,
        home: home,
        stale: controller.failed,
        onRefresh: controller.refresh,
        onSeePayments: () => setState(() => _index = 1),
        openLink: widget.openLink,
        leading: back,
        trailing: switcher,
      ),
      FleetDriverPaymentsTab(
        fleet: fleet,
        home: home,
        onRefresh: controller.refresh,
        leading: back,
      ),
      FleetDriverPlateTab(
        fleet: fleet,
        home: home,
        onRefresh: controller.refresh,
        openLink: widget.openLink,
        leading: back,
      ),
      if (widget.locked)
        widget.settings?.call(context) ??
            const SettingsScreen(fleetDriverOnly: true),
    ];
    final index = _index.clamp(0, tabs.length - 1);
    return PopScope(
      // Locked, there is nowhere to go back to: back returns to Home first.
      canPop: !widget.locked,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && index != 0) setState(() => _index = 0);
      },
      child: Scaffold(
        key: const Key('fleet-driver-shell'),
        backgroundColor: AppColors.cream,
        body: IndexedStack(index: index, children: tabs),
        bottomNavigationBar: AppBottomNav(
          currentIndex: index,
          onTap: (i) => setState(() => _index = i),
          items: [
            AppBottomNavItem(
              icon: Icons.home_outlined,
              selectedIcon: Icons.home,
              label: l10n.home,
            ),
            AppBottomNavItem(
              icon: Icons.receipt_long_outlined,
              selectedIcon: Icons.receipt_long,
              label: l10n.fdrTabPayments,
            ),
            AppBottomNavItem(
              icon: Icons.directions_car_outlined,
              selectedIcon: Icons.directions_car,
              label: l10n.fdrTabPlate,
            ),
            if (widget.locked)
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

  /// Opened from the customer home with nothing to show yet (still loading,
  /// the read failed, or the driver record is gone): never a blank page.
  Widget _empty(BuildContext context, AppLocalizations l10n, Widget? back) {
    final controller = widget.controller;
    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(leading: back, title: Text(l10n.fdrTabPlate)),
      body: Center(
        child: controller.loading
            ? const CircularProgressIndicator(key: Key('fleet-driver-loading'))
            : Padding(
                padding: const EdgeInsets.all(AppSpacing.xl),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      controller.failed
                          ? l10n.fdrLoadFailed
                          : l10n.fdrPlateNone,
                      key: const Key('fleet-driver-empty'),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    OutlinedButton(
                      key: const Key('fleet-driver-retry'),
                      onPressed: () => unawaited(controller.refresh()),
                      child: Text(l10n.fltRetry),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

/// Makes the driver account of the signed-in person available below it and,
/// when their business shows its drivers Fleet and nothing else, shows
/// [FleetDriverShell] instead of [child] (the customer home).
///
/// For an account that signs in with a phone number only ([hold]) the first
/// answer is waited for behind a spinner, a few seconds at most, so a driver
/// never sees the marketplace flash by; everyone else gets [child] at once.
class FleetDriverHost extends StatefulWidget {
  const FleetDriverHost({
    super.key,
    required this.uid,
    required this.eligible,
    required this.child,
    this.hold = false,
    this.controller,
    this.openLink = _launchOutside,
    this.settings,
  });

  /// The signed-in account; null while signed out.
  final String? uid;

  /// Signed in for real, profile loaded, and no business or platform access.
  final bool eligible;

  /// Wait for the first answer before showing anything.
  final bool hold;
  final Widget child;

  /// Tests hand in a ready controller (then it is theirs to dispose).
  final FleetDriverController? controller;
  final DriverLinkOpener openLink;
  final WidgetBuilder? settings;

  @override
  State<FleetDriverHost> createState() => _FleetDriverHostState();
}

class _FleetDriverHostState extends State<FleetDriverHost>
    with WidgetsBindingObserver {
  late final FleetDriverController _controller =
      widget.controller ?? FleetDriverController();
  DateTime _lastRefresh = DateTime.fromMillisecondsSinceEpoch(0);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _sync();
  }

  @override
  void didUpdateWidget(FleetDriverHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.uid != oldWidget.uid || widget.eligible != oldWidget.eligible) {
      _sync();
    }
  }

  void _sync() {
    _lastRefresh = DateTime.now();
    unawaited(_controller.setAccount(widget.uid, eligible: widget.eligible));
  }

  /// Back from WhatsApp or the bank app: what is owed may have changed.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed || _controller.uid == null) return;
    final now = DateTime.now();
    if (now.difference(_lastRefresh) < const Duration(seconds: 20)) return;
    _lastRefresh = now;
    unawaited(_controller.refresh());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (widget.controller == null) _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        if (widget.eligible && _controller.home.lockedFleet != null) {
          return FleetDriverShell(
            controller: _controller,
            openLink: widget.openLink,
            settings: widget.settings,
          );
        }
        if (widget.eligible && widget.hold && !_controller.settled) {
          return const Scaffold(
            backgroundColor: AppColors.cream,
            body: Center(
              child: CircularProgressIndicator(key: Key('fleet-driver-hold')),
            ),
          );
        }
        return FleetDriverScope(controller: _controller, child: widget.child);
      },
    );
  }
}

/// The driver account, for the customer home below [FleetDriverHost].
class FleetDriverScope extends InheritedNotifier<FleetDriverController> {
  const FleetDriverScope({
    super.key,
    required FleetDriverController controller,
    required super.child,
  }) : super(notifier: controller);

  /// Null outside a host (a widget test of one screen).
  static FleetDriverController? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<FleetDriverScope>()?.notifier;
}

/// On the customer home of a driver whose business lets its drivers use the
/// rest of Laawol: one card per fleet business, "Your plate", what is owed,
/// Open. Nothing for anyone who is not a driver.
class FleetDriverHomeCard extends StatelessWidget {
  const FleetDriverHomeCard({super.key, this.padding = EdgeInsets.zero});

  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final controller = FleetDriverScope.maybeOf(context);
    if (controller == null || !controller.home.isDriver) {
      return const SizedBox.shrink();
    }
    final l10n = AppLocalizations.of(context)!;
    final home = controller.home;
    return Padding(
      padding: padding,
      child: Column(
        children: [
          for (final fleet in home.fleets)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: FleetCard(
                key: Key('fleet-driver-card-${fleet.businessId}'),
                title: l10n.fdrCardTitle(fleet.businessName),
                onTap: () => _open(context, controller),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        fleet.balance.owedCents > 0
                            ? l10n.fdrCardOwe(
                                fleetMoney(fleet.balance.owedCents),
                              )
                            : l10n.fdrPaidUp,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(
                              color: fleet.balance.lateCents > 0
                                  ? AppColors.errorRed
                                  : AppColors.ink,
                            ),
                      ),
                    ),
                    Text(
                      l10n.fdrCardOpen,
                      style: Theme.of(
                        context,
                      ).textTheme.titleSmall?.copyWith(color: AppColors.cobalt),
                    ),
                    const Icon(
                      Icons.chevron_right_rounded,
                      color: AppColors.cobalt,
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  void _open(BuildContext context, FleetDriverController controller) {
    // Over the tab bar, like every other full-screen flow of the home.
    Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute<void>(
        builder: (_) => FleetDriverShell(controller: controller, locked: false),
      ),
    );
  }
}

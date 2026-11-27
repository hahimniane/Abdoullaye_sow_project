import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../services/fleet_tabs.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'fleet_bank_tab.dart';
import 'fleet_car_screen.dart';
import 'fleet_cars_tab.dart';
import 'fleet_driver_screen.dart';
import 'fleet_drivers_tab.dart';
import 'fleet_needs_tab.dart';
import 'fleet_payments_tab.dart';
import 'fleet_settings_tab.dart';

/// Fleet on the phone (docs/FLEET.md sections 15 and 17): a business that
/// leases cars to drivers and collects the weekly or monthly rent. The same
/// shape as the website's Fleet page: tabs Needs you (first), Drivers, Plates,
/// Payments (with Bank, the Zelle deposits, beside it) and Paperwork; a gear
/// in the bar opens Fleet settings, for a Fleet admin only. Reached from one row on the business home, shown only to a person who holds
/// Fleet access; the screen checks again and shows nothing without it.
class FleetScreen extends StatefulWidget {
  const FleetScreen({
    super.key,
    required this.businessId,
    required this.access,
    this.source,
    this.service,
    this.controller,
    this.initialTab = FleetTab.needs,
    this.openDriverId,
    this.openCarId,
  });

  final String businessId;
  final FleetAccess access;

  /// Injected by tests; the real Firestore source by default.
  final FleetSource? source;
  final FleetService? service;

  /// Tests may hand in a ready controller.
  final FleetController? controller;

  /// The tab the page opens on (the business home opens Fleet on a tab).
  final FleetTab initialTab;

  /// A Fleet alert names one driver or plate: once Fleet has loaded, its page
  /// opens on top of the tab (once, and only if it exists).
  final String? openDriverId;
  final String? openCarId;

  @override
  State<FleetScreen> createState() => _FleetScreenState();
}

class _FleetScreenState extends State<FleetScreen>
    with SingleTickerProviderStateMixin {
  FleetController? _controller;
  TabController? _tabs;

  /// Payments shows the payments or the Bank (Zelle deposits); Needs you
  /// sends people to the Bank side.
  final _paySection = ValueNotifier<_PaySection>(_PaySection.payments);

  @override
  void initState() {
    super.initState();
    if (!widget.access.staff) return;
    _tabs = TabController(
      length: FleetTab.values.length,
      vsync: this,
      initialIndex: widget.initialTab.index,
    );
    _controller =
        widget.controller ??
        FleetController(
          businessId: widget.businessId,
          source: widget.source ?? FirestoreFleetSource(),
          service: widget.service ?? const FleetService(),
          access: widget.access,
        );
    _controller!.start();
    if ((widget.openDriverId ?? '').isNotEmpty ||
        (widget.openCarId ?? '').isNotEmpty) {
      _controller!.addListener(_openFocused);
      _openFocused();
    }
  }

  bool _focusDone = false;

  /// Opens the driver or plate an alert named, as soon as Fleet has loaded.
  void _openFocused() {
    final c = _controller;
    if (_focusDone || c == null || c.state.loading) return;
    _focusDone = true;
    c.removeListener(_openFocused);
    final data = c.state.data;
    final driverId = widget.openDriverId ?? '';
    final carId = widget.openCarId ?? '';
    final driver =
        driverId.isNotEmpty && data.drivers.any((d) => d.id == driverId);
    final car = carId.isNotEmpty && data.cars.any((x) => x.id == carId);
    if (!driver && !car) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (driver) {
        _openDriver(driverId);
      } else {
        _openCar(carId);
      }
    });
  }

  @override
  void dispose() {
    _controller?.removeListener(_openFocused);
    // A controller handed in belongs to its owner.
    if (widget.controller == null) _controller?.dispose();
    _tabs?.dispose();
    _paySection.dispose();
    super.dispose();
  }

  void _goTab(FleetTab tab) => _tabs?.animateTo(tab.index);

  void _goBank() {
    _paySection.value = _PaySection.bank;
    _goTab(FleetTab.payments);
  }

  void _openSettings() {
    final c = _controller!;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => Scaffold(
          backgroundColor: AppColors.cream,
          appBar: AppBar(
            title: Text(AppLocalizations.of(context)!.fltHomeSettings),
          ),
          body: FleetSettingsTab(controller: c),
        ),
      ),
    );
  }

  void _openDriver(String driverId) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FleetDriverScreen(
          controller: _controller!,
          driverId: driverId,
          onOpenCar: _openCar,
        ),
      ),
    );
  }

  void _openCar(String carId) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FleetCarScreen(
          controller: _controller!,
          carId: carId,
          onOpenDriver: _openDriver,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final controller = _controller;
    if (controller == null) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.fltTitle)),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              l10n.fltRefusalStaffOnly,
              key: const Key('fleet-no-access'),
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
    }
    final admin = widget.access.admin;
    final labels = {
      FleetTab.needs: l10n.fltHomeTabNeeds,
      FleetTab.drivers: l10n.fltTabDrivers,
      FleetTab.plates: l10n.fltTabPlates,
      FleetTab.payments: l10n.fltTabPayments,
      FleetTab.paperwork: l10n.fltHomeTabPaperwork,
    };
    final pages = <FleetTab, Widget>{
      FleetTab.needs: FleetNeedsTab(
        controller: controller,
        onOpenDriver: _openDriver,
        onOpenCar: _openCar,
        onGoBank: _goBank,
        onGoPaperwork: () => _goTab(FleetTab.paperwork),
      ),
      FleetTab.drivers: FleetDriversTab(
        controller: controller,
        onOpenDriver: _openDriver,
      ),
      FleetTab.plates: FleetCarsTab(
        controller: controller,
        onOpenCar: _openCar,
        paperwork: false,
      ),
      FleetTab.payments: _PaymentsHub(
        controller: controller,
        section: _paySection,
        onOpenDriver: _openDriver,
      ),
      FleetTab.paperwork: FleetCarsTab(
        controller: controller,
        onOpenCar: _openCar,
        paperwork: true,
      ),
    };
    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(
        title: Text(l10n.fltTitle),
        actions: [
          if (admin)
            IconButton(
              key: const Key('fleet-settings-gear'),
              tooltip: l10n.fltHomeSettings,
              icon: const Icon(Icons.settings_outlined),
              onPressed: _openSettings,
            ),
        ],
        bottom: TabBar(
          key: const Key('fleet-tabs'),
          controller: _tabs,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: [for (final t in FleetTab.values) Tab(text: labels[t])],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [for (final t in FleetTab.values) pages[t]!],
      ),
    );
  }
}

enum _PaySection { payments, bank }

/// The Payments tab: the month's payments, and beside them the Bank (Zelle
/// deposits, drivers' screenshots, take-backs) the website shows on the same
/// page. The Bank is read only once it is opened.
class _PaymentsHub extends StatefulWidget {
  const _PaymentsHub({
    required this.controller,
    required this.section,
    required this.onOpenDriver,
  });

  final FleetController controller;
  final ValueNotifier<_PaySection> section;
  final ValueChanged<String> onOpenDriver;

  @override
  State<_PaymentsHub> createState() => _PaymentsHubState();
}

class _PaymentsHubState extends State<_PaymentsHub> {
  bool _bankOpened = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ValueListenableBuilder<_PaySection>(
      valueListenable: widget.section,
      builder: (context, section, _) {
        if (section == _PaySection.bank) _bankOpened = true;
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                0,
              ),
              child: SizedBox(
                width: double.infinity,
                child: SegmentedButton<_PaySection>(
                  key: const Key('fleet-pay-section'),
                  showSelectedIcon: false,
                  segments: [
                    ButtonSegment(
                      value: _PaySection.payments,
                      label: Text(l10n.fltTabPayments),
                    ),
                    ButtonSegment(
                      value: _PaySection.bank,
                      label: Text(l10n.fltTabBank),
                    ),
                  ],
                  selected: {section},
                  onSelectionChanged: (v) => widget.section.value = v.first,
                ),
              ),
            ),
            Expanded(
              child: IndexedStack(
                index: section.index,
                children: [
                  FleetPaymentsTab(
                    controller: widget.controller,
                    onOpenDriver: widget.onOpenDriver,
                  ),
                  if (_bankOpened)
                    FleetBankTab(controller: widget.controller)
                  else
                    const SizedBox.shrink(),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

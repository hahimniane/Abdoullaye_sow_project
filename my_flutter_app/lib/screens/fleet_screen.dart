import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import 'fleet_bank_tab.dart';
import 'fleet_car_screen.dart';
import 'fleet_cars_tab.dart';
import 'fleet_driver_screen.dart';
import 'fleet_drivers_tab.dart';
import 'fleet_payments_tab.dart';
import 'fleet_settings_tab.dart';

/// Fleet on the phone (docs/FLEET.md): a business that leases cars to drivers
/// and collects the weekly or monthly rent. Payments, Drivers, Plates (with the
/// paperwork list), Bank (Zelle deposits) and, for a Fleet admin, Settings.
/// Reached from one row on the business home, shown only to a person who holds
/// Fleet access; the screen checks again and shows nothing without it.
class FleetScreen extends StatefulWidget {
  const FleetScreen({
    super.key,
    required this.businessId,
    required this.access,
    this.source,
    this.service,
    this.controller,
  });

  final String businessId;
  final FleetAccess access;

  /// Injected by tests; the real Firestore source by default.
  final FleetSource? source;
  final FleetService? service;

  /// Tests may hand in a ready controller.
  final FleetController? controller;

  @override
  State<FleetScreen> createState() => _FleetScreenState();
}

class _FleetScreenState extends State<FleetScreen> {
  FleetController? _controller;

  @override
  void initState() {
    super.initState();
    if (!widget.access.staff) return;
    _controller =
        widget.controller ??
        FleetController(
          businessId: widget.businessId,
          source: widget.source ?? FirestoreFleetSource(),
          service: widget.service ?? const FleetService(),
          access: widget.access,
        );
    _controller!.start();
  }

  @override
  void dispose() {
    // A controller handed in belongs to its owner.
    if (widget.controller == null) _controller?.dispose();
    super.dispose();
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
    final tabs = <(String, Widget)>[
      (
        l10n.fltTabPayments,
        FleetPaymentsTab(controller: controller, onOpenDriver: _openDriver),
      ),
      (
        l10n.fltTabDrivers,
        FleetDriversTab(controller: controller, onOpenDriver: _openDriver),
      ),
      (
        l10n.fltTabPlates,
        FleetCarsTab(controller: controller, onOpenCar: _openCar),
      ),
      (l10n.fltTabBank, FleetBankTab(controller: controller)),
      if (admin)
        (l10n.fltTabSettings, FleetSettingsTab(controller: controller)),
    ];
    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        backgroundColor: AppColors.cream,
        appBar: AppBar(
          title: Text(l10n.fltTitle),
          bottom: TabBar(
            key: const Key('fleet-tabs'),
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [for (final t in tabs) Tab(text: t.$1)],
          ),
        ),
        body: TabBarView(children: [for (final t in tabs) t.$2]),
      ),
    );
  }
}

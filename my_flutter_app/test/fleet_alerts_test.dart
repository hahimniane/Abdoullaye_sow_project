import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/notification_preferences.dart';
import 'package:my_flutter_app/screens/account_profile_screen.dart'
    show FleetAlertsChoice;
import 'package:my_flutter_app/screens/fleet_screen.dart';
import 'package:my_flutter_app/services/fleet.dart';
import 'package:my_flutter_app/services/fleet_service.dart';
import 'package:my_flutter_app/services/fleet_tabs.dart';
import 'package:my_flutter_app/services/notification_routing.dart';
import 'package:my_flutter_app/services/staff_activity_alerts.dart';

import 'fixtures/fake_fleet.dart';

// Fleet alerts to admins, client side (docs/FLEET.md section 18): the
// setting, who sees it, and where a tap on an alert lands. Made-up data.
void main() {
  group('the fleetAlerts preference', () {
    test('missing or unknown reads as everything', () {
      expect(NotificationPreferences.fromMap(null).fleetAlerts, 'all');
      expect(NotificationPreferences.fromMap({}).fleetAlerts, 'all');
      expect(
        NotificationPreferences.fromMap({
          'fleetAlerts': 'sometimes',
        }).fleetAlerts,
        'all',
      );
      expect(
        NotificationPreferences.fromMap({'fleetAlerts': 7}).fleetAlerts,
        'all',
      );
    });

    test('the three values round-trip through the saved map', () {
      for (final v in ['all', 'needs', 'off']) {
        final saved = NotificationPreferences.defaults
            .copyWith(fleetAlerts: v)
            .toMap();
        expect(saved['fleetAlerts'], v);
        expect(NotificationPreferences.fromMap(saved).fleetAlerts, v);
      }
      // Changing another switch keeps it.
      final kept = NotificationPreferences.defaults
          .copyWith(fleetAlerts: 'needs')
          .copyWith(parkedCarAlerts: false);
      expect(kept.fleetAlerts, 'needs');
    });
  });

  group('who sees the setting', () {
    bool shown({
      bool isStaff = true,
      List<String> services = const ['fleet'],
      List<String> permissions = const ['fleet_admin'],
      String businessId = 'biz',
    }) => showFleetAlertsSwitch(
      isStaff: isStaff,
      services: services,
      permissions: permissions,
      businessId: businessId,
    );

    test('owners and Fleet admins of a business with Fleet', () {
      expect(shown(), isTrue);
      expect(shown(isStaff: false, permissions: []), isTrue); // owner
      expect(shown(permissions: ['fleet']), isFalse); // Fleet staff only
      expect(shown(permissions: ['parking']), isFalse);
      expect(shown(services: ['carParking']), isFalse);
      expect(shown(businessId: ' '), isFalse);
    });
  });

  group('the setting control', () {
    Future<void> pump(
      WidgetTester tester,
      String lang,
      String value,
      ValueChanged<String> onChanged,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(320, 800);
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          locale: Locale(lang),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: FleetAlertsChoice(value: value, onChanged: onChanged),
          ),
        ),
      );
    }

    testWidgets('English: three choices, Everything when unset', (t) async {
      String? picked;
      await pump(t, 'en', 'all', (v) => picked = v);
      expect(find.text('Fleet alerts'), findsOneWidget);
      expect(find.text('Everything'), findsOneWidget);
      expect(find.text('Only what needs me'), findsOneWidget);
      expect(find.text('Off'), findsOneWidget);
      expect(
        find.text(
          'New plates, drivers and payments, grouped; anything that needs you at once.',
        ),
        findsOneWidget,
      );
      expect(
        t
            .widget<ChoiceChip>(find.byKey(const Key('fleet-alerts-all')))
            .selected,
        isTrue,
      );
      await t.tap(find.byKey(const Key('fleet-alerts-needs')));
      expect(picked, 'needs');
      await t.tap(find.byKey(const Key('fleet-alerts-off')));
      expect(picked, 'off');
      expect(t.takeException(), isNull);
    });

    testWidgets('French at 320 wide fits', (t) async {
      await pump(t, 'fr', 'needs', (_) {});
      expect(find.text('Alertes Flotte'), findsOneWidget);
      expect(find.text('Tout'), findsOneWidget);
      expect(find.text('Seulement ce qui est à traiter'), findsOneWidget);
      expect(find.text('Désactivées'), findsOneWidget);
      expect(
        t
            .widget<ChoiceChip>(find.byKey(const Key('fleet-alerts-needs')))
            .selected,
        isTrue,
      );
      expect(t.takeException(), isNull);
    });
  });

  group('tap routing', () {
    const business = NotificationAudience.business;
    FleetRouteArguments route(Map<String, dynamic> extra) {
      final r = routeForNotificationData({
        'type': 'fleet_alert',
        'businessId': 'biz-1',
        ...extra,
      }, audience: business);
      expect(r?.name, '/fleet');
      return r!.arguments as FleetRouteArguments;
    }

    test('what needs you opens Needs you', () {
      for (final kind in [
        'deposit_waiting',
        'claim_needs_office',
        'bank_took_back',
      ]) {
        final a = route({
          'fleetKind': kind,
          'fleetTab': 'needs',
          'driverId': 'd1',
        });
        expect(a.tab, FleetTab.needs, reason: kind);
        expect(a.driverId, isNull);
        expect(a.carId, isNull);
      }
    });

    test('a new plate opens that plate', () {
      final a = route({
        'fleetKind': 'plate_added',
        'fleetTab': 'plates',
        'carId': 'c1',
      });
      expect(a.tab, FleetTab.plates);
      expect(a.carId, 'c1');
      expect(route({'fleetKind': 'plate_added'}).carId, isNull);
    });

    test('a new driver opens that driver', () {
      final a = route({
        'fleetKind': 'driver_added',
        'fleetTab': 'drivers',
        'driverId': 'd1',
      });
      expect(a.tab, FleetTab.drivers);
      expect(a.driverId, 'd1');
    });

    test('a payment opens its driver, or Payments with none', () {
      final a = route({
        'fleetKind': 'payment_recorded',
        'fleetTab': 'payments',
        'driverId': 'd2',
        'paymentId': 'p1',
      });
      expect(a.driverId, 'd2');
      final b = route({'fleetKind': 'payment_recorded'});
      expect(b.tab, FleetTab.payments);
      expect(b.driverId, isNull);
    });

    test('a bank check opens Payments; unknown kinds use fleetTab', () {
      expect(route({'fleetKind': 'bank_matched'}).tab, FleetTab.payments);
      expect(
        route({'fleetKind': 'new_thing', 'fleetTab': 'paperwork'}).tab,
        FleetTab.paperwork,
      );
      expect(route({'fleetKind': 'new_thing'}).tab, FleetTab.needs);
    });

    test('only a business opens it', () {
      expect(routeForNotificationData({'type': 'fleet_alert'}), isNull);
    });
  });

  group('FleetScreen opens the driver or plate once loaded', () {
    final data = FleetData(
      drivers: const [
        FleetDriver(id: 'd1', name: 'Amy Bah', phone: '+13475550101'),
      ],
      cars: const [FleetCar(id: 'c1', plate: 'T123456C', company: 'Landa')],
    );

    Future<void> pump(
      WidgetTester tester, {
      String? driverId,
      String? carId,
      FleetTab tab = FleetTab.needs,
    }) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 3600);
      addTearDown(tester.view.reset);
      final source = FakeFleetSource(data: data);
      final backend = FakeFleetBackend(source);
      final controller = FleetController(
        businessId: 'biz1',
        source: source,
        service: backend.service,
        access: const FleetAccess(staff: true, admin: true),
      );
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: FleetScreen(
            businessId: 'biz1',
            access: const FleetAccess(staff: true, admin: true),
            controller: controller,
            initialTab: tab,
            openDriverId: driverId,
            openCarId: carId,
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('a driver', (t) async {
      await pump(t, driverId: 'd1', tab: FleetTab.drivers);
      expect(find.text('Amy Bah'), findsWidgets);
      expect(find.byType(BackButton), findsOneWidget);
    });

    testWidgets('a plate', (t) async {
      await pump(t, carId: 'c1', tab: FleetTab.plates);
      expect(find.byType(BackButton), findsOneWidget);
      expect(find.text('T123456C'), findsWidgets);
    });

    testWidgets('an unknown id stays on the tab', (t) async {
      await pump(t, driverId: 'gone');
      expect(find.byType(BackButton), findsNothing);
    });
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/fleet_screen.dart';
import 'package:my_flutter_app/services/fleet.dart';
import 'package:my_flutter_app/services/fleet_home.dart';
import 'package:my_flutter_app/services/fleet_service.dart';
import 'package:my_flutter_app/services/fleet_tabs.dart';
import 'package:my_flutter_app/services/lot_ledger.dart'
    show setMoneyDisplayLanguage;

import 'fixtures/fake_fleet.dart';

/// The Fleet page's "Needs you" list (docs/FLEET.md section 15), mirroring the
/// website's `needsItems`, and the page's tabs. Made-up people and plates.

const _today = '2026-11-10';

FleetData _data() => FleetData(
  drivers: const [
    FleetDriver(id: 'd1', name: 'Test Driver One', phone: '+15555550101'),
    FleetDriver(id: 'd2', name: 'Test Driver Two', phone: '+15555550102'),
  ],
  cars: const [
    // Registration ran out 5 days ago; diamond fine.
    FleetCar(
      id: 'c1',
      plate: 'TEST001',
      registrationExpiry: '2026-11-05',
      diamondExpiry: '2027-06-01',
    ),
    // Diamond runs out in 10 days; registration not entered.
    FleetCar(id: 'c2', plate: 'TEST002', diamondExpiry: '2026-11-20'),
    // Free plate; the last driver gave it back 30 days ago on a monthly fee.
    FleetCar(
      id: 'c3',
      plate: 'TEST003',
      registrationExpiry: '2027-06-01',
      diamondExpiry: '2027-06-01',
    ),
    // Free plate nobody ever had; both dates fine.
    FleetCar(
      id: 'c4',
      plate: 'TEST004',
      registrationExpiry: '2027-06-01',
      diamondExpiry: '2027-06-01',
    ),
  ],
  assignments: const [
    FleetAssignment(
      id: 'a1',
      carId: 'c1',
      driverId: 'd1',
      startDayKey: '2026-01-01',
      rentCents: 90000,
      dueDay: 1,
    ),
    FleetAssignment(
      id: 'a2',
      carId: 'c3',
      driverId: 'd2',
      startDayKey: '2026-01-01',
      endDayKey: '2026-10-11',
      rentCents: 80000,
      dueDay: 1,
    ),
  ],
  bills: const [
    FleetBill(
      id: 'b1',
      driverId: 'd1',
      kind: 'rent',
      label: 'Plate fee Nov 2026',
      dueDayKey: '2026-11-01',
      amountCents: 90000,
    ),
  ],
);

List<FleetNeedsItem> _items({
  FleetData? data,
  List<FleetClaim> claims = const [],
  FleetBankStatus? bank,
}) {
  final d = data ?? _data();
  return fleetNeedsItems(
    data: d,
    index: FleetIndex(d),
    todayKey: _today,
    claims: claims,
    bank: bank,
  );
}

FleetBankStatus _bank({
  List<FleetWaitingDeposit> waiting = const [],
  List<FleetRemovedDeposit> removed = const [],
}) => FleetBankStatus(waiting: waiting, removed: removed);

void main() {
  group('fleetNeedsItems', () {
    test(
      'lists a late driver, idle plates and paperwork, most money first',
      () {
        final items = _items();
        expect(items.map((i) => i.key).toList(), [
          'late-d1',
          'idle-c3',
          'paper-c1-registration',
          'paper-c2-diamond',
          'idle-c2',
          'idle-c4',
          'missing-paper',
        ]);
        final late = items.first as FleetNeedsLate;
        expect(late.owedCents, 90000);
        expect(late.plate, 'TEST001');
        expect(late.active, isTrue);
        expect(fleetNeedsCount(items), 7);
      },
    );

    test('an idle plate: days since it was given back and the fee missed', () {
      final idle = _items().whereType<FleetNeedsIdle>().toList();
      final c3 = idle.firstWhere((i) => i.carId == 'c3');
      expect(c3.idleDays, 30);
      // $800 a month over 30 days is one month of fees missed.
      expect(c3.missedCents, 80000);
      final c4 = idle.firstWhere((i) => i.carId == 'c4');
      expect(c4.idleDays, isNull);
      expect(c4.missedCents, 0);
    });

    test('a weekly fee is prorated over seven days', () {
      final data = FleetData(
        cars: const [FleetCar(id: 'c1', plate: 'TEST001')],
        assignments: const [
          FleetAssignment(
            id: 'a1',
            carId: 'c1',
            driverId: 'd1',
            startDayKey: '2026-01-01',
            endDayKey: '2026-11-03',
            rentCents: 70000,
            period: 'weekly',
          ),
        ],
      );
      final idle = fleetIdlePlates(data, FleetIndex(data), _today).single;
      expect(idle.idleDays, 7);
      expect(idle.missedCents, 70000);
    });

    test(
      'paperwork: past or within 30 days; later is quiet; missing is one line',
      () {
        final items = _items();
        final paper = items.whereType<FleetNeedsPaper>().toList();
        expect(paper.length, 2);
        // The expired one is first (its deadline is the soonest).
        expect(paper.first.paper, FleetPaper.registration);
        expect(paper.first.daysLeft, -5);
        expect(paper.last.paper, FleetPaper.diamond);
        expect(paper.last.daysLeft, 10);
        final missing = items.whereType<FleetNeedsMissingPaper>().single;
        expect(missing.count, 1);
        // 2027 dates are more than 30 days away: not listed.
        expect(items.any((i) => i.key == 'paper-c3-diamond'), isFalse);
      },
    );

    test(
      'bank take-backs and office claims come before a deposit of the same money',
      () {
        final items = _items(
          bank: _bank(
            waiting: const [
              FleetWaitingDeposit(
                id: 'cr1',
                amountCents: 120000,
                senderName: 'SOMEONE TEST',
                dateKey: '2026-11-09',
              ),
            ],
            removed: const [
              FleetRemovedDeposit(
                paymentId: 'p1',
                driverId: 'd1',
                amountCents: 120000,
                paidDayKey: '2026-11-08',
              ),
            ],
          ),
          claims: const [
            FleetClaim(
              id: 'cl1',
              driverId: 'd2',
              state: FleetClaimState.office,
              amountCents: 120000,
            ),
          ],
        );
        expect(items.take(3).map((i) => i.key).toList(), [
          'removed-p1',
          'claim-cl1',
          'deposit-cr1',
        ]);
        final removed = items.first as FleetNeedsRemoved;
        expect(removed.name, 'Test Driver One');
        expect((items[1] as FleetNeedsClaim).name, 'Test Driver Two');
      },
    );

    test(
      'a claim still talking to the driver is not listed; waiting on the bank is, once a deposit matches',
      () {
        const waiting = FleetWaitingDeposit(id: 'cr1', amountCents: 5000);
        const talking = FleetClaim(
          id: 'a',
          driverId: 'd1',
          state: FleetClaimState.askingAmount,
          amountCents: 5000,
        );
        const waitsNoMatch = FleetClaim(
          id: 'b',
          driverId: 'd1',
          state: FleetClaimState.waitingBank,
          amountCents: 7000,
        );
        const waitsMatch = FleetClaim(
          id: 'c',
          driverId: 'd1',
          state: FleetClaimState.waitingBank,
          amountCents: 5000,
        );
        final keys = _items(
          claims: [talking, waitsNoMatch, waitsMatch],
          bank: _bank(waiting: [waiting]),
        ).map((i) => i.key);
        expect(keys, contains('claim-c'));
        expect(keys, isNot(contains('claim-a')));
        expect(keys, isNot(contains('claim-b')));
        final claim = _items(
          claims: [waitsMatch],
          bank: _bank(waiting: [waiting]),
        ).whereType<FleetNeedsClaim>().single;
        expect(claim.match, isTrue);
      },
    );

    test('a deposit still pending at the bank is not listed', () {
      final items = _items(
        bank: _bank(
          waiting: const [
            FleetWaitingDeposit(id: 'cr1', amountCents: 5000, pending: true),
          ],
        ),
      );
      expect(items.any((i) => i is FleetNeedsDeposit), isFalse);
    });

    test('a claim with no driver shows the phone it came from', () {
      final claim = _items(
        claims: const [
          FleetClaim(
            id: 'x',
            fromPhone: '+15555550199',
            state: FleetClaimState.office,
          ),
        ],
      ).whereType<FleetNeedsClaim>().single;
      expect(claim.name, '+15555550199');
      expect(claim.driverId, '');
    });

    test(
      'a driver who left but still owes late money is listed as not active',
      () {
        final data = FleetData(
          drivers: const [
            FleetDriver(id: 'd1', name: 'Test Gone', status: 'left'),
          ],
          bills: const [
            FleetBill(
              id: 'b1',
              driverId: 'd1',
              kind: 'rent',
              label: 'x',
              dueDayKey: '2026-10-01',
              amountCents: 50000,
            ),
          ],
        );
        final late = _items(data: data).whereType<FleetNeedsLate>().single;
        expect(late.active, isFalse);
      },
    );

    test('nothing to do is an empty list', () {
      expect(_items(data: FleetData.empty), isEmpty);
      expect(fleetNeedsCount(const []), 0);
    });
  });

  group('the Fleet page', () {
    FleetController controllerFor(
      FakeFleetBackend backend,
      FakeFleetSource s,
    ) => FleetController(
      businessId: 'biz1',
      source: s,
      service: backend.service,
      access: const FleetAccess(staff: true, admin: true),
      clock: () => DateTime.utc(2026, 11, 10, 17),
    );

    Future<(FakeFleetBackend, FleetController)> pump(
      WidgetTester tester, {
      FleetTab initialTab = FleetTab.needs,
      String language = 'en',
      double width = 390,
      bool admin = true,
    }) async {
      final source = FakeFleetSource(
        data: _data(),
        business: {
          'fleet': {
            'enabled': true,
            'settings': {
              'whatsapp': {'enabled': true},
            },
          },
        },
      );
      final backend = FakeFleetBackend(source);
      backend.bankAnswer = {
        'success': true,
        'bank': {'connected': true},
        'waiting': [
          {
            'id': 'cr1',
            'amountCents': 123400,
            'senderName': 'SOMEONE TEST',
            'dateKey': '2026-11-09',
          },
        ],
        'removed': [],
      };
      final controller = controllerFor(backend, source);
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(width, 3600);
      addTearDown(tester.view.reset);
      setMoneyDisplayLanguage(language);
      addTearDown(() => setMoneyDisplayLanguage('en'));
      await tester.pumpWidget(
        MaterialApp(
          locale: Locale(language),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: FleetScreen(
            businessId: 'biz1',
            access: FleetAccess(staff: true, admin: admin),
            controller: controller,
            initialTab: initialTab,
          ),
        ),
      );
      await tester.pumpAndSettle();
      return (backend, controller);
    }

    testWidgets('opens on Needs you, tabs in the website\'s order', (
      tester,
    ) async {
      await pump(tester);
      final tabBar = tester.widget<TabBar>(find.byKey(const Key('fleet-tabs')));
      expect(
        [for (final t in tabBar.tabs) (t as Tab).text],
        ['Needs you', 'Drivers', 'Plates', 'Payments', 'Paperwork'],
      );
      expect(find.byKey(const Key('fleet-needs-title')), findsOneWidget);
      expect(find.byKey(const Key('fleet-needs-row-late-d1')), findsOneWidget);
      expect(
        find.byKey(const Key('fleet-needs-row-deposit-cr1')),
        findsOneWidget,
      );
      // The deposit's money ($1,234) outweighs the late driver's ($900).
      final deposit = tester.getTopLeft(
        find.byKey(const Key('fleet-needs-row-deposit-cr1')),
      );
      final late = tester.getTopLeft(
        find.byKey(const Key('fleet-needs-row-late-d1')),
      );
      expect(deposit.dy, lessThan(late.dy));
    });

    testWidgets('initialTab opens the page on that tab', (tester) async {
      await pump(tester, initialTab: FleetTab.paperwork);
      expect(find.byKey(const Key('fleet-needs-title')), findsNothing);
      expect(find.byKey(const Key('fleet-car-row-c1')), findsOneWidget);
      // Paperwork lists the plates with a driver by default.
      expect(find.text('Plates with a driver (1)'), findsOneWidget);
    });

    testWidgets('a deposit on Needs you opens the Bank, still reachable', (
      tester,
    ) async {
      await pump(tester);
      await tester.tap(find.byKey(const Key('fleet-needs-action-deposit-cr1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('fleet-deposit-pay-cr1')), findsOneWidget);
    });

    testWidgets('a late driver: remind over WhatsApp, or open the driver', (
      tester,
    ) async {
      final (backend, _) = await pump(tester);
      await tester.tap(find.byKey(const Key('fleet-needs-remind-d1')));
      await tester.pumpAndSettle();
      expect(backend.of('whatsapp_remind_driver').single['driverId'], 'd1');
      await tester.tap(find.byKey(const Key('fleet-needs-action-late-d1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('fleet-driver-remind')), findsOneWidget);
    });

    testWidgets('an idle plate and a paper date open the plate', (
      tester,
    ) async {
      await pump(tester);
      await tester.tap(find.byKey(const Key('fleet-needs-action-idle-c3')));
      await tester.pumpAndSettle();
      expect(find.text('TEST003'), findsWidgets);
    });

    testWidgets('"See which" goes to the Paperwork tab', (tester) async {
      await pump(tester);
      final see = find.byKey(const Key('fleet-needs-action-missing-paper'));
      await tester.ensureVisible(see);
      await tester.tap(see);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('fleet-needs-title')), findsNothing);
      expect(find.byKey(const Key('fleet-car-row-c1')), findsOneWidget);
    });

    testWidgets('a business with nothing to do says so', (tester) async {
      final source = FakeFleetSource(
        data: FleetData.empty,
        business: {
          'fleet': {'enabled': true},
        },
      );
      final backend = FakeFleetBackend(source);
      backend.bankAnswer = {
        'success': true,
        'bank': {'connected': true},
      };
      final controller = controllerFor(backend, source);
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: FleetScreen(
            businessId: 'biz1',
            access: const FleetAccess(staff: true, admin: true),
            controller: controller,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('fleet-needs-empty')), findsOneWidget);
      expect(find.text('All caught up'), findsOneWidget);
    });

    testWidgets('the gear opens Fleet settings for an admin only', (
      tester,
    ) async {
      await pump(tester, admin: false);
      expect(find.byKey(const Key('fleet-settings-gear')), findsNothing);
    });

    testWidgets('French on a 320 px phone: Needs you fits', (tester) async {
      await pump(tester, language: 'fr', width: 320);
      expect(find.text('À faire'), findsWidgets);
      expect(find.byKey(const Key('fleet-needs-row-late-d1')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

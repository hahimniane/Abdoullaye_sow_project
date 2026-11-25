import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/fleet.dart';
import 'package:my_flutter_app/services/fleet_driver_app.dart';
import 'package:my_flutter_app/services/fleet_driver_service.dart';

import 'fixtures/fake_fleet_driver.dart';

/// A Fleet driver's own account (docs/FLEET.md section 11): reading the
/// server's answer, what the screens say with it, and the loader that keeps a
/// copy on the phone. Made-up data only.
void main() {
  group('DriverHome', () {
    test('reads the answer into the driver\'s business, money and plate', () {
      final home = DriverHome.fromMap(driverHomeAnswer(creditCents: 1500));
      expect(home.isDriver, isTrue);
      expect(home.todayKey, '2026-12-05');
      expect(home.proofWhatsApp, '+16465550199');
      final f = home.fleets.single;
      expect(f.businessName, 'Dala Fleet');
      expect(f.onlyFleet, isTrue);
      expect(f.zelleHandle, 'pay@dala.test');
      expect(f.driverName, 'Awa Test');
      expect(f.balance.owedCents, 42500);
      expect(f.balance.lateCents, 40000);
      expect(f.balance.creditCents, 1500);
      expect(f.openBills.map((b) => b.id), ['b-dec', 'b-fee']);
      expect(f.plates.single.plate, 'T100000C');
      expect(f.plates.single.driverOwnsCar, isTrue);
      expect(f.payments.map((p) => p.shownMethod), ['zelle', 'import']);
      expect(f.claims.single.state, DriverClaimState.checking);
      expect(home.lockedFleet?.businessId, 'biz-dala');
    });

    test('knows when the fleet business also ships packages', () {
      DriverFleet f(Map<String, dynamic> a) =>
          DriverHome.fromMap(a).fleets.single;
      final plain = f(driverHomeAnswer());
      expect(plain.shipsPackages, isFalse);
      expect(plain.takesPackageRequests, isFalse);
      final both = f(driverHomeAnswer(ships: true, sendSlug: 'dala-ship'));
      expect(both.shipsPackages, isTrue);
      expect(both.sendPackageSlug, 'dala-ship');
      final noForm = f(driverHomeAnswer(ships: true));
      expect(noForm.shipsPackages, isTrue);
      expect(noForm.takesPackageRequests, isFalse);
      // A link without the service is nothing.
      final a = driverHomeAnswer();
      ((a['fleets'] as List).single as Map)['shipping'] = {
        'enabled': false,
        'sendSlug': 'stray',
      };
      expect(f(a).takesPackageRequests, isFalse);
    });

    test('is nobody for a customer, a bad answer or an empty one', () {
      expect(DriverHome.fromMap(notADriverAnswer()).isDriver, isFalse);
      expect(DriverHome.fromMap(const {}).isDriver, isFalse);
      expect(
        DriverHome.fromMap(const {
          'fleets': [
            {'businessName': 'No id'},
            'junk',
          ],
        }).isDriver,
        isFalse,
      );
      expect(DriverHome.none.lockedFleet, isNull);
    });

    test('locks only to a business that shows its drivers Fleet alone, and '
        'the one that is owed comes first', () {
      final open = DriverHome.fromMap(driverHomeAnswer(onlyFleet: false));
      expect(open.isDriver, isTrue);
      expect(open.lockedFleet, isNull);

      final a = driverHomeAnswer(businessId: 'a', owedCents: 0, lateCents: 0);
      final b = driverHomeAnswer(businessId: 'b');
      final two = DriverHome.fromMap({
        ...a,
        'fleets': [...(a['fleets'] as List), ...(b['fleets'] as List)],
      });
      expect(two.lockedFleet?.businessId, 'b');
    });

    test('survives being kept on the phone and read back', () {
      final answer = driverHomeAnswer();
      final back = DriverHome.decode(DriverHome.encode(answer));
      expect(back?.fleets.single.balance.owedCents, 42500);
      expect(back?.proofWhatsApp, '+16465550199');
      // "Not a driver" is kept as an answer too.
      expect(DriverHome.decode(DriverHome.encode(const {}))?.isDriver, isFalse);
      expect(DriverHome.decode(null), isNull);
      expect(DriverHome.decode(''), isNull);
      expect(DriverHome.decode('not json'), isNull);
      expect(DriverHome.decode('[1]'), isNull);
    });
  });

  group('what the screens say', () {
    DriverFleet fleet(Map<String, dynamic> a) =>
        DriverHome.fromMap(a).fleets.single;

    test('late names the oldest late day; due the next one; else nothing', () {
      expect(driverOwe(fleet(driverHomeAnswer()), '2026-12-05'), (
        state: DriverOwe.late,
        cents: 42500,
        dayKey: '2026-12-01',
      ));
      expect(
        driverOwe(
          fleet(driverHomeAnswer(owedCents: 2500, lateCents: 0)),
          '2026-11-30',
        ),
        (state: DriverOwe.due, cents: 2500, dayKey: '2026-12-08'),
      );
      expect(
        driverOwe(
          fleet(driverHomeAnswer(owedCents: 0, lateCents: 0)),
          '2026-12-05',
        ),
        (state: DriverOwe.nothing, cents: 0, dayKey: ''),
      );
    });

    test('a bill is a plate fee for its month or week, or what it is', () {
      const month = FleetBill(
        id: 'm',
        periodFrom: '2026-12-01',
        periodTo: '2026-12-31',
      );
      const week = FleetBill(
        id: 'w',
        periodFrom: '2026-12-07',
        periodTo: '2026-12-13',
      );
      const startMonth = FleetBill(
        id: 's',
        periodFrom: '2026-12-10',
        periodTo: '2026-12-31',
      );
      expect(driverBillPeriod(month), 'Dec 2026');
      expect(driverBillPeriod(month, language: 'fr'), 'déc. 2026');
      expect(driverBillPeriod(week), 'Dec 7, 2026 - Dec 13, 2026');
      expect(driverBillPeriod(startMonth), 'Dec 2026');
      expect(driverBillPeriod(const FleetBill(id: 'x')), '');
      expect(driverBillKind(month), DriverBillKind.plateFee);
      expect(
        driverBillKind(const FleetBill(id: 'f', kind: 'late_fee')),
        DriverBillKind.lateFee,
      );
      expect(
        driverBillKind(const FleetBill(id: 't', kind: 'ticket')),
        DriverBillKind.ticket,
      );
      expect(
        driverBillKind(const FleetBill(id: 'c', kind: 'charge')),
        DriverBillKind.charge,
      );
    });

    test('a bill is paid, waived, late or open', () {
      const today = '2026-12-05';
      FleetBill b(String status, String due, {int paid = 0}) => FleetBill(
        id: 'b',
        status: status,
        dueDayKey: due,
        amountCents: 40000,
        paidCents: paid,
      );
      expect(
        driverBillState(b('paid', '2026-11-01'), today),
        DriverBillState.paid,
      );
      expect(
        driverBillState(b('waived', '2026-11-01'), today),
        DriverBillState.waived,
      );
      expect(
        driverBillState(b('open', '2026-12-01'), today),
        DriverBillState.late,
      );
      expect(
        driverBillState(b('open', '2026-12-05'), today),
        DriverBillState.open,
      );
      expect(
        driverBillState(b('open', '2026-12-01', paid: 40000), today),
        DriverBillState.paid,
      );
    });

    test('the worst paper of a plate leads', () {
      const today = '2026-12-05';
      expect(
        driverPlateWorst(
          const DriverPlate(
            registrationExpiry: '2027-06-01',
            diamondExpiry: '2026-12-20',
          ),
          today,
        ),
        FleetExpiry.soon,
      );
      expect(
        driverPlateWorst(
          const DriverPlate(
            registrationExpiry: '2026-11-01',
            diamondExpiry: '2027-12-20',
          ),
          today,
        ),
        FleetExpiry.expired,
      );
      expect(driverPlateWorst(const DriverPlate(), today), FleetExpiry.missing);
    });

    test('days read month first in English and the French way in French', () {
      expect(driverDayLabel('2026-12-01'), 'Dec 1, 2026');
      expect(driverDayLabel('2026-12-01', language: 'fr'), '1er déc. 2026');
      expect(driverDayLabel('2026-08-15', language: 'fr'), '15 août 2026');
      expect(driverDayLabel('nope', language: 'fr'), '');
      expect(driverDayLabel('2026-13-40', language: 'fr'), '');
      expect(driverDayOfMonth(1), '1');
      expect(driverDayOfMonth(1, language: 'fr'), '1er');
      expect(driverDayOfMonth(15, language: 'fr'), '15');
      expect(driverWeekdayName(1), 'Monday');
      expect(driverWeekdayName(7, language: 'fr'), 'dimanche');
      expect(driverWeekdayName(0), 'Monday');
    });

    test('the screenshot goes to Laawol on WhatsApp, text ready', () {
      final uri = driverProofWhatsAppUri('+1 (646) 555-0199', 'Hi & bye');
      expect(uri.toString(), 'https://wa.me/16465550199?text=Hi+%26+bye');
      expect(driverProofWhatsAppUri('', 'x'), isNull);
      expect(driverProofWhatsAppUri('12', 'x'), isNull);
      expect(driverPhoneLabel('+16465550199'), '+1 (646) 555-0199');
      expect(driverPhoneLabel('+224620000000'), '+224620000000');
    });
  });

  group('FleetDriverController', () {
    test('shows the kept copy at once, then the server\'s answer, and keeps '
        'it for next time', () async {
      final cache = MemoryDriverHomeCache()
        ..kept['u1'] = DriverHome.encode(driverHomeAnswer(owedCents: 99900));
      final gate = Completer<Map<String, dynamic>>();
      final service = FakeFleetDriverService(() => gate.future);
      final c = FleetDriverController(service: service, cache: cache);
      addTearDown(c.dispose);
      final seen = <int>[];
      c.addListener(
        () => seen.add(
          c.home.isDriver ? c.home.fleets.single.balance.owedCents : -1,
        ),
      );
      final started = c.setAccount('u1', eligible: true);
      await pumpEventQueue();
      expect(c.home.fleets.single.balance.owedCents, 99900);
      expect(c.settled, isTrue);
      expect(c.loading, isTrue);
      gate.complete(driverHomeAnswer());
      await started;
      expect(c.home.fleets.single.balance.owedCents, 42500);
      expect(c.loading, isFalse);
      expect(c.answered, isTrue);
      expect(seen.first, 99900);
      expect(
        DriverHome.decode(cache.kept['u1'])?.fleets.single.balance.owedCents,
        42500,
      );
    });

    test('a failed refresh keeps what was on screen and says so', () async {
      final cache = MemoryDriverHomeCache()
        ..kept['u1'] = DriverHome.encode(driverHomeAnswer());
      final service = FakeFleetDriverService(
        const FleetFailure(code: 'unavailable'),
      );
      final c = FleetDriverController(service: service, cache: cache);
      addTearDown(c.dispose);
      await c.setAccount('u1', eligible: true);
      expect(c.failed, isTrue);
      expect(c.loading, isFalse);
      expect(c.home.isDriver, isTrue);
      service.answer = driverHomeAnswer(owedCents: 0, lateCents: 0);
      await c.refresh();
      expect(c.failed, isFalse);
      expect(c.home.fleets.single.balance.owedCents, 0);
    });

    test('a customer is remembered as "not a driver"; a driver who is '
        'removed stops being one', () async {
      final cache = MemoryDriverHomeCache();
      final service = FakeFleetDriverService(notADriverAnswer());
      final c = FleetDriverController(service: service, cache: cache);
      addTearDown(c.dispose);
      await c.setAccount('u1', eligible: true);
      expect(c.home.isDriver, isFalse);
      expect(c.settled, isTrue);
      expect(DriverHome.decode(cache.kept['u1'])?.isDriver, isFalse);

      service.answer = driverHomeAnswer();
      await c.refresh();
      expect(c.home.lockedFleet, isNotNull);
      service.answer = notADriverAnswer();
      await c.refresh();
      expect(c.home.lockedFleet, isNull);
      expect(DriverHome.decode(cache.kept['u1'])?.isDriver, isFalse);
    });

    test('nobody is asked for a guest, a signed-out phone or a person with '
        'business access; signing out forgets the copy', () async {
      final cache = MemoryDriverHomeCache();
      final service = FakeFleetDriverService(driverHomeAnswer());
      final c = FleetDriverController(service: service, cache: cache);
      addTearDown(c.dispose);
      await c.setAccount(null, eligible: false);
      await c.setAccount('staff', eligible: false);
      expect(service.calls, 0);
      expect(c.settled, isTrue);

      await c.setAccount('u1', eligible: true);
      expect(service.calls, 1);
      expect(cache.kept.containsKey('u1'), isTrue);
      await c.setAccount(null, eligible: false);
      await pumpEventQueue();
      expect(c.home.isDriver, isFalse);
      expect(cache.kept.containsKey('u1'), isFalse);
    });

    test(
      'an answer for the previous account never lands on the next one',
      () async {
        final cache = MemoryDriverHomeCache();
        final first = Completer<Map<String, dynamic>>();
        var n = 0;
        final service = FakeFleetDriverService(
          () => ++n == 1 ? first.future : Future.value(notADriverAnswer()),
        );
        final c = FleetDriverController(service: service, cache: cache);
        addTearDown(c.dispose);
        unawaited(c.setAccount('driver', eligible: true));
        await pumpEventQueue();
        await c.setAccount('customer', eligible: true);
        first.complete(driverHomeAnswer());
        await pumpEventQueue();
        expect(c.uid, 'customer');
        expect(c.home.isDriver, isFalse);
        expect(cache.kept.containsKey('driver'), isFalse);
      },
    );

    test('the same person, not eligible for a moment, keeps their account '
        'and is not asked again', () async {
      final service = FakeFleetDriverService(driverHomeAnswer());
      final c = FleetDriverController(
        service: service,
        cache: MemoryDriverHomeCache(),
      );
      addTearDown(c.dispose);
      await c.setAccount('u1', eligible: true);
      await c.setAccount('u1', eligible: false);
      expect(c.home.lockedFleet, isNotNull);
      await c.setAccount('u1', eligible: true);
      expect(service.calls, 1);
      expect(c.home.lockedFleet, isNotNull);
    });

    test('a phone whose storage is broken still gets its answer', () async {
      final service = FakeFleetDriverService(driverHomeAnswer());
      final c = FleetDriverController(service: service, cache: _Broken());
      addTearDown(c.dispose);
      await c.setAccount('u1', eligible: true);
      expect(c.home.isDriver, isTrue);
    });
  });
}

class _Broken implements DriverHomeCache {
  @override
  Future<String?> read(String uid) => throw StateError('no storage');

  @override
  Future<void> write(String uid, String? raw) => throw StateError('no storage');
}

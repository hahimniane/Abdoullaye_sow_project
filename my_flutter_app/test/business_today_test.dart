import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_today.dart';
import 'package:my_flutter_app/utils/business_permissions.dart';

import 'support/business_today_fixtures.dart';

/// The pure half of the Today page: a mirror of the console's
/// admin_web/src/lib/business-today.test.ts, case for case.

BusinessToday emptyToday() =>
    const BusinessToday(month: '2026-10', previousMonth: '2026-09');

Map<String, Object?> all() => todayMap(
  shipping: true,
  parking: true,
  shop: true,
  carSales: true,
  barrels: true,
  freight: true,
  transport: true,
);

void main() {
  test(
    'a shipping business leads with what came in and went out, then the money',
    () {
      final tiles = todayTiles(todayOf(all()));
      expect(tiles.map((t) => t.key), [
        TodayTileKey.packages,
        TodayTileKey.barrels,
        TodayTileKey.carsShipped,
        TodayTileKey.containers,
        TodayTileKey.collected,
        TodayTileKey.owed,
        TodayTileKey.shopSales,
        TodayTileKey.inLot,
        TodayTileKey.listings,
      ]);
      final containers = tiles.firstWhere(
        (t) => t.key == TodayTileKey.containers,
      );
      expect(containers.note?.key, TodayNoteKey.openNow);
      expect(containers.note?.value, 3);
      final owed = tiles.firstWhere((t) => t.key == TodayTileKey.owed);
      expect(
        owed.compares,
        isFalse,
        reason: 'a balance has no month to compare with',
      );
      expect(owed.kind, TodayTileKind.money);
      final packages = tiles.first;
      expect(packages.value, 118);
      expect(packages.change, 16.8);
    },
  );

  test('only the sections the business runs and the viewer may see', () {
    // A shop: no Volume, no containers, no listings, no lot.
    final shop = todayTiles(todayOf(todayMap(shop: true)));
    expect(shop.map((t) => t.key), [
      TodayTileKey.collected,
      TodayTileKey.owed,
      TodayTileKey.shopSales,
    ]);
    // A parking lot: money, owed, the lot - no shipping tiles at all.
    final lot = todayTiles(todayOf(todayMap(parking: true)));
    expect(lot.map((t) => t.key), [
      TodayTileKey.collected,
      TodayTileKey.owed,
      TodayTileKey.inLot,
    ]);
    expect(lot.last.note?.key, TodayNoteKey.spaces);
    // Staff with no money and no tabs that count: nothing to tile.
    expect(todayTiles(emptyToday()), isEmpty);
    expect(todayTiles(null), isEmpty);
  });

  test('staff without finance never get a money tile or an owed balance', () {
    final today = todayOf(todayMap(shipping: true, finance: false));
    final keys = todayTiles(today).map((t) => t.key);
    expect(keys, isNot(contains(TodayTileKey.collected)));
    expect(keys, isNot(contains(TodayTileKey.owed)));
    expect(today.money, isNull);
  });

  test(
    'Needs attention lists only what is waiting, each with the place that acts on it',
    () {
      final base = emptyToday();
      final today = BusinessToday(
        month: base.month,
        previousMonth: base.previousMonth,
        queues: const {
          'packageRequests': 3,
          'waitingPackages': 0,
          'supportRequests': 1,
          'openInvoices': 2,
          'barrelOrders': null,
        },
        owed: const TodayOwed(
          packagesCents: 12500,
          invoicesCents: 4000,
          parkingCents: 0,
          shopCreditCents: null,
          totalCents: 16500,
        ),
      );
      final items = todayAttention(today);
      expect(items.map((i) => [i.key, i.count, i.amountCents, i.tab, i.view]), [
        [
          'packageRequests',
          3,
          null,
          TodayTab.containers,
          TodayContainersView.requests,
        ],
        ['supportRequests', 1, null, TodayTab.cases, TodayContainersView.none],
        [
          'packagesOwed',
          null,
          12500,
          TodayTab.containers,
          TodayContainersView.none,
        ],
        ['openInvoices', 2, 4000, TodayTab.invoices, TodayContainersView.none],
      ]);
      // Waiting packages open the waiting list.
      final withWaiting = BusinessToday(
        month: base.month,
        previousMonth: base.previousMonth,
        queues: const {'waitingPackages': 4},
      );
      expect(
        todayAttention(withWaiting).single.view,
        TodayContainersView.waiting,
      );
      // Nothing waiting: an empty list, so the page says so.
      expect(todayAttention(emptyToday()), isEmpty);
      expect(todayAttention(null), isEmpty);
    },
  );

  test(
    'money rows: largest first, empty ones dropped, shares for the bars',
    () {
      final breakdown = todayMoneyBreakdown(
        const TodayMoneyMonth(
          totalCents: 10000,
          payments: 4,
          byService: {'packages': 6000, 'invoices': 0, 'online': 4000},
          byMethod: {'cash': 2500, 'zelle': 3500, 'online': 4000, 'other': 0},
        ),
      );
      expect(breakdown.totalCents, 10000);
      expect(breakdown.services.map((r) => [r.key, r.cents, r.percent]), [
        ['packages', 6000, 60],
        ['online', 4000, 40],
      ]);
      expect(breakdown.methods.map((r) => r.key), ['online', 'zelle', 'cash']);
      final none = todayMoneyBreakdown(null);
      expect(none.totalCents, 0);
      expect(none.services, isEmpty);
      expect(none.methods, isEmpty);
      // A tiny share still shows a sliver of bar.
      final tiny = todayMoneyBreakdown(
        const TodayMoneyMonth(
          totalCents: 100000,
          byService: {'packages': 99999, 'shop': 1},
        ),
      );
      expect(tiny.services.last.percent, 1);
    },
  );

  test("the sample's money splits add up to its total", () {
    final today = todayOf(all());
    final month = today.money!.current;
    int sum(Map<String, int> v) => v.values.fold(0, (a, b) => a + b);
    expect(sum(month.byService), month.totalCents);
    expect(sum(month.byMethod), month.totalCents);
    final owed = todayOwedRows(today).fold<int>(0, (a, r) => a + r.cents);
    expect(owed, today.owed.totalCents);
  });

  test('a money read that failed is said, not hidden', () {
    BusinessToday withUnavailable(List<String> names) => BusinessToday(
      month: '2026-10',
      previousMonth: '2026-09',
      unavailable: names,
    );
    expect(todayMoneyComplete(emptyToday()), isTrue);
    expect(todayMoneyComplete(withUnavailable(['packagePayments'])), isFalse);
    expect(
      todayMoneyComplete(withUnavailable(['volume'])),
      isTrue,
      reason: 'Volume is not money',
    );
  });

  test('money reads as US dollars in both languages', () {
    expect(formatTodayMoney(128450), '\$1,284.50');
    expect(formatTodayMoney(128450, whole: true), '\$1,285');
    expect(formatTodayMoney(100000, whole: true), '\$1,000');
    expect(formatTodayMoney(128450, language: 'fr'), '1\u202f284,50\u00a0\$');
    expect(formatTodayMoney(128450, language: 'fr', whole: true), '1\u202f285\u00a0\$');
    expect(formatTodayMoney(-5), '\$0.00');
    expect(formatTodayMoney(null), '\$0.00');
  });

  test('a change reads +12% / −8% / 0%, and nothing without a last month', () {
    expect(formatTodayChange(12.4), '+12%');
    expect(formatTodayChange(-8.2), '−8%');
    expect(formatTodayChange(0.2), '0%');
    expect(formatTodayChange(12.4, language: 'fr'), '+12 %');
    expect(formatTodayChange(null), '');
    expect(todayChangeTone(12.4), TodayChangeTone.up);
    expect(todayChangeTone(-8.2), TodayChangeTone.down);
    expect(todayChangeTone(0.2), TodayChangeTone.flat);
    expect(todayChangeTone(null), TodayChangeTone.flat);
    expect(formatTodayCount(1284), '1,284');
  });

  test(
    'the server answer is read as sent: nulls stay null, junk becomes zero',
    () {
      final response = BusinessTodayResponse.fromCallable({
        'today': {
          'month': '2026-10',
          'previousMonth': '2026-09',
          'queues': {'packageRequests': '4', 'supportRequests': null},
          'owed': {'invoicesCents': 5000.4, 'packagesCents': null},
          'activity': null,
          'money': null,
          'unavailable': ['packagePayments'],
        },
        'complete': false,
        'computedAtMs': 1000,
      });
      final today = response.today!;
      expect(response.complete, isFalse);
      expect(today.queues['packageRequests'], 4);
      expect(today.queues['supportRequests'], isNull);
      expect(today.owed.invoicesCents, 5000);
      expect(today.owed.packagesCents, isNull);
      expect(today.owed.totalCents, isNull);
      expect(today.activity, isNull);
      expect(today.unavailable, ['packagePayments']);
      expect(BusinessTodayResponse.fromCallable(null).today, isNull);
      expect(BusinessTodayResponse.fromCallable('nonsense').today, isNull);
    },
  );

  test('the month names its first day', () {
    expect(todayMonthStart('2026-10'), DateTime(2026, 10));
    expect(todayMonthStart('2026-13'), isNull);
    expect(todayMonthStart(''), isNull);
  });

  group('lot-ledger alerts', () {
    TodayLedgerEvent event(
      String id,
      int minutes, {
      String type = '',
      String action = 'edited',
    }) => TodayLedgerEvent(
      id: id,
      entityType: type,
      action: action,
      summary: '',
      byStaffId: '',
      at: DateTime(2026, 10, 21, 12, minutes),
    );

    test('the titles follow the console', () {
      expect(
        todayLedgerTitle(
          event('a', 0, type: 'staff_parking_link', action: 'unlinked'),
        ),
        TodayLedgerTitle.parkingUnlinked,
      );
      expect(
        todayLedgerTitle(
          event('a', 0, type: 'staff_parking_link', action: 'linked'),
        ),
        TodayLedgerTitle.parkingLinked,
      );
      expect(
        todayLedgerTitle(
          event('a', 0, type: 'staff_repayment', action: 'voided'),
        ),
        TodayLedgerTitle.staffRepaymentVoided,
      );
      expect(
        todayLedgerTitle(
          event('a', 0, type: 'staff_repayment', action: 'created'),
        ),
        TodayLedgerTitle.staffRepaid,
      );
      expect(
        todayLedgerTitle(event('a', 0, action: 'voided')),
        TodayLedgerTitle.entryVoided,
      );
      expect(
        todayLedgerTitle(event('a', 0, action: 'paid')),
        TodayLedgerTitle.paymentReceived,
      );
      expect(todayLedgerTitle(event('a', 0)), TodayLedgerTitle.entryEdited);
    });

    test('newest first, at most six, dismissed ones gone', () {
      final events = [for (var i = 0; i < 8; i++) event('e$i', i)];
      final shown = todayLedgerAlerts(events);
      expect(shown.length, todayLedgerAlertLimit);
      expect(shown.first.id, 'e7');
      expect(todayLedgerAlerts(events, dismissed: {'e7'}).first.id, 'e6');
    });

    test('only a parking business, and only with the ledger permission', () {
      bool has(String p) => p == BusinessPermission.ledger;
      expect(
        todayShowsLedgerAlerts(services: ['carParking'], hasPermission: has),
        isTrue,
      );
      expect(
        todayShowsLedgerAlerts(
          services: ['barrelShipping'],
          hasPermission: has,
        ),
        isFalse,
      );
      expect(
        todayShowsLedgerAlerts(
          services: ['carParking'],
          hasPermission: (_) => false,
        ),
        isFalse,
      );
    });
  });
}

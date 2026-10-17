import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_credit.dart';
import 'package:my_flutter_app/services/sales_history.dart';

/// Sales history, the pure half: the shop's clock (America/New_York, US
/// daylight saving written out), period edges and bars, the figures, the
/// comparison and the timeline.

InventorySale _sale(
  String id,
  DateTime at, {
  int total = 1000,
  bool voided = false,
  DateTime? voidedAt,
  String method = 'cash',
  String seller = 'u-ama',
  String store = '',
  int credit = 0,
  List<Map<String, Object?>>? lines,
}) => InventorySale.fromMap(id, {
  'businessId': 'b1',
  'totalCents': total,
  'paymentMethod': method,
  'soldByStaffId': seller,
  'storeId': store,
  'storeName': store.isEmpty ? '' : 'Store $store',
  'voided': voided,
  'voidedAt': voidedAt,
  'voidedByStaffId': voided ? 'u-owner' : '',
  'createdAt': at,
  'lines':
      lines ??
      [
        {
          'itemId': 'i1',
          'name': 'Soap',
          'quantity': 1,
          'listPriceCents': total,
          'soldPriceCents': total,
        },
      ],
  if (credit > 0) ...{
    'paidNowCents': total - credit,
    'creditCents': credit,
    'creditStatus': 'open',
    'credit': {'customerName': 'Fatou', 'collectorStaffId': 'u-ama'},
  },
});

/// New York wall time -> the instant (standard time, -5).
DateTime _est(int y, int m, int d, [int h = 0, int min = 0]) =>
    DateTime.utc(y, m, d, h + 5, min);

/// New York wall time -> the instant (daylight time, -4).
DateTime _edt(int y, int m, int d, [int h = 0, int min = 0]) =>
    DateTime.utc(y, m, d, h + 4, min);

void main() {
  group('the shop clock', () {
    test('daylight saving edges, 2026 and 2027', () {
      expect(easternDstStartUtc(2026), DateTime.utc(2026, 3, 8, 7));
      expect(easternDstEndUtc(2026), DateTime.utc(2026, 11, 1, 6));
      expect(easternDstStartUtc(2027), DateTime.utc(2027, 3, 14, 7));
      expect(easternDstEndUtc(2027), DateTime.utc(2027, 11, 7, 6));
    });

    test('the wall clock either side of a jump', () {
      // 1:59 EST, then 3:00 EDT: one real minute apart.
      expect(
        easternWall(DateTime.utc(2026, 3, 8, 6, 59)),
        DateTime.utc(2026, 3, 8, 1, 59),
      );
      expect(
        easternWall(DateTime.utc(2026, 3, 8, 7)),
        DateTime.utc(2026, 3, 8, 3),
      );
      // Falling back: 1:30 happens twice.
      expect(
        easternWall(DateTime.utc(2026, 11, 1, 5, 30)),
        DateTime.utc(2026, 11, 1, 1, 30),
      );
      expect(
        easternWall(DateTime.utc(2026, 11, 1, 6, 30)),
        DateTime.utc(2026, 11, 1, 1, 30),
      );
    });

    test('midnight in winter and in summer', () {
      expect(
        easternMidnightUtc(DateTime.utc(2026, 1, 15)),
        DateTime.utc(2026, 1, 15, 5),
      );
      expect(
        easternMidnightUtc(DateTime.utc(2026, 7, 4)),
        DateTime.utc(2026, 7, 4, 4),
      );
      // The two jump days still start at their own midnight.
      expect(
        easternMidnightUtc(DateTime.utc(2026, 3, 8)),
        DateTime.utc(2026, 3, 8, 5),
      );
      expect(
        easternMidnightUtc(DateTime.utc(2026, 11, 1)),
        DateTime.utc(2026, 11, 1, 4),
      );
    });

    test('the wall clock does not depend on the phone zone', () {
      final local = DateTime(2026, 10, 16, 23, 30); // whatever zone runs this
      expect(easternWall(local), easternWall(local.toUtc()));
    });
  });

  group('periods', () {
    test('a day: 24 bars, its own midnight to the next', () {
      final p = SalesPeriod.containing(
        SalesPeriodKind.day,
        DateTime.utc(2026, 10, 16),
      );
      expect(p.startUtc, _edt(2026, 10, 16));
      expect(p.endUtc, _edt(2026, 10, 17));
      expect(p.bucketCount, 24);
      expect(p.bucketOf(_edt(2026, 10, 16, 14, 5)), 14);
      expect(p.bucketOf(_edt(2026, 10, 16)), 0);
      expect(p.bucketOf(_edt(2026, 10, 17)), isNull);
      expect(p.bucketOf(_edt(2026, 10, 15, 23, 59)), isNull);
    });

    test('the short spring day and the long fall day', () {
      final spring = SalesPeriod.containing(
        SalesPeriodKind.day,
        DateTime.utc(2026, 3, 8),
      );
      expect(spring.endUtc.difference(spring.startUtc), const Duration(hours: 23));
      expect(spring.bucketOf(_edt(2026, 3, 8, 3, 10)), 3);
      expect(spring.bucketOf(_edt(2026, 3, 8, 23, 59)), 23);
      final fall = SalesPeriod.containing(
        SalesPeriodKind.day,
        DateTime.utc(2026, 11, 1),
      );
      expect(fall.endUtc.difference(fall.startUtc), const Duration(hours: 25));
      // Both 1:30s go in the 1 a.m. bar.
      expect(fall.bucketOf(DateTime.utc(2026, 11, 1, 5, 30)), 1);
      expect(fall.bucketOf(DateTime.utc(2026, 11, 1, 6, 30)), 1);
      expect(fall.bucketOf(_est(2026, 11, 1, 23, 59)), 23);
    });

    test('a week starts on Sunday (US) and can straddle a month', () {
      // Friday Oct 16 2026 -> Sunday Oct 11 .. Saturday Oct 17.
      final w = SalesPeriod.containing(
        SalesPeriodKind.week,
        DateTime.utc(2026, 10, 16),
      );
      expect(w.startDay, DateTime.utc(2026, 10, 11));
      expect(w.endDay, DateTime.utc(2026, 10, 18));
      expect(w.bucketCount, 7);
      expect(w.bucketOf(_edt(2026, 10, 11, 9)), 0);
      expect(w.bucketOf(_edt(2026, 10, 17, 22)), 6);
      // A Sunday is the first day of its own week.
      expect(
        SalesPeriod.containing(SalesPeriodKind.week, DateTime.utc(2026, 10, 18))
            .startDay,
        DateTime.utc(2026, 10, 18),
      );
      // Across the fall-back Sunday: Oct 25 .. Oct 31, Nov 1 .. Nov 7.
      final across = SalesPeriod.containing(
        SalesPeriodKind.week,
        DateTime.utc(2026, 11, 3),
      );
      expect(across.startDay, DateTime.utc(2026, 11, 1));
      expect(across.startUtc, _edt(2026, 11, 1));
      expect(across.endUtc, _est(2026, 11, 8));
      expect(across.bucketOf(_est(2026, 11, 7, 23)), 6);
      final straddle = SalesPeriod.containing(
        SalesPeriodKind.week,
        DateTime.utc(2026, 9, 30),
      );
      expect(straddle.startDay, DateTime.utc(2026, 9, 27));
      expect(straddle.bucketDay(4), DateTime.utc(2026, 10, 1));
    });

    test('a month: one bar a day, February too', () {
      final m = SalesPeriod.containing(
        SalesPeriodKind.month,
        DateTime.utc(2026, 3, 20),
      );
      expect(m.bucketCount, 31);
      expect(m.startUtc, _est(2026, 3, 1));
      expect(m.endUtc, _edt(2026, 4, 1));
      expect(m.bucketOf(_edt(2026, 3, 8, 12)), 7);
      expect(
        SalesPeriod.containing(SalesPeriodKind.month, DateTime.utc(2028, 2, 3))
            .bucketCount,
        29,
      );
      expect(
        SalesPeriod.containing(SalesPeriodKind.month, DateTime.utc(2026, 2, 3))
            .bucketCount,
        28,
      );
    });

    test('a year: 12 bars; previous / next', () {
      final y = SalesPeriod.containing(
        SalesPeriodKind.year,
        DateTime.utc(2026, 6, 1),
      );
      expect(y.bucketCount, 12);
      expect(y.startUtc, _est(2026, 1, 1));
      expect(y.endUtc, _est(2027, 1, 1));
      expect(y.bucketOf(_edt(2026, 7, 4, 10)), 6);
      expect(y.previous.startDay, DateTime.utc(2025, 1, 1));
      expect(y.next.startDay, DateTime.utc(2027, 1, 1));
      final m = SalesPeriod.containing(
        SalesPeriodKind.month,
        DateTime.utc(2026, 1, 31),
      );
      expect(m.previous.startDay, DateTime.utc(2025, 12, 1));
      expect(m.next.startDay, DateTime.utc(2026, 2, 1));
      final d = SalesPeriod.containing(
        SalesPeriodKind.day,
        DateTime.utc(2026, 3, 1),
      );
      expect(d.previous.startDay, DateTime.utc(2026, 2, 28));
      expect(d.withKind(SalesPeriodKind.week).startDay,
          DateTime.utc(2026, 3, 1));
    });

    test('the current period is read on the shop clock', () {
      // 11:30 p.m. Oct 16 in New York is already Oct 17 in UTC.
      final now = _edt(2026, 10, 16, 23, 30);
      final today = SalesPeriod.current(SalesPeriodKind.day, now);
      expect(today.startDay, DateTime.utc(2026, 10, 16));
      expect(today.startedBy(now), isTrue);
      expect(today.next.startedBy(now), isFalse);
    });
  });

  group('figures', () {
    final day = SalesPeriod.containing(
      SalesPeriodKind.day,
      DateTime.utc(2026, 10, 16),
    );

    test('an empty period is all zeros, with every bar', () {
      final s = summarizeSales(day, const []);
      expect(s.isEmpty, isTrue);
      expect(s.totalCents, 0);
      expect(s.averageCents, 0);
      expect(s.buckets, List.filled(24, 0));
      expect(s.topProducts, isEmpty);
    });

    test('totals, average, items, bars; voids and outsiders left out', () {
      final s = summarizeSales(day, [
        _sale('a', _edt(2026, 10, 16, 9, 15), total: 1000),
        _sale('b', _edt(2026, 10, 16, 9, 45), total: 2500),
        _sale('c', _edt(2026, 10, 16, 18), total: 500),
        _sale('v', _edt(2026, 10, 16, 10), total: 9999, voided: true),
        _sale('x', _edt(2026, 10, 15, 23, 59), total: 7777),
      ]);
      expect(s.totalCents, 4000);
      expect(s.salesCount, 3);
      expect(s.itemsSold, 3);
      expect(s.averageCents, 1333);
      expect(s.voidedCount, 1);
      expect(s.buckets[9], 3500);
      expect(s.buckets[18], 500);
      expect(s.buckets.reduce((a, b) => a + b), 4000);
    });

    test('paid now vs on credit, by payment, and credit collected', () {
      final s = summarizeSales(
        day,
        [
          _sale('a', _edt(2026, 10, 16, 9), total: 6000, credit: 4000),
          _sale('b', _edt(2026, 10, 16, 10), total: 3000, method: 'zelle'),
          _sale('c', _edt(2026, 10, 16, 11), total: 2000, credit: 2000),
        ],
        payments: [
          InventoryCreditPayment(
            id: 'p1',
            amountCents: 1500,
            createdAt: _edt(2026, 10, 16, 15),
          ),
          InventoryCreditPayment(
            id: 'p2',
            amountCents: 900,
            reverted: true,
            createdAt: _edt(2026, 10, 16, 16),
          ),
          InventoryCreditPayment(
            id: 'p3',
            amountCents: 700,
            createdAt: _edt(2026, 10, 15, 16),
          ),
        ],
      );
      expect(s.totalCents, 11000);
      expect(s.paidNowCents, 5000);
      expect(s.creditCents, 6000);
      expect(s.creditCollectedCents, 1500);
      expect(
        {for (final r in s.byPayment) r.id: r.cents},
        {salesOnCreditMethod: 6000, 'zelle': 3000, 'cash': 2000},
      );
      // Nothing paid now on "c": no cash count for it.
      expect(s.byPayment.firstWhere((r) => r.id == 'cash').count, 1);
    });

    test('profit only over known costs; discounts', () {
      final s = summarizeSales(day, [
        _sale(
          'a',
          _edt(2026, 10, 16, 9),
          total: 2600,
          lines: [
            {
              'itemId': 'i1',
              'name': 'Soap',
              'quantity': 2,
              'listPriceCents': 1000,
              'soldPriceCents': 800,
              'costCents': 300,
            },
            {
              'itemId': 'i2',
              'name': 'Oil',
              'quantity': 1,
              'listPriceCents': 1000,
              'soldPriceCents': 1000,
            },
          ],
        ),
      ]);
      expect(s.costCents, 600);
      expect(s.profitCents, 1600 - 600);
      expect(s.linesWithoutCost, 1);
      expect(s.discountCents, 400);
    });

    test('by store, by seller, top products / brands / categories', () {
      final s = summarizeSales(day, [
        _sale(
          'a',
          _edt(2026, 10, 16, 9),
          total: 3000,
          store: 's1',
          seller: 'u-kofi',
          lines: [
            {
              'itemId': 'i1',
              'name': '11',
              'brand': 'Jordan',
              'brandId': 'br1',
              'category': 'Shoes',
              'categoryId': 'c1',
              'quantity': 1,
              'listPriceCents': 3000,
              'soldPriceCents': 3000,
            },
          ],
        ),
        _sale(
          'b',
          _edt(2026, 10, 16, 10),
          total: 1500,
          store: 's2',
          lines: [
            {
              'itemId': 'i2',
              'name': 'Socks',
              'quantity': 3,
              'listPriceCents': 500,
              'soldPriceCents': 500,
            },
          ],
        ),
        _sale('c', _edt(2026, 10, 16, 11), total: 1000, store: 's2'),
      ]);
      expect([for (final r in s.byStore) r.id], ['s1', 's2']);
      expect(s.byStore.last.cents, 2500);
      expect(s.byStore.last.count, 2);
      expect(s.byStore.first.label, 'Store s1');
      expect([for (final r in s.bySeller) r.id], ['u-kofi', 'u-ama']);
      // Products by pieces.
      expect(s.topProducts.first.label, 'Socks');
      expect(s.topProducts.first.count, 3);
      expect(s.topProducts[1].label, 'Jordan 11');
      // Brands and categories by money; unbranded lines are one '' row.
      expect(s.topBrands.first.id, 'br1');
      expect(s.topBrands.last.id, '');
      expect(s.topCategories.first.label, 'Shoes');
    });

    test('the change against the period before', () {
      expect(percentChange(1200, 1000), closeTo(20, 0.001));
      expect(percentChange(800, 1000), closeTo(-20, 0.001));
      expect(percentChange(500, 0), isNull);
      expect(percentChangeText(19.6), '+20%');
      expect(percentChangeText(-3.2), '-3%');
      expect(percentChangeText(-0.4), '0%');
    });
  });

  group('what happened', () {
    final week = SalesPeriod.containing(
      SalesPeriodKind.week,
      DateTime.utc(2026, 10, 16),
    );

    test('sales, voids, credit, stock: newest first, by day', () {
      final events = salesTimeline(
        week,
        sales: [
          _sale('a', _edt(2026, 10, 12, 9), credit: 500),
          _sale(
            'v',
            _edt(2026, 10, 13, 10),
            voided: true,
            voidedAt: _edt(2026, 10, 14, 8),
          ),
          // Sold last week, voided this week: only the void shows.
          _sale(
            'old',
            _edt(2026, 10, 2, 10),
            voided: true,
            voidedAt: _edt(2026, 10, 12, 12),
          ),
        ],
        payments: [
          InventoryCreditPayment(
            id: 'p1',
            saleId: 'a',
            amountCents: 300,
            reverted: true,
            createdAt: _edt(2026, 10, 15, 9),
            revertedAt: _edt(2026, 10, 15, 11),
          ),
        ],
        movements: [
          InventoryMovement(
            id: 'm1',
            itemId: 'i1',
            type: 'add',
            delta: 12,
            quantityAfter: 20,
            createdAt: _edt(2026, 10, 16, 8),
          ),
          InventoryMovement(
            id: 'm2',
            itemId: 'i1',
            type: 'sale',
            delta: -1,
            quantityAfter: 19,
            saleId: 'a',
            createdAt: _edt(2026, 10, 12, 9),
          ),
          InventoryMovement(
            id: 'm3',
            itemId: 'i1',
            type: 'transfer_out',
            delta: -4,
            quantityAfter: 15,
            transferId: 't1',
            createdAt: _edt(2026, 10, 16, 9),
          ),
          InventoryMovement(
            id: 'm4',
            itemId: 'i1',
            type: 'set',
            delta: 2,
            quantityAfter: 17,
            createdAt: _edt(2026, 10, 9, 9),
          ),
        ],
      );
      expect([for (final e in events) e.kind], [
        SalesEventKind.stockMoved,
        SalesEventKind.stockAdded,
        SalesEventKind.creditReverted,
        SalesEventKind.creditPayment,
        SalesEventKind.voided,
        SalesEventKind.sale,
        SalesEventKind.voided,
        SalesEventKind.sale,
      ]);
      final voidedSale = events.firstWhere(
        (e) => e.kind == SalesEventKind.sale && e.saleId == 'v',
      );
      expect(voidedSale.saleVoided, isTrue);
      expect(
        events.firstWhere((e) => e.kind == SalesEventKind.creditPayment).title,
        'Fatou',
      );
      expect(events.first.opensSale, isFalse);
      expect(events.last.opensSale, isTrue);

      final days = salesTimelineByDay(events);
      expect([for (final d in days) d.day.day], [16, 15, 14, 13, 12]);
      expect(days.first.events, hasLength(2));
    });

    test('a late-evening event is on its New York day', () {
      final day = SalesPeriod.containing(
        SalesPeriodKind.day,
        DateTime.utc(2026, 10, 16),
      );
      final events = salesTimeline(
        day,
        sales: [_sale('late', _edt(2026, 10, 16, 23, 50))],
      );
      final days = salesTimelineByDay(events);
      expect(days.single.day, DateTime.utc(2026, 10, 16));
      expect(
        easternWallAsLocal(_edt(2026, 10, 16, 23, 50)),
        DateTime(2026, 10, 16, 23, 50),
      );
    });

    test('an empty period has an empty timeline', () {
      expect(salesTimeline(week), isEmpty);
      expect(salesTimelineByDay(const []), isEmpty);
    });
  });
}

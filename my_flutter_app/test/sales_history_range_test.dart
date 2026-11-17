import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/sales_history.dart';

DateTime _d(int y, int m, int day) => DateTime.utc(y, m, day);

void main() {
  group('a custom range', () {
    test('both days are included; the end edge is the next midnight', () {
      final r = SalesPeriod.range(_d(2026, 10, 12), _d(2026, 10, 16));
      expect(r.kind, SalesPeriodKind.custom);
      expect(r.startDay, _d(2026, 10, 12));
      expect(r.endDay, _d(2026, 10, 17));
      expect(r.lastDay, _d(2026, 10, 16));
      expect(r.dayCount, 5);
      // Oct 12 00:00 and Oct 17 00:00 in New York (EDT, UTC-4).
      expect(r.startUtc, DateTime.utc(2026, 10, 12, 4));
      expect(r.endUtc, DateTime.utc(2026, 10, 17, 4));
    });

    test('a single day is charted by the hour', () {
      final r = SalesPeriod.range(_d(2026, 10, 16), _d(2026, 10, 16));
      expect(r.granularity, SalesGranularity.hour);
      expect(r.bucketCount, 24);
      expect(r.bucketOf(DateTime.utc(2026, 10, 16, 18)), 14);
    });

    test('up to 62 days is charted by the day, bars in order', () {
      final r = SalesPeriod.range(_d(2026, 10, 12), _d(2026, 10, 16));
      expect(r.granularity, SalesGranularity.day);
      expect(r.bucketCount, 5);
      expect(r.bucketOf(DateTime.utc(2026, 10, 12, 4, 30)), 0);
      expect(r.bucketOf(DateTime.utc(2026, 10, 16, 18)), 4);
      expect(r.bucketOf(DateTime.utc(2026, 10, 17, 5)), isNull);
      expect(r.bucketDay(3), _d(2026, 10, 15));
      final long = SalesPeriod.range(_d(2026, 9, 1), _d(2026, 10, 31));
      expect(long.dayCount, 61);
      expect(long.granularity, SalesGranularity.day);
    });

    test('over 62 days is charted by the month it touches', () {
      final r = SalesPeriod.range(_d(2026, 8, 20), _d(2026, 11, 5));
      expect(r.granularity, SalesGranularity.month);
      expect(r.bucketCount, 4); // Aug, Sep, Oct, Nov
      expect(r.bucketOf(DateTime.utc(2026, 8, 25, 12)), 0);
      expect(r.bucketOf(DateTime.utc(2026, 11, 2, 12)), 3);
      expect(r.bucketDay(1), _d(2026, 9, 1));
      final across = SalesPeriod.range(_d(2025, 11, 1), _d(2026, 3, 1));
      expect(across.bucketCount, 5);
      expect(across.bucketDay(2), _d(2026, 1, 1));
    });

    test('previous and next move by the range\'s own length', () {
      final r = SalesPeriod.range(_d(2026, 10, 12), _d(2026, 10, 16));
      expect(r.previous.startDay, _d(2026, 10, 7));
      expect(r.previous.endDay, _d(2026, 10, 12));
      expect(r.previous.kind, SalesPeriodKind.custom);
      expect(r.next.startDay, _d(2026, 10, 17));
      expect(r.next.endDay, _d(2026, 10, 22));
      expect(r.next.previous, r);
    });

    test('the standard kinds still chart as before', () {
      final day = SalesPeriod.containing(SalesPeriodKind.day, _d(2026, 10, 16));
      final week = SalesPeriod.containing(
        SalesPeriodKind.week,
        _d(2026, 10, 16),
      );
      final month = SalesPeriod.containing(
        SalesPeriodKind.month,
        _d(2026, 2, 3),
      );
      final year = SalesPeriod.containing(SalesPeriodKind.year, _d(2026, 2, 3));
      expect([day, week, month, year].map((p) => p.granularity), [
        SalesGranularity.hour,
        SalesGranularity.day,
        SalesGranularity.day,
        SalesGranularity.month,
      ]);
      expect([day, week, month, year].map((p) => p.bucketCount), [
        24,
        7,
        28,
        12,
      ]);
    });

    test('a kind picked from a custom range becomes that period', () {
      final r = SalesPeriod.range(_d(2026, 10, 12), _d(2026, 10, 16));
      expect(r.withKind(SalesPeriodKind.week).startDay, _d(2026, 10, 11));
    });

    test('ends the wrong way round or past two years are refused in code', () {
      expect(
        checkSalesRange(_d(2026, 10, 16), _d(2026, 10, 12)),
        SalesRangeProblem.backwards,
      );
      expect(
        checkSalesRange(_d(2024, 1, 1), _d(2026, 10, 16)),
        SalesRangeProblem.tooLong,
      );
      expect(checkSalesRange(_d(2026, 10, 16), _d(2026, 10, 16)), isNull);
      // 731 days exactly is allowed, 732 is not.
      expect(checkSalesRange(_d(2024, 10, 16), _d(2026, 10, 16)), isNull);
      expect(
        checkSalesRange(_d(2024, 10, 15), _d(2026, 10, 16)),
        SalesRangeProblem.tooLong,
      );
    });

    test(
      'range() never throws: order fixed, start moved up past two years',
      () {
        final swapped = SalesPeriod.range(_d(2026, 10, 16), _d(2026, 10, 12));
        expect(swapped.startDay, _d(2026, 10, 12));
        final long = SalesPeriod.range(_d(2020, 1, 1), _d(2026, 10, 16));
        expect(long.dayCount, salesMaxCustomDays);
        expect(long.lastDay, _d(2026, 10, 16));
      },
    );
  });
}

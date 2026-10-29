import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';

// "Whole month (estimate)": the month-end report for the month still running,
// counted as of its last day instead of today. The same cases as the
// console's `parkingMonthAsOf` tests.
DateTime at(String iso) => DateTime.parse('${iso}T12:00:00Z');
final oct29 = DateTime.parse('2026-10-29T15:00:00Z');

Map<String, dynamic> stay([Map<String, dynamic> over = const {}]) => {
  'id': 'open',
  'customerName': 'Keita',
  'customerPhone': '6465550111',
  'parkingDate': at('2026-10-01'),
  'dailyRate': 12,
  'paymentMethod': 'direct',
  'source': 'business',
  'paymentStatus': 'awaiting_direct_payment',
  'status': 'reserved',
  ...over,
};

void main() {
  group('parkingMonthCanEstimate', () {
    test('only the month still running, before its last day', () {
      expect(parkingMonthCanEstimate('2026-10', oct29), isTrue);
      expect(parkingMonthCanEstimate('2026-09', oct29), isFalse);
      expect(parkingMonthCanEstimate('2026-11', oct29), isFalse);
      expect(parkingMonthCanEstimate('2026-10', at('2026-10-31')), isFalse);
      expect(parkingMonthCanEstimate('2026-10', at('2026-10-01')), isTrue);
      expect(parkingMonthCanEstimate('nope', oct29), isFalse);
    });
  });

  group('parkingMonthAsOf', () {
    test('a past month is already whole: now', () {
      expect(parkingMonthAsOf('2026-09', true, oct29), oct29);
      expect(parkingMonthAsOf('2026-09', false, oct29), oct29);
    });

    test('the current month, so far: now', () {
      expect(parkingMonthAsOf('2026-10', false, oct29), oct29);
    });

    test('the current month, whole: its last day at noon UTC', () {
      final asOf = parkingMonthAsOf('2026-10', true, oct29);
      expect(asOf, DateTime.utc(2026, 10, 31, 12));
      expect(asOf.isUtc, isTrue);
      expect(parkingMonthAsOf('2026-02', true, at('2026-02-10')),
          DateTime.utc(2026, 2, 28, 12));
      expect(parkingMonthAsOf('2026-12', true, at('2026-12-01')),
          DateTime.utc(2026, 12, 31, 12));
    });

    test('on the last day there is nothing to estimate: now', () {
      final last = DateTime.parse('2026-10-31T09:00:00Z');
      expect(parkingMonthAsOf('2026-10', true, last), last);
    });

    test('the last day key', () {
      expect(parkingMonthLastDayKey('2026-10'), '2026-10-31');
      expect(parkingMonthLastDayKey('2028-02'), '2028-02-29');
      expect(parkingMonthLastDayKey('bad'), '');
    });
  });

  group('the estimate bills', () {
    test('an open stay from Oct 1 at \$12/day: 31 days whole, 29 so far', () {
      final soFar = parkingMonthStatement(
        stay(),
        '2026-10',
        parkingMonthAsOf('2026-10', false, oct29),
      )!;
      expect(soFar.days, 29);
      expect(soFar.monthCents, 34800);
      expect(parkingMoney(soFar.monthCents), '\$348.00');

      final whole = parkingMonthStatement(
        stay(),
        '2026-10',
        parkingMonthAsOf('2026-10', true, oct29),
      )!;
      expect(whole.days, 31);
      expect(whole.periodTo, '2026-10-31');
      expect(whole.monthCents, 37200);
      expect(parkingMoney(whole.monthCents), '\$372.00');
      expect(whole.stillParked, isTrue);
    });

    test('a car that already left Oct 3 is unchanged', () {
      final left = stay({
        'id': 'left',
        'parkingEndDate': at('2026-10-03'),
        'amountDueCents': 3600,
      });
      final soFar = parkingMonthStatement(left, '2026-10', oct29)!;
      final whole = parkingMonthStatement(
        left,
        '2026-10',
        parkingMonthAsOf('2026-10', true, oct29),
      )!;
      expect(soFar.days, 3);
      expect(whole.days, 3);
      expect(whole.monthCents, soFar.monthCents);
      expect(whole.periodTo, '2026-10-03');
    });

    test('payments already recorded still count', () {
      final paid = stay({'amountPaidCents': 10000});
      final whole = parkingMonthStatement(
        paid,
        '2026-10',
        parkingMonthAsOf('2026-10', true, oct29),
      )!;
      expect(whole.monthCents, 37200);
      expect(whole.monthPaidCents, 10000);
      expect(whole.dueCents, 27200);

      final summary = parkingMonthSummary(
        [paid, stay({'id': 'other', 'customerPhone': '6465550222'})],
        '2026-10',
        parkingMonthAsOf('2026-10', true, oct29),
      );
      expect(summary.billedCents, 74400);
      expect(summary.collectedCents, 10000);
      expect(summary.dueCents, 64400);
    });
  });
}

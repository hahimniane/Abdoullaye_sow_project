import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/parking_balance.dart';
import 'package:my_flutter_app/services/parking_discount.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';

/// The app's discount rules against the shared fixture the server and the
/// console also run (docs/PARKING_DISCOUNT.md).
void main() {
  final fixture = jsonDecode(
    File('functions/test/fixtures/parking-discount-cases.json')
        .readAsStringSync(),
  ) as Map<String, dynamic>;
  final now = DateTime.parse(fixture['now'] as String);

  Map<String, Object?> pick(Map<String, Object?> from, Iterable<String> keys) =>
      {for (final k in keys) k: from[k]};

  group('the month bill', () {
    for (final c in (fixture['monthCases'] as List).cast<Map>()) {
      test(c['name'] as String, () {
        final bill = parkingMonthStatement(
          Map<String, dynamic>.from(c['car'] as Map),
          c['monthKey'] as String,
          now,
        );
        final json = bill == null
            ? <String, Object?>{}
            : <String, Object?>{
                'monthCents': bill.monthCents,
                'monthPaidCents': bill.monthPaidCents,
                'monthDiscountCents': bill.monthDiscountCents,
                'monthUnpaidCents': bill.monthUnpaidCents,
                'priorUnpaidCents': bill.priorUnpaidCents,
                'dueCents': bill.dueCents,
                'owes': bill.owes,
                'days': bill.days,
                'dayRateCents': bill.dayRateCents,
              };
        final expected = Map<String, Object?>.from(c['expect'] as Map);
        expect(pick(json, expected.keys), expected);
      });
    }
  });

  group('the preview', () {
    for (final c in (fixture['planCases'] as List).cast<Map>()) {
      test(c['name'] as String, () {
        final plan = discountPreview(
          Map<String, dynamic>.from(c['car'] as Map),
          c['mode'] as String,
          (c['amountCents'] as num).round(),
          '${c['reason'] ?? ''}',
          receivedByStaffId: '${c['receivedByStaffId'] ?? ''}',
          now: now,
        );
        final expected = Map<String, Object?>.from(c['expect'] as Map);
        expect(pick(plan.toJson(), expected.keys), expected);
      });
    }
  });

  group('the car', () {
    test('balance takes the discount off and never counts it as paid', () {
      final balance = parkingBalanceNow({
        'parkingDate': '2026-10-20T12:00:00Z',
        'dailyRate': 10,
        'parkingDiscountCents': 2500,
      }, DateTime.parse('2026-10-29T15:00:00Z'));
      expect(balance?.paidCents, 0);
      expect(balance?.discountCents, 2500);
      expect(balance?.balanceCents, 7500);
    });

    test('lists discounts newest first, undone ones kept', () {
      final list = parkingDiscountsOf({
        'parkingDiscounts': [
          {'id': 'a', 'amountCents': 100, 'atMs': 1, 'reason': 'x'},
          {'id': 'b', 'amountCents': 200, 'atMs': 2, 'reason': 'y', 'undone': true, 'undoneAtMs': 3},
          {'id': '', 'amountCents': 50},
        ],
      });
      expect(list.map((d) => [d.id, d.undone]).toList(), [
        ['b', true],
        ['a', false],
      ]);
    });
  });
}

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/parking_balance.dart';

/// The app's mirror of the server's `parkingBalanceNow`
/// (docs/PARKING_WHATSAPP.md §2). The first group pins the rules by hand; the
/// second runs every case of the shared fixture
/// `functions/test/fixtures/parking-balance-cases.json` (server, console and
/// app each run it) when it is present.
void main() {
  // Noon UTC, so the UTC calendar day is the same in every time zone.
  final now = DateTime.utc(2026, 10, 29, 12);

  Map<String, dynamic> car({
    String since = '2026-10-27T12:00:00Z',
    String? left,
    Object? dailyRate = 12,
    Map<String, dynamic> more = const {},
  }) => <String, dynamic>{
    'parkingDate': since,
    'parkingEndDate': ?left,
    'dailyRate': dailyRate,
    ...more,
  };

  group('an open stay runs up days x the daily rate', () {
    test('three days at 12 dollars, nothing paid', () {
      final b = parkingBalanceNow(car(), now);
      expect(b.dailyRateCents, 1200);
      expect(b.sinceDayKey, '2026-10-27');
      expect(b.leftDayKey, '');
      expect(b.stillParked, isTrue);
      expect(b.days, 3);
      expect(b.accruedCents, 3600);
      expect(b.paidCents, 0);
      expect(b.balanceCents, 3600);
      expect(b.paidInFull, isFalse);
    });

    test('the day it arrives counts as day one', () {
      final b = parkingBalanceNow(car(since: '2026-10-29T08:00:00Z'), now);
      expect(b.days, 1);
      expect(b.accruedCents, 1200);
    });

    test('a car that has not started yet owes nothing', () {
      final b = parkingBalanceNow(car(since: '2026-11-02T12:00:00Z'), now);
      expect(b.days, 0);
      expect(b.accruedCents, 0);
      expect(b.balanceCents, 0);
      expect(b.paidInFull, isFalse);
    });
  });

  group('payments come off the balance', () {
    test('a part payment leaves the rest owed', () {
      final b = parkingBalanceNow(car(more: {'amountPaidCents': 2000}), now);
      expect(b.paidCents, 2000);
      expect(b.balanceCents, 1600);
      expect(b.paidInFull, isFalse);
    });

    test('paying exactly what it has run up is paid in full', () {
      final b = parkingBalanceNow(car(more: {'amountPaidCents': 3600}), now);
      expect(b.balanceCents, 0);
      expect(b.paidInFull, isTrue);
    });

    test('paying ahead never reads as a negative balance', () {
      final b = parkingBalanceNow(car(more: {'amountPaidCents': 9000}), now);
      expect(b.balanceCents, 0);
      expect(b.paidInFull, isTrue);
    });

    test('a record marked paid without amounts is paid for what it ran up', () {
      final b = parkingBalanceNow(car(more: {'paymentStatus': 'paid'}), now);
      expect(b.paidCents, 3600);
      expect(b.balanceCents, 0);
      expect(b.paidInFull, isTrue);
    });

    test('a reverted payment (total zeroed) is owed again', () {
      final b = parkingBalanceNow(
        car(
          more: {
            'amountPaidCents': 0,
            'parkingPayments': <Object>[],
            'revertedParkingPayments': [
              {'amountCents': 2000},
            ],
          },
        ),
        now,
      );
      expect(b.paidCents, 0);
      expect(b.balanceCents, 3600);
    });

    test('a free stay with nothing paid is not "paid in full"', () {
      final b = parkingBalanceNow(car(dailyRate: 0), now);
      expect(b.accruedCents, 0);
      expect(b.paidInFull, isFalse);
    });
  });

  group('a stay with a leave day is worth its total', () {
    test('a closed stay: days to the leave day, the recorded total', () {
      final b = parkingBalanceNow(
        car(
          since: '2026-10-20T12:00:00Z',
          left: '2026-10-24T12:00:00Z',
          more: {'amountDueCents': 5000, 'amountPaidCents': 2000},
        ),
        now,
      );
      expect(b.stillParked, isFalse);
      expect(b.leftDayKey, '2026-10-24');
      expect(b.days, 5);
      expect(b.accruedCents, 5000);
      expect(b.balanceCents, 3000);
    });

    test('a booked end date still ahead counts the days so far', () {
      final b = parkingBalanceNow(
        car(
          since: '2026-10-27T12:00:00Z',
          left: '2026-10-31T12:00:00Z',
          more: {'amountDueCents': 6000},
        ),
        now,
      );
      // The server's own accrual: total x days so far / days booked.
      expect(b.days, 3);
      expect(b.accruedCents, 3600);
      expect(b.leftDayKey, '2026-10-31');
      expect(b.stillParked, isTrue);
    });
  });

  group('the shared fixture', () {
    final file = File('functions/test/fixtures/parking-balance-cases.json');

    DateTime nowOf(Object? value) {
      if (value is num) {
        return DateTime.fromMillisecondsSinceEpoch(value.toInt(), isUtc: true);
      }
      return DateTime.parse('$value');
    }

    test('every case gives the server\'s answer', () {
      if (!file.existsSync()) {
        // Written by the server work (docs/PARKING_WHATSAPP.md §2). Until it
        // is on this branch the hand-written cases above are the check.
        markTestSkipped('parking-balance-cases.json is not on this branch');
        return;
      }
      final fixture = jsonDecode(file.readAsStringSync());
      final raw = fixture is Map ? fixture['cases'] : fixture;
      final cases = (raw as List).cast<Map<String, dynamic>>();
      expect(cases, isNotEmpty);
      for (final c in cases) {
        final input = (c['car'] ?? c['row'] ?? c['input']) as Map;
        final got = parkingBalanceNow(
          Map<String, dynamic>.from(input),
          nowOf(c['now'] ?? c['nowMs'] ?? c['at']),
        ).toJson();
        final expected = Map<String, dynamic>.from(c['expect'] as Map);
        for (final entry in expected.entries) {
          expect(
            got[entry.key],
            entry.value,
            reason: '${c['name']}: ${entry.key}',
          );
        }
      }
    });
  });
}

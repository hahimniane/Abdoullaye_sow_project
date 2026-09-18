import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/services/lot_ledger.dart';

// A Firestore Timestamp exposes toDate(); the helper reads that without the
// SDK, so a plain object with the same shape stands in for it here.
class Stamp {
  Stamp(this.value);
  final DateTime value;
  DateTime toDate() => value;
}

Stamp at(String iso) => Stamp(DateTime.parse(iso));
const months = ['2026-07', '2026-08', '2026-09', '2026-10'];

Map<String, dynamic> stay(Map<String, dynamic> extra) => {
      'source': 'business',
      'status': 'reserved',
      ...extra,
    };

void main() {
  // A deliberate mirror of the console's businessParkingCollectedByMonth
  // tests: the two must file the same dollars into the same months.
  test('each instalment lands in the month it was taken', () {
    final rows = [
      stay({
        'paymentStatus': 'awaiting_direct_payment',
        'amountDueCents': 30000,
        'amountPaidCents': 20000,
        'parkingPayments': [
          {'amountCents': 5000, 'at': at('2026-08-03T10:00:00')},
          {'amountCents': 15000, 'at': at('2026-10-20T10:00:00')},
        ],
      }),
    ];
    expect(businessParkingCollectedByMonth(rows, months), [0, 5000, 0, 15000]);
  });

  test('a one-shot cash settlement counts once, in the month received', () {
    final rows = [
      stay({
        'paymentStatus': 'paid',
        'amountDueCents': 12000,
        'amountPaidCents': 12000,
        'directPaymentReceivedAt': at('2026-09-14T09:00:00'),
      }),
    ];
    expect(businessParkingCollectedByMonth(rows, months), [0, 0, 12000, 0]);
  });

  test('a card settlement uses paidAt; an older record falls back', () {
    final rows = [
      stay({
        'paymentStatus': 'succeeded',
        'amountDueCents': 8000,
        'amountPaidCents': 8000,
        'paidAt': at('2026-07-02T09:00:00'),
        'updatedAt': at('2026-10-01T09:00:00'),
      }),
      stay({
        'paymentStatus': 'succeeded',
        'amountDueCents': 6000,
        'amountPaidCents': 6000,
        'updatedAt': at('2026-10-05T09:00:00'),
      }),
    ];
    expect(businessParkingCollectedByMonth(rows, months), [8000, 0, 0, 6000]);
  });

  test('instalments plus a settling remainder are never double counted', () {
    final rows = [
      stay({
        'paymentStatus': 'paid',
        'amountDueCents': 30000,
        'amountPaidCents': 30000,
        'parkingPayments': [
          {'amountCents': 10000, 'at': at('2026-08-03T10:00:00')},
        ],
        'directPaymentReceivedAt': at('2026-09-30T10:00:00'),
      }),
    ];
    final byMonth = businessParkingCollectedByMonth(rows, months);
    expect(byMonth, [0, 10000, 20000, 0]);
    expect(byMonth.fold(0, (a, b) => a + b), 30000);
  });

  test('money outside the months asked for is left out', () {
    final rows = [
      stay({
        'paymentStatus': 'paid',
        'amountDueCents': 5000,
        'amountPaidCents': 5000,
        'directPaymentReceivedAt': at('2025-12-31T10:00:00'),
      }),
    ];
    expect(businessParkingCollectedByMonth(rows, months), [0, 0, 0, 0]);
  });

  test("a reverted stay's surviving instalment list puts nothing on the chart",
      () {
    final rows = [
      stay({
        'paymentStatus': 'awaiting_direct_payment',
        'amountDueCents': 30000,
        'amountPaidCents': 0,
        'parkingPayments': [
          {'amountCents': 5000, 'at': at('2026-08-03T10:00:00')},
        ],
      }),
    ];
    expect(businessParkingCollectedByMonth(rows, months), [0, 0, 0, 0]);
  });

  test('a row never puts more on the chart than it says was collected', () {
    final rows = [
      stay({
        'paymentStatus': 'awaiting_direct_payment',
        'amountDueCents': 30000,
        'amountPaidCents': 3000,
        'parkingPayments': [
          {'amountCents': 5000, 'at': at('2026-08-03T10:00:00')},
          {'amountCents': 5000, 'at': at('2026-09-03T10:00:00')},
        ],
      }),
    ];
    final byMonth = businessParkingCollectedByMonth(rows, months);
    expect(byMonth.fold(0, (a, b) => a + b), 3000);
    expect(byMonth, [0, 3000, 0, 0]);
  });

  test('the ledger maths hands the reports the same series', () {
    final math = LotLedgerMath(
      activities: const [],
      lines: const [],
      entries: const [],
      parkedCarRows: [
        stay({
          'paymentStatus': 'paid',
          'amountDueCents': 12000,
          'amountPaidCents': 12000,
          'directPaymentReceivedAt': at('2026-09-14T09:00:00'),
        }),
      ],
      nowMonth: '2026-10',
    );
    final series = math.yearParkingByMonth(2026);
    expect(series.length, 12);
    expect(series[8], 12000);
    expect(math.yearParkingCents(2026), 12000);
  });
}

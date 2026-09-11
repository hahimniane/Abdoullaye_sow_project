import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

// The lot's own spreadsheet kept totals in the margin - at the lot, left,
// collected, owed. The live scoreboard reads the records instead. This mirrors
// the console's `the parking scoreboard totals the records` so the two stay in
// step.
void main() {
  DateTime day(String d) => DateTime.parse('${d}T12:00:00Z');
  final now = day('2026-09-11');

  test('the parking scoreboard totals the records', () {
    final rows = <Map<String, dynamic>>[
      // open-ended, 10 days at $12, $60 paid -> in lot, owed 60
      {
        'source': 'business',
        'paymentMethod': 'direct',
        'paymentStatus': 'awaiting_direct_payment',
        'parkingDate': day('2026-09-01'),
        'dailyRate': 12,
        'amountPaidCents': 6000,
      },
      // fixed, ended, paid in full -> left, collected 48
      {
        'source': 'business',
        'paymentMethod': 'direct',
        'paymentStatus': 'paid',
        'parkingDate': day('2026-09-01'),
        'parkingEndDate': day('2026-09-05'),
        'dailyRate': 12,
        'amountDueCents': 4800,
        'amountPaidCents': 4800,
      },
      // cancelled -> neither in lot nor owed
      {
        'source': 'business',
        'paymentMethod': 'direct',
        'status': 'cancelled',
        'paymentStatus': 'awaiting_direct_payment',
        'parkingDate': day('2026-09-02'),
        'dailyRate': 12,
      },
    ];
    final t = businessParkingTotals(rows, spacesTotal: 50, now: now);
    expect(t.inLot, 1);
    expect(t.left, 1);
    expect(t.collected, 108); // 60 + 48
    expect(t.owed, 72); // open stay's 132 accrued (11d x 12) - 60 paid; others settled/cancelled
    expect(t.spacesTotal, 50);
    expect(t.spacesUsed, 1);
  });

  test('balance and accrued handle open, fixed, and cancelled stays', () {
    final open = <String, dynamic>{
      'paymentStatus': 'awaiting_direct_payment',
      'parkingDate': day('2026-09-01'),
      'dailyRate': 12,
    };
    expect(businessParkingAccrued(open, now: now), 132); // Sep 1..11 inclusive = 11d x 12
    expect(businessParkingBalance(open, now: now), 132);
    expect(
      businessParkingBalance({...open, 'amountPaidCents': 5000}, now: now),
      82,
    );

    // A fixed stay is priced for its whole range up front; a part payment
    // reduces what is owed, and a full one clears it.
    final fixed = <String, dynamic>{
      'paymentStatus': 'awaiting_direct_payment',
      'parkingDate': day('2026-09-01'),
      'parkingEndDate': day('2026-09-05'),
      'amountDueCents': 4800,
    };
    expect(businessParkingAccrued(fixed, now: now), 48);
    expect(businessParkingBalance(fixed, now: now), 48);
    expect(
      businessParkingBalance({...fixed, 'amountPaidCents': 3000}, now: now),
      18,
    );

    // Cancelled owes nothing, whatever it accrued.
    expect(
      businessParkingBalance({...open, 'status': 'cancelled'}, now: now),
      0,
    );
  });

  test('the scoreboard counts walk-ups and bookings apart', () {
    final rows = <Map<String, dynamic>>[
      {'source': 'business', 'paymentStatus': 'awaiting_direct_payment', 'parkingDate': day('2026-09-01'), 'dailyRate': 12},
      {'source': 'customer', 'paymentStatus': 'succeeded', 'status': 'reserved', 'parkingDate': day('2026-09-02')},
      {'source': 'customer', 'paymentStatus': 'succeeded', 'status': 'reserved', 'parkingDate': day('2026-09-03')},
    ];
    final t = businessParkingTotals(rows, spacesTotal: 10, now: now);
    expect(t.inLot, 1);
    expect(t.reserved, 2);
    expect(t.spacesUsed, 3); // both kinds occupy a space
  });

  // The compound question a single dropdown could never ask: "cars in the lot
  // that have not paid yet" is a status facet AND a payment facet.
  test('facets classify a row and compose with AND', () {
    final walkUpUnpaid = <String, dynamic>{'source': 'business', 'paymentMethod': 'direct', 'paymentStatus': 'awaiting_direct_payment', 'parkingDate': day('2026-09-01'), 'dailyRate': 12};
    final walkUpPart = {...walkUpUnpaid, 'amountPaidCents': 3000};
    final walkUpPaid = <String, dynamic>{'source': 'business', 'paymentMethod': 'direct', 'paymentStatus': 'paid', 'parkingDate': day('2026-09-01'), 'parkingEndDate': day('2026-09-30'), 'amountDueCents': 4800, 'amountPaidCents': 4800};
    final booking = <String, dynamic>{'source': 'customer', 'paymentStatus': 'succeeded', 'status': 'reserved', 'parkingDate': day('2026-09-02')};
    final departed = <String, dynamic>{'source': 'business', 'paymentStatus': 'paid', 'parkingDate': day('2026-09-01'), 'parkingEndDate': day('2026-09-05')};
    final cancelled = <String, dynamic>{'source': 'business', 'status': 'cancelled', 'paymentStatus': 'awaiting_direct_payment', 'parkingDate': day('2026-09-01')};

    expect(parkingRowKind(walkUpUnpaid, now: now), ParkingKind.inLot);
    expect(parkingRowKind(booking, now: now), ParkingKind.reserved);
    expect(parkingRowKind(departed, now: now), ParkingKind.left);
    expect(parkingRowKind(cancelled, now: now), ParkingKind.cancelled);
    expect(parkingRowPayment(walkUpUnpaid), ParkingPaymentClass.unpaid);
    expect(parkingRowPayment(walkUpPart), ParkingPaymentClass.part);
    expect(parkingRowPayment(walkUpPaid), ParkingPaymentClass.paid);
    expect(parkingRowPayment(booking), ParkingPaymentClass.none);

    // Empty facets never narrow.
    expect(businessParkingMatchesFacets(walkUpUnpaid, const ParkingFacets(), now: now), isTrue);
    // "In the lot" AND "Not paid" keeps the unpaid walk-up only.
    const inLotUnpaid = ParkingFacets(kinds: {ParkingKind.inLot}, payments: {ParkingPaymentClass.unpaid});
    expect(businessParkingMatchesFacets(walkUpUnpaid, inLotUnpaid, now: now), isTrue);
    expect(businessParkingMatchesFacets(walkUpPart, inLotUnpaid, now: now), isFalse);
    expect(businessParkingMatchesFacets(booking, inLotUnpaid, now: now), isFalse);
    // OR within a facet: in the lot OR reserved keeps both live kinds.
    const live = ParkingFacets(kinds: {ParkingKind.inLot, ParkingKind.reserved});
    expect(businessParkingMatchesFacets(walkUpUnpaid, live, now: now), isTrue);
    expect(businessParkingMatchesFacets(booking, live, now: now), isTrue);
    expect(businessParkingMatchesFacets(departed, live, now: now), isFalse);
  });

  test('stay days floor at the minimum, whole UTC days', () {
    // Same-day walk-up: one day, not zero.
    expect(
      businessParkingStayDays({
        'parkingDate': day('2026-09-11'),
      }, now: now),
      1,
    );
    // Sep 1 through Sep 11 inclusive = 11 days.
    expect(
      businessParkingStayDays({
        'parkingDate': day('2026-09-01'),
      }, now: now),
      11,
    );
    // A recorded minimum wins when the span is shorter.
    expect(
      businessParkingStayDays({
        'parkingDate': day('2026-09-10'),
        'minimumDays': 7,
      }, now: now),
      7,
    );
  });
}

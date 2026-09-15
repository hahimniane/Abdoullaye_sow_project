import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

// The billing half of a parked car, which was console-only until now: what has
// accrued since the lot last billed, and which of the four actions a given
// record is allowed to offer. Mirrors the console's `ParkingBillingActions`
// and, more importantly, the server's `billParkingThroughToday` - if these
// disagree the button offers a figure the callable then refuses.
void main() {
  DateTime day(String d) => DateTime.parse('${d}T12:00:00Z');
  final now = day('2026-09-13');

  Map<String, dynamic> openStay({
    String? billedThrough,
    String parkingDate = '2026-09-01',
    num dailyRate = 12,
    String paymentStatus = 'awaiting_direct_payment',
    String status = 'active',
    num amountPaidCents = 0,
  }) =>
      <String, dynamic>{
        'source': 'business',
        'paymentMethod': 'direct',
        'paymentStatus': paymentStatus,
        'status': status,
        'parkingDate': day(parkingDate),
        'dailyRate': dailyRate,
        'amountPaidCents': amountPaidCents,
        if (billedThrough != null) 'billedThroughDate': day(billedThrough),
      };

  group('what has accrued since the last billing', () {
    test('counts from the arrival when nothing has been billed', () {
      final unbilled = businessParkingUnbilled(openStay(), now: now);
      expect(unbilled.openEnded, isTrue);
      expect(unbilled.billedThrough, isNull);
      expect(unbilled.days, 12);
      expect(unbilled.amount, 144);
      expect(unbilled.hasSomethingToBill, isTrue);
    });

    test('counts from the last billing once there has been one', () {
      // Billed through the 10th: only the 11th, 12th and 13th are new. Billing
      // from the arrival again would charge the first ten days twice.
      final unbilled = businessParkingUnbilled(
        openStay(billedThrough: '2026-09-10'),
        now: now,
      );
      expect(unbilled.days, 3);
      expect(unbilled.amount, 36);
    });

    test('a stay billed through today has nothing to bill', () {
      final unbilled = businessParkingUnbilled(
        openStay(billedThrough: '2026-09-13'),
        now: now,
      );
      expect(unbilled.days, 0);
      expect(unbilled.amount, 0);
      expect(unbilled.hasSomethingToBill, isFalse);
    });

    test('a stay with a leave date never accrues', () {
      // It was priced for its whole range when it was recorded. The console
      // once offered "$175" on a paid two-night reservation.
      final fixed = openStay()..['parkingEndDate'] = day('2026-09-20');
      final unbilled = businessParkingUnbilled(fixed, now: now);
      expect(unbilled.openEnded, isFalse);
      expect(unbilled.days, 0);
      expect(unbilled.amount, 0);
      expect(unbilled.hasSomethingToBill, isFalse);
    });

    test('a day that has not finished has not been earned', () {
      // Arrived at midday today: elapsed is under one full day.
      final unbilled = businessParkingUnbilled(
        openStay(parkingDate: '2026-09-13'),
        now: now,
      );
      expect(unbilled.days, 0);
    });
  });

  group('which actions a record may offer', () {
    test('billing is offered only where something has accrued', () {
      expect(canBillBusinessParkingThroughToday(openStay(), now: now), isTrue);
      expect(
        canBillBusinessParkingThroughToday(
          openStay(billedThrough: '2026-09-13'),
          now: now,
        ),
        isFalse,
      );
      expect(
        canBillBusinessParkingThroughToday(
          openStay(paymentStatus: 'paid'),
          now: now,
        ),
        isFalse,
      );
      expect(
        canBillBusinessParkingThroughToday(
          openStay(status: 'cancelled'),
          now: now,
        ),
        isFalse,
      );
    });

    test('"paid in person" needs an invoice to settle', () {
      // Nothing billed yet means there is nothing the customer was asked for.
      expect(canRecordBusinessParkingPaymentReceived(openStay()), isFalse);
      expect(
        canRecordBusinessParkingPaymentReceived(
          openStay(billedThrough: '2026-09-10'),
        ),
        isTrue,
      );
      expect(
        canRecordBusinessParkingPaymentReceived(
          openStay(billedThrough: '2026-09-10', paymentStatus: 'succeeded'),
        ),
        isFalse,
      );
    });

    test('closing is offered only while the stay is open', () {
      expect(canCloseBusinessParkingStay(openStay()), isTrue);
      final fixed = openStay()..['parkingEndDate'] = day('2026-09-20');
      expect(canCloseBusinessParkingStay(fixed), isFalse);
      expect(canCloseBusinessParkingStay(openStay(status: 'cancelled')),
          isFalse);
    });

    test('settling the balance needs a balance and an awaiting record', () {
      expect(canSettleBusinessParkingBalance(openStay(), now: now), isTrue);
      // Paid up to date: nothing outstanding, so nothing to settle.
      expect(
        canSettleBusinessParkingBalance(
          openStay(amountPaidCents: 15600),
          now: now,
        ),
        isFalse,
      );
      // An imported record that never tracked payment has nothing to settle
      // even though it shows an amount.
      expect(
        canSettleBusinessParkingBalance(
          openStay(paymentStatus: 'not_required'),
          now: now,
        ),
        isFalse,
      );
      // A customer's own booking is Stripe's record, not the lot's.
      final booking = openStay()..['source'] = 'customer';
      expect(canSettleBusinessParkingBalance(booking, now: now), isFalse);
    });

    test('a payment-link record is never part-paid at the gate', () {
      final link = openStay()..['paymentMethod'] = 'payment_link';
      expect(canPartPayBusinessParking(link), isFalse);
      expect(canPartPayBusinessParking(openStay()), isTrue);
    });
  });

  group('a car settled by hand', () {
    // KEREN's 2009 RAV4: paid in person, so paymentStatus moved to succeeded
    // and amountPaidCents was never written. The board read "Collected \$528 /
    // Owed \$108" with the \$108 sitting on a row badged PAID.
    Map<String, dynamic> settled() => <String, dynamic>{
          'source': 'business',
          'paymentMethod': 'direct',
          'paymentStatus': 'succeeded',
          'status': 'reserved',
          'parkingDate': day('2026-09-03'),
          'parkingEndDate': day('2026-09-12'),
          'dailyRate': '12',
          'totalCost': '0',
          'totalCostCents': '0',
          'amountDue': '108',
          'amountDueCents': '10800',
        };

    test('counts as collected, and owes nothing', () {
      expect(businessParkingAmountPaid(settled(), now: now), 108);
      expect(businessParkingBalance(settled(), now: now), 0);
    });

    test('an instalment already recorded still wins', () {
      // It is the figure someone actually typed.
      final part = settled()..['amountPaidCents'] = 4000;
      expect(businessParkingAmountPaid(part, now: now), 40);
    });

    test('a car that has not been settled is untouched', () {
      final awaiting = settled()
        ..['paymentStatus'] = 'awaiting_direct_payment';
      expect(businessParkingAmountPaid(awaiting, now: now), 0);
      expect(businessParkingBalance(awaiting, now: now), 108);
    });

    test('the scoreboard puts it in Collected rather than Owed', () {
      final totals = businessParkingTotals([settled()], now: now);
      expect(totals.collected, 108);
      expect(totals.owed, 0);
    });

    test('the recorded amount survives a totalCost of zero', () {
      // totalCost is written as the string "0" on a record priced later, so
      // the console's `row.totalCost ?? row.amountDue` kept the zero and its
      // Total column rendered a dash on a car that owed \$108.
      expect(businessParkingAmountDue(settled()), 108);
    });
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/lot_ledger.dart';

/// A lot activity is paid in pieces, from either direction: cash taken at the
/// desk and card taken on the customer's own link, against one balance, in any
/// order. These are the numbers that decide what a row says and what the
/// screen is allowed to send — the app half of `functions/lot_ledger.js`.
LotActivity activity({
  int feeCents = 100000,
  Object? amountPaidCents,
  String status = lotStatusAwaitingLink,
  bool voided = false,
}) {
  return LotActivity.fromMap('a1', {
    'activityTypeId': 't1',
    'activityTypeLabel': 'Dispatch',
    'feeCents': feeCents,
    'amountPaidCents': ?amountPaidCents,
    'customerName': 'Aissatou',
    'vinNumber': '1HGCM82633A004352',
    'paymentMethod': lotPaymentMethodLink,
    'paymentStatus': status,
    'activityDateMonth': '2026-09',
    'voided': voided,
  });
}

void main() {
  group('what has actually been collected', () {
    test('no running total and no settlement reads as nothing collected', () {
      final row = activity();
      expect(row.paidCents, 0);
      expect(row.remainingCents, 100000);
      expect(row.partlyPaid, isFalse);
    });

    test('a row settled before instalments existed reads as fully paid', () {
      // `markPaid` moved the status and never wrote an amount. Reading only
      // the field would report a job the lot has been paid for as owing its
      // whole fee.
      final row = activity(status: lotStatusSucceeded);
      expect(row.paidCents, 100000);
      expect(row.remainingCents, 0);
      expect(row.partlyPaid, isFalse);
      expect(row.canTakePayment, isFalse);
    });

    test('a running total is what it says, settled or not', () {
      final row = activity(amountPaidCents: 35000);
      expect(row.paidCents, 35000);
      expect(row.remainingCents, 65000);
      expect(row.partlyPaid, isTrue);
      expect(row.canTakePayment, isTrue);
    });

    test('a voided row is never part paid, whatever it holds', () {
      final row = activity(amountPaidCents: 35000, voided: true);
      expect(row.paidCents, 35000);
      expect(row.partlyPaid, isFalse);
      expect(row.canTakePayment, isFalse);
    });

    test('collected to the penny is not part paid, and owes nothing', () {
      final row = activity(amountPaidCents: 100000);
      expect(row.partlyPaid, isFalse);
      expect(row.remainingCents, 0);
      expect(row.canTakePayment, isFalse);
    });

    test('a balance never goes below zero', () {
      expect(activity(amountPaidCents: 120000).remainingCents, 0);
      expect(activity(amountPaidCents: -500).paidCents, 0);
    });

    test('a job recorded at no charge has nothing to collect', () {
      final row = activity(feeCents: 0);
      expect(row.partlyPaid, isFalse);
      expect(row.canTakePayment, isFalse);
    });
  });

  group('planning one instalment', () {
    test('cash is clamped to the balance rather than refused', () {
      // Staff typing more than is owed is a typo, not a tip, and there is no
      // way to hand money back.
      final plan = lotActivityPaymentPlan(
        activity: activity(amountPaidCents: 35000),
        amountCents: 90000,
      );
      expect(plan.ok, isTrue);
      expect(plan.appliedCents, 65000);
      expect(plan.overpaidCents, 0);
      expect(plan.newPaidCents, 100000);
      expect(plan.remainingCents, 0);
      expect(plan.fullyCovered, isTrue);
    });

    test('a part payment leaves the rest owed and does not settle', () {
      final plan = lotActivityPaymentPlan(
        activity: activity(),
        amountCents: 35000,
      );
      expect(plan.appliedCents, 35000);
      expect(plan.remainingCents, 65000);
      expect(plan.fullyCovered, isFalse);
    });

    test('card overspill is reported, not silently kept', () {
      // Stripe has already taken it by the time this runs.
      final plan = lotActivityPaymentPlan(
        activity: activity(amountPaidCents: 90000),
        amountCents: 20000,
        source: lotPaymentSourceCard,
      );
      expect(plan.ok, isTrue);
      expect(plan.appliedCents, 10000);
      expect(plan.overpaidCents, 10000);
      expect(plan.fullyCovered, isTrue);
    });

    test('a card payment under the floor is refused; cash has no floor', () {
      expect(
        lotActivityPaymentPlan(
          activity: activity(),
          amountCents: 500,
          source: lotPaymentSourceCard,
        ).reason,
        'below_card_minimum',
      );
      expect(
        lotActivityPaymentPlan(activity: activity(), amountCents: 500).ok,
        isTrue,
      );
    });

    test('refusals speak the server\'s codes', () {
      expect(
        lotActivityPaymentPlan(
          activity: activity(voided: true),
          amountCents: 1000,
        ).reason,
        'activity_voided',
      );
      expect(
        lotActivityPaymentPlan(
          activity: activity(status: lotStatusCancelled),
          amountCents: 1000,
        ).reason,
        'activity_cancelled',
      );
      expect(
        lotActivityPaymentPlan(
          activity: activity(feeCents: 0),
          amountCents: 1000,
        ).reason,
        'nothing_to_pay',
      );
      expect(
        lotActivityPaymentPlan(
          activity: activity(status: lotStatusSucceeded),
          amountCents: 1000,
        ).reason,
        'already_paid',
      );
      expect(
        lotActivityPaymentPlan(activity: activity(), amountCents: null).reason,
        'no_amount',
      );
      expect(
        lotActivityPaymentPlan(activity: activity(), amountCents: 0).reason,
        'no_amount',
      );
    });

    test('an unknown rail is treated as cash, never as an unclamped card', () {
      final plan = lotActivityPaymentPlan(
        activity: activity(),
        amountCents: 250000,
        source: 'wire',
      );
      expect(plan.appliedCents, 100000);
      expect(plan.overpaidCents, 0);
    });
  });

  group('one stored instalment', () {
    test('it carries its own rail, month and the person who took it', () {
      final payment = LotActivityPayment.fromMap('p1', {
        'businessId': 'b1',
        'activityId': 'a1',
        'amountCents': 35000,
        'overpaidCents': 0,
        'source': 'cash',
        'receivedVia': 'zelle',
        'receivedByStaffId': 'staff-1',
        'recordedByStaffId': 'staff-2',
        // A job recorded in September and paid in November is November's
        // income; the activity's own month would never see it.
        'paidAtMonth': '2026-11',
        'note': 'first half',
      });
      expect(payment.amountCents, 35000);
      expect(payment.isCash, isTrue);
      expect(payment.receivedVia, 'zelle');
      expect(payment.receivedByStaffId, 'staff-1');
      expect(payment.recordedByStaffId, 'staff-2');
      expect(payment.paidAtMonth, '2026-11');
    });

    test('an unrecognised rail falls back to cash', () {
      final payment = LotActivityPayment.fromMap('p2', {'source': 'wire'});
      expect(payment.source, lotPaymentSourceCash);
    });
  });

  group('an activity type decides whether there is a car', () {
    test('absent means yes, so old types keep the VIN guard', () {
      final type = LotActivityType.fromMap('t1', {'label': 'Dispatch'});
      expect(type.needsVehicle, isTrue);
    });

    test('only an explicit false opts out', () {
      expect(
        LotActivityType.fromMap('t2', {
          'label': 'Auction account',
          'needsVehicle': false,
        }).needsVehicle,
        isFalse,
      );
    });
  });

  group('the form refuses what the server would refuse', () {
    LotActivityDraft draft({String vin = '', int? feeCents = 100000}) {
      return LotActivityDraft(
        activityTypeId: 't1',
        customLabel: '',
        feeCents: feeCents,
        customerName: 'Aissatou',
        vinNumber: vin,
        paymentMethod: lotPaymentMethodLink,
        customerPhone: '2075550101',
        customerEmail: '',
        receivedByStaffId: '',
      );
    }

    test('car work still demands a VIN', () {
      expect(
        validateLotActivityDraft(draft(), lockedPayment: false),
        contains('vin_required'),
      );
    });

    test('work with no car does not', () {
      expect(
        validateLotActivityDraft(
          draft(),
          lockedPayment: false,
          needsVehicle: false,
        ),
        isEmpty,
      );
    });

    test('a total cannot drop below what has already been collected', () {
      // A $1,000 job holding $350 cannot become a $40 job: that would owe the
      // customer money, and this platform has no way to give it back.
      expect(
        validateLotActivityDraft(
          draft(vin: '1HGCM82633A004352', feeCents: 4000),
          lockedPayment: false,
          alreadyPaidCents: 35000,
        ),
        contains('below_amount_paid'),
      );
      expect(
        validateLotActivityDraft(
          draft(vin: '1HGCM82633A004352', feeCents: 120000),
          lockedPayment: false,
          alreadyPaidCents: 35000,
        ),
        isEmpty,
      );
    });
  });
}

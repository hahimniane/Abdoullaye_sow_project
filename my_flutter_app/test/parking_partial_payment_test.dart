import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

// A twenty-day stay can be paid in instalments. The running amountPaidCents
// drives a "part paid" state that is still owed (still an invoice), distinct
// from fully paid and from untouched.
void main() {
  Map<String, dynamic> owed([int? paidCents]) => {
        'source': 'business',
        'paymentMethod': 'direct',
        'paymentStatus': 'awaiting_direct_payment',
        if (paidCents != null) 'amountPaidCents': paidCents,
      };

  test('amount paid reads cents, defaults to zero', () {
    expect(businessParkingAmountPaid(owed(6000)), 60);
    expect(businessParkingAmountPaid(owed()), 0);
    expect(businessParkingAmountPaid(const {}), 0);
  });

  test('money in but not settled is partly paid, not paid', () {
    expect(businessParkingIsPartlyPaid(owed(6000)), isTrue);
    expect(businessParkingIsPartlyPaid(owed(0)), isFalse);
    expect(businessParkingIsPartlyPaid(owed()), isFalse);
    // A settled record is not "partly" anything.
    final settled = owed(24000)..['paymentStatus'] = 'paid';
    expect(businessParkingIsPartlyPaid(settled), isFalse);
    // Tone is unchanged - a partly-paid record is still awaiting.
    expect(
      businessParkingPaymentTone(owed(6000)),
      BusinessParkingPaymentTone.awaiting,
    );
  });

  test('the service sends days or amount, and who received it', () {
    final src =
        File('lib/services/business_parking_entry.dart').readAsStringSync();
    expect(src, contains("httpsCallable('recordBusinessParkingPartialPayment')"));
    expect(src, contains("'receivedByStaffId': receivedByStaffId"));
    expect(src, contains("'days': ?days"));
    expect(src, contains("'amountCents': ?amountCents"));
    // markPaid now carries the staff member too.
    expect(src, contains("if (receivedByStaffId.trim().isNotEmpty)"));
  });

  test('the details screen offers days/amount, a staff picker, and who received', () {
    final screen =
        File('lib/screens/parked_car_details_screen.dart').readAsStringSync();
    expect(screen, contains('_recordPartPayment('));
    expect(screen, contains('_businessParkingService.recordPartialPayment('));
    expect(screen, contains('days: _partByDays ? n.round() : null'));
    expect(screen, contains('l10n.parkingReceivedBy'));
    // The received-by picker is populated from the staff loaded for this lot.
    expect(screen, contains('_loadStaffNames('));
  });
}

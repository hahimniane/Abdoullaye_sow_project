import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

/// "Who still owes me" was a question the app could only answer by scrolling
/// the whole activity list looking for amber badges. The filter that answers
/// it properly is only as good as the decision below, which is why the
/// decision lives outside the widget.

Map<String, dynamic> row({
  String source = 'business',
  String paymentMethod = 'direct',
  String? paymentStatus = 'awaiting_direct_payment',
  String status = 'active',
}) => <String, dynamic>{
  'source': source,
  'paymentMethod': paymentMethod,
  'paymentStatus': ?paymentStatus,
  'status': status,
};

void main() {
  group('businessParkingMatchesPaymentFilter', () {
    test('all keeps everything, badge or no badge', () {
      for (final record in <Map<String, dynamic>>[
        row(),
        row(paymentStatus: 'succeeded'),
        row(status: 'cancelled'),
        row(source: 'customer'),
        const <String, dynamic>{},
      ]) {
        expect(
          businessParkingMatchesPaymentFilter(
            record,
            BusinessParkingPaymentFilter.all,
          ),
          isTrue,
        );
      }
    });

    test('paid keeps settled money only', () {
      expect(
        businessParkingMatchesPaymentFilter(
          row(paymentStatus: 'succeeded'),
          BusinessParkingPaymentFilter.paid,
        ),
        isTrue,
      );
      expect(
        businessParkingMatchesPaymentFilter(
          row(paymentStatus: 'paid'),
          BusinessParkingPaymentFilter.paid,
        ),
        isTrue,
      );
      expect(
        businessParkingMatchesPaymentFilter(
          row(),
          BusinessParkingPaymentFilter.paid,
        ),
        isFalse,
      );
    });

    test('not paid keeps what the lot is still owed', () {
      expect(
        businessParkingMatchesPaymentFilter(
          row(),
          BusinessParkingPaymentFilter.notPaid,
        ),
        isTrue,
      );
      expect(
        businessParkingMatchesPaymentFilter(
          row(paymentMethod: 'payment_link', paymentStatus: 'pending'),
          BusinessParkingPaymentFilter.notPaid,
        ),
        isTrue,
      );
      expect(
        businessParkingMatchesPaymentFilter(
          row(paymentStatus: 'succeeded'),
          BusinessParkingPaymentFilter.notPaid,
        ),
        isFalse,
      );
    });

    test('a record with nothing to say is neither, so it hides under both', () {
      // A customer's own booking, a cancelled record and an entry with nothing
      // to collect carry no badge. Counting them as unpaid would send staff
      // chasing money nobody owes; counting them as paid would be a lie.
      for (final record in <Map<String, dynamic>>[
        row(source: 'customer', paymentStatus: 'succeeded'),
        row(status: 'cancelled'),
        row(paymentStatus: 'not_required'),
        const <String, dynamic>{},
      ]) {
        expect(
          businessParkingMatchesPaymentFilter(
            record,
            BusinessParkingPaymentFilter.paid,
          ),
          isFalse,
          reason: 'nothing to say must not read as paid: $record',
        );
        expect(
          businessParkingMatchesPaymentFilter(
            record,
            BusinessParkingPaymentFilter.notPaid,
          ),
          isFalse,
          reason: 'nothing to say must not read as owed: $record',
        );
      }
    });

    test('every row lands in exactly one narrowing, or in neither', () {
      // What must never happen is a row surviving both "paid" and "not paid".
      for (final record in <Map<String, dynamic>>[
        row(),
        row(paymentStatus: 'succeeded'),
        row(paymentStatus: 'something_new'),
        row(status: 'cancelled'),
        row(source: 'customer'),
      ]) {
        final paid = businessParkingMatchesPaymentFilter(
          record,
          BusinessParkingPaymentFilter.paid,
        );
        final owed = businessParkingMatchesPaymentFilter(
          record,
          BusinessParkingPaymentFilter.notPaid,
        );
        expect(paid && owed, isFalse, reason: 'both narrowings kept $record');
      }
    });
  });

  group('the activity list spends the decision it is given', () {
    final source = File('lib/screens/home_menu.dart').readAsStringSync();

    test('the list narrows through the shared decision', () {
      expect(source, contains('businessParkingMatchesPaymentFilter('));
      expect(source, contains('BusinessParkingPaymentFilter.all'));
    });

    test('the control is offered only where it means something', () {
      expect(
        source,
        contains('if (selectedCategory == ServiceCategory.parking) ...['),
      );
      expect(source, contains("Key('parking-payment-filter')"));
    });

    test('it reuses the existing paid / not paid wording', () {
      expect(source, contains('l10n.filterAll'));
      expect(source, contains('l10n.paid'));
      expect(source, contains('l10n.notPaid'));
    });

    test('leaving parking clears the narrowing', () {
      // A filter still in force with its control off screen reads as records
      // having gone missing.
      expect(
        source,
        contains('_paymentFilter = BusinessParkingPaymentFilter.all;'),
      );
    });

    test('only parked cars are narrowed', () {
      expect(source, contains('record.category != ServiceCategory.parking'));
    });
  });
}

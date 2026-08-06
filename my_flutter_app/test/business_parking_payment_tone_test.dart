import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

/// The parked-car list showed payment state as one more line of body text, so
/// the owner could not tell a settled walk-up from an unsettled one. The badge
/// that fixes it is only as good as this decision, which is why the decision
/// lives outside the widget.

Map<String, dynamic> row({
  String source = 'business',
  String? paymentMethod,
  String? paymentStatus,
  String status = 'active',
}) => <String, dynamic>{
  'source': source,
  'paymentMethod': ?paymentMethod,
  'paymentStatus': ?paymentStatus,
  'status': status,
};

void main() {
  group('businessParkingPaymentTone', () {
    test('a succeeded Stripe payment is paid', () {
      expect(
        businessParkingPaymentTone(
          row(paymentMethod: 'payment_link', paymentStatus: 'succeeded'),
        ),
        BusinessParkingPaymentTone.paid,
      );
    });

    test('a payment recorded as received by the lot is paid', () {
      expect(
        businessParkingPaymentTone(
          row(paymentMethod: 'direct', paymentStatus: 'paid'),
        ),
        BusinessParkingPaymentTone.paid,
      );
    });

    test('a payment link still pending is awaiting', () {
      expect(
        businessParkingPaymentTone(
          row(paymentMethod: 'payment_link', paymentStatus: 'pending'),
        ),
        BusinessParkingPaymentTone.awaiting,
      );
    });

    test('a direct entry still owed is awaiting', () {
      expect(
        businessParkingPaymentTone(
          row(
            paymentMethod: 'direct',
            paymentStatus: 'awaiting_direct_payment',
          ),
        ),
        BusinessParkingPaymentTone.awaiting,
      );
    });

    test('an unrecognised payment status still reads as awaiting', () {
      // Anything the server invents later must not silently look settled.
      expect(
        businessParkingPaymentTone(
          row(paymentMethod: 'direct', paymentStatus: 'something_new'),
        ),
        BusinessParkingPaymentTone.awaiting,
      );
      expect(
        businessParkingPaymentTone(row(paymentMethod: 'direct')),
        BusinessParkingPaymentTone.awaiting,
      );
    });

    test('nothing to collect shows no badge', () {
      expect(
        businessParkingPaymentTone(
          row(paymentMethod: 'direct', paymentStatus: 'not_required'),
        ),
        BusinessParkingPaymentTone.none,
      );
    });

    test('a cancelled record shows no badge, settled or not', () {
      expect(
        businessParkingPaymentTone(
          row(
            paymentMethod: 'direct',
            paymentStatus: 'awaiting_direct_payment',
            status: 'cancelled',
          ),
        ),
        BusinessParkingPaymentTone.none,
      );
      expect(
        businessParkingPaymentTone(
          row(
            paymentMethod: 'payment_link',
            paymentStatus: 'succeeded',
            status: 'cancelled',
          ),
        ),
        BusinessParkingPaymentTone.none,
      );
    });

    test('a customer booking shows no badge, whatever its payment status', () {
      // The platform owns that payment; badging it here would claim the lot is
      // owed money it never billed.
      expect(
        businessParkingPaymentTone(
          row(source: 'customer', paymentStatus: 'pending'),
        ),
        BusinessParkingPaymentTone.none,
      );
      expect(
        businessParkingPaymentTone(
          row(source: 'customer', paymentStatus: 'succeeded'),
        ),
        BusinessParkingPaymentTone.none,
      );
      expect(
        businessParkingPaymentTone(const <String, dynamic>{}),
        BusinessParkingPaymentTone.none,
      );
    });

    test('the legacy enteredByBusiness flag counts as business-entered', () {
      expect(
        businessParkingPaymentTone(<String, dynamic>{
          'enteredByBusiness': true,
          'paymentStatus': 'awaiting_direct_payment',
        }),
        BusinessParkingPaymentTone.awaiting,
      );
    });
  });
}

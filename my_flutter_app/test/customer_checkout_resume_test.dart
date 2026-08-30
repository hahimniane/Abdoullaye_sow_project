import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/barrel_shipment.dart';
import 'package:my_flutter_app/services/customer_checkout.dart';

void main() {
  group('checkoutResumeTarget', () {
    test('an unpaid barrel resumes the same shipment', () {
      expect(
        checkoutResumeTarget({
          'id': 'ship_1',
          'relatedCollection': 'barrelShipments',
          'status': 'pending_payment',
          'paymentStatus': 'pending',
        }),
        isA<CheckoutResumeTarget>()
            .having((t) => t.orderType, 'orderType', 'barrelShipment')
            .having((t) => t.recordId, 'recordId', 'ship_1'),
      );
    });

    test('a barrel with an orderId resumes the order, not a new shipment', () {
      final target = checkoutResumeTarget({
        'id': 'ship_1',
        'relatedCollection': 'barrelShipments',
        'orderId': 'order_1',
        'status': 'pending_payment',
        'paymentStatus': 'pending',
      });
      expect(target?.orderType, 'barrelOrder');
      expect(target?.recordId, 'order_1');
      expect(checkoutResumePayload(target!), {'resumeRecordId': 'order_1'});
    });

    test('a paid barrel does not offer Pay now', () {
      expect(
        checkoutResumeTarget({
          'id': 'ship_1',
          'relatedCollection': 'barrelShipments',
          'status': 'pending',
          'paymentStatus': 'succeeded',
        }),
        isNull,
      );
    });

    test('pay-on-arrival freight is not treated as an unpaid pay-now', () {
      expect(
        checkoutResumeTarget({
          'id': 'fr_1',
          'relatedCollection': 'freightShipments',
          'status': 'pending_payment',
          'paymentTiming': 'arrival',
        }),
        isNull,
      );
    });
  });

  test('pending barrel model exposes the same resume record as web', () {
    final shipment = BarrelShipment(
      id: 'bs-s4927y',
      trackingCode: 'BS-S4927Y',
      senderName: 'A',
      senderAddress: '1 Main',
      receiverName: 'B',
      receiverPhone: '+221',
      price: 100,
      status: 'pending_payment',
      paymentStatus: 'pending',
      createdAt: DateTime(2026, 8, 29),
    );
    final target = barrelCheckoutResumeTarget(shipment);
    expect(target?.orderType, 'barrelShipment');
    expect(target?.recordId, 'bs-s4927y');
    expect(checkoutResumePayload(target!), {'resumeRecordId': 'bs-s4927y'});
  });

  test('Stripe checkout URLs stay on checkout.stripe.com', () {
    expect(
      isStripeCheckoutUrl(Uri.parse('https://checkout.stripe.com/c/pay/cs_test_1')),
      isTrue,
    );
    expect(isStripeCheckoutUrl(Uri.parse('https://evil.example/pay')), isFalse);
    expect(isStripeCheckoutUrl(Uri.parse('http://checkout.stripe.com/c/pay')), isFalse);
  });
}

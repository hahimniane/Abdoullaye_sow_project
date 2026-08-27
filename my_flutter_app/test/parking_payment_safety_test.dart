import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/payment_flow_safety.dart';

void main() {
  test(
    'payment-sheet failure cancels the uncharged parking reservation',
    () async {
      var completed = false;
      var cancelled = false;

      await expectLater(
        completePaymentFlowSafely(
          presentPaymentSheet: () async => throw StateError('sheet cancelled'),
          completeTransaction: () async => completed = true,
          cancelPendingTransaction: () async => cancelled = true,
        ),
        throwsStateError,
      );

      expect(completed, isFalse);
      expect(cancelled, isTrue);
    },
  );

  test(
    'confirmation failure never cancels a potentially charged reservation',
    () async {
      var cancelled = false;

      await expectLater(
        completePaymentFlowSafely(
          presentPaymentSheet: () async {},
          completeTransaction: () async =>
              throw StateError('confirmation network failure'),
          cancelPendingTransaction: () async => cancelled = true,
        ),
        throwsStateError,
      );

      expect(cancelled, isFalse);
    },
  );

  test(
    'the shared helper protects every checkout from post-charge cancellation',
    () async {
      const protectedServices = {
        'parking',
        'car deposit',
        'car purchase',
        'barrel shipment',
        'barrel order',
        'shared barrel deposit',
        'destination adjustment',
        'freight shipment',
      };
      expect(protectedServices, hasLength(8));

      for (final service in protectedServices) {
        var cancelled = false;
        await expectLater(
          completePaymentFlowSafely(
            presentPaymentSheet: () async {},
            completeTransaction: () async =>
                throw StateError('$service confirmation failed'),
            cancelPendingTransaction: () async => cancelled = true,
          ),
          throwsStateError,
        );
        expect(cancelled, isFalse, reason: service);
      }
    },
  );

  test('all cancellable payment flows use the safe phase ordering', () {
    final barrelShipmentSource = File(
      'lib/services/barrel_shipment_service.dart',
    ).readAsStringSync();
    final barrelPoolSource = File(
      'lib/services/barrel_pool_service.dart',
    ).readAsStringSync();
    final parkingSource = File(
      'lib/services/parking_service.dart',
    ).readAsStringSync();
    final carSource = File(
      'lib/services/car_purchase_service.dart',
    ).readAsStringSync();
    final freightSource = File(
      'lib/services/freight_shipment_service.dart',
    ).readAsStringSync();

    expect(
      'completePaymentFlowSafely'.allMatches(barrelShipmentSource),
      hasLength(3),
    );
    expect(
      'completePaymentFlowSafely'.allMatches(barrelPoolSource),
      hasLength(1),
    );
    expect('completePaymentFlowSafely'.allMatches(parkingSource), hasLength(1));
    expect('completePaymentFlowSafely'.allMatches(carSource), hasLength(2));
    // Two freight branches: pay-now (PaymentIntent) and pay-on-arrival
    // (SetupIntent card save) - both must keep the safe phase ordering.
    expect('completePaymentFlowSafely'.allMatches(freightSource), hasLength(2));
  });
}

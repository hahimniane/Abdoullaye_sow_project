import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

/// A parking payment link stays valid until the customer pays it or the
/// business cancels it. The second half of that rule is a button on the car's
/// details screen, and the button is only ever as right as the decision below
/// - which lives outside the widget so every branch can be driven here,
/// without Firebase and without a screen.

Map<String, dynamic> row({
  String source = 'business',
  String paymentMethod = 'payment_link',
  String? paymentStatus = 'awaiting_link_payment',
  String status = 'active',
  String checkoutUrl = 'https://pay.laawoldigital.com/parking/abc',
  Object? paymentLinkCancelledAt,
}) => <String, dynamic>{
  'source': source,
  'paymentMethod': paymentMethod,
  'paymentStatus': ?paymentStatus,
  'status': status,
  'checkoutUrl': checkoutUrl,
  'paymentLinkCancelledAt': ?paymentLinkCancelledAt,
};

void main() {
  group('canCancelBusinessParkingPaymentLink', () {
    test('an unpaid payment-link entry can be cancelled', () {
      expect(canCancelBusinessParkingPaymentLink(row()), isTrue);
    });

    test('a paid entry cannot: the money is already in', () {
      expect(
        canCancelBusinessParkingPaymentLink(
          row(paymentStatus: 'succeeded'),
        ),
        isFalse,
      );
      expect(
        canCancelBusinessParkingPaymentLink(row(paymentStatus: 'paid')),
        isFalse,
      );
    });

    test('a paid entry on a cancelled record still cannot', () {
      // The badge tone calls a cancelled record "nothing to say" whatever its
      // payment status; the server would still refuse this one as paid.
      expect(
        canCancelBusinessParkingPaymentLink(
          row(paymentStatus: 'succeeded', status: 'cancelled'),
        ),
        isFalse,
      );
    });

    test('an already-cancelled link cannot be cancelled again', () {
      expect(
        canCancelBusinessParkingPaymentLink(
          row(paymentLinkCancelledAt: '2026-08-06T00:00:00Z'),
        ),
        isFalse,
      );
    });

    test('a record with no link has nothing to cancel', () {
      expect(
        canCancelBusinessParkingPaymentLink(
          row(paymentMethod: 'direct', checkoutUrl: ''),
        ),
        isFalse,
      );
    });

    test("a customer's own booking is not the lot's to cancel", () {
      expect(canCancelBusinessParkingPaymentLink(row(source: 'app')), isFalse);
    });
  });

  group('isBusinessParkingPaymentLinkCancelled', () {
    test('the field being present is the whole signal', () {
      expect(isBusinessParkingPaymentLinkCancelled(row()), isFalse);
      expect(
        isBusinessParkingPaymentLinkCancelled(
          row(paymentLinkCancelledAt: '2026-08-06T00:00:00Z'),
        ),
        isTrue,
      );
    });
  });

  group('the details screen spends the decision it is given', () {
    final source = File(
      'lib/screens/parked_car_details_screen.dart',
    ).readAsStringSync();

    test('the cancel button is gated on the decision above', () {
      expect(source, contains('canCancelBusinessParkingPaymentLink('));
      expect(source, contains('if (canCancelLink)'));
      expect(source, contains('l10n.cancelPaymentLink'));
      expect(source, contains("ValueKey<String>('parking-cancel-payment-link')"));
    });

    test('a cancelled link says so instead of offering itself', () {
      expect(source, contains('l10n.parkingPaymentLinkCancelled'));
      expect(source, contains('linkCancelled'));
    });

    test('it confirms first, through the shared confirmation', () {
      expect(source, contains('l10n.cancelPaymentLinkConfirm'));
      final handler = source.substring(
        source.indexOf('Future<void> _cancelPaymentLink()'),
        source.indexOf('Future<void> _copyCheckoutUrl('),
      );
      expect(handler, contains('confirmMajorAction('));
      expect(handler, contains('destructive: true'));
      expect(handler, contains('if (!confirmed'));
      // The failure must be red: showErrorSnackBar uses AppColors.errorRed,
      // while a raw SnackBar in brandRed renders teal and reads as success.
      expect(handler, contains('showErrorSnackBar('));
      expect(handler, isNot(contains('AppColors.brandRed')));
      expect(handler, contains('FirebaseFunctionsException'));
    });
  });
}

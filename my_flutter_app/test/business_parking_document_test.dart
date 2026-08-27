import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

/// A walk-up customer asking for their paperwork got nothing from the app: the
/// lot had to reach for the web console. The button that fixes it is only ever
/// as right as the decision below - receipt for money already in, invoice for
/// money still owed - which lives outside the widget so both branches can be
/// driven here, without Firebase and without a screen.

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
  test('a cancelled record that was paid still prints a receipt', () {
    // The document follows the money, exactly like the server rule in
    // functions/parking_document.js - it does not read the badge at all, so
    // the two can never contradict each other on this record.
    final row = <String, dynamic>{
      'source': 'business',
      'status': 'cancelled',
      'paymentMethod': 'payment_link',
      'paymentStatus': 'succeeded',
    };
    expect(businessParkingPaymentTone(row), BusinessParkingPaymentTone.paid);
    expect(
      businessParkingDocumentType(row),
      BusinessParkingDocumentType.receipt,
    );
  });

  group('businessParkingDocumentType', () {
    test('settled money prints as a receipt', () {
      expect(
        businessParkingDocumentType(
          row(paymentMethod: 'payment_link', paymentStatus: 'succeeded'),
        ),
        BusinessParkingDocumentType.receipt,
      );
      expect(
        businessParkingDocumentType(row(paymentStatus: 'paid')),
        BusinessParkingDocumentType.receipt,
      );
    });

    test('money still owed prints as an invoice', () {
      expect(
        businessParkingDocumentType(row()),
        BusinessParkingDocumentType.invoice,
      );
      expect(
        businessParkingDocumentType(
          row(paymentMethod: 'payment_link', paymentStatus: 'pending'),
        ),
        BusinessParkingDocumentType.invoice,
      );
    });

    test('a status nobody recognises does not claim to be a receipt', () {
      // Anything the server invents later must not hand a customer proof of a
      // payment that never landed.
      expect(
        businessParkingDocumentType(row(paymentStatus: 'something_new')),
        BusinessParkingDocumentType.invoice,
      );
      expect(
        businessParkingDocumentType(row(paymentStatus: null)),
        BusinessParkingDocumentType.invoice,
      );
    });

    test('it agrees with the badge on every live record', () {
      // The button sits a few pixels under the badge, so on anything a lot is
      // actually working the two must agree. The deliberate exception is a
      // record whose parking was cancelled after the customer paid: the badge
      // has nothing to chase, but the money still earns a receipt - and the
      // server (functions/parking_document.js) serves one either way.
      for (final record in <Map<String, dynamic>>[
        row(),
        row(paymentStatus: 'paid'),
        row(paymentStatus: 'succeeded'),
        row(paymentStatus: 'not_required'),
        row(status: 'cancelled'),
      ]) {
        final isPaidBadge =
            businessParkingPaymentTone(record) ==
            BusinessParkingPaymentTone.paid;
        expect(
          businessParkingDocumentType(record) ==
              BusinessParkingDocumentType.receipt,
          isPaidBadge,
          reason: 'document label must follow the badge for $record',
        );
      }
    });
  });

  group('BusinessParkingDocumentLink.fromCallable', () {
    test('it reads what the callable answers with', () {
      final link = BusinessParkingDocumentLink.fromCallable(<String, Object?>{
        'success': true,
        'documentType': 'receipt',
        'url': 'https://example.test/parkingDocument?t=abc',
      });
      expect(link.documentType, BusinessParkingDocumentType.receipt);
      expect(link.url, 'https://example.test/parkingDocument?t=abc');
      expect(link.hasUrl, isTrue);
    });

    test('a missing url is "no document", never an empty launch', () {
      final link = BusinessParkingDocumentLink.fromCallable(<String, Object?>{
        'success': true,
        'documentType': 'invoice',
      });
      expect(link.hasUrl, isFalse);
      expect(link.documentType, BusinessParkingDocumentType.invoice);
    });

    test('a junk response does not become a receipt', () {
      expect(
        BusinessParkingDocumentLink.fromCallable(null).documentType,
        BusinessParkingDocumentType.invoice,
      );
      expect(BusinessParkingDocumentLink.fromCallable(null).hasUrl, isFalse);
    });
  });

  group('the details screen spends the decision it is given', () {
    final source = File(
      'lib/screens/parked_car_details_screen.dart',
    ).readAsStringSync();

    test('the label follows the document type, not the button', () {
      expect(source, contains('businessParkingDocumentType('));
      expect(source, contains('BusinessParkingDocumentType.receipt'));
      expect(source, contains('l10n.parkingPrintReceipt'));
      expect(source, contains('l10n.parkingPrintInvoice'));
      expect(source, contains("ValueKey<String>('parking-print-document')"));
    });

    test('it is gated on the parking permission, like the card around it', () {
      expect(source, contains('if (canRecordPayment) ...['));
    });

    test('the OS browser handles printing, not an in-app view', () {
      final handler = source.substring(
        source.indexOf('Future<void> _openParkingDocument()'),
        source.indexOf('Future<void> _copyCheckoutUrl('),
      );
      expect(handler, contains('.parkingDocumentUrl('));
      expect(handler, contains('entryId: widget.parkedCar.id'));
      expect(handler, contains('LaunchMode.externalApplication'));
      expect(handler, isNot(contains('LaunchMode.inAppBrowserView')));
    });

    test('a failure is red, and says so', () {
      final handler = source.substring(
        source.indexOf('Future<void> _openParkingDocument()'),
        source.indexOf('Future<void> _copyCheckoutUrl('),
      );
      // showErrorSnackBar uses AppColors.errorRed; a raw SnackBar in brandRed
      // renders teal and reads as a success.
      expect(handler, contains('showErrorSnackBar('));
      expect(handler, isNot(contains('AppColors.brandRed')));
      expect(handler, contains('l10n.parkingDocumentCouldNotBeOpened'));
      // The callable's own refusal says something this screen's copy cannot.
      expect(handler, contains('FirebaseFunctionsException'));
    });
  });

  group('the service asks the callable the console asks', () {
    final source = File(
      'lib/services/business_parking_entry.dart',
    ).readAsStringSync();

    test('it calls getParkingDocumentUrl with an entryId', () {
      expect(source, contains("httpsCallable('getParkingDocumentUrl')"));
      expect(source, contains("<String, dynamic>{'entryId': entryId}"));
    });
  });
}

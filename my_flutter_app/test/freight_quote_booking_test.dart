import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  group('accepting a price leads somewhere', () {
    final screen =
        File('lib/screens/freight_quote_details_screen.dart').readAsStringSync();

    test('the accepted state offers the booking that follows it', () {
      // Accepting used to end on a notice with no action at all: the price
      // was agreed and the customer had no way to book it or pay.
      expect(screen, contains('l10n.continueToBooking'));
      expect(screen, contains('SendFreightScreen('));
      expect(screen, contains('quoteRequestId: widget.requestId'));
    });

    test('the booking goes to the business whose price was accepted', () {
      expect(screen, contains('agreedBusinessId'));
    });
  });

  group('who decides the agreed price', () {
    test('the client sends the request, never an amount', () {
      // The price lives on the request the customer accepted and is read
      // server-side. A client-sent amount would be a client-chosen amount.
      final service =
          File('lib/services/freight_shipment_service.dart').readAsStringSync();
      expect(service, contains("'quoteRequestId': quoteRequestId.trim()"));
      expect(service.contains("'agreedAmountCents':"), isFalse);
      expect(service.contains("'amountCents':"), isFalse);
    });
  });
}

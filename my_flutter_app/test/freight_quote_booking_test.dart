import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  group('an accepted freight price leads somewhere that works', () {
    final screen =
        File('lib/screens/freight_quote_details_screen.dart').readAsStringSync();

    test('it offers Send a package, not a booking the server refuses', () {
      // Freight folded into Send a package and the server answers new
      // freight bookings with "freight_moved" (docs/PACKAGE_PRICE_LIST.md
      // decision 12). A "Continue to booking" button would end in an error,
      // so the accepted state points at the form that does work.
      expect(screen, contains('PackageRequestFormScreen()'));
      expect(screen, contains('l10n.prqSendPackage'));
      expect(screen, contains('l10n.freightQuoteMovedNext'));
      expect(screen.contains('SendFreightScreen('), isFalse);
      expect(screen.contains('l10n.continueToBooking'), isFalse);
    });

    test('the accepted price is still shown', () {
      // Old records stay readable: nothing about the agreed price is hidden.
      expect(screen, contains('l10n.freightQuoteChosenMessage'));
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

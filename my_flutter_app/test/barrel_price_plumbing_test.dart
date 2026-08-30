import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/customer_order.dart';

void main() {
  group('the price a customer accepted is the price on the order', () {
    // The picker showed the business option's price while the saved line
    // priced itself from the country dropdown's record, whose
    // barrelShippingPrice defaults to 0. Result: a $100 business produced a
    // $0.00 order and a pay button that could never enable.
    test('the barrel line is built from the priced record', () {
      final screen = File(
        'lib/screens/send_barrel_screen.dart',
      ).readAsStringSync();
      expect(screen, contains('_pricedCountry => _business?.country'));
      expect(
        screen,
        contains('final country = _pricedCountry;'),
        reason: '_save must store the record the fee is read from',
      );
      expect(
        screen,
        contains("(_pricedCountry?.barrelShippingPrice ?? 0) * _quantity"),
        reason: 'the sheet preview must price from the same record',
      );
    });

    test('an unset rate is not shown as a price of zero', () {
      final screen = File(
        'lib/screens/send_barrel_screen.dart',
      ).readAsStringSync();
      expect(screen, contains('l10n.barrelRateUnavailable'));
    });
  });

  group('a paid shipment does not read as if nothing happened', () {
    test('post-payment statuses land on active, not the pending default', () {
      expect(
        CustomerOrder.normalizeStatus('awaiting_weight_confirmation'),
        OrderStatus.active,
      );
      expect(
        CustomerOrder.normalizeStatus('settlement_processing'),
        OrderStatus.active,
      );
    });

    test('unknown strings still fall through to pending', () {
      expect(
        CustomerOrder.normalizeStatus('some_future_status'),
        OrderStatus.pending,
      );
    });
  });

  group('a trackable order carries its code to the tracking screen', () {
    test('the orders screen prefers trackingCode over the document id', () {
      // The signed-in list matches either, but a guest lookup only
      // understands codes - passing the id left a guest on a blank search
      // for an order they had already paid.
      final screen = File('lib/screens/orders_screen.dart').readAsStringSync();
      expect(screen, contains('order.trackingCode?.trim()'));
    });

    test('the guest lookup runs a handed-in code unasked', () {
      final tracking = File(
        'lib/screens/tracking_screen.dart',
      ).readAsStringSync();
      expect(tracking, contains('initialCode: widget.focusShipmentId'));
    });
  });
}

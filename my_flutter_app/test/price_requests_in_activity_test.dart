import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/customer_order.dart';

void main() {
  group('a price request is something the customer can find again', () {
    test('it files as freight, not as a service of its own', () {
      // A customer who asked a freight question is waiting on a freight
      // answer: it belongs in the Freight tab beside the shipments, told
      // apart by its status, not promoted to its own chip.
      final model = File('lib/models/customer_order.dart').readAsStringSync();
      expect(model, contains('type: OrderType.freight'));
      expect(OrderType.values.map((t) => t.name), isNot(contains('priceRequest')));
    });

    test('Activity subscribes to them and builds them', () {
      final screen = File('lib/screens/orders_screen.dart').readAsStringSync();
      expect(screen, contains("collection('freightQuoteRequests')"));
      expect(screen, contains('CustomerOrder.fromPriceRequest'));
      expect(screen, contains('_priceRequests == null'));
    });

    test('its status says whether a price has arrived', () {
      // "quote_requested" is the backend's word and means nothing to the
      // person waiting on an answer.
      final model = File('lib/models/customer_order.dart').readAsStringSync();
      expect(model, contains('Waiting for prices'));
      expect(model, contains('Price agreed'));
    });

    test('tapping one opens the prices it collected', () {
      final model = File('lib/models/customer_order.dart').readAsStringSync();
      expect(model, contains("detailRoute: '/freight-quote'"));
      expect(model, contains('FreightQuoteScreenArguments('));
    });
  });
}

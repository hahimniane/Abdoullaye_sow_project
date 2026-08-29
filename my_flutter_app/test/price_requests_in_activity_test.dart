import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/customer_order.dart';

void main() {
  group('a price request is something the customer can find again', () {
    test('it is an order type, not a screen of its own', () {
      // Before this there was nowhere at all to see one: the screen showing
      // the answers could only be reached in the moment the request was made,
      // so a customer who closed it lost the thread entirely.
      expect(OrderType.values, contains(OrderType.priceRequest));
    });

    test('Activity subscribes to them and builds them', () {
      final screen = File('lib/screens/orders_screen.dart').readAsStringSync();
      expect(screen, contains("collection('freightQuoteRequests')"));
      expect(screen, contains('CustomerOrder.fromPriceRequest'));
      expect(screen, contains('_priceRequests == null'));
    });

    test('the filter chip and icon cover the new type', () {
      final screen = File('lib/screens/orders_screen.dart').readAsStringSync();
      expect(screen, contains('l10n.orderTypePriceRequests'));
      expect(screen, contains('OrderType.priceRequest:'));
    });

    test('tapping one opens the prices it collected', () {
      final model = File('lib/models/customer_order.dart').readAsStringSync();
      expect(model, contains("detailRoute: '/freight-quote'"));
      expect(model, contains('FreightQuoteScreenArguments('));
    });
  });
}

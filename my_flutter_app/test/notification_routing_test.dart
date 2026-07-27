import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/screens/tracking_screen.dart';
import 'package:my_flutter_app/services/notification_routing.dart';

void main() {
  group('routeForNotificationData', () {
    test('routes a car purchase update to My purchases', () {
      final route = routeForNotificationData({
        'type': 'car_purchase_status',
        'purchaseId': 'abc123',
      });

      expect(route?.name, '/my-purchases');
    });

    test('routes a freight status update to tracking with the shipment id',
        () {
      final route = routeForNotificationData({
        'type': 'freight_shipment_status',
        'shipmentId': 'ship-1',
      });

      expect(route?.name, '/tracking');
      final args = route?.arguments as TrackingScreenArguments;
      expect(args.shipmentId, 'ship-1');
    });

    test('routes a barrel status update to tracking too', () {
      final route = routeForNotificationData({
        'type': 'barrel_shipment_status',
        'shipmentId': 'barrel-9',
      });

      expect(route?.name, '/tracking');
      final args = route?.arguments as TrackingScreenArguments;
      expect(args.shipmentId, 'barrel-9');
    });

    test('routes a freight balance-due and refund event to tracking', () {
      final balanceDue = routeForNotificationData({
        'type': 'freight_balance_due',
        'shipmentId': 'ship-2',
      });
      final refund = routeForNotificationData({
        'type': 'freight_refund_issued',
        'shipmentId': 'ship-2',
      });

      expect(balanceDue?.name, '/tracking');
      expect(refund?.name, '/tracking');
    });

    test('routes a parking reservation update to Orders', () {
      final route = routeForNotificationData({
        'type': 'parking_reservation_status',
      });

      expect(route?.name, '/orders');
    });

    test('routes a wallet refund update to Wallet', () {
      final route = routeForNotificationData({
        'type': 'wallet_refund_status',
      });

      expect(route?.name, '/wallet');
    });

    test('routes a business application update to Business registration',
        () {
      final route = routeForNotificationData({
        'type': 'business_application_status',
      });

      expect(route?.name, '/business-register');
    });

    test('routes a support message to the support thread with its case id',
        () {
      final route = routeForNotificationData({
        'type': 'support_message',
        'caseId': 'case-7',
      });

      expect(route?.name, '/support-thread');
      expect(route?.arguments, 'case-7');
    });

    test('routes a support escalation the same way as a support message', () {
      final route = routeForNotificationData({
        'type': 'support_escalated',
        'caseId': 'case-8',
      });

      expect(route?.name, '/support-thread');
      expect(route?.arguments, 'case-8');
    });

    test('does not route a support message with no case id', () {
      final route = routeForNotificationData({'type': 'support_message'});

      expect(route, isNull);
    });

    test('does not route an unrecognized or missing type', () {
      expect(routeForNotificationData({}), isNull);
      expect(routeForNotificationData({'type': 'something_new'}), isNull);
    });
  });

  group('notification payload encode/decode', () {
    test('round-trips a typical data payload', () {
      final data = {
        'type': 'freight_shipment_status',
        'shipmentId': 'ship-1',
        'status': 'in_transit',
      };

      final decoded = decodeNotificationPayload(
        encodeNotificationPayload(data),
      );

      expect(decoded, {
        'type': 'freight_shipment_status',
        'shipmentId': 'ship-1',
        'status': 'in_transit',
      });
    });

    test('round-trips values containing & and = characters safely', () {
      final data = {'type': 'x', 'note': 'a=b&c=d'};

      final decoded = decodeNotificationPayload(
        encodeNotificationPayload(data),
      );

      expect(decoded['note'], 'a=b&c=d');
    });

    test('decodes an empty payload to an empty map', () {
      expect(decodeNotificationPayload(''), <String, String>{});
    });
  });
}

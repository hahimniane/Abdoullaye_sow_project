import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/screens/review_composer_screen.dart';
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

    test('routes a transport request update to Orders', () {
      final route = routeForNotificationData({
        'type': 'transport_request_status',
      });

      expect(route?.name, '/orders');
    });

    test('routes a review request to the review composer', () {
      final route = routeForNotificationData({
        'type': 'review_request',
        'relatedCollection': 'parkedCars',
        'relatedId': 'park-1',
        'businessId': 'biz-1',
      });

      expect(route?.name, '/leave-review');
      final args = route?.arguments as ReviewComposerArguments;
      expect(args.relatedCollection, 'parkedCars');
      expect(args.relatedId, 'park-1');
      expect(args.businessId, 'biz-1');
    });

    test('does not route a review request missing required fields', () {
      final route = routeForNotificationData({
        'type': 'review_request',
        'relatedCollection': 'parkedCars',
      });

      expect(route, isNull);
    });

    test('does not route a retired wallet refund update', () {
      // The wallet is retired (docs/PLAN-2026-08-backlog.md #3): the backend
      // never sends this type and /wallet is not a registered route, so it
      // must resolve to null rather than a tap that goes nowhere.
      final route = routeForNotificationData({
        'type': 'wallet_refund_status',
      });

      expect(route, isNull);
    });

    test('routes a car viewing update to My Purchases', () {
      final route = routeForNotificationData({'type': 'car_viewing_status'});

      expect(route?.name, '/my-purchases');
    });

    test('routes a support case update to the support thread', () {
      final route = routeForNotificationData({
        'type': 'support_case_update',
        'caseId': 'case-123',
      });

      expect(route?.name, '/support-thread');
      expect(route?.arguments, 'case-123');
    });

    test('does not route a support case update with no case id', () {
      final route = routeForNotificationData({'type': 'support_case_update'});

      expect(route, isNull);
    });

    test('routes a shipment tracking update to Tracking', () {
      final route = routeForNotificationData({
        'type': 'shipment_tracking_update',
        'shipmentId': 'ship-9',
      });

      expect(route?.name, '/tracking');
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

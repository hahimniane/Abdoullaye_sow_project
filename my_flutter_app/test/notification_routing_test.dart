import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/screens/review_composer_screen.dart';
import 'package:my_flutter_app/screens/tracking_screen.dart';
import 'package:my_flutter_app/services/notification_routing.dart';

void main() {
  businessRoutingTests();
  phoneReportedRoutingTests();
  group('routeForNotificationData', () {
    test('routes a car purchase update to My purchases', () {
      final route = routeForNotificationData({
        'type': 'car_purchase_status',
        'purchaseId': 'abc123',
      });

      expect(route?.name, '/my-purchases');
    });

    test('routes a freight status update to Orders freight tab + record', () {
      final route = routeForNotificationData({
        'type': 'freight_shipment_status',
        'shipmentId': 'ship-1',
      });

      expect(route?.name, '/orders');
      final args = route?.arguments as OrdersScreenArguments;
      expect(args.innerTab, 'freight');
      expect(args.focusId, 'ship-1');
      expect(args.focusCollection, 'freightShipments');
    });

    test('routes a barrel status update to Orders barrels tab + record', () {
      final route = routeForNotificationData({
        'type': 'barrel_shipment_status',
        'shipmentId': 'barrel-9',
      });

      expect(route?.name, '/orders');
      final args = route?.arguments as OrdersScreenArguments;
      expect(args.innerTab, 'barrels');
      expect(args.focusId, 'barrel-9');
      expect(args.focusCollection, 'barrelShipments');
    });

    test('routes a freight balance-due and refund event to Orders', () {
      final balanceDue = routeForNotificationData({
        'type': 'freight_balance_due',
        'shipmentId': 'ship-2',
      });
      final refund = routeForNotificationData({
        'type': 'freight_refund_issued',
        'shipmentId': 'ship-2',
      });

      expect(balanceDue?.name, '/orders');
      expect(refund?.name, '/orders');
      expect(
        (balanceDue?.arguments as OrdersScreenArguments).innerTab,
        'freight',
      );
    });

    test('routes a parking reservation update to Orders cars tab', () {
      final route = routeForNotificationData({
        'type': 'parking_reservation_status',
        'relatedId': 'park-1',
      });

      expect(route?.name, '/orders');
      final args = route?.arguments as OrdersScreenArguments;
      expect(args.innerTab, 'cars');
      expect(args.focusId, 'park-1');
    });

    test('routes a transport request update to Orders transport tab', () {
      final route = routeForNotificationData({
        'type': 'transport_request_status',
        'requestId': 'tr-1',
      });

      expect(route?.name, '/orders');
      final args = route?.arguments as OrdersScreenArguments;
      expect(args.innerTab, 'transport');
      expect(args.focusId, 'tr-1');
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

    test('routes a car viewing update to its own destination', () {
      // Deliberately not /my-purchases: a buyer opening a notification about
      // an appointment should not land in a list of money they have paid.
      final route = routeForNotificationData({'type': 'car_viewing_status'});

      expect(route?.name, '/my-viewings');
    });

    test('still routes a car purchase update to My Purchases', () {
      final route = routeForNotificationData({'type': 'car_purchase_status'});

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
      final args = route?.arguments as TrackingScreenArguments;
      expect(args.shipmentId, 'ship-9');
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

  group('a price arriving', () {
    test('opens the request it belongs to', () {
      // This notification had no case at all: the tap resolved to null and
      // the customer was left on whatever screen they were on, with no way
      // back to the price they had just been told about.
      final route = routeForNotificationData({
        'type': 'freight_quote_received',
        'requestId': 'req-123',
        'trackingCode': 'FQ-Z6YPQT',
      });
      expect(route, isNotNull);
      expect(route!.name, '/freight-quote');
      final args = route.arguments as FreightQuoteScreenArguments;
      expect(args.requestId, 'req-123');
      expect(args.trackingCode, 'FQ-Z6YPQT');
    });

    test('goes nowhere without a request to open', () {
      expect(
        routeForNotificationData({'type': 'freight_quote_received'}),
        isNull,
      );
    });
  });
}

void businessRoutingTests() {
  group('routeForNotificationData for a business', () {
    const business = NotificationAudience.business;

    test('a paid parking link opens that parked car', () {
      final route = routeForNotificationData({
        'type': 'business_order_paid',
        'service': 'parking',
        'reservationId': 'car-1',
      }, audience: business);
      expect(route?.name, '/business-record');
      final args = route?.arguments as BusinessRecordArguments;
      expect(args.collection, 'parkedCars');
      expect(args.id, 'car-1');
      expect(args.fallbackCategory, 'parking');
    });

    test('a paid barrel or transport job opens its record', () {
      final barrel = routeForNotificationData({
        'type': 'business_order_paid',
        'service': 'barrel',
        'shipmentId': 'b-1',
      }, audience: business);
      expect((barrel?.arguments as BusinessRecordArguments).collection,
          'barrelShipments');
      final transport = routeForNotificationData({
        'type': 'business_order_paid',
        'service': 'transport',
        'requestId': 't-1',
      }, audience: business);
      expect((transport?.arguments as BusinessRecordArguments).collection,
          'transportRequests');
    });

    test('a transport opportunity opens the transport jobs screen', () {
      expect(
        routeForNotificationData({'type': 'transport_opportunity'},
            audience: business)?.name,
        '/business-transport',
      );
    });

    test('quote and pool notices land on the business home list', () {
      final freight = routeForNotificationData({'type': 'freight_quote_request'},
          audience: business);
      expect(freight?.name, '/business-home');
      expect((freight?.arguments as BusinessHomeArguments).category, 'freight');
      final pool = routeForNotificationData({'type': 'barrel_pool_join'},
          audience: business);
      expect((pool?.arguments as BusinessHomeArguments).category, 'barrels');
    });

    test('viewing requests, verification and support go to their screens', () {
      expect(routeForNotificationData({'type': 'car_viewing_status'},
              audience: business)?.name,
          '/purchase-management');
      expect(routeForNotificationData({'type': 'business_verification_review'},
              audience: business)?.name,
          '/business-profile');
      expect(routeForNotificationData({'type': 'business_support_request'},
              audience: business)?.name,
          '/business-support');
      expect(routeForNotificationData(
              {'type': 'support_message', 'caseId': 'c1'}, audience: business)
          ?.name,
          '/support-thread');
    });

    test('a car parked by the team opens that car, a summary the list', () {
      final route = routeForNotificationData({
        'type': 'parked_car',
        'businessId': 'biz-1',
        'parkedCarId': 'pc-1',
        'trackingCode': 'PK-7Q2M',
        'relatedCollection': 'parkedCars',
        'relatedId': 'pc-1',
      }, audience: business);
      expect(route?.name, '/business-record');
      final args = route?.arguments as BusinessRecordArguments;
      expect(args.collection, 'parkedCars');
      expect(args.id, 'pc-1');
      expect(args.fallbackCategory, 'parking');

      final summary = routeForNotificationData({
        'type': 'parked_car',
        'businessId': 'biz-1',
        'summary': 'true',
        'count': '4',
      }, audience: business);
      expect(summary?.name, '/business-home');
      expect(
        (summary?.arguments as BusinessHomeArguments).category,
        'parking',
      );
      // Only a business opens it.
      expect(routeForNotificationData({'type': 'parked_car'}), isNull);
    });

    test('a package saved by the team opens that package', () {
      final route = routeForNotificationData({
        'type': 'container_line',
        'businessId': 'biz-1',
        'lineId': 'line-1',
        'containerId': '',
        'trackingCode': 'CL-K7M4P2',
        'relatedCollection': 'containerLines',
        'relatedId': 'line-1',
      }, audience: business);
      expect(route?.name, '/business-package');
      final args = route?.arguments as BusinessPackageArguments;
      expect(args.lineId, 'line-1');
      expect(args.trackingCode, 'CL-K7M4P2');

      final summary = routeForNotificationData({
        'type': 'container_line',
        'summary': 'true',
        'count': '12',
      }, audience: business);
      expect(summary?.name, '/business-home');
      expect(routeForNotificationData({'type': 'container_line'}), isNull);
    });

    test('platform activity opens the businesses list for an admin', () {
      // One event: a car, a package or a sale in some business.
      for (final kind in ['car', 'package', 'sale']) {
        final route = routeForNotificationData({
          'type': 'platform_activity',
          'businessId': 'biz-1',
          'kind': kind,
          'summary': 'false',
          'relatedCollection': 'parkedCars',
          'relatedId': 'rec-1',
        }, audience: business);
        expect(route?.name, '/businesses', reason: kind);
        expect(route?.arguments, isNull);
      }
      // A 10-minute summary names no record.
      final summary = routeForNotificationData({
        'type': 'platform_activity',
        'businessId': 'biz-1',
        'kind': '',
        'summary': 'true',
        'relatedCollection': '',
        'relatedId': '',
      }, audience: business);
      expect(summary?.name, '/businesses');
      // Someone joined a business as staff.
      final joined = routeForNotificationData({
        'type': 'business_member_joined',
        'businessId': 'biz-1',
        'uid': 'u-9',
      }, audience: business);
      expect(joined?.name, '/businesses');
      // Admins route as the business audience; anyone else opens nothing.
      expect(
        routeForNotificationData({
          'type': 'platform_activity',
          'businessId': 'biz-1',
        }),
        isNull,
      );
      expect(
        routeForNotificationData({'type': 'business_member_joined'}),
        isNull,
      );
    });

    test('a sale at the store opens the Inventory sales list', () {
      final route = routeForNotificationData({
        'type': 'inventory_sale',
        'businessId': 'biz-1',
        'saleId': 'sale-1',
        'storeId': 'store-north',
        'relatedCollection': 'inventorySales',
        'relatedId': 'sale-1',
      }, audience: business);
      expect(route?.name, '/inventory-sales');
      final args = route?.arguments as InventorySalesArguments;
      expect(args.saleId, 'sale-1');
      expect(args.storeId, 'store-north');

      // A single-store business sends no store.
      final single = routeForNotificationData({
        'type': 'inventory_sale',
        'saleId': 'sale-2',
        'storeId': '',
      }, audience: business);
      expect(single?.name, '/inventory-sales');
      expect((single?.arguments as InventorySalesArguments).storeId, isNull);

      // Only a business opens it: a customer has no sales list.
      expect(
        routeForNotificationData({'type': 'inventory_sale', 'saleId': 's'}),
        isNull,
      );
      // The tap waits for the role, then opens it for the business.
      final decision = decideNotificationTap(
        {'type': 'inventory_sale', 'saleId': 'sale-1'},
        appReady: true,
        audience: business,
      );
      expect(decision.action, NotificationTapAction.open);
      expect(decision.route?.name, '/inventory-sales');
      expect(
        decideNotificationTap(
          {'type': 'inventory_sale', 'saleId': 'sale-1'},
          appReady: true,
          audience: null,
        ).action,
        NotificationTapAction.wait,
      );
      // The push service pushes it on the root navigator by name, so the
      // name must be in MaterialApp.routes.
      expect(
        File('lib/main.dart').readAsStringSync(),
        contains("'/inventory-sales': (context)"),
      );
    });

    test('a credit alert opens its sale, marked as credit', () {
      // An inventory_sale with kind credit, or a credit type of its own.
      for (final data in [
        {'type': 'inventory_sale', 'kind': 'credit', 'saleId': 'sale-9'},
        {'type': 'inventory_credit', 'relatedId': 'sale-9'},
        {'type': 'inventory_credit_overdue', 'saleId': 'sale-9',
            'storeId': 'store-north'},
      ]) {
        final route = routeForNotificationData(data, audience: business);
        expect(route?.name, '/inventory-sales', reason: '$data');
        final args = route?.arguments as InventorySalesArguments;
        expect(args.saleId, 'sale-9');
        expect(args.kind, 'credit');
      }
      // A sale alert stays a sale alert.
      final sale = routeForNotificationData(
        {'type': 'inventory_sale', 'saleId': 's1'},
        audience: business,
      );
      expect((sale?.arguments as InventorySalesArguments).kind, isNull);
      // A customer has no sales list.
      expect(
        routeForNotificationData({'type': 'inventory_credit', 'saleId': 's'}),
        isNull,
      );
    });

    test('a store transfer opens the transfers list on that transfer', () {
      for (final kind in [
        'sent',
        'cancelled',
        'differences',
        'transit_reminder',
        'dispute_reminder',
      ]) {
        final route = routeForNotificationData({
          'type': 'inventory_transfer',
          'kind': kind,
          'businessId': 'biz-1',
          'transferId': 'tr-1',
          'code': 'TR-4K8Q2A',
          'fromStoreId': 's-bx',
          'toStoreId': 's-hl',
          'relatedCollection': 'inventoryTransfers',
          'relatedId': 'tr-1',
        }, audience: business);
        expect(route?.name, '/inventory-transfers', reason: kind);
        final args = route?.arguments as InventoryTransfersArguments;
        expect(args.transferId, 'tr-1');
        expect(args.kind, kind);
      }
      // relatedId alone is enough.
      final related = routeForNotificationData(
        {'type': 'inventory_transfer', 'relatedId': 'tr-2'},
        audience: business,
      );
      expect((related?.arguments as InventoryTransfersArguments).transferId,
          'tr-2');
      // No id: the list, with nothing to open.
      final bare = routeForNotificationData(
        {'type': 'inventory_transfer'},
        audience: business,
      );
      expect(bare?.name, '/inventory-transfers');
      expect((bare?.arguments as InventoryTransfersArguments).transferId,
          isNull);
      // A customer has no transfers.
      expect(
        routeForNotificationData(
          {'type': 'inventory_transfer', 'transferId': 'tr-1'},
        ),
        isNull,
      );
      // The tap waits for the role, then opens it.
      expect(
        decideNotificationTap(
          {'type': 'inventory_transfer', 'transferId': 'tr-1'},
          appReady: true,
          audience: null,
        ).action,
        NotificationTapAction.wait,
      );
      final decision = decideNotificationTap(
        {'type': 'inventory_transfer', 'transferId': 'tr-1'},
        appReady: true,
        audience: business,
      );
      expect(decision.action, NotificationTapAction.open);
      expect(decision.route?.name, '/inventory-transfers');
      // Pushed by name on the root navigator: it must be a MaterialApp route.
      final main = File('lib/main.dart').readAsStringSync();
      expect(main, contains("'/inventory-transfers': (context)"));
      expect(main, contains('args is InventoryTransfersArguments'));
    });

    test('a customer still gets the customer screens for shared types', () {
      expect(routeForNotificationData({'type': 'car_viewing_status'})?.name,
          '/my-viewings');
      expect(
        routeForNotificationData({
          'type': 'parking_reservation_status',
          'reservationId': 'r1',
        })?.name,
        '/orders',
      );
    });
  });
}

/// "A customer says a number isn't theirs" (docs/PHONE_ACCOUNTS.md §6.1):
/// the business opens the record whose number to check.
void phoneReportedRoutingTests() {
  group('phone_number_reported', () {
    const business = NotificationAudience.business;

    test('a package opens on the business side by line and code', () {
      final route = routeForNotificationData({
        'type': 'phone_number_reported',
        'relatedCollection': 'containerLines',
        'relatedId': 'line-1',
        'field': 'receiverPhone',
        'trackingCode': 'CL-K7M4P2',
      }, audience: business);
      expect(route?.name, '/business-package');
      final args = route?.arguments as BusinessPackageArguments;
      expect(args.lineId, 'line-1');
      expect(args.trackingCode, 'CL-K7M4P2');
    });

    test('a parked car, barrel or transport record opens that record', () {
      for (final (collection, category) in [
        ('parkedCars', 'parking'),
        ('barrelShipments', 'barrels'),
        ('transportRequests', 'transport'),
      ]) {
        final route = routeForNotificationData({
          'type': 'phone_number_reported',
          'relatedCollection': collection,
          'relatedId': 'rec-1',
          'field': 'customerPhone',
        }, audience: business);
        expect(route?.name, '/business-record', reason: collection);
        final args = route?.arguments as BusinessRecordArguments;
        expect(args.collection, collection);
        expect(args.id, 'rec-1');
        expect(args.fallbackCategory, category);
      }
    });

    test('freight and package requests open their lists', () {
      final freight = routeForNotificationData({
        'type': 'phone_number_reported',
        'relatedCollection': 'freightShipments',
        'relatedId': 'f-1',
      }, audience: business);
      expect(freight?.name, '/business-home');
      expect(
        (freight?.arguments as BusinessHomeArguments).category,
        'freight',
      );
      final request = routeForNotificationData({
        'type': 'phone_number_reported',
        'relatedCollection': 'packageRequests',
        'relatedId': 'r-1',
      }, audience: business);
      expect(request?.name, '/business-requests');
    });

    test('a package with neither id nor code lands on the business home', () {
      final route = routeForNotificationData({
        'type': 'phone_number_reported',
        'relatedCollection': 'containerLines',
      }, audience: business);
      expect(route?.name, '/business-home');
    });

    test('a customer tap is not routed (it is a business notice)', () {
      final decision = decideNotificationTap(
        {
          'type': 'phone_number_reported',
          'relatedCollection': 'containerLines',
          'relatedId': 'line-1',
        },
        appReady: true,
        audience: NotificationAudience.customer,
      );
      expect(decision.action, NotificationTapAction.ignore);
      final open = decideNotificationTap(
        {
          'type': 'phone_number_reported',
          'relatedCollection': 'containerLines',
          'relatedId': 'line-1',
        },
        appReady: true,
        audience: business,
      );
      expect(open.action, NotificationTapAction.open);
      expect(open.route?.name, '/business-package');
    });

    test('the package route is registered in the app', () {
      final main = File('lib/main.dart').readAsStringSync();
      expect(main, contains("'/business-package': (context)"));
      expect(main, contains("'/my-packages': (context)"));
    });
  });
}

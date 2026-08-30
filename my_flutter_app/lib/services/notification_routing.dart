import '../screens/review_composer_screen.dart';
import '../screens/tracking_screen.dart';

/// Where to navigate for a given push notification's `data` payload.
class NotificationRoute {
  const NotificationRoute(this.name, {this.arguments});

  final String name;
  final Object? arguments;
}

/// Focus for the customer Orders screen (inner tab + record).
///
/// Mirrors `customerOrdersInnerTab` / `customerTargetForNotification`
/// in admin_web so a bell tap opens the same shipment the web console does.
class OrdersScreenArguments {
  const OrdersScreenArguments({
    this.innerTab,
    this.focusId,
    this.focusCollection,
  });

  /// `barrels` | `freight` | `transport` | `cars`
  final String? innerTab;
  final String? focusId;
  final String? focusCollection;
}

const _typeCollections = <String, String>{
  'barrel_shipment_status': 'barrelShipments',
  'freight_shipment_status': 'freightShipments',
  'freight_balance_due': 'freightShipments',
  'freight_refund_issued': 'freightShipments',
  'freight_quote_received': 'freightQuoteRequests',
  'transport_request_status': 'transportRequests',
  'parking_reservation_status': 'parkedCars',
  'car_purchase_status': 'carPurchases',
  'car_viewing_status': 'carPurchases',
};

String collectionForNotificationType(String type) =>
    _typeCollections[type] ?? '';

String recordIdFromNotification(Map<String, dynamic> data) {
  for (final key in [
    'relatedId',
    'shipmentId',
    'requestId',
    'reservationId',
    'purchaseId',
    'recordId',
  ]) {
    final value = data[key]?.toString().trim() ?? '';
    if (value.isNotEmpty) return value;
  }
  return '';
}

String collectionFromNotification(Map<String, dynamic> data) {
  final stamped = data['relatedCollection']?.toString().trim() ?? '';
  if (stamped.isNotEmpty) return stamped;
  return collectionForNotificationType(data['type']?.toString() ?? '');
}

String customerOrdersInnerTab(String collection) {
  switch (collection) {
    case 'barrelShipments':
    case 'barrelOrders':
      return 'barrels';
    case 'freightShipments':
    case 'freightQuoteRequests':
      return 'freight';
    case 'transportRequests':
      return 'transport';
    default:
      return 'cars';
  }
}

NotificationRoute _ordersRoute(Map<String, dynamic> data) {
  final collection = collectionFromNotification(data);
  final id = recordIdFromNotification(data);
  return NotificationRoute(
    '/orders',
    arguments: OrdersScreenArguments(
      innerTab: customerOrdersInnerTab(collection),
      focusId: id.isEmpty ? null : id,
      focusCollection: collection.isEmpty ? null : collection,
    ),
  );
}

/// Best-effort deep link: routes to the most relevant screen for this
/// notification's category. Several detail screens (parked car, barrel
/// shipment, transport request) require a full loaded model as a route
/// argument rather than just an id, so this opens the closest list/hub
/// screen instead of fetching and constructing the full object here.
/// Returns null when the type is unrecognized or required data is missing.
NotificationRoute? routeForNotificationData(Map<String, dynamic> data) {
  final type = data['type']?.toString() ?? '';
  switch (type) {
    case 'car_purchase_status':
      return const NotificationRoute('/my-purchases');
    case 'car_viewing_status':
      // Viewings have their own destination: a buyer opening a notification
      // about an appointment should not land in a list of purchases.
      return const NotificationRoute('/my-viewings');
    case 'barrel_shipment_status':
    case 'freight_shipment_status':
    case 'freight_balance_due':
    case 'freight_refund_issued':
    case 'parking_reservation_status':
    case 'transport_request_status':
      return _ordersRoute(data);
    // A price landing is the one notification a customer is actually waiting
    // on, and it used to open nothing: there was no case here and no named
    // route to send it to, so the tap fell through and the customer had no
    // way back to the price they had just been told about.
    case 'freight_quote_received':
      final requestId = data['requestId']?.toString() ?? '';
      if (requestId.isEmpty) return null;
      return NotificationRoute(
        '/freight-quote',
        arguments: FreightQuoteScreenArguments(
          requestId: requestId,
          trackingCode: data['trackingCode']?.toString() ?? '',
        ),
      );
    case 'review_request':
      final relatedCollection = data['relatedCollection']?.toString();
      final relatedId = data['relatedId']?.toString();
      final businessId = data['businessId']?.toString();
      if (relatedCollection == null ||
          relatedCollection.isEmpty ||
          relatedId == null ||
          relatedId.isEmpty ||
          businessId == null ||
          businessId.isEmpty) {
        return null;
      }
      return NotificationRoute(
        '/leave-review',
        arguments: ReviewComposerArguments(
          relatedCollection: relatedCollection,
          relatedId: relatedId,
          businessId: businessId,
        ),
      );
    // No wallet_refund_status case: the wallet is retired
    // (docs/PLAN-2026-08-backlog.md #3). The backend never sends that type and
    // /wallet is not a registered route, so it could only ever have been a tap
    // that did nothing.
    case 'support_case_update':
      // Same payload and destination as support_message - the backend sends
      // this on every case update (index.js:25176) and it had no route, so
      // those taps silently went nowhere.
      final supportCaseId = data['caseId']?.toString();
      if (supportCaseId == null || supportCaseId.isEmpty) return null;
      return NotificationRoute('/support-thread', arguments: supportCaseId);
    case 'shipment_tracking_update':
      return NotificationRoute(
        '/tracking',
        arguments: TrackingScreenArguments(
          shipmentId: data['shipmentId']?.toString(),
        ),
      );
    case 'business_application_status':
      return const NotificationRoute('/business-register');
    case 'support_message':
    case 'support_escalated':
      final caseId = data['caseId']?.toString();
      if (caseId == null || caseId.isEmpty) return null;
      return NotificationRoute('/support-thread', arguments: caseId);
    default:
      return null;
  }
}

/// FCM data payloads are always string-keyed and string-valued, so encoding
/// as a query string is enough to round-trip them through
/// flutter_local_notifications' payload field (used when a
/// foreground-shown local notification is
/// tapped, since that path doesn't hand back the original RemoteMessage).
String encodeNotificationPayload(Map<String, dynamic> data) {
  return data.entries
      .map(
        (entry) =>
            '${Uri.encodeComponent(entry.key)}='
            '${Uri.encodeComponent(entry.value.toString())}',
      )
      .join('&');
}

Map<String, String> decodeNotificationPayload(String payload) {
  final data = <String, String>{};
  if (payload.isEmpty) return data;
  for (final pair in payload.split('&')) {
    final separatorIndex = pair.indexOf('=');
    if (separatorIndex <= 0) continue;
    final key = Uri.decodeComponent(pair.substring(0, separatorIndex));
    final value = Uri.decodeComponent(pair.substring(separatorIndex + 1));
    data[key] = value;
  }
  return data;
}

/// What a notification about a price carries to the screen that shows it.
class FreightQuoteScreenArguments {
  const FreightQuoteScreenArguments({
    required this.requestId,
    this.trackingCode = '',
  });

  final String requestId;
  final String trackingCode;
}

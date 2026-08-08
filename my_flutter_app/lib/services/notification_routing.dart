import '../screens/review_composer_screen.dart';
import '../screens/tracking_screen.dart';

/// Where to navigate for a given push notification's `data` payload.
class NotificationRoute {
  const NotificationRoute(this.name, {this.arguments});

  final String name;
  final Object? arguments;
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
    case 'car_viewing_status':
      // Viewing negotiations live on the purchase record, so both land on the
      // same screen. Without this case the six new viewing notifications would
      // display and do nothing when tapped.
      return const NotificationRoute('/my-purchases');
    case 'barrel_shipment_status':
    case 'freight_shipment_status':
    case 'freight_balance_due':
    case 'freight_refund_issued':
      final shipmentId = data['shipmentId']?.toString();
      return NotificationRoute(
        '/tracking',
        arguments: TrackingScreenArguments(shipmentId: shipmentId),
      );
    case 'parking_reservation_status':
    case 'transport_request_status':
      return const NotificationRoute('/orders');
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

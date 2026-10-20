import '../screens/business_requests_screen.dart'
    show BusinessRequestsArguments;
import '../screens/review_composer_screen.dart';
import '../screens/tracking_screen.dart';

/// Who is holding the phone. The same notification type can mean two
/// different screens: a parking status update sends a customer to their
/// Orders, but sends the lot that recorded the car to that car's details.
enum NotificationAudience { customer, business }

/// A business record to open by id. Several business detail screens want a
/// fully loaded model, so the route loads the document first
/// (BusinessRecordScreen) and then shows the right screen for it.
class BusinessRecordArguments {
  const BusinessRecordArguments({
    required this.collection,
    required this.id,
    this.fallbackCategory,
  });

  /// parkedCars | barrelShipments | transportRequests | freightShipments |
  /// freightQuoteRequests | carPurchases
  final String collection;
  final String id;

  /// Where to land when the record cannot be opened: the business home,
  /// filtered to this service (`parking`, `barrels`, `freight`, ...).
  final String? fallbackCategory;
}

/// The business home, opened on one service's list.
class BusinessHomeArguments {
  const BusinessHomeArguments({this.category});

  /// `parking` | `barrels` | `freight` | `transport` | `sales`
  final String? category;
}

/// The Inventory sales list, opened from a "Sale at ..." notification - or a
/// credit one ([kind] `credit`: a credit to collect, or one overdue).
class InventorySalesArguments {
  const InventorySalesArguments({this.saleId, this.storeId, this.kind});

  /// `credit` for a credit alert; null for a sale alert.
  final String? kind;

  /// The sale the notification was about.
  final String? saleId;

  /// The store it was rung up at ('' / null in a single-store business).
  final String? storeId;
}

/// Store transfers, opened from a transfer notification ("Bronx store sent
/// you 14 items", "2 items didn't arrive", a reminder): the transfers list,
/// opened on that transfer.
class InventoryTransfersArguments {
  const InventoryTransfersArguments({this.transferId, this.kind});

  /// The transfer the notification was about.
  final String? transferId;

  /// `sent` | `cancelled` | `differences` | `transit_reminder` |
  /// `dispute_reminder` (null when the payload has none).
  final String? kind;
}

/// The owner's "Bank for Zelle checks", opened from the monthly-limit
/// notice. [businessId] is '' when the payload has none (the signed-in
/// owner's business is used).
class BusinessBankArguments {
  const BusinessBankArguments({this.businessId = ''});

  final String businessId;
}

/// One package (container line) on the business side, opened by its code or
/// its line id - a "number isn't theirs" notification
/// (docs/PHONE_ACCOUNTS.md §6.1) names both.
class BusinessPackageArguments {
  const BusinessPackageArguments({this.lineId = '', this.trackingCode = ''});

  final String lineId;
  final String trackingCode;
}

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
  'package_request': 'packageRequests',
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
NotificationRoute? routeForNotificationData(
  Map<String, dynamic> data, {
  NotificationAudience audience = NotificationAudience.customer,
}) {
  final type = data['type']?.toString() ?? '';
  if (audience == NotificationAudience.business) {
    final business = _businessRouteForNotificationData(type, data);
    if (business != null) return business;
  }
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

String _firstNonEmpty(Map<String, dynamic> data, List<String> keys) {
  for (final key in keys) {
    final value = data[key]?.toString().trim() ?? '';
    if (value.isNotEmpty) return value;
  }
  return '';
}

NotificationRoute _businessRecord(
  String collection,
  String id,
  String fallbackCategory,
) {
  if (id.isEmpty) {
    return NotificationRoute(
      '/business-home',
      arguments: BusinessHomeArguments(category: fallbackCategory),
    );
  }
  return NotificationRoute(
    '/business-record',
    arguments: BusinessRecordArguments(
      collection: collection,
      id: id,
      fallbackCategory: fallbackCategory,
    ),
  );
}

/// The business side of the table. Every type the backend sends to a
/// business owner or staff member lands somewhere useful; before this only
/// customer types had routes, so a business tapping "You've been paid" or
/// "New transport opportunity" got nothing at all.
NotificationRoute? _businessRouteForNotificationData(
  String type,
  Map<String, dynamic> data,
) {
  switch (type) {
    case 'business_order_paid':
      final service = data['service']?.toString() ?? '';
      switch (service) {
        case 'parking':
        case 'business_parking_entry':
          return _businessRecord(
            'parkedCars',
            _firstNonEmpty(data, ['reservationId', 'requestId', 'recordId']),
            'parking',
          );
        case 'barrel':
        case 'barrels':
        case 'barrel_shipment':
          return _businessRecord(
            'barrelShipments',
            _firstNonEmpty(data, ['shipmentId', 'requestId', 'recordId']),
            'barrels',
          );
        case 'freight':
        case 'freight_shipment':
          return _businessRecord(
            'freightShipments',
            _firstNonEmpty(data, ['shipmentId', 'requestId', 'recordId']),
            'freight',
          );
        case 'transport':
        case 'transport_job':
          return _businessRecord(
            'transportRequests',
            _firstNonEmpty(data, ['requestId', 'recordId']),
            'transport',
          );
        case 'car_sales':
        case 'car_purchase':
        case 'sales':
          return const NotificationRoute('/purchase-management');
        default:
          return const NotificationRoute('/business-home');
      }
    // The 1st of the month: the month just ended, its bills ready to send.
    case 'parking_month_end':
      return NotificationRoute(
        '/business-parking-month-end',
        arguments: data['monthKey']?.toString() ?? '',
      );
    case 'parking_reservation_status':
      return _businessRecord(
        'parkedCars',
        _firstNonEmpty(data, ['reservationId', 'relatedId', 'recordId']),
        'parking',
      );
    case 'transport_opportunity':
    case 'transport_job_paid':
    case 'transport_request_status':
      return const NotificationRoute('/business-transport');
    case 'freight_quote_request':
    case 'freight_quote_won':
    case 'freight_quote_lost':
    case 'freight_shipment_status':
    case 'freight_balance_due':
      return const NotificationRoute(
        '/business-home',
        arguments: BusinessHomeArguments(category: 'freight'),
      );
    case 'barrel_shipment_status':
    case 'barrel_pool_deposit':
    case 'barrel_pool_join':
    case 'barrel_pool_balance_due':
    case 'deposit_refund_due':
      return const NotificationRoute(
        '/business-home',
        arguments: BusinessHomeArguments(category: 'barrels'),
      );
    case 'car_viewing_status':
    case 'car_purchase_status':
    case 'payment_hold_capture_notice':
    case 'secured_order_cancelled_by_business':
      return const NotificationRoute('/purchase-management');
    case 'business_support_request':
      return const NotificationRoute('/business-support');
    // "A customer says a number isn't theirs": the record whose number to
    // check, in the view staff fix it from.
    case 'phone_number_reported':
      return _phoneReportedRoute(data);
    // "New request from Fatou: 2 pieces", "... confirmed", "... said no":
    // the Requests view, opened on that request (§8.7).
    case 'package_request':
      return NotificationRoute(
        '/business-requests',
        arguments: BusinessRequestsArguments(
          requestId: _firstNonEmpty(data, ['requestId', 'relatedId']),
        ),
      );
    case 'business_verification_document':
    case 'business_verification_review':
    case 'business_application_status':
    case 'business_application':
      return const NotificationRoute('/business-profile');
    case 'review_request':
      // A business is told about a review left for it, not asked to write one.
      return const NotificationRoute('/business-reviews');
    // "Sale at Main store": someone else of the store rang up a sale. A
    // credit alert ("You collect $40.00 from ...", "... is overdue") opens
    // its sale the same way, whether it comes as an `inventory_sale` with
    // `kind: credit` or with a credit type of its own.
    case 'inventory_sale':
    case 'inventory_credit':
    case 'inventory_credit_assigned':
    case 'inventory_credit_overdue':
    case 'inventory_credit_payment':
      final saleId = _firstNonEmpty(data, ['saleId', 'relatedId']);
      final storeId = data['storeId']?.toString().trim() ?? '';
      final kind = data['kind']?.toString().trim() ?? '';
      final credit = kind == 'credit' || type.startsWith('inventory_credit');
      return NotificationRoute(
        '/inventory-sales',
        arguments: InventorySalesArguments(
          saleId: saleId.isEmpty ? null : saleId,
          storeId: storeId.isEmpty ? null : storeId,
          kind: credit ? 'credit' : null,
        ),
      );
    // "Bank checks hit this month's limit" (to the owner): the bank
    // settings, where the month's usage and the limit are.
    case 'bank_check_limit':
      final businessId = data['businessId']?.toString().trim() ?? '';
      return NotificationRoute(
        '/business-bank',
        arguments: BusinessBankArguments(businessId: businessId),
      );
    // A store transfer was sent, cancelled, came up short, or is waiting:
    // the transfers list, opened on that transfer.
    case 'inventory_transfer':
      final transferId = _firstNonEmpty(data, ['transferId', 'relatedId']);
      final kind = data['kind']?.toString().trim() ?? '';
      return NotificationRoute(
        '/inventory-transfers',
        arguments: InventoryTransfersArguments(
          transferId: transferId.isEmpty ? null : transferId,
          kind: kind.isEmpty ? null : kind,
        ),
      );
    default:
      return null; // support_* types share the customer routes below.
  }
}

NotificationRoute _phoneReportedRoute(Map<String, dynamic> data) {
  final collection = data['relatedCollection']?.toString().trim() ?? '';
  final id = data['relatedId']?.toString().trim() ?? '';
  final code = data['trackingCode']?.toString().trim() ?? '';
  switch (collection) {
    case 'containerLines':
      if (id.isEmpty && code.isEmpty) {
        return const NotificationRoute('/business-home');
      }
      return NotificationRoute(
        '/business-package',
        arguments: BusinessPackageArguments(lineId: id, trackingCode: code),
      );
    case 'parkedCars':
      return _businessRecord('parkedCars', id, 'parking');
    case 'barrelShipments':
      return _businessRecord('barrelShipments', id, 'barrels');
    case 'transportRequests':
      return _businessRecord('transportRequests', id, 'transport');
    case 'freightShipments':
    case 'freightQuoteRequests':
      return const NotificationRoute(
        '/business-home',
        arguments: BusinessHomeArguments(category: 'freight'),
      );
    case 'packageRequests':
      return NotificationRoute(
        '/business-requests',
        arguments: BusinessRequestsArguments(requestId: id),
      );
    default:
      return const NotificationRoute('/business-home');
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

/// What to do with a notification tap at this moment.
enum NotificationTapAction {
  /// Keep it: the first real screen is not up yet, or it is not yet known
  /// whether the person holding the phone is a customer or a business.
  wait,

  /// Open [NotificationTapDecision.route] now.
  open,

  /// Nothing in the payload is ours to open.
  ignore,
}

class NotificationTapDecision {
  const NotificationTapDecision.wait()
    : action = NotificationTapAction.wait,
      route = null;
  const NotificationTapDecision.ignore()
    : action = NotificationTapAction.ignore,
      route = null;
  const NotificationTapDecision.open(NotificationRoute this.route)
    : action = NotificationTapAction.open;

  final NotificationTapAction action;
  final NotificationRoute? route;
}

/// Whether a tap can be opened now.
///
/// A tap that launched the app arrives before the splash screen has settled
/// auth. Pushing it then puts it under the splash's own navigation to home,
/// and routing it before the role is known sends a lot's staff to customer
/// screens. So it waits for both: [appReady] (the splash has navigated to the
/// first real screen) and [audience] (null while the role is still loading).
NotificationTapDecision decideNotificationTap(
  Map<String, dynamic> data, {
  required bool appReady,
  required NotificationAudience? audience,
}) {
  if (!appReady || audience == null) {
    return const NotificationTapDecision.wait();
  }
  final route = routeForNotificationData(data, audience: audience);
  return route == null
      ? const NotificationTapDecision.ignore()
      : NotificationTapDecision.open(route);
}

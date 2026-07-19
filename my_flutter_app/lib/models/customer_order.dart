import 'package:cloud_firestore/cloud_firestore.dart';

import 'barrel_shipment.dart';
import 'parked_car.dart';
import 'transport_request.dart';

/// The kind of thing a customer paid for. New paid services become a new value
/// here — never a new history screen.
enum OrderType { car, barrel, freight, transport, parking }

enum CustomerTrackingType { barrel, freight }

class CustomerTrackingShipment {
  const CustomerTrackingShipment({
    required this.id,
    required this.type,
    required this.trackingCode,
    required this.receiverName,
    required this.destinationCountryName,
    required this.businessName,
    required this.price,
    required this.status,
    required this.paymentStatus,
    required this.createdAt,
    this.mode = '',
    this.weightKg = 0,
    this.estimatedWeightKg = 0,
    this.verifiedWeightKg,
    this.estimatedTotal = 0,
    this.finalTotal,
    this.priceSettlementStatus = '',
    this.balanceDue = 0,
    this.refundDue = 0,
    this.barrelShipment,
  });

  final String id;
  final CustomerTrackingType type;
  final String trackingCode;
  final String receiverName;
  final String destinationCountryName;
  final String businessName;
  final double price;
  final String status;
  final String paymentStatus;
  final DateTime createdAt;
  final String mode;
  final double weightKg;
  final double estimatedWeightKg;
  final double? verifiedWeightKg;
  final double estimatedTotal;
  final double? finalTotal;
  final String priceSettlementStatus;
  final double balanceDue;
  final double refundDue;
  final BarrelShipment? barrelShipment;

  bool get isFreight => type == CustomerTrackingType.freight;

  factory CustomerTrackingShipment.fromBarrel(OrderDoc doc) {
    final shipment = BarrelShipment.fromFirestore(doc);
    return CustomerTrackingShipment(
      id: shipment.id,
      type: CustomerTrackingType.barrel,
      trackingCode: shipment.trackingCode,
      receiverName: shipment.receiverName,
      destinationCountryName: shipment.destinationCountryName,
      businessName: shipment.businessName,
      price: shipment.price,
      status: shipment.status,
      paymentStatus: shipment.paymentStatus,
      createdAt: shipment.createdAt,
      barrelShipment: shipment,
    );
  }

  factory CustomerTrackingShipment.fromFreight(OrderDoc doc) {
    return CustomerTrackingShipment.fromFreightData(doc.id, doc.data() ?? {});
  }

  factory CustomerTrackingShipment.fromFreightData(
    String id,
    Map<String, dynamic> data,
  ) {
    String text(String key, [String fallback = '']) {
      final value = data[key];
      return value is String && value.trim().isNotEmpty
          ? value.trim()
          : fallback;
    }

    final createdAt = data['createdAt'];
    return CustomerTrackingShipment(
      id: id,
      type: CustomerTrackingType.freight,
      trackingCode: text('trackingCode', id),
      receiverName: text('receiverName'),
      destinationCountryName: text('destinationCountryName'),
      businessName: text('businessName'),
      price: (data['price'] as num?)?.toDouble() ?? 0,
      status: text('status', 'pending'),
      paymentStatus: text('paymentStatus', 'not_required'),
      createdAt: createdAt is Timestamp
          ? createdAt.toDate()
          : DateTime.fromMillisecondsSinceEpoch(0),
      mode: text('mode'),
      weightKg: (data['weightKg'] as num?)?.toDouble() ?? 0,
      estimatedWeightKg:
          (data['estimatedWeightKg'] as num?)?.toDouble() ??
          (data['weightKg'] as num?)?.toDouble() ??
          0,
      verifiedWeightKg: (data['verifiedWeightKg'] as num?)?.toDouble(),
      estimatedTotal:
          (data['estimatedTotal'] as num?)?.toDouble() ??
          (data['price'] as num?)?.toDouble() ??
          0,
      finalTotal: (data['finalTotal'] as num?)?.toDouble(),
      priceSettlementStatus: text('priceSettlementStatus'),
      balanceDue: (data['balanceDue'] as num?)?.toDouble() ?? 0,
      refundDue: (data['refundDue'] as num?)?.toDouble() ?? 0,
    );
  }
}

/// A status set normalized across every source collection so one filter works
/// for all order types.
enum OrderStatus { pending, active, inTransit, completed, cancelled, refunded }

typedef OrderDoc = DocumentSnapshot<Map<String, dynamic>>;

/// A normalized view of any paid transaction, built from a source collection's
/// raw document. Pure (no Firestore calls) so the mapping is unit-testable.
class CustomerOrder {
  const CustomerOrder({
    required this.id,
    required this.type,
    required this.title,
    required this.subtitle,
    required this.businessName,
    required this.businessId,
    required this.relatedCollection,
    required this.relatedId,
    required this.amount,
    required this.currency,
    required this.status,
    required this.createdAt,
    required this.detailRoute,
    this.detailArgument,
    this.trackable = false,
    this.trackingCode,
  });

  final String id;
  final OrderType type;
  final String title;
  final String subtitle;
  final String businessName;
  final String businessId;
  final String relatedCollection;
  final String relatedId;
  final double amount;
  final String currency;
  final OrderStatus status;
  final DateTime createdAt;

  /// Named route for the detail screen, or null if none exists yet.
  final String? detailRoute;
  final Object? detailArgument;
  final bool trackable;
  final String? trackingCode;

  bool get hasDetail => detailRoute != null;

  static double _amount(Map<String, dynamic> d, List<String> keys) {
    for (final key in keys) {
      final value = d[key];
      if (value is num) return value.toDouble();
    }
    return 0;
  }

  static DateTime _date(Map<String, dynamic> d, String key) {
    final value = d[key];
    if (value is Timestamp) return value.toDate();
    return DateTime.fromMillisecondsSinceEpoch(0);
  }

  static String _str(
    Map<String, dynamic> d,
    String key, [
    String fallback = '',
  ]) {
    final value = d[key];
    return value is String && value.trim().isNotEmpty ? value.trim() : fallback;
  }

  /// Normalize the many per-collection status strings into one set.
  static OrderStatus normalizeStatus(String raw) {
    switch (raw) {
      case 'in_transit':
        return OrderStatus.inTransit;
      case 'completed':
      case 'sold':
      case 'paid':
      case 'succeeded':
        return OrderStatus.completed;
      case 'cancelled':
      case 'canceled':
        return OrderStatus.cancelled;
      case 'refunded':
      case 'refund_pending':
        return OrderStatus.refunded;
      case 'active':
      case 'reserved':
      case 'hold':
        return OrderStatus.active;
      default:
        return OrderStatus.pending;
    }
  }

  factory CustomerOrder.fromCarPurchase(OrderDoc doc) {
    final d = doc.data() ?? const {};
    final statusRaw = _str(d, 'purchaseStatus', _str(d, 'paymentStatus'));
    return CustomerOrder(
      id: doc.id,
      type: OrderType.car,
      title: _str(d, 'carTitle', 'Car purchase'),
      subtitle: _str(d, 'destinationCountryName'),
      businessName: _str(d, 'businessName'),
      businessId: _str(d, 'businessId'),
      relatedCollection: 'carPurchases',
      relatedId: doc.id,
      amount: _amount(d, ['depositAmount', 'price', 'amount']),
      currency: _str(d, 'depositCurrency', 'usd'),
      status: normalizeStatus(statusRaw),
      createdAt: _date(d, 'createdAt'),
      detailRoute: '/my-purchases',
    );
  }

  factory CustomerOrder.fromFreight(OrderDoc doc) {
    final d = doc.data() ?? const {};
    final weight = _amount(d, ['weightKg']);
    final mode = _str(d, 'mode');
    return CustomerOrder(
      id: doc.id,
      type: OrderType.freight,
      title: weight > 0
          ? '${weight.toStringAsFixed(1)} kg → ${_str(d, 'destinationCountryName')}'
          : 'Freight → ${_str(d, 'destinationCountryName')}',
      subtitle: mode.isEmpty ? _str(d, 'receiverName') : mode,
      businessName: _str(d, 'businessName'),
      businessId: _str(d, 'businessId'),
      relatedCollection: 'freightShipments',
      relatedId: doc.id,
      amount: _amount(d, ['price']),
      currency: 'usd',
      status: normalizeStatus(_str(d, 'status')),
      createdAt: _date(d, 'createdAt'),
      detailRoute: null,
      trackable: true,
      trackingCode: _str(d, 'trackingCode'),
    );
  }

  factory CustomerOrder.fromTransport(OrderDoc doc) {
    final d = doc.data() ?? const {};
    final car = [
      _str(d, 'carYear'),
      _str(d, 'carMake'),
      _str(d, 'carModel'),
    ].where((s) => s.isNotEmpty).join(' ');
    return CustomerOrder(
      id: doc.id,
      type: OrderType.transport,
      title: car.isEmpty
          ? 'Car transport → ${_str(d, 'destinationCountryName')}'
          : '$car → ${_str(d, 'destinationCountryName')}',
      subtitle: _str(d, 'destinationCountryName'),
      businessName: _str(d, 'businessName'),
      businessId: _str(d, 'businessId'),
      relatedCollection: 'transportRequests',
      relatedId: doc.id,
      amount: _amount(d, ['price']),
      currency: 'usd',
      status: normalizeStatus(_str(d, 'status')),
      createdAt: _date(d, 'createdAt'),
      detailRoute: '/transport-request-details',
      detailArgument: TransportRequest.fromFirestore(doc),
      trackable: true,
      trackingCode: _str(d, 'trackingCode'),
    );
  }

  factory CustomerOrder.fromParking(OrderDoc doc) {
    final d = doc.data() ?? const {};
    final car = [
      _str(d, 'carYear'),
      _str(d, 'carMake'),
      _str(d, 'carModel'),
    ].where((s) => s.isNotEmpty).join(' ');
    return CustomerOrder(
      id: doc.id,
      type: OrderType.parking,
      title: car.isEmpty ? _str(d, 'trackingCode') : car,
      subtitle: _str(d, 'parkingCity'),
      businessName: _str(d, 'businessName'),
      businessId: _str(d, 'businessId'),
      relatedCollection: 'parkedCars',
      relatedId: doc.id,
      amount: _amount(d, ['depositAmount', 'totalCost']),
      currency: _str(d, 'currency', 'usd'),
      status: normalizeStatus(_str(d, 'status', _str(d, 'paymentStatus'))),
      createdAt: _date(d, 'createdAt'),
      detailRoute: '/parked-car-details',
      detailArgument: ParkedCar.fromFirestore(doc),
      trackable: true,
      trackingCode: _str(d, 'trackingCode'),
    );
  }

  /// Barrels are grouped by their order (a multi-destination order is one row).
  static CustomerOrder fromBarrelGroup(List<OrderDoc> docs) {
    final sorted = [...docs]
      ..sort(
        (a, b) => _date(
          b.data() ?? const {},
          'createdAt',
        ).compareTo(_date(a.data() ?? const {}, 'createdAt')),
      );
    final first = sorted.first;
    final d = first.data() ?? const {};
    final totalBarrels = sorted.fold<int>(
      0,
      (total, doc) => total + ((doc.data()?['quantity'] as num?)?.toInt() ?? 1),
    );
    final destinations = <String>{
      for (final doc in sorted)
        _str(doc.data() ?? const {}, 'destinationCountryName'),
    }.where((s) => s.isNotEmpty).toList();
    final amount = sorted.fold<double>(
      0,
      (total, doc) => total + _amount(doc.data() ?? const {}, ['price']),
    );
    final destinationLabel = destinations.length <= 1
        ? (destinations.isEmpty ? '' : destinations.first)
        : '${destinations.length} destinations';
    return CustomerOrder(
      id: _str(d, 'orderId', first.id),
      type: OrderType.barrel,
      title:
          '$totalBarrels barrel${totalBarrels == 1 ? '' : 's'}'
          '${destinationLabel.isEmpty ? '' : ' → $destinationLabel'}',
      subtitle: _str(d, 'receiverName'),
      businessName: _str(d, 'businessName'),
      businessId: _str(d, 'businessId'),
      relatedCollection: 'barrelShipments',
      relatedId: first.id,
      amount: amount,
      currency: 'usd',
      status: normalizeStatus(_str(d, 'status')),
      createdAt: _date(d, 'createdAt'),
      // Single-shipment orders open the shipment detail; multi-destination
      // orders are best viewed in Tracking.
      detailRoute: sorted.length == 1 ? '/barrel-shipment-details' : null,
      detailArgument: sorted.length == 1
          ? BarrelShipment.fromFirestore(first)
          : null,
      trackable: true,
      trackingCode: _str(d, 'trackingCode'),
    );
  }
}

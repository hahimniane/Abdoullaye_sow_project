import 'package:cloud_firestore/cloud_firestore.dart';

class BarrelShipment {
  BarrelShipment({
    required this.id,
    required this.trackingCode,
    required this.senderName,
    required this.senderAddress,
    required this.receiverName,
    required this.receiverPhone,
    this.destinationCountryId = 'guinea',
    this.destinationCountryName = 'Guinea',
    this.businessId = 'keren_auto_sales',
    this.businessName = 'Keren',
    this.customerUid,
    this.customerEmail,
    this.pickupRequested = false,
    this.pickupAddress = '',
    this.pickupBorough = '',
    this.pickupMiles = 0,
    this.pickupFee = 0,
    this.shippingFee = 0,
    this.unitShippingFee,
    this.quantity = 1,
    this.totalWeightKg,
    this.contentsNote,
    this.deliveryEstimateMinDays,
    this.deliveryEstimateMaxDays,
    this.deliveryEstimateLabel,
    this.pricingPendingReview = false,
    this.pickupDateTime,
    this.paymentStatus = 'not_required',
    this.paymentHoldStatus = '',
    this.checkoutStatus = '',
    this.stripePaymentIntentId,
    this.orderId,
    this.platformFeeCents = 0,
    this.businessPayoutCents = 0,
    this.payoutStatus = '',
    this.payoutTransferId,
    required this.price,
    required this.status,
    required this.createdAt,
    this.containerNumber = '',
    this.carrierScac = '',
    this.trackingProvider = '',
  });

  final String id;
  final String trackingCode;
  final String senderName;
  final String senderAddress;
  final String receiverName;
  final String receiverPhone;
  final String destinationCountryId;
  final String destinationCountryName;
  final String businessId;
  final String businessName;
  final String? customerUid;
  final String? customerEmail;
  final bool pickupRequested;
  final String pickupAddress;
  final String pickupBorough;
  final double pickupMiles;
  final double pickupFee;
  final double shippingFee;
  final double? unitShippingFee;
  final int quantity;
  final double? totalWeightKg;
  final String? contentsNote;
  final int? deliveryEstimateMinDays;
  final int? deliveryEstimateMaxDays;
  final String? deliveryEstimateLabel;
  final bool pricingPendingReview;
  final DateTime? pickupDateTime;
  final String paymentStatus;

  /// "held" while the money is only reserved on the card; cancelling then is
  /// free. Empty or "captured" once charged.
  final String paymentHoldStatus;
  final String checkoutStatus;
  final String? stripePaymentIntentId;
  final String? orderId;
  final int platformFeeCents;
  final int businessPayoutCents;
  final String payoutStatus;
  final String? payoutTransferId;
  final double price;
  final String status;
  final DateTime createdAt;
  // Sea container tracking (Phase 2): empty when no automated tracking has
  // been started - staff can still add manual milestones regardless.
  final String containerNumber;
  final String carrierScac;
  final String trackingProvider; // '' (manual) | 'carrier_api'

  bool get hasAutomatedTracking => trackingProvider == 'carrier_api';

  /// Wire shape `checkoutResumeTarget` shares with the web console.
  Map<String, dynamic> get checkoutResumeRecord => {
    'id': id,
    'relatedCollection': 'barrelShipments',
    'status': status,
    'paymentStatus': paymentStatus,
    'checkoutStatus': checkoutStatus,
    'orderId': orderId ?? '',
  };

  factory BarrelShipment.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return BarrelShipment(
      id: doc.id,
      trackingCode: (data['trackingCode'] as String?)?.trim().isNotEmpty == true
          ? (data['trackingCode'] as String).trim()
          : doc.id,
      senderName: (data['senderName'] ?? '') as String,
      senderAddress: (data['senderAddress'] ?? '') as String,
      receiverName: (data['receiverName'] ?? '') as String,
      receiverPhone: (data['receiverPhone'] ?? '') as String,
      destinationCountryId:
          (data['destinationCountryId'] ?? 'guinea') as String,
      destinationCountryName:
          (data['destinationCountryName'] ?? 'Guinea') as String,
      businessId: (data['businessId'] ?? 'keren_auto_sales') as String,
      businessName: (data['businessName'] ?? 'Keren') as String,
      customerUid: data['customerUid'] as String?,
      customerEmail: data['customerEmail'] as String?,
      pickupRequested: data['pickupRequested'] == true,
      pickupAddress: (data['pickupAddress'] ?? '') as String,
      pickupBorough: (data['pickupBorough'] ?? '') as String,
      pickupMiles: (data['pickupMiles'] as num?)?.toDouble() ?? 0,
      pickupFee: (data['pickupFee'] as num?)?.toDouble() ?? 0,
      shippingFee: (data['shippingFee'] as num?)?.toDouble() ?? 0,
      unitShippingFee: (data['unitShippingFee'] as num?)?.toDouble(),
      quantity: (data['quantity'] as num?)?.toInt() ?? 1,
      totalWeightKg: (data['totalWeightKg'] as num?)?.toDouble(),
      contentsNote: data['contentsNote'] as String?,
      deliveryEstimateMinDays: (data['deliveryEstimateMinDays'] as num?)
          ?.toInt(),
      deliveryEstimateMaxDays: (data['deliveryEstimateMaxDays'] as num?)
          ?.toInt(),
      deliveryEstimateLabel: data['deliveryEstimateLabel'] as String?,
      pricingPendingReview: data['pricingPendingReview'] == true,
      pickupDateTime: (data['pickupDateTime'] as Timestamp?)?.toDate(),
      paymentStatus: (data['paymentStatus'] ?? 'not_required') as String,
      checkoutStatus: (data['checkoutStatus'] ?? '') as String,
      stripePaymentIntentId: data['stripePaymentIntentId'] as String?,
      orderId: data['orderId'] as String?,
      paymentHoldStatus: (data['paymentHoldStatus'] as String?) ?? '',
      platformFeeCents: (data['platformFeeCents'] as num?)?.toInt() ?? 0,
      businessPayoutCents:
          (data['businessPayoutCents'] as num?)?.toInt() ??
          (data['businessPayoutAmountCents'] as num?)?.toInt() ??
          0,
      payoutStatus: (data['payoutStatus'] ?? '') as String,
      payoutTransferId: data['payoutTransferId'] as String?,
      price: (data['price'] as num?)?.toDouble() ?? 0,
      status: (data['status'] ?? 'pending') as String,
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      containerNumber: (data['containerNumber'] ?? '') as String,
      carrierScac: (data['carrierScac'] ?? '') as String,
      trackingProvider: (data['trackingProvider'] ?? '') as String,
    );
  }

  BarrelShipment copyWith({
    String? id,
    String? trackingCode,
    String? senderName,
    String? senderAddress,
    String? receiverName,
    String? receiverPhone,
    String? destinationCountryId,
    String? destinationCountryName,
    String? businessId,
    String? businessName,
    String? customerUid,
    String? customerEmail,
    bool? pickupRequested,
    String? pickupAddress,
    String? pickupBorough,
    double? pickupMiles,
    double? pickupFee,
    double? shippingFee,
    double? unitShippingFee,
    int? quantity,
    double? totalWeightKg,
    String? contentsNote,
    int? deliveryEstimateMinDays,
    int? deliveryEstimateMaxDays,
    String? deliveryEstimateLabel,
    bool? pricingPendingReview,
    DateTime? pickupDateTime,
    String? paymentStatus,
    String? checkoutStatus,
    String? stripePaymentIntentId,
    String? orderId,
    int? platformFeeCents,
    int? businessPayoutCents,
    String? payoutStatus,
    String? payoutTransferId,
    double? price,
    String? status,
    DateTime? createdAt,
  }) {
    return BarrelShipment(
      id: id ?? this.id,
      trackingCode: trackingCode ?? this.trackingCode,
      senderName: senderName ?? this.senderName,
      senderAddress: senderAddress ?? this.senderAddress,
      receiverName: receiverName ?? this.receiverName,
      receiverPhone: receiverPhone ?? this.receiverPhone,
      destinationCountryId: destinationCountryId ?? this.destinationCountryId,
      destinationCountryName:
          destinationCountryName ?? this.destinationCountryName,
      businessId: businessId ?? this.businessId,
      businessName: businessName ?? this.businessName,
      customerUid: customerUid ?? this.customerUid,
      customerEmail: customerEmail ?? this.customerEmail,
      pickupRequested: pickupRequested ?? this.pickupRequested,
      pickupAddress: pickupAddress ?? this.pickupAddress,
      pickupBorough: pickupBorough ?? this.pickupBorough,
      pickupMiles: pickupMiles ?? this.pickupMiles,
      pickupFee: pickupFee ?? this.pickupFee,
      shippingFee: shippingFee ?? this.shippingFee,
      unitShippingFee: unitShippingFee ?? this.unitShippingFee,
      quantity: quantity ?? this.quantity,
      totalWeightKg: totalWeightKg ?? this.totalWeightKg,
      contentsNote: contentsNote ?? this.contentsNote,
      deliveryEstimateMinDays:
          deliveryEstimateMinDays ?? this.deliveryEstimateMinDays,
      deliveryEstimateMaxDays:
          deliveryEstimateMaxDays ?? this.deliveryEstimateMaxDays,
      deliveryEstimateLabel:
          deliveryEstimateLabel ?? this.deliveryEstimateLabel,
      pricingPendingReview: pricingPendingReview ?? this.pricingPendingReview,
      pickupDateTime: pickupDateTime ?? this.pickupDateTime,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      checkoutStatus: checkoutStatus ?? this.checkoutStatus,
      stripePaymentIntentId:
          stripePaymentIntentId ?? this.stripePaymentIntentId,
      orderId: orderId ?? this.orderId,
      platformFeeCents: platformFeeCents ?? this.platformFeeCents,
      businessPayoutCents: businessPayoutCents ?? this.businessPayoutCents,
      payoutStatus: payoutStatus ?? this.payoutStatus,
      payoutTransferId: payoutTransferId ?? this.payoutTransferId,
      price: price ?? this.price,
      status: status ?? this.status,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'trackingCode': trackingCode,
      'senderName': senderName,
      'senderAddress': senderAddress,
      'receiverName': receiverName,
      'receiverPhone': receiverPhone,
      'destinationCountryId': destinationCountryId,
      'destinationCountryName': destinationCountryName,
      'businessId': businessId,
      'businessName': businessName,
      if (customerUid != null) 'customerUid': customerUid,
      if (customerEmail != null) 'customerEmail': customerEmail,
      'pickupRequested': pickupRequested,
      'pickupAddress': pickupAddress,
      'pickupBorough': pickupBorough,
      'pickupMiles': pickupMiles,
      'pickupFee': pickupFee,
      'shippingFee': shippingFee,
      if (unitShippingFee != null) 'unitShippingFee': unitShippingFee,
      'quantity': quantity,
      if (totalWeightKg != null) 'totalWeightKg': totalWeightKg,
      if (contentsNote != null) 'contentsNote': contentsNote,
      if (deliveryEstimateMinDays != null)
        'deliveryEstimateMinDays': deliveryEstimateMinDays,
      if (deliveryEstimateMaxDays != null)
        'deliveryEstimateMaxDays': deliveryEstimateMaxDays,
      if (deliveryEstimateLabel != null)
        'deliveryEstimateLabel': deliveryEstimateLabel,
      'pricingPendingReview': pricingPendingReview,
      if (pickupDateTime != null)
        'pickupDateTime': Timestamp.fromDate(pickupDateTime!),
      'paymentStatus': paymentStatus,
      if (stripePaymentIntentId != null)
        'stripePaymentIntentId': stripePaymentIntentId,
      if (orderId != null) 'orderId': orderId,
      'platformFeeCents': platformFeeCents,
      'businessPayoutCents': businessPayoutCents,
      'payoutStatus': payoutStatus,
      if (payoutTransferId != null) 'payoutTransferId': payoutTransferId,
      'price': price,
      'status': status,
      'createdAt': Timestamp.fromDate(createdAt),
    };
  }
}

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
    this.customerUid,
    this.customerEmail,
    this.pickupRequested = false,
    this.pickupAddress = '',
    this.pickupBorough = '',
    this.pickupMiles = 0,
    this.pickupFee = 0,
    this.shippingFee = 0,
    this.pricingPendingReview = false,
    this.pickupDateTime,
    this.paymentStatus = 'not_required',
    this.stripePaymentIntentId,
    required this.price,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String trackingCode;
  final String senderName;
  final String senderAddress;
  final String receiverName;
  final String receiverPhone;
  final String destinationCountryId;
  final String destinationCountryName;
  final String? customerUid;
  final String? customerEmail;
  final bool pickupRequested;
  final String pickupAddress;
  final String pickupBorough;
  final double pickupMiles;
  final double pickupFee;
  final double shippingFee;
  final bool pricingPendingReview;
  final DateTime? pickupDateTime;
  final String paymentStatus;
  final String? stripePaymentIntentId;
  final double price;
  final String status;
  final DateTime createdAt;

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
      customerUid: data['customerUid'] as String?,
      customerEmail: data['customerEmail'] as String?,
      pickupRequested: data['pickupRequested'] == true,
      pickupAddress: (data['pickupAddress'] ?? '') as String,
      pickupBorough: (data['pickupBorough'] ?? '') as String,
      pickupMiles: (data['pickupMiles'] as num?)?.toDouble() ?? 0,
      pickupFee: (data['pickupFee'] as num?)?.toDouble() ?? 0,
      shippingFee: (data['shippingFee'] as num?)?.toDouble() ?? 0,
      pricingPendingReview: data['pricingPendingReview'] == true,
      pickupDateTime: (data['pickupDateTime'] as Timestamp?)?.toDate(),
      paymentStatus: (data['paymentStatus'] ?? 'not_required') as String,
      stripePaymentIntentId: data['stripePaymentIntentId'] as String?,
      price: (data['price'] as num?)?.toDouble() ?? 0,
      status: (data['status'] ?? 'pending') as String,
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
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
    String? customerUid,
    String? customerEmail,
    bool? pickupRequested,
    String? pickupAddress,
    String? pickupBorough,
    double? pickupMiles,
    double? pickupFee,
    double? shippingFee,
    bool? pricingPendingReview,
    DateTime? pickupDateTime,
    String? paymentStatus,
    String? stripePaymentIntentId,
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
      customerUid: customerUid ?? this.customerUid,
      customerEmail: customerEmail ?? this.customerEmail,
      pickupRequested: pickupRequested ?? this.pickupRequested,
      pickupAddress: pickupAddress ?? this.pickupAddress,
      pickupBorough: pickupBorough ?? this.pickupBorough,
      pickupMiles: pickupMiles ?? this.pickupMiles,
      pickupFee: pickupFee ?? this.pickupFee,
      shippingFee: shippingFee ?? this.shippingFee,
      pricingPendingReview: pricingPendingReview ?? this.pricingPendingReview,
      pickupDateTime: pickupDateTime ?? this.pickupDateTime,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      stripePaymentIntentId:
          stripePaymentIntentId ?? this.stripePaymentIntentId,
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
      if (customerUid != null) 'customerUid': customerUid,
      if (customerEmail != null) 'customerEmail': customerEmail,
      'pickupRequested': pickupRequested,
      'pickupAddress': pickupAddress,
      'pickupBorough': pickupBorough,
      'pickupMiles': pickupMiles,
      'pickupFee': pickupFee,
      'shippingFee': shippingFee,
      'pricingPendingReview': pricingPendingReview,
      if (pickupDateTime != null)
        'pickupDateTime': Timestamp.fromDate(pickupDateTime!),
      'paymentStatus': paymentStatus,
      if (stripePaymentIntentId != null)
        'stripePaymentIntentId': stripePaymentIntentId,
      'price': price,
      'status': status,
      'createdAt': Timestamp.fromDate(createdAt),
    };
  }
}

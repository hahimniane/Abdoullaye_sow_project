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
      'price': price,
      'status': status,
      'createdAt': Timestamp.fromDate(createdAt),
    };
  }
}

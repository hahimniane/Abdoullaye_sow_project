import 'package:cloud_firestore/cloud_firestore.dart';

class TransportRequest {
  TransportRequest({
    required this.id,
    required this.trackingCode,
    required this.ownerName,
    required this.carMake,
    required this.carModel,
    required this.carYear,
    required this.vinNumber,
    this.destinationCountryId = 'guinea',
    this.destinationCountryName = 'Guinea',
    required this.transportDate,
    required this.price,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String trackingCode;
  final String ownerName;
  final String carMake;
  final String carModel;
  final String carYear;
  final String vinNumber;
  final String destinationCountryId;
  final String destinationCountryName;
  final DateTime transportDate;
  final double price;
  final String status;
  final DateTime createdAt;

  factory TransportRequest.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return TransportRequest(
      id: doc.id,
      trackingCode: (data['trackingCode'] as String?)?.trim().isNotEmpty == true
          ? (data['trackingCode'] as String).trim()
          : doc.id,
      ownerName: (data['ownerName'] ?? '') as String,
      carMake: (data['carMake'] ?? '') as String,
      carModel: (data['carModel'] ?? '') as String,
      carYear: (data['carYear'] ?? '') as String,
      vinNumber: (data['vinNumber'] ?? '') as String,
      destinationCountryId:
          (data['destinationCountryId'] ?? 'guinea') as String,
      destinationCountryName:
          (data['destinationCountryName'] ?? 'Guinea') as String,
      transportDate: (data['transportDate'] as Timestamp).toDate(),
      price: (data['price'] as num?)?.toDouble() ?? 0,
      status: (data['status'] ?? 'pending') as String,
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'trackingCode': trackingCode,
      'ownerName': ownerName,
      'carMake': carMake,
      'carModel': carModel,
      'carYear': carYear,
      'vinNumber': vinNumber,
      'destinationCountryId': destinationCountryId,
      'destinationCountryName': destinationCountryName,
      'transportDate': Timestamp.fromDate(transportDate),
      'price': price,
      'status': status,
      'createdAt': Timestamp.fromDate(createdAt),
    };
  }

  TransportRequest copyWith({
    String? id,
    String? trackingCode,
    String? ownerName,
    String? carMake,
    String? carModel,
    String? carYear,
    String? vinNumber,
    String? destinationCountryId,
    String? destinationCountryName,
    DateTime? transportDate,
    double? price,
    String? status,
    DateTime? createdAt,
  }) {
    return TransportRequest(
      id: id ?? this.id,
      trackingCode: trackingCode ?? this.trackingCode,
      ownerName: ownerName ?? this.ownerName,
      carMake: carMake ?? this.carMake,
      carModel: carModel ?? this.carModel,
      carYear: carYear ?? this.carYear,
      vinNumber: vinNumber ?? this.vinNumber,
      destinationCountryId: destinationCountryId ?? this.destinationCountryId,
      destinationCountryName:
          destinationCountryName ?? this.destinationCountryName,
      transportDate: transportDate ?? this.transportDate,
      price: price ?? this.price,
      status: status ?? this.status,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}

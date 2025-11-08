import 'package:cloud_firestore/cloud_firestore.dart';

class ParkedCar {
  final String id;
  final String trackingCode;
  final String ownerName;
  final String carMake;
  final String carModel;
  final String carYear;
  final String vinNumber;
  final DateTime parkingDate;
  final String status;
  final DateTime? parkingEndDate;
  final double? totalCost;

  ParkedCar({
    required this.id,
    required this.trackingCode,
    required this.ownerName,
    required this.carMake,
    required this.carModel,
    required this.carYear,
    required this.vinNumber,
    required this.parkingDate,
    this.status = 'active',
    this.parkingEndDate,
    this.totalCost,
  });

  factory ParkedCar.fromFirestore(DocumentSnapshot doc) {
    Map data = doc.data() as Map<String, dynamic>;
    return ParkedCar(
      id: doc.id,
      trackingCode: (data['trackingCode'] as String?)?.trim().isNotEmpty == true
          ? (data['trackingCode'] as String).trim()
          : doc.id,
      ownerName: data['ownerName'] ?? '',
      carMake: data['carMake'] ?? '',
      carModel: data['carModel'] ?? '',
      carYear: data['carYear'] ?? '',
      vinNumber: data['vinNumber'] ?? '',
      parkingDate: (data['parkingDate'] as Timestamp).toDate(),
      status: data['status'] ?? 'active',
      parkingEndDate: data['parkingEndDate'] != null
          ? (data['parkingEndDate'] as Timestamp).toDate()
          : null,
      totalCost: (data['totalCost'] as num?)?.toDouble(),
    );
  }

  Map<String, dynamic> toFirestore() {
    final data = {
      'trackingCode': trackingCode,
      'ownerName': ownerName,
      'carMake': carMake,
      'carModel': carModel,
      'carYear': carYear,
      'vinNumber': vinNumber,
      'parkingDate': Timestamp.fromDate(parkingDate),
      'status': status,
    };
    if (parkingEndDate != null) {
      data['parkingEndDate'] = Timestamp.fromDate(parkingEndDate!);
    }
    if (totalCost != null) {
      data['totalCost'] = totalCost!;
    }
    return data;
  }

  ParkedCar copyWith({
    String? id,
    String? trackingCode,
    String? ownerName,
    String? carMake,
    String? carModel,
    String? carYear,
    String? vinNumber,
    DateTime? parkingDate,
    String? status,
    DateTime? parkingEndDate,
    double? totalCost,
  }) {
    return ParkedCar(
      id: id ?? this.id,
      trackingCode: trackingCode ?? this.trackingCode,
      ownerName: ownerName ?? this.ownerName,
      carMake: carMake ?? this.carMake,
      carModel: carModel ?? this.carModel,
      carYear: carYear ?? this.carYear,
      vinNumber: vinNumber ?? this.vinNumber,
      parkingDate: parkingDate ?? this.parkingDate,
      status: status ?? this.status,
      parkingEndDate: parkingEndDate ?? this.parkingEndDate,
      totalCost: totalCost ?? this.totalCost,
    );
  }
}

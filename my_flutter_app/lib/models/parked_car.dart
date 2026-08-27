import 'package:cloud_firestore/cloud_firestore.dart';

import '../services/business_parking_entry.dart';

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

  /// Server-owned fields for a walk-up the lot entered itself
  /// (docs/PLAN-2026-08-backlog.md item 5). They are read here and never
  /// written back: `createBusinessParkingEntry` and `markBusinessParkingPaid`
  /// own them, and a client that echoed them could contradict Stripe.
  final Map<String, dynamic> paymentFields;

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
    this.paymentFields = const <String, dynamic>{},
  });

  /// True when the lot entered this car itself rather than a customer booking
  /// it.
  bool get isBusinessEntered => isBusinessEnteredParking(paymentFields);

  /// True when "Mark payment received" applies - a direct entry still waiting
  /// on off-platform money.
  bool get awaitsDirectPayment => canMarkBusinessParkingPaid(paymentFields);

  /// What this entry recorded, in dollars.
  double get amountDue => businessParkingAmountDue(paymentFields);

  /// The hosted Stripe Checkout page for a payment-link entry, or "".
  String get checkoutUrl => (paymentFields['checkoutUrl'] ?? '').toString();

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
      paymentFields: Map<String, dynamic>.from(data),
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
    Map<String, dynamic>? paymentFields,
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
      paymentFields: paymentFields ?? this.paymentFields,
    );
  }
}

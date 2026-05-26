import 'package:cloud_firestore/cloud_firestore.dart';

class CarPurchase {
  CarPurchase({
    required this.id,
    required this.carId,
    required this.carTitle,
    required this.buyerUid,
    required this.buyerEmail,
    required this.buyerName,
    required this.buyerPhone,
    required this.destinationCountryId,
    required this.destinationCountryName,
    required this.depositAmount,
    required this.depositCurrency,
    required this.paymentStatus,
    required this.purchaseStatus,
    required this.createdAt,
    this.stripePaymentIntentId,
    this.paymentType,
    this.appointmentStart,
    this.appointmentLabel,
    this.staffNotes,
    this.updatedAt,
  });

  static const double fixedDepositAmount = 500;
  static const String fixedDepositCurrency = 'USD';

  final String id;
  final String carId;
  final String carTitle;
  final String buyerUid;
  final String buyerEmail;
  final String buyerName;
  final String buyerPhone;
  final String destinationCountryId;
  final String destinationCountryName;
  final double depositAmount;
  final String depositCurrency;
  final String paymentStatus;
  final String purchaseStatus;
  final DateTime createdAt;
  final String? stripePaymentIntentId;
  final String? paymentType;
  final DateTime? appointmentStart;
  final String? appointmentLabel;
  final String? staffNotes;
  final DateTime? updatedAt;

  factory CarPurchase.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return CarPurchase.fromMap(doc.id, data);
  }

  factory CarPurchase.fromMap(String id, Map<String, dynamic> data) {
    return CarPurchase(
      id: id,
      carId: (data['carId'] ?? '') as String,
      carTitle: (data['carTitle'] ?? '') as String,
      buyerUid: (data['buyerUid'] ?? '') as String,
      buyerEmail: (data['buyerEmail'] ?? '') as String,
      buyerName: (data['buyerName'] ?? '') as String,
      buyerPhone: (data['buyerPhone'] ?? '') as String,
      destinationCountryId:
          (data['destinationCountryId'] ?? 'guinea') as String,
      destinationCountryName:
          (data['destinationCountryName'] ?? 'Guinea') as String,
      depositAmount: _parseDouble(data['depositAmount']),
      depositCurrency:
          (data['depositCurrency'] ?? fixedDepositCurrency) as String,
      paymentStatus: (data['paymentStatus'] ?? 'pending') as String,
      purchaseStatus: (data['purchaseStatus'] ?? 'pending') as String,
      createdAt: _toDateTime(data['createdAt']) ?? DateTime.now(),
      stripePaymentIntentId: data['stripePaymentIntentId'] as String?,
      paymentType: data['paymentType'] as String?,
      appointmentStart: _toDateTime(data['appointmentStart']),
      appointmentLabel: data['appointmentLabel'] as String?,
      staffNotes: data['staffNotes'] as String?,
      updatedAt: _toDateTime(data['updatedAt']),
    );
  }

  static double _parseDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0;
    return 0;
  }

  static DateTime? _toDateTime(dynamic value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    return null;
  }
}

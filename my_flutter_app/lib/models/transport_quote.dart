import 'package:cloud_firestore/cloud_firestore.dart';

class TransportQuote {
  const TransportQuote({
    required this.id,
    required this.requestId,
    required this.businessId,
    required this.businessName,
    required this.amountCents,
    required this.currency,
    required this.status,
    required this.revision,
    this.transportMethod = '',
    this.terms = '',
    this.estimatedPickupDate,
    this.estimatedDeliveryDate,
    this.expiresAt,
  });

  final String id;
  final String requestId;
  final String businessId;
  final String businessName;
  final int amountCents;
  final String currency;
  final String status;
  final int revision;
  final String transportMethod;
  final String terms;
  final DateTime? estimatedPickupDate;
  final DateTime? estimatedDeliveryDate;
  final DateTime? expiresAt;

  bool get isSubmitted => status == 'submitted';
  bool get isSelected => status == 'selected';
  bool get isExpired =>
      expiresAt != null && !expiresAt!.isAfter(DateTime.now());
  double get amount => amountCents / 100;

  factory TransportQuote.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return TransportQuote.fromMap(id: doc.id, data: data);
  }

  factory TransportQuote.fromMap({
    required String id,
    required Map<String, dynamic> data,
  }) {
    DateTime? date(String key) => (data[key] as Timestamp?)?.toDate();
    return TransportQuote(
      id: id,
      requestId: (data['requestId'] ?? '') as String,
      businessId: (data['businessId'] ?? '') as String,
      businessName: (data['businessName'] ?? '') as String,
      amountCents: (data['amountCents'] as num?)?.toInt() ?? 0,
      currency: (data['currency'] ?? 'usd') as String,
      status: (data['status'] ?? '') as String,
      revision: (data['revision'] as num?)?.toInt() ?? 1,
      transportMethod: (data['transportMethod'] ?? '') as String,
      terms: (data['terms'] ?? '') as String,
      estimatedPickupDate: date('estimatedPickupDate'),
      estimatedDeliveryDate: date('estimatedDeliveryDate'),
      expiresAt: date('expiresAt'),
    );
  }
}

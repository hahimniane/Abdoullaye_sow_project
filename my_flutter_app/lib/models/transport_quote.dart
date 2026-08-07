import 'package:cloud_firestore/cloud_firestore.dart';

class TransportQuote {
  const TransportQuote({
    required this.id,
    required this.requestId,
    required this.businessId,
    required this.businessName,
    required this.amountCents,
    this.pickupFeeCents = 0,
    this.pickupIncluded = false,
    int? totalCents,
    required this.currency,
    required this.status,
    required this.revision,
    this.transportMethod = '',
    this.terms = '',
    this.estimatedPickupDate,
    this.estimatedDeliveryDate,
    this.expiresAt,
  }) : totalCents = totalCents ?? amountCents + pickupFeeCents;

  final String id;
  final String requestId;
  final String businessId;
  final String businessName;

  /// The transport leg alone - what the business actually quoted.
  final int amountCents;

  /// The pickup leg, priced by the SERVER from this business's own `pickupPlan`
  /// under the `carTransport` key (`computeTransportQuotePickup`). The business
  /// never types it, but the customer sees it on the same line, which is why
  /// the bid screen shows it back.
  final int pickupFeeCents;

  /// Whether a pickup fee was priced at all. A business with no carTransport
  /// pickup plan is not blocked - it quotes collection inside its own price and
  /// no separate line is added, which is a different thing from a fee of zero.
  final bool pickupIncluded;

  /// What the customer pays: [amountCents] + [pickupFeeCents]. Stored by the
  /// server; recomputed here only when an older document predates the field.
  final int totalCents;
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
  bool get isWithdrawn => status == 'withdrawn';

  /// A quote past its first submission is a revision of the one the customer
  /// already holds, not a second quote: one business gets one quote per
  /// request, written to the same document.
  bool get isRevision => revision > 1;
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
      pickupFeeCents: (data['pickupFeeCents'] as num?)?.toInt() ?? 0,
      pickupIncluded: data['pickupIncluded'] == true,
      totalCents: (data['totalCents'] as num?)?.toInt(),
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

import 'package:cloud_firestore/cloud_firestore.dart';

/// One business's answer to "what do you charge to send this?".
///
/// Mirror of the `freightQuotes` document the server writes in
/// `submitFreightQuote`. Cover rides on the quote rather than being read from
/// the business's standing policy, because the whole reason this document
/// exists is that the table has no row for this parcel - so the business says
/// here, per quote, whether it stands behind this one.
class FreightQuote {
  const FreightQuote({
    required this.id,
    required this.requestId,
    required this.businessId,
    required this.businessName,
    required this.amountCents,
    required this.coversLoss,
    required this.currency,
    required this.status,
    required this.revision,
    this.terms = '',
    this.expiresAt,
  });

  final String id;
  final String requestId;
  final String businessId;
  final String businessName;

  /// What this business charges to carry the parcel.
  final int amountCents;

  /// Whether it makes good on the parcel if it never arrives. A yes or a no,
  /// with no sum against it, and it costs the customer nothing either way.
  final bool coversLoss;
  final String currency;
  final String status;

  /// One quote per business: a second answer revises the first in place, so a
  /// revision is the same offer restated, never a second price to compare.
  final int revision;
  final String terms;
  final DateTime? expiresAt;

  bool get isSubmitted => status == 'submitted';
  bool get isSelected => status == 'selected';
  bool get isClosed => status == 'closed';
  bool get isExpired =>
      expiresAt != null && !expiresAt!.isAfter(DateTime.now());

  double get amount => amountCents / 100;

  factory FreightQuote.fromFirestore(DocumentSnapshot doc) => FreightQuote
      .fromMap(
    id: doc.id,
    data: doc.data() as Map<String, dynamic>? ?? const <String, dynamic>{},
  );

  factory FreightQuote.fromMap({
    required String id,
    required Map<String, dynamic> data,
  }) {
    return FreightQuote(
      id: id,
      requestId: (data['requestId'] ?? '') as String,
      businessId: (data['businessId'] ?? '') as String,
      businessName: (data['businessName'] ?? '') as String,
      amountCents: (data['amountCents'] as num?)?.toInt() ?? 0,
      // A document with nothing to say about cover is a business that has
      // not promised one, which is the safe reading for the customer.
      coversLoss: data['coversLoss'] == true,
      currency: (data['currency'] ?? 'usd') as String,
      status: (data['status'] ?? '') as String,
      revision: (data['revision'] as num?)?.toInt() ?? 1,
      terms: (data['terms'] ?? '') as String,
      expiresAt: (data['expiresAt'] as Timestamp?)?.toDate(),
    );
  }
}

/// The customer's side of the conversation: the parcel they described and
/// where the request has got to. Mirror of `freightQuoteRequests/{id}`.
class FreightQuoteRequest {
  const FreightQuoteRequest({
    required this.id,
    required this.trackingCode,
    required this.description,
    required this.destinationCountryName,
    required this.quoteStatus,
    required this.eligibleBusinessCount,
    this.weightKg = 0,
    this.itemLabel = '',
    this.mode = '',
    this.selectedQuoteId = '',
    this.selectedBusinessId = '',
    this.selectedBusinessName = '',
    this.selectedAmountCents = 0,
    this.selectedCoversLoss = false,
  });

  final String id;
  final String trackingCode;
  final String description;
  final String destinationCountryName;

  /// 'collecting', 'selected' or 'cancelled'.
  final String quoteStatus;
  final int eligibleBusinessCount;
  final double weightKg;
  final String itemLabel;

  /// 'air' or 'sea' - the mode the parcel was priced for. The booking that
  /// follows an accepted price must open on this mode, not a default.
  final String mode;
  final String selectedQuoteId;

  /// Which business's price was accepted. The booking that follows has to go
  /// to that business and no other, or it is not the price that was agreed.
  final String selectedBusinessId;
  final String selectedBusinessName;
  final int selectedAmountCents;

  /// Whether the accepted quote covers the parcel if it is lost - the
  /// answer the customer chose, shown wherever the agreed deal is restated.
  final bool selectedCoversLoss;

  bool get isCollecting => quoteStatus == 'collecting';
  bool get isSelected => quoteStatus == 'selected';
  bool get isCancelled => quoteStatus == 'cancelled';

  factory FreightQuoteRequest.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? const <String, dynamic>{};
    return FreightQuoteRequest(
      id: doc.id,
      trackingCode: (data['trackingCode'] ?? '') as String,
      description: (data['description'] ?? '') as String,
      destinationCountryName:
          (data['destinationCountryName'] ?? '') as String,
      quoteStatus: (data['quoteStatus'] ?? '') as String,
      eligibleBusinessCount:
          (data['eligibleBusinessCount'] as num?)?.toInt() ?? 0,
      weightKg: (data['weightKg'] as num?)?.toDouble() ?? 0,
      itemLabel: (data['itemLabel'] ?? '') as String,
      mode: (data['mode'] ?? '') as String,
      selectedQuoteId: (data['selectedQuoteId'] ?? '') as String,
      selectedBusinessId: (data['selectedBusinessId'] ?? '') as String,
      selectedBusinessName: (data['selectedBusinessName'] ?? '') as String,
      selectedAmountCents:
          (data['selectedAmountCents'] as num?)?.toInt() ?? 0,
      selectedCoversLoss: data['selectedCoversLoss'] == true,
    );
  }
}

/// What `createFreightQuoteRequest` hands back.
class FreightQuoteRequestResult {
  const FreightQuoteRequestResult({
    required this.id,
    required this.trackingCode,
    required this.eligibleBusinessCount,
  });

  final String id;
  final String trackingCode;

  /// How many businesses the question went to, so the customer knows whether
  /// to expect one answer or several.
  final int eligibleBusinessCount;
}

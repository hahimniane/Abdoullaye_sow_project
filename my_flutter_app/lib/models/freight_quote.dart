import 'package:cloud_firestore/cloud_firestore.dart';

/// One business's answer to "what do you charge to send this?".
///
/// Mirror of the `freightQuotes` document the server writes in
/// `submitFreightQuote`. The payback rides on the quote rather than being read
/// from the business's published table, because the whole reason this document
/// exists is that the table has no row for this parcel - so the business says
/// here, per quote, whether it stands behind this one.
class FreightQuote {
  const FreightQuote({
    required this.id,
    required this.requestId,
    required this.businessId,
    required this.businessName,
    required this.amountCents,
    required this.paybackAmountCents,
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

  /// What it pays back if the parcel is lost. Zero is a real answer, and the
  /// customer is shown it plainly rather than left to assume cover.
  final int paybackAmountCents;
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
  double get paybackAmount => paybackAmountCents / 100;

  factory FreightQuote.fromFirestore(DocumentSnapshot doc) => FreightQuote
      .fromMap(
    id: doc.id,
    data: doc.data() as Map<String, dynamic>? ?? const <String, dynamic>{},
  );

  factory FreightQuote.fromMap({
    required String id,
    required Map<String, dynamic> data,
  }) {
    final paybackCents = (data['paybackAmountCents'] as num?)?.toInt() ?? 0;
    return FreightQuote(
      id: id,
      requestId: (data['requestId'] ?? '') as String,
      businessId: (data['businessId'] ?? '') as String,
      businessName: (data['businessName'] ?? '') as String,
      amountCents: (data['amountCents'] as num?)?.toInt() ?? 0,
      paybackAmountCents: paybackCents,
      // The stored flag is the business's own statement; an older document
      // without one is read from the amount it promised.
      coversLoss: data['coversLoss'] is bool
          ? data['coversLoss'] as bool
          : paybackCents > 0,
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
    this.selectedQuoteId = '',
    this.selectedBusinessName = '',
    this.selectedAmountCents = 0,
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
  final String selectedQuoteId;
  final String selectedBusinessName;
  final int selectedAmountCents;

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
      selectedQuoteId: (data['selectedQuoteId'] ?? '') as String,
      selectedBusinessName: (data['selectedBusinessName'] ?? '') as String,
      selectedAmountCents:
          (data['selectedAmountCents'] as num?)?.toInt() ?? 0,
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

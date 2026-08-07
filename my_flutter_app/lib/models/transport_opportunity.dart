import 'package:cloud_firestore/cloud_firestore.dart';

/// One customer request, as one invited business sees it.
///
/// `transportOpportunities` is written by `createTransportRequest`
/// (`functions/index.js`) with the document id `${requestId}__${businessId}` -
/// one document per business per request, carrying a sanitized mirror of the
/// request. It is deliberately not the request itself: a business that has not
/// won the job has no business reading the customer's address or phone number.
class TransportOpportunity {
  const TransportOpportunity({
    required this.id,
    required this.requestId,
    required this.businessId,
    required this.status,
    this.trackingCode = '',
    this.destinationCountryId = '',
    this.destinationCountryName = '',
    this.carMake = '',
    this.carModel = '',
    this.carYear = '',
    this.pickupArea = '',
    this.vehicleOperable = true,
    this.requestedTransportMethod = 'open',
    this.flexibleDates = true,
    this.preferredDate,
    this.expiresAt,
    required this.createdAt,
  });

  final String id;
  final String requestId;
  final String businessId;

  /// `open`, `quoted`, `selected`, `closed`, `cancelled` - and `withdrawn`,
  /// which `updateTransportRequestDetails` writes when a customer edits the
  /// destination out from under a business. Read as a plain string rather than
  /// an enum so a status a later server writes cannot make an opportunity
  /// unparseable.
  final String status;
  final String trackingCode;
  final String destinationCountryId;
  final String destinationCountryName;
  final String carMake;
  final String carModel;
  final String carYear;
  final String pickupArea;
  final bool vehicleOperable;
  final String requestedTransportMethod;
  final bool flexibleDates;
  final DateTime? preferredDate;

  /// The quote deadline. The server refuses a quote submitted after it, so a
  /// carrier is better off seeing the clock than the refusal.
  final DateTime? expiresAt;
  final DateTime createdAt;

  /// The vehicle, as one line: "2022 Toyota Camry".
  String get vehicleLabel =>
      <String>[carYear, carMake, carModel].where((p) => p.isNotEmpty).join(' ');

  bool get isExpired => expiresAt != null && !expiresAt!.isAfter(DateTime.now());

  factory TransportOpportunity.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return TransportOpportunity.fromMap(id: doc.id, data: data);
  }

  factory TransportOpportunity.fromMap({
    required String id,
    required Map<String, dynamic> data,
  }) {
    String text(String key) => (data[key] ?? '').toString().trim();
    DateTime? date(String key) => (data[key] as Timestamp?)?.toDate();
    final carYear = data['carYear'];
    return TransportOpportunity(
      id: id,
      // The requestId is what all three callables key on, so it falls back to
      // stripping the composite document id rather than to an empty string: an
      // opportunity nobody can quote is worse than one parsed the long way.
      requestId: text('requestId').isNotEmpty
          ? text('requestId')
          : (id.contains('__') ? id.split('__').first : id),
      businessId: text('businessId'),
      status: text('status'),
      trackingCode: text('trackingCode'),
      destinationCountryId: text('destinationCountryId'),
      destinationCountryName: text('destinationCountryName'),
      carMake: text('carMake'),
      carModel: text('carModel'),
      carYear: switch (carYear) {
        String value => value.trim(),
        num value => value.toString(),
        _ => '',
      },
      pickupArea: text('pickupArea'),
      vehicleOperable: data['vehicleOperable'] != false,
      requestedTransportMethod: text('requestedTransportMethod').isEmpty
          ? 'open'
          : text('requestedTransportMethod'),
      flexibleDates: data['flexibleDates'] != false,
      preferredDate: date('preferredDate'),
      expiresAt: date('expiresAt'),
      createdAt: date('createdAt') ?? DateTime.fromMillisecondsSinceEpoch(0),
    );
  }
}

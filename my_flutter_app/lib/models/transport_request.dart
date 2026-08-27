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
    this.businessName = '',
    this.businessId = '',
    this.customerUid,
    this.customerPhone = '',
    this.pickupAddress = '',
    this.notes = '',
    this.quoteStatus = '',
    this.flowVersion = 1,
    this.fulfillmentStatus = '',
    this.selectedQuoteId = '',
    this.selectedBusinessId = '',
    this.selectedAmountCents = 0,
    this.currency = 'usd',
    this.quoteCount = 0,
    this.pickupArea = '',
    this.vehicleOperable = true,
    this.requestedTransportMethod = 'open',
    this.flexibleDates = true,
    this.containerNumber = '',
    this.paymentStatus = '',
    this.totalCents = 0,
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
  final String businessName;
  final String businessId;
  final String? customerUid;
  final String customerPhone;
  final String pickupAddress;
  final String notes;

  /// Quote lifecycle for customer-submitted requests: 'awaitingQuote' until a
  /// business sets a price, then '' (priced).
  final String quoteStatus;

  /// Version 1 requests were assigned directly to one business. Version 2
  /// requests collect marketplace quotes before the customer selects one.
  final int flowVersion;
  final String fulfillmentStatus;
  final String selectedQuoteId;
  final String selectedBusinessId;
  final int selectedAmountCents;
  final String currency;
  final int quoteCount;
  final String pickupArea;
  final bool vehicleOperable;
  final String requestedTransportMethod;
  final bool flexibleDates;

  /// The container, booking or bill-of-lading number the car travels under.
  /// `updateTransportFulfillmentStatus` refuses `in_transit` without one, so
  /// the business needs to know whether the job already carries it.
  final String containerNumber;

  /// The hold-first payment on an accepted quote. Selection parks the request
  /// at `pending_payment`; only `succeeded` lets the carrier start.
  final String paymentStatus;

  /// Quote plus pickup fee, in cents - what the customer actually pays.
  final int totalCents;

  bool get usesQuoteMarketplace => flowVersion >= 2;
  bool get hasSelectedQuote =>
      selectedQuoteId.isNotEmpty && selectedBusinessId.isNotEmpty;

  /// Accepted but not yet paid: the one state where the customer owes an
  /// action before anything else can happen.
  bool get awaitingPayment =>
      usesQuoteMarketplace &&
      hasSelectedQuote &&
      status != 'cancelled' &&
      paymentStatus != 'succeeded';

  /// True when a customer submitted this and no price has been set yet.
  bool get awaitingQuote => usesQuoteMarketplace
      ? quoteStatus == 'collecting' && !hasSelectedQuote
      : quoteStatus == 'awaitingQuote' || price <= 0;

  factory TransportRequest.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return TransportRequest.fromMap(id: doc.id, data: data);
  }

  factory TransportRequest.fromMap({
    required String id,
    required Map<String, dynamic> data,
  }) {
    final trackingCode = data['trackingCode'];
    final carYear = data['carYear'];
    final flowVersion = (data['flowVersion'] as num?)?.toInt() ?? 1;
    final selectedAmountCents =
        (data['selectedAmountCents'] as num?)?.toInt() ?? 0;
    final legacyPrice = (data['price'] as num?)?.toDouble();
    // The server reads the live status as
    // `fulfillmentStatus || status` - JS truthiness, so an EMPTY
    // fulfillmentStatus falls through to status. `??` does not: it keeps the
    // empty string, and a job whose fulfillmentStatus was written as "" then
    // read as statusless here while the server still read it as `pending`.
    final fulfillmentStatus = (data['fulfillmentStatus'] ?? '') as String;
    final recordStatus = (data['status'] ?? '') as String;
    return TransportRequest(
      id: id,
      trackingCode: trackingCode is String && trackingCode.trim().isNotEmpty
          ? trackingCode.trim()
          : id,
      ownerName: (data['ownerName'] ?? '') as String,
      carMake: (data['carMake'] ?? '') as String,
      carModel: (data['carModel'] ?? '') as String,
      carYear: switch (carYear) {
        String value => value,
        num value => value.toString(),
        _ => '',
      },
      vinNumber: (data['vinNumber'] ?? '') as String,
      destinationCountryId:
          (data['destinationCountryId'] ?? (flowVersion >= 2 ? '' : 'guinea'))
              as String,
      destinationCountryName:
          (data['destinationCountryName'] ?? (flowVersion >= 2 ? '' : 'Guinea'))
              as String,
      transportDate:
          (data['transportDate'] as Timestamp?)?.toDate() ?? DateTime.now(),
      price: legacyPrice ?? selectedAmountCents / 100,
      status: fulfillmentStatus.isNotEmpty
          ? fulfillmentStatus
          : (recordStatus.isNotEmpty ? recordStatus : 'pending'),
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      businessName: (data['businessName'] ?? '') as String,
      businessId: (data['businessId'] ?? '') as String,
      customerUid: data['customerUid'] as String?,
      customerPhone: (data['customerPhone'] ?? '') as String,
      pickupAddress: (data['pickupAddress'] ?? '') as String,
      notes: (data['notes'] ?? '') as String,
      quoteStatus: (data['quoteStatus'] ?? '') as String,
      flowVersion: flowVersion,
      fulfillmentStatus: fulfillmentStatus,
      selectedQuoteId: (data['selectedQuoteId'] ?? '') as String,
      selectedBusinessId:
          (data['selectedBusinessId'] ?? data['businessId'] ?? '') as String,
      selectedAmountCents: selectedAmountCents,
      currency: (data['currency'] ?? 'usd') as String,
      quoteCount: (data['quoteCount'] as num?)?.toInt() ?? 0,
      pickupArea: (data['pickupArea'] ?? '') as String,
      vehicleOperable: data['vehicleOperable'] != false,
      requestedTransportMethod:
          (data['requestedTransportMethod'] ?? 'open') as String,
      flexibleDates: data['flexibleDates'] != false,
      containerNumber: (data['containerNumber'] ?? '') as String,
      paymentStatus: (data['paymentStatus'] ?? '') as String,
      totalCents: (data['totalCents'] as num?)?.toInt() ?? 0,
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
      'businessName': businessName,
      'businessId': businessId,
      if (customerUid != null) 'customerUid': customerUid,
      'customerPhone': customerPhone,
      'pickupAddress': pickupAddress,
      'notes': notes,
      'quoteStatus': quoteStatus,
      'flowVersion': flowVersion,
      if (flowVersion >= 2) ...{
        'fulfillmentStatus': fulfillmentStatus,
        'selectedQuoteId': selectedQuoteId,
        'selectedBusinessId': selectedBusinessId,
        'selectedAmountCents': selectedAmountCents,
        'currency': currency,
        'quoteCount': quoteCount,
        'pickupArea': pickupArea,
        'vehicleOperable': vehicleOperable,
        'requestedTransportMethod': requestedTransportMethod,
        'flexibleDates': flexibleDates,
        if (containerNumber.isNotEmpty) 'containerNumber': containerNumber,
      },
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
    String? businessName,
    String? businessId,
    String? customerUid,
    String? customerPhone,
    String? pickupAddress,
    String? notes,
    String? quoteStatus,
    int? flowVersion,
    String? fulfillmentStatus,
    String? selectedQuoteId,
    String? selectedBusinessId,
    int? selectedAmountCents,
    String? currency,
    int? quoteCount,
    String? pickupArea,
    bool? vehicleOperable,
    String? requestedTransportMethod,
    bool? flexibleDates,
    String? containerNumber,
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
      businessName: businessName ?? this.businessName,
      businessId: businessId ?? this.businessId,
      customerUid: customerUid ?? this.customerUid,
      customerPhone: customerPhone ?? this.customerPhone,
      pickupAddress: pickupAddress ?? this.pickupAddress,
      notes: notes ?? this.notes,
      quoteStatus: quoteStatus ?? this.quoteStatus,
      flowVersion: flowVersion ?? this.flowVersion,
      fulfillmentStatus: fulfillmentStatus ?? this.fulfillmentStatus,
      selectedQuoteId: selectedQuoteId ?? this.selectedQuoteId,
      selectedBusinessId: selectedBusinessId ?? this.selectedBusinessId,
      selectedAmountCents: selectedAmountCents ?? this.selectedAmountCents,
      currency: currency ?? this.currency,
      quoteCount: quoteCount ?? this.quoteCount,
      pickupArea: pickupArea ?? this.pickupArea,
      vehicleOperable: vehicleOperable ?? this.vehicleOperable,
      requestedTransportMethod:
          requestedTransportMethod ?? this.requestedTransportMethod,
      flexibleDates: flexibleDates ?? this.flexibleDates,
      containerNumber: containerNumber ?? this.containerNumber,
      paymentStatus: paymentStatus,
      totalCents: totalCents,
    );
  }
}

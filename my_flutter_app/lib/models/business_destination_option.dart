import 'package:cloud_firestore/cloud_firestore.dart';

import '../services/freight_categories.dart';
import '../services/freight_coverage.dart';
import '../utils/freight_delivery.dart';
import 'business_profile.dart';
import 'business_service.dart';
import 'destination_country.dart';

class BusinessDestinationOption {
  const BusinessDestinationOption({
    required this.id,
    required this.businessId,
    required this.businessName,
    required this.country,
    this.businessPhone,
    this.businessEmail,
    this.businessWebsite,
    this.businessProfileImageUrl,
    this.businessAddress,
    this.enabledServices = defaultBusinessServiceValues,
    this.serviceNote,
    this.businessStatus = 'approved',
    this.freightPickupAvailable = false,
    this.freightPayOnArrival = false,
    this.freightDestinationDeliveryAvailable = false,
    this.freightDestinationDeliveryFee = 0,
    this.freightPickupModel = 'distance',
    this.freightCategories = const <FreightCategory>[],
    this.freightCoverage,
    this.freightPaybackTable,
    this.reviewCount = 0,
    this.reviewAverage = 0,
    this.reviewWeightedScore = 0,
  });

  final String id;
  final String businessId;
  final String businessName;
  final DestinationCountry country;
  final String? businessPhone;
  final String? businessEmail;
  final String? businessWebsite;
  final String? businessProfileImageUrl;
  final String? businessAddress;
  final List<String> enabledServices;
  final String? serviceNote;
  final String businessStatus;

  /// Customer rating shown alongside this option. reviewWeightedScore is the
  /// Bayesian-damped score used for ranking (see business_review.js on the
  /// server); reviewAverage is the plain average shown to customers.
  final int reviewCount;
  final double reviewAverage;
  final double reviewWeightedScore;

  /// Whether this business offers freight home-pickup, and its already-resolved
  /// pricing model (`'distance'` or `'borough'`), as computed server-side.
  final bool freightPickupAvailable;
  final String freightPickupModel;

  /// Whether this business accepts being paid after the parcel reaches the
  /// destination. When true, the booking form offers pay now / pay on
  /// arrival; the server re-checks the business doc at booking regardless.
  final bool freightPayOnArrival;

  /// Whether the receiver can have the parcel brought to their own address at
  /// the destination instead of collecting it, and the flat fee for that. Flat
  /// rather than distance-priced: the addresses this serves do not geocode
  /// well enough to price a radius from, so a number the business chose is one
  /// it can actually honour. Read through [freightDelivery], which treats an
  /// opted-in business with no fee as an unfinished setting.
  final bool freightDestinationDeliveryAvailable;
  final double freightDestinationDeliveryFee;

  /// What this business will carry and what each kind of parcel is worth to
  /// it. Priced per business, not per destination: a business charges the same
  /// for electronics wherever it is sending them. Empty when it does not offer
  /// freight.
  final List<FreightCategory> freightCategories;

  /// Whether this business pays the customer back for a parcel it loses, and
  /// on what terms. Null when it does not offer freight - which is not the
  /// same as offering freight and covering nothing.
  final FreightCoveragePolicy? freightCoverage;

  /// What the business pays back per item type: the customer says what the
  /// item is and this table says what it is worth. Raw wire shape; read
  /// through freight_payback.
  final Map<String, dynamic>? freightPaybackTable;

  /// The one line the option card shows about who stands behind the parcel.
  FreightCoverageSummary get freightCoverageSummary =>
      freightCoverageSummaryOf(freightCoverage);

  /// This business's destination-delivery offer, with an unpriced opt-in
  /// resolved to "not offered".
  FreightDeliveryPolicy get freightDelivery => freightDeliveryPolicy(
    available: freightDestinationDeliveryAvailable,
    fee: freightDestinationDeliveryFee,
  );

  bool get isApprovedActive => businessStatus == 'approved' && country.isActive;

  bool isAvailableFor(BusinessServiceKey service) {
    if (!isApprovedActive || !hasBusinessService(enabledServices, service)) {
      return false;
    }
    return switch (service) {
      BusinessServiceKey.barrelShipping ||
      BusinessServiceKey.sharedBarrels => country.isBarrelShippingConfigured,
      BusinessServiceKey.freight => country.hasAnyFreightRate,
      BusinessServiceKey.carTransport => country.carTransportAvailable,
      BusinessServiceKey.carSales || BusinessServiceKey.carParking => true,
    };
  }

  bool get isAvailable => isAvailableFor(BusinessServiceKey.barrelShipping);

  bool get isAvailableForAnyShippingService =>
      isAvailableFor(BusinessServiceKey.barrelShipping) ||
      isAvailableFor(BusinessServiceKey.sharedBarrels) ||
      isAvailableFor(BusinessServiceKey.freight);

  factory BusinessDestinationOption.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return BusinessDestinationOption.fromFirestoreData(doc, data);
  }

  factory BusinessDestinationOption.fromFunctionData(
    Map<String, dynamic> data,
  ) {
    final country = data['country'] is Map
        ? Map<String, dynamic>.from(data['country'] as Map)
        : <String, dynamic>{};
    return BusinessDestinationOption(
      id: (data['id'] ?? '') as String,
      businessId:
          (data['businessId'] ?? BusinessProfile.defaultBusinessId) as String,
      businessName:
          (data['businessName'] ?? BusinessProfile.defaultBusinessName)
              as String,
      businessPhone: data['businessPhone'] as String?,
      businessEmail: data['businessEmail'] as String?,
      businessWebsite: data['businessWebsite'] as String?,
      businessProfileImageUrl: data['businessProfileImageUrl'] as String?,
      businessAddress: data['businessAddress'] as String?,
      enabledServices: normalizeBusinessServices(data['enabledServices']),
      serviceNote: data['serviceNote'] as String?,
      businessStatus: (data['businessStatus'] ?? 'approved') as String,
      freightPickupAvailable: data['freightPickupAvailable'] == true,
      freightPayOnArrival: data['freightPayOnArrival'] == true,
      freightDestinationDeliveryAvailable:
          data['freightDestinationDeliveryAvailable'] == true,
      freightDestinationDeliveryFee:
          (data['freightDestinationDeliveryFee'] as num?)?.toDouble() ?? 0,
      freightPickupModel: (data['freightPickupModel'] as String?) == 'borough'
          ? 'borough'
          : 'distance',
      freightCategories: FreightCategory.listFromWire(data['freightCategories']),
      freightPaybackTable: data['freightPaybackTable'] is Map
          ? Map<String, dynamic>.from(data['freightPaybackTable'] as Map)
          : null,
      freightCoverage: FreightCoveragePolicy.fromWire(data['freightCoverage']),
      reviewCount: (data['reviewCount'] as num?)?.toInt() ?? 0,
      reviewAverage: (data['reviewAverage'] as num?)?.toDouble() ?? 0,
      reviewWeightedScore:
          (data['reviewWeightedScore'] as num?)?.toDouble() ?? 0,
      country: DestinationCountry(
        id: (country['id'] ?? '') as String,
        name: (country['name'] ?? '') as String,
        code: country['code'] as String?,
        isActive: country['isActive'] == true,
        sortOrder: (country['sortOrder'] as num?)?.toInt() ?? 0,
        destinationCoverageVersion:
            (country['destinationCoverageVersion'] as num?)?.toInt() ?? 1,
        barrelShippingAvailable: _serviceEnabled(
          country,
          'barrelShipping',
          legacy:
              country['isActive'] == true &&
              ((country['barrelShippingPrice'] as num?)?.toDouble() ?? 0) > 0,
        ),
        freightAirAvailable: _serviceEnabled(
          country,
          'freightAir',
          legacy:
              country['isActive'] == true &&
              ((country['freightAirPricePerKg'] as num?)?.toDouble() ?? 0) > 0,
        ),
        freightSeaAvailable: _serviceEnabled(
          country,
          'freightSea',
          legacy:
              country['isActive'] == true &&
              ((country['freightSeaPricePerKg'] as num?)?.toDouble() ?? 0) > 0,
        ),
        barrelShippingPrice:
            (country['barrelShippingPrice'] as num?)?.toDouble() ?? 0,
        freightAirPricePerKg:
            (country['freightAirPricePerKg'] as num?)?.toDouble() ?? 0,
        freightSeaPricePerKg:
            (country['freightSeaPricePerKg'] as num?)?.toDouble() ?? 0,
        freightAirDepartureDays: _departureDays(
          country['freightAirDepartureDays'],
        ),
        freightSeaDepartureDays: _departureDays(
          country['freightSeaDepartureDays'],
        ),
        carTransportAvailable: _legacyCarTransportAvailable(country),
        barrelShippingDeliveryEstimateMinDays:
            (country['barrelShippingDeliveryEstimateMinDays'] as num?)
                ?.toInt(),
        barrelShippingDeliveryEstimateMaxDays:
            (country['barrelShippingDeliveryEstimateMaxDays'] as num?)
                ?.toInt(),
        freightAirDeliveryEstimateMinDays:
            (country['freightAirDeliveryEstimateMinDays'] as num?)?.toInt(),
        freightAirDeliveryEstimateMaxDays:
            (country['freightAirDeliveryEstimateMaxDays'] as num?)?.toInt(),
        freightSeaDeliveryEstimateMinDays:
            (country['freightSeaDeliveryEstimateMinDays'] as num?)?.toInt(),
        freightSeaDeliveryEstimateMaxDays:
            (country['freightSeaDeliveryEstimateMaxDays'] as num?)?.toInt(),
        destinationNote: country['destinationNote'] as String?,
      ),
    );
  }

  factory BusinessDestinationOption.fromFirestoreData(
    DocumentSnapshot doc,
    Map<String, dynamic> data, {
    Map<String, dynamic>? businessData,
  }) {
    final parent = doc.reference.parent.parent;
    final businessId =
        (data['businessId'] as String?) ??
        parent?.id ??
        BusinessProfile.defaultBusinessId;
    final business = businessData ?? const <String, dynamic>{};
    final businessName =
        (data['businessName'] as String?) ??
        (business['name'] as String?) ??
        BusinessProfile.defaultBusinessName;
    final services = normalizeBusinessServices(
      businessData == null ? data['enabledServices'] : business['enabledServices'],
    );
    // Categories and coverage are business-wide settings, so they are read off
    // the business document when we have one. This path only runs where the
    // callable is unavailable; it exists so those customers are quoted the
    // same prices and shown the same promise as everyone else.
    final freightSettings = businessData ?? data;
    final offersFreight = hasBusinessService(
      services,
      BusinessServiceKey.freight,
    );

    return BusinessDestinationOption(
      id: '${businessId}_${doc.id}',
      businessId: businessId,
      businessName: businessName,
      businessPhone:
          data['businessPhone'] as String? ?? business['phone'] as String?,
      businessEmail:
          data['businessEmail'] as String? ?? business['email'] as String?,
      businessWebsite:
          data['businessWebsite'] as String? ?? business['website'] as String?,
      businessProfileImageUrl:
          data['businessProfileImageUrl'] as String? ??
          business['profileImageUrl'] as String?,
      businessAddress: businessData == null
          ? data['businessAddress'] as String?
          : [
                  business['addressLine1'],
                  business['city'],
                  business['state'],
                  business['postalCode'],
                ]
                .whereType<String>()
                .where((part) => part.trim().isNotEmpty)
                .join(', '),
      enabledServices: services,
      serviceNote:
          data['serviceNote'] as String? ?? business['serviceNote'] as String?,
      businessStatus:
          (businessData == null
                  ? data['businessStatus']
                  : business['status'] ?? data['businessStatus'] ?? 'pending')
              as String,
      freightPickupAvailable:
          (businessData == null
              ? data['freightPickupAvailable']
              : business['freightPickupAvailable']) ==
          true,
      freightPickupModel: _effectivePickupModel(
        businessData == null
            ? data['freightPickupModel']
            : business['freightPickupModel'],
        businessData == null ? data['state'] : business['state'],
      ),
      freightCategories: offersFreight
          ? freightCategoriesFromBusinessData(freightSettings)
          : const <FreightCategory>[],
      freightCoverage: offersFreight
          ? FreightCoveragePolicy.fromBusinessData(freightSettings)
          : null,
      reviewCount:
          ((businessData == null ? data['reviewCount'] : business['reviewCount'])
                  as num?)
              ?.toInt() ??
          0,
      reviewAverage:
          ((businessData == null
                      ? data['reviewAverage']
                      : business['reviewAverage'])
                  as num?)
              ?.toDouble() ??
          0,
      reviewWeightedScore:
          ((businessData == null
                      ? data['reviewWeightedScore']
                      : business['reviewWeightedScore'])
                  as num?)
              ?.toDouble() ??
          0,
      country: DestinationCountry(
        id: doc.id,
        name: (data['name'] ?? doc.id) as String,
        code: data['code'] as String?,
        isActive: data['isActive'] == true,
        sortOrder: (data['sortOrder'] as num?)?.toInt() ?? 0,
        destinationCoverageVersion:
            (data['destinationCoverageVersion'] as num?)?.toInt() ?? 1,
        barrelShippingAvailable: _serviceEnabled(
          data,
          'barrelShipping',
          legacy:
              data['isActive'] == true &&
              ((data['barrelShippingPrice'] as num?)?.toDouble() ?? 0) > 0,
        ),
        freightAirAvailable: _serviceEnabled(
          data,
          'freightAir',
          legacy:
              data['isActive'] == true &&
              ((data['freightAirPricePerKg'] as num?)?.toDouble() ?? 0) > 0,
        ),
        freightSeaAvailable: _serviceEnabled(
          data,
          'freightSea',
          legacy:
              data['isActive'] == true &&
              ((data['freightSeaPricePerKg'] as num?)?.toDouble() ?? 0) > 0,
        ),
        barrelShippingPrice:
            (data['barrelShippingPrice'] as num?)?.toDouble() ?? 0,
        freightAirPricePerKg:
            (data['freightAirPricePerKg'] as num?)?.toDouble() ?? 0,
        freightSeaPricePerKg:
            (data['freightSeaPricePerKg'] as num?)?.toDouble() ?? 0,
        freightAirDepartureDays: _departureDays(
          data['freightAirDepartureDays'],
        ),
        freightSeaDepartureDays: _departureDays(
          data['freightSeaDepartureDays'],
        ),
        carTransportAvailable: _legacyCarTransportAvailable(data),
        barrelShippingDeliveryEstimateMinDays:
            (data['barrelShippingDeliveryEstimateMinDays'] as num?)?.toInt(),
        barrelShippingDeliveryEstimateMaxDays:
            (data['barrelShippingDeliveryEstimateMaxDays'] as num?)?.toInt(),
        freightAirDeliveryEstimateMinDays:
            (data['freightAirDeliveryEstimateMinDays'] as num?)?.toInt(),
        freightAirDeliveryEstimateMaxDays:
            (data['freightAirDeliveryEstimateMaxDays'] as num?)?.toInt(),
        freightSeaDeliveryEstimateMinDays:
            (data['freightSeaDeliveryEstimateMinDays'] as num?)?.toInt(),
        freightSeaDeliveryEstimateMaxDays:
            (data['freightSeaDeliveryEstimateMaxDays'] as num?)?.toInt(),
        destinationNote: data['destinationNote'] as String?,
      ),
    );
  }

  factory BusinessDestinationOption.fromLegacyCountry(
    DestinationCountry country,
  ) {
    return BusinessDestinationOption(
      id: '${BusinessProfile.defaultBusinessId}_${country.id}',
      businessId: BusinessProfile.defaultBusinessId,
      businessName: BusinessProfile.defaultBusinessName,
      country: country,
      businessStatus: 'approved',
    );
  }

  /// Borough pricing only holds for New York businesses; anything else resolves
  /// to distance (mirrors the backend rule) so the client sees a coherent model.
  static String _effectivePickupModel(dynamic model, dynamic state) {
    final normalizedState = (state as String? ?? '').trim().toUpperCase();
    final isNewYork = normalizedState == 'NY' || normalizedState == 'NEW YORK';
    return model == 'borough' && isNewYork ? 'borough' : 'distance';
  }

  static bool _serviceEnabled(
    Map<String, dynamic> data,
    String key, {
    required bool legacy,
  }) {
    final availability = data['serviceAvailability'];
    if (availability is Map && availability[key] is bool) {
      return availability[key] as bool;
    }
    return legacy;
  }

  static bool _legacyCarTransportAvailable(Map<String, dynamic> data) {
    final availability = data['serviceAvailability'];
    if (availability is Map && availability['carTransport'] is bool) {
      return availability['carTransport'] as bool;
    }
    return data['isActive'] == true && data['carTransportAvailable'] == true;
  }

  static List<String> _departureDays(dynamic value) {
    const validDays = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ];
    if (value is! List) return const [];
    final requested = value.whereType<String>().toSet();
    return validDays.where(requested.contains).toList(growable: false);
  }
}

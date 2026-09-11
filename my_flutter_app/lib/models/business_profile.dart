import 'package:cloud_firestore/cloud_firestore.dart';

import 'business_service.dart';

class BusinessProfile {
  const BusinessProfile({
    required this.id,
    required this.name,
    this.status = 'pending',
    this.ownerUid,
    this.phone,
    this.email,
    this.website,
    this.profileImageUrl,
    this.profileImagePath,
    this.logoUrl,
    this.enabledServices = defaultBusinessServiceValues,
    this.serviceNote,
    this.addressLine1,
    this.city,
    this.country,
    this.state,
    this.postalCode,
    this.marketingBlurb,
    this.stripeAccountId,
    this.payoutsEnabled = false,
    this.chargesEnabled = false,
    this.connectOnboardedAt,
    this.featureConsent = false,
    this.featureStatus = 'none',
    this.featureNote,
    this.carHoldPricingMode = 'flat',
    this.carHoldFlatFee = 500,
    this.carHoldDailyRate = 100,
    this.carHoldMaxDays = 14,
    this.parkingAddressLine1,
    this.parkingCity,
    this.parkingCountry,
    this.parkingState,
    this.parkingTotalSpaces = 0,
    this.parkingBlockedSpaces = 0,
    this.parkingDailyRate = 0,
    this.parkingWeeklyRate = 0,
    this.parkingMonthlyRate = 0,
    this.parkingMinimumDays = 1,
    this.parkingPickupAvailable = false,
    this.parkingAcceptsReservations = true,
    this.parkingPickupFee = 0,
    this.parkingInstructions,
    this.parkingLatitude,
    this.parkingLongitude,
    this.freightPickupAvailable = false,
    this.freightPickupModel = 'distance',
    this.freightPickupBaseFee = 0,
    this.freightPickupPerKm = 0,
    this.freightPickupMinFee = 0,
    this.freightPickupMaxKm = 0,
    this.freightPickupOriginAddress,
    this.freightPickupOriginLat,
    this.freightPickupOriginLng,
    this.freightPickupBoroughPrices = const {},
    this.pickupPlan,
  });

  static const defaultBusinessId = 'keren_auto_sales';
  static const defaultBusinessName = 'Keren';

  final String id;
  final String name;
  final String status;
  final String? ownerUid;
  final String? phone;
  final String? email;
  final String? website;
  final String? profileImageUrl;
  final String? profileImagePath;
  final String? logoUrl;
  final List<String> enabledServices;
  final String? serviceNote;
  final String? addressLine1;
  final String? city;
  final String? country;
  final String? state;
  final String? postalCode;
  final String? marketingBlurb;
  final String? stripeAccountId;
  final bool payoutsEnabled;
  final bool chargesEnabled;
  final DateTime? connectOnboardedAt;
  final bool featureConsent;
  final String featureStatus;
  final String? featureNote;
  final String carHoldPricingMode;
  final double carHoldFlatFee;
  final double carHoldDailyRate;
  final int carHoldMaxDays;
  final String? parkingAddressLine1;
  final String? parkingCity;
  final String? parkingCountry;
  final String? parkingState;
  final int parkingTotalSpaces;
  final int parkingBlockedSpaces;
  final double parkingDailyRate;
  final double parkingWeeklyRate;
  final double parkingMonthlyRate;
  final int parkingMinimumDays;
  final bool parkingPickupAvailable;

  /// When false the lot is walk-in only: still listed and contactable, but it
  /// takes no online customer reservations. Absent means true.
  final bool parkingAcceptsReservations;
  final double parkingPickupFee;
  final String? parkingInstructions;
  final double? parkingLatitude;
  final double? parkingLongitude;
  final bool freightPickupAvailable;

  /// Either `'distance'` (any country) or `'borough'` (New York only).
  final String freightPickupModel;
  final double freightPickupBaseFee;
  final double freightPickupPerKm;
  final double freightPickupMinFee;
  final double freightPickupMaxKm;
  final String? freightPickupOriginAddress;
  final double? freightPickupOriginLat;
  final double? freightPickupOriginLng;
  final Map<String, double> freightPickupBoroughPrices;

  /// Business-owned pickup plan shared across services (docs/PLAN-business-
  /// pickup.md). Kept as raw data: the server owns validation and pricing.
  final Map<String, dynamic>? pickupPlan;

  bool get isApproved => status == 'approved';

  /// Borough pricing is only meaningful for New York businesses.
  bool get isNewYorkBased {
    final value = (state ?? '').trim().toUpperCase();
    return value == 'NY' || value == 'NEW YORK';
  }

  /// The effective model, coercing borough → distance outside New York so the
  /// UI never shows an incoherent state (mirrors the backend rule).
  String get effectiveFreightPickupModel =>
      freightPickupModel == 'borough' && isNewYorkBased ? 'borough' : 'distance';
  bool hasService(BusinessServiceKey key) =>
      hasBusinessService(enabledServices, key);

  factory BusinessProfile.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return BusinessProfile(
      id: doc.id,
      name: (data['name'] ?? doc.id) as String,
      status: (data['status'] ?? 'pending') as String,
      ownerUid: data['ownerUid'] as String?,
      phone: data['phone'] as String?,
      email: data['email'] as String?,
      website: data['website'] as String?,
      profileImageUrl: data['profileImageUrl'] as String?,
      profileImagePath: data['profileImagePath'] as String?,
      logoUrl: data['logoUrl'] as String?,
      enabledServices: normalizeBusinessServices(data['enabledServices']),
      serviceNote: data['serviceNote'] as String?,
      addressLine1: data['addressLine1'] as String?,
      city: data['city'] as String?,
      country: data['country'] as String?,
      state: data['state'] as String?,
      postalCode: data['postalCode'] as String?,
      marketingBlurb: data['marketingBlurb'] as String?,
      stripeAccountId: data['stripeAccountId'] as String?,
      payoutsEnabled: data['payoutsEnabled'] == true,
      chargesEnabled: data['chargesEnabled'] == true,
      connectOnboardedAt: (data['connectOnboardedAt'] as Timestamp?)?.toDate(),
      featureConsent: data['featureConsent'] == true,
      featureStatus: (data['featureStatus'] ?? 'none') as String,
      featureNote: data['featureNote'] as String?,
      carHoldPricingMode: (data['carHoldPricingMode'] ?? 'flat') as String,
      carHoldFlatFee: _parseDouble(data['carHoldFlatFee'], 500),
      carHoldDailyRate: _parseDouble(data['carHoldDailyRate'], 100),
      carHoldMaxDays: _parseInt(data['carHoldMaxDays'], 14).clamp(1, 30),
      parkingAddressLine1: data['parkingAddressLine1'] as String?,
      parkingCity: data['parkingCity'] as String?,
      parkingCountry: data['parkingCountry'] as String?,
      parkingState: data['parkingState'] as String?,
      parkingTotalSpaces: _parseInt(
        data['parkingTotalSpaces'],
        0,
      ).clamp(0, 100000),
      parkingBlockedSpaces: _parseInt(
        data['parkingBlockedSpaces'],
        0,
      ).clamp(0, 100000),
      parkingDailyRate: _parseDouble(data['parkingDailyRate'], 0),
      parkingWeeklyRate: _parseDouble(data['parkingWeeklyRate'], 0),
      parkingMonthlyRate: _parseDouble(data['parkingMonthlyRate'], 0),
      parkingMinimumDays: _parseInt(
        data['parkingMinimumDays'],
        1,
      ).clamp(1, 365),
      parkingPickupAvailable: data['parkingPickupAvailable'] == true,
      parkingAcceptsReservations:
          data['parkingAcceptsReservations'] != false,
      parkingPickupFee: _parseDouble(data['parkingPickupFee'], 0),
      parkingInstructions: data['parkingInstructions'] as String?,
      parkingLatitude: _parseNullableDouble(data['parkingLatitude']),
      parkingLongitude: _parseNullableDouble(data['parkingLongitude']),
      freightPickupAvailable: data['freightPickupAvailable'] == true,
      freightPickupModel:
          (data['freightPickupModel'] as String?) == 'borough'
          ? 'borough'
          : 'distance',
      freightPickupBaseFee: _parseDouble(data['freightPickupBaseFee'], 0),
      freightPickupPerKm: _parseDouble(data['freightPickupPerKm'], 0),
      freightPickupMinFee: _parseDouble(data['freightPickupMinFee'], 0),
      freightPickupMaxKm: _parseDouble(data['freightPickupMaxKm'], 0),
      freightPickupOriginAddress: data['freightPickupOriginAddress'] as String?,
      freightPickupOriginLat: _parseNullableDouble(
        data['freightPickupOriginLat'],
      ),
      freightPickupOriginLng: _parseNullableDouble(
        data['freightPickupOriginLng'],
      ),
      freightPickupBoroughPrices: _parseBoroughPrices(
        data['freightPickupBoroughPrices'],
      ),
      pickupPlan: data['pickupPlan'] is Map
          ? Map<String, dynamic>.from(data['pickupPlan'] as Map)
          : null,
    );
  }

  static Map<String, double> _parseBoroughPrices(dynamic value) {
    if (value is! Map) return const {};
    final prices = <String, double>{};
    value.forEach((key, raw) {
      final fee = _parseNullableDouble(raw);
      if (key is String && fee != null && fee >= 0) {
        prices[key] = fee;
      }
    });
    return prices;
  }

  static double _parseDouble(dynamic value, double fallback) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? fallback;
    return fallback;
  }

  static double? _parseNullableDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String && value.trim().isNotEmpty) {
      return double.tryParse(value.trim());
    }
    return null;
  }

  static int _parseInt(dynamic value, int fallback) {
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? fallback;
    return fallback;
  }

  String get addressLabel {
    return [
      addressLine1,
      city,
      country,
      state,
      postalCode,
    ].whereType<String>().where((part) => part.trim().isNotEmpty).join(', ');
  }

  String get parkingAddressLabel {
    return [
      parkingAddressLine1 ?? addressLine1,
      parkingCity ?? city,
      parkingCountry ?? country,
      parkingState ?? state,
    ].whereType<String>().where((part) => part.trim().isNotEmpty).join(', ');
  }
}

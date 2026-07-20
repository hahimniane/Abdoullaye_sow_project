import 'package:cloud_firestore/cloud_firestore.dart';

class DestinationCountry {
  const DestinationCountry({
    required this.id,
    required this.name,
    this.code,
    this.isActive = false,
    this.sortOrder = 0,
    this.destinationCoverageVersion = 1,
    this.barrelShippingAvailable = true,
    this.freightAirAvailable = true,
    this.freightSeaAvailable = true,
    this.barrelShippingPrice = 0,
    this.freightAirPricePerKg = 0,
    this.freightSeaPricePerKg = 0,
    this.carTransportAvailable = true,
    this.deliveryEstimateMinDays,
    this.deliveryEstimateMaxDays,
    this.destinationNote,
  });

  static const fallback = DestinationCountry(
    id: 'guinea',
    name: 'Guinea',
    code: 'GN',
    isActive: true,
    sortOrder: 0,
  );

  final String id;
  final String name;
  final String? code;
  final bool isActive;
  final int sortOrder;
  final int destinationCoverageVersion;
  final bool barrelShippingAvailable;
  final bool freightAirAvailable;
  final bool freightSeaAvailable;
  final double barrelShippingPrice;
  final double freightAirPricePerKg;
  final double freightSeaPricePerKg;
  final bool carTransportAvailable;
  final int? deliveryEstimateMinDays;
  final int? deliveryEstimateMaxDays;
  final String? destinationNote;

  Map<String, bool> get serviceAvailability => {
    'barrelShipping': barrelShippingAvailable,
    'freightAir': freightAirAvailable,
    'freightSea': freightSeaAvailable,
    'carTransport': carTransportAvailable,
  };

  bool get isBarrelShippingConfigured =>
      barrelShippingAvailable && barrelShippingPrice > 0;

  double freightRatePerKg(String mode) =>
      mode == 'air' ? freightAirPricePerKg : freightSeaPricePerKg;

  bool freightAvailable(String mode) {
    if (mode == 'air') return freightAirAvailable && freightAirPricePerKg > 0;
    return freightSeaAvailable && freightSeaPricePerKg > 0;
  }

  bool get hasAnyFreightRate =>
      freightAvailable('air') || freightAvailable('sea');

  bool get hasAnyServiceCoverage =>
      isActive &&
      (isBarrelShippingConfigured ||
          hasAnyFreightRate ||
          carTransportAvailable);

  String get displayCode => (code ?? '').trim().toUpperCase();

  String get flagEmoji {
    final countryCode = displayCode;
    if (!RegExp(r'^[A-Z]{2}$').hasMatch(countryCode)) return '🏳️';
    final first = countryCode.codeUnitAt(0) - 0x41 + 0x1F1E6;
    final second = countryCode.codeUnitAt(1) - 0x41 + 0x1F1E6;
    return String.fromCharCodes([first, second]);
  }

  String get displayNameWithCode {
    return displayCode.isEmpty ? name : '$name ($displayCode)';
  }

  bool get hasDeliveryEstimate =>
      deliveryEstimateMinDays != null &&
      deliveryEstimateMaxDays != null &&
      deliveryEstimateMinDays! > 0 &&
      deliveryEstimateMaxDays! >= deliveryEstimateMinDays!;

  String? get deliveryEstimateLabel {
    if (!hasDeliveryEstimate) return null;
    if (deliveryEstimateMinDays == deliveryEstimateMaxDays) {
      return '$deliveryEstimateMinDays days';
    }
    return '$deliveryEstimateMinDays-$deliveryEstimateMaxDays days';
  }

  factory DestinationCountry.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return DestinationCountry(
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
      carTransportAvailable: _legacyCarTransportAvailable(data),
      deliveryEstimateMinDays: (data['deliveryEstimateMinDays'] as num?)
          ?.toInt(),
      deliveryEstimateMaxDays: (data['deliveryEstimateMaxDays'] as num?)
          ?.toInt(),
      destinationNote: data['destinationNote'] as String?,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      if (code != null && code!.isNotEmpty) 'code': code,
      'isActive': isActive,
      'sortOrder': sortOrder,
      'destinationCoverageVersion': 2,
      'serviceAvailability': serviceAvailability,
      'barrelShippingPrice': barrelShippingPrice,
      'freightAirPricePerKg': freightAirPricePerKg,
      'freightSeaPricePerKg': freightSeaPricePerKg,
      'carTransportAvailable': carTransportAvailable,
      if (deliveryEstimateMinDays != null)
        'deliveryEstimateMinDays': deliveryEstimateMinDays,
      if (deliveryEstimateMaxDays != null)
        'deliveryEstimateMaxDays': deliveryEstimateMaxDays,
      if (destinationNote != null && destinationNote!.isNotEmpty)
        'destinationNote': destinationNote,
      'updatedAt': FieldValue.serverTimestamp(),
    };
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
    return data['isActive'] == true;
  }
}

import 'package:cloud_firestore/cloud_firestore.dart';

class DestinationCountry {
  const DestinationCountry({
    required this.id,
    required this.name,
    this.code,
    this.isActive = false,
    this.sortOrder = 0,
    this.destinationCoverageVersion = 1,
    this.barrelShippingAvailable = false,
    this.freightAirAvailable = false,
    this.freightSeaAvailable = false,
    this.barrelShippingPrice = 0,
    this.freightAirPricePerKg = 0,
    this.freightSeaPricePerKg = 0,
    this.freightAirDepartureDays = const [],
    this.freightSeaDepartureDays = const [],
    this.carTransportAvailable = false,
    this.barrelShippingDeliveryEstimateMinDays,
    this.barrelShippingDeliveryEstimateMaxDays,
    this.freightAirDeliveryEstimateMinDays,
    this.freightAirDeliveryEstimateMaxDays,
    this.freightSeaDeliveryEstimateMinDays,
    this.freightSeaDeliveryEstimateMaxDays,
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
  final List<String> freightAirDepartureDays;
  final List<String> freightSeaDepartureDays;
  final bool carTransportAvailable;
  // Each service has its own real-world transit time, so the delivery
  // estimate is tracked per service instead of one shared pair for the
  // whole country.
  final int? barrelShippingDeliveryEstimateMinDays;
  final int? barrelShippingDeliveryEstimateMaxDays;
  final int? freightAirDeliveryEstimateMinDays;
  final int? freightAirDeliveryEstimateMaxDays;
  final int? freightSeaDeliveryEstimateMinDays;
  final int? freightSeaDeliveryEstimateMaxDays;
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

  (int, int)? _deliveryEstimateRange(String service) {
    final int? minDays;
    final int? maxDays;
    switch (service) {
      case 'barrelShipping':
        minDays = barrelShippingDeliveryEstimateMinDays;
        maxDays = barrelShippingDeliveryEstimateMaxDays;
        break;
      case 'freightAir':
        minDays = freightAirDeliveryEstimateMinDays;
        maxDays = freightAirDeliveryEstimateMaxDays;
        break;
      case 'freightSea':
        minDays = freightSeaDeliveryEstimateMinDays;
        maxDays = freightSeaDeliveryEstimateMaxDays;
        break;
      default:
        minDays = null;
        maxDays = null;
    }
    if (minDays == null || maxDays == null || minDays <= 0 || maxDays < minDays) {
      return null;
    }
    return (minDays, maxDays);
  }

  bool hasDeliveryEstimateFor(String service) =>
      _deliveryEstimateRange(service) != null;

  bool get hasAnyDeliveryEstimate =>
      hasDeliveryEstimateFor('barrelShipping') ||
      hasDeliveryEstimateFor('freightAir') ||
      hasDeliveryEstimateFor('freightSea');

  String? deliveryEstimateLabelFor(String service) {
    final range = _deliveryEstimateRange(service);
    if (range == null) return null;
    final (minDays, maxDays) = range;
    if (minDays == maxDays) return '$minDays days';
    return '$minDays-$maxDays days';
  }

  bool get hasBarrelShippingDeliveryEstimate =>
      hasDeliveryEstimateFor('barrelShipping');
  String? get barrelShippingDeliveryEstimateLabel =>
      deliveryEstimateLabelFor('barrelShipping');
  String? get freightAirDeliveryEstimateLabel =>
      deliveryEstimateLabelFor('freightAir');
  String? get freightSeaDeliveryEstimateLabel =>
      deliveryEstimateLabelFor('freightSea');

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
      freightAirDepartureDays: _departureDays(data['freightAirDepartureDays']),
      freightSeaDepartureDays: _departureDays(data['freightSeaDepartureDays']),
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
      'freightAirDepartureDays': freightAirDepartureDays,
      'freightSeaDepartureDays': freightSeaDepartureDays,
      'carTransportAvailable': carTransportAvailable,
      if (barrelShippingDeliveryEstimateMinDays != null)
        'barrelShippingDeliveryEstimateMinDays':
            barrelShippingDeliveryEstimateMinDays,
      if (barrelShippingDeliveryEstimateMaxDays != null)
        'barrelShippingDeliveryEstimateMaxDays':
            barrelShippingDeliveryEstimateMaxDays,
      if (freightAirDeliveryEstimateMinDays != null)
        'freightAirDeliveryEstimateMinDays': freightAirDeliveryEstimateMinDays,
      if (freightAirDeliveryEstimateMaxDays != null)
        'freightAirDeliveryEstimateMaxDays': freightAirDeliveryEstimateMaxDays,
      if (freightSeaDeliveryEstimateMinDays != null)
        'freightSeaDeliveryEstimateMinDays': freightSeaDeliveryEstimateMinDays,
      if (freightSeaDeliveryEstimateMaxDays != null)
        'freightSeaDeliveryEstimateMaxDays': freightSeaDeliveryEstimateMaxDays,
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

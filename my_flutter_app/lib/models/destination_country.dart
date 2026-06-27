import 'package:cloud_firestore/cloud_firestore.dart';

class DestinationCountry {
  const DestinationCountry({
    required this.id,
    required this.name,
    this.code,
    this.isActive = false,
    this.sortOrder = 0,
    this.barrelShippingPrice = 0,
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
  final double barrelShippingPrice;
  final int? deliveryEstimateMinDays;
  final int? deliveryEstimateMaxDays;
  final String? destinationNote;

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
      barrelShippingPrice:
          (data['barrelShippingPrice'] as num?)?.toDouble() ?? 0,
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
      'barrelShippingPrice': barrelShippingPrice,
      if (deliveryEstimateMinDays != null)
        'deliveryEstimateMinDays': deliveryEstimateMinDays,
      if (deliveryEstimateMaxDays != null)
        'deliveryEstimateMaxDays': deliveryEstimateMaxDays,
      if (destinationNote != null && destinationNote!.isNotEmpty)
        'destinationNote': destinationNote,
      'updatedAt': FieldValue.serverTimestamp(),
    };
  }
}

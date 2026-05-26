import 'package:cloud_firestore/cloud_firestore.dart';

class BarrelPickupPricing {
  const BarrelPickupPricing({
    required this.officeAddress,
    required this.basePickupFee,
    required this.perMileFee,
    required this.minimumPickupFee,
    required this.boroughMiles,
  });

  static const defaultPricing = BarrelPickupPricing(
    officeAddress: 'Bronx, NY',
    basePickupFee: 20,
    perMileFee: 4,
    minimumPickupFee: 35,
    boroughMiles: {
      'Bronx': 5,
      'Manhattan': 11,
      'Queens': 16,
      'Brooklyn': 22,
      'Staten Island': 32,
    },
  );

  final String officeAddress;
  final double basePickupFee;
  final double perMileFee;
  final double minimumPickupFee;
  final Map<String, double> boroughMiles;

  factory BarrelPickupPricing.fromMap(Map<String, dynamic>? data) {
    if (data == null) return defaultPricing;
    final miles = <String, double>{...defaultPricing.boroughMiles};
    final rawMiles = data['boroughMiles'];
    if (rawMiles is Map) {
      for (final entry in rawMiles.entries) {
        final value = entry.value;
        if (value is num) {
          miles[entry.key.toString()] = value.toDouble();
        }
      }
    }

    return BarrelPickupPricing(
      officeAddress:
          (data['officeAddress'] as String?)?.trim().isNotEmpty == true
          ? (data['officeAddress'] as String).trim()
          : defaultPricing.officeAddress,
      basePickupFee:
          (data['basePickupFee'] as num?)?.toDouble() ??
          defaultPricing.basePickupFee,
      perMileFee:
          (data['perMileFee'] as num?)?.toDouble() ?? defaultPricing.perMileFee,
      minimumPickupFee:
          (data['minimumPickupFee'] as num?)?.toDouble() ??
          defaultPricing.minimumPickupFee,
      boroughMiles: miles,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'officeAddress': officeAddress,
      'basePickupFee': basePickupFee,
      'perMileFee': perMileFee,
      'minimumPickupFee': minimumPickupFee,
      'boroughMiles': boroughMiles,
      'updatedAt': FieldValue.serverTimestamp(),
    };
  }

  double milesForBorough(String borough) {
    return boroughMiles[borough] ?? boroughMiles['Bronx'] ?? 0;
  }

  double pickupFeeForBorough(String borough) {
    final calculated = basePickupFee + (milesForBorough(borough) * perMileFee);
    return calculated < minimumPickupFee ? minimumPickupFee : calculated;
  }
}

class BarrelPricingService {
  BarrelPricingService({FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  Stream<BarrelPickupPricing> pickupPricing() {
    return _firestore
        .collection('shipmentPricing')
        .doc('barrelPickup')
        .snapshots()
        .map((snapshot) => BarrelPickupPricing.fromMap(snapshot.data()));
  }

  Future<void> savePickupPricing(BarrelPickupPricing pricing) {
    return _firestore
        .collection('shipmentPricing')
        .doc('barrelPickup')
        .set(pricing.toFirestore(), SetOptions(merge: true));
  }
}

import 'package:cloud_firestore/cloud_firestore.dart';

class BarrelPickupPricing {
  const BarrelPickupPricing({
    required this.officeAddress,
    required this.boroughPrices,
  });

  static const defaultPricing = BarrelPickupPricing(
    officeAddress: 'Bronx, NY',
    boroughPrices: {
      'Bronx': 40,
      'Manhattan': 64,
      'Queens': 84,
      'Brooklyn': 108,
      'Staten Island': 148,
    },
  );

  final String officeAddress;
  final Map<String, double> boroughPrices;

  factory BarrelPickupPricing.fromMap(Map<String, dynamic>? data) {
    if (data == null) return defaultPricing;
    final prices = <String, double>{...defaultPricing.boroughPrices};
    final rawPrices = data['boroughPrices'];
    if (rawPrices is Map) {
      for (final entry in rawPrices.entries) {
        final value = entry.value;
        if (value is num) {
          prices[entry.key.toString()] = value.toDouble();
        }
      }
    } else {
      prices
        ..clear()
        ..addAll(_pricesFromLegacyMileage(data));
    }

    return BarrelPickupPricing(
      officeAddress:
          (data['officeAddress'] as String?)?.trim().isNotEmpty == true
          ? (data['officeAddress'] as String).trim()
          : defaultPricing.officeAddress,
      boroughPrices: prices,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'officeAddress': officeAddress,
      'boroughPrices': boroughPrices,
      'updatedAt': FieldValue.serverTimestamp(),
    };
  }

  double pickupFeeForBorough(String borough) {
    return boroughPrices[borough] ?? boroughPrices['Bronx'] ?? 0;
  }

  static Map<String, double> _pricesFromLegacyMileage(
    Map<String, dynamic> data,
  ) {
    final basePickupFee = (data['basePickupFee'] as num?)?.toDouble() ?? 20;
    final perMileFee = (data['perMileFee'] as num?)?.toDouble() ?? 4;
    final minimumPickupFee =
        (data['minimumPickupFee'] as num?)?.toDouble() ?? 35;
    final miles = <String, double>{
      'Bronx': 5,
      'Manhattan': 11,
      'Queens': 16,
      'Brooklyn': 22,
      'Staten Island': 32,
    };
    final rawMiles = data['boroughMiles'];
    if (rawMiles is Map) {
      for (final entry in rawMiles.entries) {
        final value = entry.value;
        if (value is num) {
          miles[entry.key.toString()] = value.toDouble();
        }
      }
    }
    return {
      for (final entry in miles.entries)
        entry.key: (basePickupFee + entry.value * perMileFee) < minimumPickupFee
            ? minimumPickupFee
            : basePickupFee + entry.value * perMileFee,
    };
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

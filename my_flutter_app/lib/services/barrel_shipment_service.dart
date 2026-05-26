import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import '../models/barrel_shipment.dart';

class BarrelAddressSuggestion {
  const BarrelAddressSuggestion({
    required this.description,
    required this.placeId,
  });

  final String description;
  final String placeId;

  factory BarrelAddressSuggestion.fromMap(Map<String, dynamic> data) {
    return BarrelAddressSuggestion(
      description: (data['description'] ?? '') as String,
      placeId: (data['placeId'] ?? '') as String,
    );
  }
}

class BarrelShipmentService {
  BarrelShipmentService({
    FirebaseFunctions? functions,
    FirebaseFirestore? firestore,
  }) : _functions = functions ?? FirebaseFunctions.instance,
       _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFunctions _functions;
  final FirebaseFirestore _firestore;

  Future<List<BarrelAddressSuggestion>> addressSuggestions(String input) async {
    final trimmed = input.trim();
    if (trimmed.length < 3) return [];

    final response = await _functions
        .httpsCallable('suggestPickupAddresses')
        .call({'input': trimmed});
    final raw = response.data;
    if (raw is! List) return [];

    return raw
        .whereType<Map>()
        .map(
          (item) =>
              BarrelAddressSuggestion.fromMap(Map<String, dynamic>.from(item)),
        )
        .where((item) => item.description.isNotEmpty)
        .toList();
  }

  Future<BarrelShipment> payForShipment({
    required String senderName,
    required String receiverName,
    required String receiverPhone,
    required String destinationCountryId,
    required bool pickupRequested,
    required String pickupAddress,
    required String pickupBorough,
    required DateTime? pickupDateTime,
  }) async {
    final callable = _functions.httpsCallable(
      'createBarrelShipmentPaymentIntent',
    );
    final response = await callable.call<Map<String, dynamic>>({
      'senderName': senderName,
      'receiverName': receiverName,
      'receiverPhone': receiverPhone,
      'destinationCountryId': destinationCountryId,
      'pickupRequested': pickupRequested,
      'pickupAddress': pickupAddress,
      'pickupBorough': pickupBorough,
      if (pickupDateTime != null)
        'pickupDateTime': pickupDateTime.toUtc().toIso8601String(),
    });

    final data = Map<String, dynamic>.from(response.data);
    final clientSecret = data['clientSecret'] as String?;
    final shipmentId = data['shipmentId'] as String?;
    if (clientSecret == null || clientSecret.isEmpty) {
      throw Exception('Payment could not be initialized.');
    }
    if (shipmentId == null || shipmentId.isEmpty) {
      throw Exception('Shipment could not be initialized.');
    }

    await Stripe.instance.initPaymentSheet(
      paymentSheetParameters: SetupPaymentSheetParameters(
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: 'Keren Auto Sales',
        style: ThemeMode.system,
      ),
    );

    try {
      await Stripe.instance.presentPaymentSheet();
      await _functions.httpsCallable('completeBarrelShipmentPayment').call({
        'shipmentId': shipmentId,
      });
    } catch (_) {
      try {
        await _functions.httpsCallable('cancelPendingBarrelShipment').call({
          'shipmentId': shipmentId,
        });
      } catch (_) {
        // Keep the original Stripe error for the customer-facing message.
      }
      rethrow;
    }

    final snapshot = await _firestore
        .collection('barrelShipments')
        .doc(shipmentId)
        .get();
    return BarrelShipment.fromFirestore(snapshot);
  }
}

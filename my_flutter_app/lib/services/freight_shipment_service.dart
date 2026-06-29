import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

/// Customer-side flow for parcel/box freight shipments (priced by weight,
/// by air or sea). Mirrors [BarrelShipmentService].
class FreightShipmentService {
  FreightShipmentService({
    FirebaseFunctions? functions,
    FirebaseFirestore? firestore,
  }) : _functions = functions ?? FirebaseFunctions.instance,
       _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFunctions _functions;
  final FirebaseFirestore _firestore;

  /// Creates a freight shipment, runs payment (wallet/Stripe), and returns the
  /// saved document data.
  Future<Map<String, dynamic>> payForFreight({
    required String senderName,
    required String receiverName,
    required String receiverPhone,
    required String destinationCountryId,
    required String businessId,
    required String mode,
    required double weightKg,
    bool useWalletBalance = false,
  }) async {
    final response = await _functions
        .httpsCallable('createFreightShipmentPaymentIntent')
        .call<Map<String, dynamic>>({
          'senderName': senderName,
          'receiverName': receiverName,
          'receiverPhone': receiverPhone,
          'destinationCountryId': destinationCountryId,
          'businessId': businessId,
          'mode': mode,
          'weightKg': weightKg,
          'pickupRequested': false,
          'useWalletBalance': useWalletBalance,
        });

    final data = Map<String, dynamic>.from(response.data);
    final shipmentId = data['shipmentId'] as String?;
    if (shipmentId == null || shipmentId.isEmpty) {
      throw Exception('Shipment could not be initialized.');
    }

    final simulatedPayment = data['simulatedPayment'] == true;
    if (!simulatedPayment) {
      final clientSecret = data['clientSecret'] as String?;
      if (clientSecret == null || clientSecret.isEmpty) {
        throw Exception('Payment could not be initialized.');
      }
      await Stripe.instance.initPaymentSheet(
        paymentSheetParameters: SetupPaymentSheetParameters(
          paymentIntentClientSecret: clientSecret,
          merchantDisplayName: 'Laawol',
          style: ThemeMode.system,
        ),
      );
      try {
        await Stripe.instance.presentPaymentSheet();
        await _functions
            .httpsCallable('completeFreightShipmentPayment')
            .call({'shipmentId': shipmentId});
      } catch (_) {
        try {
          await _functions
              .httpsCallable('cancelPendingFreightShipment')
              .call({'shipmentId': shipmentId});
        } catch (_) {
          // Preserve the original Stripe error for the customer message.
        }
        rethrow;
      }
    }

    final snapshot = await _firestore
        .collection('freightShipments')
        .doc(shipmentId)
        .get();
    return {'id': snapshot.id, ...?snapshot.data()};
  }
}

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import 'payment_flow_safety.dart';
import 'stripe_config_service.dart';
import '../models/marketplace_disclosure_acceptance.dart';

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
    /// What is in the parcel. The server re-derives the multiplier from the
    /// business's own settings; sending nothing prices the parcel exactly as
    /// freight was priced before categories existed.
    String? itemCategoryId,
    /// What the customer says it costs to replace, in plain dollars. Also the
    /// cap on any payout, which is what makes it trustworthy unchecked.
    double? declaredValue,
    bool useWalletBalance = false,
    bool pickupRequested = false,
    String? pickupAddress,
    String? pickupBorough,
    String? pickupDateTime,
    String? officeLocationId,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
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
          if ((itemCategoryId ?? '').trim().isNotEmpty)
            'itemCategoryId': itemCategoryId!.trim(),
          if (declaredValue != null && declaredValue > 0)
            'declaredValue': declaredValue,
          'pickupRequested': pickupRequested,
          'pickupAddress': ?pickupAddress,
          'pickupBorough': ?pickupBorough,
          'pickupDateTime': ?pickupDateTime,
          if (!pickupRequested && officeLocationId != null)
            'officeLocationId': officeLocationId,
          'useWalletBalance': useWalletBalance,
          'marketplaceDisclosure': marketplaceAcceptance.toJson(),
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
      await StripeConfigService.ensureConfigured();
      await withStripeConnectedAccount(
        (data['stripeConnectedAccountId'] as String?) ?? '',
        () async {
          await Stripe.instance.initPaymentSheet(
            paymentSheetParameters: SetupPaymentSheetParameters(
              paymentIntentClientSecret: clientSecret,
              merchantDisplayName: 'Laawol',
              style: ThemeMode.light,
            ),
          );
          await completePaymentFlowSafely(
            presentPaymentSheet: Stripe.instance.presentPaymentSheet,
            completeTransaction: () async {
              await _functions
                  .httpsCallable('completeFreightShipmentPayment')
                  .call({'shipmentId': shipmentId});
            },
            cancelPendingTransaction: () async {
              await _functions
                  .httpsCallable('cancelPendingFreightShipment')
                  .call({'shipmentId': shipmentId});
            },
          );
        },
      );
    }

    final snapshot = await _firestore
        .collection('freightShipments')
        .doc(shipmentId)
        .get();
    return {'id': snapshot.id, ...?snapshot.data()};
  }

  /// Returns a live pickup fee (and, for the distance model, the measured
  /// distance in km) for the given business + pickup location. Throws a
  /// [FirebaseFunctionsException] whose `code`/`details.reason` explains why
  /// pickup is unavailable so the UI can show a precise message.
  Future<FreightPickupQuote> quoteFreightPickup({
    required String businessId,
    String? pickupAddress,
    String? pickupBorough,
    double? pickupLatitude,
    double? pickupLongitude,
  }) async {
    final response = await _functions
        .httpsCallable('quoteFreightPickup')
        .call<Map<String, dynamic>>({
          'businessId': businessId,
          'pickupAddress': ?pickupAddress,
          'pickupBorough': ?pickupBorough,
          'pickupLatitude': ?pickupLatitude,
          'pickupLongitude': ?pickupLongitude,
        });
    final data = Map<String, dynamic>.from(response.data);
    return FreightPickupQuote(
      fee: (data['fee'] as num?)?.toDouble() ?? 0,
      model: data['model'] as String? ?? 'distance',
      distanceKm: (data['distanceKm'] as num?)?.toDouble(),
    );
  }

  /// Lets the customer explicitly pay a positive verified-weight adjustment.
  /// Dismissing the sheet leaves the shipment and attempt recoverable.
  Future<Map<String, dynamic>> payFreightBalance({
    required String shipmentId,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  }) async {
    final response = await _functions
        .httpsCallable('createFreightSettlementPayment')
        .call<Map<String, dynamic>>({
          'shipmentId': shipmentId,
          'marketplaceDisclosure': marketplaceAcceptance.toJson(),
        });
    final data = Map<String, dynamic>.from(response.data);
    if (data['alreadySettled'] != true && data['simulatedPayment'] != true) {
      final clientSecret = data['clientSecret'] as String?;
      final settlementId = data['settlementId'] as String?;
      final attemptId = data['attemptId'] as String?;
      if (clientSecret == null ||
          clientSecret.isEmpty ||
          settlementId == null ||
          attemptId == null) {
        throw Exception('Balance payment could not be initialized.');
      }
      await StripeConfigService.ensureConfigured();
      await withStripeConnectedAccount(
        (data['stripeConnectedAccountId'] as String?) ?? '',
        () async {
          await Stripe.instance.initPaymentSheet(
            paymentSheetParameters: SetupPaymentSheetParameters(
              paymentIntentClientSecret: clientSecret,
              merchantDisplayName: 'Laawol',
              style: ThemeMode.light,
            ),
          );
          await Stripe.instance.presentPaymentSheet();
        },
      );
      await _functions.httpsCallable('completeFreightSettlementPayment').call({
        'settlementId': settlementId,
        'attemptId': attemptId,
      });
    }
    final snapshot = await _firestore
        .collection('freightShipments')
        .doc(shipmentId)
        .get();
    return {'id': snapshot.id, ...?snapshot.data()};
  }
}

/// A live freight pickup fee quote. [distanceKm] is only set for the distance
/// pricing model.
class FreightPickupQuote {
  const FreightPickupQuote({
    required this.fee,
    required this.model,
    this.distanceKm,
  });

  final double fee;
  final String model;
  final double? distanceKm;
}

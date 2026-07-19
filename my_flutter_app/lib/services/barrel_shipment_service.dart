import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import '../models/barrel_shipment.dart';
import '../models/barrel_order.dart';
import '../models/marketplace_disclosure_acceptance.dart';
import 'payment_flow_safety.dart';
import 'stripe_config_service.dart';

class BarrelAddressSuggestion {
  const BarrelAddressSuggestion({
    required this.description,
    required this.placeId,
    this.borough,
    this.postalCode,
    this.formattedAddress,
    this.latitude,
    this.longitude,
  });

  final String description;
  final String placeId;
  final String? borough;
  final String? postalCode;
  final String? formattedAddress;
  final double? latitude;
  final double? longitude;

  factory BarrelAddressSuggestion.fromMap(Map<String, dynamic> data) {
    return BarrelAddressSuggestion(
      description: (data['description'] ?? '') as String,
      placeId: (data['placeId'] ?? '') as String,
      borough: data['borough'] as String?,
      postalCode: data['postalCode'] as String?,
      formattedAddress: data['formattedAddress'] as String?,
      latitude: (data['latitude'] as num?)?.toDouble(),
      longitude: (data['longitude'] as num?)?.toDouble(),
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

  Future<void> _refreshAuthTokenIfAvailable() async {
    await FirebaseAuth.instance.currentUser?.getIdToken(true);
  }

  Future<List<BarrelAddressSuggestion>> addressSuggestions(String input) async {
    final trimmed = input.trim();
    if (trimmed.isEmpty) return [];

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
    required String businessId,
    int quantity = 1,
    required bool pickupRequested,
    required String pickupAddress,
    required String pickupBorough,
    required DateTime? pickupDateTime,
    bool useWalletBalance = false,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  }) async {
    final callable = _functions.httpsCallable(
      'createBarrelShipmentPaymentIntent',
    );
    final response = await callable.call<Map<String, dynamic>>({
      'senderName': senderName,
      'receiverName': receiverName,
      'receiverPhone': receiverPhone,
      'destinationCountryId': destinationCountryId,
      'businessId': businessId,
      'quantity': quantity,
      'pickupRequested': pickupRequested,
      'pickupAddress': pickupAddress,
      'pickupBorough': pickupBorough,
      'useWalletBalance': useWalletBalance,
      'marketplaceDisclosure': marketplaceAcceptance.toJson(),
      if (pickupDateTime != null)
        'pickupDateTime': pickupDateTime.toUtc().toIso8601String(),
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
          await _refreshAuthTokenIfAvailable();
          await _functions.httpsCallable('completeBarrelShipmentPayment').call({
            'shipmentId': shipmentId,
          });
        },
        cancelPendingTransaction: () async {
          await _refreshAuthTokenIfAvailable();
          await _functions.httpsCallable('cancelPendingBarrelShipment').call({
            'shipmentId': shipmentId,
          });
        },
      );
    }

    final snapshot = await _firestore
        .collection('barrelShipments')
        .doc(shipmentId)
        .get();
    return BarrelShipment.fromFirestore(snapshot);
  }

  Future<BarrelOrderResult> payForOrder({
    required String senderName,
    required List<BarrelOrderLine> lines,
    bool? pickupRequested,
    String? pickupAddress,
    String? pickupBorough,
    DateTime? pickupDateTime,
    bool useWalletBalance = false,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  }) async {
    final callable = _functions.httpsCallable('createBarrelOrderPaymentIntent');
    late final HttpsCallableResult<Map<String, dynamic>> response;
    try {
      response = await callable.call<Map<String, dynamic>>({
        'senderName': senderName,
        'useWalletBalance': useWalletBalance,
        'lines': lines.map((line) => line.toCallableJson()).toList(),
        'pickupRequested': ?pickupRequested,
        'pickupAddress': ?pickupAddress,
        'pickupBorough': ?pickupBorough,
        'marketplaceDisclosure': marketplaceAcceptance.toJson(),
        if (pickupDateTime != null)
          'pickupDateTime': pickupDateTime.toUtc().toIso8601String(),
      });
    } on FirebaseFunctionsException catch (error) {
      if (error.code == 'not-found') {
        if (lines.length == 1) {
          final shipment = await _paySingleLineWithLegacyCallable(
            senderName: senderName,
            line: lines.single,
            pickupRequested: pickupRequested,
            pickupAddress: pickupAddress,
            pickupBorough: pickupBorough,
            pickupDateTime: pickupDateTime,
            useWalletBalance: useWalletBalance,
            marketplaceAcceptance: marketplaceAcceptance,
          );
          return BarrelOrderResult(
            orderId: shipment.orderId ?? shipment.id,
            shipments: [shipment],
            trackingCodes: [shipment.trackingCode],
          );
        }
        throw const BarrelOrderPaymentFunctionMissingException();
      }
      rethrow;
    }

    final data = Map<String, dynamic>.from(response.data);
    final orderId = data['orderId'] as String?;
    if (orderId == null || orderId.isEmpty) {
      throw Exception('Order could not be initialized.');
    }
    final shipmentIds = (data['shipmentIds'] as List? ?? const [])
        .whereType<String>()
        .where((id) => id.isNotEmpty)
        .toList();
    if (shipmentIds.isEmpty) {
      throw Exception('Order did not create any shipments.');
    }
    final simulatedPayment = data['simulatedPayment'] == true;

    if (!simulatedPayment) {
      final clientSecret = data['clientSecret'] as String?;
      if (clientSecret == null || clientSecret.isEmpty) {
        throw Exception('Payment could not be initialized.');
      }

      await StripeConfigService.ensureConfigured();
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
          await _refreshAuthTokenIfAvailable();
          await _functions.httpsCallable('completeBarrelOrderPayment').call({
            'orderId': orderId,
          });
        },
        cancelPendingTransaction: () async {
          await _refreshAuthTokenIfAvailable();
          await _functions.httpsCallable('cancelPendingBarrelOrder').call({
            'orderId': orderId,
          });
        },
      );
    }

    final snapshots = await Future.wait(
      shipmentIds.map(
        (id) => _firestore.collection('barrelShipments').doc(id).get(),
      ),
    );
    final shipments = snapshots
        .where((snapshot) => snapshot.exists)
        .map(BarrelShipment.fromFirestore)
        .toList();
    return BarrelOrderResult(
      orderId: orderId,
      shipments: shipments,
      trackingCodes: shipments
          .map((shipment) => shipment.trackingCode)
          .toList(),
    );
  }

  Future<BarrelShipment> _paySingleLineWithLegacyCallable({
    required String senderName,
    required BarrelOrderLine line,
    required bool? pickupRequested,
    required String? pickupAddress,
    required String? pickupBorough,
    required DateTime? pickupDateTime,
    required bool useWalletBalance,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  }) {
    final resolvedPickupRequested = pickupRequested ?? line.pickupRequested;
    return payForShipment(
      senderName: senderName,
      receiverName: line.receiverName,
      receiverPhone: line.receiverPhone,
      destinationCountryId: line.country.id,
      businessId: line.business.businessId,
      quantity: line.quantity,
      pickupRequested: resolvedPickupRequested,
      pickupAddress: resolvedPickupRequested
          ? (line.pickupAddress.isNotEmpty
                ? line.pickupAddress
                : (pickupAddress ?? ''))
          : (pickupAddress ?? line.pickupAddress),
      pickupBorough: resolvedPickupRequested
          ? (line.pickupBorough.isNotEmpty
                ? line.pickupBorough
                : (pickupBorough ?? ''))
          : 'Office drop-off',
      pickupDateTime: resolvedPickupRequested
          ? (line.pickupDateTime ?? pickupDateTime)
          : null,
      useWalletBalance: useWalletBalance,
      marketplaceAcceptance: marketplaceAcceptance,
    );
  }

  Future<String> createBusinessStripeAccountLink({
    required String businessId,
    required String returnUrl,
    required String refreshUrl,
  }) async {
    final response = await _functions
        .httpsCallable('createBusinessStripeAccountLink')
        .call<Map<String, dynamic>>({
          'businessId': businessId,
          'returnUrl': returnUrl,
          'refreshUrl': refreshUrl,
        });
    final url = Map<String, dynamic>.from(response.data)['url'] as String?;
    if (url == null || url.isEmpty) {
      throw Exception('Stripe onboarding link could not be created.');
    }
    return url;
  }

  Future<void> refreshBusinessStripeAccountStatus({
    required String businessId,
  }) async {
    await _functions.httpsCallable('refreshBusinessStripeAccountStatus').call({
      'businessId': businessId,
    });
  }

  Future<BarrelDestinationChangeResult> changeDestination({
    required String shipmentId,
    required String destinationCountryId,
    required String businessId,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  }) async {
    final changeRequestId = _firestore
        .collection('barrelDestinationChanges')
        .doc()
        .id;
    late final HttpsCallableResult<Map<String, dynamic>> response;
    try {
      response = await _functions
          .httpsCallable('changeBarrelShipmentDestination')
          .call<Map<String, dynamic>>({
            'shipmentId': shipmentId,
            'destinationCountryId': destinationCountryId,
            'businessId': businessId,
            'changeRequestId': changeRequestId,
            'marketplaceDisclosure': marketplaceAcceptance.toJson(),
          });
    } on FirebaseFunctionsException catch (error) {
      if (error.code == 'failed-precondition' &&
          (error.message ?? '').contains('needs support')) {
        throw const BarrelDestinationRequiresSupportException();
      }
      rethrow;
    }
    final result = BarrelDestinationChangeResult.fromMap(
      Map<String, dynamic>.from(response.data),
    );
    if (!result.requiresPayment) return result;
    if (result.clientSecret.isEmpty || result.changeRequestId.isEmpty) {
      throw const BarrelDestinationPaymentInitializationException();
    }

    await StripeConfigService.ensureConfigured();
    await Stripe.instance.initPaymentSheet(
      paymentSheetParameters: SetupPaymentSheetParameters(
        paymentIntentClientSecret: result.clientSecret,
        merchantDisplayName: result.businessName.isEmpty
            ? 'Laawol'
            : result.businessName,
        style: ThemeMode.light,
      ),
    );
    await completePaymentFlowSafely(
      presentPaymentSheet: Stripe.instance.presentPaymentSheet,
      completeTransaction: () async {
        await _functions.httpsCallable('completeBarrelDestinationChange').call({
          'shipmentId': shipmentId,
          'changeRequestId': result.changeRequestId,
        });
      },
      cancelPendingTransaction: () async {
        await _functions
            .httpsCallable('cancelPendingBarrelDestinationChange')
            .call({
              'shipmentId': shipmentId,
              'changeRequestId': result.changeRequestId,
            });
      },
    );
    return result;
  }
}

class BarrelDestinationPaymentInitializationException implements Exception {
  const BarrelDestinationPaymentInitializationException();
}

class BarrelDestinationRequiresSupportException implements Exception {
  const BarrelDestinationRequiresSupportException();
}

class BarrelDestinationChangeResult {
  const BarrelDestinationChangeResult({
    required this.shipmentId,
    required this.trackingCode,
    required this.difference,
    required this.amountDue,
    required this.walletCredit,
    required this.simulatedPayment,
    required this.requiresPayment,
    required this.changeRequestId,
    required this.clientSecret,
    required this.businessName,
  });

  final String shipmentId;
  final String trackingCode;
  final double difference;
  final double amountDue;
  final double walletCredit;
  final bool simulatedPayment;
  final bool requiresPayment;
  final String changeRequestId;
  final String clientSecret;
  final String businessName;

  factory BarrelDestinationChangeResult.fromMap(Map<String, dynamic> data) {
    return BarrelDestinationChangeResult(
      shipmentId: (data['shipmentId'] ?? '') as String,
      trackingCode: (data['trackingCode'] ?? '') as String,
      difference: (data['difference'] as num?)?.toDouble() ?? 0,
      amountDue: (data['amountDue'] as num?)?.toDouble() ?? 0,
      walletCredit: (data['walletCredit'] as num?)?.toDouble() ?? 0,
      simulatedPayment: data['simulatedPayment'] == true,
      requiresPayment: data['requiresPayment'] == true,
      changeRequestId: (data['changeRequestId'] as String?) ?? '',
      clientSecret: (data['clientSecret'] as String?) ?? '',
      businessName: (data['businessName'] as String?) ?? '',
    );
  }
}

class BarrelOrderPaymentFunctionMissingException implements Exception {
  const BarrelOrderPaymentFunctionMissingException();

  @override
  String toString() => 'Barrel order payment function is not deployed.';
}

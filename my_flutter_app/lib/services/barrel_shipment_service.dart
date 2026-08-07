import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import '../models/barrel_shipment.dart';
import '../models/barrel_order.dart';
import '../models/marketplace_disclosure_acceptance.dart';
import '../models/structured_address.dart';
import 'payment_flow_safety.dart';
import 'stripe_config_service.dart';

/// Result of quoteBarrelPickup: a priced quote, or a refusal when the
/// business has not configured home pickup.
class BarrelPickupQuote {
  const BarrelPickupQuote({
    required this.available,
    this.fee = 0,
    this.borough = '',
    this.normalizedAddress = '',
    this.reason = '',
  });

  final bool available;
  final double fee;
  final String borough;
  final String normalizedAddress;
  final String reason;
}

class BarrelAddressSuggestion {
  const BarrelAddressSuggestion({
    required this.description,
    required this.placeId,
    this.borough,
    this.postalCode,
    this.formattedAddress,
    this.latitude,
    this.longitude,
    this.streetLine,
    this.apartment,
    this.city,
    this.state,
    this.stateCode,
    this.country,
  });

  final String description;
  final String placeId;
  final String? borough;
  final String? postalCode;
  final String? formattedAddress;
  final double? latitude;
  final double? longitude;
  // Named parts from suggestPickupAddresses. Nullable so an app build newer
  // than the deployed callable degrades to the single line instead of
  // emptying the form.
  final String? streetLine;
  final String? apartment;
  final String? city;
  final String? state;
  final String? stateCode;
  final String? country;

  factory BarrelAddressSuggestion.fromMap(Map<String, dynamic> data) {
    return BarrelAddressSuggestion(
      description: (data['description'] ?? '') as String,
      placeId: (data['placeId'] ?? '') as String,
      borough: data['borough'] as String?,
      postalCode: data['postalCode'] as String?,
      formattedAddress: data['formattedAddress'] as String?,
      latitude: (data['latitude'] as num?)?.toDouble(),
      longitude: (data['longitude'] as num?)?.toDouble(),
      streetLine: data['streetLine'] as String?,
      apartment: data['apartment'] as String?,
      city: data['city'] as String?,
      state: data['state'] as String?,
      stateCode: data['stateCode'] as String?,
      country: data['country'] as String?,
    );
  }

  /// Populates the form's separate fields from this suggestion.
  ///
  /// An apartment the customer already typed in [current] wins: Google
  /// autocompletes buildings, not units, so its subpremise is nearly always
  /// empty and letting it win would silently erase the unit number — the
  /// exact bug this replaces.
  StructuredAddress toStructuredAddress({
    StructuredAddress current = StructuredAddress.empty,
  }) {
    String part(String? value) => StructuredAddress.cleanPart(value);
    return StructuredAddress(
      // An older callable sends only the line; it becomes the street field so
      // the customer can break it apart by hand rather than facing a blank
      // form.
      streetLine: part(streetLine).isNotEmpty
          ? part(streetLine)
          : (part(formattedAddress).isNotEmpty
                ? part(formattedAddress)
                : part(description)),
      apartment: part(current.apartment).isNotEmpty
          ? current.apartment
          : part(apartment),
      city: part(city).isNotEmpty ? part(city) : part(borough),
      // The abbreviation is what belongs on an envelope and in the state box.
      state: part(stateCode).isNotEmpty ? part(stateCode) : part(state),
      postalCode: part(postalCode),
      country: part(country),
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

  /// Asks the server what this business charges to pick up from an address.
  /// Pickup belongs to the business: the geocoded address decides the fee,
  /// and a business without a configured plan is a refusal, not a default.
  Future<BarrelPickupQuote> quoteBarrelPickup({
    required String businessId,
    required String pickupAddress,
  }) async {
    final response = await _functions.httpsCallable('quoteBarrelPickup').call({
      'businessId': businessId,
      'pickupAddress': pickupAddress.trim(),
    });
    final data = Map<String, dynamic>.from(response.data as Map);
    if (data['available'] != true) {
      return BarrelPickupQuote(
        available: false,
        reason: data['reason']?.toString() ?? '',
      );
    }
    return BarrelPickupQuote(
      available: true,
      fee: (data['fee'] as num?)?.toDouble() ?? 0,
      borough: data['borough']?.toString() ?? '',
      normalizedAddress: data['normalizedAddress']?.toString() ?? '',
    );
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
              await _refreshAuthTokenIfAvailable();
              await _functions
                  .httpsCallable('completeBarrelShipmentPayment')
                  .call({'shipmentId': shipmentId});
            },
            cancelPendingTransaction: () async {
              await _refreshAuthTokenIfAvailable();
              await _functions
                  .httpsCallable('cancelPendingBarrelShipment')
                  .call({'shipmentId': shipmentId});
            },
          );
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
              await _refreshAuthTokenIfAvailable();
              await _functions.httpsCallable('completeBarrelOrderPayment').call(
                {'orderId': orderId},
              );
            },
            cancelPendingTransaction: () async {
              await _refreshAuthTokenIfAvailable();
              await _functions.httpsCallable('cancelPendingBarrelOrder').call({
                'orderId': orderId,
              });
            },
          );
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
    await withStripeConnectedAccount(result.stripeConnectedAccountId, () async {
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
          await _functions
              .httpsCallable('completeBarrelDestinationChange')
              .call({
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
    });
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
    required this.cardRefund,
    required this.simulatedPayment,
    required this.requiresPayment,
    required this.changeRequestId,
    required this.clientSecret,
    required this.businessName,
    this.stripeConnectedAccountId = '',
  });

  final String shipmentId;
  final String trackingCode;
  final double difference;
  final double amountDue;

  /// Money returned to the card the shipment was paid on when a destination
  /// change makes it cheaper. This used to arrive as `walletCredit`; wallets
  /// are retired, so the difference goes back the way it came.
  final double cardRefund;
  final bool simulatedPayment;
  final bool requiresPayment;
  final String changeRequestId;
  final String clientSecret;
  final String businessName;

  /// Empty for this flow today - the server creates the destination-change
  /// intent on the platform account. Kept so the payment sheet stays scoped
  /// the same way as every other flow if that ever changes.
  final String stripeConnectedAccountId;

  factory BarrelDestinationChangeResult.fromMap(Map<String, dynamic> data) {
    return BarrelDestinationChangeResult(
      shipmentId: (data['shipmentId'] ?? '') as String,
      trackingCode: (data['trackingCode'] ?? '') as String,
      difference: (data['difference'] as num?)?.toDouble() ?? 0,
      amountDue: (data['amountDue'] as num?)?.toDouble() ?? 0,
      cardRefund: (data['cardRefund'] as num?)?.toDouble() ?? 0,
      simulatedPayment: data['simulatedPayment'] == true,
      requiresPayment: data['requiresPayment'] == true,
      changeRequestId: (data['changeRequestId'] as String?) ?? '',
      clientSecret: (data['clientSecret'] as String?) ?? '',
      businessName: (data['businessName'] as String?) ?? '',
      stripeConnectedAccountId:
          (data['stripeConnectedAccountId'] as String?) ?? '',
    );
  }
}

class BarrelOrderPaymentFunctionMissingException implements Exception {
  const BarrelOrderPaymentFunctionMissingException();

  @override
  String toString() => 'Barrel order payment function is not deployed.';
}

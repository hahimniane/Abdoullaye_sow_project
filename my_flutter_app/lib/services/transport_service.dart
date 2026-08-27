import 'package:cloud_functions/cloud_functions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart' show ThemeMode;
import 'package:flutter_stripe/flutter_stripe.dart';

import '../models/business_destination_option.dart';
import '../models/business_service.dart';
import '../models/transport_quote.dart';
import 'payment_flow_safety.dart';
import 'stripe_config_service.dart';

/// Customer-facing car-transport requests. Businesses that enable the
/// `carTransport` service receive these requests and quote a price; the
/// customer pays when they accept one - the amount is held, not charged,
/// under the same hold-first model as every other service.
class TransportService {
  TransportService({FirebaseFunctions? functions, FirebaseFirestore? firestore})
    : _functions = functions ?? FirebaseFunctions.instance,
      _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFunctions _functions;
  final FirebaseFirestore _firestore;

  /// Approved businesses offering car transport, paired with each active
  /// destination they cover.
  Future<List<BusinessDestinationOption>> activeTransportOptions() async {
    final response = await _functions
        .httpsCallable('listTransportBusinessOptions')
        .call<Map<String, dynamic>>();
    final rawOptions = response.data['options'];
    if (rawOptions is! List) return const <BusinessDestinationOption>[];
    return rawOptions
        .whereType<Map>()
        .map(
          (option) => BusinessDestinationOption.fromFunctionData(
            Map<String, dynamic>.from(option),
          ),
        )
        .where(
          (option) => option.isAvailableFor(BusinessServiceKey.carTransport),
        )
        .toList();
  }

  /// Revises an open request. The window closes when the customer selects a
  /// quote - in this marketplace no business "accepts", they quote.
  ///
  /// Only pass what actually changed: the server treats an unchanged
  /// resubmission as a no-op, and editing a field a quote was priced against
  /// (vehicle, pickup area, method, operability, destination) voids the quotes
  /// in hand so businesses can re-quote.
  Future<TransportEditResult> updateRequestDetails({
    required String requestId,
    String? destinationCountryId,
    String? carMake,
    String? carModel,
    String? carYear,
    String? customerPhone,
    String? pickupArea,
    String? pickupAddress,
    String? notes,
    bool? vehicleOperable,
    String? requestedTransportMethod,
    bool? flexibleDates,
    DateTime? preferredDate,
  }) async {
    final response = await _functions
        .httpsCallable('updateTransportRequestDetails')
        .call<Map<String, dynamic>>({
          'requestId': requestId,
          'destinationCountryId': ?destinationCountryId,
          'carMake': ?carMake,
          'carModel': ?carModel,
          'carYear': ?carYear,
          'customerPhone': ?customerPhone,
          'pickupArea': ?pickupArea,
          'pickupAddress': ?pickupAddress,
          'notes': ?notes,
          'vehicleOperable': ?vehicleOperable,
          'requestedTransportMethod': ?requestedTransportMethod,
          'flexibleDates': ?flexibleDates,
          if (preferredDate != null)
            'preferredDate': preferredDate.toIso8601String(),
        });
    final data = response.data;
    return TransportEditResult(
      updated: data['updated'] == true,
      requoteRequired: data['requoteRequired'] == true,
      destinationChanged: data['destinationChanged'] == true,
      eligibleBusinessCount:
          (data['eligibleBusinessCount'] as num?)?.toInt() ?? 0,
    );
  }

  /// Submits one marketplace request to every eligible business serving the
  /// selected destination. The customer chooses a provider after quotes arrive.
  Future<TransportRequestResult> createRequest({
    required String destinationCountryId,
    required String destinationCountryName,
    required String ownerName,
    required String carMake,
    required String carModel,
    required String carYear,
    required String customerPhone,
    required String pickupArea,
    required bool vehicleOperable,
    required String requestedTransportMethod,
    required bool flexibleDates,
    String vinNumber = '',
    String pickupAddress = '',
    String notes = '',
    DateTime? preferredDate,
  }) async {
    final response = await _functions
        .httpsCallable('createTransportRequest')
        .call<Map<String, dynamic>>({
          'destinationCountryId': destinationCountryId,
          'destinationCountryName': destinationCountryName,
          'ownerName': ownerName,
          'carMake': carMake,
          'carModel': carModel,
          'carYear': carYear,
          'customerPhone': customerPhone,
          'pickupArea': pickupArea,
          'vehicleOperable': vehicleOperable,
          'requestedTransportMethod': requestedTransportMethod,
          'flexibleDates': flexibleDates,
          'vinNumber': vinNumber,
          'pickupAddress': pickupAddress,
          'notes': notes,
          if (preferredDate != null)
            'preferredDate': preferredDate.toIso8601String(),
        });
    final data = response.data;
    return TransportRequestResult(
      id: (data['id'] ?? '') as String,
      trackingCode: (data['trackingCode'] ?? '') as String,
    );
  }

  Stream<List<TransportQuote>> watchQuotes(String requestId) {
    return _firestore
        .collection('transportQuotes')
        .where('requestId', isEqualTo: requestId)
        .snapshots()
        .map((snapshot) {
          final quotes = snapshot.docs
              .map(TransportQuote.fromFirestore)
              .where((quote) => quote.status != 'withdrawn')
              .toList();
          quotes.sort((a, b) => a.amountCents.compareTo(b.amountCents));
          return quotes;
        });
  }

  Future<void> selectQuote({
    required String requestId,
    required String quoteId,
  }) async {
    await _functions.httpsCallable('selectTransportQuote').call<void>({
      'requestId': requestId,
      'quoteId': quoteId,
    });
  }

  /// Pays for an accepted transport job - the step selection now requires.
  ///
  /// Selection parks the request at `pending_payment`; nothing is charged
  /// and the carrier cannot start until this completes. Safe to call again
  /// after an abandoned payment sheet: the server mints a fresh intent per
  /// attempt, and an unconfirmed manual-capture intent holds nothing.
  Future<void> payForJob({required String requestId}) async {
    final response = await _functions
        .httpsCallable('createTransportJobPaymentIntent')
        .call<Map<String, dynamic>>({'requestId': requestId});
    final data = Map<String, dynamic>.from(response.data);
    if (data['simulatedPayment'] == true || data['alreadySettled'] == true) {
      return;
    }
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
                .httpsCallable('completeTransportJobPayment')
                .call<void>({'requestId': requestId});
          },
          // Abandoning the sheet keeps the carrier selected - the request
          // predates the payment attempt - so only the intent is cancelled
          // and the job stays payable.
          cancelPendingTransaction: () async {
            await _functions
                .httpsCallable('cancelPendingTransportJobPayment')
                .call<void>({'requestId': requestId});
          },
        );
      },
    );
  }

  Future<void> cancelRequest(String requestId) async {
    await _functions.httpsCallable('cancelTransportQuoteRequest').call<void>({
      'requestId': requestId,
    });
  }
}

class TransportRequestResult {
  const TransportRequestResult({required this.id, required this.trackingCode});

  final String id;
  final String trackingCode;
}

/// Outcome of a customer edit, so the UI can explain what the change did:
/// whether quotes were reset and how many businesses now see the request.
class TransportEditResult {
  const TransportEditResult({
    required this.updated,
    required this.requoteRequired,
    required this.destinationChanged,
    required this.eligibleBusinessCount,
  });

  final bool updated;
  final bool requoteRequired;
  final bool destinationChanged;
  final int eligibleBusinessCount;
}

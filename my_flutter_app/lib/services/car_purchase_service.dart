import 'package:cloud_functions/cloud_functions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import '../models/car.dart';
import '../models/car_purchase.dart';
import '../models/marketplace_disclosure_acceptance.dart';
import 'payment_flow_safety.dart';
import 'stripe_config_service.dart';

class CarPurchaseService {
  CarPurchaseService({FirebaseFunctions? functions})
    : _functions = functions ?? FirebaseFunctions.instance;

  final FirebaseFunctions _functions;

  Stream<List<CarPurchase>> activeViewingReservationsForUser(String uid) {
    return FirebaseFirestore.instance
        .collection('carPurchases')
        .where('buyerUid', isEqualTo: uid)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map(CarPurchase.fromFirestore)
              .where((purchase) => purchase.isActiveViewingReservation)
              .toList(),
        );
  }

  Future<CarPurchase?> activeViewingReservationForCar({
    required String buyerUid,
    required String carId,
  }) async {
    final snapshot = await FirebaseFirestore.instance
        .collection('carPurchases')
        .where('buyerUid', isEqualTo: buyerUid)
        .where('carId', isEqualTo: carId)
        .get();
    final active = snapshot.docs
        .map(CarPurchase.fromFirestore)
        .where((purchase) => purchase.isActiveViewingReservation)
        .toList();
    active.sort((a, b) {
      final aTime = a.appointmentStart ?? a.createdAt;
      final bTime = b.appointmentStart ?? b.createdAt;
      return aTime.compareTo(bTime);
    });
    return active.isEmpty ? null : active.first;
  }

  Future<void> reserveViewing({
    required Car car,
    required String buyerName,
    required String buyerPhone,
    required DateTime appointmentStart,
    required String appointmentLabel,
  }) async {
    await _functions.httpsCallable('createCarViewingReservation').call({
      'carId': car.id,
      'buyerName': buyerName,
      'buyerPhone': buyerPhone,
      'appointmentStart': appointmentStart.toUtc().toIso8601String(),
      'appointmentLabel': appointmentLabel,
    });
  }

  Future<void> updateViewingReservation({
    required String purchaseId,
    required DateTime appointmentStart,
    required String appointmentLabel,
  }) async {
    await _functions.httpsCallable('updateCarViewingReservation').call({
      'purchaseId': purchaseId,
      'appointmentStart': appointmentStart.toUtc().toIso8601String(),
      'appointmentLabel': appointmentLabel,
    });
  }

  Future<void> cancelViewingReservation({required String purchaseId}) async {
    await _functions.httpsCallable('cancelCarViewingReservation').call({
      'purchaseId': purchaseId,
    });
  }

  Future<void> purchaseCar({
    required Car car,
    required String buyerName,
    required String buyerPhone,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  }) async {
    final callable = _functions.httpsCallable('createCarPurchasePaymentIntent');
    final response = await callable.call<Map<String, dynamic>>({
      'carId': car.id,
      'buyerName': buyerName,
      'buyerPhone': buyerPhone,
      'marketplaceDisclosure': marketplaceAcceptance.toJson(),
    });
    final data = Map<String, dynamic>.from(response.data);
    final purchaseId = data['purchaseId'] as String?;
    if (purchaseId == null || purchaseId.isEmpty) {
      throw Exception('Purchase could not be initialized.');
    }
    final simulatedPayment = data['simulatedPayment'] == true;
    if (simulatedPayment) return;

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
            await _functions.httpsCallable('completeCarPurchase').call({
              'purchaseId': purchaseId,
            });
          },
          cancelPendingTransaction: () async {
            await _functions.httpsCallable('cancelPendingCarPurchase').call({
              'purchaseId': purchaseId,
            });
          },
        );
      },
    );
  }

  Future<void> reserveWithDeposit({
    required Car car,
    required String buyerName,
    required String buyerPhone,
    required DateTime holdUntilDate,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  }) async {
    final callable = _functions.httpsCallable('createCarDepositPaymentIntent');
    final response = await callable.call<Map<String, dynamic>>({
      'carId': car.id,
      'buyerName': buyerName,
      'buyerPhone': buyerPhone,
      'holdUntilDate': holdUntilDate.toUtc().toIso8601String(),
      'marketplaceDisclosure': marketplaceAcceptance.toJson(),
    });
    final data = Map<String, dynamic>.from(response.data);
    final purchaseId = data['purchaseId'] as String?;
    if (purchaseId == null || purchaseId.isEmpty) {
      throw Exception('Reservation could not be initialized.');
    }
    final simulatedPayment = data['simulatedPayment'] == true;
    if (simulatedPayment) return;

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
                .httpsCallable('completeCarDepositReservation')
                .call({'purchaseId': purchaseId});
          },
          cancelPendingTransaction: () async {
            await _functions.httpsCallable('cancelPendingCarPurchase').call({
              'purchaseId': purchaseId,
            });
          },
        );
      },
    );
  }

  Future<void> requestPaidHoldExtension({
    required String purchaseId,
    required DateTime requestedHoldUntilDate,
  }) async {
    await _functions.httpsCallable('requestPaidHoldExtension').call({
      'purchaseId': purchaseId,
      'requestedHoldUntilDate': requestedHoldUntilDate
          .toUtc()
          .toIso8601String(),
    });
  }

  Future<void> payApprovedHoldExtension({
    required CarPurchase purchase,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  }) async {
    final response = await _functions
        .httpsCallable('createPaidHoldExtensionPaymentIntent')
        .call<Map<String, dynamic>>({
          'purchaseId': purchase.id,
          'marketplaceDisclosure': marketplaceAcceptance.toJson(),
        });
    final data = Map<String, dynamic>.from(response.data);
    if (data['simulatedPayment'] == true) return;
    final clientSecret = data['clientSecret'] as String?;
    if (clientSecret == null || clientSecret.isEmpty) {
      throw Exception('Extension payment could not be initialized.');
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
    await _functions.httpsCallable('completePaidHoldExtensionPayment').call({
      'purchaseId': purchase.id,
    });
  }
}

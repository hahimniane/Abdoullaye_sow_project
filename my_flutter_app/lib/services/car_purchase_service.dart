import 'package:cloud_functions/cloud_functions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import '../models/car.dart';
import '../models/car_purchase.dart';
import '../models/marketplace_disclosure_acceptance.dart';
import 'car_viewing_service.dart';
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

  /// Asks a business to show the car, as a proposal rather than a booking.
  ///
  /// Two calls, deliberately. `createCarViewingReservation` is what mints the
  /// record: it resolves the owning business, refuses a listing that is no
  /// longer for sale and enforces one open viewing per listing. But it writes
  /// the record straight to `viewing_scheduled`, which is the old behaviour
  /// where the business had no say and often no idea the appointment existed.
  /// `actOnCarViewing` then re-proposes the same time, which is a reschedule
  /// as far as the state machine is concerned: the record moves to
  /// `viewing_requested`, the response clock starts, and the business is told
  /// somebody wants to come and see the car.
  ///
  /// A failure on the second call leaves the record exactly where the old flow
  /// left it and is surfaced to the caller. Nothing is lost - both parties can
  /// still re-propose or cancel from there.
  ///
  /// There is no matching "edit" here any more. Moving a viewing is a proposal
  /// like any other, so the caller uses [CarViewingService.propose]; the old
  /// buyer-only `updateCarViewingReservation` path would have rewritten the
  /// appointment behind the business's back.
  Future<CarViewingActionResult> requestViewing({
    required Car car,
    required String buyerName,
    required String buyerPhone,
    required ViewingSlot slot,
  }) async {
    final response = await _functions
        .httpsCallable('createCarViewingReservation')
        .call<Object?>({
          'carId': car.id,
          'buyerName': buyerName,
          'buyerPhone': buyerPhone,
          'appointmentStart': slot.startAt.toUtc().toIso8601String(),
          'appointmentLabel': slot.label,
        });
    // createCarViewingReservation opens the negotiation itself: it writes the
    // record as viewing_requested with the proposed slot, starts the reply
    // clock and notifies the business. A second propose call would only count
    // as another round against the cap.
    final result = CarViewingActionResult.fromCallable(response.data);
    if (result.purchaseId.isEmpty) {
      throw Exception('Viewing request could not be created.');
    }
    return result;
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

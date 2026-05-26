import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import '../models/car.dart';
import '../models/destination_country.dart';

class CarPurchaseService {
  CarPurchaseService({FirebaseFunctions? functions})
    : _functions = functions ?? FirebaseFunctions.instance;

  final FirebaseFunctions _functions;

  Future<void> reserveViewing({
    required Car car,
    required DestinationCountry destinationCountry,
    required String buyerName,
    required String buyerPhone,
    required DateTime appointmentStart,
    required String appointmentLabel,
  }) async {
    await _functions.httpsCallable('createCarViewingReservation').call({
      'carId': car.id,
      'destinationCountryId': destinationCountry.id,
      'buyerName': buyerName,
      'buyerPhone': buyerPhone,
      'appointmentStart': appointmentStart.toUtc().toIso8601String(),
      'appointmentLabel': appointmentLabel,
    });
  }

  Future<void> purchaseCar({
    required Car car,
    required DestinationCountry destinationCountry,
    required String buyerName,
    required String buyerPhone,
  }) async {
    final callable = _functions.httpsCallable('createCarPurchasePaymentIntent');
    final response = await callable.call<Map<String, dynamic>>({
      'carId': car.id,
      'destinationCountryId': destinationCountry.id,
      'buyerName': buyerName,
      'buyerPhone': buyerPhone,
    });
    final data = Map<String, dynamic>.from(response.data);
    final clientSecret = data['clientSecret'] as String?;
    final purchaseId = data['purchaseId'] as String?;
    if (clientSecret == null || clientSecret.isEmpty) {
      throw Exception('Payment could not be initialized.');
    }
    if (purchaseId == null || purchaseId.isEmpty) {
      throw Exception('Purchase could not be initialized.');
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
      await _functions.httpsCallable('completeCarPurchase').call({
        'purchaseId': purchaseId,
      });
    } catch (_) {
      try {
        await _functions.httpsCallable('cancelPendingCarPurchase').call({
          'purchaseId': purchaseId,
        });
      } catch (_) {
        // Preserve the original payment-sheet error for the customer.
      }
      rethrow;
    }
  }

  Future<void> reserveWithDeposit({
    required Car car,
    required DestinationCountry destinationCountry,
    required String buyerName,
    required String buyerPhone,
  }) async {
    final callable = _functions.httpsCallable('createCarDepositPaymentIntent');
    final response = await callable.call<Map<String, dynamic>>({
      'carId': car.id,
      'destinationCountryId': destinationCountry.id,
      'buyerName': buyerName,
      'buyerPhone': buyerPhone,
    });
    final data = Map<String, dynamic>.from(response.data);
    final clientSecret = data['clientSecret'] as String?;
    final purchaseId = data['purchaseId'] as String?;
    if (clientSecret == null || clientSecret.isEmpty) {
      throw Exception('Payment could not be initialized.');
    }
    if (purchaseId == null || purchaseId.isEmpty) {
      throw Exception('Reservation could not be initialized.');
    }

    await Stripe.instance.initPaymentSheet(
      paymentSheetParameters: SetupPaymentSheetParameters(
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: 'Keren Auto Sales',
        style: ThemeMode.system,
      ),
    );
    await Stripe.instance.presentPaymentSheet();
    await _functions.httpsCallable('completeCarDepositReservation').call({
      'purchaseId': purchaseId,
    });
  }
}

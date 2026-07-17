import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import '../models/parking_availability.dart';
import '../models/marketplace_disclosure_acceptance.dart';
import 'payment_flow_safety.dart';
import 'stripe_config_service.dart';

abstract class ParkingRepository {
  Future<List<ParkingBusinessOption>> searchParking({
    required String city,
    required DateTime startDate,
    required DateTime endDate,
    double? customerLatitude,
    double? customerLongitude,
    bool pickupRequested = false,
  });

  Future<ParkingReservationResult> reserveParking({
    required ParkingBusinessOption option,
    required String customerName,
    required String customerPhone,
    required String carMake,
    required String carModel,
    required String carYear,
    required String vinNumber,
    required DateTime startDate,
    required DateTime endDate,
    required bool pickupRequested,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  });
}

class ParkingReservationResult {
  const ParkingReservationResult({
    required this.reservationId,
    required this.trackingCode,
    required this.simulatedPayment,
  });

  final String reservationId;
  final String trackingCode;
  final bool simulatedPayment;
}

class FirebaseParkingService implements ParkingRepository {
  FirebaseParkingService({FirebaseFunctions? functions})
    : _functions = functions ?? FirebaseFunctions.instance;

  final FirebaseFunctions _functions;

  @override
  Future<List<ParkingBusinessOption>> searchParking({
    required String city,
    required DateTime startDate,
    required DateTime endDate,
    double? customerLatitude,
    double? customerLongitude,
    bool pickupRequested = false,
  }) async {
    final response = await _functions
        .httpsCallable('listParkingOptions')
        .call<Map<String, dynamic>>({
          'city': city.trim(),
          'startDate': startDate.toUtc().toIso8601String(),
          'endDate': endDate.toUtc().toIso8601String(),
          'customerLatitude': customerLatitude,
          'customerLongitude': customerLongitude,
          'pickupRequested': pickupRequested,
        });
    final rawOptions = response.data['options'];
    if (rawOptions is! List) return const <ParkingBusinessOption>[];
    return rawOptions
        .whereType<Map>()
        .map(
          (option) => ParkingBusinessOption.fromFunctionData(
            Map<String, dynamic>.from(option),
          ),
        )
        .where((option) => option.hasAvailability)
        .toList();
  }

  @override
  Future<ParkingReservationResult> reserveParking({
    required ParkingBusinessOption option,
    required String customerName,
    required String customerPhone,
    required String carMake,
    required String carModel,
    required String carYear,
    required String vinNumber,
    required DateTime startDate,
    required DateTime endDate,
    required bool pickupRequested,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  }) async {
    final response = await _functions
        .httpsCallable('createParkingReservation')
        .call<Map<String, dynamic>>({
          'businessId': option.businessId,
          'customerName': customerName.trim(),
          'customerPhone': customerPhone.trim(),
          'carMake': carMake.trim(),
          'carModel': carModel.trim(),
          'carYear': carYear.trim(),
          'vinNumber': vinNumber.trim(),
          'startDate': startDate.toUtc().toIso8601String(),
          'endDate': endDate.toUtc().toIso8601String(),
          'pickupRequested': pickupRequested,
          'marketplaceDisclosure': marketplaceAcceptance.toJson(),
        });
    final data = Map<String, dynamic>.from(response.data);
    final reservationId = (data['reservationId'] as String?) ?? '';
    final trackingCode = (data['trackingCode'] as String?) ?? reservationId;
    if (reservationId.isEmpty) {
      throw Exception('Parking reservation could not be initialized.');
    }
    if (data['simulatedPayment'] != true) {
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
          await _functions.httpsCallable('completeParkingReservation').call({
            'reservationId': reservationId,
          });
        },
        cancelPendingTransaction: () async {
          await _functions
              .httpsCallable('cancelPendingParkingReservation')
              .call({'reservationId': reservationId});
        },
      );
    }
    return ParkingReservationResult(
      reservationId: reservationId,
      trackingCode: trackingCode,
      simulatedPayment: data['simulatedPayment'] == true,
    );
  }
}

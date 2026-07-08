import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import '../models/barrel_pool.dart';
import 'stripe_config_service.dart';

class BarrelPoolService {
  BarrelPoolService({
    FirebaseFirestore? firestore,
    FirebaseFunctions? functions,
  }) : _firestore = firestore ?? FirebaseFirestore.instance,
       _functions = functions ?? FirebaseFunctions.instance;

  final FirebaseFirestore _firestore;
  final FirebaseFunctions _functions;

  Future<BarrelPoolResult> _completeDepositPayment(
    BarrelPoolResult result,
  ) async {
    if (result.clientSecret.isEmpty || result.simulatedPayment) {
      return result;
    }

    await StripeConfigService.ensureConfigured();
    await Stripe.instance.initPaymentSheet(
      paymentSheetParameters: SetupPaymentSheetParameters(
        paymentIntentClientSecret: result.clientSecret,
        merchantDisplayName: 'Services',
        style: ThemeMode.system,
      ),
    );

    try {
      await Stripe.instance.presentPaymentSheet();
      await _functions.httpsCallable('completeBarrelPoolDepositPayment').call({
        'poolId': result.poolId,
      });
    } catch (_) {
      try {
        await _functions.httpsCallable('cancelPendingBarrelPoolDeposit').call({
          'poolId': result.poolId,
        });
      } catch (_) {
        // Keep the original Stripe error for the customer-facing message.
      }
      rethrow;
    }

    return result;
  }

  Future<void> payBalance(BarrelPool pool) async {
    final response = await _functions
        .httpsCallable('createBarrelPoolBalancePaymentIntent')
        .call({
          'poolId': pool.id,
          if (pool.balancePaymentRequestId.isNotEmpty)
            'requestId': pool.balancePaymentRequestId,
        });
    final result = BarrelPoolBalancePaymentResult.fromMap(
      Map<String, dynamic>.from(response.data),
    );
    if (result.simulatedPayment || result.clientSecret.isEmpty) {
      await _functions.httpsCallable('completeBarrelPoolBalancePayment').call({
        'requestId': result.requestId,
      });
      return;
    }

    await StripeConfigService.ensureConfigured();
    await Stripe.instance.initPaymentSheet(
      paymentSheetParameters: SetupPaymentSheetParameters(
        paymentIntentClientSecret: result.clientSecret,
        merchantDisplayName: 'Services',
        style: ThemeMode.system,
      ),
    );
    await Stripe.instance.presentPaymentSheet();
    await _functions.httpsCallable('completeBarrelPoolBalancePayment').call({
      'requestId': result.requestId,
    });
  }

  Stream<List<BarrelPool>> openPools({String? destinationCountryId}) {
    Query query = _firestore
        .collection('openBarrels')
        .where('status', isEqualTo: 'open');
    if (destinationCountryId != null && destinationCountryId.isNotEmpty) {
      query = query.where(
        'destinationCountryId',
        isEqualTo: destinationCountryId,
      );
    }
    return query.snapshots().map((snapshot) {
      final rows = snapshot.docs.map(BarrelPool.fromFirestore).toList();
      rows.sort((a, b) {
        final aDeadline = a.joinDeadline?.millisecondsSinceEpoch ?? 0;
        final bDeadline = b.joinDeadline?.millisecondsSinceEpoch ?? 0;
        return aDeadline.compareTo(bDeadline);
      });
      return rows;
    });
  }

  Stream<List<BarrelPool>> myPools(String uid) {
    return _firestore
        .collection('users')
        .doc(uid)
        .collection('barrelPools')
        .snapshots()
        .map((snapshot) {
          final rows = snapshot.docs.map(BarrelPool.fromFirestore).toList();
          rows.sort((a, b) {
            final aDeadline = a.joinDeadline?.millisecondsSinceEpoch ?? 0;
            final bDeadline = b.joinDeadline?.millisecondsSinceEpoch ?? 0;
            return bDeadline.compareTo(aDeadline);
          });
          return rows;
        });
  }

  Future<BarrelPoolResult> createPool({
    required String businessId,
    required String destinationCountryId,
    required String senderName,
    required String receiverName,
    required String receiverPhone,
    required int totalShares,
    required int sharesClaimed,
    String origin = 'customerPosted',
    String approvalMode = 'approval',
    String senderAddress = '',
    String contentsDescription = '',
    double attestedWeightKg = 0,
    bool contentsAttested = false,
    bool prohibitedItemsAcknowledged = false,
    bool sharedLiabilityAccepted = false,
    bool pickupRequested = false,
    String pickupAddress = '',
    String pickupBorough = '',
    bool useWalletBalance = false,
    DateTime? pickupDateTime,
    DateTime? joinDeadline,
  }) async {
    final response = await _functions.httpsCallable('createBarrelPool').call({
      'businessId': businessId,
      'destinationCountryId': destinationCountryId,
      'senderName': senderName,
      'senderAddress': senderAddress,
      'receiverName': receiverName,
      'receiverPhone': receiverPhone,
      'contentsDescription': contentsDescription,
      'attestedWeightKg': attestedWeightKg,
      'contentsAttested': contentsAttested,
      'prohibitedItemsAcknowledged': prohibitedItemsAcknowledged,
      'sharedLiabilityAccepted': sharedLiabilityAccepted,
      'pickupRequested': pickupRequested,
      'useWalletBalance': useWalletBalance,
      'pickupAddress': pickupAddress,
      'pickupBorough': pickupBorough,
      if (pickupDateTime != null)
        'pickupDateTime': pickupDateTime.toUtc().toIso8601String(),
      'totalShares': totalShares,
      'sharesClaimed': sharesClaimed,
      'origin': origin,
      'approvalMode': approvalMode,
      if (joinDeadline != null)
        'joinDeadline': joinDeadline.toUtc().toIso8601String(),
    });
    return _completeDepositPayment(
      BarrelPoolResult.fromMap(Map<String, dynamic>.from(response.data)),
    );
  }

  Future<BarrelPoolResult> requestJoin({
    required String poolId,
    required String destinationCountryId,
    required String senderName,
    required String receiverName,
    required String receiverPhone,
    int sharesClaimed = 1,
    String senderAddress = '',
    String contentsDescription = '',
    double attestedWeightKg = 0,
    bool contentsAttested = false,
    bool prohibitedItemsAcknowledged = false,
    bool sharedLiabilityAccepted = false,
    bool pickupRequested = false,
    String pickupAddress = '',
    String pickupBorough = '',
    bool useWalletBalance = false,
    DateTime? pickupDateTime,
  }) async {
    final response = await _functions
        .httpsCallable('requestJoinBarrelPool')
        .call({
          'poolId': poolId,
          'destinationCountryId': destinationCountryId,
          'sharesClaimed': sharesClaimed,
          'senderName': senderName,
          'senderAddress': senderAddress,
          'receiverName': receiverName,
          'receiverPhone': receiverPhone,
          'contentsDescription': contentsDescription,
          'attestedWeightKg': attestedWeightKg,
          'contentsAttested': contentsAttested,
          'prohibitedItemsAcknowledged': prohibitedItemsAcknowledged,
          'sharedLiabilityAccepted': sharedLiabilityAccepted,
          'pickupRequested': pickupRequested,
          'useWalletBalance': useWalletBalance,
          'pickupAddress': pickupAddress,
          'pickupBorough': pickupBorough,
          if (pickupDateTime != null)
            'pickupDateTime': pickupDateTime.toUtc().toIso8601String(),
        });
    return _completeDepositPayment(
      BarrelPoolResult.fromMap(Map<String, dynamic>.from(response.data)),
    );
  }

  Future<void> cancelPool(String poolId) async {
    await _functions.httpsCallable('cancelBarrelPool').call({'poolId': poolId});
  }

  Future<void> leavePool(String poolId) async {
    await _functions.httpsCallable('leaveBarrelPool').call({'poolId': poolId});
  }
}

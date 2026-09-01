import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/guest_tracking_result.dart';

enum GuestTrackingFailureKind { invalid, rateLimited, unavailable }

class GuestTrackingFailure implements Exception {
  const GuestTrackingFailure(this.kind);

  final GuestTrackingFailureKind kind;
}

abstract interface class GuestTrackingLookupService {
  Future<GuestTrackingResult> lookup(String identifier);

  /// Moves a guest's price request into this device's session, proven by
  /// the email they gave with it. Returns the request id for the details
  /// screen. Throws [GuestTrackingFailure] when the proof does not hold.
  Future<String> claimQuoteRequest({
    required String trackingCode,
    required String email,
  });
}

class FirebaseGuestTrackingService implements GuestTrackingLookupService {
  FirebaseGuestTrackingService({FirebaseFunctions? functions})
    : _functionsOverride = functions;

  final FirebaseFunctions? _functionsOverride;

  FirebaseFunctions get _functions =>
      _functionsOverride ?? FirebaseFunctions.instance;

  @override
  Future<GuestTrackingResult> lookup(String identifier) async {
    try {
      final response = await _functions
          .httpsCallable('lookupGuestTracking')
          .call(<String, dynamic>{'identifier': identifier.trim()});
      final data = response.data;
      if (data is! Map) {
        throw const GuestTrackingFailure(GuestTrackingFailureKind.unavailable);
      }
      return GuestTrackingResult.fromMap(Map<String, dynamic>.from(data));
    } on FirebaseFunctionsException catch (error) {
      throw GuestTrackingFailure(_failureKind(error.code));
    } on GuestTrackingFailure {
      rethrow;
    } on FormatException {
      throw const GuestTrackingFailure(GuestTrackingFailureKind.unavailable);
    } catch (_) {
      throw const GuestTrackingFailure(GuestTrackingFailureKind.unavailable);
    }
  }

  @override
  Future<String> claimQuoteRequest({
    required String trackingCode,
    required String email,
  }) async {
    try {
      // A fresh device has no session yet; the claim only needs an
      // anonymous one to move the request into.
      if (FirebaseAuth.instance.currentUser == null) {
        await FirebaseAuth.instance.signInAnonymously();
      }
      final response = await _functions
          .httpsCallable('claimFreightQuoteRequest')
          .call(<String, dynamic>{
            'trackingCode': trackingCode.trim(),
            'email': email.trim(),
          });
      final data = response.data;
      final requestId = data is Map ? data['requestId'] : null;
      if (requestId is! String || requestId.isEmpty) {
        throw const GuestTrackingFailure(GuestTrackingFailureKind.unavailable);
      }
      return requestId;
    } on FirebaseFunctionsException catch (error) {
      throw GuestTrackingFailure(_failureKind(error.code));
    } on GuestTrackingFailure {
      rethrow;
    } catch (_) {
      throw const GuestTrackingFailure(GuestTrackingFailureKind.unavailable);
    }
  }
}

GuestTrackingFailureKind _failureKind(String code) {
  return switch (code.trim().toLowerCase()) {
    'invalid-argument' => GuestTrackingFailureKind.invalid,
    'resource-exhausted' => GuestTrackingFailureKind.rateLimited,
    _ => GuestTrackingFailureKind.unavailable,
  };
}

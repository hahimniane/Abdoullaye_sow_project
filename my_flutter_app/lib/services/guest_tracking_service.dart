import 'package:cloud_functions/cloud_functions.dart';

import '../models/guest_tracking_result.dart';

enum GuestTrackingFailureKind { invalid, rateLimited, unavailable }

class GuestTrackingFailure implements Exception {
  const GuestTrackingFailure(this.kind);

  final GuestTrackingFailureKind kind;
}

abstract interface class GuestTrackingLookupService {
  Future<GuestTrackingResult> lookup(String identifier);
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
}

GuestTrackingFailureKind _failureKind(String code) {
  return switch (code.trim().toLowerCase()) {
    'invalid-argument' => GuestTrackingFailureKind.invalid,
    'resource-exhausted' => GuestTrackingFailureKind.rateLimited,
    _ => GuestTrackingFailureKind.unavailable,
  };
}

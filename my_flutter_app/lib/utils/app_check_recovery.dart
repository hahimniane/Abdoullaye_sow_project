import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:flutter/foundation.dart';

/// Whether [error] is the server turning a call away because the app could
/// not prove itself (App Check) or the sign-in token was not accepted.
///
/// The server answers both with `unauthenticated`. On a phone the first is far
/// more common: the device-verification token (Play Integrity on Android,
/// App Attest on iPhone) was missing or stale for that one request, which a
/// fresh token fixes on the next try.
bool isUnauthenticatedRefusal(Object error) =>
    error is FirebaseFunctionsException && error.code == 'unauthenticated';

/// Runs [call]; when the server answers `unauthenticated`, asks for a fresh
/// App Check token and runs it once more. Any other error, and a second
/// `unauthenticated`, goes to the caller untouched.
///
/// [refreshToken] is replaceable so a test can stand in for Firebase.
Future<T> callWithAppCheckRecovery<T>(
  Future<T> Function() call, {
  Future<void> Function()? refreshToken,
}) async {
  try {
    return await call();
  } on FirebaseFunctionsException catch (error) {
    if (!isUnauthenticatedRefusal(error)) rethrow;
    try {
      await (refreshToken ?? _forceFreshAppCheckToken)();
    } catch (refreshError) {
      // The retry is still worth making: the token may have refreshed itself.
      debugPrint('App Check token refresh failed: $refreshError');
    }
    return await call();
  }
}

Future<void> _forceFreshAppCheckToken() async {
  await FirebaseAppCheck.instance.getToken(true);
}

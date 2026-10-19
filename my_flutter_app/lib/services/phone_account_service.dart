import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import 'phone_accounts.dart';
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// Every phone-account call (docs/PHONE_ACCOUNTS.md), through the one
/// `phoneAccount` callable with `{action: ...}`. Calls go through the caller
/// the container and Zelle sheets use (a stale device token is retried once
/// with a fresh one), so a widget test hands in its own caller instead of
/// Firebase. Refusals arrive as [PhoneAccountFailure] carrying
/// `details.reason`; the screens put them in their own words.
class PhoneAccountService {
  const PhoneAccountService({this.caller = callContainerCallable});

  final ContainerCallableCaller caller;

  Future<Object?> _call(Map<String, Object?> payload) async {
    try {
      return await caller(phoneAccountCallable, payload);
    } on FirebaseFunctionsException catch (error) {
      throw PhoneAccountFailure(
        parsePhoneAccountRefusal(error.code, error.details),
      );
    } on PhoneAccountFailure {
      rethrow;
    } on TimeoutException {
      throw const PhoneAccountFailure(PhoneAccountRefusal(code: 'unavailable'));
    } catch (error) {
      // A socket that never connected is the commonest case.
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw PhoneAccountFailure(
        PhoneAccountRefusal(code: offline ? 'unavailable' : 'unknown'),
      );
    }
  }

  /// Sends a code on WhatsApp. Throws `whatsapp_unavailable` when WhatsApp
  /// cannot carry it: the screen then offers (or starts) the text message.
  Future<PhoneLoginChallenge> requestCode(PhoneCodeRequest request) async {
    final challenge = PhoneLoginChallenge.fromCallable(
      await _call(request.toPayload()),
    );
    if (challenge == null) {
      throw const PhoneAccountFailure(PhoneAccountRefusal(code: 'unknown'));
    }
    return challenge;
  }

  Future<PhoneCodeVerified> verifyCode({
    required String challengeId,
    required String code,
  }) async => PhoneCodeVerified.fromCallable(
    await _call(verifyCodePayload(challengeId, code)),
  );

  /// After a Firebase SMS sign-in ({}), or - with the placeholder account's
  /// phone ID token - the merge of an email account's verification (§7).
  Future<PhoneSignInCompleted> completeSignIn({
    String placeholderIdToken = '',
  }) async => PhoneSignInCompleted.fromCallable(
    await _call(completeSignInPayload(placeholderIdToken: placeholderIdToken)),
  );

  Future<MyShipmentsPage> myShipments({MyShipmentsCursor? cursor}) async =>
      MyShipmentsPage.fromCallable(
        await _call(myShipmentsPayload(cursor: cursor)),
      );

  Future<void> reportNotMine({
    required String key,
    required String role,
  }) async {
    await _call(reportNotMinePayload(key: key, role: role));
  }
}

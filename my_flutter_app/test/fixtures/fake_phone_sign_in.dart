import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/screens/phone_sign_in_screen.dart';
import 'package:my_flutter_app/services/phone_accounts.dart';

/// A [PhoneSignInClient] for widget tests (it stands in for AuthProvider):
/// records every call and answers as told.
class FakePhoneSignIn implements PhoneSignInClient {
  final requests = <PhoneCodeRequest>[];
  final verified = <String>[];

  /// Thrown by the next requestCode (then cleared).
  Object? requestError;

  /// When set, requestCode waits for it.
  Completer<void>? requestGate;
  PhoneLoginChallenge challenge = const PhoneLoginChallenge(
    challengeId: 'c1',
    lastTwo: '00',
  );

  Object? verifyError;
  PhoneCodeVerified verifyAnswer = const PhoneCodeVerified(
    customToken: 'token',
    uid: 'u1',
  );

  int smsStarts = 0;
  String? smsPhone;
  ValueChanged<PhoneVerificationSession>? smsCodeSent;
  final smsCodes = <String>[];

  @override
  Future<PhoneLoginChallenge> requestCode(PhoneCodeRequest request) async {
    requests.add(request);
    final gate = requestGate;
    if (gate != null) await gate.future;
    final error = requestError;
    if (error != null) {
      requestError = null;
      throw error;
    }
    return challenge;
  }

  @override
  Future<PhoneCodeVerified> verifyCode({
    required PhoneCodeRequest request,
    required String challengeId,
    required String code,
  }) async {
    verified.add('$challengeId:$code');
    final error = verifyError;
    if (error != null) throw error;
    return verifyAnswer;
  }

  @override
  Future<void> startSmsSignIn({
    required String phoneNumber,
    required String languageCode,
    required ValueChanged<PhoneVerificationSession> onCodeSent,
    required Future<void> Function() onSignedIn,
    required ValueChanged<Object> onFailed,
    required bool Function() shouldCompleteAutomaticSignIn,
    int? resendToken,
  }) async {
    smsStarts += 1;
    smsPhone = phoneNumber;
    smsCodeSent = onCodeSent;
  }

  @override
  Future<void> completeSmsSignIn({
    required String verificationId,
    required String smsCode,
  }) async {
    smsCodes.add('$verificationId:$smsCode');
  }
}

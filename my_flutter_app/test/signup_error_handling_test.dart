import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';

void main() {
  test('classifies duplicate phone callable failure', () {
    expect(
      classifySignUpFunctionsFailure(
        code: 'already-exists',
        message: 'An account already uses this phone number',
      ),
      SignUpFailureKind.phoneAlreadyInUse,
    );
  });

  test('classifies duplicate email without confusing it for a phone', () {
    expect(
      classifySignUpFunctionsFailure(
        code: 'already-exists',
        message: 'An account already uses this email address',
      ),
      SignUpFailureKind.emailAlreadyInUse,
    );
  });

  test('classifies transient and unknown callable failures safely', () {
    expect(
      classifySignUpFunctionsFailure(code: 'unavailable'),
      SignUpFailureKind.serviceUnavailable,
    );
    expect(
      classifySignUpFunctionsFailure(code: 'something-new'),
      SignUpFailureKind.unknown,
    );
  });

  test(
    'signup handles callable failures without exposing exception details',
    () {
      final providerSource = File(
        'lib/providers/auth_provider.dart',
      ).readAsStringSync();
      final screenSource = File(
        'lib/screens/signup_screen.dart',
      ).readAsStringSync();

      final signUpStart = providerSource.indexOf('Future<bool> signUp({');
      final resetPasswordStart = providerSource.indexOf(
        'Future<void> resetPassword',
        signUpStart,
      );
      expect(signUpStart, greaterThanOrEqualTo(0));
      expect(resetPasswordStart, greaterThan(signUpStart));

      final signUpSource = providerSource.substring(
        signUpStart,
        resetPasswordStart,
      );
      expect(
        signUpSource,
        contains('on FirebaseFunctionsException catch'),
        reason: 'Callable signup failures need an explicit, typed error path.',
      );
      expect(
        screenSource,
        isNot(contains('showErrorSnackBar(context, error.toString())')),
        reason:
            'The UI must not render Firebase exception text or stack traces.',
      );
    },
  );

  test('duplicate-phone signup copy is localized in English and French', () {
    final english = File('lib/l10n/app_en.arb').readAsStringSync();
    final french = File('lib/l10n/app_fr.arb').readAsStringSync();

    for (final arb in [english, french]) {
      expect(
        arb,
        contains('"phoneVerificationPhoneInUse"'),
        reason: 'Signup should reuse the localized duplicate-phone message.',
      );
      expect(arb, contains('"signUpFailedTryAgain"'));
    }
  });
}

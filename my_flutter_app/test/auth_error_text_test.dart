import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/utils/auth_error_text.dart';

void main() {
  final en = lookupAppLocalizations(const Locale('en'));
  final fr = lookupAppLocalizations(const Locale('fr'));

  group('authErrorCodeFor', () {
    test('current Firebase wrong-password codes read as bad credentials', () {
      // The regression: invalid-credential (what Firebase returns today) fell
      // through to "Authentication failed: <Firebase's English message>".
      for (final code in const [
        'invalid-credential',
        'invalid-login-credentials',
        'wrong-password',
        'user-not-found',
      ]) {
        expect(
          authErrorCodeFor(code),
          AuthErrorCode.invalidCredentials,
          reason: code,
        );
      }
    });

    test('the other sign-in failures each have their own code', () {
      expect(authErrorCodeFor('user-disabled'), AuthErrorCode.userDisabled);
      expect(
        authErrorCodeFor('too-many-requests'),
        AuthErrorCode.tooManyRequests,
      );
      expect(authErrorCodeFor('network-request-failed'), AuthErrorCode.network);
      expect(authErrorCodeFor('invalid-email'), AuthErrorCode.invalidEmail);
      expect(authErrorCodeFor('something-new'), AuthErrorCode.unknown);
    });

    test('sign-up auth failures map to the kinds the screen localizes', () {
      expect(
        classifySignUpAuthFailure('email-already-in-use'),
        SignUpFailureKind.emailAlreadyInUse,
      );
      expect(
        classifySignUpAuthFailure('network-request-failed'),
        SignUpFailureKind.serviceUnavailable,
      );
      expect(classifySignUpAuthFailure('mystery'), SignUpFailureKind.unknown);
    });
  });

  group('authFailureMessage', () {
    test('every code has copy in both languages, and they differ', () {
      for (final code in AuthErrorCode.values) {
        final english = authErrorText(en, code);
        final french = authErrorText(fr, code);
        expect(english, isNotEmpty, reason: code.name);
        expect(french, isNotEmpty, reason: code.name);
        expect(french, isNot(english), reason: code.name);
      }
    });

    test('French mode shows French, never the thrown text', () {
      final message = authFailureMessage(
        fr,
        const AuthFailure(AuthErrorCode.tooManyRequests),
      );
      expect(message, fr.authErrorTooManyRequests);
      expect(message, isNot(contains('AuthFailure')));
    });

    test('anything unexpected reads as the generic message', () {
      expect(
        authFailureMessage(fr, Exception('[firebase_auth/x] English text')),
        fr.authErrorUnknown,
      );
      expect(
        authFailureMessage(fr, 'An unexpected error occurred: boom'),
        fr.authErrorUnknown,
      );
    });
  });

  test('the provider throws codes, not Firebase English', () {
    final provider = File(
      'lib/providers/auth_provider.dart',
    ).readAsStringSync();
    final login = File('lib/screens/login_screen.dart').readAsStringSync();
    final forgot = File(
      'lib/screens/forgot_password_screen.dart',
    ).readAsStringSync();
    expect(provider, isNot(contains(r"failed: ${e.message}")));
    expect(provider, isNot(contains("An unexpected error occurred")));
    expect(provider, isNot(contains("throw '")));
    expect(login, contains('authFailureMessage('));
    expect(login, isNot(contains('error.toString()')));
    expect(forgot, contains('authFailureMessage('));
    expect(forgot, isNot(contains('error.toString()')));
  });
}

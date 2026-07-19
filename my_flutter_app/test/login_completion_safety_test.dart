import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('authentication does not wait for push notification registration', () {
    final source = File('lib/providers/auth_provider.dart').readAsStringSync();

    expect(
      RegExp(
        r'(?<!un)await _registerPushNotificationsIfPossible\(\);',
      ).allMatches(source),
      isEmpty,
      reason:
          'Login and sign-up must complete even if push permissions or token '
          'registration stall.',
    );
    expect(
      RegExp(
        r'unawaited\(_registerPushNotificationsIfPossible\(\)\);',
      ).allMatches(source).length,
      greaterThanOrEqualTo(2),
    );
  });
}

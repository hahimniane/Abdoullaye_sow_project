import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/app_check_recovery.dart';

FirebaseFunctionsException _refusal(String code) =>
    FirebaseFunctionsException(message: 'refused', code: code);

/// Regression: on Android a call was turned away once with "AppCheck token was
/// rejected" and the app told the person "You are not allowed to do that for
/// this shop." A fresh token and one more try would have worked.
void main() {
  group('callWithAppCheckRecovery', () {
    test('a good call runs once and never refreshes the token', () async {
      var calls = 0;
      var refreshes = 0;
      final result = await callWithAppCheckRecovery(() async {
        calls++;
        return 'ok';
      }, refreshToken: () async => refreshes++);
      expect(result, 'ok');
      expect(calls, 1);
      expect(refreshes, 0);
    });

    test('unauthenticated once: refreshes the token and tries again', () async {
      var calls = 0;
      var refreshes = 0;
      final result = await callWithAppCheckRecovery(() async {
        calls++;
        if (calls == 1) throw _refusal('unauthenticated');
        return 'sold';
      }, refreshToken: () async => refreshes++);
      expect(result, 'sold');
      expect(calls, 2);
      expect(refreshes, 1);
    });

    test(
      'unauthenticated twice: the second refusal reaches the caller',
      () async {
        var calls = 0;
        await expectLater(
          callWithAppCheckRecovery(() async {
            calls++;
            throw _refusal('unauthenticated');
          }, refreshToken: () async {}),
          throwsA(
            isA<FirebaseFunctionsException>().having(
              (e) => e.code,
              'code',
              'unauthenticated',
            ),
          ),
        );
        expect(calls, 2, reason: 'one retry, never a loop');
      },
    );

    test('other refusals are not retried', () async {
      for (final code in [
        'permission-denied',
        'invalid-argument',
        'unavailable',
      ]) {
        var calls = 0;
        var refreshes = 0;
        await expectLater(
          callWithAppCheckRecovery(() async {
            calls++;
            throw _refusal(code);
          }, refreshToken: () async => refreshes++),
          throwsA(isA<FirebaseFunctionsException>()),
        );
        expect(calls, 1, reason: code);
        expect(refreshes, 0, reason: code);
      }
    });

    test('a failing token refresh still allows the retry', () async {
      var calls = 0;
      final result = await callWithAppCheckRecovery(() async {
        calls++;
        if (calls == 1) throw _refusal('unauthenticated');
        return 'ok';
      }, refreshToken: () async => throw StateError('no token'));
      expect(result, 'ok');
      expect(calls, 2);
    });

    test(
      'errors that are not Firebase refusals pass straight through',
      () async {
        await expectLater(
          callWithAppCheckRecovery(() async => throw StateError('boom')),
          throwsA(isA<StateError>()),
        );
      },
    );
  });

  group('the app uses it where it matters', () {
    test('the shared callable caller (inventory, containers) recovers', () {
      final source = File(
        'lib/services/waiting_package_service.dart',
      ).readAsStringSync();
      expect(source, contains('callWithAppCheckRecovery('));
    });

    test('activating an invitation recovers, so a first login is not lost', () {
      final source = File(
        'lib/providers/auth_provider.dart',
      ).readAsStringSync();
      final start = source.indexOf("httpsCallable('acceptAccessInvitation')");
      expect(start, greaterThan(0));
      expect(
        source.substring(start - 220, start),
        contains('callWithAppCheckRecovery('),
      );
    });
  });
}

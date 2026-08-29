import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  group('the app starts even when a service cannot', () {
    final source = File('lib/main.dart').readAsStringSync();
    final body = source.substring(
      source.indexOf('void main('),
      source.indexOf('Future<void> _startupStep('),
    );

    test('nothing optional is awaited without a bound', () {
      // Five unbounded awaits stood between launch and the first frame, so a
      // device that could not attest with App Check, or could not get an APNs
      // token, showed the logo for as long as the app was open.
      for (final call in const [
        'initializeFirebaseCrashlytics',
        'initializeFirebaseAppCheck',
        'StripeConfigService.ensureConfigured',
        'PushNotificationService.instance.initialize',
      ]) {
        expect(
          body.contains('await $call()'),
          isFalse,
          reason: '$call is awaited directly and can hold the splash screen',
        );
      }
    });

    test('every optional step goes through the bounded runner', () {
      expect(body, contains("_startupStep('Crashlytics'"));
      expect(body, contains("_startupStep('App Check'"));
      expect(body, contains("_startupStep('Stripe'"));
      expect(body, contains("_startupStep('push notifications'"));
    });

    test('the two that are not needed for the first frame do not block it', () {
      expect(body, contains('unawaited(_startupStep(\'Stripe\''));
      expect(body, contains('unawaited(\n    _startupStep(\'push notifications\''));
    });

    test('the runner bounds the wait and swallows the failure', () {
      final runner = source.substring(source.indexOf('Future<void> _startupStep('));
      expect(runner, contains('.timeout('));
      expect(runner, contains('on TimeoutException'));
      expect(runner, contains('catch (error)'));
    });

    test('runApp is reached regardless', () {
      expect(body, contains('runApp(const MyApp())'));
    });
  });
}

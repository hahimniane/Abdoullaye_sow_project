import 'package:flutter/foundation.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

class StripeConfigService {
  StripeConfigService._();

  static const _configuredPublishableKey = String.fromEnvironment(
    'STRIPE_PUBLISHABLE_KEY',
  );

  // Stripe publishable keys are safe to ship in clients. This fallback keeps
  // local/manual test builds from failing when launched without --dart-define.
  static const _fallbackTestPublishableKey =
      'pk_test_51TnSUdEO69oPXmLjjyBFRL4fuM9i9QZ9NDEJFOT8TIxHgu6P8TO9pMrb10B9YMt9rpWvMzJeeD5skSIs2KT0UNao00xw71iOe4';

  static bool _applied = false;

  static Future<void> ensureConfigured() async {
    if (kIsWeb) {
      _applied = true;
      return;
    }
    // A release build must be told its key. The fallback below is a test key,
    // and silently shipping it in a release is the worst possible outcome:
    // the app looks fine and every payment fails against live PaymentIntents,
    // because the client and the backend are in different Stripe modes.
    // Failing the build's first run instead makes a forgotten --dart-define
    // impossible to miss.
    if (kReleaseMode && _configuredPublishableKey.isEmpty) {
      throw StateError(
        'Release build has no STRIPE_PUBLISHABLE_KEY. Rebuild with '
        '--dart-define=STRIPE_PUBLISHABLE_KEY=pk_live_... (or pk_test_... for '
        'a test-mode release).',
      );
    }
    final key = _configuredPublishableKey.isNotEmpty
        ? _configuredPublishableKey
        : _fallbackTestPublishableKey;
    if (!key.startsWith('pk_test_') && !key.startsWith('pk_live_')) {
      throw StateError('Stripe publishable key is not configured correctly.');
    }
    if (_applied && Stripe.publishableKey == key) return;

    Stripe.publishableKey = key;
    await Stripe.instance.applySettings();
    _applied = true;
  }
}

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'account role loading is bounded and retryable without role downgrade',
    () {
      final providerSource = File(
        'lib/providers/auth_provider.dart',
      ).readAsStringSync();
      final splashSource = File(
        'lib/screens/splash_screen.dart',
      ).readAsStringSync();

      expect(providerSource, contains('.timeout(const Duration(seconds: 15))'));
      expect(
        providerSource,
        contains('AuthInitializationIssue.profileUnavailable'),
      );
      expect(providerSource, contains('Future<void> retryInitialization()'));
      expect(
        splashSource,
        contains('authProvider.initializationIssue != null'),
      );
      expect(splashSource, contains('authProvider.retryInitialization'));
      expect(splashSource, contains('l10n.accountProfileUnavailable'));
    },
  );

  test('splash reliability messages are localized and responsive', () {
    final splashSource = File(
      'lib/screens/splash_screen.dart',
    ).readAsStringSync();
    final english = File('lib/l10n/app_en.arb').readAsStringSync();
    final french = File('lib/l10n/app_fr.arb').readAsStringSync();

    expect(splashSource, contains('.clamp('));
    for (final key in [
      'accountProfileUnavailable',
      'accountProfileMissing',
      'accountProfileRetryHelp',
      'splashMarketplace',
      'splashOpening',
    ]) {
      expect(english, contains('"$key"'));
      expect(french, contains('"$key"'));
    }
  });
}

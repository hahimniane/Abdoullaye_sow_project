import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('initialLanguageCode', () {
    test('a French phone opens in French on first launch', () {
      expect(
        initialLanguageCode(deviceLocales: const [Locale('fr', 'SN')]),
        'fr',
      );
    });

    test('an English or unsupported phone opens in English', () {
      expect(
        initialLanguageCode(deviceLocales: const [Locale('en', 'US')]),
        'en',
      );
      expect(initialLanguageCode(deviceLocales: const [Locale('wo')]), 'en');
      expect(initialLanguageCode(deviceLocales: const []), 'en');
    });

    test('the first supported device language wins', () {
      expect(
        initialLanguageCode(
          deviceLocales: const [Locale('wo'), Locale('fr'), Locale('en')],
        ),
        'fr',
      );
    });

    test('a saved choice beats the device', () {
      expect(
        initialLanguageCode(saved: 'en', deviceLocales: const [Locale('fr')]),
        'en',
      );
      // Rubbish in storage is ignored.
      expect(
        initialLanguageCode(saved: 'xx', deviceLocales: const [Locale('fr')]),
        'fr',
      );
    });
  });

  group('LanguageProvider', () {
    test('the chosen language survives a restart', () async {
      // The regression: the provider always started in English, so a French
      // user had to switch again on every launch.
      SharedPreferences.setMockInitialValues({});
      final first = LanguageProvider(deviceLocales: const [Locale('en')]);
      await first.restored;
      first.setLanguage('fr');
      await Future<void>.delayed(Duration.zero);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(languagePreferenceKey), 'fr');

      final relaunched = LanguageProvider(deviceLocales: const [Locale('en')]);
      await relaunched.restored;
      expect(relaunched.isFrench, isTrue);
    });

    test('first launch follows the device', () async {
      SharedPreferences.setMockInitialValues({});
      final provider = LanguageProvider(deviceLocales: const [Locale('fr')]);
      expect(provider.isFrench, isTrue);
      await provider.restored;
      expect(provider.isFrench, isTrue);
    });

    test('a slow read of the old choice never undoes a newer one', () async {
      SharedPreferences.setMockInitialValues({languagePreferenceKey: 'fr'});
      final provider = LanguageProvider(deviceLocales: const [Locale('en')]);
      provider.setLanguage('en');
      await provider.restored;
      expect(provider.isEnglish, isTrue);
    });

    test('no storage at all: the device language stands', () async {
      final provider = LanguageProvider(
        preferences: () async => throw StateError('no plugin'),
        deviceLocales: const [Locale('fr')],
      );
      await provider.restored;
      expect(provider.isFrench, isTrue);
      provider.setLanguage('en');
      expect(provider.isEnglish, isTrue);
    });
  });
}

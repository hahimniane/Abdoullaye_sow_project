import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The languages the app ships in.
const supportedLanguageCodes = <String>['en', 'fr'];

/// Where the chosen language is kept between launches.
const languagePreferenceKey = 'app_language';

/// The language to open in: the one the person chose last time, else the
/// device's language when the app speaks it (a French phone opens in
/// French), else English. Pure, so it is unit-tested.
String initialLanguageCode({
  String? saved,
  required List<Locale> deviceLocales,
}) {
  if (saved != null && supportedLanguageCodes.contains(saved)) return saved;
  for (final locale in deviceLocales) {
    final code = locale.languageCode.toLowerCase();
    if (supportedLanguageCodes.contains(code)) return code;
  }
  return 'en';
}

class LanguageProvider extends ChangeNotifier {
  /// Opens in the device's language straight away, then restores the saved
  /// choice as soon as it has been read. [preferences] and [deviceLocales]
  /// are for tests.
  LanguageProvider({
    Future<SharedPreferences> Function()? preferences,
    List<Locale>? deviceLocales,
  }) : _preferences = preferences ?? SharedPreferences.getInstance,
       _currentLocale = Locale(
         initialLanguageCode(
           deviceLocales: deviceLocales ?? PlatformDispatcher.instance.locales,
         ),
       ) {
    restored = _restore();
  }

  final Future<SharedPreferences> Function() _preferences;
  Locale _currentLocale;

  /// Set once the person picks a language, so a slow read of the old choice
  /// can never undo a newer one.
  bool _chosenThisSession = false;

  /// Completes when the saved choice has been read (or found missing).
  late final Future<void> restored;

  Locale get currentLocale => _currentLocale;

  bool get isEnglish => _currentLocale.languageCode == 'en';
  bool get isFrench => _currentLocale.languageCode == 'fr';

  Future<void> _restore() async {
    try {
      final prefs = await _preferences();
      final saved = prefs.getString(languagePreferenceKey);
      if (_chosenThisSession || saved == null) return;
      final code = initialLanguageCode(
        saved: saved,
        deviceLocales: [_currentLocale],
      );
      if (code == _currentLocale.languageCode) return;
      _currentLocale = Locale(code);
      notifyListeners();
    } catch (error) {
      // No storage (tests, a locked-down device): the device language stands.
      debugPrint('Saved language unavailable: $error');
    }
  }

  void setLanguage(String languageCode) {
    _chosenThisSession = true;
    _currentLocale = Locale(languageCode);
    notifyListeners();
    _persist(languageCode);
  }

  Future<void> _persist(String languageCode) async {
    try {
      final prefs = await _preferences();
      await prefs.setString(languagePreferenceKey, languageCode);
    } catch (error) {
      debugPrint('Could not save the language: $error');
    }
  }

  void toggleLanguage() {
    if (isEnglish) {
      setLanguage('fr');
    } else {
      setLanguage('en');
    }
  }

  String getLanguageName() {
    return isEnglish ? 'English' : 'Français';
  }
}

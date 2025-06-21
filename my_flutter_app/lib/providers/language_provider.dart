import 'package:flutter/material.dart';

class LanguageProvider extends ChangeNotifier {
  Locale _currentLocale = const Locale('en');

  Locale get currentLocale => _currentLocale;

  bool get isEnglish => _currentLocale.languageCode == 'en';
  bool get isFrench => _currentLocale.languageCode == 'fr';

  void setLanguage(String languageCode) {
    _currentLocale = Locale(languageCode);
    notifyListeners();
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

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../providers/language_provider.dart';

/// Keeps the app language on the signed-in person's profile
/// (`users/{uid}.preferredLanguage`), because pushes are written on the
/// server and the server can only read the profile.
///
/// It saves when the person switches language, and on every app start and
/// sign-in when the profile does not already say the language on screen -
/// so someone who chose French before this existed gets French pushes from
/// their next launch. Nothing is written while signed out, nor when the
/// profile already matches. Saves are debounced, never block the UI, and a
/// failure is only logged (the next launch or switch tries again).
class ProfileLanguageSync {
  ProfileLanguageSync({
    required Future<void> Function(String languageCode) save,
    this.debounce = const Duration(milliseconds: 600),
  }) : _save = save;

  final Future<void> Function(String languageCode) _save;

  /// How long the language must stay put before it is saved, so quick
  /// back-and-forth switching sends one write (or none).
  final Duration debounce;

  LanguageProvider? _language;
  Listenable? _account;
  String? Function()? _uid;
  String? Function()? _savedLanguage;

  Timer? _timer;
  bool _ready = false;
  bool _disposed = false;

  /// "uid|code" last sent (or tried) for this session, so a failure is not
  /// retried on every account notification.
  String? _sent;

  /// Starts following [language] and [account] (the auth provider). [uid] is
  /// the account whose profile is loaded (null while signed out or still
  /// loading); [savedLanguage] is what that profile says now.
  void bind({
    required LanguageProvider language,
    required Listenable account,
    required String? Function() uid,
    required String? Function() savedLanguage,
  }) {
    _language = language;
    _account = account;
    _uid = uid;
    _savedLanguage = savedLanguage;
    language.addListener(_onChange);
    account.addListener(_onChange);
    // Wait for the phone's saved choice: before it is read the app shows the
    // device language, which may not be the person's choice.
    language.restored.whenComplete(() {
      if (_disposed) return;
      _ready = true;
      _onChange();
    });
  }

  void _onChange() {
    if (!_ready || _disposed) return;
    final wanted = _wanted();
    if (wanted == null) {
      _cancel();
      return;
    }
    _timer?.cancel();
    _timer = Timer(debounce, _flush);
  }

  /// The language to save now as "uid|code", or null when nothing should be
  /// written.
  String? _wanted() {
    final uid = _uid?.call();
    if (uid == null || uid.isEmpty) {
      // Signed out: the next sign-in checks again from scratch.
      _sent = null;
      return null;
    }
    final code = _language?.currentLocale.languageCode;
    if (code == null || !supportedLanguageCodes.contains(code)) return null;
    final key = '$uid|$code';
    if (_savedLanguage?.call() == code) {
      _sent = key;
      return null;
    }
    if (_sent == key) return null;
    return key;
  }

  Future<void> _flush() async {
    _timer = null;
    if (_disposed) return;
    final key = _wanted();
    if (key == null) return;
    _sent = key;
    final code = key.substring(key.lastIndexOf('|') + 1);
    try {
      await _save(code);
    } catch (error) {
      debugPrint('Could not save the language to the profile: $error');
    }
  }

  void _cancel() {
    _timer?.cancel();
    _timer = null;
  }

  void dispose() {
    _disposed = true;
    _cancel();
    _language?.removeListener(_onChange);
    _account?.removeListener(_onChange);
  }
}

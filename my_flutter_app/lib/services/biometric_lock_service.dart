import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

class BiometricLockService {
  BiometricLockService({
    LocalAuthentication? localAuth,
    Future<SharedPreferences> Function()? preferencesFactory,
  }) : _localAuth = localAuth ?? LocalAuthentication(),
       _preferencesFactory =
           preferencesFactory ?? SharedPreferences.getInstance;

  static const _enabledKey = 'biometric_lock_enabled';

  final LocalAuthentication _localAuth;
  final Future<SharedPreferences> Function() _preferencesFactory;

  Future<bool> isEnabled() async {
    final prefs = await _preferencesFactory();
    return prefs.getBool(_enabledKey) ?? false;
  }

  Future<void> setEnabled(bool enabled) async {
    final prefs = await _preferencesFactory();
    await prefs.setBool(_enabledKey, enabled);
  }

  Future<bool> canAuthenticate() async {
    try {
      if (!await _localAuth.canCheckBiometrics) return false;
      return (await _localAuth.getAvailableBiometrics()).isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  Future<bool> authenticate({required String reason}) async {
    try {
      return _localAuth.authenticate(
        localizedReason: reason,
        biometricOnly: true,
        persistAcrossBackgrounding: true,
      );
    } catch (_) {
      return false;
    }
  }
}

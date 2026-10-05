import 'package:flutter/foundation.dart';

/// The one "the app can open things now" signal.
///
/// Things that open a screen can arrive before there is a screen to open it
/// on top of: the notification tap or tracking link that launched the app is
/// delivered while the splash screen is still settling auth. Anything pushed
/// then is lost - the splash replaces the top route with home once it is
/// done, so the pushed page is the one that gets replaced and the customer
/// lands on home.
///
/// So each of those services parks what it was given and asks to be told when
/// the app is ready ([whenReady]); the splash screen says so ([markReady])
/// right after it has replaced itself with the real first screen. Readiness
/// is one-way for the life of the process.
class AppLaunchGate {
  AppLaunchGate._();

  static final AppLaunchGate instance = AppLaunchGate._();

  bool _ready = false;
  final List<VoidCallback> _waiting = [];

  /// Whether the first real screen is up.
  bool get isReady => _ready;

  /// Runs [action] once the app is ready - straight away when it already is.
  void whenReady(VoidCallback action) {
    if (_ready) {
      action();
      return;
    }
    _waiting.add(action);
  }

  /// Called by the splash screen after it has navigated to the first real
  /// screen. Releases everything parked behind [whenReady], in order.
  void markReady() {
    if (_ready) return;
    _ready = true;
    final actions = List<VoidCallback>.of(_waiting);
    _waiting.clear();
    for (final action in actions) {
      try {
        action();
      } catch (error) {
        debugPrint('Launch action failed: $error');
      }
    }
  }

  @visibleForTesting
  void resetForTesting() {
    _ready = false;
    _waiting.clear();
  }
}

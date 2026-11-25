// Loading a Fleet driver's own account (docs/FLEET.md section 11): one call,
// `fleetAction {action: "driver_home"}`, a copy kept on the phone so the
// driver's home opens at once on the next launch, and the controller the
// driver screens listen to. Behind interfaces, so the screens are tested with
// fakes.

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fleet_driver_app.dart';
import 'fleet_requests.dart' show FleetFailure;
import 'fleet_service.dart';

/// `data.type` of a push about a driver's own account (the server's
/// `fleet_driver_push.PUSH_TYPE`).
const fleetDriverPushType = 'fleet_driver';

/// Goes up by one each time such a push reaches the app, so the driver's
/// screens read their account again (a payment was received, a fee is due).
final ValueNotifier<int> fleetDriverNews = ValueNotifier<int>(0);

/// Called with every push's data; only a driver push counts.
void noteFleetDriverPush(Map<String, dynamic> data) {
  if (data['type']?.toString() == fleetDriverPushType) fleetDriverNews.value++;
}

/// Asks the server who the signed-in account is to Fleet.
class FleetDriverService {
  const FleetDriverService({this.fleet = const FleetService()});

  final FleetService fleet;

  /// The raw `driver_home` answer. Throws [FleetFailure] when it cannot be
  /// read (offline, signed out).
  Future<Map<String, dynamic>> home() =>
      fleet.call(const {'action': 'driver_home'});
}

/// The last answer, kept per account on the phone.
abstract interface class DriverHomeCache {
  Future<String?> read(String uid);

  /// Null [raw] forgets the copy.
  Future<void> write(String uid, String? raw);
}

class PrefsDriverHomeCache implements DriverHomeCache {
  const PrefsDriverHomeCache();

  static String _key(String uid) => 'fleet_driver_home_$uid';

  @override
  Future<String?> read(String uid) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_key(uid));
  }

  @override
  Future<void> write(String uid, String? raw) async {
    final prefs = await SharedPreferences.getInstance();
    if (raw == null) {
      await prefs.remove(_key(uid));
    } else {
      await prefs.setString(_key(uid), raw);
    }
  }
}

/// The driver account the screens show: the kept copy first, then the
/// server's answer. `loading` always clears (the call times out), and a
/// failed refresh keeps what was already on screen.
class FleetDriverController extends ChangeNotifier {
  FleetDriverController({
    this.service = const FleetDriverService(),
    this.cache = const PrefsDriverHomeCache(),
  });

  final FleetDriverService service;
  final DriverHomeCache cache;

  DriverHome _home = DriverHome.none;
  bool _loading = false;
  bool _failed = false;
  bool _answered = false;
  bool _known = false;
  bool _waitedOut = false;
  Timer? _wait;
  String? _uid;
  int _ticket = 0;
  bool _disposed = false;

  DriverHome get home => _home;

  /// A read is running.
  bool get loading => _loading;

  /// The last read failed; [home] is the kept copy (or nothing).
  bool get failed => _failed;

  /// The server has answered for this account at least once this session.
  bool get answered => _answered;

  String? get uid => _uid;

  /// Whether we know yet if this account is a driver: the server answered, a
  /// copy was kept from last time, the read failed, or [settleAfter] passed.
  /// Until then a screen may hold a spinner instead of showing the regular
  /// home for a second and swapping it away. Always becomes true.
  bool get settled =>
      _uid == null || _known || _answered || _failed || _waitedOut;

  /// How long a screen waits for the first answer before going on without.
  static const settleAfter = Duration(seconds: 6);

  /// The signed-in account changed. [uid] is null while signed out;
  /// [eligible] is false for a guest, a session still loading, or a person
  /// with business access (they use the business home).
  Future<void> setAccount(String? uid, {required bool eligible}) async {
    // The same person, only not eligible for a moment (their profile is
    // being read again): keep what we know rather than wiping it and showing
    // the regular home for a blink. The host shows none of it meanwhile.
    if (uid != null && uid == _uid) return;
    final next = eligible ? uid : null;
    if (next == _uid) return;
    final previous = _uid;
    _uid = next;
    final ticket = ++_ticket;
    _home = DriverHome.none;
    _failed = false;
    _answered = false;
    _known = false;
    _waitedOut = false;
    _wait?.cancel();
    _wait = null;
    _loading = false;
    // Signed out: the copy on the phone goes with the session.
    if (uid == null && previous != null) {
      unawaited(_safe(() => cache.write(previous, null)));
    }
    if (next == null) {
      _notify();
      return;
    }
    final kept = DriverHome.decode(
      await _safe<String?>(() => cache.read(next)),
    );
    if (ticket != _ticket) return;
    if (kept != null) {
      _home = kept;
      _known = true;
    } else {
      _wait = Timer(settleAfter, () {
        if (ticket != _ticket) return;
        _waitedOut = true;
        _notify();
      });
    }
    _notify();
    await refresh();
  }

  /// Asks the server again. Never throws.
  Future<void> refresh() async {
    final uid = _uid;
    if (uid == null || _loading) return;
    final ticket = _ticket;
    _loading = true;
    _notify();
    try {
      final answer = await service.home();
      if (ticket != _ticket) return;
      _home = DriverHome.fromMap(answer);
      _failed = false;
      _answered = true;
      unawaited(
        _safe(
          () => cache.write(
            uid,
            // "Not a driver" is kept too, so a regular customer's home
            // opens at once next time.
            DriverHome.encode(_home.isDriver ? answer : const {}),
          ),
        ),
      );
    } on FleetFailure {
      if (ticket == _ticket) _failed = true;
    } catch (_) {
      if (ticket == _ticket) _failed = true;
    } finally {
      if (ticket == _ticket) {
        // Answered or failed: nothing is being waited for any more.
        _wait?.cancel();
        _wait = null;
        _loading = false;
        _notify();
      }
    }
  }

  /// The phone's storage must never break the screen (or a widget test).
  Future<T?> _safe<T>(Future<T> Function() run) async {
    try {
      return await run().timeout(const Duration(seconds: 3));
    } catch (_) {
      return null;
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _ticket++;
    _wait?.cancel();
    super.dispose();
  }
}

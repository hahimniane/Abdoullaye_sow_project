import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/app_version_config.dart';

enum AppGateStatus { checking, offline, ready, updateAvailable, forceUpdate }

typedef ConnectivityChecker = Future<List<ConnectivityResult>> Function();
typedef AppConfigLoader = Future<Map<String, dynamic>> Function();

class AppGateProvider extends ChangeNotifier {
  AppGateProvider({
    Connectivity? connectivity,
    FirebaseFirestore? firestore,
    Future<PackageInfo> Function()? packageInfoLoader,
    Future<bool> Function(Uri url)? urlLauncher,
    ConnectivityChecker? connectivityChecker,
    AppConfigLoader? appConfigLoader,
    Stream<List<ConnectivityResult>>? connectivityChanges,
  }) : _connectivity = connectivity ?? Connectivity(),
       _firestore =
           firestore ??
           (appConfigLoader == null ? FirebaseFirestore.instance : null),
       _packageInfoLoader = packageInfoLoader ?? PackageInfo.fromPlatform,
       _urlLauncher =
           urlLauncher ??
           ((url) => launchUrl(url, mode: LaunchMode.externalApplication)) {
    _connectivityChecker =
        connectivityChecker ?? _connectivity!.checkConnectivity;
    _appConfigLoader = appConfigLoader ?? _loadAppConfigFromFirestore;
    _connectivitySubscription =
        (connectivityChanges ?? _connectivity!.onConnectivityChanged).listen(
          _handleConnectivityChanged,
        );
    refresh();
  }

  AppGateProvider.test({
    required AppGateStatus status,
    AppVersionDecision? decision,
    Future<bool> Function(Uri url)? urlLauncher,
  }) : _connectivity = null,
       _firestore = null,
       _packageInfoLoader = (() async => PackageInfo(
         appName: 'Test',
         packageName: 'test',
         version: '1.0.0',
         buildNumber: '1',
       )),
       _urlLauncher = urlLauncher ?? ((url) async => true),
       _status = status,
       _decision = decision {
    _connectivityChecker = () async => const [ConnectivityResult.none];
    _appConfigLoader = () async => const <String, dynamic>{};
  }

  AppGateProvider.localEmulator()
    : _connectivity = null,
      _firestore = null,
      _packageInfoLoader = (() async => PackageInfo(
        appName: 'Laawol Digital',
        packageName: 'local-emulator',
        version: '0.0.0',
        buildNumber: '0',
      )),
      _urlLauncher = ((url) async => false),
      _status = AppGateStatus.ready,
      _hasCompletedInitialCheck = true,
      _lastOnline = true {
    _connectivityChecker = () async => const [ConnectivityResult.other];
    _appConfigLoader = () async => const <String, dynamic>{};
  }

  final Connectivity? _connectivity;
  final FirebaseFirestore? _firestore;
  final Future<PackageInfo> Function() _packageInfoLoader;
  final Future<bool> Function(Uri url) _urlLauncher;
  late final ConnectivityChecker _connectivityChecker;
  late final AppConfigLoader _appConfigLoader;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  bool _warningDismissed = false;
  int _refreshToken = 0;
  // Once the first check resolves we stop flashing the blocking "checking"
  // overlay for subsequent re-checks (connectivity changes, retries).
  bool _hasCompletedInitialCheck = false;
  // Last known online state, used to ignore duplicate connectivity events that
  // iOS emits frequently and which previously caused the app to re-check (and
  // flicker the gate screen) on every event.
  bool? _lastOnline;

  AppGateStatus _status = AppGateStatus.checking;
  AppVersionDecision? _decision;
  Object? _lastError;
  // Remote feature flags piggyback on the same appConfig/client document this
  // provider already fetches at startup for version gating, so toggling a
  // feature (e.g. pausing shared barrels) from the admin console takes effect
  // without shipping a new app release.
  bool _sharedBarrelsEnabled = false;

  AppGateStatus get status => _status;
  AppVersionDecision? get decision => _decision;
  Object? get lastError => _lastError;
  bool get sharedBarrelsEnabled => _sharedBarrelsEnabled;
  bool get isBlocking =>
      _status == AppGateStatus.checking ||
      _status == AppGateStatus.offline ||
      _status == AppGateStatus.forceUpdate;

  Future<void> refresh() async {
    final connectivity = _connectivity;
    if (connectivity == null) return;
    final token = ++_refreshToken;
    // Only block the UI with the full-screen "checking" overlay on the very
    // first check. Later re-checks run silently so the gate screen does not
    // flash over the app on every connectivity event.
    if (!_hasCompletedInitialCheck) {
      _setStatus(AppGateStatus.checking);
    }

    List<ConnectivityResult> results;
    try {
      results = await _connectivityChecker().timeout(
        const Duration(seconds: 4),
      );
    } catch (error) {
      if (token == _refreshToken) _setOffline(error);
      return;
    }

    if (!_hasConnection(results)) {
      if (token == _refreshToken) _setOffline();
      return;
    }

    try {
      final packageInfo = await _packageInfoLoader();
      final currentBuild = int.tryParse(packageInfo.buildNumber) ?? 0;
      final configData = await _appConfigLoader().timeout(
        const Duration(seconds: 8),
      );
      _sharedBarrelsEnabled = configData['sharedBarrelsEnabled'] == true;
      final config = AppVersionConfig.fromMap(configData);
      final decision = config.evaluate(
        platformKey: platformKey(),
        currentBuild: currentBuild,
      );

      if (token != _refreshToken) return;
      _hasCompletedInitialCheck = true;
      _lastOnline = true;
      _decision = decision;
      _lastError = null;
      switch (decision.requirement) {
        case AppUpdateRequirement.forceUpdate:
          _setStatus(AppGateStatus.forceUpdate);
        case AppUpdateRequirement.updateAvailable:
          _setStatus(
            _warningDismissed
                ? AppGateStatus.ready
                : AppGateStatus.updateAvailable,
          );
        case AppUpdateRequirement.current:
          _setStatus(AppGateStatus.ready);
      }
    } catch (error) {
      if (token != _refreshToken) return;
      _hasCompletedInitialCheck = true;
      _lastOnline = true;
      _lastError = error;
      _setStatus(AppGateStatus.ready);
    }
  }

  void continuePastUpdateWarning() {
    _warningDismissed = true;
    if (_status == AppGateStatus.updateAvailable) {
      _setStatus(AppGateStatus.ready);
    }
  }

  Future<bool> openUpdateUrl() async {
    final rawUrl = _decision?.updateUrl;
    final uri = rawUrl == null ? null : Uri.tryParse(rawUrl);
    if (uri == null || !uri.hasScheme) return false;
    return _urlLauncher(uri);
  }

  static String platformKey() {
    if (kIsWeb) return 'web';
    return switch (defaultTargetPlatform) {
      TargetPlatform.android => 'android',
      TargetPlatform.iOS => 'ios',
      TargetPlatform.macOS => 'macos',
      TargetPlatform.windows => 'windows',
      TargetPlatform.linux => 'linux',
      TargetPlatform.fuchsia => 'android',
    };
  }

  void _handleConnectivityChanged(List<ConnectivityResult> results) {
    final online = _hasConnection(results);
    // Ignore duplicate events that don't actually change the online/offline
    // state — iOS emits these often and they would otherwise re-check on a loop.
    if (_lastOnline == online) return;
    _lastOnline = online;
    if (online) {
      refresh();
    } else {
      _setOffline();
    }
  }

  bool _hasConnection(List<ConnectivityResult> results) {
    return results.any((result) => result != ConnectivityResult.none);
  }

  Future<Map<String, dynamic>> _loadAppConfigFromFirestore() async {
    final configSnapshot = await _firestore!
        .collection('appConfig')
        .doc('client')
        .get(const GetOptions(source: Source.server));
    return configSnapshot.data() ?? const <String, dynamic>{};
  }

  void _setOffline([Object? error]) {
    _hasCompletedInitialCheck = true;
    _lastOnline = false;
    _lastError = error;
    _setStatus(AppGateStatus.offline);
  }

  void _setStatus(AppGateStatus status) {
    if (_status == status) return;
    _status = status;
    notifyListeners();
  }

  @override
  void dispose() {
    _connectivitySubscription?.cancel();
    super.dispose();
  }
}

import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../navigation/app_launch_gate.dart';
import '../navigation/app_navigator.dart';
import '../providers/auth_provider.dart';
import '../screens/package_result_screen.dart';
import '../utils/business_permissions.dart';
import '../widgets/guest_tracking_lookup.dart';
import 'container_packages.dart';
import 'package_codes.dart';

/// Tracking links that open the app: `https://customer.laawoldigital.com/t/
/// CL-XXXXXX`, from a scanned package label or a WhatsApp update.
///
/// The link can arrive before anything is ready - it can be what launched
/// the app - so it is parked until the splash screen has settled auth and
/// replaced itself with the real first screen ([markAppReady]); a link that
/// arrives later opens at once. Business staff with the containers
/// permission whose business holds the line get the package view; everyone
/// else gets the public tracking lookup with the code filled in. The
/// decision itself is the pure [packageLinkDestination].
class PackageLinkService {
  PackageLinkService._();

  static final PackageLinkService instance = PackageLinkService._();

  StreamSubscription<Uri>? _sub;
  String? _pendingCode;
  bool _appReady = false;
  bool _routing = false;

  /// Starts listening. Called once from `main`, before `runApp`, so the link
  /// that cold-started the app is not missed. [links] is for tests.
  void start({Stream<Uri>? links}) {
    if (_sub != null) return;
    // The same readiness signal the notification taps wait on.
    AppLaunchGate.instance.whenReady(markAppReady);
    try {
      _sub = (links ?? AppLinks().uriLinkStream).listen(
        handleLink,
        onError: (Object error) => debugPrint('App link error: $error'),
      );
    } catch (error) {
      // No plugin on this platform: links simply open the website.
      debugPrint('App links unavailable: $error');
    }
  }

  /// Takes one incoming link. Anything that is not a package tracking link
  /// is ignored.
  void handleLink(Uri uri) {
    final code = packageCodeFromLink(uri);
    if (code == null) return;
    if (!_appReady || rootNavigatorKey.currentState == null) {
      _pendingCode = code;
      return;
    }
    unawaited(_route(code));
  }

  /// Runs when [AppLaunchGate] opens - the splash screen has navigated to the
  /// first real screen: auth has settled, and a page pushed now lands on top
  /// of home.
  void markAppReady() {
    _appReady = true;
    final code = _pendingCode;
    _pendingCode = null;
    if (code != null) unawaited(_route(code));
  }

  @visibleForTesting
  String? get pendingCode => _pendingCode;

  @visibleForTesting
  void resetForTesting() {
    _sub?.cancel();
    _sub = null;
    _pendingCode = null;
    _appReady = false;
    _routing = false;
  }

  Future<void> _route(String code) async {
    if (_routing) {
      // One page at a time; the newest link waits its turn.
      _pendingCode = code;
      return;
    }
    final navigator = rootNavigatorKey.currentState;
    final context = rootNavigatorKey.currentContext;
    if (navigator == null || context == null) {
      _pendingCode = code;
      return;
    }
    _routing = true;
    try {
      final auth = context.read<AuthProvider>();
      await _settled(auth);
      final businessId = auth.businessId ?? '';
      final eligible = packageLinkStaffEligible(
        signedIn: auth.isAuthenticated,
        isAnonymous: auth.user?.isAnonymous ?? false,
        hasBusinessDashboardAccess: auth.hasBusinessDashboardAccess,
        hasContainersPermission:
            auth.hasBusinessPermission(BusinessPermission.containers),
        businessId: businessId,
      );
      var inBusiness = false;
      if (eligible) {
        try {
          inBusiness = await FirestoreContainerPackageRepository()
                  .findLineByCode(businessId, code)
                  .timeout(const Duration(seconds: 10)) !=
              null;
        } catch (_) {
          // Offline or refused: the public page still answers.
          inBusiness = false;
        }
      }
      final destination = packageLinkDestination(
        staffEligible: eligible,
        lineInBusiness: inBusiness,
      );
      final signedInForReal =
          auth.isAuthenticated && !(auth.user?.isAnonymous ?? false);
      navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => destination == PackageLinkDestination.staffPackage
              ? PackageResultScreen(businessId: businessId, code: code)
              : GuestTrackingLookupPage(
                  initialCode: code,
                  onSignIn: signedInForReal
                      ? null
                      : () => navigator.pushNamed('/login'),
                ),
        ),
      );
    } finally {
      _routing = false;
      final next = _pendingCode;
      if (next != null && _appReady) {
        _pendingCode = null;
        unawaited(_route(next));
      }
    }
  }

  /// Waits for the auth provider to finish its first load and any role
  /// check in flight, bounded so a stuck profile read never swallows the
  /// link.
  Future<void> _settled(AuthProvider auth) async {
    if (!auth.isInitializing && !auth.isLoading) return;
    final done = Completer<void>();
    void check() {
      if (!auth.isInitializing && !auth.isLoading && !done.isCompleted) {
        done.complete();
      }
    }

    auth.addListener(check);
    try {
      await done.future.timeout(const Duration(seconds: 15), onTimeout: () {});
    } finally {
      auth.removeListener(check);
    }
  }
}

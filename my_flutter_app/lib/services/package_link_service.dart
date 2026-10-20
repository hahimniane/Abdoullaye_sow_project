import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../navigation/app_launch_gate.dart';
import '../navigation/app_navigator.dart';
import '../providers/auth_provider.dart';
import '../screens/inventory_sell_screen.dart';
import '../screens/package_request_detail_screen.dart';
import '../screens/package_request_form_screen.dart';
import '../screens/package_result_screen.dart';
import '../screens/staff_invite_screen.dart';
import '../utils/business_permissions.dart';
import '../widgets/guest_tracking_lookup.dart';
import 'container_packages.dart';
import 'inventory.dart';
import 'package_codes.dart';
import 'package_requests.dart';
import 'staff_invites.dart';

/// The screen a package-request link opens: the estimate page for `/e/`,
/// the request form (with the business chosen) for `/r/`.
Widget packageRequestLinkPage(PackageRequestLink link) => switch (link) {
  EstimateRequestLink(:final token) => PackageRequestDetailScreen(token: token),
  FormRequestLink(:final slug) => PackageRequestFormScreen(slug: slug),
};

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
///
/// Product tag links (`/i/IT-XXXXXX`) ride the same pipe: shop staff whose
/// business has Inventory on and who hold the inventory permission land on the
/// Sell screen with that tag already in the basket; for anyone else the link
/// does nothing in the app (the website shows its neutral page).
///
/// Staff invitation links (`/j/<token>`, docs/STAFF_PHONE_INVITES.md §6)
/// too: parked the same way, then [StaffInviteScreen] opens over whatever is
/// showing; it handles a signed-out phone itself.
class PackageLinkService {
  PackageLinkService._();

  static final PackageLinkService instance = PackageLinkService._();

  StreamSubscription<Uri>? _sub;
  String? _pendingCode;
  String? _pendingInventoryCode;
  PackageRequestLink? _pendingRequestLink;
  String? _pendingStaffInvite;
  bool _appReady = false;
  bool _routing = false;
  Uri? _lastLink;
  DateTime? _lastLinkAt;
  int _acceptedLinks = 0;

  /// The phone delivers the link that opened the app more than once (iOS and
  /// Android both hand it over at launch and again as the app resumes). Read
  /// twice, a product tag scanned with the camera went into the basket twice.
  /// The same link again within this window is the same scan.
  static const Duration duplicateLinkWindow = Duration(seconds: 3);

  @visibleForTesting
  DateTime Function() clock = DateTime.now;

  /// Links taken (not dropped as a repeat); for tests.
  @visibleForTesting
  int get acceptedLinks => _acceptedLinks;

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
    final now = clock();
    final last = _lastLinkAt;
    if (_lastLink == uri &&
        last != null &&
        now.difference(last) < duplicateLinkWindow) {
      return;
    }
    _lastLink = uri;
    _lastLinkAt = now;
    _acceptedLinks++;
    final invite = staffInviteTokenFromUri(uri);
    if (invite != null) {
      if (!_appReady || rootNavigatorKey.currentState == null) {
        _pendingStaffInvite = invite;
        return;
      }
      _routeStaffInvite(invite);
      return;
    }
    // Package requests (§8.8): the estimate page (`/e/<token>`, the
    // WhatsApp button) and a business's request form (`/r/<slug>`).
    final request = packageRequestLinkFromUri(uri);
    if (request != null) {
      if (!_appReady || rootNavigatorKey.currentState == null) {
        _pendingRequestLink = request;
        return;
      }
      _routeRequestLink(request);
      return;
    }
    final tag = inventoryCodeFromLink(uri);
    if (tag != null) {
      if (!_appReady || rootNavigatorKey.currentState == null) {
        _pendingInventoryCode = tag;
        return;
      }
      unawaited(_routeInventory(tag));
      return;
    }
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
    final invite = _pendingStaffInvite;
    _pendingStaffInvite = null;
    if (invite != null) _routeStaffInvite(invite);
    final request = _pendingRequestLink;
    _pendingRequestLink = null;
    if (request != null) _routeRequestLink(request);
    final code = _pendingCode;
    _pendingCode = null;
    if (code != null) unawaited(_route(code));
    final tag = _pendingInventoryCode;
    _pendingInventoryCode = null;
    if (tag != null) unawaited(_routeInventory(tag));
  }

  /// Opens the screen a request link names, over whatever is showing. The
  /// screens themselves handle a signed-out phone (the estimate page needs
  /// no account; the form asks to sign in).
  void _routeRequestLink(PackageRequestLink link) {
    final navigator = rootNavigatorKey.currentState;
    if (navigator == null) {
      _pendingRequestLink = link;
      return;
    }
    navigator.push(
      MaterialPageRoute<void>(builder: (_) => packageRequestLinkPage(link)),
    );
  }

  void _routeStaffInvite(String token) {
    final navigator = rootNavigatorKey.currentState;
    if (navigator == null) {
      _pendingStaffInvite = token;
      return;
    }
    navigator.push(
      MaterialPageRoute<void>(builder: (_) => StaffInviteScreen(token: token)),
    );
  }

  @visibleForTesting
  PackageRequestLink? get pendingRequestLink => _pendingRequestLink;

  @visibleForTesting
  String? get pendingStaffInvite => _pendingStaffInvite;

  @visibleForTesting
  String? get pendingCode => _pendingCode;

  @visibleForTesting
  String? get pendingInventoryCode => _pendingInventoryCode;

  @visibleForTesting
  void resetForTesting() {
    _sub?.cancel();
    _sub = null;
    _pendingCode = null;
    _pendingInventoryCode = null;
    _pendingRequestLink = null;
    _pendingStaffInvite = null;
    _appReady = false;
    _routing = false;
    _lastLink = null;
    _lastLinkAt = null;
    _acceptedLinks = 0;
    clock = DateTime.now;
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
        // The permission AND a shipping service: a business that does not
        // ship has no containers, so its scans fall through to the public
        // tracking page like any other.
        hasContainersPermission: auth.hasContainersAccess,
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
      final nextTag = _pendingInventoryCode;
      if (next != null && _appReady) {
        _pendingCode = null;
        unawaited(_route(next));
      } else if (nextTag != null && _appReady) {
        _pendingInventoryCode = null;
        unawaited(_routeInventory(nextTag));
      }
    }
  }

  Future<void> _routeInventory(String code) async {
    if (_routing) {
      _pendingInventoryCode = code;
      return;
    }
    final navigator = rootNavigatorKey.currentState;
    final context = rootNavigatorKey.currentContext;
    if (navigator == null || context == null) {
      _pendingInventoryCode = code;
      return;
    }
    _routing = true;
    try {
      final auth = context.read<AuthProvider>();
      await _settled(auth);
      final businessId = auth.businessId ?? '';
      final eligible = auth.isAuthenticated &&
          !(auth.user?.isAnonymous ?? false) &&
          auth.hasBusinessDashboardAccess &&
          inventoryAvailable(
            services: auth.businessServices,
            hasPermission:
                auth.hasBusinessPermission(BusinessPermission.inventory),
            businessId: businessId,
          );
      if (!eligible) return;
      navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => InventorySellScreen(
            businessId: businessId,
            initialCode: code,
            access: auth.inventoryAccess,
          ),
        ),
      );
    } finally {
      _routing = false;
      final next = _pendingCode;
      final nextTag = _pendingInventoryCode;
      if (_appReady) {
        if (next != null) {
          _pendingCode = null;
          unawaited(_route(next));
        } else if (nextTag != null) {
          _pendingInventoryCode = null;
          unawaited(_routeInventory(nextTag));
        }
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

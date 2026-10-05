import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../navigation/app_launch_gate.dart';
import '../navigation/app_navigator.dart';
import 'notification_routing.dart';

/// Must be a top-level (or static) function annotated like this - the FCM
/// plugin runs it in a separate background isolate when a message arrives
/// while the app isn't running in the foreground.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Nothing to do today: the OS already shows the notification.data payload's
  // notification block for background/terminated messages on its own. This
  // handler only needs to exist so FCM has somewhere to dispatch background
  // messages instead of dropping them with a plugin warning.
}

const _androidChannel = AndroidNotificationChannel(
  'laawol_default',
  'Laawol Digital',
  description: 'Shipment, purchase, wallet, and support updates.',
  importance: Importance.high,
);

class PushNotificationService {
  PushNotificationService({
    FirebaseMessaging? messaging,
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
    FlutterLocalNotificationsPlugin? localNotifications,
  }) : _messaging = messaging ?? FirebaseMessaging.instance,
       _firestore = firestore ?? FirebaseFirestore.instance,
       _auth = auth ?? FirebaseAuth.instance,
       _localNotifications =
           localNotifications ?? FlutterLocalNotificationsPlugin();

  /// Shared instance used across the app so listeners are only ever
  /// registered once. Tests can construct their own instance directly with
  /// fakes instead of using this.
  static PushNotificationService instance = PushNotificationService();

  final FirebaseMessaging _messaging;
  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final FlutterLocalNotificationsPlugin _localNotifications;
  bool _initialized = false;

  /// Who the signed-in person is, for routing; null while it is not known
  /// yet (before the first auth event, or while a role lookup is running).
  NotificationAudience? _audience;

  /// Set by AuthProvider: null when a role lookup starts, the audience once
  /// it has finished (customer when signed out or when the lookup failed). A
  /// parked tap opens as soon as both this and the app are ready.
  void setAudience(NotificationAudience? audience) {
    _audience = audience;
    _openPendingTap();
  }

  /// Sets up local-notification display for foreground messages and
  /// tap-to-navigate handling for background/terminated messages. Safe to
  /// call once at app startup regardless of sign-in state - permission and
  /// token registration still happen separately, tied to login, via
  /// [requestPermissionAndRegister].
  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;

    // A tap parked before the first real screen opens when the splash says
    // the app is ready.
    AppLaunchGate.instance.whenReady(_openPendingTap);

    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

    await _localNotifications.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload;
        if (payload == null || payload.isEmpty) return;
        _routeFromPayload(payload);
      },
    );
    final androidPlugin = _localNotifications
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >();
    await androidPlugin?.createNotificationChannel(_androidChannel);

    // iOS shows nothing for a remote notification that arrives while the app
    // is on screen unless we opt in here - it is not a delivery failure, it is
    // the default presentation behaviour. Android has no equivalent switch and
    // still needs the local-notification path below.
    if (defaultTargetPlatform == TargetPlatform.iOS ||
        defaultTargetPlatform == TargetPlatform.macOS) {
      await _messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );
    }

    FirebaseMessaging.onMessage.listen((message) {
      // On Apple platforms the option above already put a banner on screen;
      // showing a local copy as well would deliver the notification twice.
      if (defaultTargetPlatform == TargetPlatform.iOS ||
          defaultTargetPlatform == TargetPlatform.macOS) {
        return;
      }
      _showForegroundNotification(message);
    });
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      _route(message.data);
    });

    final initialMessage = await _messaging.getInitialMessage();
    if (initialMessage != null) {
      _route(initialMessage.data);
    }

    // Android: the app was killed after showing a foreground notification
    // locally, and that local notification is what launched it.
    try {
      final launch = await _localNotifications
          .getNotificationAppLaunchDetails();
      final payload = launch?.notificationResponse?.payload;
      if ((launch?.didNotificationLaunchApp ?? false) &&
          payload != null &&
          payload.isNotEmpty) {
        _routeFromPayload(payload);
      }
    } catch (error) {
      debugPrint('Notification launch details unavailable: $error');
    }
  }

  Future<void> _showForegroundNotification(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;
    await _localNotifications.show(
      id: message.hashCode,
      title: notification.title,
      body: notification.body,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          _androidChannel.id,
          _androidChannel.name,
          channelDescription: _androidChannel.description,
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: const DarwinNotificationDetails(),
      ),
      payload: encodeNotificationPayload(message.data),
    );
  }

  void _routeFromPayload(String payload) {
    _route(decodeNotificationPayload(payload));
  }

  /// Every tap goes through here and is parked first. It opens only once the
  /// app is ready (the splash has replaced itself with the first real screen
  /// - [AppLaunchGate]) and the role is known ([setAudience]); the decision
  /// itself is the pure [decideNotificationTap].
  ///
  /// The tap that launched the app used to be lost: initialize() is not
  /// awaited before runApp, so getInitialMessage() could resolve after the
  /// splash had looked for a parked tap but before it navigated - the page
  /// was pushed on top of the splash and then replaced by home.
  void _route(Map<String, dynamic> data) {
    _pendingRouteData = data;
    _openPendingTap();
  }

  Map<String, dynamic>? _pendingRouteData;

  void _openPendingTap() {
    final data = _pendingRouteData;
    if (data == null) return;
    final navigator = rootNavigatorKey.currentState;
    final decision = decideNotificationTap(
      data,
      appReady: AppLaunchGate.instance.isReady && navigator != null,
      audience: _audience,
    );
    switch (decision.action) {
      case NotificationTapAction.wait:
        return;
      case NotificationTapAction.ignore:
        _pendingRouteData = null;
        return;
      case NotificationTapAction.open:
        _pendingRouteData = null;
        final route = decision.route!;
        navigator!.pushNamed(route.name, arguments: route.arguments);
    }
  }

  /// Whether a tap is parked, waiting for the app or the role.
  @visibleForTesting
  bool get hasPendingTap => _pendingRouteData != null;

  Future<NotificationSettings> requestPermissionAndRegister() async {
    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );
    if (settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional) {
      await registerCurrentToken();
      _listenForTokenRefresh();
    }
    return settings;
  }

  /// Call on every app start where a session was restored from disk.
  ///
  /// Registration used to happen only when someone typed their password, but
  /// FCM tokens rotate (reinstalls, OS updates, periodic refresh) and a
  /// returning user never re-enters credentials. Once a token rotated during a
  /// restored session nothing rewrote it, and push went silently dead until
  /// the next manual sign-in. Deliberately does NOT prompt - asking for
  /// permission belongs to the sign-in path, not to every cold start.
  Future<void> refreshRegistrationIfPermitted() async {
    NotificationSettings settings;
    try {
      settings = await _messaging.getNotificationSettings();
    } catch (error) {
      debugPrint('Could not read notification settings: $error');
      return;
    }
    if (settings.authorizationStatus != AuthorizationStatus.authorized &&
        settings.authorizationStatus != AuthorizationStatus.provisional) {
      return;
    }
    await registerCurrentToken();
    _listenForTokenRefresh();
  }

  /// Guarded so repeated sign-ins in one app session do not stack duplicate
  /// subscriptions, each rewriting the same token on every refresh.
  void _listenForTokenRefresh() {
    if (_tokenRefreshSubscribed) return;
    _tokenRefreshSubscribed = true;
    _messaging.onTokenRefresh.listen(registerToken);
  }

  bool _tokenRefreshSubscribed = false;

  Future<void> registerCurrentToken() async {
    String? token;
    try {
      // On Apple platforms FCM cannot mint a registration token until APNs has
      // handed the app its device token, which is not ready the instant
      // permission is granted. Calling getToken() before that throws, and the
      // catch below used to swallow it - so no token was ever written and push
      // silently never worked on iOS. Wait for APNs first.
      if (defaultTargetPlatform == TargetPlatform.iOS ||
          defaultTargetPlatform == TargetPlatform.macOS) {
        final apnsToken = await _waitForApnsToken();
        if (apnsToken == null) {
          debugPrint(
            'Push token registration FAILED: APNs never returned a device '
            'token. Check that the APNs auth key is uploaded in Firebase '
            'Console > Cloud Messaging, and that this build is signed with '
            'the Push Notifications capability.',
          );
          return;
        }
      }
      token = await _messaging.getToken();
    } catch (error) {
      debugPrint('Push token fetch FAILED: $error');
      return;
    }
    if (token == null || token.isEmpty) {
      debugPrint('Push token fetch FAILED: getToken() returned empty.');
      return;
    }
    await registerToken(token);
  }

  /// APNs registration is asynchronous and typically lands within a second or
  /// two of the permission grant, but can be slower on a cold start or a poor
  /// connection. Poll briefly rather than giving up on the first null.
  Future<String?> _waitForApnsToken({
    int attempts = 6,
    Duration delay = const Duration(seconds: 1),
  }) async {
    for (var attempt = 0; attempt < attempts; attempt++) {
      final apnsToken = await _messaging.getAPNSToken();
      if (apnsToken != null && apnsToken.isNotEmpty) return apnsToken;
      if (attempt < attempts - 1) await Future<void>.delayed(delay);
    }
    return null;
  }

  Future<void> registerToken(String token) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null || token.isEmpty) return;
    final docId = _tokenDocId(token);
    try {
      await _firestore
          .collection('users')
          .doc(uid)
          .collection('fcmTokens')
          .doc(docId)
          .set({
            'token': token,
            'platform': defaultTargetPlatform.name,
            'enabled': true,
            'updatedAt': FieldValue.serverTimestamp(),
            'createdAt': FieldValue.serverTimestamp(),
          }, SetOptions(merge: true));
    } catch (error) {
      debugPrint('Push token registration skipped: $error');
    }
  }

  Future<void> disableCurrentToken() async {
    final uid = _auth.currentUser?.uid;
    String? token;
    try {
      token = await _messaging.getToken();
    } catch (_) {
      return;
    }
    if (uid == null || token == null || token.isEmpty) return;
    await _firestore
        .collection('users')
        .doc(uid)
        .collection('fcmTokens')
        .doc(_tokenDocId(token))
        .set({
          'enabled': false,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
  }

  String _tokenDocId(String token) {
    return token.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
  }
}

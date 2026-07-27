import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

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

  /// Sets up local-notification display for foreground messages and
  /// tap-to-navigate handling for background/terminated messages. Safe to
  /// call once at app startup regardless of sign-in state - permission and
  /// token registration still happen separately, tied to login, via
  /// [requestPermissionAndRegister].
  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;

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

    FirebaseMessaging.onMessage.listen(_showForegroundNotification);
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      _route(message.data);
    });

    final initialMessage = await _messaging.getInitialMessage();
    if (initialMessage != null) {
      _route(initialMessage.data);
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

  void _route(Map<String, dynamic> data) {
    final navigator = rootNavigatorKey.currentState;
    final route = routeForNotificationData(data);
    if (navigator == null || route == null) return;
    navigator.pushNamed(route.name, arguments: route.arguments);
  }

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
      _messaging.onTokenRefresh.listen((token) {
        registerToken(token);
      });
    }
    return settings;
  }

  Future<void> registerCurrentToken() async {
    String? token;
    try {
      token = await _messaging.getToken();
    } catch (error) {
      debugPrint('Push token fetch skipped: $error');
      return;
    }
    if (token == null || token.isEmpty) return;
    await registerToken(token);
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

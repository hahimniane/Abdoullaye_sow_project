import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/navigation/app_launch_gate.dart';
import 'package:my_flutter_app/services/notification_routing.dart';

void main() {
  const parkingTap = <String, dynamic>{
    'type': 'parking_reservation_status',
    'reservationId': 'car-1',
  };

  group('decideNotificationTap', () {
    test('a tap waits until the first real screen is up', () {
      // The regression: the tap that launched the app was pushed before the
      // splash replaced itself with home, so home replaced it.
      final decision = decideNotificationTap(
        parkingTap,
        appReady: false,
        audience: NotificationAudience.customer,
      );
      expect(decision.action, NotificationTapAction.wait);
    });

    test('a tap waits until the role is known', () {
      // Routing before the role loaded sent a lot's staff to customer screens.
      final decision = decideNotificationTap(
        parkingTap,
        appReady: true,
        audience: null,
      );
      expect(decision.action, NotificationTapAction.wait);
    });

    test('ready and known: it opens, routed for the audience', () {
      final customer = decideNotificationTap(
        parkingTap,
        appReady: true,
        audience: NotificationAudience.customer,
      );
      final business = decideNotificationTap(
        parkingTap,
        appReady: true,
        audience: NotificationAudience.business,
      );
      expect(customer.action, NotificationTapAction.open);
      expect(business.action, NotificationTapAction.open);
      expect(
        customer.route?.name,
        routeForNotificationData(
          parkingTap,
          audience: NotificationAudience.customer,
        )?.name,
      );
      expect(
        business.route?.name,
        routeForNotificationData(
          parkingTap,
          audience: NotificationAudience.business,
        )?.name,
      );
    });

    test('a payload with nothing to open is dropped, not kept', () {
      final decision = decideNotificationTap(
        const {'type': 'something_we_do_not_route'},
        appReady: true,
        audience: NotificationAudience.customer,
      );
      expect(decision.action, NotificationTapAction.ignore);
    });
  });

  group('AppLaunchGate', () {
    setUp(AppLaunchGate.instance.resetForTesting);
    tearDown(AppLaunchGate.instance.resetForTesting);

    test('parks actions until ready, then runs each once, in order', () {
      final gate = AppLaunchGate.instance;
      final ran = <String>[];
      gate.whenReady(() => ran.add('push'));
      gate.whenReady(() => ran.add('link'));
      expect(ran, isEmpty);
      gate.markReady();
      expect(ran, ['push', 'link']);
      gate.markReady();
      expect(ran, ['push', 'link']);
    });

    test('once ready, an action runs straight away', () {
      final gate = AppLaunchGate.instance..markReady();
      var ran = false;
      gate.whenReady(() => ran = true);
      expect(ran, isTrue);
    });

    test('one failing action does not strand the others', () {
      final gate = AppLaunchGate.instance;
      var ran = false;
      gate.whenReady(() => throw StateError('boom'));
      gate.whenReady(() => ran = true);
      gate.markReady();
      expect(ran, isTrue);
    });
  });

  test('every tap is parked and released by the gate and the role', () {
    final push = File(
      'lib/services/push_notification_service.dart',
    ).readAsStringSync();
    final splash = File('lib/screens/splash_screen.dart').readAsStringSync();
    final links = File(
      'lib/services/package_link_service.dart',
    ).readAsStringSync();
    final auth = File('lib/providers/auth_provider.dart').readAsStringSync();

    // Taps never push directly: they park and go through the decision.
    expect(push, contains('decideNotificationTap('));
    expect(push, contains('AppLaunchGate.instance.whenReady(_openPendingTap)'));
    expect(push, isNot(contains('takePendingRoute')));
    // The splash releases both kinds of launch action through one signal.
    expect(splash, contains('AppLaunchGate.instance.markReady()'));
    expect(splash, isNot(contains('takePendingRoute')));
    expect(links, contains('AppLaunchGate.instance.whenReady(markAppReady)'));
    // The role is unknown while it loads and known once it has.
    expect(auth, contains('_pushNotifications.setAudience(null)'));
    expect(auth, contains('_pushNotifications.setAudience('));
  });
}

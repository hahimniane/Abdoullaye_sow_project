import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Month end shipped to the console, the app and the server together, and
/// this keeps the app's half wired: the button, the route the 1st-of-month
/// notification opens, and the three rule copies agreeing on the words.
void main() {
  String read(String path) => File(path).readAsStringSync();

  test('the parking list offers Month end, and the notification opens it', () {
    final menu = read('lib/screens/home_menu.dart');
    expect(menu, contains("Key('open-parking-month-end')"));
    expect(menu, contains('ParkingMonthEndScreen(businessId: businessId)'));
    expect(read('lib/main.dart'), contains("'/business-parking-month-end'"));
    final routing = read('lib/services/notification_routing.dart');
    expect(routing, contains("case 'parking_month_end':"));
    expect(routing, contains("'/business-parking-month-end'"));
  });

  test('the server sends the type the app and console route', () {
    final backend = read('functions/index.js');
    expect(backend, contains('exports.notifyParkingMonthEnd = onSchedule('));
    expect(backend, contains('type: "parking_month_end"'));
    expect(read('../admin_web/src/lib/notification-routing.ts'),
        contains('case "parking_month_end":'));
  });

  test('payments are still recorded on the car, never on the bill', () {
    final screen = read('lib/screens/parking_month_end_screen.dart');
    expect(screen, contains('ParkedCarDetailsScreen('));
    expect(screen, isNot(contains('.set(')));
    expect(screen, isNot(contains('.update(')));
    expect(screen, isNot(contains('httpsCallable')));
  });
}

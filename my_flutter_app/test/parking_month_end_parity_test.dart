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

  test('"paid for the month" has one definition, mirrored in all three statements', () {
    final copies = {
      'app': read('lib/services/parking_month_statement.dart'),
      'console': read('../admin_web/src/lib/parking-month-statement.ts'),
      'server': read('functions/parking_month_statement.js'),
    };
    for (final MapEntry(key: where, value: source) in copies.entries) {
      expect(source,
          contains(where == 'app' ? 'bool parkingMonthCustomerPaid(' : 'function parkingMonthCustomerPaid('),
          reason: '$where defines the paid rule');
      expect(source, contains('customersPaid'), reason: '$where splits out who paid');
      expect(source, contains('paidVia'), reason: '$where says how they paid');
    }
    // The screen lists the statement's split; it does not re-decide "paid".
    final screen = read('lib/screens/parking_month_end_screen.dart');
    expect(screen, contains('ParkingMonthView.paid => summary.customersPaid'));
    expect(screen, isNot(contains('dueCents == 0')));
  });

  test('payments are recorded through the existing payments only, never written directly', () {
    final screen = read('lib/screens/parking_month_end_screen.dart');
    expect(screen, contains('ParkedCarDetailsScreen('));
    // Every paper opens in the preview first: read, then print or share.
    expect(screen, contains('openPdfPreview('));
    expect(screen, isNot(contains('shareParkingMonthPdf(')));
    expect(screen, isNot(contains('.set(')));
    expect(screen, isNot(contains('.update(')));
    // "Mark all paid" records only through the two payments a line already
    // takes, always naming who received the money.
    final callables = RegExp(r"'(record\w+)'").allMatches(screen).map((m) => m[1]).toSet();
    expect(callables, {'recordBusinessParkingPartialPayment', 'recordLotActivityInstalment'});
    expect(screen, contains("'receivedByStaffId': _by"));
    expect(screen, contains('if (_by.isEmpty) {'));
  });
}

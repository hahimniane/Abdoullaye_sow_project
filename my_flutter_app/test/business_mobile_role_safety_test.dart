import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('business mobile home cannot enter customer payment flows', () {
    final source = File('lib/screens/home_menu.dart').readAsStringSync();

    for (final customerRoute in [
      "'/park'",
      "'/barrel'",
      "'/send-freight'",
      "'/request-transport'",
      "'/sell'",
    ]) {
      expect(source, isNot(contains(customerRoute)));
    }
    expect(source, contains('https://business.laawoldigital.com/'));
    // The console is still the one sanctioned way off this screen, but it is
    // no longer the loudest thing on it: it is occasional and it leaves the
    // app, so it is outlined and the daily in-app action is filled.
    expect(source, contains('AsyncActionButton.outlined'));
    expect(source, isNot(contains('AsyncActionButton.filled')));
  });

  test('business activity feed includes freight and localized role copy', () {
    final source = File('lib/screens/home_menu.dart').readAsStringSync();
    final staffSource = File(
      'lib/screens/staff_home_screen.dart',
    ).readAsStringSync();

    expect(source, contains("'freightShipments'"));
    expect(source, contains('_freightShipmentsSubscription'));
    expect(source, contains('ServiceCategory.freight'));
    expect(source, contains('l10n.businessOperationsWebNote'));
    expect(staffSource, contains('l10n.businessChangesRequestedBanner'));
    expect(staffSource, contains('l10n.businessPendingApprovalBanner'));
  });
}

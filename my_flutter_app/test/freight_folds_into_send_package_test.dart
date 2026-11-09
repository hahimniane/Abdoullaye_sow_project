import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/customer_service_catalog.dart';
import 'package:my_flutter_app/screens/customer_home_screen.dart';
import 'package:my_flutter_app/services/nav_prefs.dart';
import 'package:my_flutter_app/utils/service_catalog_localization.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// docs/PACKAGE_PRICE_LIST.md decision 12: the customer Freight button goes
/// away and the customer lands on Send a package. Freight already booked
/// stays readable (tracking, orders, quote details), so those screens and
/// routes are untouched.
void main() {
  group('customers are sent to Send a package, not Freight', () {
    test('the shortcut catalog has no Freight route; Send a package replaces it',
        () {
      final routes = [for (final s in customerServiceCatalog) s.route];
      expect(routes, isNot(contains('/send-freight')));
      expect(serviceById('freight'), isNull);
      final package = serviceById('package')!;
      expect(package.route, '/package-request');
      final l10n = lookupAppLocalizations(const Locale('fr'));
      expect(customerServiceLabel(l10n, package), 'Envoyer un colis');
    });

    test('Start a shipment lists Send a package and not Freight', () {
      final l10n = lookupAppLocalizations(const Locale('en'));
      final options = shipSheetOptions(l10n, sharedBarrels: true);
      expect([for (final o in options) o.route], isNot(contains('/send-freight')));
      expect([for (final o in options) o.title], isNot(contains('Freight')));
      expect([for (final o in options) o.route], contains('/package-request'));
    });

    test('an old /send-freight link opens the Send a package form', () {
      final home = File('lib/screens/customer_home_screen.dart')
          .readAsStringSync();
      final caseAt = home.indexOf("case '/send-freight':");
      expect(caseAt, greaterThan(0));
      final body = home.substring(caseAt, home.indexOf('break;', caseAt));
      expect(body, contains('PackageRequestFormScreen'));
      expect(body.contains('SendFreightScreen'), isFalse);
      final main = File('lib/main.dart').readAsStringSync();
      final line = main
          .split('\n')
          .firstWhere((l) => l.contains("'/send-freight'"));
      expect(line, contains('PackageRequestFormScreen'));
    });

    test('screens that show freight already booked are still there', () {
      for (final path in [
        'lib/screens/freight_quote_details_screen.dart',
        'lib/screens/send_freight_screen.dart',
        'lib/screens/tracking_screen.dart',
        'lib/screens/orders_screen.dart',
      ]) {
        expect(File(path).existsSync(), isTrue, reason: path);
      }
      final main = File('lib/main.dart').readAsStringSync();
      expect(main, contains("'/freight-quote'"));
    });
  });

  group('a pinned Freight shortcut is not lost', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('a stored "freight" pin now opens Send a package', () async {
      SharedPreferences.setMockInitialValues({
        'customer_navbar_services_v1': ['cars', 'freight', 'tracking'],
      });
      expect(await NavPrefs().pinned(), ['cars', 'package', 'tracking']);
    });

    test('a pin that is only Freight becomes Send a package, not the defaults',
        () async {
      SharedPreferences.setMockInitialValues({
        'customer_navbar_services_v1': ['freight'],
      });
      expect(await NavPrefs().pinned(), ['package']);
    });

    test('saving never writes the old id back', () async {
      await NavPrefs().setPinned(['freight', 'cars', 'package']);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getStringList('customer_navbar_services_v1'), [
        'package',
        'cars',
      ]);
    });
  });

  group('Send a barrel is part of Send a package', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('Start a shipment and the Shipping tab have no separate barrel', () {
      final l10n = lookupAppLocalizations(const Locale('en'));
      final options = shipSheetOptions(l10n, sharedBarrels: false);
      expect([for (final o in options) o.route], [
        '/request-transport',
        '/package-request',
      ]);
      expect(l10n.prqSendPackageSubtitle, contains('Barrels'));
      expect(
        lookupAppLocalizations(const Locale('fr')).prqSendPackageSubtitle,
        contains('Barils'),
      );
      final hub = File('lib/screens/services_hub_screen.dart')
          .readAsStringSync();
      expect(hub, isNot(contains("'/barrel'")));
    });

    test('the shortcut catalog has no barrel; the default pins Send a package',
        () {
      expect(serviceById('barrel'), isNull);
      expect(defaultPinnedServiceIds, contains('package'));
      for (final id in defaultPinnedServiceIds) {
        expect(serviceById(id), isNotNull, reason: id);
      }
    });

    test('a stored "barrel" pin now opens Send a package', () async {
      SharedPreferences.setMockInitialValues({
        'customer_navbar_services_v1': ['cars', 'barrel', 'tracking'],
      });
      expect(await NavPrefs().pinned(), ['cars', 'package', 'tracking']);
      SharedPreferences.setMockInitialValues({
        'customer_navbar_services_v1': ['barrel', 'package'],
      });
      expect(await NavPrefs().pinned(), ['package']);
    });

    test('an old /barrel link opens the Send a package form', () {
      final home = File('lib/screens/customer_home_screen.dart')
          .readAsStringSync();
      final caseAt = home.indexOf("case '/barrel':");
      final body = home.substring(caseAt, home.indexOf('break;', caseAt));
      expect(body, contains('PackageRequestFormScreen'));
      final main = File('lib/main.dart').readAsStringSync();
      final line = main.split('\n').firstWhere((l) => l.contains("'/barrel'"));
      expect(line, contains('PackageRequestFormScreen'));
    });
  });
}

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/business_service.dart';

void main() {
  group('businessHasShippingService', () {
    test('each shipping service alone is enough', () {
      for (final service in [
        'barrelShipping',
        'freight',
        'carTransport',
        'carParking',
      ]) {
        expect(businessHasShippingService([service]), isTrue, reason: service);
      }
    });

    test('inventory-only, nothing, and non-shipping services are not', () {
      expect(businessHasShippingService(const ['inventory']), isFalse);
      expect(businessHasShippingService(const <String>[]), isFalse);
      expect(
        businessHasShippingService(const ['carSales', 'sharedBarrels']),
        isFalse,
      );
      expect(businessHasShippingService(const ['unknown']), isFalse);
    });

    test('a shipping service among others still counts', () {
      expect(
        businessHasShippingService(const ['inventory', 'freight']),
        isTrue,
      );
    });

    test('the spellings are the real service keys', () {
      expect(shippingBusinessServiceKeys.map((k) => k.value).toSet(), {
        'barrelShipping',
        'freight',
        'carTransport',
        'carParking',
      });
      for (final key in shippingBusinessServiceKeys) {
        expect(BusinessServiceKey.fromValue(key.value), key);
      }
    });
  });

  group('containersAvailable', () {
    bool call({
      List<String> services = const ['freight'],
      bool hasPermission = true,
      String businessId = 'biz1',
    }) => containersAvailable(
      services: services,
      hasPermission: hasPermission,
      businessId: businessId,
    );

    test('shipping service + permission + business shows it', () {
      expect(call(), isTrue);
    });

    test('a missing permission, service or business hides it', () {
      expect(call(hasPermission: false), isFalse);
      expect(call(services: const ['inventory']), isFalse);
      expect(call(services: const <String>[]), isFalse);
      expect(call(businessId: '  '), isFalse);
    });
  });

  test('every Containers entry point uses the one rule', () {
    String read(String path) => File(path).readAsStringSync();
    expect(
      read('lib/providers/auth_provider.dart'),
      contains('containersAvailable('),
    );
    expect(
      read('lib/screens/home_menu.dart'),
      contains('auth.hasContainersAccess'),
    );
    expect(
      read('lib/screens/parked_car_details_screen.dart'),
      contains('auth.hasContainersAccess'),
    );
    expect(
      read('lib/services/package_link_service.dart'),
      contains('hasContainersPermission: auth.hasContainersAccess'),
    );
  });

  test('the permission editors offer Invoices, in both languages', () {
    String read(String path) => File(path).readAsStringSync();
    expect(
      read('lib/screens/add_staff_screen.dart'),
      contains('BusinessPermission.invoices'),
    );
    final people = read('lib/screens/user_management_screen.dart');
    expect(people, contains('BusinessPermission.invoices,'));
    expect(people, contains('BusinessPermission.invoices =>'));
    expect(read('lib/l10n/app_en.arb'), contains('"invPermissionLabel"'));
    expect(read('lib/l10n/app_fr.arb'), contains('"invPermissionLabel"'));
  });

  test('an empty services list is a real answer, not "show the defaults"', () {
    // A shop registered with Inventory alone has `businessServices: []` on
    // its profiles; only a profile with NO list falls back to the defaults.
    String read(String path) => File(path).readAsStringSync();
    final auth = read('lib/providers/auth_provider.dart');
    expect(
      auth,
      contains(
        "_businessServicesKnown = data?['businessServices'] is Iterable",
      ),
    );
    expect(auth, contains('effectiveBusinessServices'));
    for (final screen in [
      'lib/screens/home_menu.dart',
      'lib/screens/staff_home_screen.dart',
    ]) {
      final src = read(screen);
      expect(src, contains('effectiveBusinessServices'), reason: screen);
      expect(src, isNot(contains('businessServices.isEmpty')), reason: screen);
    }
  });
}

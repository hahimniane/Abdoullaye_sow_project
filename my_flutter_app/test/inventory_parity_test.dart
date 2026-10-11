import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/business_service.dart';
import 'package:my_flutter_app/utils/business_permissions.dart';

/// Inventory shipped to the server, the console and the app against one
/// contract (`docs/INVENTORY.md`). This reads source, the way
/// `waiting_packages_parity_test.dart` does: the screens sit behind a signed-in
/// business with live Firestore streams, and a callable the app never calls, a
/// service missing from one list, or a link the manifest does not claim is
/// exactly what a widget test cannot see.
void main() {
  String read(String path) => File(path).readAsStringSync();

  final doc = read('../docs/INVENTORY.md');
  final service = read('lib/services/inventory_service.dart');
  final pure = read('lib/services/inventory.dart');
  final home = read('lib/screens/home_menu.dart');
  final addStaff = read('lib/screens/add_staff_screen.dart');
  final people = read('lib/screens/user_management_screen.dart');
  final links = read('lib/services/package_link_service.dart');
  final sell = read('lib/screens/inventory_sell_screen.dart');
  final screens = {
    'lib/screens/inventory_screen.dart': read('lib/screens/inventory_screen.dart'),
    'lib/screens/inventory_item_screen.dart':
        read('lib/screens/inventory_item_screen.dart'),
    'lib/screens/inventory_item_sheets.dart':
        read('lib/screens/inventory_item_sheets.dart'),
    'lib/screens/inventory_sales_screen.dart':
        read('lib/screens/inventory_sales_screen.dart'),
    'lib/screens/inventory_sell_screen.dart': sell,
    'lib/widgets/inventory_widgets.dart': read('lib/widgets/inventory_widgets.dart'),
  };

  test('the app calls every callable the contract lists', () {
    final contracted = RegExp(r'`(\w+Inventory\w*|\w*Inventory\w+)\s*[\{\(]')
        .allMatches(doc)
        .map((m) => m.group(1)!)
        .toSet();
    expect(contracted, containsAll(<String>[
      'createInventoryItem',
      'updateInventoryItem',
      'adjustInventoryStock',
      'archiveInventoryItem',
      'deleteInventoryItem',
      'recordInventorySale',
      'voidInventorySale',
      'getInventoryLabelsUrl',
      'getInventorySummary',
    ]));
    final callers = '$service\n$pure';
    for (final name in contracted) {
      expect(callers, contains("'$name'"),
          reason: '$name is in docs/INVENTORY.md but never called by the app');
    }
    // Every call goes through the one caller the tests replace.
    expect(service, contains('typedef InventoryCallableCaller'));
    expect(service, contains('callContainerCallable'));
  });

  test('the service key and the permission are the contract names', () {
    expect(doc, contains('Service key `inventory`'));
    expect(doc, contains('permission section `inventory`'));
    expect(BusinessServiceKey.inventory.value, 'inventory');
    expect(BusinessServiceKey.fromValue('inventory'), BusinessServiceKey.inventory);
    expect(BusinessPermission.inventory, 'inventory');
    expect(
      businessServiceCatalog.map((s) => s.key),
      contains(BusinessServiceKey.inventory),
    );
  });

  test('the service is switched on per business, never by default', () {
    // It is not in the legacy default list: a business with no stored list
    // does not suddenly get a section nobody switched on.
    expect(defaultBusinessServiceValues, isNot(contains('inventory')));
    expect(normalizeBusinessServices(null), isNot(contains('inventory')));
    expect(normalizeBusinessServices(const ['inventory', 'freight']),
        ['freight', 'inventory']);
  });

  test('the section is gated by the service AND the permission', () {
    expect(home, contains('BusinessPermission.inventory'));
    expect(home, contains('inventoryAvailable('));
    expect(home, contains("Key('open-inventory')"));
    expect(home, contains('services: auth.businessServices'));
    // The permission is offered where staff are added and managed.
    expect(addStaff, contains('BusinessPermission.inventory'));
    expect(people, contains('BusinessPermission.inventory,'));
    expect(people, contains('BusinessPermission.inventory =>'));
    // An app link goes through the same gate.
    expect(links, contains('inventoryAvailable('));
    expect(links, contains('BusinessPermission.inventory'));
    expect(links, contains('InventorySellScreen('));
  });

  test('product tag links open the app on both platforms', () {
    final manifest = read('android/app/src/main/AndroidManifest.xml');
    final activity = manifest.substring(
        manifest.indexOf('android:name=".MainActivity"'),
        manifest.indexOf('</activity>'));
    expect(activity, contains('android:pathPrefix="/t/"'));
    expect(activity, contains('android:pathPrefix="/i/"'));
    // Both are verified https filters on the label host, nothing wider.
    expect('android:autoVerify="true"'.allMatches(activity).length, 2);
    expect(activity, isNot(contains('android:pathPrefix="/"')));
    expect(doc, contains('/i/*'));
    // iOS routes by the same associated domain; the path list is the web's.
    for (final path in [
      'ios/Runner/Runner.entitlements',
      'ios/Runner/RunnerRelease.entitlements',
    ]) {
      expect(read(path),
          contains('<string>applinks:customer.laawoldigital.com</string>'));
    }
    expect(pure, contains("inventoryLinkSegment = 'i'"));
  });

  test('the camera wording covers product tags in every language file', () {
    expect(read('ios/Runner/Info.plist'), contains('product tags'));
    expect(read('ios/Runner/en.lproj/InfoPlist.strings'),
        contains('product tags'));
    expect(read('ios/Runner/fr.lproj/InfoPlist.strings'),
        contains('étiquettes de produits'));
  });

  test('the tag is read the way the contract spells it', () {
    expect(doc, contains('https://customer.laawoldigital.com/i/<CODE>'));
    expect(doc, contains('`IT-`'));
    expect(pure, contains("inventoryCodePrefix = 'IT'"));
    // The same alphabet and host as package labels, not a copy of them.
    expect(pure, contains('packageTrackingAlphabet'));
    expect(pure, contains('packageLinkHost'));
    expect(pure, isNot(contains("'customer.laawoldigital.com")));
  });

  test('reads are business-scoped and written down as specs', () {
    expect(service, contains("collection: 'inventoryItems'"));
    expect(service, contains("collection: 'inventorySales'"));
    expect(service, contains("collection: 'inventoryMovements'"));
    for (final entry in screens.entries) {
      expect(entry.value, isNot(contains('FirebaseFirestore')),
          reason: '${entry.key} reads through the source, not Firestore');
      expect(entry.value, isNot(contains("collection('inventory")),
          reason: entry.key);
    }
    // Sales are ordered and paged, never the whole history.
    expect(service, contains("orderBy: 'createdAt'"));
    expect(service, contains('limit: limit'));
    // Every write is a callable: no client write to the inventory collections.
    expect(service, isNot(contains('.set(')));
    expect(service, isNot(contains('.update(')));
    expect(service, isNot(contains('.add(')));
    expect(service, isNot(contains('.delete(')));
  });

  test('no screen builds a stream or a query inside build', () {
    for (final entry in screens.entries) {
      final source = entry.value;
      const marker = 'Widget build(BuildContext context) {';
      var from = 0;
      while (true) {
        final at = source.indexOf(marker, from);
        if (at < 0) break;
        var depth = 0;
        var i = at + marker.length - 1;
        for (; i < source.length; i++) {
          if (source[i] == '{') depth++;
          if (source[i] == '}') {
            depth--;
            if (depth == 0) break;
          }
        }
        final body = source.substring(at, i + 1);
        expect(body, isNot(contains('.listen(')), reason: entry.key);
        expect(body, isNot(contains('watchItems(')), reason: entry.key);
        expect(body, isNot(contains('watchSales(')), reason: entry.key);
        expect(body, isNot(contains('watchMovements(')), reason: entry.key);
        from = i;
      }
    }
    // The lists always resolve: a safety timer on every stream screen.
    for (final path in [
      'lib/screens/inventory_screen.dart',
      'lib/screens/inventory_sales_screen.dart',
      'lib/screens/inventory_item_screen.dart',
    ]) {
      expect(screens[path], contains('Timer('), reason: path);
    }
  });

  test('the counter is camera-first, QR only, with the shared camera view', () {
    expect(sell, contains('ScannerCameraView('));
    expect(sell, contains('BarcodeFormat.qrCode'));
    expect(sell, contains('ScanDebouncer'));
    expect(sell, contains('SaleAttempt'));
    // The payment methods are the invoice list, not a second one.
    expect(pure, contains('inventoryPaymentMethods = invoicePaymentMethods'));
    // Money is read by the one reader and never scaled by hand.
    expect(pure, contains('readMoneyInput'));
    for (final source in [pure, sell, ...screens.values]) {
      expect(source, isNot(contains('* 100)')));
      expect(source, isNot(contains('.toStringAsFixed(2)')));
    }
  });

  test('no offline queue: a failed sale keeps the basket and the attempt', () {
    expect(sell, isNot(contains('SharedPreferences')));
    expect(sell, contains('_attempt.clear()'));
  });

  test('every string on the inventory screens is in both catalogs', () {
    final en = jsonDecode(read('lib/l10n/app_en.arb')) as Map<String, dynamic>;
    final fr = jsonDecode(read('lib/l10n/app_fr.arb')) as Map<String, dynamic>;
    final sources = [
      sell,
      ...screens.values,
      read('lib/utils/service_catalog_localization.dart'),
      people,
      addStaff,
    ].join('\n');
    final used = RegExp(r'l10n\.((?:inventory|businessServiceInventory)[A-Za-z0-9]*)')
        .allMatches(sources)
        .map((m) => m.group(1)!)
        .toSet();
    expect(used.length, greaterThan(80));
    for (final key in used) {
      expect(en.containsKey(key), isTrue, reason: '$key missing from English');
      expect(fr.containsKey(key), isTrue, reason: '$key missing from French');
    }
    // Every inventory string has a real French translation with the same
    // placeholders.
    final keys = en.keys.where((k) =>
        !k.startsWith('@') &&
        (k.startsWith('inventory') || k.startsWith('businessServiceInventory')));
    expect(keys.length, greaterThan(100));
    // Words that are the same in both languages.
    const sharedWords = {'inventoryTotal', 'inventoryTitle', 'businessServiceInventory'};
    for (final key in keys) {
      expect(fr[key], isA<String>(), reason: 'fr $key');
      if (!sharedWords.contains(key)) {
        expect(fr[key], isNot(en[key]), reason: 'fr $key is still English');
      }
      final holes = RegExp(r'\{(\w+)[,}]');
      Set<String> names(Object? text) =>
          holes.allMatches('$text').map((m) => m.group(1)!).toSet();
      expect(names(fr[key]), names(en[key]), reason: 'placeholders of $key');
    }
  });
}

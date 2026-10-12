import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/business_service.dart';
import 'package:my_flutter_app/services/inventory.dart'
    show inventoryFailureReasons;
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
    'lib/screens/inventory_categories_screen.dart':
        read('lib/screens/inventory_categories_screen.dart'),
    'lib/screens/inventory_brands_screen.dart':
        read('lib/screens/inventory_brands_screen.dart'),
    'lib/screens/inventory_stores_screen.dart':
        read('lib/screens/inventory_stores_screen.dart'),
    'lib/widgets/inventory_widgets.dart': read('lib/widgets/inventory_widgets.dart'),
  };

  test('the app calls every callable the contract lists', () {
    // Callables the app never calls: the platform admin's switch lives in the
    // admin console only, and the category clean-up is server-side.
    const adminConsoleOnly = {
      'setBusinessInventoryService',
      // A one-off server clean-up of legacy typed categories; no screen calls it.
      'syncInventoryCategories',
    };
    final contracted = RegExp(r'`(\w+Inventory\w*|\w*Inventory\w+)\s*[\{\(]')
        .allMatches(doc)
        .map((m) => m.group(1)!)
        .where((name) => !adminConsoleOnly.contains(name))
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
      // Categories and stores (v2).
      'createInventoryCategory',
      'renameInventoryCategory',
      'archiveInventoryCategory',
      'createInventoryStore',
      'updateInventoryStore',
      'archiveInventoryStore',
      'setInventoryStaffAccess',
      'transferInventoryStock',
      // Brands (v3).
      'createInventoryBrand',
      'renameInventoryBrand',
      'archiveInventoryBrand',
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

  group('categories and stores (v2)', () {
    // The v2 section only: the v3 contract has its own group below.
    final v2 = doc.substring(
      doc.indexOf('# Categories and stores (v2)'),
      doc.indexOf('# Brands and quick entry (v3)'),
    );
    final auth = read('lib/providers/auth_provider.dart');
    final team = read('lib/screens/business_profile_screen.dart');
    final stores = read('lib/services/inventory_stores.dart');
    final context = read('lib/services/inventory_context.dart');

    test('the app reads the collections the contract lists, business-scoped',
        () {
      for (final collection in [
        'inventoryCategories',
        'inventoryStores',
        'inventoryStock',
      ]) {
        expect(v2, contains('`$collection`'));
        expect(service, contains("collection: '$collection'"),
            reason: '$collection is read by the app');
      }
      // Every read names the business, and the stock read can be narrowed to
      // one store (what the rules allow staff to read).
      expect(RegExp("QueryFilterSpec\\('businessId'").allMatches(service).length,
          greaterThanOrEqualTo(7));
      expect(service, contains("QueryFilterSpec('storeId'"));
      // The reads of a store's stock wait for a multi-store business.
      expect(context, contains('inventoryNeedsStock'));
    });

    test('every new refusal code in the contract has its own failure and words',
        () {
      final line = RegExp(r'new: ([a-z_, ]+)\.')
          .firstMatch(v2)!
          .group(1)!
          .split(',')
          .map((c) => c.trim())
          .toSet();
      expect(line, hasLength(12));
      expect(inventoryFailureReasons.keys.toSet(), containsAll(line));
      final widgets = read('lib/widgets/inventory_widgets.dart');
      final en = jsonDecode(read('lib/l10n/app_en.arb')) as Map<String, dynamic>;
      final fr = jsonDecode(read('lib/l10n/app_fr.arb')) as Map<String, dynamic>;
      for (final failure in inventoryFailureReasons.values) {
        expect(widgets, contains('InventoryFailure.${failure.name} =>'),
            reason: '${failure.name} has words');
      }
      final failureKeys = RegExp(r'InventoryFailure\.\w+ => l10n\.(\w+)')
          .allMatches(widgets)
          .map((m) => m.group(1)!);
      for (final key in failureKeys) {
        expect(en.containsKey(key), isTrue, reason: 'en $key');
        expect(fr.containsKey(key), isTrue, reason: 'fr $key');
      }
    });

    test('where the owner assigns stores, and what the app reads of the person',
        () {
      // The staff fields are the contract's names.
      expect(v2, contains('`inventoryHomeStoreId`'));
      expect(v2, contains('`inventoryAllStores`'));
      expect(auth, contains("'inventoryHomeStoreId'"));
      expect(auth, contains("'inventoryAllStores'"));
      expect(team, contains('InventoryTeamAccess('));
      expect(team, contains('auth.isBusinessOwner'));
      // Every way into Inventory hands over what the person may do.
      expect(home, contains('access: auth.inventoryAccess'));
      expect(links, contains('access: auth.inventoryAccess'));
      // The owner alone manages stores; the staff's own control sits in the
      // service as a callable the server restricts to the owner.
      expect(stores, contains('bool get canManageStores => isOwner'));
      expect(screens['lib/screens/inventory_screen.dart'],
          contains('widget.access.canManageStores'));
    });

    test('single-store shops and v1-shaped requests are unchanged', () {
      // A store is sent only by someone who picked it.
      expect(stores, contains('sell.mode != InventorySellStoreMode.pick'));
      expect(pure, contains("if (storeId.isNotEmpty) 'storeId': storeId"));
      // The sale waits for the stores to be known, and for a store to sell
      // from, before anything is sent.
      expect(sell, contains('!_sell.canSell || !_watcher.storesLoaded'));
    });
  });

  group('brands and quick entry (v3)', () {
    final v3 = doc.substring(doc.indexOf('# Brands and quick entry (v3)'));
    final v2 = doc.substring(
      doc.indexOf('# Categories and stores (v2)'),
      doc.indexOf('# Brands and quick entry (v3)'),
    );
    Set<String> newCodes(String section) => RegExp(r'new: ([a-z_, ]+)\.')
        .firstMatch(section)!
        .group(1)!
        .split(',')
        .map((c) => c.trim())
        .toSet();

    test('the app calls the three brand callables and reads the collection',
        () {
      for (final name in [
        'createInventoryBrand',
        'renameInventoryBrand',
        'archiveInventoryBrand',
      ]) {
        expect(v3, contains('`$name {'), reason: '$name is in the contract');
        expect(service, contains("'$name'"), reason: '$name is called');
      }
      expect(v3, contains('`inventoryBrands`'));
      expect(service, contains("collection: 'inventoryBrands'"));
      // Business-scoped like the other lists.
      expect(service,
          contains("inventoryBrandsSpec(String businessId) => FirestoreQuerySpec"));
    });

    test('v2 and v3 refusal codes together are the 16 the app maps', () {
      final added = newCodes(v3);
      expect(added, {
        'brand_name_required',
        'brand_name_taken',
        'brand_not_found',
        'brand_too_long',
      });
      final all = {...newCodes(v2), ...added};
      expect(all, hasLength(16));
      expect(inventoryFailureReasons.keys.toSet(), all);
      final widgets = read('lib/widgets/inventory_widgets.dart');
      final en = jsonDecode(read('lib/l10n/app_en.arb')) as Map<String, dynamic>;
      final fr = jsonDecode(read('lib/l10n/app_fr.arb')) as Map<String, dynamic>;
      for (final failure in inventoryFailureReasons.values) {
        expect(widgets, contains('InventoryFailure.${failure.name} =>'),
            reason: '${failure.name} has words');
      }
      for (final key in RegExp(r'InventoryFailure\.\w+ => l10n\.(\w+)')
          .allMatches(widgets)
          .map((m) => m.group(1)!)) {
        expect(en.containsKey(key), isTrue, reason: 'en $key');
        expect(fr.containsKey(key), isTrue, reason: 'fr $key');
      }
    });

    test('a brand shows in front everywhere a product name is shown', () {
      // The one place the words are joined; no screen spells the join itself.
      expect(pure, contains('String inventoryDisplayName(String brand'));
      for (final path in [
        'lib/screens/inventory_screen.dart',
        'lib/screens/inventory_item_screen.dart',
        'lib/screens/inventory_item_sheets.dart',
        'lib/screens/inventory_sell_screen.dart',
        'lib/screens/inventory_sales_screen.dart',
      ]) {
        final source = screens[path]!;
        expect(source, contains('displayName'), reason: path);
        // A product's bare name is never shown (a brand would be lost).
        expect(RegExp(r'\b(?:item|line\.item|widget\.item)\.name\b')
            .hasMatch(source), isFalse, reason: path);
      }
    });

    test('quick entry is a second button on the product form, client only', () {
      final sheets = screens['lib/screens/inventory_item_sheets.dart']!;
      expect(v3, contains('Save and add another like it'));
      expect(sheets, contains("Key('inv-form-save-another')"));
      expect(sheets, contains('inventorySaveAndAddAnother'));
      // No new callable for it: the same createInventoryItem.
      expect(v3, contains('Client-only'));
    });
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
      'lib/screens/inventory_categories_screen.dart',
      'lib/screens/inventory_brands_screen.dart',
      'lib/screens/inventory_stores_screen.dart',
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

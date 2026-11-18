import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/screens/home_menu.dart';
import 'package:my_flutter_app/screens/shipping_home_section.dart';
import 'package:my_flutter_app/screens/shop_home_section.dart';
import 'package:my_flutter_app/services/bank_check.dart' show BankStatusCache;
import 'package:my_flutter_app/services/business_home.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/services/shipping_home.dart';
import 'package:my_flutter_app/services/zelle_check_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/utils/business_permissions.dart';
import 'package:my_flutter_app/widgets/business_home_column.dart';
import 'package:my_flutter_app/widgets/main_work_picker.dart';
import 'package:provider/provider.dart';

import 'fixtures/fake_package_requests.dart';

/// The business home leads with the business's main work
/// (docs/APP_NEW_LOOK.md, H1 and H2): the pure order of the blocks, the
/// home's column driven with the real blocks and a fake sign-in, and the
/// Business profile picker. The home itself reads Firebase, so its wiring is
/// also checked by reading its source, as the other home contracts do.

List<HomeWork> _works({
  bool sell = false,
  bool park = false,
  bool ship = false,
  bool cars = false,
  bool transport = false,
}) => homeWorks(
  canSell: sell,
  canPark: park,
  canShip: ship,
  canSellCars: cars,
  canTransport: transport,
);

class _Auth extends ChangeNotifier implements AuthProvider {
  _Auth({this.permissions = const {}, this.services = const []});

  final Set<String> permissions;
  final List<String> services;

  @override
  bool get isAdmin => false;
  @override
  bool get isBusinessOwner => true;
  @override
  bool get hasBusinessDashboardAccess => true;
  @override
  String? get businessId => 'b1';
  @override
  List<String> get businessServices => services;
  @override
  List<String> get effectiveBusinessServices => services;
  @override
  bool hasBusinessPermission(String permission) =>
      permissions.contains(permission);
  @override
  bool get hasInvoicesAccess => true;
  @override
  bool get hasContainersAccess => permissions.contains('containers');
  @override
  bool get hasDeliveriesAccess => false;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isGetter) return null;
    return super.noSuchMethod(invocation);
  }
}

class _Source implements InventorySource {
  @override
  Stream<List<InventoryItem>> watchItems(String businessId) =>
      Stream.value(const []);
  @override
  Future<InventoryItem?> findItemByCode(String businessId, String code) async =>
      null;
  @override
  Stream<List<InventorySale>> watchSales(
    String businessId, {
    required int limit,
    String storeId = '',
  }) => Stream.value(const []);
  @override
  Stream<InventorySale?> watchSale(String businessId, String saleId) =>
      Stream.value(null);
  @override
  Stream<List<InventoryMovement>> watchMovements(
    String businessId,
    String itemId, {
    String storeId = '',
  }) => Stream.value(const []);
  @override
  Stream<List<InventoryCategory>> watchCategories(String businessId) =>
      Stream.value(const []);
  @override
  Stream<List<InventoryBrand>> watchBrands(String businessId) =>
      Stream.value(const []);
  @override
  Stream<List<InventoryStore>> watchStores(String businessId) =>
      Stream.value(const []);
  @override
  Stream<List<InventoryStockRow>> watchStock(
    String businessId, {
    String storeId = '',
  }) => Stream.value(const []);
  @override
  Stream<List<LotStaff>> watchStaff(String businessId) =>
      Stream.value(const []);
}

Future<void> _pump(WidgetTester tester, Widget child, {Locale? locale}) async {
  tester.view.physicalSize = const Size(390, 4000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale ?? const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

/// The home's column with the real blocks, for a person who may park, ship
/// and sell at a business with all three services.
Widget _home({required List<HomePart> parts, required _Auth auth}) {
  return ChangeNotifierProvider<AuthProvider>.value(
    value: auth,
    child: Builder(
      builder: (context) {
        final l10n = AppLocalizations.of(context)!;
        final leadsWithShipping = parts.first == HomePart.shipping;
        return BusinessHomeColumn(
          parts: parts,
          header: const Text('Test Lot', key: Key('home-business-name')),
          shop: (leading) => ShopHomeSection(
            key: const Key('shop-home'),
            businessId: 'b1',
            access: const InventoryAccess.owner(),
            businessName: 'Test Lot',
            showHeader: leading,
            showTodaySales: false,
            source: _Source(),
            service: InventoryService(caller: (name, payload) async => {}),
            bankService: ZelleCheckService(
              caller: (name, payload) async => throw StateError('no bank'),
            ),
            bankCache: BankStatusCache(),
            cameraEnabled: false,
          ),
          shipping: () => ShippingHomeSection(
            key: const Key('shipping-home-section'),
            businessId: 'b1',
            showTail: false,
            factsLoader: (_) async => ShippingHomeFacts.unknown,
            requestServiceBuilder: () => FakePackageRequests(),
          ),
          services: (shopBelow) => HomeServicesSection(
            l10n: l10n,
            width: 390,
            tiles: const [],
            isLoading: false,
            selectedCategory: ServiceCategory.all,
            onCategoryTapped: (_) {},
            shopBelow: shopBelow,
            omitRowKeys: leadsWithShipping ? homeShippingRowKeys : const {},
            quietPrimaryAction: leadsWithShipping,
            showTail: false,
          ),
        );
      },
    ),
  );
}

double _top(WidgetTester tester, Finder finder) =>
    tester.getTopLeft(finder.first).dy;

final _record = find.byKey(const Key('record-parked-car'));
final _sell = find.byType(ShopSellButton);
final _register = find.byKey(const Key('register-package'));

_Auth _threeWorks() => _Auth(
  permissions: {
    BusinessPermission.parking,
    BusinessPermission.inventory,
    'containers',
    BusinessPermission.ledger,
  },
  services: const ['carParking', 'barrelShipping', 'inventory'],
);

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  group('homeParts', () {
    final all = _works(sell: true, park: true, ship: true);

    test('parking leads: the standard home, then the shop', () {
      expect(homeParts(works: all, stored: 'parking'), [
        HomePart.services,
        HomePart.shop,
      ]);
    });

    test('shipping leads: shipping, the standard home, then the shop', () {
      expect(homeParts(works: all, stored: 'shipping'), [
        HomePart.shipping,
        HomePart.services,
        HomePart.shop,
      ]);
    });

    test('shop leads, chosen or by default: Sell first as before', () {
      expect(homeParts(works: all, stored: 'shop'), [
        HomePart.shop,
        HomePart.services,
      ]);
      expect(homeParts(works: all, stored: null), [
        HomePart.shop,
        HomePart.services,
      ]);
      expect(homeParts(works: all, stored: ''), [
        HomePart.shop,
        HomePart.services,
      ]);
      expect(homeParts(works: all, stored: 'nonsense'), [
        HomePart.shop,
        HomePart.services,
      ]);
    });

    test('car sales and transport lead the standard home too', () {
      final works = _works(sell: true, cars: true, transport: true);
      expect(homeParts(works: works, stored: 'carSales'), [
        HomePart.services,
        HomePart.shop,
      ]);
      expect(homeParts(works: works, stored: 'transport'), [
        HomePart.services,
        HomePart.shop,
      ]);
    });

    test('a person who cannot sell never gets the shop block', () {
      final works = _works(park: true, ship: true);
      expect(homeParts(works: works, stored: 'parking'), [HomePart.services]);
      expect(homeParts(works: works, stored: 'shipping'), [
        HomePart.shipping,
        HomePart.services,
      ]);
      expect(homeParts(works: works, stored: null), [HomePart.services]);
    });

    test('a stored work the person cannot do falls back to the default', () {
      // Shipping chosen, but this person holds no Containers access.
      final noShip = _works(sell: true, park: true);
      expect(homeParts(works: noShip, stored: 'shipping'), [
        HomePart.shop,
        HomePart.services,
      ]);
      // Parking chosen, but this person cannot park.
      final noPark = _works(park: false, ship: true, cars: true);
      expect(homeParts(works: noPark, stored: 'parking'), [HomePart.services]);
      expect(homeParts(works: noPark, stored: null), [HomePart.services]);
    });

    test('shipping alone is the standard home (the simple one is its own)', () {
      expect(homeParts(works: _works(ship: true), stored: 'shipping'), [
        HomePart.services,
      ]);
    });

    test('nothing to lead with: the standard home', () {
      expect(homeParts(works: const [], stored: 'parking'), [
        HomePart.services,
      ]);
    });
  });

  group('who can lead with shipping', () {
    bool can({
      bool admin = false,
      bool dashboard = true,
      bool containers = true,
      bool business = true,
      List<String> services = const ['barrelShipping', 'carParking'],
    }) => homeCanShip(
      isAdmin: admin,
      hasBusinessDashboardAccess: dashboard,
      hasContainersAccess: containers,
      hasBusiness: business,
      services: services,
    );

    test('a member with Containers at a shipping business', () {
      expect(can(), isTrue);
      expect(can(services: const ['freight', 'inventory']), isTrue);
    });

    test('never without the Containers access, as admin or outside', () {
      expect(can(containers: false), isFalse);
      expect(can(admin: true), isFalse);
      expect(can(dashboard: false), isFalse);
      expect(can(business: false), isFalse);
      expect(can(services: const ['carParking', 'inventory']), isFalse);
    });

    test('a person without Containers never gets the shipping-first home', () {
      final works = _works(
        sell: true,
        park: true,
        ship: can(containers: false),
      );
      expect(works, isNot(contains(HomeWork.shipping)));
      expect(homeParts(works: works, stored: 'shipping'), [
        HomePart.shop,
        HomePart.services,
      ]);
      expect(
        homeParts(works: works, stored: 'shipping'),
        isNot(contains(HomePart.shipping)),
      );
    });
  });

  group('the Main work choice', () {
    test('lists the works the business has on, in the default order', () {
      expect(homeWorksOn(const ['carParking']), [HomeWork.parking]);
      expect(
        homeWorksOn(const [
          'carTransport',
          'barrelShipping',
          'carParking',
          'inventory',
          'carSales',
        ]),
        [
          HomeWork.shop,
          HomeWork.parking,
          HomeWork.shipping,
          HomeWork.carSales,
          HomeWork.transport,
        ],
      );
      expect(homeWorksOn(const ['freight']), [HomeWork.shipping]);
      // Shared barrels are not a package-shipping work.
      expect(homeWorksOn(const ['sharedBarrels']), isEmpty);
    });

    test('only a valid choice is saved; nothing else is ever sent', () {
      const on = ['carParking', 'barrelShipping'];
      expect(mainWorkToSave('shipping', on), 'shipping');
      expect(mainWorkToSave('parking', on), 'parking');
      expect(mainWorkToSave(null, on), isNull);
      expect(mainWorkToSave('', on), isNull);
      expect(mainWorkToSave('nonsense', on), isNull);
      // The service was switched off after the choice: not chosen.
      expect(mainWorkToSave('shop', on), isNull);
      // Only one work on: there is nothing to choose.
      expect(mainWorkToSave('parking', const ['carParking']), isNull);
    });
  });

  group('the home, with the real blocks', () {
    testWidgets('parking leads: Record a parked car above Sell', (
      tester,
    ) async {
      await _pump(
        tester,
        _home(
          parts: homeParts(
            works: _works(sell: true, park: true, ship: true),
            stored: 'parking',
          ),
          auth: _threeWorks(),
        ),
      );
      expect(_record, findsOneWidget);
      expect(_sell, findsOneWidget);
      expect(_top(tester, _record), lessThan(_top(tester, _sell)));
      // Not the shipping block: this home is parking's.
      expect(_register, findsNothing);
      // The shop block follows under its own label, with no second header.
      expect(find.byKey(const Key('home-shop-below')), findsOneWidget);
      expect(find.byKey(const Key('shop-business-name')), findsNothing);
      expect(
        find.descendant(
          of: find.byKey(const Key('home-shop-below')),
          matching: find.text('Inventory'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('shipping leads: Register a package first, parking kept', (
      tester,
    ) async {
      await _pump(
        tester,
        _home(
          parts: homeParts(
            works: _works(sell: true, park: true, ship: true),
            stored: 'shipping',
          ),
          auth: _threeWorks(),
        ),
      );
      expect(_register, findsOneWidget);
      expect(_record, findsOneWidget);
      expect(_sell, findsOneWidget);
      expect(_top(tester, _register), lessThan(_top(tester, _record)));
      expect(_top(tester, _record), lessThan(_top(tester, _sell)));
      // The places the shipping block lists are left out of the standard
      // block (here the shipping block is given no rows), so none is offered
      // twice; every place only the standard block has is still there.
      expect(find.byKey(const Key('open-containers')), findsNothing);
      expect(find.byKey(const Key('open-invoices')), findsNothing);
      expect(find.byKey(const Key('open-lot-ledger')), findsOneWidget);
      expect(find.byKey(const Key('open-inventory')), findsOneWidget);
      // Record a parked car is a quiet button here, not the loud one.
      expect(find.text('Record a parked car'), findsOneWidget);
    });

    testWidgets('no choice: today\'s order, Sell first then parking', (
      tester,
    ) async {
      await _pump(
        tester,
        _home(
          parts: homeParts(
            works: _works(sell: true, park: true, ship: true),
            stored: null,
          ),
          auth: _threeWorks(),
        ),
      );
      expect(_sell, findsOneWidget);
      expect(_record, findsOneWidget);
      expect(_top(tester, _sell), lessThan(_top(tester, _record)));
      expect(_register, findsNothing);
      // The shop block leads and carries the header.
      expect(find.byKey(const Key('shop-business-name')), findsOneWidget);
      expect(find.byKey(const Key('home-business-name')), findsNothing);
    });

    testWidgets('French, shipping first: everything fits at 320 wide', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 4000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          locale: const Locale('fr'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: _home(
                parts: homeParts(
                  works: _works(sell: true, park: true, ship: true),
                  stored: 'shipping',
                ),
                auth: _threeWorks(),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(_register, findsOneWidget);
      expect(_record, findsOneWidget);
    });
  });

  group('the Main work picker', () {
    Future<List<HomeWork>> pumpPicker(
      WidgetTester tester,
      List<HomeWork> works, {
      HomeWork? selected,
      bool enabled = true,
      Locale locale = const Locale('en'),
    }) async {
      final picked = <HomeWork>[];
      await _pump(
        tester,
        StatefulBuilder(
          builder: (context, setState) => MainWorkPicker(
            works: works,
            selected: selected,
            enabled: enabled,
            onChanged: picked.add,
          ),
        ),
        locale: locale,
      );
      return picked;
    }

    testWidgets('hidden with one work', (tester) async {
      await pumpPicker(tester, const [HomeWork.parking]);
      expect(find.byKey(const Key('main-work-picker')), findsNothing);
      expect(find.text('Main work'), findsNothing);
    });

    testWidgets('one row per work, and choosing reports it', (tester) async {
      final picked = await pumpPicker(tester, const [
        HomeWork.parking,
        HomeWork.shipping,
      ], selected: HomeWork.parking);
      expect(find.text('Main work'), findsOneWidget);
      expect(find.text("The app's home opens on this."), findsOneWidget);
      expect(find.byKey(const Key('main-work-parking')), findsOneWidget);
      expect(find.byKey(const Key('main-work-shipping')), findsOneWidget);
      expect(find.byIcon(Icons.radio_button_checked), findsOneWidget);
      await tester.tap(find.byKey(const Key('main-work-shipping')));
      expect(picked, [HomeWork.shipping]);
    });

    testWidgets('someone who cannot edit changes nothing', (tester) async {
      final picked = await pumpPicker(tester, const [
        HomeWork.parking,
        HomeWork.shipping,
      ], enabled: false);
      await tester.tap(find.byKey(const Key('main-work-shipping')));
      expect(picked, isEmpty);
    });

    testWidgets('French, 320 wide: rows are tall enough and fit', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          locale: const Locale('fr'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(16),
              child: MainWorkPicker(
                works: HomeWork.values,
                selected: null,
                enabled: true,
                onChanged: (_) {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Activité principale'), findsOneWidget);
      for (final work in HomeWork.values) {
        final size = tester.getSize(find.byKey(Key('main-work-${work.key}')));
        expect(size.height, greaterThanOrEqualTo(44));
      }
    });
  });

  group('the wiring, read from the source', () {
    String read(String path) => File(path).readAsStringSync();

    test('the home reads the business document once, never blocks on it', () {
      final home = read('lib/screens/home_menu.dart');
      expect(home, contains("data()?['mainWork']"));
      expect(home, contains('_mainWorkSub?.cancel()'));
      expect(home, contains('onError:'));
      expect(home, contains('homeParts(works: works, stored: _mainWork)'));
      expect(home, contains('homeCanShip('));
    });

    test('the profile sends mainWork only through the one save call', () {
      final screen = read('lib/screens/business_profile_screen.dart');
      expect(
        screen,
        contains('mainWork: mainWorkToSave(_mainWork?.key, _selectedServices)'),
      );
      final auth = read('lib/providers/auth_provider.dart');
      expect(auth, contains("'mainWork': ?mainWork,"));
    });

    test('every new string is in English and French', () {
      for (final lang in ['en', 'fr']) {
        final arb = read('lib/l10n/app_$lang.arb');
        for (final key in ['nhmMainWorkTitle', 'nhmMainWorkHelp']) {
          expect(arb, contains('"$key"'), reason: '$lang $key');
          expect(arb, contains('"@$key"'), reason: '$lang @$key');
        }
      }
    });
  });
}

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/business_service.dart';
import 'package:my_flutter_app/screens/inventory_sales_screen.dart';
import 'package:my_flutter_app/screens/inventory_screen.dart';
import 'package:my_flutter_app/screens/inventory_sell_screen.dart';
import 'package:my_flutter_app/screens/shop_home_section.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/services/shop_home.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/app_bottom_nav.dart';

/// The shop home: a business that sells at a counter opens the app on Sell.
///
/// The gate is pure and tested here for every role (the home itself reads
/// Firebase and the signed-in profile, which widget tests cannot build); the
/// section the home shows is rendered with a fake source and a recording
/// caller, in English and French, at phone widths and a larger text size.
/// The last group checks the wiring in the home and the staff shell by
/// reading their source, the way the other home contracts do.

final _now = DateTime(2026, 10, 12, 16, 30);

InventorySale _sale(
  String id, {
  required int minutesAgo,
  int total = 1250,
  String by = 'u1',
  String payment = 'cash',
  bool voided = false,
  String storeId = '',
  List<InventorySaleLine> lines = const [],
}) => InventorySale(
  id: id,
  businessId: 'b1',
  lines: lines,
  totalCents: total,
  paymentMethod: payment,
  soldByStaffId: by,
  voided: voided,
  storeId: storeId,
  createdAt: _now.subtract(Duration(minutes: minutesAgo)),
);

InventorySaleLine _line(String name, {int quantity = 1, int price = 500}) =>
    InventorySaleLine.fromMap({
      'itemId': 'i-$name',
      'name': name,
      'quantity': quantity,
      'listPriceCents': price,
      'soldPriceCents': price,
    });

class _FakeSource implements InventorySource {
  _FakeSource({
    this.sales = const [],
    this.stores = const [],
    this.staff = const [],
    this.salesFail = false,
  });

  final List<InventorySale> sales;
  final List<InventoryStore> stores;
  final List<LotStaff> staff;
  final bool salesFail;
  final List<String> salesStores = [];

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
  }) {
    salesStores.add(storeId);
    if (salesFail) return Stream.error(StateError('offline'));
    return Stream.value([
      for (final s in sales)
        if (storeId.isEmpty || s.storeId == storeId) s,
    ]);
  }

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
      Stream.value(stores);

  @override
  Stream<List<InventoryStockRow>> watchStock(
    String businessId, {
    String storeId = '',
  }) => Stream.value(const []);

  @override
  Stream<List<LotStaff>> watchStaff(String businessId) => Stream.value(staff);
}

/// Answers `getInventorySummary` (or refuses it, or never answers).
class _Calls {
  _Calls({this.summary, this.fail = false, this.hang = false});

  final Map<String, Object?>? summary;
  final bool fail;
  final bool hang;
  final List<Map<String, Object?>> summaryRequests = [];

  InventoryService get service => InventoryService(
    caller: (name, payload) async {
      if (name == 'getInventorySummary') {
        summaryRequests.add(payload);
        if (hang) return Completer<Object?>().future;
        if (fail) throw StateError('offline');
        return summary ?? <String, Object?>{};
      }
      return <String, Object?>{};
    },
  );
}

const _summary = <String, Object?>{
  'salesCount': 12,
  'itemsSold': 19,
  'revenueCents': 128450,
  'low': [
    {'itemId': 'i1', 'name': 'Shea butter', 'quantity': 2},
    {'itemId': 'i2', 'name': 'Wax print', 'quantity': 0},
    {'itemId': 'i3', 'name': 'Black soap', 'quantity': 1},
  ],
};

const _stores = [
  InventoryStore(id: 's-main', name: 'Main store', isMain: true),
  InventoryStore(id: 's-bk', name: 'Brooklyn'),
];

final _staff = [
  const LotStaff(id: 'u1', name: 'Aminata'),
  const LotStaff(id: 'u2', name: 'Ibrahima'),
];

List<InventorySale> _todaySales() => [
  _sale(
    'a',
    minutesAgo: 8,
    total: 3850,
    lines: [
      _line('Shea butter', quantity: 2, price: 1200),
      _line('Black soap', price: 1450),
    ],
  ),
  _sale(
    'b',
    minutesAgo: 47,
    total: 6500,
    by: 'u2',
    payment: 'zelle',
    lines: [_line('Wax print fabric', price: 6500)],
  ),
  _sale(
    'c',
    minutesAgo: 95,
    total: 900,
    voided: true,
    lines: [_line('Head wrap', price: 900)],
  ),
  // Yesterday: never on "Today's sales".
  _sale('old', minutesAgo: 60 * 24, lines: [_line('Old')]),
];

Widget _section({
  required _FakeSource source,
  required _Calls calls,
  InventoryAccess access = const InventoryAccess.owner(),
  String businessName = 'Mariama Boutique',
  String? approvalStatus,
  bool showTodaySales = true,
}) => ShopHomeSection(
  businessId: 'b1',
  access: access,
  businessName: businessName,
  approvalStatus: approvalStatus,
  showTodaySales: showTodaySales,
  // The size of the home's bell and language switch, which need Firebase.
  headerActions: const Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      SizedBox(
        width: 48,
        height: 48,
        child: Icon(Icons.notifications_none_rounded),
      ),
      SizedBox(width: 56, height: 48, child: Icon(Icons.translate_rounded)),
    ],
  ),
  source: source,
  service: calls.service,
  cameraEnabled: false,
  clock: () => _now,
);

/// The shop home as it sits in the app: cream page, safe areas, the top row,
/// the section, and the staff bar with Sell raised in the middle.
Widget _screen(Widget section, AppLocalizations Function(BuildContext) l10n) {
  return Builder(
    builder: (context) {
      final t = l10n(context);
      return Scaffold(
        body: SafeArea(
          child: CustomScrollView(
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                sliver: SliverToBoxAdapter(child: section),
              ),
            ],
          ),
        ),
        bottomNavigationBar: AppBottomNav(
          currentIndex: 0,
          onTap: (_) {},
          action: AppBottomNavAction(
            icon: Icons.qr_code_scanner_rounded,
            label: t.inventorySell,
            onTap: () {},
          ),
          items: [
            AppBottomNavItem(
              icon: Icons.home_outlined,
              selectedIcon: Icons.home,
              label: t.home,
            ),
            AppBottomNavItem(
              icon: Icons.storefront_outlined,
              selectedIcon: Icons.storefront,
              label: t.business,
            ),
            AppBottomNavItem(
              icon: Icons.settings_outlined,
              selectedIcon: Icons.settings,
              label: t.settings,
            ),
          ],
        ),
      );
    },
  );
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(390, 1600),
  double textScale = 1,
  ThemeData? theme,
  EdgeInsets padding = EdgeInsets.zero,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  tester.view.padding = FakeViewPadding(
    top: padding.top,
    bottom: padding.bottom,
  );
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: theme ?? AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      builder: (context, app) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: app!,
      ),
      home: child,
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpSection(
  WidgetTester tester,
  Widget section, {
  Locale locale = const Locale('en'),
  Size size = const Size(390, 1600),
  double textScale = 1,
}) => _pump(
  tester,
  Scaffold(body: SingleChildScrollView(child: section)),
  locale: locale,
  size: size,
  textScale: textScale,
);

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  group('who gets the shop home', () {
    ShopHomeLayout layout({
      bool isAdmin = false,
      bool dashboard = true,
      bool inventory = true,
      bool otherServices = false,
    }) => shopHomeLayout(
      isAdmin: isAdmin,
      hasBusinessDashboardAccess: dashboard,
      canUseInventory: inventory,
      hasServiceSections: otherServices,
    );

    test('staff or owner who may sell, in a shop: the shop home', () {
      expect(layout(), ShopHomeLayout.shopOnly);
    });

    test('Inventory alongside other services: Sell first, the rest below', () {
      expect(layout(otherServices: true), ShopHomeLayout.sellFirst);
    });

    test(
      'a customer, an admin, or staff without the permission: unchanged',
      () {
        expect(layout(dashboard: false), ShopHomeLayout.standard);
        expect(layout(isAdmin: true), ShopHomeLayout.standard);
        expect(layout(inventory: false), ShopHomeLayout.standard);
        expect(
          layout(inventory: false, otherServices: true),
          ShopHomeLayout.standard,
        );
      },
    );

    test('the inventory gate is inventoryAvailable, not a copy of it', () {
      // A customer has no business; staff without the permission and a
      // business without the service are refused by the same helper.
      bool can({
        List<String> services = const ['inventory'],
        bool permission = true,
        String businessId = 'b1',
      }) => inventoryAvailable(
        services: services,
        hasPermission: permission,
        businessId: businessId,
      );
      expect(can(), isTrue);
      expect(can(businessId: ''), isFalse);
      expect(can(permission: false), isFalse);
      expect(can(services: const ['carParking']), isFalse);
    });

    test('Sell in the bar: same gate, never for admins or a crowded bar', () {
      bool action({
        bool isAdmin = false,
        List<String> services = const ['inventory'],
        bool permission = true,
        String businessId = 'b1',
        int tabs = 3,
      }) => shopSellActionAvailable(
        isAdmin: isAdmin,
        services: services,
        hasInventoryPermission: permission,
        businessId: businessId,
        tabCount: tabs,
      );
      expect(action(), isTrue);
      expect(action(tabs: 4), isTrue);
      expect(action(tabs: 5), isFalse);
      expect(action(isAdmin: true), isFalse);
      expect(action(permission: false), isFalse);
      expect(action(businessId: ''), isFalse);
      expect(action(services: const ['carSales', 'carParking']), isFalse);
    });

    test('the raised action sits over its slot; an even bar is unchanged', () {
      // Three tabs at 390: four slots of 93.5 after the 8-point margins; the
      // action is the second slot, centred at 148.25.
      expect(
        AppBottomNav.raisedActionLeft(width: 390, itemCount: 3),
        moreOrLessEquals(148.25 - 29),
      );
      // Four tabs: the action is the middle of five slots - the middle of the
      // bar, where it has always been.
      expect(
        AppBottomNav.raisedActionLeft(width: 390, itemCount: 4),
        moreOrLessEquals(195 - 29),
      );
    });

    test('a shop is Inventory and nothing else', () {
      expect(businessIsShopOnly(const ['inventory']), isTrue);
      expect(businessIsShopOnly(const ['inventory', 'carParking']), isFalse);
      expect(businessIsShopOnly(const ['carParking']), isFalse);
      expect(businessIsShopOnly(const <String>[]), isFalse);
      expect(businessIsShopOnly(defaultBusinessServiceValues), isFalse);
    });
  });

  group('what the home reads', () {
    test("today's sales: today only, newest first, at most five", () {
      final sales = [
        for (var i = 0; i < 8; i++) _sale('s$i', minutesAgo: i * 10),
        _sale('y', minutesAgo: 60 * 20),
      ];
      final today = inventorySalesToday(sales.reversed, _now);
      expect(today.map((s) => s.id), ['s0', 's1', 's2', 's3', 's4']);
      expect(inventorySalesToday(const [], _now), isEmpty);
    });

    test('the numbers are read again only when the sales change', () {
      final a = [_sale('a', minutesAgo: 1)];
      final b = [_sale('a', minutesAgo: 1), _sale('b', minutesAgo: 2)];
      final aVoided = [_sale('a', minutesAgo: 1, voided: true)];
      expect(inventorySalesSignature(a), inventorySalesSignature(a));
      expect(inventorySalesSignature(a), isNot(inventorySalesSignature(b)));
      expect(
        inventorySalesSignature(a),
        isNot(inventorySalesSignature(aVoided)),
      );
    });

    test('sales scope: all stores, own store, wait, or none', () {
      final owner = InventoryStoreContext(stores: _stores);
      expect(
        inventorySalesScope(
          const InventoryAccess.owner(),
          owner,
          storesLoaded: false,
        ),
        (ready: true, none: false, storeId: ''),
      );
      const staffBk = InventoryAccess(homeStoreId: 's-bk');
      expect(
        inventorySalesScope(
          staffBk,
          InventoryStoreContext(access: staffBk),
          storesLoaded: false,
        ).ready,
        isFalse,
      );
      expect(
        inventorySalesScope(
          staffBk,
          InventoryStoreContext(stores: _stores, access: staffBk),
          storesLoaded: true,
        ),
        (ready: true, none: false, storeId: 's-bk'),
      );
      const noStore = InventoryAccess();
      expect(
        inventorySalesScope(
          noStore,
          InventoryStoreContext(stores: _stores, access: noStore),
          storesLoaded: true,
        ),
        (ready: true, none: true, storeId: ''),
      );
    });
  });

  group('the shop home section', () {
    testWidgets('Sell is on top and opens the counter in one tap', (
      tester,
    ) async {
      final calls = _Calls(summary: _summary);
      await _pumpSection(
        tester,
        _section(
          source: _FakeSource(sales: _todaySales()),
          calls: calls,
        ),
      );
      final sell = find.byKey(const Key('shop-sell'));
      expect(sell, findsOneWidget);
      // Above everything else: nothing to scroll past.
      final sellTop = tester.getTopLeft(sell).dy;
      expect(
        sellTop,
        lessThan(tester.getTopLeft(find.byKey(const Key('shop-today'))).dy),
      );
      expect(sellTop, lessThan(200));
      // Thumb-sized, full width.
      final size = tester.getSize(sell);
      expect(size.height, greaterThanOrEqualTo(56));
      expect(size.width, 390);
      expect(
        tester.getSemantics(sell),
        matchesSemantics(
          isButton: true,
          label: 'Sell. Scan a product tag',
          hasTapAction: true,
        ),
      );

      await tester.tap(sell);
      await tester.pumpAndSettle();
      final screen = tester.widget<InventorySellScreen>(
        find.byType(InventorySellScreen),
      );
      expect(screen.businessId, 'b1');
      expect(screen.access.isOwner, isTrue);
      expect(screen.startWithSearch, isFalse);
    });

    testWidgets('the store a staff member sells from goes with them', (
      tester,
    ) async {
      const staffBk = InventoryAccess(homeStoreId: 's-bk');
      final source = _FakeSource(stores: _stores, sales: _todaySales());
      await _pumpSection(
        tester,
        _section(source: source, calls: _Calls(), access: staffBk),
      );
      expect(find.text('Selling from Brooklyn'), findsOneWidget);
      // Their own store's sales only, once the stores were known.
      expect(source.salesStores, ['s-bk']);

      await tester.tap(find.byKey(const Key('shop-sell')));
      await tester.pumpAndSettle();
      final screen = tester.widget<InventorySellScreen>(
        find.byType(InventorySellScreen),
      );
      expect(screen.access.homeStoreId, 's-bk');
      expect(find.byKey(const Key('inv-sell-store-home')), findsOneWidget);
    });

    testWidgets('the owner of several stores sees all of them and picks', (
      tester,
    ) async {
      final source = _FakeSource(stores: _stores, sales: _todaySales());
      await _pumpSection(tester, _section(source: source, calls: _Calls()));
      expect(find.text('All stores'), findsOneWidget);
      expect(source.salesStores, ['']);
      await tester.tap(find.byKey(const Key('shop-sell')));
      await tester.pumpAndSettle();
      // The sell screen's own store choice, as from the Inventory screen.
      expect(find.byKey(const Key('inv-sell-store')), findsOneWidget);
    });

    testWidgets('a single store says nothing about stores', (tester) async {
      await _pumpSection(
        tester,
        _section(source: _FakeSource(), calls: _Calls()),
      );
      expect(find.byKey(const Key('shop-store-line')), findsNothing);
    });

    testWidgets('Enter code or search opens the counter on the search', (
      tester,
    ) async {
      await _pumpSection(
        tester,
        _section(source: _FakeSource(), calls: _Calls()),
      );
      await tester.tap(find.byKey(const Key('shop-enter-code')));
      await tester.pumpAndSettle();
      final screen = tester.widget<InventorySellScreen>(
        find.byType(InventorySellScreen),
      );
      expect(screen.startWithSearch, isTrue);
      final field = tester.widget<TextField>(find.byKey(const Key('inv-find')));
      expect(field.autofocus, isTrue);
    });

    testWidgets("today's numbers and the low-stock count", (tester) async {
      final calls = _Calls(summary: _summary);
      await _pumpSection(tester, _section(source: _FakeSource(), calls: calls));
      expect(calls.summaryRequests, hasLength(1));
      expect(calls.summaryRequests.single['range'], 'today');
      expect(calls.summaryRequests.single.containsKey('storeId'), isFalse);
      expect(
        tester.widget<Text>(find.byKey(const Key('shop-today-count'))).data,
        '12',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('shop-today-revenue'))).data,
        r'$1,284.50',
      );
      expect(find.text('3 products'), findsOneWidget);

      await tester.tap(find.byKey(const Key('shop-open-low')));
      await tester.pumpAndSettle();
      expect(find.text('Shea butter'), findsOneWidget);
      expect(find.text('0 in stock'), findsOneWidget);
    });

    testWidgets('numbers that never answer never hold Sell back', (
      tester,
    ) async {
      final calls = _Calls(hang: true);
      await _pump(
        tester,
        Scaffold(
          body: SingleChildScrollView(
            child: _section(source: _FakeSource(), calls: calls),
          ),
        ),
      );
      // Placeholders, not a spinner, and Sell works.
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.byKey(const Key('shop-today-count')), findsOneWidget);
      await tester.tap(find.byKey(const Key('shop-sell')));
      await tester.pumpAndSettle();
      expect(find.byType(InventorySellScreen), findsOneWidget);
      // The wait is bounded: the numbers give up after 20 seconds with a dash.
      await tester.pump(const Duration(seconds: 21));
      await tester.pumpAndSettle();
    });

    testWidgets('numbers that fail show a dash and a retry', (tester) async {
      final calls = _Calls(fail: true);
      await _pumpSection(tester, _section(source: _FakeSource(), calls: calls));
      expect(
        tester.widget<Text>(find.byKey(const Key('shop-today-count'))).data,
        '—',
      );
      expect(find.byKey(const Key('shop-today-retry')), findsOneWidget);
      await tester.tap(find.byKey(const Key('shop-today-retry')));
      await tester.pumpAndSettle();
      expect(calls.summaryRequests, hasLength(2));
    });

    testWidgets("today's sales: what, who, when, how much", (tester) async {
      await _pumpSection(
        tester,
        _section(
          source: _FakeSource(sales: _todaySales(), staff: _staff),
          calls: _Calls(summary: _summary),
        ),
      );
      expect(find.byKey(const Key('shop-sale-a')), findsOneWidget);
      expect(find.byKey(const Key('shop-sale-b')), findsOneWidget);
      expect(find.byKey(const Key('shop-sale-c')), findsOneWidget);
      expect(find.byKey(const Key('shop-sale-old')), findsNothing);
      expect(find.text('2 × Shea butter and 1 more'), findsOneWidget);
      expect(find.text(r'$38.50'), findsOneWidget);
      expect(find.textContaining('Aminata'), findsWidgets);
      expect(find.textContaining('Ibrahima'), findsOneWidget);
      expect(find.text('Voided'), findsOneWidget);

      await tester.tap(find.byKey(const Key('shop-sales-see-all')));
      await tester.pumpAndSettle();
      expect(find.byType(InventorySalesScreen), findsOneWidget);
    });

    testWidgets('sales that cannot load say so, and Sell still works', (
      tester,
    ) async {
      await _pumpSection(
        tester,
        _section(source: _FakeSource(salesFail: true), calls: _Calls()),
      );
      expect(
        find.text('Could not load the sales. Check your connection.'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('shop-sell')));
      await tester.pumpAndSettle();
      expect(find.byType(InventorySellScreen), findsOneWidget);
    });

    testWidgets('no sales yet today says how to make the first one', (
      tester,
    ) async {
      await _pumpSection(
        tester,
        _section(source: _FakeSource(), calls: _Calls()),
      );
      expect(
        find.text('No sales yet today. Scan a tag to make the first one.'),
        findsOneWidget,
      );
    });

    testWidgets('the quick links open Products and Sales', (tester) async {
      await _pumpSection(
        tester,
        _section(source: _FakeSource(), calls: _Calls()),
      );
      expect(find.byKey(const Key('shop-open-products')), findsOneWidget);
      expect(find.byKey(const Key('shop-open-sales')), findsOneWidget);
      expect(find.byKey(const Key('shop-open-low')), findsOneWidget);
      expect(find.byKey(const Key('shop-add-product')), findsOneWidget);
      for (final key in [
        'shop-open-products',
        'shop-open-sales',
        'shop-open-low',
        'shop-add-product',
      ]) {
        final size = tester.getSize(find.byKey(Key(key)));
        expect(size.height, greaterThanOrEqualTo(48), reason: key);
      }
      await tester.tap(find.byKey(const Key('shop-open-products')));
      await tester.pumpAndSettle();
      expect(find.byType(InventoryScreen), findsOneWidget);
    });

    testWidgets('pending approval is a calm note that says selling works', (
      tester,
    ) async {
      await _pumpSection(
        tester,
        _section(
          source: _FakeSource(),
          calls: _Calls(),
          approvalStatus: 'pending',
        ),
      );
      expect(
        find.text('Pending approval · You can already sell'),
        findsOneWidget,
      );
      expect(find.textContaining('destinations, cars'), findsNothing);
    });

    testWidgets('approved shows no note', (tester) async {
      await _pumpSection(
        tester,
        _section(
          source: _FakeSource(),
          calls: _Calls(),
          approvalStatus: 'approved',
        ),
      );
      expect(find.byKey(const Key('shop-approval-note')), findsNothing);
    });

    testWidgets('alongside other services, no second activity list', (
      tester,
    ) async {
      await _pumpSection(
        tester,
        _section(
          source: _FakeSource(sales: _todaySales()),
          calls: _Calls(),
          showTodaySales: false,
        ),
      );
      expect(find.byKey(const Key('shop-sell')), findsOneWidget);
      expect(find.byKey(const Key('shop-today-sales')), findsNothing);
    });

    for (final (label, locale, size, scale) in [
      (
        'French, 320 wide, text at 130%',
        const Locale('fr'),
        const Size(320, 640),
        1.3,
      ),
      (
        'English, 320 wide, text at 130%',
        const Locale('en'),
        const Size(320, 640),
        1.3,
      ),
      ('French, 390 wide', const Locale('fr'), const Size(390, 844), 1.0),
    ]) {
      testWidgets('$label: everything fits and Sell is on screen', (
        tester,
      ) async {
        await _pump(
          tester,
          _screen(
            _section(
              source: _FakeSource(
                sales: _todaySales(),
                stores: _stores,
                staff: _staff,
              ),
              calls: _Calls(summary: _summary),
              access: const InventoryAccess(homeStoreId: 's-bk'),
              approvalStatus: 'changes_requested',
            ),
            (c) => AppLocalizations.of(c)!,
          ),
          locale: locale,
          size: size,
          textScale: scale,
          padding: const EdgeInsets.only(top: 20, bottom: 0),
        );
        // Any RenderFlex overflow would have failed the pump.
        expect(tester.takeException(), isNull);
        final sell = tester.getRect(find.byKey(const Key('shop-sell')));
        expect(
          sell.bottom,
          lessThan(size.height - 90),
          reason: 'above the bar',
        );
        // The bar's raised Sell sits over its own label, not between tabs.
        final bar = find.byType(AppBottomNav);
        final button = find.descendant(
          of: bar,
          matching: find.byIcon(Icons.qr_code_scanner_rounded),
        );
        final label = find.descendant(
          of: bar,
          matching: find.text(locale.languageCode == 'fr' ? 'Vendre' : 'Sell'),
        );
        expect(
          tester.getCenter(button).dx,
          moreOrLessEquals(tester.getCenter(label).dx, epsilon: 1),
        );
        if (locale.languageCode == 'fr') {
          expect(find.text('Vendre'), findsWidgets);
          expect(find.text('Saisir un code ou rechercher'), findsOneWidget);
        }
        // The rest scrolls into view without overflowing either.
        await tester.scrollUntilVisible(
          find.byKey(const Key('shop-sales-see-all')),
          200,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('the home and the shell use it', () {
    String read(String path) => File(path).readAsStringSync();

    test('the home picks its layout from the one gate', () {
      final home = read('lib/screens/home_menu.dart');
      expect(home, contains('shopHomeLayout('));
      expect(home, contains('canUseInventory: inventoryAvailable('));
      expect(home, contains('isAdmin: auth.isAdmin'));
      // The hero only for someone who may sell; the shop's own "More" only
      // for a shop; the long-standing sections for everyone else.
      final hero = home.indexOf('ShopHomeSection(');
      final gate = home.lastIndexOf(
        'if (layout == ShopHomeLayout.standard) ...[',
        hero,
      );
      expect(gate, greaterThan(0));
      // The standard top row first, the hero only in the else branch.
      expect(home.substring(gate, hero), contains('] else ...['));
      final more = home.indexOf('_ShopMoreSection(l10n: l10n)');
      final services = home.indexOf('_ServicesSection(', more);
      final activity = home.indexOf('_ActivitySection(', services);
      expect(more, greaterThan(hero));
      expect(services, greaterThan(more));
      expect(activity, greaterThan(services));
      expect(home.substring(more, services), contains('else ...['));
    });

    test('non-shop homes keep every section they had', () {
      final home = read('lib/screens/home_menu.dart');
      for (final key in [
        "Key('service-overview-grid')",
        "Key('record-parked-car')",
        "Key('open-lot-ledger')",
        "Key('open-containers')",
        "Key('open-inventory')",
        "Key('open-invoices')",
        "Key('open-transport-jobs')",
        "Key('business-tool-\${tool.key}')",
        "Key('open-business-assistant')",
        "Key('activity-load-history')",
        'l10n.recentActivity',
        'l10n.openBusinessConsole',
      ]) {
        expect(home, contains(key), reason: key);
      }
    });

    test('a shop no longer reads "no services are switched on"', () {
      final home = read('lib/screens/home_menu.dart');
      final empty = home.indexOf('emptyText:');
      expect(empty, greaterThan(0));
      final choice = home.substring(empty, empty + 400);
      expect(choice, contains('BusinessServiceKey.inventory'));
      expect(choice, contains('l10n.shopHomeNoInventoryAccess'));
      expect(choice, contains('l10n.businessServiceOverviewEmpty'));
      // The shop's "More" carries every tool and place the card had.
      final more = home.substring(home.indexOf('class _ShopMoreSection'));
      expect(more, contains('_businessDestinations('));
      expect(more, contains('_businessTools('));
      expect(more, contains('AsyncActionButton.outlined('));
      expect(more, contains('BusinessAssistantScreen('));
    });

    test('the shell keeps the banner for everyone but a shop', () {
      final shell = read('lib/screens/staff_home_screen.dart');
      expect(shell, contains('businessIsShopOnly(services)'));
      expect(shell, contains('business == null || shopOnly'));
      expect(shell, contains('_PendingBusinessBanner.fromBusiness(business)'));
      expect(
        shell,
        contains('HomeMenu(shopApprovalStatus: shopApprovalStatus)'),
      );
      expect(shell, contains('shopSellActionAvailable('));
      // The bar's Sell opens the same counter, with the person's stores.
      expect(shell, contains('InventorySellScreen('));
      expect(shell, contains('access: auth.inventoryAccess'));
      // Not the customer car-selling route.
      expect(shell, isNot(contains("'/sell'")));
    });

    test('every new string is in English and French', () {
      final en = read('lib/l10n/app_en.arb');
      final fr = read('lib/l10n/app_fr.arb');
      final keys = RegExp(
        r'"(shopHome[A-Za-z]+)":',
      ).allMatches(en).map((m) => m[1]!).toSet();
      expect(keys, isNotEmpty);
      for (final key in keys) {
        expect(fr, contains('"$key":'), reason: key);
      }
      for (final path in [
        'lib/screens/shop_home_section.dart',
        'lib/services/shop_home.dart',
      ]) {
        final src = read(path);
        // No hardcoded user-facing text in a Text widget.
        expect(
          RegExp(r"Text\(\s*'[A-Za-z]").hasMatch(src),
          isFalse,
          reason: path,
        );
      }
    });
  });
}

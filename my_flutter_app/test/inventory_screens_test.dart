import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/inventory_categories_screen.dart';
import 'package:my_flutter_app/screens/inventory_item_screen.dart';
import 'package:my_flutter_app/screens/inventory_item_sheets.dart';
import 'package:my_flutter_app/screens/inventory_sales_screen.dart';
import 'package:my_flutter_app/screens/inventory_screen.dart';
import 'package:my_flutter_app/screens/inventory_sell_screen.dart';
import 'package:my_flutter_app/screens/inventory_stores_screen.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/services/package_link_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/utils/date_display.dart';

/// The inventory screens as staff meet them: the counter (scan, basket, price
/// and quantity edits, Sold, the count-was-off warning, a lost connection that
/// keeps the basket), the product form, the sales list with its void
/// confirmation, the products list and a product's page. Firebase and the
/// camera are replaced: scans come from a stream, the data from a fake source
/// and the callables from a recording caller.

InventoryItem _item(
  String id,
  String code, {
  String name = '',
  int price = 450,
  int quantity = 10,
  int? lowStockAt,
  bool archived = false,
  bool countWasOff = false,
  String businessId = 'b1',
  String category = '',
  String categoryId = '',
}) =>
    InventoryItem(
      id: id,
      businessId: businessId,
      name: name.isEmpty ? 'Item $id' : name,
      code: code,
      priceCents: price,
      quantity: quantity,
      lowStockAt: lowStockAt,
      archived: archived,
      countWasOff: countWasOff,
      category: category,
      categoryId: categoryId,
    );

final _soap = _item('i1', 'IT-K7M4P2', name: 'Soap');
final _oil = _item('i2', 'IT-CCCCCC', name: 'Palm oil', price: 1200);
final _old = _item('i3', 'IT-DDDDDD', name: 'Old tin', archived: true);
final _foreign =
    _item('i9', 'IT-FFFFFF', name: 'Their stuff', businessId: 'other');

const _mainStore = InventoryStore(id: 's-main', name: 'Main store');
const _stores = [_mainStore, InventoryStore(id: 's-bk', name: 'Brooklyn')];
const _staffBk = InventoryAccess(homeStoreId: 's-bk');
const _categories = [
  InventoryCategory(id: 'c1', name: 'Body'),
  InventoryCategory(id: 'c2', name: 'Hair'),
];

/// Soap (i1): 8 in Main store, 2 in Brooklyn (10 in all). Palm oil (i2): 5 and 5.
const _stockRows = [
  InventoryStockRow(itemId: 'i1', storeId: 's-main', quantity: 8),
  InventoryStockRow(itemId: 'i1', storeId: 's-bk', quantity: 2),
  InventoryStockRow(itemId: 'i2', storeId: 's-main', quantity: 5),
  InventoryStockRow(itemId: 'i2', storeId: 's-bk', quantity: 5),
];

String _link(String code) => 'https://customer.laawoldigital.com/i/$code';

class _FakeSource implements InventorySource {
  _FakeSource({
    this.items = const [],
    this.sales = const [],
    this.movements = const [],
    this.staff = const [],
    this.itemsFail = false,
    this.categories = const [],
    this.stores = const [],
    this.stock = const [],
  });

  final List<InventoryItem> items;
  final List<InventorySale> sales;
  final List<InventoryMovement> movements;
  final List<LotStaff> staff;
  final bool itemsFail;
  final List<InventoryCategory> categories;
  final List<InventoryStore> stores;
  final List<InventoryStockRow> stock;
  final List<String> codeLookups = [];

  /// What the screens asked for, so a test can say who read what.
  final List<String> salesStores = [];
  final List<String> stockStores = [];
  final List<String> movementStores = [];

  @override
  Stream<List<InventoryItem>> watchItems(String businessId) => itemsFail
      ? Stream.error(StateError('denied'))
      : Stream.value([
          for (final i in items)
            if (i.businessId == businessId) i,
        ]);

  @override
  Future<InventoryItem?> findItemByCode(String businessId, String code) async {
    codeLookups.add(code);
    for (final i in items) {
      if (i.businessId == businessId && i.code == code) return i;
    }
    return null;
  }

  @override
  Stream<List<InventorySale>> watchSales(
    String businessId, {
    required int limit,
    String storeId = '',
  }) {
    salesStores.add(storeId);
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
  }) {
    movementStores.add(storeId);
    return Stream.value([
      for (final m in movements)
        if (m.itemId == itemId && (storeId.isEmpty || m.storeId == storeId)) m,
    ]);
  }

  @override
  Stream<List<InventoryCategory>> watchCategories(String businessId) =>
      Stream.value(categories);

  @override
  Stream<List<InventoryStore>> watchStores(String businessId) =>
      Stream.value(stores);

  @override
  Stream<List<InventoryStockRow>> watchStock(
    String businessId, {
    String storeId = '',
  }) {
    stockStores.add(storeId);
    return Stream.value([
      for (final r in stock)
        if (storeId.isEmpty || r.storeId == storeId) r,
    ]);
  }

  @override
  Stream<List<LotStaff>> watchStaff(String businessId) => Stream.value(staff);
}

class _Calls {
  final List<({String name, Map<String, Object?> payload})> log = [];
  Object? Function(String name, Map<String, Object?> payload)? respond;

  InventoryService get service => InventoryService(caller: (name, payload) async {
        log.add((name: name, payload: payload));
        final answer = respond;
        return answer == null ? <String, Object?>{} : answer(name, payload);
      });

  List<({String name, Map<String, Object?> payload})> named(String name) =>
      [for (final c in log) if (c.name == name) c];
}

FirebaseFunctionsException _offline() =>
    FirebaseFunctionsException(message: 'offline', code: 'unavailable');

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(400, 2400),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: child,
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _openSheet(
  WidgetTester tester,
  Future<Object?> Function(BuildContext context) open, {
  Locale locale = const Locale('en'),
  Size size = const Size(400, 2400),
}) async {
  await _pump(
    tester,
    Builder(
      builder: (context) => Scaffold(
        body: TextButton(
          key: const Key('open-sheet'),
          onPressed: () => open(context),
          child: const Text('open'),
        ),
      ),
    ),
    locale: locale,
    size: size,
  );
  await tester.tap(find.byKey(const Key('open-sheet')));
  await tester.pumpAndSettle();
}

Widget _sell(
  _FakeSource source,
  _Calls calls,
  StreamController<String> scans, {
  String initialCode = '',
  InventoryAccess access = const InventoryAccess.owner(),
}) {
  var n = 0;
  return InventorySellScreen(
    access: access,
    businessId: 'b1',
    source: source,
    service: calls.service,
    newRequestId: () => 'req-${++n}',
    cameraEnabled: false,
    scans: scans.stream,
    initialCode: initialCode,
  );
}

Future<void> _scan(WidgetTester tester, StreamController<String> scans, String raw) async {
  scans.add(raw);
  await tester.pumpAndSettle();
}

String _qtyText(WidgetTester tester, String id) => tester
    .widget<TextField>(find.byKey(Key('inv-qty-$id')))
    .controller!
    .text;

String _totalText(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('inv-total'))).data!;

void main() {
  late StreamController<String> scans;

  setUp(() => scans = StreamController<String>.broadcast());
  tearDown(() => scans.close());

  group('sell screen', () {
    testWidgets('a scan adds the product with quantity 1, a second scan adds one',
        (tester) async {
      final source = _FakeSource(items: [_soap, _oil]);
      await _pump(tester, _sell(source, _Calls(), scans));
      expect(find.byKey(const Key('inv-basket-empty')), findsOneWidget);

      await _scan(tester, scans, _link('IT-K7M4P2'));
      expect(find.byKey(const Key('inv-line-i1')), findsOneWidget);
      expect(_qtyText(tester, 'i1'), '1');
      expect(_totalText(tester), r'$4.50');
      expect(find.text('Added Soap'), findsOneWidget);

      await _scan(tester, scans, _link('IT-K7M4P2'));
      expect(find.byKey(const Key('inv-line-i1')), findsOneWidget);
      expect(_qtyText(tester, 'i1'), '2');
      expect(_totalText(tester), r'$9.00');

      await _scan(tester, scans, 'IT-CCCCCC');
      expect(_qtyText(tester, 'i2'), '1');
      expect(_totalText(tester), r'$21.00');
      // Found in the stream already loaded: no query per scan.
      expect(source.codeLookups, isEmpty);
    });

    testWidgets('leaving with items in the basket asks first; staying keeps it',
        (tester) async {
      final source = _FakeSource(items: [_soap, _oil]);
      await _pump(
        tester,
        Builder(
          builder: (context) => Center(
            child: ElevatedButton(
              key: const Key('open-sell'),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => _sell(source, _Calls(), scans),
              )),
              child: const Text('open'),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open-sell')));
      await tester.pumpAndSettle();

      // Nothing in the basket: back leaves without a question.
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-basket-empty')), findsNothing);
      expect(find.text('Leave without selling?'), findsNothing);

      await tester.tap(find.byKey(const Key('open-sell')));
      await tester.pumpAndSettle();
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Leave without selling?'), findsOneWidget);

      await tester.tap(find.text('Stay'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-line-i1')), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Empty the basket and leave'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-line-i1')), findsNothing);
      expect(find.byKey(const Key('open-sell')), findsOneWidget);
    });

    testWidgets('a tag from another shop, an unknown tag, an archived product '
        'and a foreign QR each say so and add nothing', (tester) async {
      final source = _FakeSource(items: [_soap, _old, _foreign]);
      await _pump(tester, _sell(source, _Calls(), scans));

      await _scan(tester, scans, _link('IT-FFFFFF'));
      expect(find.text('That tag is not one of your products.'), findsOneWidget);
      expect(find.byKey(const Key('inv-basket-empty')), findsOneWidget);

      await _scan(tester, scans, _link('IT-GGGGGG'));
      expect(find.text('That tag is not one of your products.'), findsOneWidget);
      // An unknown code is asked of the database once.
      expect(source.codeLookups, contains('IT-GGGGGG'));

      await _scan(tester, scans, _link('IT-DDDDDD'));
      expect(find.text('Old tin is archived. Restore it to sell it.'),
          findsOneWidget);
      expect(find.byKey(const Key('inv-basket-empty')), findsOneWidget);

      await _scan(tester, scans, 'https://example.com/i/IT-K7M4P2');
      expect(find.text('That QR code is not a Laawol product tag.'),
          findsOneWidget);
      expect(find.byKey(const Key('inv-basket-empty')), findsOneWidget);
    });

    testWidgets('a tag that will not scan is typed, or found by name',
        (tester) async {
      final source = _FakeSource(items: [_soap, _oil]);
      await _pump(tester, _sell(source, _Calls(), scans));

      await tester.enterText(find.byKey(const Key('inv-find')), 'it k7m4p2');
      await tester.pump();
      expect(find.text('Add IT-K7M4P2'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-add-code')));
      await tester.pumpAndSettle();
      expect(_qtyText(tester, 'i1'), '1');
      expect(
          tester.widget<TextField>(find.byKey(const Key('inv-find'))).controller!.text,
          isEmpty);

      await tester.enterText(find.byKey(const Key('inv-find')), 'palm');
      await tester.pump();
      expect(find.byKey(const ValueKey('inv-hit-i2')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-hit-i1')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('inv-hit-i2')));
      await tester.pumpAndSettle();
      expect(_qtyText(tester, 'i2'), '1');
      expect(_totalText(tester), r'$16.50');
    });

    testWidgets('a link that opened the screen adds its tag', (tester) async {
      final source = _FakeSource(items: [_soap]);
      await _pump(
        tester,
        _sell(source, _Calls(), scans, initialCode: 'IT-K7M4P2'),
      );
      expect(_qtyText(tester, 'i1'), '1');
    });

    testWidgets('quantity and price are editable per line; the list price '
        'stays visible and the total follows', (tester) async {
      final source = _FakeSource(items: [_soap]);
      await _pump(tester, _sell(source, _Calls(), scans));
      await _scan(tester, scans, 'IT-K7M4P2');
      expect(find.text('IT-K7M4P2 · List \$4.50'), findsOneWidget);

      await tester.tap(find.byKey(const Key('inv-qty-up-i1')));
      await tester.pumpAndSettle();
      expect(_qtyText(tester, 'i1'), '2');
      await tester.enterText(find.byKey(const Key('inv-qty-i1')), '4');
      await tester.pump();
      expect(_totalText(tester), r'$18.00');

      await tester.enterText(find.byKey(const Key('inv-price-i1')), '4');
      await tester.pump();
      expect(_totalText(tester), r'$16.00');
      expect(find.byKey(const Key('inv-discount')), findsOneWidget);
      expect(find.text(r'$2.00 off list prices'), findsOneWidget);
      // The list price is still shown beside the changed price.
      expect(find.text('IT-K7M4P2 · List \$4.50'), findsOneWidget);
      expect(find.byKey(const Key('inv-line-total-i1')), findsOneWidget);

      await tester.tap(find.byKey(const Key('inv-qty-down-i1')));
      await tester.pumpAndSettle();
      expect(_qtyText(tester, 'i1'), '3');
      expect(_totalText(tester), r'$12.00');
    });

    testWidgets('an unreadable price blocks Sold until it is fixed',
        (tester) async {
      final calls = _Calls();
      await _pump(tester, _sell(_FakeSource(items: [_soap]), calls, scans));
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.enterText(find.byKey(const Key('inv-price-i1')), 'abc');
      await tester.pump();
      expect(find.text('Enter a price like 12.50.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);
      await tester.enterText(find.byKey(const Key('inv-price-i1')), '4.00');
      await tester.pump();
      expect(find.text('Enter a price like 12.50.'), findsNothing);
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(calls.named('recordInventorySale'), hasLength(1));
    });

    testWidgets('a line is removed, and an empty basket has no Sold bar',
        (tester) async {
      await _pump(tester, _sell(_FakeSource(items: [_soap]), _Calls(), scans));
      await _scan(tester, scans, 'IT-K7M4P2');
      expect(find.byKey(const Key('inv-sold')), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-remove-i1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-line-i1')), findsNothing);
      expect(find.byKey(const Key('inv-sold')), findsNothing);
      expect(find.byKey(const Key('inv-basket-empty')), findsOneWidget);
    });

    testWidgets('Sold records the sale with the right payload and says so',
        (tester) async {
      final calls = _Calls()
        ..respond = (name, payload) => {
              'saleId': 'sale-1',
              'totalCents': 1350,
              'warnings': <Object>[],
            };
      await _pump(
        tester,
        _sell(_FakeSource(items: [_soap, _oil]), calls, scans),
      );
      await _scan(tester, scans, 'IT-K7M4P2');
      await _scan(tester, scans, 'IT-K7M4P2');
      await _scan(tester, scans, 'IT-CCCCCC');
      await tester.enterText(find.byKey(const Key('inv-price-i2')), '10');
      await tester.pump();

      await tester.tap(find.byKey(const Key('inv-payment')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Zelle'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();

      final sale = calls.named('recordInventorySale').single.payload;
      expect(sale, {
        'businessId': 'b1',
        'clientRequestId': 'req-1',
        'paymentMethod': 'zelle',
        'lines': [
          {'itemId': 'i1', 'quantity': 2, 'soldPriceCents': 450},
          {'itemId': 'i2', 'quantity': 1, 'soldPriceCents': 1000},
        ],
      });
      expect(find.byKey(const Key('inv-sale-done')), findsOneWidget);
      expect(find.text(r'$13.50 recorded.'), findsOneWidget);
      expect(find.byKey(const Key('inv-sold')), findsNothing);
      expect(find.text(r'2 × Soap at $4.50'), findsOneWidget);

      // The next sale starts clean and gets its own request id.
      await tester.tap(find.byKey(const Key('inv-new-sale')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-basket-empty')), findsOneWidget);
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(calls.named('recordInventorySale').last.payload['clientRequestId'],
          'req-2');
    });

    testWidgets('a sale the count could not cover shows the count-was-off warning',
        (tester) async {
      final calls = _Calls()
        ..respond = (name, payload) => {
              'saleId': 'sale-1',
              'totalCents': 1350,
              'warnings': [
                {'itemId': 'i1', 'reason': 'count_was_off'},
              ],
            };
      final low = _item('i1', 'IT-K7M4P2', name: 'Soap', quantity: 1);
      await _pump(tester, _sell(_FakeSource(items: [low]), calls, scans));
      await _scan(tester, scans, 'IT-K7M4P2');
      await _scan(tester, scans, 'IT-K7M4P2');
      // Before selling: a heads-up, not a stop.
      expect(find.byKey(const Key('inv-exceeds-i1')), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('inv-warning-i1')), findsOneWidget);
      expect(find.textContaining('Count was off for Soap'), findsOneWidget);
    });

    testWidgets('a lost connection keeps the basket and a retry sends the '
        'same request id', (tester) async {
      var fail = true;
      final calls = _Calls()
        ..respond = (name, payload) {
          if (fail) throw _offline();
          return {'saleId': 'sale-1', 'totalCents': 450, 'warnings': <Object>[]};
        };
      await _pump(tester, _sell(_FakeSource(items: [_soap]), calls, scans));
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('inv-sale-error')), findsOneWidget);
      expect(find.textContaining('No connection'), findsOneWidget);
      // The basket is exactly as it was, and Sold is available again.
      expect(find.byKey(const Key('inv-line-i1')), findsOneWidget);
      expect(_qtyText(tester, 'i1'), '1');
      expect(_totalText(tester), r'$4.50');
      expect(find.byKey(const Key('inv-sale-done')), findsNothing);

      fail = false;
      await tester.tap(find.byKey(const Key('inv-retry')));
      await tester.pumpAndSettle();
      final ids = [
        for (final c in calls.named('recordInventorySale'))
          c.payload['clientRequestId'],
      ];
      expect(ids, ['req-1', 'req-1']);
      expect(find.byKey(const Key('inv-sale-done')), findsOneWidget);
    });

    testWidgets('changing the basket after a failure is a different sale',
        (tester) async {
      var fail = true;
      final calls = _Calls()
        ..respond = (name, payload) {
          if (fail) throw _offline();
          return {'saleId': 's', 'totalCents': 900, 'warnings': <Object>[]};
        };
      await _pump(tester, _sell(_FakeSource(items: [_soap]), calls, scans));
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      fail = false;
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect([
        for (final c in calls.named('recordInventorySale'))
          c.payload['clientRequestId'],
      ], ['req-1', 'req-2']);
    });

    testWidgets('a product the server refuses as archived is named, no retry',
        (tester) async {
      final calls = _Calls()
        ..respond = (name, payload) => throw FirebaseFunctionsException(
              message: 'archived',
              code: 'failed-precondition',
              details: {'reason': 'item_archived'},
            );
      await _pump(tester, _sell(_FakeSource(items: [_soap]), calls, scans));
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(find.textContaining('is archived. Remove it and try again'),
          findsOneWidget);
      expect(find.byKey(const Key('inv-retry')), findsNothing);
      expect(find.byKey(const Key('inv-line-i1')), findsOneWidget);
    });

    testWidgets('French at 320 wide: no overflow with a long name and error',
        (tester) async {
      final long = _item('i1', 'IT-K7M4P2',
          name: 'Beurre de karité biologique non raffiné, pot de 250 ml',
          quantity: 1);
      final calls = _Calls()..respond = (name, payload) => throw _offline();
      await _pump(
        tester,
        _sell(_FakeSource(items: [long]), calls, scans),
        locale: const Locale('fr'),
        size: const Size(320, 700),
      );
      expect(find.text('Rien de scanné pour le moment'), findsOneWidget);
      await _scan(tester, scans, 'IT-K7M4P2');
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.enterText(find.byKey(const Key('inv-price-i1')), '3');
      await tester.pump();
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(find.text('Vendu'), findsOneWidget);
      expect(find.textContaining('Pas de connexion'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('product form', () {
    Future<void> openForm(
      WidgetTester tester,
      _Calls calls, {
      InventoryItem? existing,
      Locale locale = const Locale('en'),
      Size size = const Size(400, 2400),
      List<InventoryCategory> categories = const [],
      InventoryStoreContext? stores,
    }) =>
        _openSheet(
          tester,
          (context) => showInventoryItemForm(
            context,
            businessId: 'b1',
            existing: existing,
            service: calls.service,
            categories: categories,
            stores: stores,
          ),
          locale: locale,
          size: size,
        );

    testWidgets('an empty form is refused at the fields; nothing is sent',
        (tester) async {
      final calls = _Calls();
      await openForm(tester, calls);
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      expect(find.text('Enter a name.'), findsOneWidget);
      expect(find.text('Enter a price above zero, like 12.50.'), findsOneWidget);
      expect(find.text('Enter a whole number, zero or more.'), findsOneWidget);
      expect(calls.log, isEmpty);
    });

    testWidgets('a valid form creates the product with the typed values',
        (tester) async {
      final calls = _Calls()
        ..respond = (name, payload) => {'itemId': 'new1', 'code': 'IT-HHHHHH'};
      await openForm(tester, calls, categories: const [
        InventoryCategory(id: 'c1', name: 'Body'),
        InventoryCategory(id: 'c2', name: 'Hair'),
      ]);
      await tester.enterText(find.byKey(const Key('inv-field-name')), 'Shea butter');
      await tester.enterText(find.byKey(const Key('inv-field-price')), '12,50');
      await tester.enterText(find.byKey(const Key('inv-field-cost')), '8');
      await tester.enterText(find.byKey(const Key('inv-field-quantity')), '24');
      await tester.enterText(find.byKey(const Key('inv-field-low')), '5');
      await tester.ensureVisible(find.byKey(const Key('inv-field-category')));
      await tester.tap(find.byKey(const Key('inv-field-category')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Body'));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const Key('inv-field-photo')), 'https://example.com/a.jpg');
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();

      expect(calls.named('createInventoryItem').single.payload, {
        'businessId': 'b1',
        'name': 'Shea butter',
        'priceCents': 1250,
        'costCents': 800,
        'quantity': 24,
        'lowStockAt': 5,
        'categoryId': 'c1',
        'photoUrl': 'https://example.com/a.jpg',
      });
      // The sheet closed.
      expect(find.byKey(const Key('inv-form-save')), findsNothing);
    });

    testWidgets('a bad photo link and a cost are refused with their own words',
        (tester) async {
      final calls = _Calls();
      await openForm(tester, calls);
      await tester.enterText(find.byKey(const Key('inv-field-name')), 'Soap');
      await tester.enterText(find.byKey(const Key('inv-field-price')), '4');
      await tester.enterText(find.byKey(const Key('inv-field-quantity')), '1');
      await tester.enterText(find.byKey(const Key('inv-field-cost')), 'x');
      await tester.enterText(find.byKey(const Key('inv-field-photo')), 'soap.png');
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      expect(find.text('Enter a cost like 8.00, or leave it blank.'),
          findsOneWidget);
      expect(find.text('Enter a full link starting with https://.'),
          findsOneWidget);
      expect(calls.log, isEmpty);
    });

    testWidgets('editing has no count field and sends only what changed',
        (tester) async {
      final calls = _Calls();
      final existing = _item('i1', 'IT-K7M4P2', name: 'Soap', price: 450);
      await openForm(tester, calls, existing: existing);
      expect(find.byKey(const Key('inv-field-quantity')), findsNothing);
      expect(find.byKey(const Key('inv-quantity-help')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('inv-field-price')), '5');
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      expect(calls.named('updateInventoryItem').single.payload, {
        'businessId': 'b1',
        'itemId': 'i1',
        'priceCents': 500,
      });
    });

    testWidgets('a refusal shows in the sheet and the form stays', (tester) async {
      final calls = _Calls()..respond = (name, payload) => throw _offline();
      await openForm(tester, calls);
      await tester.enterText(find.byKey(const Key('inv-field-name')), 'Soap');
      await tester.enterText(find.byKey(const Key('inv-field-price')), '4');
      await tester.enterText(find.byKey(const Key('inv-field-quantity')), '1');
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-form-error')), findsOneWidget);
      expect(find.byKey(const Key('inv-form-save')), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(const Key('inv-field-name'))).controller!.text,
          'Soap');
    });

    testWidgets('French at 320 wide shows every field without overflow',
        (tester) async {
      await openForm(tester, _Calls(),
          locale: const Locale('fr'), size: const Size(320, 700));
      expect(find.text('Nouveau produit'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      expect(find.text('Saisissez un nom.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('stock and tags', () {
    testWidgets('adding stock sends a positive whole number; zero is refused',
        (tester) async {
      final calls = _Calls()..respond = (n, p) => {'quantity': 15};
      await _openSheet(
        tester,
        (context) => showInventoryStockSheet(context,
            businessId: 'b1', item: _soap, add: true, service: calls.service),
      );
      await tester.enterText(find.byKey(const Key('inv-stock-quantity')), '0');
      await tester.tap(find.byKey(const Key('inv-stock-save')));
      await tester.pumpAndSettle();
      expect(find.text('Enter a whole number of at least 1.'), findsOneWidget);
      expect(calls.log, isEmpty);

      await tester.enterText(find.byKey(const Key('inv-stock-quantity')), '5');
      await tester.enterText(find.byKey(const Key('inv-stock-note')), 'new box');
      await tester.tap(find.byKey(const Key('inv-stock-save')));
      await tester.pumpAndSettle();
      expect(calls.named('adjustInventoryStock').single.payload, {
        'businessId': 'b1',
        'itemId': 'i1',
        'mode': 'add',
        'quantity': 5,
        'note': 'new box',
      });
    });

    testWidgets('setting the count starts from the current count and may be zero',
        (tester) async {
      final calls = _Calls();
      await _openSheet(
        tester,
        (context) => showInventoryStockSheet(context,
            businessId: 'b1', item: _soap, add: false, service: calls.service),
      );
      expect(
          tester
              .widget<TextField>(find.byKey(const Key('inv-stock-quantity')))
              .controller!
              .text,
          '10');
      await tester.enterText(find.byKey(const Key('inv-stock-quantity')), '0');
      await tester.tap(find.byKey(const Key('inv-stock-save')));
      await tester.pumpAndSettle();
      final call = calls.named('adjustInventoryStock').single.payload;
      expect(call['mode'], 'set');
      expect(call['quantity'], 0);
    });

    testWidgets('printing tags asks for 1 to 500 copies of the same code',
        (tester) async {
      final opened = <int>[];
      await _openSheet(
        tester,
        (context) => showInventoryTagSheet(
          context,
          businessId: 'b1',
          item: _soap,
          opener: ({required businessId, required itemId, required copies}) async {
            expect(itemId, 'i1');
            opened.add(copies);
          },
        ),
      );
      await tester.enterText(find.byKey(const Key('inv-tags-copies')), '501');
      await tester.tap(find.byKey(const Key('inv-tags-open')));
      await tester.pumpAndSettle();
      expect(find.text('Enter a whole number from 1 to 500.'), findsOneWidget);
      expect(opened, isEmpty);
      await tester.enterText(find.byKey(const Key('inv-tags-copies')), '12');
      await tester.tap(find.byKey(const Key('inv-tags-open')));
      await tester.pumpAndSettle();
      expect(opened, [12]);
    });

    testWidgets('tags that cannot open say so and stay', (tester) async {
      await _openSheet(
        tester,
        (context) => showInventoryTagSheet(
          context,
          businessId: 'b1',
          item: _soap,
          opener: ({required businessId, required itemId, required copies}) async =>
              throw StateError('no'),
        ),
      );
      await tester.tap(find.byKey(const Key('inv-tags-open')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-tags-error')), findsOneWidget);
    });
  });

  group('sales list', () {
    final sale = InventorySale(
      id: 's1',
      businessId: 'b1',
      lines: const [
        InventorySaleLine(
          itemId: 'i1',
          name: 'Soap',
          code: 'IT-K7M4P2',
          quantity: 2,
          listPriceCents: 450,
          soldPriceCents: 400,
        ),
      ],
      totalCents: 800,
      paymentMethod: 'cash',
      soldByStaffId: 'u1',
      createdAt: DateTime(2026, 10, 10, 15, 5),
    );
    final voided = InventorySale(
      id: 's2',
      businessId: 'b1',
      lines: const [
        InventorySaleLine(
          itemId: 'i2',
          name: 'Palm oil',
          code: 'IT-CCCCCC',
          quantity: 1,
          listPriceCents: 1200,
          soldPriceCents: 1200,
        ),
      ],
      totalCents: 1200,
      paymentMethod: 'zelle',
      soldByStaffId: 'u1',
      voided: true,
      voidedByStaffId: 'u2',
      voidedAt: DateTime(2026, 10, 10, 16, 30),
      createdAt: DateTime(2026, 10, 10, 9, 0),
    );
    const staff = [
      LotStaff(id: 'u1', name: 'Mariama'),
      LotStaff(id: 'u2', name: 'Ibrahima'),
    ];

    testWidgets('each sale shows when, what, how paid, by whom; voided shows '
        'who and when', (tester) async {
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: _FakeSource(sales: [voided, sale], staff: staff),
          service: _Calls().service,
        ),
      );
      final shown = displayDateTime(DateTime(2026, 10, 10, 15, 5), 'en');
      expect(shown, startsWith('Oct 10, 2026 3:05'));
      expect(find.text(shown), findsOneWidget);
      expect(find.text(r'2 × Soap at $4.00 (list $4.50)'), findsOneWidget);
      expect(find.text('Cash · Sold by Mariama'), findsOneWidget);
      expect(find.byKey(const Key('inv-voided-s2')), findsOneWidget);
      expect(
          find.text(
              'Voided by Ibrahima · ${displayDateTime(DateTime(2026, 10, 10, 16, 30), 'en')}'),
          findsOneWidget);
      // Newest first.
      expect(
        tester.getTopLeft(find.byKey(const ValueKey('inv-sale-s1'))).dy,
        lessThan(tester.getTopLeft(find.byKey(const ValueKey('inv-sale-s2'))).dy),
      );
      // A sale already voided cannot be voided again.
      expect(find.byKey(const Key('inv-void-s2')), findsNothing);
      expect(find.byKey(const Key('inv-void-s1')), findsOneWidget);
    });

    testWidgets('void asks first; cancel changes nothing, confirm voids',
        (tester) async {
      final calls = _Calls();
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: _FakeSource(sales: [sale], staff: staff),
          service: calls.service,
        ),
      );
      await tester.tap(find.byKey(const Key('inv-void-s1')));
      await tester.pumpAndSettle();
      expect(find.text('Void this sale?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);

      await tester.tap(find.byKey(const Key('inv-void-s1')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Void sale'));
      await tester.pumpAndSettle();
      expect(calls.named('voidInventorySale').single.payload,
          {'businessId': 'b1', 'saleId': 's1'});
      expect(find.text('Sale voided.'), findsOneWidget);
    });

    testWidgets('a refused void says why', (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => throw FirebaseFunctionsException(
              message: 'voided',
              code: 'failed-precondition',
              details: {'reason': 'sale_voided'},
            );
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: _FakeSource(sales: [sale]),
          service: calls.service,
        ),
      );
      await tester.tap(find.byKey(const Key('inv-void-s1')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Void sale'));
      await tester.pumpAndSettle();
      expect(find.text('This sale was already voided.'), findsOneWidget);
    });

    testWidgets('an empty list explains itself', (tester) async {
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: _FakeSource(),
          service: _Calls().service,
        ),
      );
      expect(find.byKey(const Key('inv-sales-empty')), findsOneWidget);
    });

    testWidgets('French at 320 wide keeps the card readable', (tester) async {
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: _FakeSource(sales: [voided, sale], staff: staff),
          service: _Calls().service,
        ),
        locale: const Locale('fr'),
        size: const Size(320, 700),
      );
      expect(find.byKey(const Key('inv-voided-s2')), findsOneWidget);
      expect(
          find.text(
              'Annulée par Ibrahima · ${displayDateTime(DateTime(2026, 10, 10, 16, 30), 'fr')}'),
          findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('products list', () {
    final items = [
      _item('a', 'IT-AAAAAA', name: 'Zinc cream', quantity: 20),
      _item('b', 'IT-BBBBBB', name: 'Apple soap', quantity: 20),
      _item('c', 'IT-CCCCCC', name: 'Mango oil', quantity: 1, lowStockAt: 3),
      _item('d', 'IT-DDDDDD', name: 'Old tin', archived: true),
    ];

    testWidgets('low stock first; search narrows; archived on request',
        (tester) async {
      final calls = _Calls()
        ..respond = (name, payload) => {
              'salesCount': 2,
              'itemsSold': 5,
              'revenueCents': 4500,
              'profitCents': 1500,
              'discountCents': 100,
              'low': [
                {'itemId': 'c', 'name': 'Mango oil', 'quantity': 1, 'lowStockAt': 3},
              ],
              'countWasOff': <Object>[],
            };
      await _pump(
        tester,
        InventoryScreen(
          businessId: 'b1',
          source: _FakeSource(items: items),
          service: calls.service,
          cameraEnabled: false,
        ),
      );
      double top(String id) =>
          tester.getTopLeft(find.byKey(ValueKey('inv-item-$id'))).dy;
      expect(top('c'), lessThan(top('b')));
      expect(top('b'), lessThan(top('a')));
      expect(find.byKey(const ValueKey('inv-item-d')), findsNothing);
      expect(find.byKey(const Key('inv-chip-low')), findsOneWidget);

      // Today: the numbers come from the server, and low stock is listed.
      expect(calls.named('getInventorySummary').single.payload['range'], 'today');
      expect(find.text(r'$45.00'), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-low-c')), findsOneWidget);
      expect(find.text('5 items sold · Discounts given: \$1.00'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('inv-search')), 'soap');
      await tester.pump();
      expect(find.byKey(const ValueKey('inv-item-b')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-item-a')), findsNothing);
      await tester.enterText(find.byKey(const Key('inv-search')), '');
      await tester.pump();

      await tester.tap(find.byKey(const Key('inv-archived-toggle')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('inv-item-d')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-item-a')), findsNothing);
      expect(find.byKey(const Key('inv-chip-archived')), findsOneWidget);
    });

    testWidgets('no products yet explains how to start; a failed summary '
        'offers a retry', (tester) async {
      final calls = _Calls()..respond = (n, p) => throw _offline();
      await _pump(
        tester,
        InventoryScreen(
          businessId: 'b1',
          source: _FakeSource(),
          service: calls.service,
          cameraEnabled: false,
        ),
      );
      expect(find.byKey(const Key('inv-empty')), findsOneWidget);
      expect(find.text('No products yet'), findsOneWidget);
      expect(find.byKey(const Key('inv-summary-error')), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-summary-retry')));
      await tester.pumpAndSettle();
      expect(calls.named('getInventorySummary'), hasLength(2));
    });

    testWidgets('a list that cannot load says so instead of showing empty',
        (tester) async {
      await _pump(
        tester,
        InventoryScreen(
          businessId: 'b1',
          source: _FakeSource(itemsFail: true),
          service: (_Calls()..respond = (n, p) => <String, Object?>{}).service,
          cameraEnabled: false,
        ),
      );
      expect(find.byKey(const Key('inv-load-failed')), findsOneWidget);
    });

    testWidgets('French at 320 wide: the three actions and a row fit',
        (tester) async {
      await _pump(
        tester,
        InventoryScreen(
          businessId: 'b1',
          source: _FakeSource(items: items),
          service: (_Calls()..respond = (n, p) => <String, Object?>{}).service,
          cameraEnabled: false,
        ),
        locale: const Locale('fr'),
        size: const Size(320, 700),
      );
      expect(find.text('Ajouter un produit'), findsOneWidget);
      expect(find.text('Vendre'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Sell and Sales open from the home', (tester) async {
      await _pump(
        tester,
        InventoryScreen(
          businessId: 'b1',
          source: _FakeSource(items: items),
          service: (_Calls()..respond = (n, p) => <String, Object?>{}).service,
          cameraEnabled: false,
        ),
      );
      await tester.tap(find.byKey(const Key('inv-open-sales')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-sales-empty')), findsOneWidget);
    });
  });

  group('a product page', () {
    final item = _item('i1', 'IT-K7M4P2',
        name: 'Soap', quantity: 0, countWasOff: true, category: 'Body');
    final moves = [
      InventoryMovement(
        id: 'm1',
        itemId: 'i1',
        type: 'sale',
        delta: -1,
        quantityAfter: 0,
        byStaffId: 'u1',
        createdAt: DateTime(2026, 10, 10, 15, 5),
      ),
      InventoryMovement(
        id: 'm0',
        itemId: 'i1',
        type: 'add',
        delta: 1,
        quantityAfter: 1,
        byStaffId: 'u2',
        note: 'new box',
        createdAt: DateTime(2026, 10, 9, 9, 0),
      ),
    ];

    Widget page(_FakeSource source, _Calls calls,
            {InventoryTagOpener? opener}) =>
        InventoryItemScreen(
          businessId: 'b1',
          itemId: 'i1',
          source: source,
          service: calls.service,
          tagOpener: opener ??
              ({required businessId, required itemId, required copies}) async {},
        );

    testWidgets('shows the count, the flags and who changed the stock when',
        (tester) async {
      await _pump(
        tester,
        page(
          _FakeSource(
            items: [item],
            movements: moves,
            staff: const [LotStaff(id: 'u1', name: 'Mariama'), LotStaff(id: 'u2', name: 'Ibrahima')],
          ),
          _Calls(),
        ),
      );
      expect(find.byKey(const Key('inv-item-count')), findsOneWidget);
      expect(find.byKey(const Key('inv-chip-out')), findsOneWidget);
      expect(find.byKey(const Key('inv-chip-count-off')), findsOneWidget);
      expect(find.byKey(const Key('inv-item-count-off')), findsOneWidget);
      expect(
          find.text(
              'Now 0 · by Mariama · ${displayDateTime(DateTime(2026, 10, 10, 15, 5), 'en')}'),
          findsOneWidget);
      expect(
          find.text(
              'Now 1 · by Ibrahima · ${displayDateTime(DateTime(2026, 10, 9, 9, 0), 'en')}'),
          findsOneWidget);
      expect(find.text('new box'), findsOneWidget);
      expect(find.text('-1'), findsOneWidget);
      expect(find.text('+1'), findsOneWidget);
    });

    testWidgets('archive asks first and sends archived true', (tester) async {
      final calls = _Calls();
      await _pump(tester, page(_FakeSource(items: [item]), calls));
      await tester.tap(find.byKey(const Key('inv-act-archive')));
      await tester.pumpAndSettle();
      expect(find.text('Archive this product?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);
      await tester.tap(find.byKey(const Key('inv-act-archive')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Archive'));
      await tester.pumpAndSettle();
      expect(calls.named('archiveInventoryItem').single.payload,
          {'businessId': 'b1', 'itemId': 'i1', 'archived': true});
    });

    testWidgets('delete needs its confirmation and always sends confirm: true',
        (tester) async {
      final calls = _Calls();
      await _pump(tester, page(_FakeSource(items: [item]), calls));
      await tester.tap(find.byKey(const Key('inv-act-delete')));
      await tester.pumpAndSettle();
      expect(find.text('Delete this product?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);

      await tester.tap(find.byKey(const Key('inv-act-delete')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(calls.named('deleteInventoryItem').single.payload,
          {'businessId': 'b1', 'itemId': 'i1', 'confirm': true});
    });

    testWidgets('a restored product needs no confirmation', (tester) async {
      final calls = _Calls();
      final archived = _item('i1', 'IT-K7M4P2', name: 'Soap', archived: true);
      await _pump(tester, page(_FakeSource(items: [archived]), calls));
      await tester.tap(find.byKey(const Key('inv-act-archive')));
      await tester.pumpAndSettle();
      expect(calls.named('archiveInventoryItem').single.payload['archived'], false);
    });

    testWidgets('a product that is no longer there says so', (tester) async {
      await _pump(tester, page(_FakeSource(), _Calls()));
      expect(find.byKey(const Key('inv-item-gone')), findsOneWidget);
    });

    testWidgets('French at 320 wide keeps the actions and history readable',
        (tester) async {
      await _pump(
        tester,
        page(_FakeSource(items: [item], movements: moves), _Calls()),
        locale: const Locale('fr'),
        size: const Size(320, 700),
      );
      await tester.dragUntilVisible(
        find.text('Historique du stock'),
        find.byType(ListView),
        const Offset(0, -200),
      );
      expect(find.text('Historique du stock'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('stores: the counter', () {
    late _FakeSource source;
    setUp(() => source = _FakeSource(
          items: [_soap, _oil],
          stores: _stores,
          stock: _stockRows,
        ));

    testWidgets('staff with a home store sell from it: no picker, the count is '
        'that store\'s, and the sale names no store', (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => {'saleId': 's1', 'totalCents': 1350, 'warnings': <Object>[]};
      await _pump(tester, _sell(source, calls, scans, access: _staffBk));
      expect(find.byKey(const Key('inv-sell-store')), findsNothing);
      expect(find.text('Selling from Brooklyn'), findsOneWidget);

      await _scan(tester, scans, 'IT-K7M4P2');
      await _scan(tester, scans, 'IT-K7M4P2');
      // Brooklyn holds 2 (the total says 10): two is not over.
      expect(find.byKey(const Key('inv-exceeds-i1')), findsNothing);
      await _scan(tester, scans, 'IT-K7M4P2');
      expect(find.byKey(const Key('inv-exceeds-i1')), findsOneWidget);

      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      final sale = calls.named('recordInventorySale').single.payload;
      expect(sale.containsKey('storeId'), isFalse);
      expect(sale['lines'], [
        {'itemId': 'i1', 'quantity': 3, 'soldPriceCents': 450},
      ]);
      // Only their own store's counts were ever read.
      expect(source.stockStores, ['s-bk']);
      expect(find.text('Store: Brooklyn'), findsOneWidget);
    });

    testWidgets('an all-stores user sees the picker on their home store and the '
        'sale carries the store they picked', (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => {'saleId': 's1', 'totalCents': 1350, 'warnings': <Object>[]};
      await _pump(
        tester,
        _sell(source, calls, scans,
            access: const InventoryAccess(allStores: true, homeStoreId: 's-main')),
      );
      final picker = find.byKey(const Key('inv-sell-store'));
      expect(picker, findsOneWidget);
      expect(find.descendant(of: picker, matching: find.text('Main store')),
          findsOneWidget);

      for (var i = 0; i < 3; i++) {
        await _scan(tester, scans, 'IT-K7M4P2');
      }
      // Main holds 8: three is fine.
      expect(find.byKey(const Key('inv-exceeds-i1')), findsNothing);

      await tester.tap(picker);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Brooklyn').last);
      await tester.pumpAndSettle();
      expect(find.descendant(of: picker, matching: find.text('Brooklyn')),
          findsOneWidget);
      // Brooklyn holds 2: three is now over, shown at once.
      expect(find.byKey(const Key('inv-exceeds-i1')), findsOneWidget);

      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(calls.named('recordInventorySale').single.payload['storeId'], 's-bk');
      expect(find.text('Store: Brooklyn'), findsOneWidget);
    });

    testWidgets('the owner with no home store starts on the first store and '
        'sends it', (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => {'saleId': 's1', 'totalCents': 450, 'warnings': <Object>[]};
      await _pump(tester, _sell(source, calls, scans));
      expect(
          find.descendant(
              of: find.byKey(const Key('inv-sell-store')),
              matching: find.text('Brooklyn')),
          findsOneWidget);
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(calls.named('recordInventorySale').single.payload['storeId'], 's-bk');
    });

    testWidgets('a retry after a lost connection sends the same id and store; '
        'another store is another sale', (tester) async {
      var fail = true;
      final calls = _Calls()
        ..respond = (n, p) {
          if (fail) throw _offline();
          return {'saleId': 's1', 'totalCents': 450, 'warnings': <Object>[]};
        };
      await _pump(tester, _sell(source, calls, scans));
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      fail = false;
      await tester.tap(find.byKey(const Key('inv-retry')));
      await tester.pumpAndSettle();
      final sent = calls.named('recordInventorySale');
      expect([for (final c in sent) c.payload['clientRequestId']], ['req-1', 'req-1']);
      expect([for (final c in sent) c.payload['storeId']], ['s-bk', 's-bk']);
    });

    testWidgets('staff with no home store are told to ask the owner and cannot '
        'sell', (tester) async {
      final calls = _Calls();
      await _pump(tester, _sell(source, calls, scans, access: const InventoryAccess()));
      expect(find.byKey(const Key('inv-home-store-required')), findsOneWidget);
      expect(find.text('Ask the owner to assign your store before you sell.'),
          findsOneWidget);
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);
      expect(source.stockStores, isNot(contains('')));
    });

    testWidgets('a refusal for a missing home store reads the same words',
        (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => throw FirebaseFunctionsException(
              message: 'no store',
              code: 'failed-precondition',
              details: {'reason': 'home_store_required'},
            );
      await _pump(tester, _sell(source, calls, scans, access: _staffBk));
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(find.text('Ask the owner to assign your store before you sell.'),
          findsOneWidget);
      expect(find.byKey(const Key('inv-retry')), findsNothing);
    });

    testWidgets('one active store is a single-store shop: nothing about stores',
        (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => {'saleId': 's1', 'totalCents': 450, 'warnings': <Object>[]};
      final single = _FakeSource(
        items: [_soap],
        stores: const [_mainStore, InventoryStore(id: 's-old', name: 'Old', archived: true)],
      );
      await _pump(tester, _sell(single, calls, scans, access: _staffBk));
      expect(find.byKey(const Key('inv-sell-store')), findsNothing);
      expect(find.byKey(const Key('inv-sell-store-home')), findsNothing);
      expect(find.byKey(const Key('inv-home-store-required')), findsNothing);
      await _scan(tester, scans, 'IT-K7M4P2');
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(calls.named('recordInventorySale').single.payload, {
        'businessId': 'b1',
        'clientRequestId': 'req-1',
        'paymentMethod': 'cash',
        'lines': [
          {'itemId': 'i1', 'quantity': 1, 'soldPriceCents': 450},
        ],
      });
      expect(single.stockStores, isEmpty);
      expect(find.byKey(const Key('inv-sale-done-store')), findsNothing);
    });

    testWidgets('French at 320 wide: the picker and a long store name fit',
        (tester) async {
      final long = _FakeSource(
        items: [_soap],
        stores: const [
          _mainStore,
          InventoryStore(
              id: 's-bk', name: 'Magasin de la rue Saint-Jacques, entrepôt nord'),
        ],
        stock: _stockRows,
      );
      await _pump(
        tester,
        _sell(long, _Calls(), scans),
        locale: const Locale('fr'),
        size: const Size(320, 700),
      );
      expect(find.text('Vendre depuis'), findsOneWidget);
      await _scan(tester, scans, 'IT-K7M4P2');
      expect(tester.takeException(), isNull);
    });
  });

  group('stores and categories: the products list', () {
    Map<String, Object?> summaryAnswer() => {
          'salesCount': 3,
          'itemsSold': 7,
          'revenueCents': 6000,
          'profitCents': 2000,
          'discountCents': 0,
          'low': [
            {
              'itemId': 'i1',
              'name': 'Soap',
              'quantity': 2,
              'lowStockAt': 3,
              'storeId': 's-bk',
              'storeName': 'Brooklyn',
            },
          ],
          'countWasOff': <Object>[],
          'byCategory': [
            {'categoryId': 'c1', 'name': 'Body', 'itemsSold': 2, 'revenueCents': 900, 'profitCents': 300},
            {'categoryId': '', 'name': 'Uncategorized', 'itemsSold': 1, 'revenueCents': 5000, 'profitCents': 1000},
            {'categoryId': 'c2', 'name': 'Hair', 'itemsSold': 4, 'revenueCents': 100, 'profitCents': 0},
          ],
          'byStore': [
            {'storeId': 's-bk', 'name': 'Brooklyn', 'salesCount': 2, 'itemsSold': 3, 'revenueCents': 2500, 'profitCents': 800},
            {'storeId': 's-main', 'name': 'Main store', 'salesCount': 1, 'itemsSold': 4, 'revenueCents': 3500, 'profitCents': 1200},
          ],
        };

    final items = [
      _item('i1', 'IT-K7M4P2', name: 'Soap', quantity: 10, lowStockAt: 3, category: 'Body'),
      _item('i2', 'IT-CCCCCC', name: 'Palm oil', quantity: 10, categoryId: 'c2', category: 'Hair'),
    ];

    Widget list(_FakeSource source, _Calls calls,
            {InventoryAccess access = const InventoryAccess.owner()}) =>
        InventoryScreen(
          businessId: 'b1',
          source: source,
          service: calls.service,
          cameraEnabled: false,
          access: access,
        );

    testWidgets('the owner sees the store filter, each store\'s count and where '
        'it is low; the filter narrows counts and the numbers',
        (tester) async {
      final calls = _Calls()..respond = (n, p) => summaryAnswer();
      await _pump(
        tester,
        list(_FakeSource(items: items, stores: _stores, stock: _stockRows, categories: _categories), calls),
      );
      expect(find.byKey(const Key('inv-store-filter-all')), findsOneWidget);
      expect(find.byKey(const Key('inv-store-filter-s-bk')), findsOneWidget);
      // The total, with each store's count under the name.
      expect(find.text('10 in stock'), findsNWidgets(2));
      String rowCount(String id) => (tester
              .widget<Text>(find.descendant(
                  of: find.byKey(ValueKey('inv-item-$id')),
                  matching: find.textContaining(' in stock')))
              .data!);
      expect(find.byKey(const Key('inv-row-stores-i1')), findsOneWidget);
      expect(
          tester.widget<Text>(find.byKey(const Key('inv-row-stores-i1'))).data,
          'Brooklyn 2 · Main store 8');
      // 2 is at or under the one lowStockAt of 3: low at Brooklyn.
      expect(find.byKey(const Key('inv-row-low-i1-s-bk')), findsOneWidget);
      expect(find.text('Low at Brooklyn'), findsWidgets);
      // The summary asked for every store, and shows By store.
      expect(calls.named('getInventorySummary').single.payload.containsKey('storeId'),
          isFalse);
      expect(find.byKey(const ValueKey('inv-bystore-s-bk')), findsOneWidget);
      expect(find.text('By store'), findsOneWidget);
      // The low-stock row names its store.
      expect(find.text('Soap · Brooklyn'), findsOneWidget);

      await tester.tap(find.byKey(const Key('inv-store-filter-s-bk')));
      await tester.pumpAndSettle();
      expect(rowCount('i1'), '2 in stock');
      expect(rowCount('i2'), '5 in stock');
      expect(find.byKey(const Key('inv-row-stores-i1')), findsNothing);
      expect(calls.named('getInventorySummary').last.payload['storeId'], 's-bk');
    });

    testWidgets('staff see their own store\'s count only, no filter, no By '
        'store, and the summary is not asked for another store', (tester) async {
      final source = _FakeSource(items: items, stores: _stores, stock: _stockRows);
      final calls = _Calls()..respond = (n, p) => summaryAnswer();
      await _pump(tester, list(source, calls, access: _staffBk));
      expect(find.byKey(const Key('inv-store-filter-all')), findsNothing);
      expect(find.byKey(const Key('inv-row-stores-i1')), findsNothing);
      String rowCount(String id) => (tester
              .widget<Text>(find.descendant(
                  of: find.byKey(ValueKey('inv-item-$id')),
                  matching: find.textContaining(' in stock')))
              .data!);
      expect(rowCount('i1'), '2 in stock');
      expect(rowCount('i2'), '5 in stock');
      expect(find.byKey(const ValueKey('inv-bystore-s-bk')), findsNothing);
      expect(find.byKey(const Key('inv-open-stores')), findsNothing);
      expect(calls.named('getInventorySummary').single.payload.containsKey('storeId'),
          isFalse);
      expect(source.stockStores, ['s-bk']);
    });

    testWidgets('staff with no store are told, and see no counts', (tester) async {
      final source = _FakeSource(items: items, stores: _stores, stock: _stockRows);
      await _pump(
        tester,
        list(source, _Calls()..respond = (n, p) => <String, Object?>{},
            access: const InventoryAccess()),
      );
      expect(find.byKey(const Key('inv-home-store-missing')), findsOneWidget);
      expect(find.text('0 in stock'), findsNWidgets(2));
      expect(source.stockStores, isEmpty);
    });

    testWidgets('a single-store shop shows no store anything', (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => {
              'salesCount': 1,
              'revenueCents': 450,
              'low': <Object>[],
              'countWasOff': <Object>[],
            };
      final source = _FakeSource(items: items, stores: const [_mainStore]);
      await _pump(tester, list(source, calls, access: _staffBk));
      expect(find.byKey(const Key('inv-store-filter-all')), findsNothing);
      expect(find.byKey(const Key('inv-row-stores-i1')), findsNothing);
      expect(find.byKey(const Key('inv-open-stores')), findsNothing);
      expect(find.text('10 in stock'), findsNWidgets(2));
      expect(find.text('By store'), findsNothing);
      expect(source.stockStores, isEmpty);
    });

    testWidgets('the Today summary has a categories block, biggest money first, '
        'with Uncategorized named', (tester) async {
      final calls = _Calls()..respond = (n, p) => summaryAnswer();
      await _pump(
        tester,
        list(_FakeSource(items: items, categories: _categories), calls),
      );
      expect(find.text('By category'), findsOneWidget);
      double top(String id) =>
          tester.getTopLeft(find.byKey(ValueKey('inv-bycat-$id'))).dy;
      expect(top('none'), lessThan(top('c1')));
      expect(top('c1'), lessThan(top('c2')));
      expect(find.text('Uncategorized'), findsOneWidget);
      expect(find.text(r'$50.00'), findsWidgets);
      expect(find.text(r'2 items sold · Profit $3.00'), findsOneWidget);
      // A single store: no By store block even though the server sent one.
      expect(find.byKey(const ValueKey('inv-bystore-s-bk')), findsNothing);
    });

    testWidgets('a summary from a server with no categories shows no block',
        (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => {
              'salesCount': 1,
              'itemsSold': 1,
              'revenueCents': 450,
              'profitCents': 100,
              'low': <Object>[],
              'countWasOff': <Object>[],
            };
      await _pump(tester, list(_FakeSource(items: items), calls));
      expect(find.text('By category'), findsNothing);
      expect(find.text('By store'), findsNothing);
      expect(find.byKey(const Key('inv-summary-detail')), findsOneWidget);
    });

    testWidgets('the list filters by category', (tester) async {
      await _pump(
        tester,
        list(
          _FakeSource(items: items, categories: _categories),
          _Calls()..respond = (n, p) => <String, Object?>{},
        ),
      );
      expect(find.byKey(const Key('inv-category-filter-all')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-item-i1')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-item-i2')), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-category-filter-c2')));
      await tester.pumpAndSettle();
      // i2 by id, i1 (typed "Body") is not in Hair.
      expect(find.byKey(const ValueKey('inv-item-i2')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-item-i1')), findsNothing);
      // A product typed before categories is found under the category of the
      // same name.
      await tester.tap(find.byKey(const Key('inv-category-filter-c1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('inv-item-i1')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-item-i2')), findsNothing);
      await tester.tap(find.byKey(const Key('inv-category-filter-all')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('inv-item-i2')), findsOneWidget);
    });

    testWidgets('no categories, no category filter', (tester) async {
      await _pump(
        tester,
        list(_FakeSource(items: items),
            _Calls()..respond = (n, p) => <String, Object?>{}),
      );
      expect(find.byKey(const Key('inv-category-filter-all')), findsNothing);
    });

    testWidgets('French at 320 wide: filters, per-store line and blocks fit',
        (tester) async {
      final calls = _Calls()..respond = (n, p) => summaryAnswer();
      await _pump(
        tester,
        list(_FakeSource(items: items, stores: _stores, stock: _stockRows, categories: _categories), calls),
        locale: const Locale('fr'),
        size: const Size(320, 900),
      );
      expect(find.text('Par catégorie'), findsOneWidget);
      expect(find.text('Par magasin'), findsOneWidget);
      expect(find.text('Tous les magasins'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('stores and categories: managers', () {
    testWidgets('the owner adds a store; a single-store shop is told how',
        (tester) async {
      final calls = _Calls()..respond = (n, p) => {'storeId': 's2'};
      await _pump(
        tester,
        InventoryStoresScreen(
          businessId: 'b1',
          source: _FakeSource(stores: const [_mainStore]),
          service: calls.service,
        ),
      );
      expect(find.byKey(const Key('inv-stores-intro')), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-stores-add')));
      await tester.pumpAndSettle();
      // Empty: refused at the field.
      await tester.tap(find.byKey(const Key('inv-store-save')));
      await tester.pumpAndSettle();
      expect(find.text('Enter a store name.'), findsOneWidget);
      expect(calls.log, isEmpty);
      await tester.enterText(find.byKey(const Key('inv-store-name')), 'Brooklyn');
      await tester.enterText(find.byKey(const Key('inv-store-address')), '1 Main St');
      await tester.tap(find.byKey(const Key('inv-store-save')));
      await tester.pumpAndSettle();
      expect(calls.named('createInventoryStore').single.payload,
          {'businessId': 'b1', 'name': 'Brooklyn', 'address': '1 Main St'});
      expect(find.text('Store saved.'), findsOneWidget);
    });

    testWidgets('archiving asks first; a store with stock says to move it',
        (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => throw FirebaseFunctionsException(
              message: 'stock',
              code: 'failed-precondition',
              details: {'reason': 'store_has_stock'},
            );
      await _pump(
        tester,
        InventoryStoresScreen(
          businessId: 'b1',
          source: _FakeSource(stores: _stores),
          service: calls.service,
        ),
      );
      expect(find.byKey(const Key('inv-stores-intro')), findsNothing);
      await tester.tap(find.byKey(const Key('inv-store-archive-s-bk')));
      await tester.pumpAndSettle();
      expect(find.text('Archive this store?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);
      await tester.tap(find.byKey(const Key('inv-store-archive-s-bk')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Archive'));
      await tester.pumpAndSettle();
      expect(calls.named('archiveInventoryStore').single.payload,
          {'businessId': 'b1', 'storeId': 's-bk', 'archived': true});
      expect(find.textContaining('still holds stock'), findsOneWidget);
    });

    testWidgets('editing a store sends only what changed', (tester) async {
      final calls = _Calls();
      await _pump(
        tester,
        InventoryStoresScreen(
          businessId: 'b1',
          source: _FakeSource(stores: _stores),
          service: calls.service,
        ),
      );
      await tester.tap(find.byKey(const Key('inv-store-edit-s-bk')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('inv-store-name')), 'Brooklyn 2');
      await tester.tap(find.byKey(const Key('inv-store-save')));
      await tester.pumpAndSettle();
      expect(calls.named('updateInventoryStore').single.payload,
          {'businessId': 'b1', 'storeId': 's-bk', 'name': 'Brooklyn 2'});
    });

    testWidgets('the owner sets a staff member\'s home store and all-stores',
        (tester) async {
      final calls = _Calls();
      await _pump(
        tester,
        Scaffold(
          body: InventoryTeamAccess(
            businessId: 'b1',
            source: _FakeSource(stores: _stores),
            service: calls.service,
            members: const [
              InventoryTeamMember(userId: 'u1', name: 'Mariama'),
              InventoryTeamMember(userId: 'u2', name: 'Ibrahima', allStores: true),
            ],
          ),
        ),
      );
      expect(find.text('Inventory stores'), findsOneWidget);
      expect(find.text('No home store yet'), findsOneWidget);
      expect(find.text('Works in all stores'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('inv-access-u1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inv-access-home')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Brooklyn').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inv-access-save')));
      await tester.pumpAndSettle();
      expect(calls.named('setInventoryStaffAccess').single.payload, {
        'businessId': 'b1',
        'userId': 'u1',
        'homeStoreId': 's-bk',
        'allStores': false,
      });
      expect(find.text('Store access saved.'), findsOneWidget);
    });

    testWidgets('the all-stores switch is sent as set', (tester) async {
      final calls = _Calls();
      await _pump(
        tester,
        Scaffold(
          body: InventoryTeamAccess(
            businessId: 'b1',
            source: _FakeSource(stores: _stores),
            service: calls.service,
            members: const [InventoryTeamMember(userId: 'u1', name: 'Mariama', homeStoreId: 's-main')],
          ),
        ),
      );
      expect(find.text('Home: Main store'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('inv-access-u1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inv-access-all')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inv-access-save')));
      await tester.pumpAndSettle();
      expect(calls.named('setInventoryStaffAccess').single.payload['allStores'], true);
      expect(calls.named('setInventoryStaffAccess').single.payload['homeStoreId'], 's-main');
    });

    testWidgets('nothing to assign in a single-store shop', (tester) async {
      await _pump(
        tester,
        Scaffold(
          body: InventoryTeamAccess(
            businessId: 'b1',
            source: _FakeSource(stores: const [_mainStore]),
            members: const [InventoryTeamMember(userId: 'u1', name: 'Mariama')],
          ),
        ),
      );
      expect(find.byKey(const Key('inv-team-access')), findsNothing);
    });

    testWidgets('categories: add, rename, archive and restore', (tester) async {
      final calls = _Calls()..respond = (n, p) => {'categoryId': 'c9'};
      await _pump(
        tester,
        InventoryCategoriesScreen(
          businessId: 'b1',
          source: _FakeSource(categories: _categories),
          service: calls.service,
        ),
      );
      await tester.tap(find.byKey(const Key('inv-categories-add')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inv-category-save')));
      await tester.pumpAndSettle();
      expect(find.text('Enter a category name.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('inv-category-name')), 'Wax');
      await tester.tap(find.byKey(const Key('inv-category-save')));
      await tester.pumpAndSettle();
      expect(calls.named('createInventoryCategory').single.payload,
          {'businessId': 'b1', 'name': 'Wax'});

      await tester.tap(find.byKey(const Key('inv-category-rename-c1')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('inv-category-name')), 'Skin');
      await tester.tap(find.byKey(const Key('inv-category-save')));
      await tester.pumpAndSettle();
      expect(calls.named('renameInventoryCategory').single.payload,
          {'businessId': 'b1', 'categoryId': 'c1', 'name': 'Skin'});

      await tester.tap(find.byKey(const Key('inv-category-archive-c2')));
      await tester.pumpAndSettle();
      expect(calls.named('archiveInventoryCategory').single.payload,
          {'businessId': 'b1', 'categoryId': 'c2', 'archived': true});
    });

    testWidgets('a taken category name is said, not swallowed', (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => throw FirebaseFunctionsException(
              message: 'taken',
              code: 'failed-precondition',
              details: {'reason': 'category_name_taken'},
            );
      await _pump(
        tester,
        InventoryCategoriesScreen(
          businessId: 'b1',
          source: _FakeSource(categories: _categories),
          service: calls.service,
        ),
      );
      await tester.tap(find.byKey(const Key('inv-categories-add')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('inv-category-name')), 'Body');
      await tester.tap(find.byKey(const Key('inv-category-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-category-error')), findsOneWidget);
      expect(find.text('You already have a category with that name.'), findsOneWidget);
    });

    testWidgets('French at 320 wide: stores and categories managers fit',
        (tester) async {
      await _pump(
        tester,
        InventoryStoresScreen(
          businessId: 'b1',
          source: _FakeSource(stores: const [
            _mainStore,
            InventoryStore(
                id: 's-bk',
                name: 'Magasin de la rue Saint-Jacques, entrepôt nord',
                address: '1234 Avenue de la République, Paris',
                archived: true),
          ]),
          service: _Calls().service,
        ),
        locale: const Locale('fr'),
        size: const Size(320, 700),
      );
      expect(find.text('Ajouter un magasin'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _pump(
        tester,
        InventoryCategoriesScreen(
          businessId: 'b1',
          source: _FakeSource(categories: _categories),
          service: _Calls().service,
        ),
        locale: const Locale('fr'),
        size: const Size(320, 700),
      );
      expect(find.text('Ajouter une catégorie'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('stores and categories: the product form', () {
    Future<void> openForm(
      WidgetTester tester,
      _Calls calls, {
      InventoryItem? existing,
      List<InventoryCategory> categories = const [],
      InventoryStoreContext? stores,
      Locale locale = const Locale('en'),
      Size size = const Size(400, 2400),
    }) =>
        _openSheet(
          tester,
          (context) => showInventoryItemForm(
            context,
            businessId: 'b1',
            existing: existing,
            service: calls.service,
            categories: categories,
            stores: stores,
          ),
          locale: locale,
          size: size,
        );

    Future<void> fillBasics(WidgetTester tester) async {
      await tester.enterText(find.byKey(const Key('inv-field-name')), 'Wax');
      await tester.enterText(find.byKey(const Key('inv-field-price')), '4');
    }

    testWidgets('adding a new category on the spot creates it and uses it',
        (tester) async {
      final calls = _Calls()
        ..respond = (n, p) =>
            n == 'createInventoryCategory' ? {'categoryId': 'c9'} : {'itemId': 'n', 'code': 'IT-HHHHHH'};
      await openForm(tester, calls, categories: _categories);
      await fillBasics(tester);
      await tester.enterText(find.byKey(const Key('inv-field-quantity')), '3');
      await tester.ensureVisible(find.byKey(const Key('inv-field-category')));
      await tester.tap(find.byKey(const Key('inv-field-category')));
      await tester.pumpAndSettle();
      expect(find.text('No category'), findsWidgets);
      await tester.tap(find.text('Add a new category'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('inv-category-name')), 'Wax goods');
      await tester.tap(find.byKey(const Key('inv-category-save')));
      await tester.pumpAndSettle();
      expect(calls.named('createInventoryCategory').single.payload,
          {'businessId': 'b1', 'name': 'Wax goods'});
      await tester.ensureVisible(find.byKey(const Key('inv-form-save')));
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      final create = calls.named('createInventoryItem').single.payload;
      expect(create['categoryId'], 'c9');
      expect(create.containsKey('category'), isFalse);
      expect(create['quantity'], 3);
    });

    testWidgets('a server without categories keeps the typed name as plain text',
        (tester) async {
      final calls = _Calls()
        ..respond = (n, p) {
          if (n == 'createInventoryCategory') {
            throw FirebaseFunctionsException(message: 'nf', code: 'not-found');
          }
          return {'itemId': 'n', 'code': 'IT-HHHHHH'};
        };
      await openForm(tester, calls);
      await fillBasics(tester);
      await tester.enterText(find.byKey(const Key('inv-field-quantity')), '3');
      await tester.ensureVisible(find.byKey(const Key('inv-field-category')));
      await tester.tap(find.byKey(const Key('inv-field-category')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add a new category'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('inv-category-name')), 'Wax goods');
      await tester.tap(find.byKey(const Key('inv-category-save')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('inv-form-save')));
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      final create = calls.named('createInventoryItem').single.payload;
      expect(create['category'], 'Wax goods');
      expect(create.containsKey('categoryId'), isFalse);
    });

    testWidgets('no category is sent when none is picked', (tester) async {
      final calls = _Calls()..respond = (n, p) => {'itemId': 'n', 'code': 'IT-HHHHHH'};
      await openForm(tester, calls, categories: _categories);
      await fillBasics(tester);
      await tester.enterText(find.byKey(const Key('inv-field-quantity')), '3');
      await tester.ensureVisible(find.byKey(const Key('inv-form-save')));
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      final create = calls.named('createInventoryItem').single.payload;
      expect(create.containsKey('category'), isFalse);
      expect(create.containsKey('categoryId'), isFalse);
    });

    testWidgets('a product typed before categories shows its name and an edit '
        'that leaves it sends nothing about it', (tester) async {
      final calls = _Calls();
      final legacy = _item('i1', 'IT-K7M4P2', name: 'Soap', category: 'Body');
      await openForm(tester, calls, existing: legacy, categories: _categories);
      await tester.ensureVisible(find.byKey(const Key('inv-field-category')));
      expect(
          find.descendant(
              of: find.byKey(const Key('inv-field-category')),
              matching: find.text('Body')),
          findsOneWidget);
      await tester.enterText(find.byKey(const Key('inv-field-price')), '5');
      await tester.ensureVisible(find.byKey(const Key('inv-form-save')));
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      expect(calls.named('updateInventoryItem').single.payload,
          {'businessId': 'b1', 'itemId': 'i1', 'priceCents': 500});
    });

    testWidgets('picking another category on an edit sends its id',
        (tester) async {
      final calls = _Calls();
      final existing =
          _item('i1', 'IT-K7M4P2', name: 'Soap', category: 'Body');
      await openForm(tester, calls, existing: existing, categories: _categories);
      await tester.ensureVisible(find.byKey(const Key('inv-field-category')));
      await tester.tap(find.byKey(const Key('inv-field-category')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hair'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('inv-form-save')));
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      expect(calls.named('updateInventoryItem').single.payload,
          {'businessId': 'b1', 'itemId': 'i1', 'categoryId': 'c2'});
    });

    testWidgets('the owner of several stores types a starting count for each',
        (tester) async {
      final calls = _Calls()..respond = (n, p) => {'itemId': 'n', 'code': 'IT-HHHHHH'};
      await openForm(tester, calls,
          stores: InventoryStoreContext(stores: _stores));
      expect(find.byKey(const Key('inv-field-quantity')), findsNothing);
      await fillBasics(tester);
      await tester.enterText(find.byKey(const Key('inv-field-quantity-s-main')), '7');
      await tester.ensureVisible(find.byKey(const Key('inv-form-save')));
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      final create = calls.named('createInventoryItem').single.payload;
      expect(create['stock'], {'s-bk': 0, 's-main': 7});
      expect(create.containsKey('quantity'), isFalse);
    });

    testWidgets('staff of one store type one count, named for their store',
        (tester) async {
      final calls = _Calls()..respond = (n, p) => {'itemId': 'n', 'code': 'IT-HHHHHH'};
      await openForm(tester, calls,
          stores: InventoryStoreContext(stores: _stores, access: _staffBk));
      expect(find.text('Starting count in Brooklyn'), findsOneWidget);
      await fillBasics(tester);
      await tester.enterText(find.byKey(const Key('inv-field-quantity')), '4');
      await tester.ensureVisible(find.byKey(const Key('inv-form-save')));
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      final create = calls.named('createInventoryItem').single.payload;
      expect(create['quantity'], 4);
      expect(create.containsKey('stock'), isFalse);
      expect(create.containsKey('storeId'), isFalse);
    });

    testWidgets('French at 320 wide: a form with the picker and store counts',
        (tester) async {
      await openForm(tester, _Calls(),
          categories: _categories,
          stores: InventoryStoreContext(stores: const [
            _mainStore,
            InventoryStore(
                id: 's-bk', name: 'Magasin de la rue Saint-Jacques, entrepôt nord'),
          ]),
          locale: const Locale('fr'),
          size: const Size(320, 900));
      expect(find.text('Nouveau produit'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-form-save')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('stores: a product page', () {
    final soap = _item('i1', 'IT-K7M4P2',
        name: 'Soap', quantity: 10, lowStockAt: 3, category: 'Body');
    final moves = [
      InventoryMovement(
        id: 'm1',
        itemId: 'i1',
        type: 'transfer_out',
        delta: -2,
        quantityAfter: 8,
        storeId: 's-main',
        transferId: 't1',
        createdAt: DateTime(2026, 10, 10, 15, 5),
      ),
      InventoryMovement(
        id: 'm2',
        itemId: 'i1',
        type: 'transfer_in',
        delta: 2,
        quantityAfter: 2,
        storeId: 's-bk',
        transferId: 't1',
        createdAt: DateTime(2026, 10, 10, 15, 5),
      ),
    ];

    Widget page(_FakeSource source, _Calls calls,
            {InventoryAccess access = const InventoryAccess.owner()}) =>
        InventoryItemScreen(
          businessId: 'b1',
          itemId: 'i1',
          source: source,
          service: calls.service,
          access: access,
          tagOpener: ({required businessId, required itemId, required copies}) async {},
        );

    _FakeSource source() => _FakeSource(
          items: [soap],
          stores: _stores,
          stock: _stockRows,
          movements: moves,
        );

    testWidgets('the owner sees the total, each store\'s count, where it is low '
        'and a store filter', (tester) async {
      await _pump(tester, page(source(), _Calls()));
      expect(tester.widget<Text>(find.byKey(const Key('inv-item-count'))).data, '10');
      expect(find.byKey(const Key('inv-store-counts')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('inv-store-count-s-bk'))).data, '2');
      expect(tester.widget<Text>(find.byKey(const Key('inv-store-count-s-main'))).data, '8');
      expect(tester.widget<Text>(find.byKey(const Key('inv-store-total'))).data, '10');
      expect(find.byKey(const Key('inv-low-at-s-bk')), findsOneWidget);

      await tester.ensureVisible(find.byKey(const Key('inv-store-filter-s-main')));
      await tester.tap(find.byKey(const Key('inv-store-filter-s-main')));
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(find.byKey(const Key('inv-item-count'))).data, '8');
      expect(find.byKey(const Key('inv-low-at-s-bk')), findsNothing);
      expect(find.byKey(const Key('inv-chip-ok')), findsOneWidget);
    });

    testWidgets('staff see their store\'s count only and cannot transfer; '
        'only their store\'s history is asked for', (tester) async {
      final src = source();
      await _pump(tester, page(src, _Calls(), access: _staffBk));
      expect(tester.widget<Text>(find.byKey(const Key('inv-item-count'))).data, '2');
      expect(find.text('Your store: Brooklyn'), findsOneWidget);
      expect(find.byKey(const Key('inv-store-counts')), findsNothing);
      expect(find.byKey(const Key('inv-store-filter-all')), findsNothing);
      expect(find.byKey(const Key('inv-act-transfer')), findsNothing);
      expect(src.movementStores, ['s-bk']);
      expect(find.byKey(const ValueKey('inv-move-m2')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-move-m1')), findsNothing);
      expect(find.textContaining('at Brooklyn'), findsOneWidget);
      expect(find.text('Transfer'), findsOneWidget);
    });

    testWidgets('a single-store shop has none of it', (tester) async {
      await _pump(
        tester,
        page(_FakeSource(items: [soap], stores: const [_mainStore], stock: _stockRows), _Calls()),
      );
      expect(tester.widget<Text>(find.byKey(const Key('inv-item-count'))).data, '10');
      expect(find.byKey(const Key('inv-store-counts')), findsNothing);
      expect(find.byKey(const Key('inv-act-transfer')), findsNothing);
      expect(find.byKey(const Key('inv-store-filter-all')), findsNothing);
    });

    testWidgets('transfer: two different stores are required before anything '
        'is sent', (tester) async {
      final calls = _Calls();
      await _pump(tester, page(source(), calls));
      await tester.tap(find.byKey(const Key('inv-act-transfer')));
      await tester.pumpAndSettle();
      // From the store that holds the most, to the other.
      expect(
          find.descendant(
              of: find.byKey(const Key('inv-transfer-from')),
              matching: find.text('Main store')),
          findsOneWidget);
      expect(
          find.descendant(
              of: find.byKey(const Key('inv-transfer-to')),
              matching: find.text('Brooklyn')),
          findsOneWidget);
      // Point "To" at the same store as "From".
      await tester.tap(find.byKey(const Key('inv-transfer-to')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Main store').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('inv-transfer-quantity')), '2');
      await tester.tap(find.byKey(const Key('inv-transfer-save')));
      await tester.pumpAndSettle();
      expect(find.text('Choose two different stores.'), findsOneWidget);
      expect(calls.log, isEmpty);
    });

    testWidgets('transfer: sends the move and says so', (tester) async {
      final calls = _Calls();
      await _pump(tester, page(source(), calls));
      await tester.tap(find.byKey(const Key('inv-act-transfer')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inv-transfer-save')));
      await tester.pumpAndSettle();
      expect(find.text('Enter a whole number of at least 1.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('inv-transfer-quantity')), '3');
      await tester.enterText(find.byKey(const Key('inv-transfer-note')), 'restock');
      await tester.tap(find.byKey(const Key('inv-transfer-save')));
      await tester.pumpAndSettle();
      expect(calls.named('transferInventoryStock').single.payload, {
        'businessId': 'b1',
        'itemId': 'i1',
        'fromStoreId': 's-main',
        'toStoreId': 's-bk',
        'quantity': 3,
        'note': 'restock',
      });
      expect(find.text('Stock moved.'), findsOneWidget);
    });

    testWidgets('transfer: more than the source holds is refused in words, '
        'and the sheet stays', (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => throw FirebaseFunctionsException(
              message: 'short',
              code: 'failed-precondition',
              details: {'reason': 'insufficient_stock'},
            );
      await _pump(tester, page(source(), calls));
      await tester.tap(find.byKey(const Key('inv-act-transfer')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('inv-transfer-quantity')), '99');
      await tester.tap(find.byKey(const Key('inv-transfer-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-transfer-error')), findsOneWidget);
      expect(find.textContaining('does not have that many'), findsOneWidget);
      expect(find.byKey(const Key('inv-transfer-save')), findsOneWidget);
    });

    testWidgets('transfer: the server\'s same-store refusal reads the same',
        (tester) async {
      final calls = _Calls()
        ..respond = (n, p) => throw FirebaseFunctionsException(
              message: 'same',
              code: 'invalid-argument',
              details: {'reason': 'same_store'},
            );
      await _pump(tester, page(source(), calls));
      await tester.tap(find.byKey(const Key('inv-act-transfer')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('inv-transfer-quantity')), '1');
      await tester.tap(find.byKey(const Key('inv-transfer-save')));
      await tester.pumpAndSettle();
      expect(find.text('Choose two different stores.'), findsOneWidget);
    });

    testWidgets('add stock: the owner picks the store and it is sent',
        (tester) async {
      final calls = _Calls();
      await _pump(tester, page(source(), calls));
      await tester.tap(find.byKey(const Key('inv-act-add')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inv-stock-store')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Main store').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('inv-stock-quantity')), '4');
      await tester.tap(find.byKey(const Key('inv-stock-save')));
      await tester.pumpAndSettle();
      expect(calls.named('adjustInventoryStock').single.payload['storeId'], 's-main');
    });

    testWidgets('add stock: staff count in their own store and send none',
        (tester) async {
      final staffCalls = _Calls();
      await _pump(tester, page(source(), staffCalls, access: _staffBk));
      await tester.tap(find.byKey(const Key('inv-act-add')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-stock-store')), findsNothing);
      expect(find.text('Counting in Brooklyn'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('inv-stock-quantity')), '4');
      await tester.tap(find.byKey(const Key('inv-stock-save')));
      await tester.pumpAndSettle();
      expect(staffCalls.named('adjustInventoryStock').single.payload.containsKey('storeId'),
          isFalse);
    });

    testWidgets('set count starts from the chosen store\'s count', (tester) async {
      final calls = _Calls();
      await _pump(tester, page(source(), calls));
      await tester.tap(find.byKey(const Key('inv-store-filter-s-bk')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inv-act-set')));
      await tester.pumpAndSettle();
      String typed() => tester
          .widget<TextField>(find.byKey(const Key('inv-stock-quantity')))
          .controller!
          .text;
      expect(typed(), '2');
      await tester.tap(find.byKey(const Key('inv-stock-store')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Main store').last);
      await tester.pumpAndSettle();
      expect(typed(), '8');
      await tester.tap(find.byKey(const Key('inv-stock-save')));
      await tester.pumpAndSettle();
      final sent = calls.named('adjustInventoryStock').single.payload;
      expect(sent['mode'], 'set');
      expect(sent['storeId'], 's-main');
      expect(sent['quantity'], 8);
    });

    testWidgets('French at 320 wide: counts, filter and transfer fit',
        (tester) async {
      await _pump(
        tester,
        page(
          _FakeSource(
            items: [soap],
            stores: const [
              _mainStore,
              InventoryStore(
                  id: 's-bk',
                  name: 'Magasin de la rue Saint-Jacques, entrepôt nord'),
            ],
            stock: _stockRows,
            movements: moves,
          ),
          _Calls(),
        ),
        locale: const Locale('fr'),
        size: const Size(320, 900),
      );
      expect(find.text('Stock par magasin'), findsOneWidget);
      await tester.scrollUntilVisible(
          find.byKey(const Key('inv-act-transfer')), 200,
          scrollable: find.byType(Scrollable).first);
      await tester.tap(find.byKey(const Key('inv-act-transfer')));
      await tester.pumpAndSettle();
      expect(find.text('Transférer du stock'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  });

  group('stores: the sales list', () {
    InventorySale sale(String id, String storeId, String storeName, int cents) =>
        InventorySale(
          id: id,
          businessId: 'b1',
          lines: const [
            InventorySaleLine(
              itemId: 'i1',
              name: 'Soap',
              code: 'IT-K7M4P2',
              quantity: 1,
              listPriceCents: 450,
              soldPriceCents: 450,
            ),
          ],
          totalCents: cents,
          paymentMethod: 'cash',
          soldByStaffId: 'u1',
          storeId: storeId,
          storeName: storeName,
          createdAt: DateTime(2026, 10, 10, 15, id == 'a' ? 5 : 6),
        );

    final sales = [
      sale('a', 's-main', 'Main store', 450),
      sale('b', 's-bk', 'Brooklyn', 900),
    ];

    testWidgets('the owner sees the store on every sale and can filter',
        (tester) async {
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: _FakeSource(sales: sales, stores: _stores),
          service: _Calls().service,
        ),
      );
      expect(find.text('Cash · Store: Main store'), findsOneWidget);
      expect(find.text('Cash · Store: Brooklyn'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-sales-store-s-bk')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('inv-sale-b')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-sale-a')), findsNothing);
      await tester.tap(find.byKey(const Key('inv-sales-store-all')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('inv-sale-a')), findsOneWidget);
    });

    testWidgets('staff are given only their own store\'s sales, with no filter',
        (tester) async {
      final src = _FakeSource(sales: sales, stores: _stores);
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: src,
          service: _Calls().service,
          access: _staffBk,
        ),
      );
      expect(src.salesStores, ['s-bk']);
      expect(find.byKey(const ValueKey('inv-sale-b')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-sale-a')), findsNothing);
      expect(find.byKey(const Key('inv-sales-store-all')), findsNothing);
      expect(find.textContaining('Store:'), findsNothing);
    });

    testWidgets('staff with no store are told and nothing is read',
        (tester) async {
      final src = _FakeSource(sales: sales, stores: _stores);
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: src,
          service: _Calls().service,
          access: const InventoryAccess(),
        ),
      );
      expect(src.salesStores, isEmpty);
      expect(find.byKey(const Key('inv-home-store-missing')), findsOneWidget);
      expect(find.byKey(const Key('inv-sales-empty')), findsOneWidget);
    });

    testWidgets('a single-store shop reads the old way and shows no store',
        (tester) async {
      final src = _FakeSource(sales: sales, stores: const [_mainStore]);
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: src,
          service: _Calls().service,
          access: _staffBk,
        ),
      );
      expect(src.salesStores, ['']);
      expect(find.textContaining('Store:'), findsNothing);
      expect(find.byKey(const Key('inv-sales-store-all')), findsNothing);
    });

    testWidgets('French at 320 wide: store line and filter fit', (tester) async {
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: _FakeSource(sales: [
            sale('a', 's-main', 'Magasin de la rue Saint-Jacques, entrepôt nord', 450),
          ], stores: _stores),
          service: _Calls().service,
        ),
        locale: const Locale('fr'),
        size: const Size(320, 700),
      );
      expect(find.textContaining('Magasin :'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('app links', () {
    setUp(PackageLinkService.instance.resetForTesting);
    tearDown(PackageLinkService.instance.resetForTesting);

    test('a tag link waits for the app, and package links are untouched', () {
      final service = PackageLinkService.instance;
      service.handleLink(Uri.parse('https://customer.laawoldigital.com/i/it-k7m4p2'));
      expect(service.pendingInventoryCode, 'IT-K7M4P2');
      expect(service.pendingCode, isNull);
      service.handleLink(Uri.parse('https://example.com/i/IT-CCCCCC'));
      expect(service.pendingInventoryCode, 'IT-K7M4P2');
      service.handleLink(Uri.parse('https://customer.laawoldigital.com/t/CL-K7M4P2'));
      expect(service.pendingCode, 'CL-K7M4P2');
      expect(service.pendingInventoryCode, 'IT-K7M4P2');
    });

    test('start listens to tag links too', () async {
      final links = StreamController<Uri>();
      PackageLinkService.instance.start(links: links.stream);
      links.add(Uri.parse('https://customer.laawoldigital.com/i/IT-CCCCCC'));
      await Future<void>.delayed(Duration.zero);
      expect(PackageLinkService.instance.pendingInventoryCode, 'IT-CCCCCC');
      await links.close();
    });
  });
}

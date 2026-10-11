import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/inventory_item_screen.dart';
import 'package:my_flutter_app/screens/inventory_item_sheets.dart';
import 'package:my_flutter_app/screens/inventory_sales_screen.dart';
import 'package:my_flutter_app/screens/inventory_screen.dart';
import 'package:my_flutter_app/screens/inventory_sell_screen.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
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
    );

final _soap = _item('i1', 'IT-K7M4P2', name: 'Soap');
final _oil = _item('i2', 'IT-CCCCCC', name: 'Palm oil', price: 1200);
final _old = _item('i3', 'IT-DDDDDD', name: 'Old tin', archived: true);
final _foreign =
    _item('i9', 'IT-FFFFFF', name: 'Their stuff', businessId: 'other');

String _link(String code) => 'https://customer.laawoldigital.com/i/$code';

class _FakeSource implements InventorySource {
  _FakeSource({
    this.items = const [],
    this.sales = const [],
    this.movements = const [],
    this.staff = const [],
    this.itemsFail = false,
  });

  final List<InventoryItem> items;
  final List<InventorySale> sales;
  final List<InventoryMovement> movements;
  final List<LotStaff> staff;
  final bool itemsFail;
  final List<String> codeLookups = [];

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
  Stream<List<InventorySale>> watchSales(String businessId, {required int limit}) =>
      Stream.value(sales);

  @override
  Stream<List<InventoryMovement>> watchMovements(
          String businessId, String itemId) =>
      Stream.value([
        for (final m in movements)
          if (m.itemId == itemId) m,
      ]);

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
}) {
  var n = 0;
  return InventorySellScreen(
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
    }) =>
        _openSheet(
          tester,
          (context) => showInventoryItemForm(
            context,
            businessId: 'b1',
            existing: existing,
            service: calls.service,
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
      await openForm(tester, calls);
      await tester.enterText(find.byKey(const Key('inv-field-name')), 'Shea butter');
      await tester.enterText(find.byKey(const Key('inv-field-price')), '12,50');
      await tester.enterText(find.byKey(const Key('inv-field-cost')), '8');
      await tester.enterText(find.byKey(const Key('inv-field-quantity')), '24');
      await tester.enterText(find.byKey(const Key('inv-field-low')), '5');
      await tester.enterText(find.byKey(const Key('inv-field-category')), 'Body');
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
        'category': 'Body',
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

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/inventory_sales_screen.dart';
import 'package:my_flutter_app/screens/sales_history_screen.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_credit.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/services/sales_history.dart';
import 'package:my_flutter_app/services/sales_history_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/inventory_widgets.dart' show InventoryNote;

/// Sales history: the period loader (voids of older sales and reverts of
/// older payments read by when they happened, the read cap, a failed side
/// read) and the screen (figures, owner-only profit, comparison, chart and
/// drill-down, breakdowns, the timeline and what a row opens, store reach,
/// notices, French on a narrow phone). Firebase is replaced by fakes.

/// 2:00 PM in New York on Friday, Oct 16, 2026 (EDT, UTC-4).
final _now = DateTime.utc(2026, 10, 16, 18);

/// A New York wall time in October 2026 (EDT) as the instant.
DateTime _ny(int day, int hour, [int month = 10]) =>
    DateTime.utc(2026, month, day, hour + 4);

InventorySale _sale(
  String id,
  DateTime at, {
  int total = 1000,
  String seller = 'u-ama',
  String storeId = '',
  String method = 'cash',
  int credit = 0,
  String customer = '',
  bool voided = false,
  DateTime? voidedAt,
  int? cost,
  String name = 'Soap',
  int lines = 1,
}) => InventorySale.fromMap(id, {
  'businessId': 'b1',
  'totalCents': total,
  'paymentMethod': credit >= total ? '' : method,
  'soldByStaffId': seller,
  'storeId': storeId,
  'createdAt': at,
  'voided': voided,
  'voidedAt': ?voidedAt,
  'voidedByStaffId': voided ? 'u-owner' : '',
  'lines': [
    for (var i = 0; i < lines; i++)
      {
        'itemId': 'i$i',
        'name': i == 0 ? name : 'Item $i',
        'code': 'IT-$i',
        'quantity': 1,
        'listPriceCents': total ~/ lines,
        'soldPriceCents': total ~/ lines,
        'costCents': ?cost,
      },
  ],
  if (credit > 0) ...{
    'paidNowCents': total - credit,
    'creditCents': credit,
    'creditStatus': voided ? 'none' : 'open',
    'credit': {
      'customerName': customer,
      'customerPhone': '+12125550100',
      'collectorStaffId': 'u-ama',
      'dueDate': '',
    },
  },
});

InventoryCreditPayment _payment(
  String id,
  String saleId,
  DateTime at, {
  int amount = 500,
  bool reverted = false,
  DateTime? revertedAt,
}) => InventoryCreditPayment(
  id: id,
  businessId: 'b1',
  saleId: saleId,
  amountCents: amount,
  method: 'cash',
  receivedByStaffId: 'u-ama',
  reverted: reverted,
  revertedAt: revertedAt,
  revertedByStaffId: reverted ? 'u-owner' : '',
  createdAt: at,
);

typedef _Read = ({String what, String storeId, DateTime start, DateTime end});

class _History implements SalesHistorySource {
  _History({
    this.saleRows = const [],
    this.movementRows = const [],
    this.paymentRows = const [],
    this.fail = const {},
    this.truncate = const {},
  });

  final List<InventorySale> saleRows;
  final List<InventoryMovement> movementRows;
  final List<InventoryCreditPayment> paymentRows;
  Set<String> fail;
  final Set<String> truncate;
  final List<_Read> reads = [];

  bool _in(DateTime? at, DateTime start, DateTime end) =>
      at != null && !at.isBefore(start) && at.isBefore(end);

  Future<SalesHistoryRows<T>> _answer<T>(
    String what,
    String storeId,
    DateTime start,
    DateTime end,
    List<T> rows,
  ) async {
    reads.add((what: what, storeId: storeId, start: start, end: end));
    if (fail.contains(what)) throw StateError('no index');
    return (rows: rows, truncated: truncate.contains(what));
  }

  @override
  Future<SalesHistoryRows<InventorySale>> sales(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  }) => _answer('sales', storeId, start, end, [
    for (final s in saleRows)
      if (_in(s.createdAt, start, end) &&
          (storeId.isEmpty || s.storeId == storeId))
        s,
  ]);

  @override
  Future<SalesHistoryRows<InventorySale>> voidedSales(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  }) => _answer('voided', storeId, start, end, [
    for (final s in saleRows)
      if (_in(s.voidedAt, start, end)) s,
  ]);

  @override
  Future<SalesHistoryRows<InventoryMovement>> movements(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  }) => _answer('movements', storeId, start, end, [
    for (final m in movementRows)
      if (_in(m.createdAt, start, end)) m,
  ]);

  @override
  Future<SalesHistoryRows<InventoryCreditPayment>> creditPayments(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  }) => _answer('payments', storeId, start, end, [
    for (final p in paymentRows)
      if (_in(p.createdAt, start, end)) p,
  ]);

  @override
  Future<SalesHistoryRows<InventoryCreditPayment>> revertedPayments(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  }) => _answer('reverted', storeId, start, end, [
    for (final p in paymentRows)
      if (_in(p.revertedAt, start, end)) p,
  ]);
}

const _team = [
  LotStaff(id: 'u-ama', name: 'Ama'),
  LotStaff(id: 'u-kofi', name: 'Kofi'),
  LotStaff(id: 'u-owner', name: 'Mariama'),
];

class _Source implements InventorySource {
  _Source({this.sales = const [], this.stores = const []});

  final List<InventorySale> sales;
  final List<InventoryStore> stores;

  @override
  Stream<List<InventoryItem>> watchItems(String businessId) => Stream.value(
    const [
      InventoryItem(
        id: 'i-rice',
        businessId: 'b1',
        name: 'Rice 25 lb',
        code: 'IT-RICE',
        priceCents: 2500,
        quantity: 8,
      ),
    ],
  );

  @override
  Future<InventoryItem?> findItemByCode(String businessId, String code) async =>
      null;

  @override
  Stream<List<InventorySale>> watchSales(
    String businessId, {
    required int limit,
    String storeId = '',
  }) => Stream.value(sales);

  @override
  Stream<InventorySale?> watchSale(String businessId, String saleId) =>
      Stream.value(sales.where((s) => s.id == saleId).firstOrNull);

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
  Stream<List<LotStaff>> watchStaff(String businessId) => Stream.value(_team);
}

class _Credits implements InventoryCreditSource {
  @override
  Stream<List<InventorySale>> watchOpenCredits(
    String businessId, {
    String storeId = '',
  }) => Stream.value(const []);

  @override
  Stream<List<InventoryCreditPayment>> watchCreditPayments(
    String businessId,
    String saleId, {
    String storeId = '',
  }) => Stream.value(const []);

  @override
  Stream<InventoryBusinessOwner> watchBusinessOwner(String businessId) =>
      Stream.value((uid: 'u-owner', name: 'Mariama', email: ''));
}

/// Today: two sales (one on credit), one voided; yesterday one sale; a
/// sale from last week voided today; a credit payment today and an older
/// one reverted today; stock added today.
final _week = [
  _sale(
    'today-1',
    _ny(16, 9),
    total: 3000,
    cost: 1000,
    name: 'Rice 25 lb',
    lines: 2,
  ),
  _sale(
    'today-2',
    _ny(16, 11),
    total: 2000,
    seller: 'u-kofi',
    method: 'zelle',
    credit: 1500,
    customer: 'Fatou Bah',
  ),
  _sale(
    'today-void',
    _ny(16, 12),
    total: 700,
    voided: true,
    voidedAt: _ny(16, 13),
  ),
  _sale('yesterday', _ny(15, 10), total: 4000),
  _sale(
    'old-void',
    _ny(8, 10),
    total: 900,
    voided: true,
    voidedAt: _ny(16, 8),
  ),
];
final _payments = [
  _payment('p-today', 'today-2', _ny(16, 13, 10), amount: 300),
  _payment(
    'p-old',
    'old-credit',
    _ny(9, 10),
    amount: 800,
    reverted: true,
    revertedAt: _ny(16, 10),
  ),
];
final _movements = [
  InventoryMovement(
    id: 'm1',
    itemId: 'i-rice',
    type: 'add',
    delta: 5,
    quantityAfter: 13,
    byStaffId: 'u-ama',
    createdAt: _ny(16, 7),
  ),
];

_History _history({Set<String> fail = const {}, Set<String> truncate = const {}}) =>
    _History(
      saleRows: _week,
      paymentRows: _payments,
      movementRows: _movements,
      fail: fail,
      truncate: truncate,
    );

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(400, 3000),
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

Widget _screen(
  _History history, {
  InventoryAccess access = const InventoryAccess.owner(),
  List<InventoryStore> stores = const [],
}) => SalesHistoryScreen(
  businessId: 'b1',
  access: access,
  source: _Source(sales: _week, stores: stores),
  historySource: history,
  creditSource: _Credits(),
  service: InventoryService(caller: (_, _) async => <String, Object?>{}),
  currentUserId: 'u-ama',
  clock: () => _now,
);

String _text(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

Future<void> _tapKey(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  group('loading a period', () {
    final today = SalesPeriod.current(SalesPeriodKind.day, _now);

    test('voids and reverts are read by when they happened', () async {
      final data = await loadSalesHistory(_history(), 'b1', today);
      final s = data.summary;
      // The day's own sales only; both voids are left out of the figures.
      expect(s.salesCount, 2);
      expect(s.totalCents, 5000);
      expect(s.voidedCount, 1);
      expect(s.paidNowCents, 3500);
      expect(s.creditCents, 1500);
      // Only today's live payment counts as collected.
      expect(s.creditCollectedCents, 300);
      // The period before: yesterday's one sale.
      expect(data.previous!.totalCents, 4000);
      final kinds = [
        for (final d in data.days)
          for (final e in d.events) '${e.kind.name}:${e.saleId}${e.itemId}',
      ];
      expect(kinds, [
        'voided:today-void',
        'creditPayment:today-2',
        'sale:today-void',
        'sale:today-2',
        'creditReverted:old-credit',
        'sale:today-1',
        // A sale from last week voided this morning.
        'voided:old-void',
        'stockAdded:i-rice',
      ]);
      expect(data.partial, isFalse);
      expect(data.truncated, isFalse);
    });

    test('a side read failing leaves its rows out and says so', () async {
      final data = await loadSalesHistory(
        _history(fail: {'voided', 'reverted', 'movements'}),
        'b1',
        today,
      );
      expect(data.partial, isTrue);
      expect(data.summary.totalCents, 5000);
      final kinds = {
        for (final d in data.days)
          for (final e in d.events) e.kind,
      };
      expect(kinds, isNot(contains(SalesEventKind.stockAdded)));
      expect(kinds, isNot(contains(SalesEventKind.creditReverted)));
      // The day's own void still shows: it is on the day's sale.
      expect(kinds, contains(SalesEventKind.voided));
    });

    test('the sales read failing fails the load', () async {
      await expectLater(
        loadSalesHistory(_history(fail: {'sales'}), 'b1', today),
        throwsStateError,
      );
    });

    test('any read at the cap marks the period truncated', () async {
      final data = await loadSalesHistory(
        _history(truncate: {'movements'}),
        'b1',
        today,
      );
      expect(data.truncated, isTrue);
    });

    test('every read uses the period edges and the store', () async {
      final history = _history();
      await loadSalesHistory(history, 'b1', today, storeId: 's1');
      expect(history.reads.map((r) => r.what).toSet(), {
        'sales',
        'voided',
        'movements',
        'payments',
        'reverted',
      });
      for (final r in history.reads) {
        expect(r.storeId, 's1');
      }
      final current = history.reads.where((r) => r.what != 'sales').first;
      expect(current.start, DateTime.utc(2026, 10, 16, 4));
      expect(current.end, DateTime.utc(2026, 10, 17, 4));
      // The sales of the day before, for the comparison.
      expect(
        history.reads.where((r) => r.what == 'sales').map((r) => r.start),
        containsAll([
          DateTime.utc(2026, 10, 16, 4),
          DateTime.utc(2026, 10, 15, 4),
        ]),
      );
    });
  });

  group('the screen', () {
    testWidgets('today for the owner: figures, comparison, profit', (
      tester,
    ) async {
      await _pump(tester, _screen(_history()));
      expect(_text(tester, 'hist-period-label'), 'Fri, Oct 16, 2026');
      expect(_text(tester, 'hist-period-current'), 'Today');
      expect(_text(tester, 'hist-kpi-total'), r'$50.00');
      // 5000 against 4000 the day before.
      expect(_text(tester, 'hist-kpi-change'), '+25% vs the day before');
      expect(
        _text(tester, 'hist-kpi-split'),
        r'Paid now $35.00 · On credit $15.00',
      );
      expect(_text(tester, 'hist-kpi-collected'), r'Credit collected $3.00');
      expect(find.byKey(const Key('hist-kpi-profit')), findsOneWidget);
      // One sale's lines have no cost.
      expect(
        _text(tester, 'hist-kpi-profit-partial'),
        '1 line has no cost and is left out',
      );
      expect(_text(tester, 'hist-kpi-voided'), '1 voided sale, not counted');
      // Today is the newest period: nothing after it.
      final next = tester.widget<IconButton>(
        find.byKey(const Key('hist-next')),
      );
      expect(next.onPressed, isNull);
    });

    testWidgets('staff see no profit', (tester) async {
      await _pump(
        tester,
        _screen(_history(), access: const InventoryAccess(allStores: true)),
      );
      expect(find.byKey(const Key('hist-kpi-total')), findsOneWidget);
      expect(find.byKey(const Key('hist-kpi-profit')), findsNothing);
      expect(find.byKey(const Key('hist-kpi-profit-partial')), findsNothing);
    });

    testWidgets('breakdowns: seller, payment with credit, products', (
      tester,
    ) async {
      await _pump(tester, _screen(_history()));
      final seller = find.byKey(const Key('hist-breakdown-seller'));
      expect(
        find.descendant(of: seller, matching: find.text('Ama')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: seller, matching: find.text('Kofi')),
        findsOneWidget,
      );
      final payment = find.byKey(const Key('hist-breakdown-payment'));
      expect(
        find.descendant(of: payment, matching: find.text('On credit')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: payment, matching: find.text(r'$15.00')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('hist-breakdown-products')), findsOneWidget);
      // One store: no store breakdown, no store filter.
      expect(find.byKey(const Key('hist-breakdown-store')), findsNothing);
      expect(find.byKey(const Key('hist-store-all')), findsNothing);
    });

    testWidgets('the timeline in words; a sale row opens that sale', (
      tester,
    ) async {
      await _pump(tester, _screen(_history()));
      expect(find.text('What happened'), findsOneWidget);
      expect(find.text('Rice 25 lb + 1 more'), findsOneWidget);
      expect(find.text('Credit payment · Fatou Bah'), findsOneWidget);
      expect(find.text('Credit payment reverted'), findsOneWidget);
      expect(find.text('Stock added: Rice 25 lb'), findsOneWidget);
      expect(find.text('Voided'), findsOneWidget);
      expect(find.text('Sale voided'), findsNWidgets(2));
      expect(find.textContaining('by Kofi'), findsOneWidget);
      await tester.ensureVisible(find.text('Rice 25 lb + 1 more'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Rice 25 lb + 1 more'));
      await tester.pumpAndSettle();
      final sales = tester.widget<InventorySalesScreen>(
        find.byType(InventorySalesScreen),
      );
      expect(sales.saleId, 'today-1');
    });

    testWidgets('week, previous, next; a bar opens its day', (tester) async {
      final history = _history();
      await _pump(tester, _screen(history));
      await tester.tap(find.byKey(const Key('hist-kind-week')));
      await tester.pumpAndSettle();
      expect(_text(tester, 'hist-period-label'), 'Oct 11 – Oct 17, 2026');
      expect(_text(tester, 'hist-period-current'), 'This week');
      // The week before (Oct 4-10) holds the old sale, voided this week.
      expect(_text(tester, 'hist-kpi-total'), r'$90.00');
      // Friday's bar (index 5).
      await _tapKey(tester, 'hist-bar-5');
      expect(_text(tester, 'hist-bar-value'), r'Fri, Oct 16: $50.00');
      await _tapKey(tester, 'hist-bar-open');
      expect(_text(tester, 'hist-period-label'), 'Fri, Oct 16, 2026');
      await _tapKey(tester, 'hist-previous');
      expect(_text(tester, 'hist-period-label'), 'Thu, Oct 15, 2026');
      expect(find.byKey(const Key('hist-period-current')), findsNothing);
      expect(_text(tester, 'hist-kpi-total'), r'$40.00');
      final next = tester.widget<IconButton>(
        find.byKey(const Key('hist-next')),
      );
      expect(next.onPressed, isNotNull);
      await _tapKey(tester, 'hist-next');
      expect(_text(tester, 'hist-period-label'), 'Fri, Oct 16, 2026');
    });

    testWidgets('month and year labels', (tester) async {
      await _pump(tester, _screen(_history()));
      await tester.tap(find.byKey(const Key('hist-kind-month')));
      await tester.pumpAndSettle();
      expect(_text(tester, 'hist-period-label'), 'October 2026');
      expect(find.byKey(const Key('hist-bar-30')), findsOneWidget);
      await tester.tap(find.byKey(const Key('hist-kind-year')));
      await tester.pumpAndSettle();
      expect(_text(tester, 'hist-period-label'), '2026');
      expect(find.byKey(const Key('hist-bar-11')), findsOneWidget);
      expect(find.byKey(const Key('hist-bar-12')), findsNothing);
    });

    testWidgets('a period at the read cap says only the first 1,500 show', (
      tester,
    ) async {
      await _pump(tester, _screen(_history(truncate: {'sales'})));
      expect(
        tester.widget<InventoryNote>(find.byKey(const Key('hist-truncated'))).text,
        startsWith('Showing the first 1,500 records of this period'),
      );
      expect(find.byKey(const Key('hist-partial')), findsNothing);
    });

    testWidgets('a failed read offers a retry; a partial one says so', (
      tester,
    ) async {
      final failing = _history(fail: {'sales'});
      await _pump(tester, _screen(failing));
      expect(find.byKey(const Key('hist-load-failed')), findsOneWidget);
      failing.fail = const {'movements'};
      await _tapKey(tester, 'hist-retry');
      expect(find.byKey(const Key('hist-load-failed')), findsNothing);
      expect(find.byKey(const Key('hist-partial')), findsOneWidget);
      expect(_text(tester, 'hist-kpi-total'), r'$50.00');
    });

    testWidgets('an empty period says so', (tester) async {
      await _pump(tester, _screen(_History()));
      expect(find.byKey(const Key('hist-empty')), findsOneWidget);
      expect(find.byKey(const Key('hist-timeline-empty')), findsOneWidget);
    });

    testWidgets('staff of one store read only that store', (tester) async {
      final history = _history();
      await _pump(
        tester,
        _screen(
          history,
          access: const InventoryAccess(homeStoreId: 's-bk'),
          stores: const [
            InventoryStore(id: 's-main', name: 'Main store'),
            InventoryStore(id: 's-bk', name: 'Brooklyn'),
          ],
        ),
      );
      expect(history.reads, isNotEmpty);
      expect(history.reads.map((r) => r.storeId).toSet(), {'s-bk'});
      expect(find.byKey(const Key('hist-store-all')), findsNothing);
    });

    testWidgets('the owner of several stores filters by store', (
      tester,
    ) async {
      final history = _history();
      await _pump(
        tester,
        _screen(
          history,
          stores: const [
            InventoryStore(id: 's-main', name: 'Main store'),
            InventoryStore(id: 's-bk', name: 'Brooklyn'),
          ],
        ),
      );
      expect(history.reads.map((r) => r.storeId).toSet(), {''});
      await _tapKey(tester, 'hist-store-s-bk');
      expect(history.reads.last.storeId, 's-bk');
    });

    testWidgets('French on a 320-wide phone', (tester) async {
      await _pump(
        tester,
        _screen(_history()),
        locale: const Locale('fr'),
        size: const Size(320, 3200),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Historique des ventes'), findsOneWidget);
      expect(find.text('Semaine'), findsOneWidget);
      expect(_text(tester, 'hist-period-current'), "Aujourd'hui");
      expect(
        _text(tester, 'hist-kpi-change'),
        '+25% par rapport à la veille',
      );
      expect(find.text("Ce qui s'est passé"), findsOneWidget);
      await tester.tap(find.byKey(const Key('hist-kind-week')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const Key('hist-kind-year')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  test('the shop home and Inventory open the history', () {
    for (final path in [
      'lib/screens/shop_home_section.dart',
      'lib/screens/inventory_screen.dart',
    ]) {
      final source = File(path).readAsStringSync();
      expect(source, contains('SalesHistoryScreen('), reason: path);
      expect(source, contains('l10n.salesHistTitle'), reason: path);
    }
  });
}

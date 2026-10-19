import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/inventory_credit_screen.dart';
import 'package:my_flutter_app/screens/inventory_credit_sheet.dart';
import 'package:my_flutter_app/screens/inventory_sales_screen.dart';
import 'package:my_flutter_app/screens/inventory_sell_screen.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_credit.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/theme/app_theme.dart';

/// Credit sales on screen: the Sell checkout's "Received by" and "On credit"
/// (validation, the request, French on a narrow phone), the sales list chip
/// and filter, the credit sheet (record, revert, change collector) and the
/// Credit owed list. Firebase is replaced by fakes; callables by a recorder.

const _soap = InventoryItem(
  id: 'i1',
  businessId: 'b1',
  name: 'Soap',
  code: 'IT-K7M4P2',
  priceCents: 6000,
  quantity: 10,
);

const _team = [
  LotStaff(id: 'u-me', name: 'Ama'),
  LotStaff(id: 'u-kofi', name: 'Kofi'),
];

final _today = DateTime(2026, 10, 16, 14);

InventorySale _creditSale(
  String id, {
  int credit = 4000,
  int paid = 0,
  String status = 'open',
  String collector = 'u-me',
  String due = '',
  String name = 'Fatou Diallo',
  String storeId = '',
}) => InventorySale.fromMap(id, {
  'businessId': 'b1',
  'totalCents': 6000,
  'paymentMethod': 'cash',
  'soldByStaffId': 'u-kofi',
  'storeId': storeId,
  'createdAt': DateTime(2026, 10, 2, 11),
  'lines': [
    {
      'itemId': 'i1',
      'name': 'Soap',
      'code': 'IT-K7M4P2',
      'quantity': 1,
      'listPriceCents': 6000,
      'soldPriceCents': 6000,
    },
  ],
  'paidNowCents': 6000 - credit,
  'creditCents': credit,
  'creditPaidCents': paid,
  'creditStatus': status,
  'credit': {
    'customerName': name,
    'customerPhone': '+12125550100',
    'collectorStaffId': collector,
    'dueDate': due,
  },
});

class _Source implements InventorySource {
  _Source({this.sales = const [], this.stores = const []});

  final List<InventorySale> sales;
  final List<InventoryStore> stores;

  @override
  Stream<List<InventoryItem>> watchItems(String businessId) =>
      Stream.value(const [_soap]);

  @override
  Future<InventoryItem?> findItemByCode(String businessId, String code) async =>
      code == _soap.code ? _soap : null;

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
  _Credits({this.open = const [], this.payments = const []});

  final List<InventorySale> open;
  final List<InventoryCreditPayment> payments;
  final List<String> openStores = [];
  final List<String> paymentStores = [];

  @override
  Stream<List<InventorySale>> watchOpenCredits(
    String businessId, {
    String storeId = '',
  }) {
    openStores.add(storeId);
    return Stream.value(open);
  }

  @override
  Stream<List<InventoryCreditPayment>> watchCreditPayments(
    String businessId,
    String saleId, {
    String storeId = '',
  }) {
    paymentStores.add(storeId);
    return Stream.value([
      for (final p in payments)
        if (p.saleId == saleId) p,
    ]);
  }

  @override
  Stream<InventoryBusinessOwner> watchBusinessOwner(String businessId) =>
      Stream.value((uid: 'u-owner', name: 'Mariama', email: ''));
}

class _Calls {
  final List<({String name, Map<String, Object?> payload})> log = [];
  Object? Function(String name, Map<String, Object?> payload)? respond;

  InventoryService get service => InventoryService(
    caller: (name, payload) async {
      log.add((name: name, payload: payload));
      final answer = respond;
      return answer == null ? <String, Object?>{} : answer(name, payload);
    },
  );

  List<Map<String, Object?>> named(String name) => [
    for (final c in log)
      if (c.name == name) c.payload,
  ];
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(400, 2600),
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

Widget _sell(_Calls calls, {_Credits? credits}) => InventorySellScreen(
  businessId: 'b1',
  source: _Source(),
  creditSource: credits ?? _Credits(),
  service: calls.service,
  newRequestId: () => 'req-1',
  cameraEnabled: false,
  initialCode: _soap.code,
  currentUserId: 'u-me',
  clock: () => _today,
);

Future<void> _tapText(WidgetTester tester, String text) async {
  await tester.ensureVisible(find.text(text).last);
  await tester.tap(find.text(text).last);
  await tester.pumpAndSettle();
}

Future<void> _tapKey(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  group('Sell checkout', () {
    testWidgets('received by defaults to me and can be anyone, the owner too',
        (tester) async {
      final calls = _Calls()
        ..respond = (name, _) => {'saleId': 's1', 'totalCents': 6000};
      await _pump(tester, _sell(calls));
      expect(find.text('Ama (me)'), findsOneWidget);
      await _tapKey(tester, 'inv-received-by');
      // Everyone in the business, the owner added from the business record.
      expect(find.text('Mariama'), findsOneWidget);
      expect(find.text('Kofi'), findsOneWidget);
      await _tapText(tester, 'Mariama');
      await _tapKey(tester, 'inv-sold');
      final sent = calls.named('recordInventorySale').single;
      expect(sent['receivedByStaffId'], 'u-owner');
      expect(sent['paymentMethod'], 'cash');
      expect(sent.containsKey('credit'), isFalse);
    });

    testWidgets('a plain sale taken by me sends no receivedByStaffId',
        (tester) async {
      final calls = _Calls()
        ..respond = (name, _) => {'saleId': 's1', 'totalCents': 6000};
      await _pump(tester, _sell(calls));
      await _tapKey(tester, 'inv-sold');
      final sent = calls.named('recordInventorySale').single;
      expect(sent.containsKey('receivedByStaffId'), isFalse);
    });

    testWidgets('on credit: every missing part is said, and nothing is sent',
        (tester) async {
      final calls = _Calls();
      await _pump(tester, _sell(calls));
      expect(find.byKey(const Key('inv-credit-name')), findsNothing);
      await _tapKey(tester, 'inv-on-credit');
      expect(find.byKey(const Key('inv-credit-name')), findsOneWidget);
      // Nothing paid now yet: no payment method to choose.
      expect(find.byKey(const Key('inv-payment')), findsNothing);
      expect(find.text(r'Paid now $0.00 · On credit $60.00'), findsOneWidget);

      await _tapKey(tester, 'inv-sold');
      expect(calls.named('recordInventorySale'), isEmpty);
      expect(find.text("Enter the customer's name."), findsOneWidget);
      // The phone is optional: never asked for.
      expect(find.text("Enter the customer's phone number."), findsNothing);
      expect(find.text('Choose who collects the rest.'), findsOneWidget);
      expect(find.byKey(const Key('inv-checkout-problem')), findsOneWidget);

      // Paying it all now is not credit.
      await tester.enterText(
        find.byKey(const Key('inv-credit-paid-now')),
        '60',
      );
      await tester.pumpAndSettle();
      expect(
        find.text(
          'On credit, the amount paid now must be less than the total.',
        ),
        findsOneWidget,
      );
      // The error follows the typing.
      await tester.enterText(
        find.byKey(const Key('inv-credit-paid-now')),
        '20',
      );
      await tester.pumpAndSettle();
      expect(
        find.text(
          'On credit, the amount paid now must be less than the total.',
        ),
        findsNothing,
      );
      expect(find.byKey(const Key('inv-payment')), findsOneWidget);
      expect(find.text(r'Paid now $20.00 · On credit $40.00'), findsOneWidget);
    });

    testWidgets('a complete credit sale sends the credit object', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (name, _) => {
          'saleId': 's1',
          'totalCents': 6000,
          'creditCents': 4000,
        };
      await _pump(tester, _sell(calls));
      await _tapKey(tester, 'inv-on-credit');
      await tester.enterText(
        find.byKey(const Key('inv-credit-paid-now')),
        '20',
      );
      await tester.enterText(
        find.byKey(const Key('inv-credit-name')),
        'Fatou Diallo',
      );
      await tester.enterText(
        find.byKey(const Key('inv-credit-phone')),
        '2125550100',
      );
      await tester.pumpAndSettle();
      await _tapKey(tester, 'inv-credit-collector');
      await _tapText(tester, 'Kofi');
      await _tapKey(tester, 'inv-sold');

      final sent = calls.named('recordInventorySale').single;
      expect(sent['paymentMethod'], 'cash');
      expect(sent['credit'], {
        'paidNowCents': 2000,
        'customerName': 'Fatou Diallo',
        'customerPhone': '+12125550100',
        'collectorStaffId': 'u-kofi',
        'dueDate': '',
      });
      expect(find.byKey(const Key('inv-sale-done-credit')), findsOneWidget);
      expect(find.text(r'Fatou Diallo owes $40.00'), findsOneWidget);
    });

    testWidgets('on credit, who took the part paid now is asked under it',
        (tester) async {
      final calls = _Calls()
        ..respond = (name, _) => {
          'saleId': 's1',
          'totalCents': 6000,
          'creditCents': 4000,
        };
      await _pump(tester, _sell(calls));
      expect(find.text('Received by'), findsWidgets);
      await _tapKey(tester, 'inv-on-credit');
      // Nothing paid now: nobody received anything, so nobody is asked.
      expect(find.byKey(const Key('inv-received-by')), findsNothing);
      await tester.enterText(
        find.byKey(const Key('inv-credit-paid-now')),
        '20',
      );
      await tester.pumpAndSettle();
      expect(find.text(r'Who received the $20.00 paid now'), findsWidgets);
      await _tapKey(tester, 'inv-received-by');
      await _tapText(tester, 'Mariama');
      await tester.enterText(
        find.byKey(const Key('inv-credit-name')),
        'Fatou Diallo',
      );
      await tester.enterText(
        find.byKey(const Key('inv-credit-phone')),
        '2125550100',
      );
      await tester.pumpAndSettle();
      await _tapKey(tester, 'inv-credit-collector');
      await _tapText(tester, 'Kofi');
      await _tapKey(tester, 'inv-sold');

      final sent = calls.named('recordInventorySale').single;
      expect(sent['receivedByStaffId'], 'u-owner');
      expect((sent['credit'] as Map)['paidNowCents'], 2000);
      expect((sent['credit'] as Map)['collectorStaffId'], 'u-kofi');
    });

    testWidgets('a refused collector reads in words', (tester) async {
      final calls = _Calls()
        ..respond = (name, _) => throw FirebaseFunctionsException(
          message: 'collector',
          code: 'invalid-argument',
          details: {
            'reason': 'collector_invalid',
            'reasons': ['collector_invalid'],
          },
        );
      await _pump(tester, _sell(calls));
      await _tapKey(tester, 'inv-on-credit');
      await tester.enterText(find.byKey(const Key('inv-credit-name')), 'F');
      await tester.enterText(
        find.byKey(const Key('inv-credit-phone')),
        '2125550100',
      );
      await tester.pumpAndSettle();
      await _tapKey(tester, 'inv-credit-collector');
      await _tapText(tester, 'Kofi');
      await _tapKey(tester, 'inv-sold');
      expect(find.text('That person is not in this business.'), findsWidgets);
    });

    testWidgets('French, 320 wide: the credit section fits', (tester) async {
      final calls = _Calls();
      await _pump(
        tester,
        _sell(calls),
        locale: const Locale('fr'),
        size: const Size(320, 2600),
      );
      await _tapKey(tester, 'inv-on-credit');
      await _tapKey(tester, 'inv-sold');
      expect(tester.takeException(), isNull);
      expect(find.text('À crédit'), findsOneWidget);
      expect(find.text('Téléphone du client (facultatif)'), findsWidgets);
      // The phone is optional: no "enter the phone" error.
      expect(
        find.text('Saisissez le numéro de téléphone du client.'),
        findsNothing,
      );
      expect(find.text('Choisissez qui encaisse le reste.'), findsOneWidget);
      expect(find.text(r'Payé maintenant $0.00 · À crédit $60.00'),
          findsOneWidget);
    });
  });

  group('sales list', () {
    testWidgets('a credit sale carries its chip, and the filter narrows', (
      tester,
    ) async {
      final plain = InventorySale.fromMap('plain', {
        'businessId': 'b1',
        'totalCents': 1000,
        'paymentMethod': 'cash',
        'soldByStaffId': 'u-kofi',
        'receivedByStaffId': 'u-me',
      });
      final open = _creditSale('open', due: '2026-10-10');
      final paid = _creditSale('paid', paid: 4000, status: 'paid');
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: _Source(sales: [plain, open, paid]),
          creditSource: _Credits(),
          currentUserId: 'u-me',
          clock: () => _today,
        ),
      );
      expect(find.text(r'Overdue $40.00'), findsOneWidget);
      expect(find.text('Credit paid'), findsWidgets);
      expect(find.textContaining('Received by Ama'), findsOneWidget);
      expect(find.byKey(const Key('inv-sale-credit-open')), findsOneWidget);

      await _tapKey(tester, 'inv-sales-credit-open');
      expect(find.byKey(const Key('inv-sale-open')), findsOneWidget);
      expect(find.byKey(const Key('inv-sale-plain')), findsNothing);
      expect(find.byKey(const Key('inv-sale-paid')), findsNothing);

      await _tapKey(tester, 'inv-credit-open-open');
      expect(find.byKey(const Key('credit-standing')), findsOneWidget);
      expect(find.text(r'$40.00 owed of $40.00'), findsOneWidget);
    });
  });

  group('credit sheet', () {
    Future<_Calls> openSheet(
      WidgetTester tester, {
      InventorySale? sale,
      List<InventoryCreditPayment> payments = const [],
      Object? Function(String, Map<String, Object?>)? respond,
      Locale locale = const Locale('en'),
      Size size = const Size(400, 2600),
      List<Uri>? dialed,
    }) async {
      final calls = _Calls()..respond = respond;
      await _pump(
        tester,
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => showInventoryCreditSheet(
                  context,
                  businessId: 'b1',
                  sale: sale ?? _creditSale('s1', paid: 1500, due: '2026-10-10'),
                  staff: const [
                    LotStaff(id: 'u-owner', name: 'Mariama'),
                    ..._team,
                  ],
                  service: calls.service,
                  creditSource: _Credits(payments: payments),
                  currentUserId: 'u-me',
                  clock: () => _today,
                  dialer: (uri) async {
                    dialed?.add(uri);
                    return true;
                  },
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
        locale: locale,
        size: size,
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      return calls;
    }

    testWidgets('shows who owes, who collects, overdue in red, and calls', (
      tester,
    ) async {
      final dialed = <Uri>[];
      await openSheet(tester, dialed: dialed);
      expect(find.text(r'$25.00 owed of $40.00'), findsOneWidget);
      expect(find.text('Fatou Diallo'), findsOneWidget);
      expect(find.text('Collected by Ama (me)'), findsOneWidget);
      final due = tester.widget<Text>(find.byKey(const Key('credit-due')));
      expect(due.data, 'Overdue since Oct 10, 2026');
      await _tapKey(tester, 'credit-call');
      expect(dialed.single.toString(), 'tel:+12125550100');
    });

    testWidgets('record a payment: refused until complete, then sent', (
      tester,
    ) async {
      final calls = await openSheet(
        tester,
        respond: (name, _) => {
          'success': true,
          'paymentId': 'p1',
          'creditPaidCents': 4000,
          'creditStatus': 'paid',
        },
      );
      await tester.enterText(find.byKey(const Key('credit-amount')), '30');
      await _tapKey(tester, 'credit-record');
      expect(calls.named('recordInventoryCreditPayment'), isEmpty);
      expect(find.text('That is more than what is still owed.'), findsOneWidget);
      expect(
        find.text('Say which staff member took the payment.'),
        findsOneWidget,
      );

      await _tapKey(tester, 'credit-whole-balance');
      await _tapKey(tester, 'credit-received-by');
      await _tapText(tester, 'Mariama');
      await _tapKey(tester, 'credit-record');
      expect(calls.named('recordInventoryCreditPayment').single, {
        'businessId': 'b1',
        'saleId': 's1',
        'amountCents': 2500,
        'method': 'cash',
        'receivedByStaffId': 'u-owner',
      });
      expect(find.text('Paid in full'), findsOneWidget);
      expect(find.byKey(const Key('credit-record')), findsNothing);
    });

    testWidgets('payments history: received by, entered by, revert', (
      tester,
    ) async {
      final calls = await openSheet(
        tester,
        payments: [
          InventoryCreditPayment(
            id: 'p1',
            saleId: 's1',
            amountCents: 1500,
            method: 'zelle',
            receivedByStaffId: 'u-kofi',
            recordedByStaffId: 'u-owner',
            createdAt: DateTime(2026, 10, 5, 9),
          ),
          const InventoryCreditPayment(
            id: 'p0',
            saleId: 's1',
            amountCents: 500,
            method: 'cash',
            reverted: true,
            revertedByStaffId: 'u-owner',
          ),
        ],
        respond: (name, _) => {'success': true, 'creditPaidCents': 0},
      );
      expect(find.textContaining('received by Kofi'), findsOneWidget);
      expect(find.textContaining('entered by Mariama'), findsOneWidget);
      expect(find.text('Reverted by Mariama'), findsOneWidget);
      expect(find.byKey(const Key('pay-revert:p0')), findsNothing);

      await _tapKey(tester, 'pay-revert:p1');
      // The confirmation, then the call.
      await tester.tap(find.text('Revert').last);
      await tester.pumpAndSettle();
      expect(calls.named('revertInventoryCreditPayment').single, {
        'businessId': 'b1',
        'paymentId': 'p1',
      });
      expect(find.text(r'$40.00 owed of $40.00'), findsOneWidget);
    });

    testWidgets('change the collector', (tester) async {
      final calls = await openSheet(tester);
      await _tapKey(tester, 'credit-change');
      await _tapKey(tester, 'credit-edit-collector');
      await _tapText(tester, 'Kofi');
      await _tapKey(tester, 'credit-edit-save');
      expect(calls.named('setInventoryCreditCollector').single, {
        'businessId': 'b1',
        'saleId': 's1',
        'collectorStaffId': 'u-kofi',
      });
      expect(find.text('Collected by Kofi'), findsOneWidget);
    });

    testWidgets('French, 320 wide: the sheet fits', (tester) async {
      await openSheet(
        tester,
        locale: const Locale('fr'),
        size: const Size(320, 1400),
      );
      expect(tester.takeException(), isNull);
      expect(find.text(r'$25.00 dû sur $40.00'), findsOneWidget);
      expect(find.textContaining('En retard depuis le'), findsOneWidget);
    });
  });

  group('Credit owed', () {
    final credits = [
      _creditSale('a', collector: 'u-me', due: '2026-10-30', name: 'Awa'),
      _creditSale('b', collector: 'u-kofi', due: '2026-10-01', name: 'Binta'),
      _creditSale('c', collector: 'u-me', due: '2026-10-12', name: 'Cheikh',
          paid: 1000),
    ];

    testWidgets('staff start on their own; overdue first; totals', (
      tester,
    ) async {
      final source = _Credits(open: credits);
      await _pump(
        tester,
        InventoryCreditScreen(
          businessId: 'b1',
          access: const InventoryAccess(),
          source: _Source(),
          creditSource: source,
          currentUserId: 'u-me',
          clock: () => _today,
        ),
      );
      expect(find.text('Binta'), findsNothing);
      final names = tester
          .widgetList<Text>(find.descendant(
            of: find.byKey(const Key('credit-list')),
            matching: find.byType(Text),
          ))
          .map((t) => t.data)
          .toList();
      expect(names.indexOf('Cheikh'), lessThan(names.indexOf('Awa')));
      expect(find.text(r'$70.00'), findsOneWidget);
      expect(find.text('1 overdue · \$30.00'), findsOneWidget);

      await _tapKey(tester, 'credit-collector-all');
      expect(find.text('Binta'), findsOneWidget);
      expect(find.text(r'$110.00'), findsOneWidget);
      // A collector of their own appears as a choice.
      await _tapKey(tester, 'credit-collector-u-kofi');
      expect(find.text('Awa'), findsNothing);
      expect(find.text('Binta'), findsOneWidget);

      // A row opens its credit sheet.
      await _tapText(tester, 'Binta');
      expect(find.byKey(const Key('credit-standing')), findsOneWidget);
    });

    testWidgets('the owner starts on everyone; nothing owed says so', (
      tester,
    ) async {
      await _pump(
        tester,
        InventoryCreditScreen(
          businessId: 'b1',
          source: _Source(),
          creditSource: _Credits(),
          currentUserId: 'u-owner',
          clock: () => _today,
        ),
      );
      expect(find.byKey(const Key('credit-empty')), findsOneWidget);
      final everyone = tester.widget<ChoiceChip>(
        find.byKey(const Key('credit-collector-all')),
      );
      expect(everyone.selected, isTrue);
    });

    testWidgets('staff of one store read that store only', (tester) async {
      final source = _Credits(open: credits);
      await _pump(
        tester,
        InventoryCreditScreen(
          businessId: 'b1',
          access: const InventoryAccess(homeStoreId: 's-bk'),
          source: _Source(
            stores: const [
              InventoryStore(id: 's-main', name: 'Main store'),
              InventoryStore(id: 's-bk', name: 'Brooklyn'),
            ],
          ),
          creditSource: source,
          currentUserId: 'u-me',
          clock: () => _today,
        ),
      );
      expect(source.openStores, ['s-bk']);
    });

    testWidgets('French, 320 wide', (tester) async {
      await _pump(
        tester,
        InventoryCreditScreen(
          businessId: 'b1',
          source: _Source(),
          creditSource: _Credits(open: credits),
          currentUserId: 'u-me',
          clock: () => _today,
        ),
        locale: const Locale('fr'),
        size: const Size(320, 1400),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Crédit dû'), findsWidgets);
      expect(find.textContaining('3 crédits ouverts'), findsOneWidget);
    });
  });
}

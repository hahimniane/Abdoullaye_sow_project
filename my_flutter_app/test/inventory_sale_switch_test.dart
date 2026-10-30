import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/inventory_sales_screen.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_credit.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/theme/app_theme.dart';

/// Switching a recorded sale between paid and credit (docs/INVENTORY.md v6):
/// the pure half (who is offered what, the defaults, the request, the
/// answer, the history entry) and the sale card + sheet on screen, English
/// and French, at 320 wide. Callables are a recorder.

final _today = DateTime(2026, 10, 20, 14);

const _team = [
  LotStaff(id: 'u-me', name: 'Ama'),
  LotStaff(id: 'u-kofi', name: 'Kofi'),
];

Map<String, Object?> _lines() => {
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
};

InventorySale _paid(
  String id, {
  bool voided = false,
  String method = 'zelle',
  List<Map<String, Object?>> switches = const [],
}) => InventorySale.fromMap(id, {
  'businessId': 'b1',
  'totalCents': 6000,
  'paymentMethod': method,
  'soldByStaffId': 'u-kofi',
  'receivedByStaffId': 'u-kofi',
  'paidNowCents': 6000,
  'creditCents': 0,
  'creditStatus': 'none',
  'voided': voided,
  'createdAt': DateTime(2026, 10, 2, 11),
  'paymentSwitches': switches,
  ..._lines(),
});

InventorySale _credit(
  String id, {
  int collected = 0,
  String method = 'cash',
  int paidNow = 2000,
  List<Map<String, Object?>> switches = const [],
}) => InventorySale.fromMap(id, {
  'businessId': 'b1',
  'totalCents': 6000,
  'paymentMethod': method,
  'soldByStaffId': 'u-kofi',
  'receivedByStaffId': 'u-me',
  'paidNowCents': paidNow,
  'creditCents': 6000 - paidNow,
  'creditPaidCents': collected,
  'creditStatus': collected >= 6000 - paidNow ? 'paid' : 'open',
  'createdAt': DateTime(2026, 10, 2, 11),
  'credit': {
    'customerName': 'Fatou Diallo',
    'customerPhone': '',
    'collectorStaffId': 'u-me',
    'dueDate': '',
  },
  'paymentSwitches': switches,
  ..._lines(),
});

Map<String, Object?> _switchEntry({
  String to = 'credit',
  String by = 'u-me',
  String fromMethod = 'zelle',
}) => {
  'requestId': 'req-12345678',
  'from': to == 'credit' ? 'paid' : 'credit',
  'to': to,
  'byStaffId': by,
  'at': DateTime(2026, 10, 20, 15, 15),
  'totalCents': 6000,
  'fromPaidNowCents': to == 'credit' ? 6000 : 2000,
  'fromCreditCents': to == 'credit' ? 0 : 4000,
  'toPaidNowCents': to == 'credit' ? 2000 : 6000,
  'toCreditCents': to == 'credit' ? 4000 : 0,
  'fromPaymentMethod': fromMethod,
  'toPaymentMethod': to == 'credit' ? 'zelle' : 'cash',
  'customerName': 'Fatou Diallo',
};

class _Source implements InventorySource {
  _Source(this.sales);

  final List<InventorySale> sales;

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
      Stream.value(const []);

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
  List<InventorySale> sales,
  _Calls calls, {
  Locale locale = const Locale('en'),
  double width = 320,
}) async {
  tester.view.physicalSize = Size(width, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  var ids = 0;
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: InventorySalesScreen(
        businessId: 'b1',
        source: _Source(sales),
        creditSource: _Credits(),
        service: calls.service,
        currentUserId: 'u-me',
        clock: () => _today,
        newRequestId: () => 'req-switch-${++ids}',
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapKey(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

Future<void> _tapText(WidgetTester tester, String text) async {
  await tester.ensureVisible(find.text(text).last);
  await tester.tap(find.text(text).last);
  await tester.pumpAndSettle();
}

Future<void> _fillCredit(WidgetTester tester) async {
  await tester.enterText(find.byKey(const Key('inv-credit-paid-now')), '20');
  await tester.enterText(
    find.byKey(const Key('inv-credit-name')),
    'Fatou Diallo',
  );
  await tester.pumpAndSettle();
  await _tapKey(tester, 'inv-credit-collector');
  await _tapText(tester, 'Kofi');
}

void main() {
  group('pure', () {
    test('a paid sale is offered credit; a credit sale with nothing '
        'collected is offered paid', () {
      expect(inventorySaleCanSwitchToCredit(_paid('a')), isTrue);
      expect(inventorySaleCanSwitchToPaid(_paid('a')), isFalse);
      expect(inventorySaleCanSwitchToCredit(_paid('a', voided: true)), isFalse);
      expect(inventorySaleCanSwitchToPaid(_credit('c')), isTrue);
      expect(inventorySaleCanSwitchToCredit(_credit('c')), isFalse);
      // Money came in since: Record payment, not Switch to paid.
      expect(
        inventorySaleCanSwitchToPaid(_credit('c', collected: 100)),
        isFalse,
      );
      // Paid off by payments is still not "never credit".
      expect(
        inventorySaleCanSwitchToPaid(_credit('c', collected: 4000)),
        isFalse,
      );
      // A giveaway owes nothing.
      final free = InventorySale.fromMap('f', {
        'businessId': 'b1',
        'totalCents': 0,
        'paymentMethod': 'cash',
        'soldByStaffId': 'u',
      });
      expect(inventorySaleCanSwitchToCredit(free), isFalse);
    });

    test('Switch to paid starts on the sale\'s method and receiver', () {
      expect(inventorySwitchDefaultMethod(_credit('c')), 'cash');
      // Put on credit with nothing paid: the method it had before.
      final none = _credit(
        'c',
        method: '',
        paidNow: 0,
        switches: [_switchEntry(fromMethod: 'venmo')],
      );
      expect(inventorySwitchDefaultMethod(none), 'venmo');
      expect(inventorySwitchDefaultMethod(_credit('c', method: '')), 'cash');
      expect(inventorySwitchDefaultReceiver(_credit('c')), 'u-me');
      // An old sale: the seller took it.
      final old = InventorySale.fromMap('o', {
        'totalCents': 100,
        'creditCents': 50,
        'soldByStaffId': 'u-kofi',
      });
      expect(inventorySwitchDefaultReceiver(old), 'u-kofi');
    });

    test('Switch to paid needs a method and a person of the business', () {
      expect(
        validateInventorySwitchToPaid(method: 'cash', receivedByStaffId: 'u'),
        isEmpty,
      );
      expect(
        validateInventorySwitchToPaid(method: 'gold', receivedByStaffId: ''),
        ['payment_method_invalid', 'received_by_required'],
      );
      expect(
        validateInventorySwitchToPaid(
          method: 'cash',
          receivedByStaffId: 'u-x',
          staffIds: ['u-me'],
        ),
        ['received_by_invalid'],
      );
    });

    test('the requests carry only their direction\'s fields', () {
      expect(
        switchInventorySalePaymentRequest(
          businessId: ' b1 ',
          saleId: 's1',
          clientRequestId: 'req-1',
          to: 'credit',
          credit: {'paidNowCents': 0},
        ),
        {
          'businessId': 'b1',
          'saleId': 's1',
          'clientRequestId': 'req-1',
          'to': 'credit',
          'credit': {'paidNowCents': 0},
        },
      );
      expect(
        switchInventorySalePaymentRequest(
          businessId: 'b1',
          saleId: 's1',
          clientRequestId: 'req-1',
          to: 'paid',
          paymentMethod: 'zelle',
          receivedByStaffId: 'u-me',
        ),
        {
          'businessId': 'b1',
          'saleId': 's1',
          'clientRequestId': 'req-1',
          'to': 'paid',
          'paymentMethod': 'zelle',
          'receivedByStaffId': 'u-me',
        },
      );
    });

    test('the answer and the history entries read safely', () {
      final result = InventorySaleSwitchResult.fromCallable({
        'to': 'credit',
        'replayed': true,
        'paidNowCents': 2000,
        'creditCents': 4000,
        'creditStatus': 'open',
      });
      expect(
        [result.to, result.replayed, result.creditCents, result.creditStatus],
        ['credit', true, 4000, 'open'],
      );
      final sale = _paid(
        'a',
        switches: [
          _switchEntry(),
          _switchEntry(to: 'paid'),
        ],
      );
      expect(sale.paymentSwitches.map((e) => e.to), ['credit', 'paid']);
      expect(sale.paymentSwitches.first.toCredit, isTrue);
      expect(sale.paymentSwitches.first.at, DateTime(2026, 10, 20, 15, 15));
      final junk = InventorySale.fromMap('j', {
        'paymentSwitches': [
          'x',
          null,
          {'to': 'weird', 'toCreditCents': -5},
        ],
      });
      expect(junk.paymentSwitches.single.to, 'paid');
      expect(junk.paymentSwitches.single.toCreditCents, 0);
      expect(
        inventoryFailureOf(
          code: 'failed-precondition',
          details: {'reason': 'credit_payments_recorded'},
        ),
        InventoryFailure.creditPaymentsRecorded,
      );
    });
  });

  group('on screen', () {
    testWidgets('Switch to credit: the credit questions, a confirmation, '
        'then the request', (tester) async {
      final calls = _Calls()
        ..respond = (name, _) => {
          'success': true,
          'to': 'credit',
          'paidNowCents': 2000,
          'creditCents': 4000,
          'creditStatus': 'open',
        };
      await _pump(tester, [_paid('s1'), _credit('s2')], calls);
      expect(find.text('Switch to credit'), findsOneWidget);
      expect(find.text('Switch to paid'), findsOneWidget);
      await _tapKey(tester, 'inv-switch-s1');
      expect(find.text('Put this sale on credit'), findsOneWidget);
      expect(
        find.text('How much did they pay at the time? (US dollars)'),
        findsOneWidget,
      );
      // Nothing filled: every missing part is said, nothing is sent.
      await _tapKey(tester, 'inv-switch-submit');
      expect(calls.log, isEmpty);
      expect(find.text("Enter the customer's name."), findsOneWidget);
      expect(find.text('Choose who collects the rest.'), findsOneWidget);
      // Everything paid at the time is not credit.
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
      await _fillCredit(tester);
      expect(find.text(r'Paid now $20.00 · On credit $40.00'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _tapKey(tester, 'inv-switch-submit');
      // Confirm first.
      expect(find.text('Put this sale on credit?'), findsOneWidget);
      expect(calls.log, isEmpty);
      await _tapText(tester, 'Switch to credit');
      final sent = calls.named('switchInventorySalePayment').single;
      expect(sent, {
        'businessId': 'b1',
        'saleId': 's1',
        'clientRequestId': 'req-switch-1',
        'to': 'credit',
        'credit': {
          'paidNowCents': 2000,
          'customerName': 'Fatou Diallo',
          'customerPhone': '',
          'collectorStaffId': 'u-kofi',
          'dueDate': '',
        },
      });
      expect(find.text(r'Switched to credit: $40.00 owed'), findsOneWidget);
    });

    testWidgets('Switch to paid starts on the sale and keeps one request id '
        'across a retry', (tester) async {
      final calls = _Calls();
      var fail = true;
      calls.respond = (name, _) {
        if (fail) {
          fail = false;
          throw FirebaseFunctionsException(
            message: 'offline',
            code: 'unavailable',
          );
        }
        return {'success': true, 'to': 'paid', 'creditCents': 0};
      };
      await _pump(tester, [_credit('s2')], calls);
      await _tapKey(tester, 'inv-switch-s2');
      expect(find.text('Mark this sale as paid'), findsOneWidget);
      expect(
        find.text(
          r'It was never credit: the whole $60.00 was paid at the time of '
          'the sale.',
        ),
        findsOneWidget,
      );
      // Prefilled from the sale: cash, received by me.
      expect(find.text('Cash'), findsWidgets);
      expect(find.text('Ama (me)'), findsOneWidget);
      await _tapKey(tester, 'inv-switch-received-by');
      await _tapText(tester, 'Kofi');
      await _tapKey(tester, 'inv-switch-submit');
      expect(find.text('Mark this sale as paid?'), findsOneWidget);
      await _tapText(tester, 'Switch to paid');
      expect(find.byKey(const Key('inv-switch-server-note')), findsOneWidget);
      // Same answers again: the same request id (a retry, never twice).
      await _tapKey(tester, 'inv-switch-submit');
      await _tapText(tester, 'Switch to paid');
      final sent = calls.named('switchInventorySalePayment');
      expect(sent, hasLength(2));
      expect(sent[0]['clientRequestId'], sent[1]['clientRequestId']);
      expect(sent[1]['to'], 'paid');
      expect(sent[1]['paymentMethod'], 'cash');
      expect(sent[1]['receivedByStaffId'], 'u-kofi');
      expect(find.text('Switched to paid'), findsOneWidget);
    });

    testWidgets('Received by offers Business account first and sends it', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (name, _) => {'success': true, 'to': 'paid'};
      await _pump(tester, [_credit('s2')], calls);
      await _tapKey(tester, 'inv-switch-s2');
      await _tapKey(tester, 'inv-switch-received-by');
      // The picker lists the business account before the team.
      final business = tester.getTopLeft(find.text('Business account'));
      final first = tester.getTopLeft(find.text('Ama (me)').last);
      expect(business.dy, lessThan(first.dy));
      await _tapText(tester, 'Business account');
      expect(find.text('Business account'), findsOneWidget);
      await _tapKey(tester, 'inv-switch-submit');
      await _tapText(tester, 'Switch to paid');
      expect(
        calls.named('switchInventorySalePayment').single['receivedByStaffId'],
        'business_account',
      );
    });

    testWidgets('a refusal reads in words and points to Record payment', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (name, _) => throw FirebaseFunctionsException(
          message: 'payments',
          code: 'failed-precondition',
          details: {
            'reason': 'credit_payments_recorded',
            'reasons': ['credit_payments_recorded'],
          },
        );
      await _pump(tester, [_credit('s2')], calls, width: 400);
      await _tapKey(tester, 'inv-switch-s2');
      await _tapKey(tester, 'inv-switch-submit');
      await _tapText(tester, 'Switch to paid');
      expect(
        find.textContaining('Use Record a payment for what is still owed.'),
        findsOneWidget,
      );
    });

    testWidgets('nothing is offered on a voided sale or once money came in; '
        'the history line shows', (tester) async {
      await _pump(tester, [
        _paid('v', voided: true, switches: [_switchEntry()]),
        _credit('m', collected: 1000),
      ], _Calls());
      expect(find.byKey(const Key('inv-switch-v')), findsNothing);
      expect(find.byKey(const Key('inv-switch-m')), findsNothing);
      expect(find.byKey(const Key('inv-sale-switch-v-0')), findsOneWidget);
      expect(
        find.textContaining(
          RegExp(
            r'^Switched to credit by Ama · Oct 20, 2026,? 3:15\sPM · '
            r'\$20\.00 paid, \$40\.00 owed$',
          ),
        ),
        findsOneWidget,
      );
    });

    testWidgets('French, 320 wide: the card, both sheets and the history fit', (
      tester,
    ) async {
      await _pump(
        tester,
        [
          _paid(
            's1',
            switches: [
              _switchEntry(),
              _switchEntry(to: 'paid'),
            ],
          ),
          _credit('s2'),
        ],
        _Calls(),
        locale: const Locale('fr'),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Passer à crédit'), findsOneWidget);
      expect(find.text('Passer en payée'), findsOneWidget);
      expect(
        find.textContaining(
          RegExp(r'^Passée à crédit par Ama · 20 oct\. 2026.* payés, .* dus$'),
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining(RegExp(r'^Passée en payée par Ama · ')),
        findsOneWidget,
      );
      await _tapKey(tester, 'inv-switch-s1');
      expect(find.text('Passer cette vente à crédit'), findsOneWidget);
      await _tapKey(tester, 'inv-switch-submit');
      expect(find.text('Choisissez qui encaisse le reste.'), findsOneWidget);
      expect(tester.takeException(), isNull);
      Navigator.of(
        tester.element(find.byKey(const Key('inv-switch-submit'))),
      ).pop();
      await tester.pumpAndSettle();
      await _tapKey(tester, 'inv-switch-s2');
      expect(find.text('Marquer cette vente comme payée'), findsOneWidget);
      expect(find.text('Mode de paiement'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  });
}

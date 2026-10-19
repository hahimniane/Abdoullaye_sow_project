import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/inventory_transfer_compose_screen.dart';
import 'package:my_flutter_app/screens/inventory_transfer_receive_screen.dart';
import 'package:my_flutter_app/screens/inventory_screen.dart';
import 'package:my_flutter_app/screens/inventory_transfers_screen.dart';
import 'package:my_flutter_app/screens/shop_home_section.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/inventory_transfers.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The store transfer screens as a shop meets them: the list and its tabs,
/// New transfer (capped at what the store holds, Save draft, Send), the
/// receive screen and its "didn't arrive" sheet, the owner's review, the
/// detail's actions by permission, and a notification tap. Firebase is
/// replaced by fake sources and a recording caller.

const _bronx = InventoryStore(id: 's-bx', name: 'Bronx store', isMain: true);
const _harlem = InventoryStore(id: 's-hl', name: 'Harlem store');
const _stores = [_bronx, _harlem];
const _bronxStaff = InventoryAccess(homeStoreId: 's-bx');
const _harlemStaff = InventoryAccess(homeStoreId: 's-hl');

final _jordan = InventoryItem(
  id: 'i1',
  businessId: 'b1',
  name: '11',
  brand: 'Jordan',
  code: 'IT-K7M4P2',
  priceCents: 12000,
  quantity: 5,
  storeStock: true,
);
final _hoodie = InventoryItem(
  id: 'i2',
  businessId: 'b1',
  name: 'Tech hoodie',
  brand: 'Nike',
  code: 'IT-CCCCCC',
  priceCents: 9000,
  quantity: 12,
  storeStock: true,
);

/// Jordan 11: 3 in Bronx, 2 in Harlem. Hoodie: 12 in Bronx.
const _stock = [
  InventoryStockRow(itemId: 'i1', storeId: 's-bx', quantity: 3),
  InventoryStockRow(itemId: 'i1', storeId: 's-hl', quantity: 2),
  InventoryStockRow(itemId: 'i2', storeId: 's-bx', quantity: 12),
];

class _Source implements InventorySource {
  _Source({this.items = const [], this.stores = _stores});

  final List<InventoryItem> items;
  final List<InventoryStore> stores;
  final List<InventoryStockRow> stock = _stock;

  @override
  Stream<List<InventoryItem>> watchItems(String businessId) =>
      Stream.value(items);

  @override
  Future<InventoryItem?> findItemByCode(String businessId, String code) async {
    for (final i in items) {
      if (i.code == code) return i;
    }
    return null;
  }

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
      Stream.value(stores);

  @override
  Stream<List<InventoryStockRow>> watchStock(
    String businessId, {
    String storeId = '',
  }) => Stream.value([
    for (final r in stock)
      if (storeId.isEmpty || r.storeId == storeId) r,
  ]);

  @override
  Stream<List<LotStaff>> watchStaff(String businessId) =>
      Stream.value(const []);
}

class _Transfers implements InventoryTransferSource {
  _Transfers(this.rows, {this.denied = const {}, this.hangs = false});

  final List<InventoryTransfer> rows;
  final Set<String> denied;
  final bool hangs;
  final List<String> openStores = [];
  final List<String> lookups = [];

  bool _open(InventoryTransfer t) => t.stage != InventoryTransferStage.done;

  bool _at(InventoryTransfer t, String storeId) =>
      storeId.isEmpty || t.fromStoreId == storeId || t.toStoreId == storeId;

  @override
  Stream<List<InventoryTransfer>> watchOpenTransfers(
    String businessId, {
    String storeId = '',
  }) {
    openStores.add(storeId);
    return Stream.value([
      for (final t in rows)
        if (_open(t) && _at(t, storeId)) t,
    ]);
  }

  @override
  Stream<List<InventoryTransfer>> watchRecentTransfers(
    String businessId, {
    String storeId = '',
  }) => Stream.value([
    for (final t in rows)
      if (_at(t, storeId)) t,
  ]);

  @override
  Stream<InventoryTransfer?> watchTransfer(
    String businessId,
    String transferId,
  ) {
    lookups.add(transferId);
    if (hangs) return StreamController<InventoryTransfer?>().stream;
    if (denied.contains(transferId)) {
      return Stream.error(StateError('permission-denied'));
    }
    for (final t in rows) {
      if (t.id == transferId) return Stream.value(t);
    }
    return Stream.value(null);
  }
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

final _sentAt = DateTime(2026, 10, 18, 14, 40);
final _now = DateTime(2026, 10, 18, 17);

InventoryTransfer _transfer(
  String id, {
  String status = 'in_transit',
  String stage = 'in_transit',
  String from = 's-bx',
  String to = 's-hl',
  String sentBy = 'u-ibrahima',
  List<Map<String, Object?>>? lines,
  int openMissing = 0,
  String receiveNote = '',
}) => InventoryTransfer.fromMap(id, {
  'businessId': 'b1',
  'clientRequestId': 'transfer-key-$id',
  'code': 'TR-${id.toUpperCase()}',
  'status': status,
  'stage': stage,
  'fromStoreId': from,
  'toStoreId': to,
  'fromStoreName': from == 's-bx' ? 'Bronx store' : 'Harlem store',
  'toStoreName': to == 's-bx' ? 'Bronx store' : 'Harlem store',
  'lines':
      lines ??
      [
        {
          'itemId': 'i1',
          'name': '11',
          'brand': 'Jordan',
          'code': 'IT-K7M4P2',
          'quantitySent': 6,
        },
        {
          'itemId': 'i2',
          'name': 'Tech hoodie',
          'brand': 'Nike',
          'code': 'IT-CCCCCC',
          'quantitySent': 8,
        },
      ],
  'openMissingCount': openMissing,
  'sentByStaffId': sentBy,
  'sentByName': 'Ibrahima',
  'sentAt': _sentAt,
  'createdByStaffId': sentBy,
  'createdAt': _sentAt,
  'updatedAt': _sentAt,
  'receivedByName': 'Aminata',
  'receivedAt': status.startsWith('received') ? _sentAt : null,
  'receiveNote': receiveNote,
  'timeline': [
    {'event': 'sent', 'byName': 'Ibrahima', 'at': _sentAt, 'itemsCount': 14},
  ],
});

InventoryTransfer _review() => _transfer(
  'rv1',
  status: 'received_with_differences',
  stage: 'review',
  openMissing: 2,
  receiveNote: 'Box arrived opened',
  lines: [
    {
      'itemId': 'i1',
      'name': '11',
      'brand': 'Jordan',
      'quantitySent': 6,
      'quantityReceived': 4,
      'missing': 2,
    },
    {
      'itemId': 'i2',
      'name': 'Tech hoodie',
      'brand': 'Nike',
      'quantitySent': 8,
      'quantityReceived': 8,
      'missing': 0,
    },
  ],
);

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(400, 2000),
  bool settle = true,
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
  if (settle) await tester.pumpAndSettle();
}

Widget _list({
  required _Transfers transfers,
  _Calls? calls,
  InventoryAccess access = const InventoryAccess.owner(),
  String userId = 'u-me',
  String? transferId,
  _Source? source,
}) {
  var n = 0;
  return InventoryTransfersScreen(
    businessId: 'b1',
    source: source ?? _Source(items: [_jordan, _hoodie]),
    transferSource: transfers,
    service: (calls ?? _Calls()).service,
    access: access,
    currentUserId: userId,
    transferId: transferId,
    clock: () => _now,
    newRequestId: () => 'key-${++n}',
    cameraEnabled: false,
  );
}

InventoryTransferEnv _env(
  _Calls calls, {
  InventoryAccess access = const InventoryAccess.owner(),
  List<InventoryTransfer> rows = const [],
}) {
  var n = 0;
  return InventoryTransferEnv(
    businessId: 'b1',
    source: _Source(items: [_jordan, _hoodie]),
    transfers: _Transfers(rows),
    service: calls.service,
    access: access,
    userId: 'u-me',
    clock: () => _now,
    newRequestId: () => 'req-${++n}',
    cameraEnabled: false,
  );
}

String _text(WidgetTester tester, Key key) =>
    tester.widget<Text>(find.byKey(key)).data!;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('the list', () {
    final rows = [
      _transfer('out1'),
      _transfer('dr1', status: 'draft', stage: 'draft'),
      _transfer('in1', from: 's-hl', to: 's-bx'),
      _transfer('done1', status: 'received', stage: 'done'),
    ];

    testWidgets('one store: tabs with counts, cards, and only its own reads', (
      tester,
    ) async {
      final transfers = _Transfers([...rows, _review()]);
      await _pump(tester, _list(transfers: transfers, access: _bronxStaff));
      // Staff of one store read only what goes from or to it.
      expect(transfers.openStores, ['s-bx']);
      expect(find.text('Outgoing · 1'), findsOneWidget);
      expect(find.text('Incoming · 1'), findsOneWidget);
      expect(find.text('In transit · 2'), findsOneWidget);
      // Review carries its count as a badge (the review is from Bronx).
      expect(find.text('Review'), findsOneWidget);
      // Outgoing: the draft first, then in transit, then the rest.
      final order = [
        for (final id in ['dr1', 'out1', 'done1', 'rv1'])
          tester.getTopLeft(find.byKey(ValueKey('inv-tr-card-$id'))).dy,
      ];
      expect(order, [...order]..sort());
      expect(
        find.text('14 items · not sent · nothing reserved yet'),
        findsOneWidget,
      );
      // US style, month first, 12-hour.
      expect(
        find.textContaining(
          RegExp(r'^14 items · 2 products · sent Oct 18 2:40\sPM by Ibrahima$'),
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('inv-tr-tab-incoming')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('inv-tr-card-in1')), findsOneWidget);
      expect(find.byKey(const ValueKey('inv-tr-card-out1')), findsNothing);
      expect(find.byKey(const Key('inv-tr-new')), findsOneWidget);
    });

    testWidgets('a business with one store shows nothing to do', (
      tester,
    ) async {
      await _pump(
        tester,
        _list(
          transfers: _Transfers(rows),
          source: _Source(stores: const [_bronx]),
        ),
      );
      expect(find.byKey(const Key('inv-tr-single-store')), findsOneWidget);
      expect(find.byKey(const Key('inv-tr-new')), findsNothing);
      expect(find.byKey(const Key('inv-tr-tab-review')), findsNothing);
    });

    testWidgets('staff with no store yet see a note, and nothing is read', (
      tester,
    ) async {
      final transfers = _Transfers(rows);
      await _pump(
        tester,
        _list(transfers: transfers, access: const InventoryAccess()),
      );
      expect(find.byKey(const Key('inv-tr-home-missing')), findsOneWidget);
      expect(transfers.openStores, isEmpty);
    });

    testWidgets('the owner sees every store with a filter, and Review', (
      tester,
    ) async {
      await _pump(tester, _list(transfers: _Transfers([...rows, _review()])));
      expect(find.byKey(const Key('inv-tr-store-all')), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-tr-tab-review')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('inv-tr-card-rv1')), findsOneWidget);
      expect(find.text('Needs review'), findsOneWidget);
      expect(find.text('12 of 14 received · 2 missing'), findsOneWidget);
    });

    testWidgets('French at 320 wide', (tester) async {
      await _pump(
        tester,
        _list(transfers: _Transfers([...rows, _review()]), access: _bronxStaff),
        locale: const Locale('fr'),
        size: const Size(320, 1400),
      );
      expect(find.text('Transferts'), findsOneWidget);
      expect(find.text('Sortants · 1'), findsOneWidget);
      expect(find.text('Brouillon'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('a notification tap', () {
    testWidgets('opens the receive screen for the destination\'s staff', (
      tester,
    ) async {
      final transfers = _Transfers([_transfer('t1')]);
      await _pump(
        tester,
        _list(transfers: transfers, access: _harlemStaff, transferId: 't1'),
      );
      expect(transfers.lookups, ['t1']);
      expect(find.text('Receive transfer'), findsOneWidget);
      expect(find.text('14 items from Bronx store'), findsOneWidget);
    });

    testWidgets('opens the review for the owner', (tester) async {
      await _pump(
        tester,
        _list(transfers: _Transfers([_review()]), transferId: 'rv1'),
      );
      expect(find.byKey(const Key('inv-tr-return-i1')), findsOneWidget);
    });

    testWidgets('a transfer that is gone or refused leaves the list with a '
        'note', (tester) async {
      await _pump(
        tester,
        _list(transfers: _Transfers(const []), transferId: 'nope'),
      );
      expect(find.text('That transfer is not available.'), findsOneWidget);
    });

    testWidgets('a transfer the rules refuse leaves the list with the note', (
      tester,
    ) async {
      await _pump(
        tester,
        _list(
          transfers: _Transfers([_transfer('t1')], denied: {'t1'}),
          access: _harlemStaff,
          transferId: 't1',
        ),
      );
      expect(find.text('That transfer is not available.'), findsOneWidget);
      expect(find.text('Receive transfer'), findsNothing);
    });

    testWidgets('another store\'s transfer is never shown', (tester) async {
      // Harlem staff, a Bronx -> elsewhere draft: not theirs to see.
      await _pump(
        tester,
        _list(
          transfers: _Transfers([
            _transfer('dr', status: 'draft', stage: 'draft'),
          ]),
          access: _harlemStaff,
          transferId: 'dr',
        ),
      );
      expect(find.text('That transfer is not available.'), findsOneWidget);
      expect(find.text('Continue'), findsNothing);
    });

    testWidgets('no answer within 15 s: the list, with the note', (
      tester,
    ) async {
      await _pump(
        tester,
        _list(transfers: _Transfers(const [], hangs: true), transferId: 't9'),
        settle: false,
      );
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('That transfer is not available.'), findsNothing);
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();
      expect(find.text('That transfer is not available.'), findsOneWidget);
    });
  });

  group('new transfer', () {
    Widget compose(
      _Calls calls, {
      InventoryAccess access = _bronxStaff,
      InventoryTransfer? draft,
    }) => InventoryTransferComposeScreen(
      businessId: 'b1',
      source: _Source(items: [_jordan, _hoodie]),
      service: calls.service,
      access: access,
      draft: draft,
      newRequestId: () => 'transfer-new-1',
      cameraEnabled: false,
    );

    Future<void> addJordan(WidgetTester tester) async {
      await tester.enterText(find.byKey(const Key('inv-tr-find')), 'jordan');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('inv-tr-hit-i1')));
      await tester.pumpAndSettle();
    }

    Future<void> pickHarlem(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('inv-tr-to')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Harlem store').last);
      await tester.pumpAndSettle();
    }

    testWidgets('staff send from their store; the + stops at what it holds; '
        'Send sends exactly that', (tester) async {
      final calls = _Calls()
        ..respond = (name, _) => {
          'success': true,
          'transferId': 't1',
          'code': 'TR-4K8Q2A',
          'status': 'in_transit',
          'itemsCount': 3,
          'productsCount': 1,
          'replayed': false,
        };
      await _pump(tester, compose(calls));
      // From is fixed to the home store.
      expect(
        find.descendant(
          of: find.byKey(const Key('inv-tr-from')),
          matching: find.text('Bronx store'),
        ),
        findsOneWidget,
      );
      await pickHarlem(tester);
      await addJordan(tester);
      expect(find.text('3 in Bronx store'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-tr-qty-i1-plus')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('inv-tr-qty-i1-plus')));
      await tester.pumpAndSettle();
      expect(_text(tester, const Key('inv-tr-qty-i1-value')), '3');
      expect(find.text('Only 3 in Bronx store'), findsOneWidget);
      expect(
        find.text(
          "That's all of them. You can't send more than the store has.",
        ),
        findsOneWidget,
      );
      final plus = tester.widget<IconButton>(
        find.byKey(const Key('inv-tr-qty-i1-plus')),
      );
      expect(plus.onPressed, isNull);
      await tester.tap(find.byKey(const Key('inv-tr-qty-i1-plus')));
      await tester.pumpAndSettle();
      expect(_text(tester, const Key('inv-tr-qty-i1-value')), '3');
      expect(_text(tester, const Key('inv-tr-summary')), '1 product · 3 items');
      expect(find.text('Send 3 items'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-tr-send')));
      await tester.pumpAndSettle();
      expect(calls.named('sendInventoryTransfer').single, {
        'businessId': 'b1',
        'clientRequestId': 'transfer-new-1',
        'fromStoreId': 's-bx',
        'toStoreId': 's-hl',
        'lines': [
          {'itemId': 'i1', 'quantity': 3},
        ],
      });
      expect(find.text('Sent to Harlem store'), findsOneWidget);
      expect(find.textContaining('3 items are on their way.'), findsOneWidget);
      expect(find.text('TR-4K8Q2A'), findsOneWidget);
    });

    testWidgets('Save draft saves the same key and reserves nothing', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, compose(calls));
      await pickHarlem(tester);
      await addJordan(tester);
      await tester.tap(find.byKey(const Key('inv-tr-save-draft')));
      await tester.pumpAndSettle();
      expect(calls.named('saveInventoryTransferDraft').single, {
        'businessId': 'b1',
        'clientRequestId': 'transfer-new-1',
        'fromStoreId': 's-bx',
        'toStoreId': 's-hl',
        'lines': [
          {'itemId': 'i1', 'quantity': 1},
        ],
      });
      expect(calls.named('sendInventoryTransfer'), isEmpty);
      expect(
        find.text('Draft saved. Nothing is reserved until you send.'),
        findsOneWidget,
      );
    });

    testWidgets('nothing is sent without a destination or a product', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, compose(calls));
      await tester.tap(find.byKey(const Key('inv-tr-send')));
      await tester.pumpAndSettle();
      expect(find.text('Choose the store to send to.'), findsOneWidget);
      await pickHarlem(tester);
      await tester.tap(find.byKey(const Key('inv-tr-send')));
      await tester.pumpAndSettle();
      expect(find.text('Add at least one product.'), findsOneWidget);
      expect(calls.log, isEmpty);
    });

    testWidgets('the server\'s "not that many" refusal lowers the cap', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (name, _) => throw FirebaseFunctionsException(
          message: 'short',
          code: 'failed-precondition',
          details: {
            'reason': 'insufficient_stock',
            'itemIds': ['i1'],
            'available': {'i1': 1},
          },
        );
      await _pump(tester, compose(calls));
      await pickHarlem(tester);
      await addJordan(tester);
      await tester.tap(find.byKey(const Key('inv-tr-qty-i1-plus')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inv-tr-send')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-tr-error')), findsOneWidget);
      expect(find.text('Only 1 in Bronx store'), findsOneWidget);
      // A second Send is refused on the phone: no second call.
      await tester.tap(find.byKey(const Key('inv-tr-send')));
      await tester.pumpAndSettle();
      expect(calls.named('sendInventoryTransfer'), hasLength(1));
    });

    testWidgets('a draft continues with its key, stores and lines', (
      tester,
    ) async {
      final calls = _Calls();
      final draft = _transfer(
        'dr1',
        status: 'draft',
        stage: 'draft',
        lines: [
          {
            'itemId': 'i2',
            'name': 'Tech hoodie',
            'brand': 'Nike',
            'quantitySent': 4,
          },
        ],
      );
      await _pump(tester, compose(calls, draft: draft));
      expect(_text(tester, const Key('inv-tr-qty-i2-value')), '4');
      await tester.tap(find.byKey(const Key('inv-tr-send')));
      await tester.pumpAndSettle();
      expect(
        calls.named('sendInventoryTransfer').single['clientRequestId'],
        'transfer-key-dr1',
      );
    });
  });

  group('receiving', () {
    testWidgets('everything arrived: one tap, every line as sent', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(
        tester,
        InventoryTransferReceiveScreen(
          env: _env(calls, access: _harlemStaff),
          transfer: _transfer('t1'),
        ),
      );
      expect(find.text('14 of 14 arrived'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-tr-confirm-received')));
      await tester.pumpAndSettle();
      expect(calls.named('receiveInventoryTransfer').single, {
        'businessId': 'b1',
        'transferId': 't1',
        'lines': [
          {'itemId': 'i1', 'quantityReceived': 6},
          {'itemId': 'i2', 'quantityReceived': 8},
        ],
        'requestId': 'req-1',
      });
    });

    testWidgets('fewer arrived: the sheet, a note, then the counted numbers', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(
        tester,
        InventoryTransferReceiveScreen(
          env: _env(calls, access: _harlemStaff),
          transfer: _transfer('t1'),
        ),
      );
      await tester.tap(find.byKey(const Key('inv-tr-recv-qty-i1-minus')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('inv-tr-recv-qty-i1-minus')));
      await tester.pumpAndSettle();
      expect(find.text('2 fewer than sent'), findsOneWidget);
      expect(find.text('12 of 14 arrived'), findsOneWidget);
      // The + never passes what was sent.
      expect(
        tester
            .widget<IconButton>(
              find.byKey(const Key('inv-tr-recv-qty-i2-plus')),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byKey(const Key('inv-tr-confirm-received')));
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);
      expect(find.text("2 items didn't arrive"), findsOneWidget);
      expect(
        find.text(
          '12 of 14 arrived. The owner will be told about the missing '
          'ones.',
        ),
        findsOneWidget,
      );
      expect(find.text('Jordan 11: sent 6, counted 4'), findsOneWidget);
      // Go back changes nothing.
      await tester.tap(find.byKey(const Key('inv-tr-missing-back')));
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);
      await tester.tap(find.byKey(const Key('inv-tr-confirm-received')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('inv-tr-missing-note')),
        'Box arrived opened',
      );
      await tester.tap(find.byKey(const Key('inv-tr-missing-confirm')));
      await tester.pumpAndSettle();
      expect(calls.named('receiveInventoryTransfer').single, {
        'businessId': 'b1',
        'transferId': 't1',
        'lines': [
          {'itemId': 'i1', 'quantityReceived': 4},
          {'itemId': 'i2', 'quantityReceived': 8},
        ],
        'note': 'Box arrived opened',
        'requestId': 'req-1',
      });
    });

    testWidgets('a transfer someone else already received says so', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (name, _) => throw FirebaseFunctionsException(
          message: 'no',
          code: 'failed-precondition',
          details: {'reason': 'transfer_not_in_transit', 'status': 'received'},
        );
      await _pump(
        tester,
        InventoryTransferReceiveScreen(
          env: _env(calls, access: _harlemStaff),
          transfer: _transfer('t1'),
        ),
      );
      await tester.tap(find.byKey(const Key('inv-tr-confirm-received')));
      await tester.pumpAndSettle();
      expect(
        find.text('Someone already confirmed this transfer.'),
        findsOneWidget,
      );
      // The screen stays, ready to try again (the same key).
      expect(find.byKey(const Key('inv-tr-confirm-received')), findsOneWidget);
    });

    testWidgets('French: the receive screen and its sheet', (tester) async {
      await _pump(
        tester,
        InventoryTransferReceiveScreen(
          env: _env(_Calls(), access: _harlemStaff),
          transfer: _transfer('t1'),
        ),
        locale: const Locale('fr'),
        size: const Size(320, 1400),
      );
      expect(find.text('Recevoir le transfert'), findsOneWidget);
      expect(find.text('14 articles de Bronx store'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-tr-recv-qty-i1-minus')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inv-tr-confirm-received')));
      await tester.pumpAndSettle();
      expect(find.text('1 article n’est pas arrivé'), findsOneWidget);
      expect(find.text('Confirmer 13 reçus'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('the owner\'s review', () {
    testWidgets('Return sends the missing pieces back to the source', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(
        tester,
        InventoryTransferReviewScreen(env: _env(calls), transfer: _review()),
      );
      expect(find.text('Return to Bronx store'), findsOneWidget);
      expect(find.textContaining('Box arrived opened'), findsWidgets);
      // A complete line has nothing to decide.
      expect(find.byKey(const Key('inv-tr-return-i2')), findsNothing);
      await tester.tap(find.byKey(const Key('inv-tr-return-i1')));
      await tester.pumpAndSettle();
      expect(calls.named('resolveInventoryTransferLine').single, {
        'businessId': 'b1',
        'transferId': 'rv1',
        'itemId': 'i1',
        'action': 'return',
        'requestId': 'req-1',
      });
      expect(find.text('2 returned to Bronx store'), findsOneWidget);
      expect(find.byKey(const Key('inv-tr-review-settled')), findsOneWidget);
    });

    testWidgets('Write off needs a reason, then sends it with the note', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(
        tester,
        InventoryTransferReviewScreen(env: _env(calls), transfer: _review()),
      );
      await tester.tap(find.byKey(const Key('inv-tr-writeoff-i1')));
      await tester.pumpAndSettle();
      final confirm = find.byKey(const Key('inv-tr-writeoff-confirm-i1'));
      await tester.tap(confirm);
      await tester.pumpAndSettle();
      expect(calls.log, isEmpty);
      await tester.tap(find.byKey(const Key('inv-tr-reason-damaged')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('inv-tr-writeoff-note')),
        'Soles torn',
      );
      await tester.tap(confirm);
      await tester.pumpAndSettle();
      expect(calls.named('resolveInventoryTransferLine').single, {
        'businessId': 'b1',
        'transferId': 'rv1',
        'itemId': 'i1',
        'action': 'write_off',
        'reason': 'damaged',
        'note': 'Soles torn',
        'requestId': 'req-1',
      });
      expect(find.text('2 written off · Damaged'), findsOneWidget);
    });
  });

  group('a transfer\'s detail: actions by state and person', () {
    Future<void> openDetail(
      WidgetTester tester,
      InventoryTransfer t, {
      required InventoryAccess access,
      _Calls? calls,
      String userId = 'u-me',
    }) async {
      var n = 0;
      await _pump(
        tester,
        InventoryTransferDetailScreen(
          env: InventoryTransferEnv(
            businessId: 'b1',
            source: _Source(items: [_jordan, _hoodie]),
            transfers: _Transfers([t]),
            service: (calls ?? _Calls()).service,
            access: access,
            userId: userId,
            clock: () => _now,
            newRequestId: () => 'req-${++n}',
            cameraEnabled: false,
          ),
          transfer: t,
        ),
      );
    }

    testWidgets('in transit, the destination: Receive, no Cancel', (
      tester,
    ) async {
      await openDetail(tester, _transfer('t1'), access: _harlemStaff);
      expect(find.byKey(const Key('inv-tr-act-receive')), findsOneWidget);
      expect(find.byKey(const Key('inv-tr-act-cancel')), findsNothing);
      expect(find.byKey(const Key('inv-tr-act-review')), findsNothing);
      expect(
        find.textContaining('Sent by Ibrahima (14 items)'),
        findsOneWidget,
      );
    });

    testWidgets('in transit, someone else of the source: neither', (
      tester,
    ) async {
      await openDetail(tester, _transfer('t1'), access: _bronxStaff);
      expect(find.byKey(const Key('inv-tr-act-receive')), findsNothing);
      expect(find.byKey(const Key('inv-tr-act-cancel')), findsNothing);
    });

    testWidgets('the sender cancels after confirming', (tester) async {
      final calls = _Calls();
      await openDetail(
        tester,
        _transfer('t1', sentBy: 'u-me'),
        access: _bronxStaff,
        calls: calls,
      );
      await tester.tap(find.byKey(const Key('inv-tr-act-cancel')));
      await tester.pumpAndSettle();
      expect(find.text('Cancel this transfer?'), findsOneWidget);
      expect(find.text('14 items go back to Bronx store.'), findsOneWidget);
      await tester.tap(find.text('Cancel transfer').last);
      await tester.pumpAndSettle();
      expect(calls.named('cancelInventoryTransfer').single, {
        'businessId': 'b1',
        'transferId': 't1',
        'requestId': 'req-1',
      });
    });

    testWidgets('in review: the owner reviews, staff only read', (
      tester,
    ) async {
      await openDetail(
        tester,
        _review(),
        access: const InventoryAccess.owner(),
      );
      expect(find.byKey(const Key('inv-tr-act-review')), findsOneWidget);
      expect(find.text('2 missing · disputed'), findsOneWidget);
      expect(find.text('Complete'), findsOneWidget);
      // Received: tags for what arrived.
      expect(find.byKey(const Key('inv-tr-act-tags')), findsOneWidget);
    });

    testWidgets('in review, store staff: no decision to make', (tester) async {
      await openDetail(tester, _review(), access: _harlemStaff);
      expect(find.byKey(const Key('inv-tr-act-review')), findsNothing);
    });

    testWidgets('a draft: Continue and Discard for its store', (tester) async {
      await openDetail(
        tester,
        _transfer('dr1', status: 'draft', stage: 'draft', sentBy: 'u-x'),
        access: _bronxStaff,
      );
      expect(find.byKey(const Key('inv-tr-act-continue')), findsOneWidget);
      expect(find.byKey(const Key('inv-tr-act-discard')), findsOneWidget);
      expect(find.byKey(const Key('inv-tr-act-tags')), findsNothing);
    });
  });

  group('the way in: Transfers, with what is coming and what to review', () {
    Map<String, Object?> summary(String name, Map<String, Object?> _) =>
        name == 'getInventorySummary'
        ? {
            'salesCount': 0,
            'transfers': {
              'inTransitCount': 2,
              'inTransitItems': 14,
              'inTransitValueCents': 56000,
              'disputedCount': 1,
              'disputedItems': 2,
              'disputedValueCents': 8000,
            },
          }
        : <String, Object?>{};

    Widget shop(
      _Transfers transfers, {
      InventoryAccess access = _harlemStaff,
      List<InventoryStore> stores = _stores,
      _Calls? calls,
    }) => Scaffold(
      body: SingleChildScrollView(
        child: ShopHomeSection(
          businessId: 'b1',
          access: access,
          source: _Source(items: [_jordan, _hoodie], stores: stores),
          transferSource: transfers,
          service: (calls ?? _Calls()).service,
          cameraEnabled: false,
          clock: () => _now,
        ),
      ),
    );

    testWidgets('the shop home tile counts Incoming and Review, and opens the '
        'list', (tester) async {
      final transfers = _Transfers([_transfer('t1'), _review()]);
      await _pump(tester, shop(transfers, calls: _Calls()..respond = summary));
      expect(find.byKey(const Key('shop-open-transfers')), findsOneWidget);
      // Harlem staff: one coming in (t1); the review is the owner's call but
      // it is Harlem's transfer, so it counts.
      expect(find.text('Incoming 1 · Review 1'), findsOneWidget);
      expect(
        find.text('In transit \$560.00 · Disputed \$80.00'),
        findsOneWidget,
      );
      await tester.ensureVisible(find.byKey(const Key('shop-open-transfers')));
      await tester.tap(find.byKey(const Key('shop-open-transfers')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-tr-tab-incoming')), findsOneWidget);
    });

    testWidgets('a shop with one store has no Transfers tile and reads none', (
      tester,
    ) async {
      final transfers = _Transfers([_transfer('t1')]);
      await _pump(
        tester,
        shop(
          transfers,
          access: const InventoryAccess.owner(),
          stores: const [_bronx],
        ),
      );
      expect(find.byKey(const Key('shop-open-transfers')), findsNothing);
      expect(transfers.openStores, isEmpty);
    });

    testWidgets('an old server sends no transfer totals: no line', (
      tester,
    ) async {
      await _pump(tester, shop(_Transfers(const [])));
      expect(find.byKey(const Key('shop-today-transfers')), findsNothing);
      expect(find.text('Send stock to another store'), findsOneWidget);
    });

    testWidgets('the Inventory screen: the button and the summary line', (
      tester,
    ) async {
      await _pump(
        tester,
        InventoryScreen(
          businessId: 'b1',
          source: _Source(items: [_jordan, _hoodie]),
          transferSource: _Transfers([_transfer('t1'), _review()]),
          service: (_Calls()..respond = summary).service,
          cameraEnabled: false,
        ),
      );
      expect(find.text('Transfers · Incoming 1 · Review 1'), findsOneWidget);
      expect(
        tester
            .widget<Text>(find.byKey(const Key('inv-summary-transfers')))
            .data,
        'In transit \$560.00 · Disputed \$80.00',
      );
    });
  });
}

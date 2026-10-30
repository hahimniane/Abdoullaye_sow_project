import 'dart:async';
import 'dart:typed_data';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/staff_balances_screen.dart';
import 'package:my_flutter_app/services/business_account_receiver.dart';
import 'package:my_flutter_app/services/inventory_credit.dart';
import 'package:my_flutter_app/services/lot_ledger.dart'
    show formatLotCents, setMoneyDisplayLanguage;
import 'package:my_flutter_app/services/staff_balances.dart';
import 'package:my_flutter_app/services/waiting_packages.dart';
import 'package:my_flutter_app/widgets/received_by_options.dart';

/// Staff balances (docs/STAFF_BALANCES.md): the page rendered from a recorded
/// `staff_balances` answer, the hand-over flow, confirm / decline / void, the
/// owner's opening amount, the "Received by" option, and French at 360 px.
/// Callables are a recorder; nothing here touches Firebase.

final _asOf = DateTime(2026, 10, 29, 15, 5);

Map<String, Object?> _row(
  String id,
  String name, {
  int collected = 0,
  Map<String, Object?> byMethod = const {},
  int handedOut = 0,
  int received = 0,
  int pendingOut = 0,
  int pendingIn = 0,
  int held = 0,
  int parking = 0,
  int credit = 0,
  int owedToThem = 0,
  int net = 0,
}) => {
  'staffId': id,
  'name': name,
  'collectedCents': collected,
  'collectedByMethod': byMethod,
  'handedOutCents': handedOut,
  'receivedFromOthersCents': received,
  'pendingOutCents': pendingOut,
  'pendingInCents': pendingIn,
  'heldCents': held,
  'parkingDueCents': parking,
  'expenseCreditCents': credit,
  'expenseOwedToThemCents': owedToThem,
  'netCents': net,
};

Map<String, Object?> _handover(
  String id,
  String from,
  String to,
  int cents, {
  String method = 'cash',
  String status = 'pending',
  String note = '',
  String proof = '',
  int hour = 9,
}) => {
  'id': id,
  'kind': 'handover',
  'fromStaffId': from,
  'toId': to,
  'amountCents': cents,
  'method': method,
  'status': status,
  'note': note,
  'proofPath': proof,
  'createdByUid': from,
  'createdAt': DateTime(2026, 10, 28, hour).millisecondsSinceEpoch,
};

/// The answer as it came over the wire: Ama (the viewer) owes $242.00, Kofi
/// is owed $100.00, the owner holds $1,350.00.
Map<String, Object?> recordedAnswer() => {
  'asOfMs': _asOf.millisecondsSinceEpoch,
  'staff': [
    _row(
      'owner',
      'Alhoussaine Barry',
      collected: 150000,
      byMethod: {'cash': 100000, 'zelle': 50000},
      handedOut: 20000,
      received: 5000,
      pendingIn: 3000,
      held: 135000,
      parking: 2000,
      net: 137000,
    ),
    _row(
      'kofi',
      'Kofi',
      collected: 8000,
      byMethod: {'cash': 8000},
      handedOut: 3000,
      pendingOut: 3000,
      held: 5000,
      credit: 2500,
      owedToThem: 15000,
      net: -10000,
    ),
    _row('ama', 'Ama', held: 20000, parking: 4200, net: 24200),
  ],
  'businessAccount': {'receivedCents': 20000, 'pendingInCents': 10000},
  'pending': [
    _handover('h1', 'kofi', 'ama', 3000, note: 'Friday cash', hour: 9),
    _handover('h2', 'ama', businessAccountReceiver, 10000, method: 'zelle'),
    _handover('h3', 'kofi', 'owner', 1500, hour: 11),
  ],
};

class _Calls {
  final log = <({String name, Map<String, Object?> payload})>[];
  Object? Function(String action, Map<String, Object?> payload)? respond;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add((name: name, payload: payload));
    final action = '${payload['action']}';
    final custom = respond;
    if (custom != null) {
      final answer = custom(action, payload);
      if (answer != null) return answer;
    }
    return action == 'staff_balances' ? recordedAnswer() : {'success': true};
  }

  List<Map<String, Object?>> actions(String action) => [
    for (final c in log)
      if (c.payload['action'] == action) c.payload,
  ];

  StaffBalancesService get service => StaffBalancesService(caller: call);
}

class _Feed implements StaffHandoverFeed {
  _Feed([this.rows = const []]);

  final List<StaffHandover> rows;

  @override
  Stream<List<StaffHandover>> watch(
    String businessId, {
    bool pendingOnly = false,
  }) => Stream.value([
    for (final h in rows)
      if (!pendingOnly || h.pending) h,
  ]);
}

final _history = [
  StaffHandover.fromMap(
    'old1',
    _handover(
      'old1',
      'kofi',
      'owner',
      9000,
      status: 'confirmed',
      method: 'zelle',
      note: 'September cash',
      hour: 8,
    )..['confirmedAt'] = DateTime(2026, 10, 28, 10).millisecondsSinceEpoch,
  ),
  StaffHandover.fromMap(
    'old2',
    _handover('old2', 'ama', 'owner', 500, status: 'declined', hour: 7)
      ..['declineNote'] = 'Not here'
      ..['declinedAt'] = DateTime(2026, 10, 28, 12).millisecondsSinceEpoch,
  ),
  StaffHandover.fromMap('h1', _handover('h1', 'kofi', 'ama', 3000)),
];

Widget _host(Widget child, {Locale locale = const Locale('en')}) => MaterialApp(
  locale: locale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: child,
);

StaffBalancesScreen _screen(
  _Calls calls, {
  String uid = 'ama',
  bool owner = false,
  HandoverPhotoCapture? capture,
  HandoverPhotoUploader? uploader,
}) => StaffBalancesScreen(
  businessId: 'b1',
  currentUid: uid,
  isOwner: owner,
  service: calls.service,
  feed: _Feed(_history),
  photoCapture: capture,
  photoUploader: uploader,
);

Future<void> _pumpScreen(
  WidgetTester tester,
  _Calls calls, {
  String uid = 'ama',
  bool owner = false,
  Locale locale = const Locale('en'),
  Size size = const Size(800, 1800),
  HandoverPhotoCapture? capture,
  HandoverPhotoUploader? uploader,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    _host(
      _screen(
        calls,
        uid: uid,
        owner: owner,
        capture: capture,
        uploader: uploader,
      ),
      locale: locale,
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapKey(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

Future<void> _tapText(WidgetTester tester, String text) async {
  await tester.tap(find.text(text).last);
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  group('the answer and who may do what', () {
    test('reads the recorded answer', () {
      final s = StaffBalancesSnapshot.fromCallable(recordedAnswer());
      expect(s.staff.map((r) => r.staffId), ['owner', 'kofi', 'ama']);
      final owner = s.staff.first;
      expect(owner.collectedByMethod, {'cash': 100000, 'zelle': 50000});
      expect(owner.heldCents, 135000);
      expect(owner.pendingInCents, 3000);
      expect(s.staff[1].netCents, -10000);
      expect(s.staff[1].expenseOwedToThemCents, 15000);
      expect(s.businessAccount.receivedCents, 20000);
      expect(s.businessAccount.pendingInCents, 10000);
      expect(s.pending.map((h) => h.id), ['h1', 'h2', 'h3']);
      expect(s.pending[1].toBusinessAccount, isTrue);
      expect(s.asOf, _asOf);
      expect(s.nameOf('kofi'), 'Kofi');
      expect(s.nameOf('nobody'), '');
    });

    test('a damaged answer reads as nothing, never throws', () {
      final s = StaffBalancesSnapshot.fromCallable('nope');
      expect(s.staff, isEmpty);
      expect(s.pending, isEmpty);
      expect(s.businessAccount.receivedCents, 0);
      final partial = StaffBalancesSnapshot.fromCallable({
        'staff': [
          {'staffId': 'x', 'name': 'X'},
          'junk',
        ],
      });
      expect(partial.staff.single.heldCents, 0);
    });

    test('timestamps may be millis, ISO text or {_seconds}', () {
      final h = StaffHandover.fromMap('a', {
        'createdAt': {'_seconds': 1761750000, '_nanoseconds': 0},
        'confirmedAt': '2026-10-29T12:00:00.000',
        'voidedAt': 1761750000000,
        'status': 'confirmed',
      });
      expect(h.createdAt, DateTime.fromMillisecondsSinceEpoch(1761750000000));
      expect(h.confirmedAt, DateTime(2026, 10, 29, 12));
      expect(h.voidedAt, DateTime.fromMillisecondsSinceEpoch(1761750000000));
    });

    test('only the receiver confirms; the owner answers for the business '
        'account', () {
      final s = StaffBalancesSnapshot.fromCallable(recordedAnswer());
      final h1 = s.pending[0], h2 = s.pending[1], h3 = s.pending[2];
      expect(canConfirmHandover(h1, uid: 'ama', isOwner: false), isTrue);
      expect(canConfirmHandover(h1, uid: 'kofi', isOwner: false), isFalse);
      expect(canConfirmHandover(h2, uid: 'ama', isOwner: false), isFalse);
      expect(canConfirmHandover(h2, uid: 'owner', isOwner: true), isTrue);
      expect(canConfirmHandover(h3, uid: 'ama', isOwner: true), isFalse);
      final done = StaffHandover.fromMap('x', {
        ..._handover('x', 'kofi', 'ama', 100),
        'status': 'confirmed',
      });
      expect(canConfirmHandover(done, uid: 'ama', isOwner: false), isFalse);
      expect(canVoidHandover(done, uid: 'kofi', isOwner: true), isFalse);
    });

    test('the giver voids their own pending; the owner voids any', () {
      final s = StaffBalancesSnapshot.fromCallable(recordedAnswer());
      final h2 = s.pending[1], h3 = s.pending[2];
      expect(canVoidHandover(h2, uid: 'ama', isOwner: false), isTrue);
      expect(canVoidHandover(h3, uid: 'ama', isOwner: false), isFalse);
      expect(canVoidHandover(h3, uid: 'ama', isOwner: true), isTrue);
    });

    test('what waits on the viewer, oldest first', () {
      final s = StaffBalancesSnapshot.fromCallable(recordedAnswer());
      expect(
        handoversWaitingOn(
          s.pending,
          uid: 'ama',
          isOwner: false,
        ).map((h) => h.id),
        ['h1'],
      );
      expect(
        handoversWaitingOn(
          s.pending,
          uid: 'owner',
          isOwner: true,
        ).map((h) => h.id),
        ['h2', 'h3'],
      );
      expect(handoversWaitingOn(s.pending, uid: '', isOwner: true), isEmpty);
    });

    test('net reads owes, is owed or all square', () {
      expect(staffNetKind(1), StaffNetKind.owes);
      expect(staffNetKind(-1), StaffNetKind.isOwed);
      expect(staffNetKind(0), StaffNetKind.settled);
    });

    test('a person\'s history is theirs, newest first', () {
      final mine = handoversOf(_history, 'kofi');
      expect(mine.map((h) => h.id), ['old1', 'h1']);
    });
  });

  group('the service', () {
    test('each action sends its payload on updateLotExpenseEntry', () async {
      final calls = _Calls();
      final service = calls.service;
      await service.load('b1');
      await service.recordHandover(
        businessId: 'b1',
        toId: 'kofi',
        amountCents: 2550,
        method: 'zelle',
        note: ' Friday ',
        proofPath: 'staffHandoverProofs/b1/ama/abc.jpg',
      );
      await service.confirm('b1', 'h1');
      await service.decline('b1', 'h1', note: 'Not received');
      await service.voidHandover('b1', 'h2', reason: 'Wrong person');
      await service.recordOpening(
        businessId: 'b1',
        staffId: 'kofi',
        amountCents: 50000,
        note: 'Before October',
      );
      expect(calls.log.map((c) => c.name).toSet(), {'updateLotExpenseEntry'});
      expect(calls.actions('staff_balances').single, {
        'action': 'staff_balances',
        'businessId': 'b1',
      });
      expect(calls.actions('record_handover').single, {
        'action': 'record_handover',
        'businessId': 'b1',
        'toId': 'kofi',
        'amountCents': 2550,
        'method': 'zelle',
        'note': 'Friday',
        'proofPath': 'staffHandoverProofs/b1/ama/abc.jpg',
      });
      expect(calls.actions('confirm_handover').single, {
        'action': 'confirm_handover',
        'businessId': 'b1',
        'handoverId': 'h1',
      });
      expect(calls.actions('decline_handover').single['note'], 'Not received');
      expect(calls.actions('void_handover').single['reason'], 'Wrong person');
      expect(calls.actions('record_opening').single, {
        'action': 'record_opening',
        'businessId': 'b1',
        'staffId': 'kofi',
        'amountCents': 50000,
        'note': 'Before October',
      });
    });

    test('optional fields are left out when empty', () async {
      final calls = _Calls();
      await calls.service.recordHandover(
        businessId: 'b1',
        toId: businessAccountReceiver,
        amountCents: 100,
        method: 'cash',
      );
      await calls.service.decline('b1', 'h1');
      final sent = calls.actions('record_handover').single;
      expect(sent.containsKey('note'), isFalse);
      expect(sent.containsKey('proofPath'), isFalse);
      expect(
        calls.actions('decline_handover').single.containsKey('note'),
        isFalse,
      );
    });

    test('a refusal carries its reason; a dead line reads offline', () async {
      final calls = _Calls()
        ..respond = (action, _) => throw FirebaseFunctionsException(
          message: 'x',
          code: 'failed-precondition',
          details: {'reason': 'handover_to_self'},
        );
      await expectLater(
        calls.service.confirm('b1', 'h1'),
        throwsA(
          isA<StaffBalancesFailure>()
              .having((f) => f.reason, 'reason', 'handover_to_self')
              .having((f) => f.offline, 'offline', isFalse),
        ),
      );
      final offline = _Calls()
        ..respond = (action, _) =>
            throw FirebaseFunctionsException(message: 'x', code: 'unavailable');
      await expectLater(
        offline.service.load('b1'),
        throwsA(
          isA<StaffBalancesFailure>().having((f) => f.offline, 'o', true),
        ),
      );
      expect(
        parseStaffBalancesFailure('x', null, 'opening_owner_only').reason,
        'opening_owner_only',
      );
    });

    test('loading always resolves: a call that never answers times out', () {
      final service = StaffBalancesService(
        caller: (_, _) => Completer<Object?>().future,
        timeout: const Duration(milliseconds: 20),
      );
      expect(
        service.load('b1'),
        throwsA(
          isA<StaffBalancesFailure>().having((f) => f.offline, 'o', true),
        ),
      );
    });
  });

  group('the Staff balances page', () {
    testWidgets('rows come from the recorded answer', (tester) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls);

      expect(find.text('Staff balances'), findsOneWidget);
      // One row per person; the viewer's is marked.
      expect(find.byKey(const Key('sbal-row-owner')), findsOneWidget);
      expect(find.byKey(const Key('sbal-row-kofi')), findsOneWidget);
      expect(find.text('Ama (You)'), findsOneWidget);
      // Net: owes / is owed.
      expect(
        tester.widget<Text>(find.byKey(const Key('sbal-net-ama'))).data,
        r'owes $242.00',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('sbal-net-kofi'))).data,
        r'is owed $100.00',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('sbal-net-owner'))).data,
        r'owes $1,370.00',
      );
      // Holds · Parking · Expenses owed.
      expect(find.text('Holds'), findsNWidgets(3));
      expect(find.text('Parking'), findsNWidgets(3));
      expect(find.text('Expenses owed'), findsNWidgets(3));
      expect(find.text(r'$1,350.00'), findsOneWidget);
      expect(find.text(r'$150.00'), findsOneWidget);
      // The business account.
      expect(find.byKey(const Key('sbal-business-account')), findsOneWidget);
      expect(find.text(r'Received so far: $200.00'), findsOneWidget);
      expect(find.text(r'On the way: $100.00'), findsOneWidget);
      expect(find.textContaining('Oct 29, 2026'), findsOneWidget);
      // Everyone sees it; nobody but the owner records an opening amount.
      expect(find.byKey(const Key('sbal-hand-over')), findsOneWidget);
      expect(find.byKey(const Key('sbal-opening')), findsNothing);
      expect(calls.actions('staff_balances'), hasLength(1));
    });

    testWidgets('handovers waiting on the viewer carry Confirm and Decline; '
        'only their own pending carry Void', (tester) async {
      await _pumpScreen(tester, _Calls());
      expect(find.text('Waiting on you'), findsOneWidget);
      expect(find.text('Other handovers waiting'), findsOneWidget);
      expect(find.text(r'Kofi handed $30.00 to Ama'), findsOneWidget);
      expect(find.text('Friday cash'), findsOneWidget);
      expect(find.byKey(const Key('sbal-confirm-h1')), findsOneWidget);
      expect(find.byKey(const Key('sbal-decline-h1')), findsOneWidget);
      // Ama's own, to the business account: she may void it, not confirm it.
      expect(
        find.text(r'Ama handed $100.00 to Business account'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('sbal-void-h2')), findsOneWidget);
      expect(find.byKey(const Key('sbal-confirm-h2')), findsNothing);
      // Someone else's, to someone else: no actions.
      expect(find.byKey(const Key('sbal-pending-h3')), findsOneWidget);
      expect(find.byKey(const Key('sbal-confirm-h3')), findsNothing);
      expect(find.byKey(const Key('sbal-void-h3')), findsNothing);
    });

    testWidgets('the owner answers for the business account and voids any', (
      tester,
    ) async {
      await _pumpScreen(tester, _Calls(), uid: 'owner', owner: true);
      expect(find.byKey(const Key('sbal-confirm-h2')), findsOneWidget);
      expect(find.byKey(const Key('sbal-confirm-h3')), findsOneWidget);
      expect(find.byKey(const Key('sbal-confirm-h1')), findsNothing);
      expect(find.byKey(const Key('sbal-void-h1')), findsOneWidget);
      expect(find.byKey(const Key('sbal-opening')), findsOneWidget);
    });

    testWidgets('Confirm received sends the action and refreshes', (
      tester,
    ) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls);
      await _tapKey(tester, 'sbal-confirm-h1');
      expect(calls.actions('confirm_handover').single, {
        'action': 'confirm_handover',
        'businessId': 'b1',
        'handoverId': 'h1',
      });
      expect(find.text('Marked as received.'), findsOneWidget);
      expect(calls.actions('staff_balances'), hasLength(2));
    });

    testWidgets('Decline asks for a note first', (tester) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls);
      await _tapKey(tester, 'sbal-decline-h1');
      expect(find.text('Decline this handover?'), findsOneWidget);
      expect(
        find.text(r'Kofi will see that you did not receive $30.00.'),
        findsOneWidget,
      );
      await tester.enterText(
        find.byKey(const Key('sbal-decline-note')),
        'Not in my hand',
      );
      await _tapKey(tester, 'sbal-decline-confirm');
      expect(calls.actions('decline_handover').single, {
        'action': 'decline_handover',
        'businessId': 'b1',
        'handoverId': 'h1',
        'note': 'Not in my hand',
      });
      expect(find.text('Handover declined.'), findsOneWidget);
    });

    testWidgets('cancelling the Decline dialog sends nothing', (tester) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls);
      await _tapKey(tester, 'sbal-decline-h1');
      await _tapText(tester, 'Cancel');
      expect(calls.actions('decline_handover'), isEmpty);
    });

    testWidgets('Void asks first, then sends the reason', (tester) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls);
      await _tapKey(tester, 'sbal-void-h2');
      expect(find.text('Void this handover?'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('sbal-void-reason')),
        'Wrong amount',
      );
      await _tapKey(tester, 'sbal-void-confirm');
      expect(calls.actions('void_handover').single, {
        'action': 'void_handover',
        'businessId': 'b1',
        'handoverId': 'h2',
        'reason': 'Wrong amount',
      });
      expect(find.text('Handover voided.'), findsOneWidget);
    });

    testWidgets('a refused confirm is said in words and the page refreshes', (
      tester,
    ) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls);
      calls.respond = (action, _) => action == 'confirm_handover'
          ? throw FirebaseFunctionsException(
              message: 'x',
              code: 'failed-precondition',
              details: {'reason': 'handover_not_pending'},
            )
          : null;
      await _tapKey(tester, 'sbal-confirm-h1');
      expect(
        find.text(
          'This handover was already answered. Refresh to see where it '
          'stands.',
        ),
        findsOneWidget,
      );
      expect(calls.actions('staff_balances'), hasLength(2));
    });

    testWidgets('the detail sheet shows the breakdown and the person\'s '
        'history', (tester) async {
      await _pumpScreen(tester, _Calls());
      await _tapKey(tester, 'sbal-row-kofi');
      expect(find.text('Collected from customers'), findsOneWidget);
      expect(find.text('Cash'), findsWidgets);
      expect(find.text(r'$150.00'), findsWidgets);
      expect(find.text('Handed over, not confirmed yet'), findsOneWidget);
      expect(find.text('Expenses taken off the parking bill'), findsOneWidget);
      expect(find.text('Expenses the business owes them'), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('sbal-detail-net'))).data,
        r'is owed $100.00',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('sbal-detail-held'))).data,
        r'$50.00',
      );
      // History, newest first: the confirmed one, then the pending one.
      expect(find.byKey(const Key('sbal-history-old1')), findsOneWidget);
      expect(find.byKey(const Key('sbal-history-h1')), findsOneWidget);
      expect(find.byKey(const Key('sbal-history-old2')), findsNothing);
      expect(
        find.text(r'Kofi handed $90.00 to Alhoussaine Barry'),
        findsOneWidget,
      );
      expect(find.text('Confirmed'), findsOneWidget);
      expect(find.byKey(const Key('sbal-detail-opening')), findsNothing);
    });

    testWidgets('a person with no handovers says so', (tester) async {
      final calls = _Calls();
      calls.respond = (action, _) => action == 'staff_balances'
          ? {
              ...recordedAnswer(),
              'staff': [_row('zed', 'Zed')],
              'pending': <Object?>[],
            }
          : null;
      await _pumpScreen(tester, calls);
      await _tapKey(tester, 'sbal-row-zed');
      expect(find.byKey(const Key('sbal-history-empty')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('sbal-detail-net'))).data,
        'all square',
      );
    });

    testWidgets('loading resolves to a retry when the callable fails', (
      tester,
    ) async {
      final calls = _Calls();
      var fail = true;
      calls.respond = (action, _) {
        if (action == 'staff_balances' && fail) {
          throw FirebaseFunctionsException(message: 'x', code: 'unavailable');
        }
        return null;
      };
      await _pumpScreen(tester, calls);
      expect(find.byKey(const Key('sbal-load-failed')), findsOneWidget);
      expect(find.byKey(const Key('sbal-loading')), findsNothing);
      fail = false;
      await _tapKey(tester, 'sbal-retry');
      expect(find.byKey(const Key('sbal-load-failed')), findsNothing);
      expect(find.byKey(const Key('sbal-row-kofi')), findsOneWidget);
    });

    testWidgets('a call that never answers still stops spinning', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(800, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        _host(
          StaffBalancesScreen(
            businessId: 'b1',
            currentUid: 'ama',
            service: StaffBalancesService(
              caller: (_, _) => Completer<Object?>().future,
              timeout: const Duration(seconds: 5),
            ),
            feed: _Feed(),
          ),
        ),
      );
      await tester.pump();
      expect(find.byKey(const Key('sbal-loading')), findsOneWidget);
      await tester.pump(const Duration(seconds: 6));
      await tester.pump();
      expect(find.byKey(const Key('sbal-loading')), findsNothing);
      expect(find.byKey(const Key('sbal-load-failed')), findsOneWidget);
    });
  });

  group('Hand over money', () {
    testWidgets('to a person: amount, method, note and a slip photo', (
      tester,
    ) async {
      final calls = _Calls();
      final uploads = <List<int>>[];
      await _pumpScreen(
        tester,
        calls,
        capture: () async => Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 1]),
        uploader: ({required businessId, required bytes}) async {
          uploads.add(bytes);
          expect(businessId, 'b1');
          return 'staffHandoverProofs/b1/ama/slip12345.jpg';
        },
      );
      await _tapKey(tester, 'sbal-hand-over');
      expect(find.text('Hand over money'), findsWidgets);

      await _tapKey(tester, 'sbal-handover-to');
      // Business account first, then the team - never the giver.
      final business = tester.getTopLeft(find.text('Business account').last);
      final kofi = tester.getTopLeft(find.text('Kofi').last);
      expect(business.dy, lessThan(kofi.dy));
      expect(find.text('Ama'), findsNothing);
      await _tapText(tester, 'Kofi');

      await tester.enterText(
        find.byKey(const Key('sbal-handover-amount')),
        '25.50',
      );
      await _tapKey(tester, 'sbal-handover-method');
      await _tapText(tester, 'Zelle');
      await tester.enterText(
        find.byKey(const Key('sbal-handover-note')),
        'Friday cash',
      );
      await _tapKey(tester, 'sbal-photo-take');
      expect(uploads, hasLength(1));
      expect(find.byKey(const Key('sbal-photo-added')), findsOneWidget);

      await _tapKey(tester, 'sbal-handover-send');
      expect(calls.actions('record_handover').single, {
        'action': 'record_handover',
        'businessId': 'b1',
        'toId': 'kofi',
        'amountCents': 2550,
        'method': 'zelle',
        'note': 'Friday cash',
        'proofPath': 'staffHandoverProofs/b1/ama/slip12345.jpg',
      });
      expect(
        find.text(r'Handover of $25.50 sent to Kofi. They need to confirm it.'),
        findsOneWidget,
      );
      // The page is refreshed after it.
      expect(calls.actions('staff_balances'), hasLength(2));
      expect(find.byKey(const Key('sbal-handover-send')), findsNothing);
    });

    testWidgets('to the Business account', (tester) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls);
      await _tapKey(tester, 'sbal-hand-over');
      await _tapKey(tester, 'sbal-handover-to');
      await _tapText(tester, 'Business account');
      await tester.enterText(
        find.byKey(const Key('sbal-handover-amount')),
        '100',
      );
      await _tapKey(tester, 'sbal-handover-send');
      final sent = calls.actions('record_handover').single;
      expect(sent['toId'], 'business_account');
      expect(sent['amountCents'], 10000);
      expect(sent['method'], 'cash');
      expect(sent.containsKey('proofPath'), isFalse);
    });

    testWidgets('nothing is sent without who and how much', (tester) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls);
      await _tapKey(tester, 'sbal-hand-over');
      await _tapKey(tester, 'sbal-handover-send');
      expect(calls.actions('record_handover'), isEmpty);
      expect(find.text('Choose who you handed it to.'), findsOneWidget);
      expect(find.text(r'Enter an amount above $0.00.'), findsOneWidget);
    });

    testWidgets('a refusal stays on the sheet in words', (tester) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls);
      calls.respond = (action, _) => action == 'record_handover'
          ? throw FirebaseFunctionsException(
              message: 'x',
              code: 'failed-precondition',
              details: {'reason': 'handover_receiver_invalid'},
            )
          : null;
      await _tapKey(tester, 'sbal-hand-over');
      await _tapKey(tester, 'sbal-handover-to');
      await _tapText(tester, 'Kofi');
      await tester.enterText(
        find.byKey(const Key('sbal-handover-amount')),
        '5',
      );
      await _tapKey(tester, 'sbal-handover-send');
      expect(
        find.text("That person is not on this business's team."),
        findsOneWidget,
      );
      expect(find.byKey(const Key('sbal-handover-send')), findsOneWidget);
    });

    testWidgets('a failed photo is said, and the handover still goes', (
      tester,
    ) async {
      final calls = _Calls();
      await _pumpScreen(
        tester,
        calls,
        capture: () async => Uint8List.fromList([1, 2, 3]),
        uploader: ({required businessId, required bytes}) async =>
            throw Exception('no network'),
      );
      await _tapKey(tester, 'sbal-hand-over');
      await _tapKey(tester, 'sbal-photo-take');
      expect(find.byKey(const Key('sbal-photo-error')), findsOneWidget);
      await _tapKey(tester, 'sbal-handover-to');
      await _tapText(tester, 'Kofi');
      await tester.enterText(
        find.byKey(const Key('sbal-handover-amount')),
        '5',
      );
      await _tapKey(tester, 'sbal-handover-send');
      expect(
        calls.actions('record_handover').single.containsKey('proofPath'),
        isFalse,
      );
    });
  });

  group('Opening amount', () {
    testWidgets('the owner records what a person handed over before', (
      tester,
    ) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls, uid: 'owner', owner: true);
      await _tapKey(tester, 'sbal-opening');
      await _tapKey(tester, 'sbal-opening-person');
      await _tapText(tester, 'Kofi');
      await tester.enterText(
        find.byKey(const Key('sbal-opening-amount')),
        '500',
      );
      await tester.enterText(
        find.byKey(const Key('sbal-opening-note')),
        'Before October',
      );
      await _tapKey(tester, 'sbal-opening-save');
      expect(calls.actions('record_opening').single, {
        'action': 'record_opening',
        'businessId': 'b1',
        'staffId': 'kofi',
        'amountCents': 50000,
        'note': 'Before October',
      });
      expect(
        find.text(r'Opening amount of $500.00 recorded for Kofi.'),
        findsOneWidget,
      );
    });

    testWidgets('from a person\'s detail sheet it starts on them', (
      tester,
    ) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls, uid: 'owner', owner: true);
      await _tapKey(tester, 'sbal-row-kofi');
      await _tapKey(tester, 'sbal-detail-opening');
      expect(find.text('Kofi'), findsWidgets);
      await tester.enterText(
        find.byKey(const Key('sbal-opening-amount')),
        '20',
      );
      await _tapKey(tester, 'sbal-opening-save');
      expect(calls.actions('record_opening').single['staffId'], 'kofi');
    });

    testWidgets('the server\'s owner-only refusal is said', (tester) async {
      final calls = _Calls();
      await _pumpScreen(tester, calls, uid: 'owner', owner: true);
      calls.respond = (action, _) => action == 'record_opening'
          ? throw FirebaseFunctionsException(
              message: 'x',
              code: 'permission-denied',
              details: {'reason': 'opening_owner_only'},
            )
          : null;
      await _tapKey(tester, 'sbal-opening');
      await _tapKey(tester, 'sbal-opening-person');
      await _tapText(tester, 'Kofi');
      await tester.enterText(
        find.byKey(const Key('sbal-opening-amount')),
        '20',
      );
      await _tapKey(tester, 'sbal-opening-save');
      expect(
        find.text('Only the owner can record an opening amount.'),
        findsOneWidget,
      );
    });
  });

  group('the menu badge', () {
    Future<void> pumpBadge(
      WidgetTester tester, {
      required String uid,
      required bool owner,
      List<StaffHandover> rows = const [],
    }) async {
      await tester.pumpWidget(
        _host(
          Scaffold(
            body: StaffBalancesBadge(
              businessId: 'b1',
              uid: uid,
              isOwner: owner,
              feed: _Feed(rows),
            ),
          ),
        ),
      );
      await tester.pump();
    }

    final pending = [
      for (final h in (recordedAnswer()['pending'] as List<Object?>))
        StaffHandover.fromMap('', (h! as Map).cast<String, dynamic>()),
    ];

    testWidgets('counts what waits on the viewer', (tester) async {
      await pumpBadge(tester, uid: 'ama', owner: false, rows: pending);
      expect(find.byKey(const Key('staff-balances-badge')), findsOneWidget);
      expect(find.text('1'), findsOneWidget);
    });

    testWidgets('the owner also counts the business account\'s', (
      tester,
    ) async {
      await pumpBadge(tester, uid: 'owner', owner: true, rows: pending);
      expect(find.text('2'), findsOneWidget);
    });

    testWidgets('nothing waiting: no badge', (tester) async {
      await pumpBadge(tester, uid: 'zed', owner: false, rows: pending);
      expect(find.byKey(const Key('staff-balances-badge')), findsNothing);
    });

    testWidgets('without Firebase it is silently absent', (tester) async {
      await tester.pumpWidget(
        _host(
          const Scaffold(
            body: StaffBalancesBadge(
              businessId: 'b1',
              uid: 'ama',
              isOwner: false,
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('staff-balances-badge')), findsNothing);
    });
  });

  group('Received by: Business account', () {
    testWidgets('is the first option of every picker built by the helper', (
      tester,
    ) async {
      late AppLocalizations l10n;
      await tester.pumpWidget(
        _host(
          Builder(
            builder: (context) {
              l10n = AppLocalizations.of(context)!;
              return const SizedBox();
            },
          ),
        ),
      );
      // ignore: avoid_dynamic_calls
      final options = receivedByOptions(l10n, const []);
      expect(options.first.value, 'business_account');
      expect(options.first.value, businessAccountReceiver);
      expect(options.first.label, 'Business account');
      expect(receivedByName(l10n, 'business_account', ''), 'Business account');
      expect(receivedByName(l10n, 'u1', 'Kofi'), 'Kofi');
      final fr = lookupAppLocalizations(const Locale('fr'));
      expect(
        receivedByOptions(fr, const []).first.label,
        "Compte de l'entreprise",
      );
    });

    test('the phone\'s own checks accept it as a receiver', () {
      expect(
        validateInventorySwitchToPaid(
          method: 'cash',
          receivedByStaffId: businessAccountReceiver,
          staffIds: const ['u-me', 'u-kofi'],
        ),
        isEmpty,
      );
      expect(
        validateInventorySwitchToPaid(
          method: 'cash',
          receivedByStaffId: 'stranger',
          staffIds: const ['u-me', 'u-kofi'],
        ),
        contains('received_by_invalid'),
      );
      expect(
        validateInventoryCheckout(
          const InventoryCheckoutDraft(
            receivedByStaffId: businessAccountReceiver,
          ),
          totalCents: 1000,
          staffIds: const ['u-me'],
          today: DateTime(2026, 10, 29),
        ),
        isNot(contains('received_by_invalid')),
      );
      expect(isBusinessAccountReceiver(' business_account '), isTrue);
      expect(isBusinessAccountReceiver('u1'), isFalse);
      expect(isBusinessAccountReceiver(null), isFalse);
    });

    test('a package payment to the business account is valid', () {
      final errors = validatePackagePayment(
        amount: '10',
        method: 'zelle',
        standing: const PackagePayment(
          status: PackagePaymentStatus.unpaid,
          priceCents: 5000,
          paidCents: 0,
          balanceCents: 5000,
          payOnArrival: false,
        ),
        receivedByStaffId: businessAccountReceiver,
        staffIds: const ['u-me'],
      );
      expect(errors, isEmpty);
    });
  });

  group('refusals', () {
    testWidgets('every reason reads in English and in French', (tester) async {
      late AppLocalizations en;
      await tester.pumpWidget(
        _host(
          Builder(
            builder: (context) {
              en = AppLocalizations.of(context)!;
              return const SizedBox();
            },
          ),
        ),
      );
      final fr = lookupAppLocalizations(const Locale('fr'));
      for (final reason in staffBalancesRefusals) {
        final failure = StaffBalancesFailure(
          code: 'failed-precondition',
          reason: reason,
        );
        final english = staffBalancesRefusalText(en, failure);
        final french = staffBalancesRefusalText(fr, failure);
        expect(english, isNot(en.lotCouldNotSave), reason: reason);
        expect(french, isNot(fr.lotCouldNotSave), reason: reason);
        expect(french, isNot(english), reason: reason);
      }
      expect(
        staffBalancesRefusalText(
          en,
          const StaffBalancesFailure(code: 'unavailable'),
        ),
        en.lotCouldNotSave,
      );
    });
  });

  group('French at 360 px', () {
    testWidgets('the page, a detail sheet and the hand-over sheet fit', (
      tester,
    ) async {
      // The app shell sets this whenever the language changes.
      setMoneyDisplayLanguage('fr');
      addTearDown(() => setMoneyDisplayLanguage('en'));
      final calls = _Calls();
      await _pumpScreen(
        tester,
        calls,
        uid: 'owner',
        owner: true,
        locale: const Locale('fr'),
        size: const Size(360, 2400),
      );
      final fr = lookupAppLocalizations(const Locale('fr'));
      expect(tester.takeException(), isNull);
      expect(find.text(fr.sbalTitle), findsOneWidget);
      expect(find.text(fr.sbalWaitingOnYou), findsOneWidget);
      expect(find.text(fr.sbalHolds), findsNWidgets(3));
      expect(find.text(fr.sbalExpensesOwed), findsNWidgets(3));
      expect(find.text(fr.sbalBusinessAccount), findsWidgets);
      expect(find.text(fr.sbalConfirm), findsWidgets);
      expect(find.text(fr.sbalHandOver), findsOneWidget);
      expect(find.text(fr.sbalOpening), findsOneWidget);
      expect(
        find.text(fr.sbalIsOwed(formatLotCents(10000, language: 'fr'))),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);

      await _tapKey(tester, 'sbal-row-kofi');
      expect(find.text(fr.sbalDetailExpensesOwed), findsOneWidget);
      expect(find.text(fr.sbalHistory), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tapAt(const Offset(180, 20));
      await tester.pumpAndSettle();

      await _tapKey(tester, 'sbal-hand-over');
      expect(find.text(fr.sbalHandOverHint), findsOneWidget);
      expect(find.text(fr.sbalSendForConfirmation), findsOneWidget);
      await _tapKey(tester, 'sbal-handover-send');
      expect(find.text(fr.sbalSayWho), findsOneWidget);
      expect(find.text(fr.sbalAmountInvalid), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

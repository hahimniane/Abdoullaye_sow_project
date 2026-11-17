import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/services/team_settle.dart';
import 'package:my_flutter_app/services/team_settle_service.dart';
import 'package:my_flutter_app/widgets/team_settle_panel.dart';

import 'support/month_end_fixtures.dart';

/// The month settlement on a team member's Month end card
/// (docs/TEAM_SETTLE.md): file "I paid everything", confirm / decline / undo,
/// pay back, and find what waits for you.
void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  late List<Map<String, Object?>> calls;
  Object? Function(Map<String, Object?>)? answer;

  TeamSettleService service() => TeamSettleService(
    caller: (name, payload) async {
      calls.add({'name': name, ...payload});
      final result = answer?.call(payload);
      if (result is Exception) throw result;
      return result ?? {'success': true};
    },
  );

  setUp(() {
    calls = [];
    answer = null;
  });

  const owner = (id: 'owner', name: 'Keren');
  const full = (id: 'full', name: 'Ibra');
  const names = {'owner': 'Keren', 'full': 'Ibra', 'sekou': 'Sekou'};

  SettlementRecord record(
    String id,
    String status, {
    String receiver = 'owner',
    int amount = 40000,
    Map<String, Object?> extra = const {},
  }) => settlementRecords([
    {
      'id': id,
      'status': status,
      'staffId': 'sekou',
      'monthKey': '2026-10',
      'amountCents': amount,
      'scope': 'everything',
      'cashCents': 10000,
      'parkingCents': amount - 10000,
      'statementOwedCents': 40000,
      'receiverId': receiver,
      'method': 'cash',
      'requestedAtMs': 1000,
      ...extra,
    },
  ]).single;

  Widget harness(Locale locale, Widget child) => MaterialApp(
    locale: locale,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: child,
      ),
    ),
  );

  // Sekou's statement: parking 500 - expenses 200 + cash held 100 = $400.
  Widget panel({
    String myUid = 'sekou',
    bool isReceiver = false,
    int owes = 40000,
    int parking = 50000,
    int expense = 20000,
    int cash = 10000,
    List<SettlementRecord> settlements = const [],
    bool estimating = false,
    Locale locale = const Locale('en'),
  }) => harness(
    locale,
    TeamSettlePanel(
      businessId: 'biz-1',
      monthKey: '2026-10',
      staffId: 'sekou',
      staffName: 'Sekou',
      owesCents: owes,
      parkingJobsCents: parking,
      expenseCents: expense,
      cashHeldCents: cash,
      settlements: settlements,
      receivers: const [owner, full],
      names: names,
      myUid: myUid,
      isReceiver: isReceiver,
      estimating: estimating,
      service: service(),
    ),
  );

  Future<void> show(WidgetTester tester, Widget w, {double width = 800}) async {
    tester.view.physicalSize = Size(width, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(w);
    await tester.pumpAndSettle();
  }

  testWidgets('nothing to do and nothing filed: the panel is not there', (
    tester,
  ) async {
    await show(tester, panel(myUid: 'someone-else'));
    expect(find.byKey(const Key('team-settle-panel')), findsNothing);
    await show(tester, panel(estimating: true));
    expect(find.byKey(const Key('team-settle-panel')), findsNothing);
  });

  testWidgets('the member files "I paid everything" for the statement', (
    tester,
  ) async {
    await show(tester, panel());
    expect(find.text(r'I paid everything · $400.00'), findsOneWidget);
    await tester.tap(find.byKey(const Key('team-settle-open')));
    await tester.pumpAndSettle();
    // The amount starts at the statement; the split is shown.
    expect(find.text('400.00'), findsOneWidget);
    expect(find.text('Cash held'), findsOneWidget);
    expect(find.text('Parking and jobs'), findsOneWidget);
    expect(find.text('Left to pay'), findsOneWidget);
    await tester.tap(find.byKey(const Key('team-settle-save')));
    await tester.pumpAndSettle();

    expect(calls.single, {
      'name': 'updateLotExpenseEntry',
      'action': 'team_settle_request',
      'businessId': 'biz-1',
      'monthKey': '2026-10',
      'staffId': 'sekou',
      'amountCents': 40000,
      'scope': 'everything',
      'receiverId': 'owner',
      'method': 'cash',
      'note': '',
    });
    expect(
      find.text('Sent. It counts once the person who received it confirms.'),
      findsOneWidget,
    );
    // The sheet closed.
    expect(find.byKey(const Key('team-settle-save')), findsNothing);
  });

  testWidgets('what it is for sets the amount; more than owed is refused', (
    tester,
  ) async {
    await show(tester, panel());
    await tester.tap(find.byKey(const Key('team-settle-open')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('team-settle-scope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Only the cash I hold'));
    await tester.pumpAndSettle();
    expect(find.text('100.00'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('team-settle-amount')),
      '100.01',
    );
    await tester.pump();
    expect(find.byKey(const Key('team-settle-refusal')), findsOneWidget);
    expect(
      find.textContaining('more than this statement asks for'),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(const Key('team-settle-save')),
      warnIfMissed: false,
    );
    await tester.pumpAndSettle();
    expect(calls, isEmpty);
  });

  testWidgets('the owner records it for the member and takes the money', (
    tester,
  ) async {
    await show(tester, panel(myUid: 'owner', isReceiver: true));
    expect(
      find.text(r'Record that they paid everything · $400.00'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('team-settle-open')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('team-settle-save')));
    await tester.pumpAndSettle();
    // Naming themselves as the receiver counts at once.
    expect(calls.single['receiverId'], 'owner');
    expect(find.text('Payment recorded.'), findsOneWidget);
  });

  testWidgets('the server refusing it is shown in words and the sheet stays', (
    tester,
  ) async {
    answer = (_) => FirebaseFunctionsException(
      message: 'x',
      code: 'failed-precondition',
      details: {'reason': 'team_settle_not_own'},
    );
    await show(tester, panel());
    await tester.tap(find.byKey(const Key('team-settle-open')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('team-settle-save')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('team-settle-error')), findsOneWidget);
    expect(
      find.textContaining('You can only say you paid for yourself'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('team-settle-save')), findsOneWidget);
  });

  testWidgets('a pending one waits for its receiver, who confirms it', (
    tester,
  ) async {
    final pending = record('s1', 'pending');
    // The member sees who it waits for, and can take it back.
    await show(tester, panel(settlements: [pending]));
    expect(find.textContaining('Waiting for Keren to confirm'), findsOneWidget);
    expect(find.byKey(const Key('team-settle-confirm-s1')), findsNothing);
    expect(find.byKey(const Key('team-settle-undo-s1')), findsOneWidget);

    // The named receiver sees Confirm and Decline.
    await show(
      tester,
      panel(myUid: 'owner', isReceiver: true, settlements: [pending]),
    );
    expect(find.textContaining('Waiting for you to confirm'), findsOneWidget);
    await tester.tap(find.byKey(const Key('team-settle-confirm-s1')));
    await tester.pumpAndSettle();
    expect(calls.single, {
      'name': 'updateLotExpenseEntry',
      'action': 'team_settle_confirm',
      'businessId': 'biz-1',
      'settlementId': 's1',
    });
    expect(find.text('Payment confirmed.'), findsOneWidget);
  });

  testWidgets('declining asks why and sends the note', (tester) async {
    await show(
      tester,
      panel(
        myUid: 'owner',
        isReceiver: true,
        settlements: [record('s1', 'pending')],
      ),
    );
    await tester.tap(find.byKey(const Key('team-settle-decline-s1')));
    await tester.pumpAndSettle();
    expect(find.text('Decline this payment?'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('team-settle-decline-note')),
      'Not received',
    );
    await tester.tap(find.byKey(const Key('team-settle-decline-confirm')));
    await tester.pumpAndSettle();
    expect(calls.single, {
      'name': 'updateLotExpenseEntry',
      'action': 'team_settle_decline',
      'businessId': 'biz-1',
      'settlementId': 's1',
      'note': 'Not received',
    });
    expect(find.text('Payment declined.'), findsOneWidget);
  });

  testWidgets('a bill that changed cannot be confirmed, in words', (
    tester,
  ) async {
    answer = (_) => FirebaseFunctionsException(
      message: 'x',
      code: 'failed-precondition',
      details: {'reason': 'team_settle_bill_changed'},
    );
    await show(
      tester,
      panel(
        myUid: 'owner',
        isReceiver: true,
        settlements: [record('s1', 'pending')],
      ),
    );
    await tester.tap(find.byKey(const Key('team-settle-confirm-s1')));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('The parking bill changed since it was filed'),
      findsOneWidget,
    );
    // Still waiting, nothing stuck busy.
    expect(find.byKey(const Key('team-settle-confirm-s1')), findsOneWidget);
  });

  testWidgets('a confirmed one can be undone after asking', (tester) async {
    final confirmed = record('s1', 'confirmed', extra: {'confirmedAtMs': 2000});
    await show(tester, panel(settlements: [confirmed]));
    expect(find.textContaining('Confirmed'), findsOneWidget);
    await tester.tap(find.byKey(const Key('team-settle-undo-s1')));
    await tester.pumpAndSettle();
    expect(find.text('Undo this payment?'), findsOneWidget);
    // Keep it: nothing is sent.
    await tester.tap(find.byKey(const Key('team-settle-undo-keep')));
    await tester.pumpAndSettle();
    expect(calls, isEmpty);
    await tester.tap(find.byKey(const Key('team-settle-undo-s1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('team-settle-undo-confirm')));
    await tester.pumpAndSettle();
    expect(calls.single, {
      'name': 'updateLotExpenseEntry',
      'action': 'team_settle_undo',
      'businessId': 'biz-1',
      'settlementId': 's1',
    });
    expect(find.text('Payment undone.'), findsOneWidget);
  });

  testWidgets('an undone and a declined one stay on file, greyed', (
    tester,
  ) async {
    await show(
      tester,
      panel(
        settlements: [
          record(
            's1',
            'undone',
            extra: {'undoneAtMs': 3000, 'undoneByUid': 'owner'},
          ),
          record(
            's2',
            'declined',
            extra: {'declineNote': 'Wrong amount', 'requestedAtMs': 2},
          ),
        ],
      ),
    );
    expect(find.textContaining('Undone'), findsOneWidget);
    expect(find.textContaining('Not confirmed · Wrong amount'), findsOneWidget);
    expect(find.byKey(const Key('team-settle-undo-s1')), findsNothing);
  });

  testWidgets('the business owes the member: the owner pays them back', (
    tester,
  ) async {
    await show(
      tester,
      panel(
        myUid: 'owner',
        isReceiver: true,
        owes: -3000,
        parking: 0,
        expense: 3000,
        cash: 0,
      ),
    );
    expect(find.byKey(const Key('team-settle-open')), findsNothing);
    expect(find.text(r'Paid them back · $30.00'), findsOneWidget);
    await tester.tap(find.byKey(const Key('team-payback-open')));
    await tester.pumpAndSettle();
    // Too much is refused in words; the right amount is sent.
    await tester.enterText(
      find.byKey(const Key('team-payback-amount')),
      '30.01',
    );
    await tester.pump();
    expect(
      find.text('That is more than the business owes this person.'),
      findsOneWidget,
    );
    await tester.enterText(
      find.byKey(const Key('team-payback-amount')),
      '30.00',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('team-payback-save')));
    await tester.pumpAndSettle();
    expect(calls.single, {
      'name': 'updateLotExpenseEntry',
      'action': 'team_payback',
      'businessId': 'biz-1',
      'monthKey': '2026-10',
      'staffId': 'sekou',
      'amountCents': 3000,
      'method': 'cash',
      'note': '',
    });
    expect(find.text('Paid back — recorded.'), findsOneWidget);
  });

  testWidgets('the member cannot pay themselves back', (tester) async {
    await show(tester, panel(owes: -3000, parking: 0, expense: 3000, cash: 0));
    expect(find.byKey(const Key('team-payback-open')), findsNothing);
    expect(find.byKey(const Key('team-settle-panel')), findsNothing);
  });

  group('Waiting for your OK, at the top of Month end', () {
    testWidgets('lists what waits for you and confirms from there', (
      tester,
    ) async {
      final waiting = [
        record('s1', 'pending'),
        record('s2', 'pending', amount: 12000, extra: {'requestedAtMs': 2000}),
      ];
      await show(
        tester,
        harness(
          const Locale('en'),
          TeamSettleWaitingCard(
            businessId: 'biz-1',
            waiting: waiting,
            names: names,
            service: service(),
          ),
        ),
      );
      expect(find.text('Waiting for your OK'), findsOneWidget);
      expect(find.text(r'Sekou says they paid $400.00'), findsOneWidget);
      expect(find.text(r'Sekou says they paid $120.00'), findsOneWidget);
      await tester.tap(find.byKey(const Key('team-settle-waiting-confirm-s2')));
      await tester.pumpAndSettle();
      expect(calls.single['action'], 'team_settle_confirm');
      expect(calls.single['settlementId'], 's2');
    });

    testWidgets('nothing waiting: nothing shown', (tester) async {
      await show(
        tester,
        harness(
          const Locale('en'),
          TeamSettleWaitingCard(
            businessId: 'biz-1',
            waiting: const [],
            names: names,
            service: service(),
          ),
        ),
      );
      expect(find.byKey(const Key('team-settle-waiting')), findsNothing);
    });
  });

  testWidgets('on Month end: the statement card carries the panel, the top '
      'carries what waits for you', (tester) async {
    final statement = testCustomer(
      key: 'staff:sekou',
      name: 'Sekou',
      forStaffId: 'sekou',
      statementStaffId: 'sekou',
      statementOwesCents: 40000,
      dueCents: 50000,
      expenseCreditCents: 20000,
      cashHeldCents: 10000,
    );
    final summary = ParkingMonthSummary(
      monthKey: '2026-10',
      carsOnLot: 1,
      carsOwing: 1,
      activitiesInMonth: 0,
      customers: [statement],
      customersOwing: [statement],
      customersPaid: const [],
      billedCents: 0,
      collectedCents: 0,
      owedCents: 0,
      olderOwedCents: 0,
      dueCents: 0,
      owing: const [],
      bills: const [],
    );
    final pending = [record('s1', 'pending')];
    await show(
      tester,
      MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ParkingMonthCustomerList(
            summary: summary,
            view: ParkingMonthView.owing,
            onTap: (_) {},
            leading: TeamSettleWaitingCard(
              businessId: 'biz-1',
              waiting: pending,
              names: names,
              service: service(),
            ),
            cardFooter: (c) => TeamSettlePanel(
              businessId: 'biz-1',
              monthKey: '2026-10',
              staffId: c.statementStaffId,
              staffName: c.customerName,
              owesCents: c.statementOwesCents!,
              parkingJobsCents: c.dueCents,
              expenseCents: c.expenseCreditCents,
              cashHeldCents: c.cashHeldCents ?? 0,
              settlements: pending,
              receivers: const [owner, full],
              names: names,
              myUid: 'owner',
              isReceiver: true,
              estimating: false,
              service: service(),
            ),
          ),
        ),
      ),
    );
    expect(find.byKey(const Key('team-settle-waiting')), findsOneWidget);
    expect(find.byKey(const Key('team-settle-panel')), findsOneWidget);
    expect(
      find.text(r'Record that they paid everything · $400.00'),
      findsOneWidget,
    );
  });

  testWidgets('French on a 320 px phone: words, no overflow', (tester) async {
    await show(
      tester,
      panel(
        myUid: 'owner',
        isReceiver: true,
        settlements: [record('s1', 'pending')],
        locale: const Locale('fr'),
      ),
      width: 320,
    );
    expect(find.text('Règlement du mois'), findsOneWidget);
    expect(find.text('Confirmer'), findsOneWidget);
    await tester.tap(find.byKey(const Key('team-settle-open')));
    await tester.pumpAndSettle();
    expect(find.text('J\'ai tout payé'), findsWidgets);
    expect(find.text('Seulement l\'argent que je détiens'), findsNothing);
    await tester.tap(find.byKey(const Key('team-settle-scope')));
    await tester.pumpAndSettle();
    expect(find.text('Seulement l\'argent que je détiens'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

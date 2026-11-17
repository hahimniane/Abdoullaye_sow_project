import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/lot_ledger.dart'
    show setMoneyDisplayLanguage;
import 'package:my_flutter_app/services/pay_now_payouts.dart';
import 'package:my_flutter_app/widgets/pay_now_payouts_panel.dart';

/// Pay now weekly payouts: "Laawol owes you" for the business and the
/// platform admin's "Mark paid out". Callables are a recorder.

Map<String, Object?> _week(
  String business,
  String weekKey,
  int net,
  String status, {
  String method = '',
  String reference = '',
  List<Map<String, Object?>> lines = const [],
}) => {
  'businessId': business,
  'businessName': business == 'b1' ? 'Bronx Auto' : 'Kofi Cargo',
  'weekKey': weekKey,
  'collectedCents': net > 0 ? net + 300 : 0,
  'netCents': net,
  'status': status,
  'method': method,
  'reference': reference,
  if (status == 'paid')
    'paidAtMs': DateTime(2026, 11, 9, 10).millisecondsSinceEpoch,
  'lines': lines,
};

Map<String, Object?> _answer({int bill = 0}) => {
  'success': true,
  'unpaidBillCents': bill,
  'weeks': [
    _week(
      'b1',
      '2026-11-02',
      12000,
      'due',
      lines: [
        {
          'id': 'l1',
          'type': 'payment',
          'amountCents': 12300,
          'requestCode': 'PK-1',
          'atMs': DateTime(2026, 11, 3, 14).millisecondsSinceEpoch,
        },
        {'id': 'l2', 'type': 'stripe_fee', 'amountCents': -300},
      ],
    ),
    _week('b2', '2026-11-02', -500, 'due'),
    _week('b1', '2026-10-26', 8000, 'paid', method: 'zelle', reference: 'Z123'),
    _week('b1', '2026-11-09', 4000, 'open'),
    {'weekKey': 'not-a-day', 'netCents': 1},
  ],
};

class _Calls {
  final log = <Map<String, Object?>>[];
  Object? Function(Map<String, Object?> payload)? respond;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add(payload);
    final custom = respond;
    if (custom != null) {
      final r = custom(payload);
      if (r != null) return r;
    }
    return payload['action'] == 'payouts'
        ? _answer(bill: 2500)
        : {'success': true};
  }

  List<Map<String, Object?>> actions(String a) => [
    for (final p in log)
      if (p['action'] == a) p,
  ];

  PayNowPayoutsService get service =>
      PayNowPayoutsService(caller: call, timeout: const Duration(seconds: 2));
}

Future<void> _pump(
  WidgetTester tester,
  _Calls calls, {
  String? businessId,
  bool canPayOut = false,
  Locale locale = const Locale('en'),
  Size size = const Size(800, 2400),
  PayNowPayoutsService? service,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  setMoneyDisplayLanguage(locale.languageCode);
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: SingleChildScrollView(
          child: PayNowPayoutsPanel(
            businessId: businessId,
            canPayOut: canPayOut,
            service: service ?? calls.service,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });
  tearDown(() => setMoneyDisplayLanguage('en'));

  group('the rules', () {
    test('reads weeks newest first and skips a bad week key', () {
      final a = parsePayouts(_answer(bill: 2500));
      expect(a.weeks.map((w) => '${w.businessId}/${w.weekKey}'), [
        'b1/2026-11-09',
        'b1/2026-11-02',
        'b2/2026-11-02',
        'b1/2026-10-26',
      ]);
      expect(a.unpaidBillCents, 2500);
      expect(a.weeks[1].lines.map((l) => l.type), ['payment', 'stripe_fee']);
      expect(a.weeks[1].lines.last.amountCents, -300);
    });

    test('an unknown status reads as open and a negative bill as zero', () {
      final a = parsePayouts({
        'unpaidBillCents': -5,
        'weeks': [
          {'weekKey': '2026-11-02', 'status': 'weird', 'netCents': 100},
        ],
      });
      expect(a.weeks.single.status, 'open');
      expect(a.unpaidBillCents, 0);
      expect(parsePayouts(null).weeks, isEmpty);
    });

    test('a week is paid out on the Monday after it', () {
      expect(payoutDayOf('2026-11-02'), DateTime(2026, 11, 9));
      expect(payoutDayOf('2026-12-28'), DateTime(2027, 1, 4));
      expect(payoutDayOf('nope'), isNull);
    });

    test('owed now counts open and due weeks and never goes below zero', () {
      final a = parsePayouts(_answer());
      // 4000 open + 12000 due - 500 due; the paid week is not owed.
      expect(owedNowCents(a.weeks), 15500);
      expect(
        owedNowCents(
          parsePayouts({
            'weeks': [_week('b2', '2026-11-02', -500, 'due')],
          }).weeks,
        ),
        0,
      );
    });

    test('due to businesses sums only positive due weeks', () {
      final a = parsePayouts(_answer());
      expect(dueWeeks(a.weeks).length, 2);
      expect(dueTotalCents(a.weeks), 12000);
    });

    test('a paid-out form needs a method unless the week goes on the bill', () {
      expect(payoutProblem(method: 'zelle', reference: '', netCents: 100), '');
      expect(
        payoutProblem(method: 'cash', reference: '', netCents: 100),
        'method_invalid',
      );
      expect(
        payoutProblem(method: 'bank', reference: 'x' * 121, netCents: 100),
        'reference_too_long',
      );
      expect(payoutProblem(method: '', reference: '', netCents: -5), '');
      expect(payoutProblem(method: '', reference: '', netCents: 0), '');
    });

    test('the payout request mirrors the website', () {
      final due = parsePayouts(_answer()).weeks;
      final pay = due.firstWhere((w) => w.businessId == 'b1' && w.isDue);
      final bill = due.firstWhere((w) => w.businessId == 'b2');
      expect(payoutPaidPayload(pay, 'bank', ' Z9 '), {
        'action': 'payout_paid',
        'businessId': 'b1',
        'weekKey': '2026-11-02',
        'method': 'bank',
        'reference': 'Z9',
      });
      expect(payoutPaidPayload(bill, 'bank', 'ignored'), {
        'action': 'payout_paid',
        'businessId': 'b2',
        'weekKey': '2026-11-02',
        'method': 'other',
        'reference': '',
      });
    });

    test('the service asks for one business or all', () async {
      final calls = _Calls();
      await calls.service.load(businessId: 'b1');
      await calls.service.load();
      expect(calls.actions('payouts'), [
        {'action': 'payouts', 'businessId': 'b1'},
        {'action': 'payouts'},
      ]);
    });
  });

  group('the business view', () {
    testWidgets('lists every week, the total and the bill note', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, calls, businessId: 'b1');
      expect(find.text('Laawol owes you'), findsOneWidget);
      expect(find.text(r'Owed to you now: $155.00'), findsOneWidget);
      expect(
        find.text(
          r'Your unpaid Laawol bill of $25.00 is taken out of the next payout.',
        ),
        findsOneWidget,
      );
      expect(find.text('Week of Nov 2, 2026'), findsWidgets);
      expect(find.text('Paid out on Nov 9, 2026'), findsWidgets);
      expect(find.textContaining('Paid out · Oct 26, 2026'), findsNothing);
      expect(find.textContaining('Z123'), findsOneWidget);
      // The business never marks a week paid.
      expect(find.textContaining('Mark paid out'), findsNothing);
      expect(calls.actions('payouts').single, {
        'action': 'payouts',
        'businessId': 'b1',
      });
    });

    testWidgets('a week opens to its lines', (tester) async {
      await _pump(tester, _Calls(), businessId: 'b1');
      expect(find.text('Card fee'), findsNothing);
      await tester.tap(find.byKey(const Key('payouts-week-b1-2026-11-02')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Card payment · PK-1'), findsOneWidget);
      expect(find.text('Card fee'), findsOneWidget);
    });

    testWidgets('hides itself when the server says not allowed', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (_) => throw FirebaseFunctionsException(
          message: 'x',
          code: 'permission-denied',
          details: {'reason': 'not_allowed'},
        );
      await _pump(tester, calls, businessId: 'b1');
      expect(find.text('Laawol owes you'), findsNothing);
      expect(find.byKey(const Key('payouts-error')), findsNothing);
    });

    testWidgets('hides itself when there is nothing to show', (tester) async {
      final calls = _Calls()..respond = (_) => {'weeks': <Object?>[]};
      await _pump(tester, calls, businessId: 'b1');
      expect(find.text('Laawol owes you'), findsNothing);
    });

    testWidgets('a read that never answers resolves into words', (
      tester,
    ) async {
      final never = PayNowPayoutsService(
        caller: (_, _) => Completer<Object?>().future,
        timeout: const Duration(milliseconds: 50),
      );
      await _pump(tester, _Calls(), businessId: 'b1', service: never);
      expect(find.byKey(const Key('payouts-loading')), findsNothing);
      expect(
        find.text(
          'Payouts are taking longer than usual. Try again in a moment.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('a failed read says so and Refresh reads again', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (_) =>
            throw FirebaseFunctionsException(message: 'x', code: 'internal');
      await _pump(tester, calls, businessId: 'b1');
      expect(
        find.text('Payouts could not be loaded. Try again.'),
        findsOneWidget,
      );
      calls.respond = null;
      await tester.tap(find.byKey(const Key('payouts-refresh')));
      await tester.pumpAndSettle();
      expect(
        find.text('Payouts could not be loaded. Try again.'),
        findsNothing,
      );
      expect(find.text('Laawol owes you'), findsOneWidget);
    });
  });

  group('the admin view and Mark paid out', () {
    testWidgets(
      'lists the due weeks per business; the button needs the right',
      (tester) async {
        await _pump(tester, _Calls(), canPayOut: false);
        expect(find.text('Pay now payouts'), findsOneWidget);
        expect(find.text(r'Due to businesses: $120.00'), findsOneWidget);
        expect(find.text('Bronx Auto'), findsWidgets);
        expect(find.text('Kofi Cargo'), findsOneWidget);
        expect(
          find.byKey(const Key('payouts-mark-b1-2026-11-02')),
          findsNothing,
        );
      },
    );

    testWidgets('marks a week paid out with its method and reference', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, calls, canPayOut: true);
      await tester.tap(find.byKey(const Key('payouts-mark-b1-2026-11-02')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('payouts-method-bank')));
      await tester.enterText(
        find.byKey(const Key('payouts-reference')),
        'Wire 77',
      );
      await tester.tap(find.byKey(const Key('payouts-sheet-save')));
      await tester.pumpAndSettle();
      expect(calls.actions('payout_paid').single, {
        'action': 'payout_paid',
        'businessId': 'b1',
        'weekKey': '2026-11-02',
        'method': 'bank',
        'reference': 'Wire 77',
      });
      expect(
        find.text('Paid out. The business gets a receipt on WhatsApp.'),
        findsOneWidget,
      );
      // Re-read after saving.
      expect(calls.actions('payouts').length, 2);
    });

    testWidgets('a negative week is put on the bill with no method', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, calls, canPayOut: true);
      await tester.tap(find.byKey(const Key('payouts-mark-b2-2026-11-02')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('payouts-reference')), findsNothing);
      await tester.tap(find.byKey(const Key('payouts-sheet-save')));
      await tester.pumpAndSettle();
      expect(calls.actions('payout_paid').single['method'], 'other');
      expect(find.text("Put on the business's Laawol bill."), findsOneWidget);
    });

    testWidgets('a server refusal is shown in words and the sheet stays', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (p) => p['action'] == 'payout_paid'
            ? throw FirebaseFunctionsException(
                message: 'x',
                code: 'failed-precondition',
                details: {'reason': 'week_already_paid'},
              )
            : null;
      await _pump(tester, calls, canPayOut: true);
      await tester.tap(find.byKey(const Key('payouts-mark-b1-2026-11-02')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('payouts-sheet-save')));
      await tester.pumpAndSettle();
      expect(find.text('That week is already paid out.'), findsOneWidget);
      expect(find.byKey(const Key('payouts-sheet-save')), findsOneWidget);
    });

    testWidgets('a platform admin without the right is refused in words', (
      tester,
    ) async {
      final calls = _Calls()
        ..respond = (p) => p['action'] == 'payout_paid'
            ? throw FirebaseFunctionsException(
                message: 'x',
                code: 'permission-denied',
                details: {'reason': 'not_allowed'},
              )
            : null;
      await _pump(tester, calls, canPayOut: true);
      await tester.tap(find.byKey(const Key('payouts-mark-b1-2026-11-02')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('payouts-sheet-save')));
      await tester.pumpAndSettle();
      expect(find.text('You are not allowed to do that.'), findsOneWidget);
    });
  });

  testWidgets('French at 320 px wide does not overflow', (tester) async {
    for (final admin in [false, true]) {
      await _pump(
        tester,
        _Calls(),
        businessId: admin ? null : 'b1',
        canPayOut: admin,
        locale: const Locale('fr'),
        size: const Size(320, 3000),
      );
      expect(
        find.text(admin ? 'Versements Payer maintenant' : 'Laawol vous doit'),
        findsOneWidget,
      );
      expect(find.textContaining('Semaine du 2 nov. 2026'), findsWidgets);
      if (admin) {
        await tester.tap(find.byKey(const Key('payouts-mark-b1-2026-11-02')));
        await tester.pumpAndSettle();
        expect(find.text('Comment vous avez payé'), findsOneWidget);
      }
      expect(tester.takeException(), isNull);
    }
  });
}

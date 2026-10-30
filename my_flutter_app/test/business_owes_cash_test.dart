import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/services/staff_balances.dart';

/// Month end's "Business owes" counts the cash each person holds for the
/// business (owner, 2026-10-30): someone who collected more than they are owed
/// "holds $X for the business" instead of being owed. Mirrors the console's
/// business-owes-cash.test.ts, with the same cases and numbers.

StaffBalanceRow row(String staffId, int heldCents, int netCents) =>
    StaffBalanceRow(
      staffId: staffId,
      name: staffId,
      collectedCents: heldCents,
      heldCents: heldCents,
      netCents: netCents,
    );

ParkingMonthStaffOwed line(String staffId, int owedCents) =>
    ParkingMonthStaffOwed(
      staffId: staffId,
      staffName: staffId,
      customerKey: 'phone:$staffId',
      customerName: '',
      owedCents: owedCents,
    );

Widget app(Widget child, {Locale locale = const Locale('en')}) => MaterialApp(
  locale: locale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

/// A real month-end summary where each staff member paid [owed] cents of lot
/// expenses in October and has no parking bill, so the business owes it all.
ParkingMonthSummary summaryOf(Map<String, int> owed) => parkingMonthSummary(
  const [],
  '2026-10',
  DateTime.parse('2026-11-01T13:00:00Z'),
  const [],
  ParkingMonthStaffExpenses(
    entries: [
      for (final e in owed.entries)
        {
          'id': 'x-${e.key}',
          'paidByStaffId': e.key,
          'amountCents': e.value,
          'month': '2026-10',
        },
    ],
    links: const {},
    staffNames: {for (final k in owed.keys) k: k},
  ),
);

ParkingMonthBusinessOwes owes(
  ParkingMonthSummary summary,
  OwesCashState state, {
  List<StaffBalanceRow>? balances,
  bool paidBack = true,
}) => ParkingMonthBusinessOwes(
  summary: summary,
  cashState: state,
  balances: balances,
  repayments: const [],
  staffNames: const {},
  onPaidBack: paidBack ? (_) {} : null,
  onVoid: (_) {},
);

void main() {
  group('businessOwesWithCash', () {
    test(
      'before the balances are known, a line reads as the expenses owed',
      () {
        final out = businessOwesWithCash([line('kofi', 147704)], null);
        final l = out.lines.single;
        expect(l.expenseOwedCents, 147704);
        expect(l.heldCents, 0);
        expect(l.netCents, isNull);
        expect(l.known, isFalse);
        expect(l.owedNowCents, 147704);
        expect(l.holdsCents, 0);
        expect(l.canPayBack, isTrue);
        expect(out.owedNowCents, 147704);
        expect(out.holdsCents, 0);
      },
    );

    test('holding more cash than they are owed holds the difference', () {
      final out = businessOwesWithCash(
        [line('kofi', 147704)],
        [row('kofi', 1023600, 932096)],
      );
      final l = out.lines.single;
      expect(l.heldCents, 1023600);
      expect(l.holdsCents, 932096);
      expect(l.owedNowCents, 0);
      expect(l.canPayBack, isFalse);
      expect([out.owedNowCents, out.holdsCents], [0, 932096]);
    });

    test('holding less than they are owed: owed the difference, capped', () {
      final out = businessOwesWithCash(
        [line('ama', 50000), line('ibou', 3500)],
        [row('ama', 20000, -30000), row('ibou', 0, -90000)],
      );
      expect(
        [
          for (final l in out.lines)
            [l.owedNowCents, l.holdsCents, l.canPayBack],
        ],
        [
          [30000, 0, true],
          [3500, 0, true],
        ],
      );
      expect(out.owedNowCents, 33500);
    });

    test('settled up, or no balance row at all', () {
      final out = businessOwesWithCash(
        [line('even', 1000), line('nobody', 2500)],
        [row('even', 1000, 0)],
      );
      expect(
        [
          for (final l in out.lines)
            [l.owedNowCents, l.holdsCents, l.canPayBack, l.netCents],
        ],
        [
          [0, 0, false, 0],
          [2500, 0, true, -2500],
        ],
      );
    });
  });

  group('Business owes, as the phone shows it', () {
    final summary = summaryOf({'kofi': 147704, 'ama': 50000});
    final balances = [row('kofi', 1023600, 932096), row('ama', 20000, -30000)];

    for (final locale in const [Locale('en'), Locale('fr')]) {
      final l10n = lookupAppLocalizations(locale);
      final lang = locale.languageCode;

      testWidgets(
        '[$lang] ready: holds for the business, or owed + Paid back',
        (tester) async {
          tester.view.physicalSize = const Size(360, 900);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          await tester.pumpWidget(
            app(
              owes(summary, OwesCashState.ready, balances: balances),
              locale: locale,
            ),
          );
          expect(tester.takeException(), isNull);
          // Holds more than they are owed: the amount held, no Paid back.
          expect(find.text(l10n.pmeOwesHolds), findsOneWidget);
          expect(
            find.byKey(const Key('month-end-paid-back-kofi')),
            findsNothing,
          );
          expect(
            find.text(l10n.pmeOwesCashLine(r'$1,477.04', r'$10,236.00')),
            findsOneWidget,
          );
          // Owed after the cash they hold: the amount owed, with Paid back.
          expect(find.text(l10n.pmeOwesOwed), findsOneWidget);
          expect(
            find.byKey(const Key('month-end-paid-back-ama')),
            findsOneWidget,
          );
          expect(
            find.text(l10n.pmeOwesCashLine(r'$500.00', r'$200.00')),
            findsOneWidget,
          );
          // Header: what is owed now ($300.00), plus what staff hold.
          expect(
            tester
                .widget<Text>(find.byKey(const Key('month-end-owes-total')))
                .data,
            r'$300.00',
          );
          expect(find.text(r'$300.00'), findsNWidgets(2)); // header + Ama's row
          expect(find.text(r'$9,320.96'), findsOneWidget); // Kofi's row
          expect(
            find.text(l10n.pmeOwesStaffHold(r'$9,320.96')),
            findsOneWidget,
          );
          expect(find.text(l10n.pmeOwesCashAsOf), findsOneWidget);
          expect(find.text(l10n.pmeBusinessOwesHint), findsOneWidget);
        },
      );

      testWidgets('[$lang] settled up shows \$0.00 and no Paid back', (
        tester,
      ) async {
        await tester.pumpWidget(
          app(
            owes(
              summaryOf({'even': 1000}),
              OwesCashState.ready,
              balances: [row('even', 1000, 0)],
            ),
            locale: locale,
          ),
        );
        expect(find.text(l10n.pmeOwesSettledUp), findsOneWidget);
        expect(find.text(r'$0.00'), findsOneWidget);
        expect(find.byKey(const Key('month-end-paid-back-even')), findsNothing);
        expect(find.byKey(const Key('month-end-owes-total')), findsNothing);
        expect(
          find.byKey(const Key('month-end-owes-staff-hold')),
          findsNothing,
        );
      });

      testWidgets('[$lang] failure: the fallback line, lines as before', (
        tester,
      ) async {
        await tester.pumpWidget(
          app(owes(summary, OwesCashState.failed), locale: locale),
        );
        expect(find.text(l10n.pmeOwesCashFailed), findsOneWidget);
        expect(find.text(r'$1,477.04'), findsOneWidget);
        expect(find.text(r'$500.00'), findsOneWidget);
        expect(find.text(r'$1,977.04'), findsOneWidget);
        expect(
          find.byKey(const Key('month-end-paid-back-kofi')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('month-end-paid-back-ama')),
          findsOneWidget,
        );
        expect(find.byKey(const Key('month-end-owes-cash-kofi')), findsNothing);
        expect(
          find.byKey(const Key('month-end-owes-staff-hold')),
          findsNothing,
        );
        expect(find.text(l10n.pmeOwesHolds), findsNothing);
      });

      testWidgets('[$lang] loading: the checking line, lines as before', (
        tester,
      ) async {
        await tester.pumpWidget(
          app(owes(summary, OwesCashState.loading), locale: locale),
        );
        expect(find.text(l10n.pmeOwesCashChecking), findsOneWidget);
        expect(
          find.byKey(const Key('month-end-paid-back-kofi')),
          findsOneWidget,
        );
      });
    }

    testWidgets('no Paid back callback (the estimate): never offered', (
      tester,
    ) async {
      await tester.pumpWidget(
        app(
          owes(
            summary,
            OwesCashState.ready,
            balances: balances,
            paidBack: false,
          ),
        ),
      );
      expect(find.byKey(const Key('month-end-paid-back-ama')), findsNothing);
    });

    testWidgets('no lines: no status line at all', (tester) async {
      await tester.pumpWidget(
        app(owes(summaryOf(const {}), OwesCashState.loading)),
      );
      expect(find.byKey(const Key('month-end-owes-cash-status')), findsNothing);
    });
  });

  group('the Paid back sheet prefill', () {
    testWidgets('starts at what the business really owes now', (tester) async {
      await tester.pumpWidget(
        app(
          StaffRepaymentSheet(
            businessId: 'b',
            owed: line('ama', 50000),
            staff: const [(id: 'ama', name: 'Ama')],
            currentUid: 'ama',
            prefillCents: 30000,
          ),
        ),
      );
      expect(find.text('300.00'), findsOneWidget);
    });
  });

  test(
    'Month end asks Staff balances once, with a timeout, and nets the cash',
    () {
      final src = File(
        'lib/screens/parking_month_end_screen.dart',
      ).readAsStringSync();
      expect(src, contains('widget.balancesService.load(widget.businessId)'));
      expect(src, contains('businessOwesWithCash('));
      expect(src, contains('_askCash(summary.businessOwesCents)'));
      expect(src, contains('prefillCents: owedNow < row.owedCents'));
      final service = File(
        'lib/services/staff_balances.dart',
      ).readAsStringSync();
      expect(service, contains('caller(callable, payload).timeout(timeout)'));
      expect(service, contains("'action': 'staff_balances'"));
    },
  );
}

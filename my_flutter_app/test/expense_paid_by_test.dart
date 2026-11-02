import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/lot_ledger_screen.dart';
import 'package:my_flutter_app/services/lot_ledger.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/services/staff_expense_credit.dart';

// Who pays an expense: a person or the business (docs/EXPENSE_PAID_BY.md).
// The arithmetic is covered by the shared fixture in
// staff_expense_credit_test.dart; this checks the app's wiring of it: month
// end counts a standing payer like an expense, and the lot ledger says who
// pays a monthly line.

DateTime at(String iso) => DateTime.parse('${iso}T12:00:00Z');

Map<String, dynamic> stay(int cents) => {
  'id': 'abd-car',
  'customerName': 'Abdoulaye Sow',
  'customerPhone': '(347) 562-8973',
  'carYear': '2020',
  'carMake': 'Toyota',
  'carModel': 'Camry',
  'parkingDate': at('2026-10-01'),
  'parkingEndDate': at('2026-10-31'),
  'amountDueCents': cents,
  'paymentMethod': 'direct',
  'source': 'business',
  'paymentStatus': 'awaiting_direct_payment',
  'status': 'completed',
};

Map<String, dynamic> rent(List<Map<String, dynamic>> payers) => {
  'id': 'rent',
  'label': 'Lot rent',
  'kind': 'fixed',
  'recurringCents': 30000,
  'active': true,
  'payers': payers,
};

ParkingMonthSummary summaryFor(
  List<Map<String, dynamic>> lines, [
  List<Map<String, dynamic>> entries = const [],
]) => parkingMonthSummary(
  [stay(494200)],
  '2026-10',
  DateTime.parse('2026-11-01T13:00:00Z'),
  const [],
  ParkingMonthStaffExpenses(
    entries: entries,
    lines: lines,
    links: {
      'abd': {
        'customerKey': 'phone:3475628973',
        'customerName': 'Abdoulaye Sow',
      },
    },
    staffNames: {'abd': 'Abdoulaye Sow'},
  ),
);

LotExpenseLine line(
  List<Map<String, dynamic>> payers, {
  String kind = 'fixed',
}) => LotExpenseLine.fromMap('rent', {
  'label': 'Lot rent',
  'kind': kind,
  'recurringCents': kind == 'fixed' ? 30000 : 0,
  'createdAt': DateTime(2026, 1, 1),
  'payers': payers,
});

Widget host(Locale locale, Widget child) => MaterialApp(
  locale: locale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: child),
);

void main() {
  group('month end counts a standing payer', () {
    test('a monthly line a person pays comes off their bill', () {
      final summary = summaryFor([
        rent([
          {'fromMonth': '2026-09', 'staffId': 'abd'},
        ]),
      ]);
      final bill = summary.customers.single;
      expect(bill.dueBeforeExpensesCents, 494200);
      // September's and October's rent: $300 each.
      expect(bill.expenseCreditCents, 60000);
      expect(bill.dueCents, 494200 - 60000);
      // Only October's rent is a line of this month's bill.
      expect(
        [for (final l in bill.expenseLines) (l.label, l.amountCents)],
        [('Lot rent', 30000)],
      );
    });

    test('a purchase logged for the month replaces the standing one', () {
      final summary = summaryFor(
        [
          rent([
            {'fromMonth': '2026-10', 'staffId': 'abd'},
          ]),
        ],
        [
          {
            'id': 'e1',
            'lineId': 'rent',
            'paidByStaffId': 'abd',
            'amountCents': 31000,
            'month': '2026-10',
          },
        ],
      );
      expect(summary.customers.single.expenseCreditCents, 31000);
    });

    test('the business paying is nobody\'s credit', () {
      for (final payer in [businessPayer, '']) {
        final summary = summaryFor([
          rent([
            {'fromMonth': '2026-09', 'staffId': payer},
          ]),
        ]);
        expect(summary.customers.single.expenseCreditCents, 0, reason: payer);
        expect(summary.businessOwesCents, 0, reason: payer);
      }
      // A purchase logged as paid by the business counts for nobody either.
      final logged = summaryFor(const [], [
        {
          'id': 'b1',
          'paidByStaffId': businessPayer,
          'amountCents': 5000,
          'month': '2026-10',
        },
      ]);
      expect(logged.customers.single.expenseCreditCents, 0);
      expect(logged.businessOwesCents, 0);
    });
  });

  group('LotExpenseLine reads who pays', () {
    final payers = [
      {'fromMonth': '2026-10', 'staffId': 'yao'},
      {'fromMonth': '2026-12', 'staffId': businessPayer},
    ];

    test('the person in force for the month, with their starting month', () {
      final l = line(payers);
      expect(l.personPayerIn('2026-09'), isNull);
      expect(l.personPayerIn('2026-11')?.staffId, 'yao');
      expect(l.personPayerIn('2026-11')?.fromMonth, '2026-10');
      expect(l.personPayerIn('2026-12'), isNull, reason: 'the business');
    });

    test('a line with no payers, or a metered one, has none', () {
      expect(line(const []).personPayerIn('2026-11'), isNull);
      expect(line(payers, kind: 'metered').personPayerIn('2026-11'), isNull);
    });
  });

  for (final (locale, paidBy) in [
    (const Locale('en'), 'Paid by Yao since October 2026'),
    (const Locale('fr'), 'Payé par Yao depuis octobre 2026'),
  ]) {
    testWidgets('a monthly line says who pays it ($locale)', (tester) async {
      final l = line([
        {'fromMonth': '2026-10', 'staffId': 'yao'},
      ]);
      final math = LotLedgerMath(
        activities: const [],
        lines: [l],
        entries: const [],
        nowMonth: '2026-12',
      );
      Widget card(String label) => host(
        locale,
        ExpenseLineCard(
          line: l,
          month: '2026-11',
          monthLabel: 'November 2026',
          math: math,
          onHistory: () {},
          paidByLabel: label,
        ),
      );
      await tester.pumpWidget(card(paidBy));
      expect(find.text(paidBy), findsOneWidget);
      await tester.pumpWidget(card(''));
      expect(find.byKey(const ValueKey('line-paid-by-rent')), findsNothing);
    });
  }

  test('both languages have the words', () async {
    final en = await AppLocalizations.delegate.load(const Locale('en'));
    final fr = await AppLocalizations.delegate.load(const Locale('fr'));
    expect(en.lotPaidByBusiness, 'The business');
    expect(fr.lotPaidByBusiness, 'L\'entreprise');
    expect(
      en.lotLinePaidBySince('Yao', 'October 2026'),
      'Paid by Yao since October 2026',
    );
    expect(
      fr.lotLinePaidBySince('Yao', 'octobre 2026'),
      'Payé par Yao depuis octobre 2026',
    );
  });
}

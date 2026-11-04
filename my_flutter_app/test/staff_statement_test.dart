import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/services/staff_statement.dart';
import 'package:my_flutter_app/utils/parking_month_pdf.dart';

/// A team member's statement (docs/PARKING_INVOICES.md §6): parking and jobs,
/// less expenses not yet credited, plus the cash they hold at the month's
/// end. The app's mirror of `functions/staff_statement.js`; the server, the
/// console and the app run every case of the shared fixture
/// (`functions/test/fixtures/staff-statement-cases.json`).
ParkingMonthBill _bill(Map<String, dynamic> j, String monthKey) =>
    ParkingMonthBill(
      id: '${j['id']}',
      monthKey: monthKey,
      periodFrom: '2026-10-02',
      periodTo: '2026-10-20',
      days: 19,
      dayRateCents: 5000,
      monthCents: 0,
      monthPaidCents: 0,
      monthUnpaidCents: 0,
      priorUnpaidCents: 0,
      dueCents: 0,
      owes: false,
      stillParked: j['stillParked'] == true,
      partialMonth: false,
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      vehicle: 'Car',
      vinNumber: '',
      trackingCode: '',
    );

ParkingMonthCustomer _customer(Map<String, dynamic> j, String monthKey) {
  final cars = [
    for (final c in (j['cars'] as List? ?? const []))
      _bill((c as Map).cast<String, dynamic>(), monthKey),
  ];
  final month = (j['monthCents'] as int? ?? 0);
  final due = (j['dueBeforeExpensesCents'] as int? ?? 0);
  return ParkingMonthCustomer(
    key: '${j['key']}',
    monthKey: monthKey,
    customerName: '${j['customerName'] ?? ''}',
    customerPhone: '${j['customerPhone'] ?? ''}',
    customerEmail: '',
    cars: cars,
    registeredTo: [for (final _ in cars) ''],
    activities: const [],
    olderActivities: const [],
    activityRegisteredTo: const [],
    olderRegisteredTo: const [],
    monthCents: month,
    monthPaidCents: j['monthPaidCents'] as int? ?? 0,
    monthUnpaidCents: j['monthUnpaidCents'] as int? ?? 0,
    priorUnpaidCents: j['priorUnpaidCents'] as int? ?? 0,
    dueCents: due,
    owes: due > 0,
    paid: month > 0 && due <= 0,
    paidVia: const [],
    partialMonth: false,
    dueBeforeExpensesCents: due,
    linkedStaffIds: [
      for (final id in (j['linkedStaffIds'] as List? ?? const [])) '$id',
    ],
  );
}

List<Map<String, dynamic>> _rows(Object? list) => [
  for (final r in (list as List? ?? const []))
    (r as Map).cast<String, dynamic>(),
];

void main() {
  final fixture =
      jsonDecode(
            File(
              'functions/test/fixtures/staff-statement-cases.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  final cases = (fixture['cases'] as List).cast<Map<String, dynamic>>();

  test('the fixture has its cases', () {
    expect(cases.length, greaterThanOrEqualTo(4));
  });

  group('staffStatements, the shared cases', () {
    for (final c in cases) {
      test(c['name'], () {
        final monthKey = '${c['monthKey']}';
        final ctx = (c['ctx'] as Map).cast<String, dynamic>();
        final result = staffStatements(
          [
            for (final j in (c['customers'] as List))
              _customer((j as Map).cast<String, dynamic>(), monthKey),
          ],
          monthKey: monthKey,
          entries: _rows(ctx['entries']),
          repayments: _rows(ctx['repayments']),
          lines: _rows(ctx['lines']),
          staffNames: {
            for (final e in (ctx['staffNames'] as Map).entries)
              '${e.key}': '${e.value}',
          },
          held: {
            for (final e in (ctx['held'] as Map).entries)
              '${e.key}': (e.value as num).toInt(),
          },
        );
        final want = (c['expected'] as List).cast<Map<String, dynamic>>();
        expect(result.statements.length, want.length);
        for (var i = 0; i < want.length; i++) {
          final got = result.statements[i];
          final w = want[i];
          expect(got.staffId, w['staffId']);
          expect(got.name, w['name']);
          expect(got.key, w['key']);
          expect(got.parkingJobsCents, w['parkingJobsCents']);
          expect(got.expenseCents, w['expenseCents']);
          expect(got.expenseLines.length, w['expenseLineCount']);
          expect(got.earlierExpenseCents, w['earlierExpenseCents']);
          expect(got.cashHeldCents, w['cashHeldCents']);
          expect(got.owesCents, w['owesCents']);
          expect(got.stillParked, w['stillParked']);
        }
        expect(result.customerKeys, (c['customerKeys'] as Map).cast());
      });
    }
  });

  // Alhoussaine, October 2026: $1,226 of parking and jobs, a $35 expense from
  // September not yet credited, $36 held -> owes $1,227. Month end showed
  // $1,191 (no cash line); now the card says what the WhatsApp statement says.
  group('Month end for a team member', () {
    DateTime at(String iso) => DateTime.parse('${iso}T12:00:00Z');
    final nov4 = DateTime.parse('2026-11-04T15:00:00Z');
    Map<String, dynamic> stay(
      String id,
      String name,
      String phone,
      int cents,
      String from,
      String to,
    ) => {
      'id': id,
      'customerName': name,
      'customerPhone': phone,
      'carYear': '2015',
      'carMake': 'Honda',
      'carModel': 'Accord',
      'parkingDate': at(from),
      'parkingEndDate': at(to),
      'amountDueCents': cents,
      'paymentMethod': 'direct',
      'source': 'business',
      'paymentStatus': 'awaiting_direct_payment',
      'status': 'completed',
    };
    final cars = [
      stay(
        'a1',
        'Alhoussaine Barry',
        '+13475550101',
        90000,
        '2026-10-02',
        '2026-10-20',
      ),
      stay(
        'a2',
        'Alhoussaine Barry',
        '+13475550101',
        20000,
        '2026-10-05',
        '2026-10-25',
      ),
      stay(
        'z1',
        'Zed Camara',
        '+12015550099',
        50000,
        '2026-10-03',
        '2026-10-10',
      ),
    ];
    final jobs = [
      {
        'id': 'j1',
        'customerName': 'Alhoussaine Barry',
        'customerPhone': '+13475550101',
        'activityDate': at('2026-10-14'),
        'activityTypeLabel': 'Tire change',
        'feeCents': 12600,
        'paymentStatus': 'awaiting_direct_payment',
      },
    ];
    final expenses = ParkingMonthStaffExpenses(
      entries: [
        {
          'id': 'e-sep',
          'paidByStaffId': 'alh',
          'amountCents': 3500,
          'month': '2026-09',
          'note': 'cups',
          'spentAtMs': at('2026-09-06').millisecondsSinceEpoch,
        },
      ],
      links: {
        'alh': {
          'customerKey': 'phone:3475550101',
          'customerName': 'Alhoussaine Barry',
          'customerPhone': '+13475550101',
        },
      },
      staffNames: {'alh': 'Alhoussaine Barry'},
    );
    ParkingMonthSummary summary(Map<String, int> held) {
      final base = parkingMonthSummary(cars, '2026-10', nov4, jobs, expenses);
      return summaryWithStatements(
        base,
        staffStatements(
          base.customers,
          monthKey: '2026-10',
          entries: parkingMonthCreditEntries(expenses, '2026-10'),
          staffNames: expenses.staffNames,
          held: held,
        ),
      );
    }

    test(r'$1,226 - $35 + $36 = $1,227 (the card used to say $1,191)', () {
      final old = parkingMonthSummary(cars, '2026-10', nov4, jobs, expenses);
      expect(
        old.customers.firstWhere((c) => c.key == 'phone:3475550101').dueCents,
        119100,
      );
      final s = summary({'alh': 3600});
      final card = s.customers.firstWhere((c) => c.key == 'phone:3475550101');
      expect(card.dueBeforeExpensesCents, 122600);
      expect(card.expenseCreditCents, 3500);
      expect(card.cashHeldCents, 3600);
      expect(card.statementOwesCents, 122700);
      expect(card.statementStaffId, 'alh');
      // Zed is a customer: untouched.
      final zed = s.customers.firstWhere((c) => c.key == 'phone:2015550099');
      expect(zed.statementOwesCents, isNull);
      expect(zed.dueCents, 50000);
      expect(s.customersOwing.map((c) => c.key), [
        'phone:3475550101',
        'phone:2015550099',
      ]);
      expect(s.dueCents, 122700 + 50000);
    });

    test('the business owes them: settled, not owing', () {
      final s = summary({'alh': -200000});
      final card = s.customers.firstWhere((c) => c.key == 'phone:3475550101');
      expect(card.statementOwesCents, 122600 - 3500 - 200000);
      expect(cardOwes(card), isFalse);
      expect(cardPaid(card), isTrue);
    });

    test('the bill text and the PDF carry the cash and the total', () async {
      final card = summary({
        'alh': 3600,
      }).customers.firstWhere((c) => c.key == 'phone:3475550101');
      final base = parkingMonthTextWithExpenses(
        parkingMonthCustomerText(card, 'Keren'),
        card,
        title: 'Expenses you paid for the lot',
        less: 'Less expenses',
        lotExpense: 'Lot expense',
        earlier: 'Expenses from earlier months',
      );
      final text = parkingMonthStatementText(
        base,
        card,
        statement: 'Statement',
        cashHeld: 'Cash you hold for the business',
        youOwe: 'You owe the business',
        businessOwesYou: 'The business owes you',
        settled: 'Settled',
      );
      expect(text, contains('Keren — Statement, October 2026'));
      expect(text, contains('Less expenses — -\$35.00'));
      expect(
        text,
        endsWith(
          'Cash you hold for the business — +\$36.00\n'
          'You owe the business: \$1,227.00',
        ),
      );
      expect(text, isNot(contains('BALANCE DUE')));
      await initializeDateFormatting('en');
      final bytes = await buildParkingMonthBillPdf(
        business: const {'name': 'Keren'},
        customer: card,
        copy: ParkingMonthPdfCopy(
          bill: 'Bill',
          summary: 'Summary',
          monthLabel: 'October 2026',
          billedTo: 'Billed to',
          vehicle: 'Vehicle',
          period: 'Period',
          parkingLine: (d, r) => '$d × $r',
          priorUnpaid: 'From before',
          paid: 'Paid',
          balanceDue: 'Balance due',
          paidInFull: 'Paid in full',
          stillParked: 'Still parked',
          left: 'Left',
          soFar: 'so far',
          carsOnLot: 'Cars',
          billed: 'Billed',
          collected: 'Collected',
          owed: 'Owed',
          whoOwes: 'Who owes',
          nobodyOwes: 'Nobody',
          daysLabel: (d) => '$d days',
          footer: 'Footer',
        ),
      );
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    });

    for (final lang in ['en', 'fr']) {
      testWidgets('the card shows the statement in $lang', (tester) async {
        final s = summary({'alh': 3600});
        var view = ParkingMonthView.owing;
        await tester.pumpWidget(
          MaterialApp(
            locale: Locale(lang),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: ParkingMonthCustomerList(
                summary: s,
                view: view,
                onTap: (_) {},
              ),
            ),
          ),
        );
        final l10n = lookupAppLocalizations(Locale(lang));
        expect(find.text(l10n.pmeOwesBusiness), findsOneWidget);
        expect(find.text('\$1,227.00'), findsOneWidget);
        expect(find.text(l10n.pmeCashHeldTitle), findsOneWidget);
        expect(find.text('+\$36.00'), findsOneWidget);
        expect(
          find.byKey(const Key('month-end-statement-line')),
          findsOneWidget,
        );
        expect(view, ParkingMonthView.owing);
        // The words differ between the two languages.
        if (lang == 'fr') {
          expect(l10n.pmeOwesBusiness, 'Doit à l’entreprise');
          expect(l10n.pmeCashHeldTitle, 'Argent détenu pour l’entreprise');
        }
      });
    }
  });

  test('the cash answer is read defensively', () {
    expect(
      staffStatementCashFrom({
        'held': {'a': 3600, 'b': -50, 'c': 'x'},
      }),
      {'a': 3600, 'b': -50},
    );
    expect(staffStatementCashFrom(null), isEmpty);
    expect(staffStatementCashFrom({'held': 'nope'}), isEmpty);
  });
}

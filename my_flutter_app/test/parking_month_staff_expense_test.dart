import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/business_activity_queries.dart';
import 'package:my_flutter_app/services/firestore_query_spec.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/services/staff_expense_repayments.dart';
import 'package:my_flutter_app/utils/parking_month_pdf.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';

/// Staff expenses come off their parking bill (docs/STAFF_EXPENSE_CREDIT.md):
/// the month-end statement nets a linked staff member's credit into their
/// bill, lists what the business still owes its staff, pays only the netted
/// amount on Mark all paid, and the screen shows it all - with Paid back.
DateTime at(String iso) => DateTime.parse('${iso}T12:00:00Z');
final nov1 = DateTime.parse('2026-11-01T13:00:00Z');

/// A closed October stay the business entered, billed [cents] in full.
Map<String, dynamic> stay(String id, String name, String phone, int cents) => {
  'id': id,
  'customerName': name,
  'customerPhone': phone,
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

final abdoulayeCar = stay('abd-car', 'Abdoulaye Sow', '(347) 562-8973', 494200);
final abdoulayeExpenses = ParkingMonthStaffExpenses(
  entries: [
    {
      'id': 'e1',
      'paidByStaffId': 'abd',
      'amountCents': 20000,
      'month': '2026-09',
      'spentAt': Timestamp.fromDate(at('2026-09-20')),
    },
    {
      'id': 'e2',
      'paidByStaffId': 'abd',
      'amountCents': 24831,
      'month': '2026-10',
      'note': 'Snow salt',
      'spentAt': Timestamp.fromDate(at('2026-10-03')),
    },
    {
      'id': 'e3',
      'paidByStaffId': 'abd',
      'amountCents': 5000,
      'month': '2026-10',
      'voided': true,
    },
    {
      'id': 'e4',
      'paidByStaffId': 'abd',
      'amountCents': 9999,
      'month': '2026-11',
    },
  ],
  links: {
    'abd': {'customerKey': 'phone:3475628973', 'customerName': 'Abdoulaye Sow'},
  },
  staffNames: {'abd': 'Abdoulaye Sow', 'mo': 'Mohamed'},
);

final ownerCar = stay('owner-car', 'Alhoussaine Barry', '3472378209', 2000);
final ownerExpenses = ParkingMonthStaffExpenses(
  entries: [
    {
      'id': 'o1',
      'paidByStaffId': 'owner',
      'amountCents': 3500,
      'month': '2026-10',
    },
    {
      'id': 'm1',
      'paidByStaffId': 'mo',
      'amountCents': 6000,
      'month': '2026-09',
    },
  ],
  repayments: [
    {'staffId': 'mo', 'amountCents': 1000, 'month': '2026-10'},
  ],
  links: {
    'owner': {'customerKey': 'phone:3472378209'},
  },
  staffNames: {'owner': 'Alhoussaine Barry', 'mo': 'Mohamed'},
);

Widget app(Widget child, {Locale locale = const Locale('en')}) => MaterialApp(
  locale: locale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: child),
);

class _FakeCaller {
  final calls = <(String, Map<String, Object?>)>[];
  Object? Function(String name, Map<String, Object?> payload)? respond;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    calls.add((name, payload));
    return respond?.call(name, payload) ?? {'success': true};
  }
}

void main() {
  setUpAll(() => initializeDateFormatting('en'));

  group('the statement', () {
    test('without staff expenses: exactly the bills as before', () {
      final s = parkingMonthSummary([abdoulayeCar], '2026-10', nov1);
      final c = s.customers.single;
      expect(c.dueCents, 494200);
      expect(c.dueBeforeExpensesCents, 494200);
      expect(c.expenseCreditCents, 0);
      expect(c.expenseLines, isEmpty);
      expect(s.businessOwes, isEmpty);
      expect(s.expenseCreditCents, 0);
      expect(s.dueCents, 494200);
      expect(monthBillPaymentPlan(c).totalCents, 494200);
    });

    test('Abdoulaye: \$4,942.00 due, \$448.31 expenses -> \$4,493.69', () {
      final s = parkingMonthSummary(
        [abdoulayeCar],
        '2026-10',
        nov1,
        const [],
        abdoulayeExpenses,
      );
      final c = s.customers.single;
      expect(c.key, 'phone:3475628973');
      expect(c.dueBeforeExpensesCents, 494200);
      expect(c.expenseCreditCents, 44831);
      expect(c.dueCents, 449369);
      expect(parkingMoney(c.dueCents), r'$4,493.69');
      expect(c.owes, isTrue);
      expect(c.paid, isFalse);
      expect(c.linkedStaffIds, ['abd']);
      // Only October's expense is listed; September's still counts.
      expect(c.expenseLines.map((l) => l.id), ['e2']);
      expect(c.expenseLines.single.date, '2026-10-03');
      expect(c.expenseLines.single.label, 'Snow salt');
      expect(c.expenseLines.single.staffName, 'Abdoulaye Sow');
      expect(s.dueCents, 449369, reason: 'Still owed is after expenses');
      expect(s.billedCents, 494200, reason: 'Billed is unchanged');
      expect(s.collectedCents, 0, reason: 'Collected is unchanged');
      expect(s.expenseCreditCents, 44831);
      expect(s.businessOwes, isEmpty);
      expect(s.customersOwing.single.key, c.key);
      expect(s.owing.single.id, 'abd-car');
    });

    test('Mark all paid records only what is left after expenses', () {
      final s = parkingMonthSummary(
        [abdoulayeCar],
        '2026-10',
        nov1,
        const [],
        abdoulayeExpenses,
      );
      final plan = monthBillPaymentPlan(s.customers.single);
      expect(plan.items.single.id, 'abd-car');
      expect(plan.items.single.amountCents, 449369);
      expect(plan.totalCents, 449369);
    });

    test(
      'credit bigger than the bill: paid, and the rest is Business owes',
      () {
        final s = parkingMonthSummary(
          [ownerCar, abdoulayeCar],
          '2026-10',
          nov1,
          const [],
          ownerExpenses,
        );
        final owner = s.customers.firstWhere(
          (c) => c.key == 'phone:3472378209',
        );
        expect(owner.dueBeforeExpensesCents, 2000);
        expect(owner.expenseCreditCents, 2000);
        expect(owner.dueCents, 0);
        expect(owner.owes, isFalse);
        expect(owner.paid, isTrue);
        expect(s.customersPaid.map((c) => c.key), [owner.key]);
        expect(s.customersOwing.map((c) => c.key), ['phone:3475628973']);
        expect(s.owing.map((b) => b.id), [
          'abd-car',
        ], reason: 'covered car is not owing');
        expect(s.carsOwing, 1);
        expect(s.dueCents, 494200);
        expect(s.expenseCreditCents, 2000);
        // Nothing left to record for the owner's bill.
        expect(monthBillPaymentPlan(owner).items, isEmpty);
        expect(
          parkingMonthCustomerOptions(
            lookupAppLocalizations(const Locale('en')),
            owner,
          ).map((o) => o.value),
          isNot(contains('settle')),
        );
        expect(
          [
            for (final o in s.businessOwes)
              (
                o.staffId,
                o.staffName,
                o.customerKey,
                o.customerName,
                o.owedCents,
              ),
          ],
          [
            ('mo', 'Mohamed', '', '', 5000),
            (
              'owner',
              'Alhoussaine Barry',
              'phone:3472378209',
              'Alhoussaine Barry',
              1500,
            ),
          ],
        );
        expect(s.businessOwesCents, 6500);
      },
    );

    test('a linked customer with no bill this month keeps the link name', () {
      final s = parkingMonthSummary(
        const [],
        '2026-10',
        nov1,
        const [],
        abdoulayeExpenses,
      );
      expect(s.customers, isEmpty);
      final row = s.businessOwes.single;
      expect(row.customerKey, 'phone:3475628973');
      expect(row.customerName, 'Abdoulaye Sow');
      expect(row.owedCents, 44831);
    });

    test('the shared text gets the expenses at the call site', () {
      final s = parkingMonthSummary(
        [abdoulayeCar],
        '2026-10',
        nov1,
        const [],
        abdoulayeExpenses,
      );
      final c = s.customers.single;
      final base = parkingMonthCustomerText(c, 'Keren Auto Sales');
      final text = parkingMonthTextWithExpenses(
        base,
        c,
        title: 'Expenses you paid for the lot',
        less: 'Less expenses',
        lotExpense: 'Lot expense',
      );
      expect(text, startsWith(base.substring(0, base.lastIndexOf('\n\n'))));
      expect(
        text,
        contains(
          '\n\nExpenses you paid for the lot\n'
          'Oct 3, 2026 · Snow salt · Abdoulaye Sow — \$248.31\n\n'
          'Total for October — \$4,942.00',
        ),
      );
      expect(
        text,
        endsWith('Less expenses — -\$448.31\nBALANCE DUE: \$4,493.69'),
      );
      // Nobody else's text changes.
      final plain = parkingMonthSummary(
        [abdoulayeCar],
        '2026-10',
        nov1,
      ).customers.single;
      final plainText = parkingMonthCustomerText(plain, 'Keren Auto Sales');
      expect(
        parkingMonthTextWithExpenses(
          plainText,
          plain,
          title: 't',
          less: 'l',
          lotExpense: 'x',
        ),
        plainText,
      );
    });
  });

  test('the PDFs carry the expenses and Business owes', () async {
    ParkingMonthPdfCopy copy() => ParkingMonthPdfCopy(
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
      soFar: 'So far',
      carsOnLot: 'Cars',
      billed: 'Billed',
      collected: 'Collected',
      owed: 'Owed',
      whoOwes: 'Who owes',
      nobodyOwes: 'Nobody',
      daysLabel: (d) => '$d days',
      footer: 'Footer',
    );
    final plain = parkingMonthSummary(
      [ownerCar, abdoulayeCar],
      '2026-10',
      nov1,
    );
    final netted = parkingMonthSummary(
      [ownerCar, abdoulayeCar],
      '2026-10',
      nov1,
      const [],
      ParkingMonthStaffExpenses(
        entries: [...abdoulayeExpenses.entries, ...ownerExpenses.entries],
        repayments: ownerExpenses.repayments,
        links: {...abdoulayeExpenses.links, ...ownerExpenses.links},
        staffNames: {
          ...abdoulayeExpenses.staffNames,
          ...ownerExpenses.staffNames,
        },
      ),
    );
    Future<int> summaryPdf(ParkingMonthSummary s) async =>
        (await buildParkingMonthSummaryPdf(
          business: const {'name': 'Keren'},
          summary: s,
          copy: copy(),
        )).length;
    Future<int> billPdf(ParkingMonthSummary s) async =>
        (await buildParkingMonthBillPdf(
          business: const {'name': 'Keren'},
          customer: s.customers.firstWhere((c) => c.key == 'phone:3475628973'),
          copy: copy(),
        )).length;
    expect(await summaryPdf(netted), greaterThan(await summaryPdf(plain)));
    expect(await billPdf(netted), greaterThan(await billPdf(plain)));
  });

  test(
    'month end reads expenses and repayments by business, equality only',
    () {
      for (final spec in [
        lotExpenseEntriesAllSpec('keren'),
        staffExpenseRepaymentsSpec('keren'),
      ]) {
        expect(spec.businessId, 'keren');
        expect(spec.filters.every((f) => f.op == QueryFilterOp.equal), isTrue);
        expect(spec.orderBy, isNull, reason: 'no composite index');
      }
      final screen = File(
        'lib/screens/parking_month_end_screen.dart',
      ).readAsStringSync();
      expect(screen, contains('lotExpenseEntriesAllSpec(widget.businessId)'));
      expect(screen, contains('staffExpenseRepaymentsSpec(widget.businessId)'));
      expect(screen, contains('_creditSafety = Timer('));
    },
  );

  group('refusals', () {
    test('every repayment refusal has its own words, in both languages', () {
      for (final locale in const [Locale('en'), Locale('fr')]) {
        final l10n = lookupAppLocalizations(locale);
        final texts = {
          for (final reason in staffRepaymentRefusals)
            staffRepaymentRefusalText(
              l10n,
              StaffRepaymentFailure(
                code: 'failed-precondition',
                reason: reason,
              ),
            ),
        };
        expect(texts.length, staffRepaymentRefusals.length);
        expect(texts, isNot(contains(l10n.lotCouldNotSave)));
      }
      final failure = parseStaffRepaymentFailure('failed-precondition', {
        'reason': 'repayment_exceeds_credit',
      });
      expect(failure.reason, 'repayment_exceeds_credit');
    });
  });

  group('the screen', () {
    testWidgets('a linked staff card shows Less expenses and its lines', (
      tester,
    ) async {
      final s = parkingMonthSummary(
        [abdoulayeCar],
        '2026-10',
        nov1,
        const [],
        abdoulayeExpenses,
      );
      await tester.pumpWidget(
        app(
          ParkingMonthCustomerList(
            summary: s,
            view: ParkingMonthView.owing,
            onTap: (_) {},
          ),
        ),
      );
      expect(find.text(r'$4,493.69'), findsOneWidget);
      expect(find.text('Less expenses −\$448.31'), findsOneWidget);
      expect(find.text('1 expense this month'), findsOneWidget);
      expect(find.textContaining('Snow salt'), findsNothing);
      await tester.tap(find.byKey(const Key('month-end-toggle-expenses')));
      await tester.pump();
      expect(find.textContaining('Snow salt · Abdoulaye Sow'), findsOneWidget);
      expect(find.text(r'$248.31'), findsOneWidget);
    });

    testWidgets('Business owes lists the staff, and Paid back records it', (
      tester,
    ) async {
      final s = parkingMonthSummary(
        [ownerCar],
        '2026-10',
        nov1,
        const [],
        ownerExpenses,
      );
      final caller = _FakeCaller();
      final service = StaffExpenseRepaymentService(caller: caller.call);
      ParkingMonthStaffOwed? picked;
      final repayment = StaffExpenseRepayment.fromMap('r1', {
        'staffId': 'mo',
        'amountCents': 1000,
        'month': '2026-10',
        'method': 'cash',
        'givenByStaffId': 'owner',
      });
      StaffExpenseRepayment? voided;
      await tester.pumpWidget(
        app(
          Builder(
            builder: (context) => ParkingMonthCustomerList(
              summary: s,
              view: ParkingMonthView.all,
              onTap: (_) {},
              leading: ParkingMonthBusinessOwes(
                summary: s,
                repayments: [repayment],
                staffNames: const {
                  'owner': 'Alhoussaine Barry',
                  'mo': 'Mohamed',
                },
                onPaidBack: (row) {
                  picked = row;
                  showLotSheet<bool>(
                    context,
                    StaffRepaymentSheet(
                      businessId: 'keren',
                      owed: row,
                      staff: const [
                        (id: 'owner', name: 'Alhoussaine Barry'),
                        (id: 'mo', name: 'Mohamed'),
                      ],
                      currentUid: 'owner',
                      service: service,
                    ),
                  );
                },
                onVoid: (r) => voided = r,
              ),
            ),
          ),
        ),
      );

      expect(find.text('Business owes'), findsOneWidget);
      expect(find.text(r'$65.00'), findsOneWidget);
      expect(find.text('No parking bill'), findsOneWidget);
      expect(find.text(r'$50.00'), findsOneWidget);
      expect(find.text(r'$15.00'), findsOneWidget);
      expect(
        find.textContaining('Mohamed · Cash · by Alhoussaine Barry'),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('month-end-void-r1')));
      expect(voided?.id, 'r1');

      await tester.tap(find.byKey(const Key('month-end-paid-back-owner')));
      await tester.pumpAndSettle();
      expect(picked?.staffId, 'owner');
      // Prefilled with what is owed; given by the signed-in person.
      expect(find.text('15.00'), findsOneWidget);
      expect(find.text('Alhoussaine Barry · owed \$15.00'), findsOneWidget);

      // More than owed is refused on the phone, nothing sent.
      await tester.enterText(
        find.byKey(const Key('month-end-paid-back-amount')),
        '20',
      );
      await tester.tap(find.byKey(const Key('month-end-paid-back-save')));
      await tester.pump();
      expect(caller.calls, isEmpty);
      expect(
        find.text(r'Enter an amount above $0.00, up to $15.00.'),
        findsWidgets,
      );

      // A server refusal is shown in words.
      caller.respond = (_, _) => throw FirebaseFunctionsException(
        message: 'refused',
        code: 'failed-precondition',
        details: {'reason': 'repayment_exceeds_credit'},
      );
      await tester.enterText(
        find.byKey(const Key('month-end-paid-back-amount')),
        '10',
      );
      await tester.tap(find.byKey(const Key('month-end-paid-back-save')));
      await tester.pumpAndSettle();
      expect(
        find.text('That is more than the business owes them for expenses.'),
        findsOneWidget,
      );
      expect(caller.calls.single.$1, 'updateLotExpenseEntry');
      expect(caller.calls.single.$2, {
        'action': 'record_staff_repayment',
        'businessId': 'keren',
        'staffId': 'owner',
        'amountCents': 1000,
        'method': 'cash',
        'givenByStaffId': 'owner',
        'note': '',
      });

      caller.respond = null;
      await tester.tap(find.byKey(const Key('month-end-paid-back-save')));
      await tester.pumpAndSettle();
      expect(caller.calls, hasLength(2));
      expect(find.byType(StaffRepaymentSheet), findsNothing);
      expect(find.text(r'Paid back $10.00 recorded.'), findsOneWidget);
    });

    testWidgets('void asks first', (tester) async {
      bool? answer;
      await tester.pumpWidget(
        app(
          Builder(
            builder: (context) => TextButton(
              onPressed: () async => answer = await confirmVoidStaffRepayment(
                context,
                amount: r'$10.00',
                name: 'Mohamed',
              ),
              child: const Text('go'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          r'$10.00 given to Mohamed will count as not paid back. '
          'Nothing is deleted.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('month-end-void-confirm')));
      await tester.pumpAndSettle();
      expect(answer, isTrue);
    });

    testWidgets('French at 360 px: the card, Business owes and the sheet fit', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(360, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final s = parkingMonthSummary(
        [ownerCar, abdoulayeCar],
        '2026-10',
        nov1,
        const [],
        ParkingMonthStaffExpenses(
          entries: [...abdoulayeExpenses.entries, ...ownerExpenses.entries],
          repayments: ownerExpenses.repayments,
          links: {...abdoulayeExpenses.links, ...ownerExpenses.links},
          staffNames: {
            ...abdoulayeExpenses.staffNames,
            ...ownerExpenses.staffNames,
          },
        ),
      );
      final fr = lookupAppLocalizations(const Locale('fr'));
      await tester.pumpWidget(
        app(
          Builder(
            builder: (context) => ParkingMonthCustomerList(
              summary: s,
              view: ParkingMonthView.all,
              onTap: (_) {},
              leading: ParkingMonthBusinessOwes(
                summary: s,
                repayments: [
                  StaffExpenseRepayment.fromMap('r1', {
                    'staffId': 'mo',
                    'amountCents': 1000,
                    'month': '2026-10',
                    'method': 'check',
                    'givenByStaffId': 'owner',
                    'paidAt': Timestamp.fromDate(at('2026-10-15')),
                  }),
                ],
                staffNames: const {
                  'owner': 'Alhoussaine Barry',
                  'mo': 'Mohamed',
                  'abd': 'Abdoulaye Sow',
                },
                onPaidBack: (row) => showLotSheet<bool>(
                  context,
                  StaffRepaymentSheet(
                    businessId: 'keren',
                    owed: row,
                    staff: const [(id: 'owner', name: 'Alhoussaine Barry')],
                    currentUid: 'owner',
                    service: StaffExpenseRepaymentService(
                      caller: _FakeCaller().call,
                    ),
                  ),
                ),
                onVoid: (_) {},
              ),
            ),
          ),
          locale: const Locale('fr'),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.text(fr.pmeBusinessOwes), findsOneWidget);
      expect(find.text(fr.pmeNoParkingBill), findsOneWidget);
      expect(
        find.text(fr.pmeRepaymentsThisMonth.toUpperCase()),
        findsOneWidget,
      );
      expect(find.text(fr.pmeLessExpensesAmount(r'$448.31')), findsOneWidget);
      await tester.tap(find.byKey(const Key('month-end-toggle-expenses')));
      await tester.pump();
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const Key('month-end-paid-back-owner')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text(fr.pmePaidBackAmount), findsOneWidget);
      expect(find.text(fr.pmePaidBackGivenBy), findsOneWidget);
    });
  });
}

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/business_activity_queries.dart';
import 'package:my_flutter_app/services/firestore_query_spec.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/utils/date_display.dart';
import 'package:my_flutter_app/utils/parking_month_pdf.dart';

/// A car that left before the month and still owes comes along on the
/// month's bill as "unpaid from before" (docs/PARKING_CARRYOVER.md). The
/// shared fixture pins the server, the console and this app to the same
/// answers; the text and "Mark all paid" cases mirror the server's
/// `test/parking-carryover.test.js`.
void main() {
  final fixture =
      jsonDecode(
            File(
              'functions/test/fixtures/parking-carryover-cases.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  final cases = (fixture['cases'] as List).cast<Map<String, dynamic>>();

  List<Map<String, dynamic>> carsOf(Map<String, dynamic> k) => [
    for (final c in k['cars'] as List) Map<String, dynamic>.from(c as Map),
  ];
  ParkingMonthSummary summaryOf(Map<String, dynamic> k) => parkingMonthSummary(
    carsOf(k),
    k['monthKey'] as String,
    DateTime.parse(k['now'] as String),
  );
  Map<String, dynamic> caseNamed(String prefix) =>
      cases.firstWhere((k) => (k['name'] as String).startsWith(prefix));

  group('every shared carry-over case gives the server answer', () {
    test('the fixture has its cases', () {
      expect(cases.length, greaterThanOrEqualTo(10));
    });
    for (final k in cases) {
      test(k['name'] as String, () {
        final s = summaryOf(k);
        final expected = k['expect'] as Map<String, dynamic>;
        expect([
          for (final c in s.carried)
            {
              'id': c.id,
              'periodFrom': c.periodFrom,
              'periodTo': c.periodTo,
              'days': c.days,
              'accruedCents': c.accruedCents,
              'dueCents': c.dueCents,
            },
        ], expected['carried']);
        expect([
          for (final c in s.customers)
            {
              'key': c.key,
              'carIds': [for (final b in c.cars) b.id],
              'olderCarIds': [for (final b in c.olderCars) b.id],
              'monthCents': c.monthCents,
              'priorUnpaidCents': c.priorUnpaidCents,
              'dueCents': c.dueCents,
              'owes': c.owes,
              'paid': c.paid,
            },
        ], expected['customers']);
      });
    }
  });

  final mixed = summaryOf(caseNamed('same phone')).customers.single;

  test('is null for a car that never left, or left inside the month', () {
    final now = DateTime.utc(2026, 11, 1, 12);
    expect(
      carriedCarItem(
        {'parkingDate': '2026-09-01', 'dailyRate': 10},
        '2026-10',
        now,
      ),
      isNull,
    );
    expect(
      carriedCarItem(
        {
          'parkingDate': '2026-09-01',
          'parkingEndDate': '2026-10-02',
          'amountDueCents': 100,
        },
        '2026-10',
        now,
      ),
      isNull,
    );
  });

  test('prints the carried car under Unpaid from before in the bill text', () {
    final text = parkingMonthCustomerText(mixed, 'Dala Parking');
    expect(
      text,
      contains(
        'Unpaid from before\n'
        'Sep 6, 2026 to Sep 7, 2026 · Parking · 2021 Toyota Highlander '
        '(registered to Mariam) — \$24.00',
      ),
    );
    expect(text, contains('BALANCE DUE: \$588.00'));
  });

  test('the heading shows for a carried car alone, and lists it first', () {
    final alone = summaryOf(caseNamed('a customer with only')).customers.single;
    final text = parkingMonthCustomerText(alone, 'Dala Parking');
    expect(text, contains('\nUnpaid from before\n'));
    expect(
      text.indexOf('Unpaid from before\n'),
      lessThan(text.indexOf('Total for')),
    );
    expect(text, isNot(contains('\nParking\n')), reason: 'no month cars');
  });

  test(
    'Mark all paid records the carried car first, for what it still owes',
    () {
      final plan = monthBillPaymentPlan(mixed);
      expect(
        [
          for (final i in plan.items) [i.kind, i.id, i.amountCents],
        ],
        [
          ['car', 'highlander', 2400],
          ['car', 'rogue', 56400],
        ],
      );
      expect(plan.totalCents, 58800);
    },
  );

  test('a carried car the business did not enter by hand is skipped', () {
    final k = caseNamed('left in an earlier month');
    final rows = carsOf(k);
    rows.first['paymentMethod'] = 'payment_link';
    final c = parkingMonthSummary(
      rows,
      '2026-10',
      DateTime.utc(2026, 11, 1, 12),
    ).customers.single;
    final plan = monthBillPaymentPlan(c);
    expect(plan.items, isEmpty);
    expect([for (final i in plan.skipped) i.id], ['highlander']);
  });

  test('the carried car is in the customer list, owing', () {
    final s = summaryOf(caseNamed('left in an earlier month'));
    expect(s.customersOwing.single.olderCars.single.id, 'highlander');
    expect(s.olderOwedCents, 2400);
    expect(s.dueCents, 2400);
    expect(s.customersPaid, isEmpty);
    expect(s.bills, isEmpty, reason: 'it is not on the month itself');
  });

  test('the month end reads unpaid cars with one not-in query', () {
    final spec = parkedCarsUnpaidCarriedSpec('biz');
    expect(spec.collection, 'parkedCars');
    expect(spec.filters.length, 2);
    expect(spec.filters[0].field, 'businessId');
    expect(spec.filters[0].op, QueryFilterOp.equal);
    expect(spec.filters[0].value, 'biz');
    expect(spec.filters[1].field, 'paymentStatus');
    expect(spec.filters[1].op, QueryFilterOp.notIn);
    // Exactly the server's list: not_required is read (it still accrues).
    expect(spec.filters[1].value, ['paid', 'succeeded']);
    expect(spec.compositeIndex, const [
      IndexFieldSpec('businessId'),
      IndexFieldSpec('paymentStatus'),
    ]);
  });

  test('the bill PDF lists the carried car under Unpaid from before', () async {
    await initializeDateFormatting('en');
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
    final k = caseNamed('same phone');
    final rows = carsOf(k);
    Future<int> billPdf(List<Map<String, dynamic>> cars) async {
      final c = parkingMonthSummary(
        cars,
        '2026-10',
        DateTime.utc(2026, 11, 1, 12),
      ).customers.single;
      return (await buildParkingMonthBillPdf(
        business: const {'name': 'Dala Parking'},
        customer: c,
        copy: copy(),
      )).length;
    }

    expect(
      await billPdf(rows),
      greaterThan(await billPdf([rows.first])),
      reason: 'the carried car adds its own table',
    );
    // A customer whose only line is a carried car still gets a PDF.
    expect(await billPdf([rows.last]), greaterThan(0));
  });

  Widget harness(ParkingMonthSummary summary, Locale locale) => MaterialApp(
    locale: locale,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(
      body: ParkingMonthCustomerList(
        summary: summary,
        view: ParkingMonthView.owing,
        onTap: (_) {},
      ),
    ),
  );
  final withVin = [
    for (final row in carsOf(caseNamed('left in an earlier month')))
      {...row, 'vinNumber': '5tdkk3dc8ms012345'},
  ];

  for (final code in ['en', 'fr']) {
    testWidgets('the card shows the carried car ($code)', (tester) async {
      final l10n = lookupAppLocalizations(Locale(code));
      final summary = parkingMonthSummary(
        withVin,
        '2026-10',
        DateTime.utc(2026, 11, 1, 12),
      );
      await tester.pumpWidget(harness(summary, Locale(code)));
      expect(tester.takeException(), isNull);

      expect(
        find.byKey(const Key('month-end-carried-highlander')),
        findsOneWidget,
      );
      expect(find.text('2021 Toyota Highlander'), findsOneWidget);
      final from = displayDay('2026-09-06', code);
      final to = displayDay('2026-09-07', code);
      expect(
        find.text(
          '$from → $to · ${l10n.pmeFromBefore.toLowerCase()} · '
          'VIN 5TDKK3DC8MS012345 · ${l10n.pmeRegisteredTo} Mariam',
        ),
        findsOneWidget,
      );
      // The card total and the line's own amount.
      expect(find.text('\$24.00'), findsWidgets);
      expect(find.text('\$24.00 ${l10n.pmeDueWord}'), findsOneWidget);
      expect(
        find.text(l10n.pmeCars(1)),
        findsNothing,
        reason: 'the count joins the phone line',
      );
      expect(find.textContaining(l10n.pmeCars(1)), findsOneWidget);
    });
  }

  test('the screen merges the two car reads and always resolves', () {
    final screen = File(
      'lib/screens/parking_month_end_screen.dart',
    ).readAsStringSync();
    expect(screen, contains('parkedCarsEndingFromSpec(id, startMs)'));
    expect(screen, contains('parkedCarsUnpaidCarriedSpec(id)'));
    // Merged by id before the summary; an error counts as an answer, the
    // safety timer covers a read that never comes; cancelled on dispose.
    expect(screen, contains('[_stayDocs, _unpaidDocs]'));
    expect(screen, contains('_unpaidAnswered = true'));
    expect(screen, contains('_loadingSafety = Timer('));
    expect(screen, contains('for (final s in _monthSubs) {'));
  });

  test(
    'English and French dates differ, so the widget test is not vacuous',
    () {
      expect(
        displayDay('2026-09-06', 'en'),
        isNot(displayDay('2026-09-06', 'fr')),
      );
    },
  );
}

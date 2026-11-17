import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/services/parking_month_table.dart';
import 'package:my_flutter_app/services/staff_statement.dart'
    show cardOwes, cardPaid;
import 'package:my_flutter_app/widgets/parking_month_filter_bar.dart';

import 'support/month_end_fixtures.dart';

// Month end's search, sort and chips. The pure rules mirror the console's
// `parking-month-table.test.ts` case for case (minus the lot filter), so a
// search or a chip gives the same list on the phone and on the website.
void main() {
  final notPaid = testCustomer(
    key: 'a',
    name: 'Moussa Keita',
    dueCents: 110400,
    priorUnpaidCents: 36000,
  );
  final partPaid = testCustomer(
    key: 'b',
    name: 'Ibrahima Bah',
    phone: '+12015550199',
    monthPaidCents: 50000,
    dueCents: 100000,
    cars: [
      testBill(id: 'c1'),
      testBill(
        id: 'c2',
        vehicle: '2017 Toyota Camry',
        vin: '4T1BF1FK7HU300937',
      ),
    ],
  );
  final paid = testCustomer(
    key: 'c',
    name: 'Aminata Condé',
    phone: '+13475550101',
    dueCents: 0,
    owes: false,
    paid: true,
    monthPaidCents: 31000,
  );
  final teamOwes = testCustomer(
    key: 'staff:u1',
    name: 'Sekou Traoré',
    forStaffId: 'u1',
    statementStaffId: 'u1',
    statementOwesCents: 173000,
    cashHeldCents: 60000,
    expenseCreditCents: 31000,
  );
  final teamOwed = testCustomer(
    key: 'staff:u2',
    name: 'Cheick Diakité',
    forStaffId: 'u2',
    statementStaffId: 'u2',
    statementOwesCents: -31800,
  );
  final included = testCustomer(
    key: 'phone:x',
    name: "Sekou's other bill",
    includedInStatementOf: 'Sekou Traoré',
    dueCents: 9000,
  );
  final cards = [paid, partPaid, teamOwed, notPaid, included, teamOwes];

  List<String> keys(Iterable<ParkingMonthCustomer> rows) => [
    for (final r in rows) r.key,
  ];

  // The three views as the statement splits them (staff_statement.dart).
  final owing = [
    for (final c in cards)
      if (cardOwes(c)) c,
  ];

  test('due: the statement number for a team member, 0 inside a statement', () {
    expect(monthRowDueCents(teamOwes), 173000);
    expect(monthRowDueCents(teamOwed), -31800);
    expect(monthRowDueCents(included), 0);
    expect(monthRowDueCents(partPaid), 100000);
  });

  test('Who owes: most owed first (the default sort)', () {
    expect(keys(monthTableRows(owing, MonthTableFilter.empty)), [
      'staff:u1',
      'a',
      'b',
    ]);
  });

  test('sort by name and by cars; ties break by name', () {
    final byName = monthTableRows(
      cards,
      const MonthTableFilter(sort: MonthTableSort.name),
    );
    expect(
      [for (final r in byName) r.customerName],
      [
        'Aminata Condé',
        'Cheick Diakité',
        'Ibrahima Bah',
        'Moussa Keita',
        'Sekou Traoré',
        "Sekou's other bill",
      ],
    );
    expect(
      monthTableRows(
        owing,
        const MonthTableFilter(sort: MonthTableSort.cars),
      ).first.key,
      'b',
    );
  });

  test('chips: part paid, team members, owes from before, not delivered', () {
    const f = MonthTableFilter.empty;
    expect(keys(monthTableRows(owing, f.copyWith(part: true))), ['b']);
    expect(keys(monthTableRows(owing, f.copyWith(team: true))), ['staff:u1']);
    expect(keys(monthTableRows(cards, f.copyWith(team: true))), [
      'staff:u1',
      'staff:u2',
    ]);
    expect(keys(monthTableRows(owing, f.copyWith(older: true))), ['a']);
    final failedA = MonthTableContext(invoiceFailed: (c) => c.key == 'a');
    expect(
      keys(monthTableRows(owing, f.copyWith(notDelivered: true), failedA)),
      ['a'],
    );
    expect(f.narrowed, isFalse);
    expect(f.copyWith(part: true).narrowed, isTrue);
    expect(f.copyWith(query: '  ').narrowed, isFalse);
  });

  test('a chip never matches a team statement as part paid', () {
    final statement = testCustomer(
      key: 'staff:u9',
      statementStaffId: 'u9',
      statementOwesCents: 5000,
      monthPaidCents: 1000,
    );
    expect(isPartPaidCard(statement), isFalse);
  });

  test('search: name without accents, phone in any format, VIN tail, car', () {
    expect(monthSearchMatches(teamOwes, 'sekou traore'), isTrue);
    expect(monthSearchMatches(partPaid, '(201) 555-0199'), isTrue);
    expect(monthSearchMatches(partPaid, '5550199'), isTrue);
    expect(monthSearchMatches(partPaid, '300937'), isTrue);
    expect(monthSearchMatches(partPaid, 'camry'), isTrue);
    expect(monthSearchMatches(partPaid, 'lexus'), isFalse);
    expect(monthSearchMatches(partPaid, '  '), isTrue);
    // Every word must be found, in any order.
    expect(monthSearchMatches(partPaid, 'camry ibrahima'), isTrue);
    expect(monthSearchMatches(partPaid, 'camry moussa'), isFalse);
    expect(
      monthTableRows(cards, const MonthTableFilter(query: 'honda')).length,
      6,
    );
  });

  test('counts: each chip within the view on screen', () {
    final counts = monthTableCounts(
      owing,
      MonthTableContext(invoiceFailed: (c) => c.key == 'a'),
    );
    expect(
      (counts.part, counts.team, counts.older, counts.notDelivered),
      (1, 1, 1, 1),
    );
  });

  test('clearing keeps the sort and drops the chips and the search', () {
    const f = MonthTableFilter(
      part: true,
      team: true,
      query: 'x',
      sort: MonthTableSort.cars,
    );
    final cleared = f.cleared();
    expect(cleared.narrowed, isFalse);
    expect(cleared.sort, MonthTableSort.cars);
  });

  group('the screen pieces', () {
    Widget harness(Locale locale, Widget child) => MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: child),
    );

    ParkingMonthSummary summaryOf(List<ParkingMonthCustomer> list) =>
        ParkingMonthSummary(
          monthKey: '2026-10',
          carsOnLot: 0,
          carsOwing: 0,
          activitiesInMonth: 0,
          customers: list,
          customersOwing: [
            for (final c in list)
              if (cardOwes(c)) c,
          ],
          customersPaid: [
            for (final c in list)
              if (cardPaid(c)) c,
          ],
          billedCents: 0,
          collectedCents: 0,
          owedCents: 0,
          olderOwedCents: 0,
          dueCents: 0,
          owing: const [],
          bills: const [],
          carried: const [],
        );

    Widget page(Locale locale, {double width = 800}) {
      var filter = MonthTableFilter.empty;
      final controller = TextEditingController();
      final summary = summaryOf(cards);
      return harness(
        locale,
        MediaQuery(
          data: MediaQueryData(size: Size(width, 1200)),
          child: StatefulBuilder(
            builder: (context, setState) {
              final shown = parkingMonthListed(summary, ParkingMonthView.all);
              return Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: ParkingMonthFilterBar(
                      filter: filter,
                      controller: controller,
                      counts: monthTableCounts(shown),
                      onChanged: (next) => setState(() => filter = next),
                    ),
                  ),
                  Expanded(
                    child: ParkingMonthCustomerList(
                      summary: summary,
                      view: ParkingMonthView.all,
                      onTap: (_) {},
                      filter: filter,
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      );
    }

    testWidgets(
      'typing narrows the list, a chip filters, Clear filters resets',
      (tester) async {
        tester.view.physicalSize = const Size(800, 1600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(page(const Locale('en')));
        await tester.pumpAndSettle();
        expect(find.text('Moussa Keita'), findsOneWidget);
        expect(find.text('Ibrahima Bah'), findsOneWidget);

        await tester.enterText(
          find.byKey(const Key('month-end-search')),
          'camry',
        );
        await tester.pumpAndSettle();
        expect(find.text('Ibrahima Bah'), findsOneWidget);
        expect(find.text('Moussa Keita'), findsNothing);
        expect(
          find.byKey(const Key('month-end-clear-filters')),
          findsOneWidget,
        );

        await tester.tap(find.byKey(const Key('month-end-clear-filters')));
        await tester.pumpAndSettle();
        expect(find.text('Moussa Keita'), findsOneWidget);
        expect(find.byKey(const Key('month-end-clear-filters')), findsNothing);

        // Part paid: one customer.
        await tester.tap(find.byKey(const Key('month-end-chip-part')));
        await tester.pumpAndSettle();
        expect(find.text('Ibrahima Bah'), findsOneWidget);
        expect(find.text('Moussa Keita'), findsNothing);

        // A search nobody matches says so in words.
        await tester.enterText(
          find.byKey(const Key('month-end-search')),
          'zzz',
        );
        await tester.pumpAndSettle();
        expect(
          find.text('No customer matches. Change the search or the filters.'),
          findsOneWidget,
        );
      },
    );

    testWidgets('sorting by name reorders the cards', (tester) async {
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(page(const Locale('en')));
      await tester.pumpAndSettle();
      double top(String name) => tester.getTopLeft(find.text(name)).dy;
      // Most owed first: Sekou (1,730) before Moussa (1,104).
      expect(top('Sekou Traoré'), lessThan(top('Moussa Keita')));
      await tester.tap(find.byKey(const Key('month-end-sort')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Name A–Z').last);
      await tester.pumpAndSettle();
      expect(top('Aminata Condé'), lessThan(top('Moussa Keita')));
    });

    testWidgets('French on a 320 px phone: no overflow', (tester) async {
      tester.view.physicalSize = const Size(320, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(page(const Locale('fr'), width: 320));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('month-end-search')), 'ibra');
      await tester.pumpAndSettle();
      expect(find.text('Effacer les filtres'), findsOneWidget);
      expect(find.text('Trier par'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

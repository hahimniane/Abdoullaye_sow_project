import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/utils/parking_month_pdf.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';

/// Month end's "Whole month (estimate)": offered only for the month still
/// running, it counts cars still parked to the month's last day, and while it
/// shows nothing can be collected ("Mark all paid" and "open the car to
/// record a payment" are gone). The screen's own pieces, wired the way the
/// screen wires them, with a fixed clock.
DateTime at(String iso) => DateTime.parse('${iso}T12:00:00Z');
final oct29 = DateTime.parse('2026-10-29T15:00:00Z');

final openStay = {
  'id': 'open',
  'customerName': 'Keita',
  'customerPhone': '6465550111',
  'carYear': '2022',
  'carMake': 'Toyota',
  'carModel': 'Camry',
  'parkingDate': at('2026-10-01'),
  'dailyRate': 12,
  'paymentMethod': 'direct',
  'source': 'business',
  'paymentStatus': 'awaiting_direct_payment',
  'status': 'reserved',
};

Widget harness(String monthKey, Locale locale) {
  var whole = false;
  return MaterialApp(
    locale: locale,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(
      body: StatefulBuilder(
        builder: (context, setState) {
          final l10n = AppLocalizations.of(context)!;
          final summary = parkingMonthSummary(
            [openStay],
            monthKey,
            parkingMonthAsOf(monthKey, whole, oct29),
          );
          return Column(
            children: [
              ParkingMonthEstimateBar(
                monthKey: monthKey,
                wholeMonth: whole,
                now: oct29,
                onChanged: (v) => setState(() => whole = v),
              ),
              Text(
                parkingMoney(summary.billedCents),
                key: const Key('billed'),
              ),
              Expanded(
                child: ParkingMonthCustomerList(
                  summary: summary,
                  view: ParkingMonthView.all,
                  onTap: (c) => pickLotOption<String>(
                    context,
                    title: c.customerName,
                    options: parkingMonthCustomerOptions(
                      l10n,
                      c,
                      estimate: whole,
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    ),
  );
}

String billed(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('billed'))).data!;

Future<void> openActions(WidgetTester tester) async {
  await tester.tap(find.text('Keita'));
  await tester.pumpAndSettle();
}

Future<void> closeSheet(WidgetTester tester) async {
  await tester.tapAt(const Offset(10, 10));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a past month has no estimate toggle', (tester) async {
    await tester.pumpWidget(harness('2026-09', const Locale('en')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('month-end-estimate-mode')), findsNothing);
    expect(find.text('So far'), findsNothing);
  });

  testWidgets(
      'the current month: whole month bills to Oct 31 and hides collecting',
      (tester) async {
    final l10n = lookupAppLocalizations(const Locale('en'));
    await tester.pumpWidget(harness('2026-10', const Locale('en')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('month-end-estimate-mode')), findsOneWidget);
    expect(find.text('So far'), findsOneWidget);
    expect(find.text('Whole month (estimate)'), findsOneWidget);
    expect(find.byKey(const Key('month-end-estimate-note')), findsNothing);
    expect(billed(tester), r'$348.00');

    // So far: the payment actions are there.
    await openActions(tester);
    expect(find.text(l10n.pmeMarkAllPaid), findsOneWidget);
    expect(find.text(l10n.pmeOpenCar), findsOneWidget);
    await closeSheet(tester);

    await tester.tap(find.text('Whole month (estimate)'));
    await tester.pumpAndSettle();
    expect(billed(tester), r'$372.00');
    expect(
      find.text(
        'Estimate: cars still parked are counted to Oct 31, 2026. '
        'Nothing is saved.',
      ),
      findsOneWidget,
    );

    // Whole month: nothing to collect for days that have not happened.
    await openActions(tester);
    expect(find.text(l10n.pmeSharePdf), findsOneWidget);
    expect(find.text(l10n.pmeSendText), findsOneWidget);
    expect(find.text(l10n.pmeMarkAllPaid), findsNothing);
    expect(find.text(l10n.pmeOpenCar), findsNothing);
    await closeSheet(tester);

    // Back to so far.
    await tester.tap(find.text('So far'));
    await tester.pumpAndSettle();
    expect(billed(tester), r'$348.00');
    expect(find.byKey(const Key('month-end-estimate-note')), findsNothing);
  });

  testWidgets('French reads the toggle and the note, at phone width',
      (tester) async {
    tester.view.physicalSize = const Size(360, 780);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(harness('2026-10', const Locale('fr')));
    await tester.pumpAndSettle();
    expect(find.text("Jusqu'à aujourd'hui"), findsOneWidget);
    expect(find.text('Mois entier (estimation)'), findsOneWidget);
    await tester.tap(find.text('Mois entier (estimation)'));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Estimation : les voitures encore garées sont comptées jusqu\'au '
        '31 oct. 2026. Rien n\'est enregistré.',
      ),
      findsOneWidget,
    );
    expect(billed(tester), r'$372.00');
    expect(tester.takeException(), isNull);
  });

  test('the papers take the estimate line only when asked', () async {
    final summary = parkingMonthSummary(
      [openStay],
      '2026-10',
      parkingMonthAsOf('2026-10', true, oct29),
    );
    ParkingMonthPdfCopy copy({String estimate = ''}) => ParkingMonthPdfCopy(
      bill: 'Bill',
      summary: 'Summary',
      monthLabel: 'October 2026',
      billedTo: 'Billed to',
      vehicle: 'Vehicle',
      period: 'Period',
      parkingLine: (d, r) => '$d days x $r',
      priorUnpaid: 'From before',
      paid: 'Paid',
      balanceDue: 'Balance due',
      paidInFull: 'Paid in full',
      stillParked: 'still parked',
      left: 'left',
      soFar: 'so far',
      carsOnLot: 'Cars',
      billed: 'Billed',
      collected: 'Collected',
      owed: 'Owed',
      whoOwes: 'Who owes',
      nobodyOwes: 'Nobody owes',
      daysLabel: (d) => '$d days',
      footer: 'Footer',
      estimate: estimate,
    );
    expect(copy().estimate, isEmpty);
    const line =
        'ESTIMATE — whole month, cars still parked counted to Oct 31, 2026';
    for (final build in [
      (ParkingMonthPdfCopy c) => buildParkingMonthSummaryPdf(
        business: const {'name': 'Keren'},
        summary: summary,
        copy: c,
      ),
      (ParkingMonthPdfCopy c) => buildParkingMonthBillPdf(
        business: const {'name': 'Keren'},
        customer: summary.customers.single,
        copy: c,
      ),
    ]) {
      final plain = await build(copy());
      final marked = await build(copy(estimate: line));
      expect(plain, isNotEmpty);
      expect(marked.length, greaterThan(plain.length));
    }
  });

  test('a shared estimate gets one marker line, then the bill unchanged', () {
    final l10n = lookupAppLocalizations(const Locale('en'));
    final summary = parkingMonthSummary(
      [openStay],
      '2026-10',
      parkingMonthAsOf('2026-10', true, oct29),
    );
    final bill = parkingMonthCustomerText(summary.customers.single, 'Keren');
    final shared = parkingMonthEstimateText(
      l10n.pmeEstimateHeader('Oct 31, 2026'),
      bill,
    );
    expect(
      shared,
      'ESTIMATE — whole month, cars still parked counted to Oct 31, 2026\n\n'
      '$bill',
    );
    expect(
      lookupAppLocalizations(const Locale('fr')).pmeEstimateHeader('31 oct. 2026'),
      'ESTIMATION — mois entier, voitures encore garées comptées jusqu\'au '
      '31 oct. 2026',
    );
  });
}

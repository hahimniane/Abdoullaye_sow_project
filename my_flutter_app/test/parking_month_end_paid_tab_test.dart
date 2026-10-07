import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';

/// Month end's third view: "Paid (n)" lists the customers billed for the
/// month with nothing left owing, on the same card as the other views, with
/// what they paid and how. The tabs read Who owes · Paid · Everyone.
DateTime at(String iso) => DateTime.parse('${iso}T12:00:00Z');
final oct1 = DateTime.parse('2026-10-01T13:00:00Z');

Map<String, dynamic> car(Map<String, dynamic> over) => {
      'carYear': '2024',
      'carMake': 'Ford',
      'carModel': 'F150',
      'parkingDate': at('2026-09-01'),
      'dailyRate': 15,
      'paymentStatus': 'awaiting_direct_payment',
      'status': 'reserved',
      ...over,
    };

final paidCar = car({
  'id': 'paid', 'customerName': 'Barry', 'customerPhone': '6465550101',
  'amountPaidCents': 45000,
  'parkingPayments': [
    {'receivedVia': 'cash'},
    {'receivedVia': 'zelle'},
  ],
});
final partCar = car({
  'id': 'part', 'customerName': 'Camara', 'customerPhone': '6465550102',
  'amountPaidCents': 20000,
});
final unpaidCar = car({
  'id': 'unpaid', 'customerName': 'Diallo', 'customerPhone': '6465550103',
});

Widget harness(ParkingMonthSummary summary, Locale locale) {
  var view = ParkingMonthView.owing;
  return MaterialApp(
    locale: locale,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(
      body: StatefulBuilder(
        builder: (context, setState) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 16, 0),
              child: ParkingMonthViewTabs(
                summary: summary,
                view: view,
                onChanged: (v) => setState(() => view = v),
              ),
            ),
            Expanded(
              child: ParkingMonthCustomerList(
                summary: summary,
                view: view,
                onTap: (_) {},
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('Paid lists who paid for the month, with what and how',
      (tester) async {
    final l10n = lookupAppLocalizations(const Locale('en'));
    final summary =
        parkingMonthSummary([paidCar, partCar, unpaidCar], '2026-09', oct1);
    await tester.pumpWidget(harness(summary, const Locale('en')));

    // Who owes · Paid · Everyone, left to right, with their counts.
    final owes = tester.getCenter(find.text('Who owes (2)'));
    final paid = tester.getCenter(find.text('Paid (1)'));
    final everyone = tester.getCenter(find.text('Everyone (3)'));
    expect(owes.dx < paid.dx && paid.dx < everyone.dx, isTrue);

    // Who owes is the default: the partly paid customer still owes.
    expect(find.text('Camara'), findsOneWidget);
    expect(find.text('Diallo'), findsOneWidget);
    expect(find.text('Barry'), findsNothing);

    await tester.tap(find.byKey(const Key('month-end-tab-paid')));
    await tester.pumpAndSettle();
    expect(find.text('Barry'), findsOneWidget);
    expect(find.text('Camara'), findsNothing, reason: 'partly paid still owes');
    expect(find.text('Diallo'), findsNothing);
    expect(
      find.text(
        '${l10n.invPdfPaid} \$450.00 · ${l10n.invMethodCash}, ${l10n.invMethodZelle}',
      ),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('month-end-tab-all')));
    await tester.pumpAndSettle();
    for (final name in ['Barry', 'Camara', 'Diallo']) {
      expect(find.text(name), findsOneWidget);
    }
  });

  testWidgets('nobody paid yet says so', (tester) async {
    final summary = parkingMonthSummary([unpaidCar], '2026-09', oct1);
    await tester.pumpWidget(harness(summary, const Locale('en')));
    await tester.tap(find.text('Paid (0)'));
    await tester.pumpAndSettle();
    expect(find.text('Nobody has paid for this month yet.'), findsOneWidget);
    expect(find.text('Diallo'), findsNothing);
  });

  testWidgets('the three tabs fit a phone in French', (tester) async {
    tester.view.physicalSize = const Size(360, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final summary = parkingMonthSummary(
      [paidCar, partCar, unpaidCar, for (var i = 0; i < 120; i++) car({'id': 'c$i', 'customerName': 'C$i', 'customerPhone': '64655${(10000 + i)}'})],
      '2026-09',
      oct1,
    );
    await tester.pumpWidget(harness(summary, const Locale('fr')));
    expect(tester.takeException(), isNull);
    expect(find.text('Qui doit (122)'), findsOneWidget);
    expect(find.text('Payés (1)'), findsOneWidget);
    expect(find.text('Tout le monde (123)'), findsOneWidget);
    await tester.tap(find.text('Payés (1)'));
    await tester.pumpAndSettle();
    expect(find.text('Barry'), findsOneWidget);

    final empty = parkingMonthSummary([unpaidCar], '2026-09', oct1);
    await tester.pumpWidget(harness(empty, const Locale('fr')));
    await tester.tap(find.text('Payés (0)'));
    await tester.pumpAndSettle();
    expect(find.text('Personne n’a encore payé pour ce mois.'), findsOneWidget);
  });
}

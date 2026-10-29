import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/parked_car.dart';
import 'package:my_flutter_app/screens/home_menu.dart';
import 'package:my_flutter_app/screens/lot_ledger_screen.dart';
import 'package:my_flutter_app/screens/parked_car_details_screen.dart'
    show parkingVoidRefusalText;
import 'package:my_flutter_app/services/lot_ledger.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';
import 'package:my_flutter_app/widgets/void_record_sheet.dart';

// Voiding a parked car or an expense line: the confirm sheet, the refusal
// copy, and the struck-through "Voided · reason · by · date" row, in English
// and French.

Widget host(Locale locale, Widget Function(BuildContext) build) => MaterialApp(
  locale: locale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: Builder(builder: build)),
);

bool struck(WidgetTester tester, String text) {
  final widget = tester.widget<Text>(find.text(text).first);
  return widget.style?.decoration == TextDecoration.lineThrough;
}

void main() {
  for (final (locale, title, explainStart, button) in [
    (const Locale('en'), 'Void this car', 'Void this car — it stays', 'Void'),
    (
      const Locale('fr'),
      'Invalider cette voiture',
      'Invalider cette voiture — elle reste',
      'Invalider',
    ),
  ]) {
    testWidgets('parked car: confirm then void with the reason ($locale)', (
      tester,
    ) async {
      final sent = <String>[];
      bool? popped;
      await tester.pumpWidget(
        host(locale, (context) {
          final l10n = AppLocalizations.of(context)!;
          return TextButton(
            onPressed: () async {
              popped = await showLotSheet<bool>(
                context,
                VoidRecordSheet(
                  title: l10n.parkingVoidTitle,
                  explain: l10n.parkingVoidExplain,
                  actionLabel: l10n.parkingVoid,
                  doneMessage: l10n.parkingVoidDone,
                  onVoid: (reason) async => sent.add(reason),
                  refusalText: (r) => parkingVoidRefusalText(l10n, r),
                ),
              );
            },
            child: const Text('open'),
          );
        }),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      expect(find.text(title), findsOneWidget);
      expect(find.textContaining(explainStart), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('void-reason')),
        '  Entered twice  ',
      );
      await tester.tap(find.text(button).last);
      await tester.pumpAndSettle();

      expect(sent, ['Entered twice']);
      expect(popped, isTrue);
      expect(find.text(title), findsNothing);
    });
  }

  testWidgets('a refused line void shows the reason in French', (tester) async {
    await tester.pumpWidget(
      host(const Locale('fr'), (context) {
        final l10n = AppLocalizations.of(context)!;
        return TextButton(
          onPressed: () => showLotSheet<bool>(
            context,
            VoidRecordSheet(
              title: l10n.lotVoidLineTitle,
              explain: l10n.lotVoidLineExplain,
              actionLabel: l10n.lotVoidLine,
              onVoid: (_) async => throw FirebaseFunctionsException(
                code: 'failed-precondition',
                message: "Void this line's purchases first.",
                details: {'reason': 'line_has_purchases'},
              ),
              refusalText: (r) => lotLineVoidRefusalText(l10n, r),
            ),
          ),
          child: const Text('open'),
        );
      }),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Annuler ce poste'), findsOneWidget);
    await tester.tap(find.text('Annuler le poste').last);
    await tester.pumpAndSettle();
    // Still open, and the refusal is in French, not the server's English.
    expect(find.text('Annuler ce poste'), findsOneWidget);
    expect(
      find.text('Annulez d’abord les achats de ce poste.'),
      findsOneWidget,
    );
  });

  test('voided note: every part, in both languages', () async {
    final en = await AppLocalizations.delegate.load(const Locale('en'));
    final fr = await AppLocalizations.delegate.load(const Locale('fr'));
    final day = DateTime(2026, 10, 3, 12);
    expect(
      voidedNoteText(
        en,
        'en',
        status: en.parkingVoidedStatus,
        reason: 'Entered twice',
        byName: 'Mamadou Diallo',
        at: day,
      ),
      'Voided · Entered twice · by Mamadou Diallo · Oct 3, 2026',
    );
    expect(
      voidedNoteText(
        fr,
        'fr',
        status: fr.parkingVoidedStatus,
        reason: 'Saisie en double',
        byName: 'Mamadou Diallo',
        at: day,
      ),
      'Invalidée · Saisie en double · par Mamadou Diallo · 3 oct. 2026',
    );
    // Nothing known but the fact: just the word.
    expect(voidedNoteText(en, 'en', status: en.lotLineVoidedStatus), 'Voided');
  });

  group('expense line card', () {
    final math = LotLedgerMath(
      activities: const [],
      lines: const [],
      entries: const [],
      nowMonth: '2026-10',
    );
    LotExpenseLine line({bool voided = false}) => LotExpenseLine.fromMap('l1', {
      'label': 'Royal Waste',
      'kind': lotExpenseKindFixed,
      'recurringCents': 2000,
      'active': !voided,
      if (voided) 'voided': true,
      if (voided) 'voidReason': 'Test line',
      if (voided) 'voidedAt': DateTime(2026, 10, 3, 12),
    });

    for (final locale in const [Locale('en'), Locale('fr')]) {
      testWidgets(
        'a live line offers Void next to Edit and History ($locale)',
        (tester) async {
          var voidTaps = 0;
          await tester.pumpWidget(
            host(
              locale,
              (_) => ExpenseLineCard(
                line: line(),
                month: '2026-10',
                monthLabel: 'October',
                math: math,
                onTap: () {},
                onEditLine: () {},
                onHistory: () {},
                onVoid: () => voidTaps += 1,
              ),
            ),
          );
          await tester.tap(find.byKey(const ValueKey('void-line-l1')));
          expect(voidTaps, 1);
          expect(find.byIcon(Icons.edit_outlined), findsOneWidget);
          expect(struck(tester, 'Royal Waste'), isFalse);
        },
      );

      testWidgets('a voided line is struck through, says so, and offers '
          'nothing ($locale)', (tester) async {
        await tester.pumpWidget(
          host(
            locale,
            (_) => ExpenseLineCard(
              line: line(voided: true),
              month: '2026-10',
              monthLabel: 'October',
              math: math,
              onHistory: () {},
              voidedByName: 'Owner Person',
            ),
          ),
        );
        expect(struck(tester, 'Royal Waste'), isTrue);
        final note = tester.widget<Text>(
          find.byKey(const ValueKey('voided-note')),
        );
        expect(
          note.data,
          locale.languageCode == 'en'
              ? 'Voided · Test line · by Owner Person · Oct 3, 2026'
              : 'Annulé · Test line · par Owner Person · 3 oct. 2026',
        );
        expect(find.byKey(const ValueKey('void-line-l1')), findsNothing);
        expect(find.byIcon(Icons.edit_outlined), findsNothing);
        expect(find.byIcon(Icons.history), findsOneWidget);
      });
    }
  });

  for (final locale in const [Locale('en'), Locale('fr')]) {
    testWidgets('a voided parked car row is struck through ($locale)', (
      tester,
    ) async {
      final car = ParkedCar(
        id: 'dup',
        trackingCode: 'PK-1',
        ownerName: 'Diallo',
        carMake: 'Ford',
        carModel: 'F150',
        carYear: '2024',
        vinNumber: '1FTFW1E50PFA63120',
        parkingDate: DateTime(2026, 9, 1),
        paymentFields: {
          'source': 'business',
          'paymentMethod': 'direct',
          'paymentStatus': 'awaiting_direct_payment',
          'voided': true,
          'voidReason': 'Entered twice',
          'voidedByStaffId': 's1',
          'voidedAt': DateTime(2026, 10, 3, 12),
        },
      );
      await tester.pumpWidget(
        host(
          locale,
          (context) => SingleChildScrollView(
            child: parkingListRowForTest(
              l10n: AppLocalizations.of(context)!,
              car: car,
              staffNames: const {'s1': 'Mamadou'},
            ),
          ),
        ),
      );
      expect(struck(tester, '2024 Ford F150'), isTrue);
      final note = tester.widget<Text>(
        find.byKey(const ValueKey('voided-note')),
      );
      expect(
        note.data,
        locale.languageCode == 'en'
            ? 'Voided · Entered twice · by Mamadou · Oct 3, 2026'
            : 'Invalidée · Entered twice · par Mamadou · 3 oct. 2026',
      );
    });
  }

  test('the screens wire the void the server expects', () {
    final details = File(
      'lib/screens/parked_car_details_screen.dart',
    ).readAsStringSync();
    final service = File(
      'lib/services/business_parking_entry.dart',
    ).readAsStringSync();
    final ledger = File(
      'lib/screens/lot_ledger_screen.dart',
    ).readAsStringSync();
    final menu = File('lib/screens/home_menu.dart').readAsStringSync();

    // Parked car: one callable, an action, never a direct write.
    expect(service, contains("'action': 'void'"));
    expect(service, contains("httpsCallable('updateBusinessParkingEntry')"));
    expect(details, contains('_businessParkingService.voidEntry('));
    expect(details, contains('canVoidBusinessParking(_paymentFields)'));
    expect(details, contains("ValueKey<String>('parking-voided')"));
    // A voided car offers no payment card and no edit.
    expect(details, contains('if (isBusinessEntry && !isVoided)'));
    expect(details, contains('!isVoided &&'));
    expect(details, isNot(contains("'voided': true,\n          'voidReason'")));

    // Expense line: the existing callable, with lineId; live lines only for
    // totals and purchases, voided ones listed at the end.
    expect(ledger, contains("'voidLotExpenseEntry', {'lineId': line.id}"));
    expect(ledger, contains('_lines = list.where((l) => l.live).toList();'));
    expect(ledger, contains('for (final line in voidedLines)'));

    // The parking list puts a voided car last, struck through, with its note.
    expect(menu, contains('businessParkingVoided'));
    expect(menu, contains('_parkedCarVoidedNote('));
  });
}

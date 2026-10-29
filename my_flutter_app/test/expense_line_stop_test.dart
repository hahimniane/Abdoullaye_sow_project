import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/lot_ledger_screen.dart';
import 'package:my_flutter_app/services/lot_ledger.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';
import 'package:my_flutter_app/widgets/void_record_sheet.dart';

// "Stop after this month" on an expense line: `endMonth` is the LAST month
// the line counts. Months up to it are unchanged; months after it cost
// nothing, wait on no bill and take no purchase. Mirrors the server's
// `if (/^\d{4}-\d{2}$/.test(end) && month > end) return false`.

LotExpenseLine line({
  String id = 'rent',
  String kind = lotExpenseKindFixed,
  String endMonth = '',
}) => LotExpenseLine.fromMap(id, {
  'label': id == 'rent' ? 'Lot rent' : 'Electricity',
  'kind': kind,
  'recurringCents': kind == lotExpenseKindFixed ? 50000 : 0,
  'createdAt': DateTime(2026, 1, 1),
  'endMonth': endMonth,
});

LotLedgerMath mathOf(List<LotExpenseLine> lines) => LotLedgerMath(
  activities: const [],
  lines: lines,
  entries: const [],
  nowMonth: '2026-12',
);

Widget host(Locale locale, Widget Function(BuildContext) build) => MaterialApp(
  locale: locale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: Builder(builder: build)),
);

void main() {
  group('totals', () {
    test('count up to and including the stop month, nothing after', () {
      final math = mathOf([line(endMonth: '2026-10')]);
      expect(math.monthExpenseCents('2026-09'), 50000);
      expect(math.monthExpenseCents('2026-10'), 50000);
      expect(math.monthExpenseCents('2026-11'), 0);
      expect(math.monthExpenseCents('2026-12'), 0);
      expect(math.lineMonthCents(line(endMonth: '2026-10'), '2026-11'), 0);
      // Ten months, January to October.
      expect(math.expenseByLine(2026).single.cents, 500000);
    });

    test('a missing or malformed stop month runs on', () {
      for (final end in ['', '2026-1', 'oct', '2026-10-01']) {
        final l = line(endMonth: end);
        expect(l.hasEndMonth, isFalse, reason: end);
        expect(mathOf([l]).monthExpenseCents('2026-12'), 50000, reason: end);
      }
    });

    test('reads the field and compares months as text', () {
      final l = line(endMonth: '2026-10');
      expect(l.endMonth, '2026-10');
      expect(l.stoppedIn('2026-10'), isFalse);
      expect(l.stoppedIn('2026-11'), isTrue);
      expect(l.stoppedIn('2027-01'), isTrue);
      expect(l.stoppedIn('2025-12'), isFalse);
    });
  });

  for (final (locale, stopLabel, confirmTitle, explain, confirm) in [
    (
      const Locale('en'),
      'Stop after this month',
      'Stop this line',
      'Lot rent stops after October 2026. Earlier months stay as they are.',
      'Stop',
    ),
    (
      const Locale('fr'),
      'Arrêter après ce mois',
      'Arrêter ce poste',
      'Lot rent s’arrête après octobre 2026. Les mois précédents restent '
          'tels quels.',
      'Arrêter',
    ),
  ]) {
    testWidgets('stop: the button opens the confirm, and it calls ($locale)', (
      tester,
    ) async {
      final calls = <String>[];
      await tester.pumpWidget(
        host(locale, (context) {
          final l10n = AppLocalizations.of(context)!;
          final l = line();
          return ExpenseLineCard(
            line: l,
            month: '2026-10',
            monthLabel: displayLabel(context, '2026-10'),
            math: mathOf([l]),
            onTap: () {},
            onEditLine: () {},
            onHistory: () {},
            onVoid: () {},
            onStop: () => showLotSheet<bool>(
              context,
              VoidRecordSheet(
                title: l10n.lotStopLineTitle,
                explain: l10n.lotStopLineExplain(
                  l.label,
                  displayLabel(context, '2026-10'),
                ),
                actionLabel: l10n.lotStopLineConfirm,
                askReason: false,
                onVoid: (_) async => calls.add('stop 2026-10'),
              ),
            ),
          );
        }),
      );
      expect(find.byKey(const ValueKey('resume-line-rent')), findsNothing);
      expect(find.text(stopLabel), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('stop-line-rent')));
      await tester.pumpAndSettle();
      expect(find.text(confirmTitle), findsOneWidget);
      expect(find.text(explain), findsOneWidget);
      // No reason to type for a stop.
      expect(find.byKey(const ValueKey('void-reason')), findsNothing);
      await tester.tap(find.text(confirm).last);
      await tester.pumpAndSettle();
      expect(calls, ['stop 2026-10']);
      expect(find.text(confirmTitle), findsNothing);
    });

    testWidgets('a stopped line shows its badge and Resume ($locale)', (
      tester,
    ) async {
      var resumed = 0;
      final l = line(endMonth: '2026-10');
      await tester.pumpWidget(
        host(
          locale,
          (_) => ExpenseLineCard(
            line: l,
            month: '2026-11',
            monthLabel: 'November 2026',
            math: mathOf([l]),
            onHistory: () {},
            onResume: () => resumed += 1,
          ),
        ),
      );
      expect(
        find.text(
          locale.languageCode == 'en'
              ? 'Stopped after October 2026'
              : 'Arrêté après octobre 2026',
        ),
        findsOneWidget,
      );
      // After its stop month it reads "Stopped" and costs nothing.
      expect(
        find.textContaining(locale.languageCode == 'en' ? 'Stopped' : 'Arrêté'),
        findsWidgets,
      );
      expect(find.text(r'$0.00'), findsOneWidget);
      expect(find.byKey(const ValueKey('stop-line-rent')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('resume-line-rent')));
      expect(resumed, 1);
    });
  }

  testWidgets('a stopped metered line waits on no bill after its month', (
    tester,
  ) async {
    final l = line(
      id: 'power',
      kind: lotExpenseKindMetered,
      endMonth: '2026-10',
    );
    Future<void> show(String month) => tester.pumpWidget(
      host(
        const Locale('en'),
        (_) => ExpenseLineCard(
          key: ValueKey(month),
          line: l,
          month: month,
          monthLabel: month,
          math: mathOf([l]),
          onHistory: () {},
        ),
      ),
    );
    await show('2026-10');
    expect(find.textContaining("Waiting on this month's bill"), findsOneWidget);
    await show('2026-11');
    expect(find.textContaining("Waiting on this month's bill"), findsNothing);
    expect(find.textContaining('Stopped'), findsWidgets);
  });

  test('the Expenses tab wires stop and resume to the server contract', () {
    final screen = File(
      'lib/screens/lot_ledger_screen.dart',
    ).readAsStringSync();
    expect(screen, contains("httpsCallable('upsertLotExpenseLine')"));
    expect(screen, contains("'action': 'setEndMonth'"));
    expect(screen, contains("'endMonth': endMonth"));
    expect(screen, contains('lotSetLineEndMonth(\n'));
    expect(screen, contains("lotSetLineEndMonth(businessId, line.id, '')"));
    // A line past its stop month goes last and takes no purchase.
    expect(screen, contains('...lines.where((l) => l.stoppedIn(month)),'));
    expect(screen, contains('onTap: line.stoppedIn(month)\n'));
    for (final reason in [
      'end_month_invalid',
      'end_month_before_purchases',
      'line_voided',
      'line_not_found',
    ]) {
      expect(screen, contains("'$reason' =>"));
    }
  });
}

/// The Expenses tab's month heading ("October 2026" / "octobre 2026").
String displayLabel(BuildContext context, String month) =>
    displayMonthYearOf(context, month);

String displayMonthYearOf(BuildContext context, String month) {
  final tag = Localizations.localeOf(context).toLanguageTag();
  return {'en': 'October 2026', 'fr': 'octobre 2026'}[tag] ?? month;
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/invoices_screen.dart';
import 'package:my_flutter_app/services/invoice_ledger.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

/// The invoice list is paged now, so its board can no longer add up the rows
/// it happens to hold. Open, Overdue and Owed come from the open invoices
/// (read whole); the invoice count and the all-time collected figure come
/// from the server's `getInvoiceBoardTotals`; while that cannot be reached
/// the tile says what came in this month - and says so.
Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
}) async {
  // A small phone: the four filter chips must fit without overflowing.
  tester.view.physicalSize = const Size(375, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: child),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('server board totals', () {
    test('reads the callable answer', () {
      final board = InvoiceBoardTotals.fromCallable({
        'board': {
          'count': 42,
          'open': 7,
          'overdue': 2,
          'owedCents': 125050,
          'collectedCents': 9900000,
        },
        'today': '2026-10-05',
      })!;
      expect(board.count, 42);
      expect(board.open, 7);
      expect(board.paid, 35);
      expect(board.overdue, 2);
      expect(board.owedCents, 125050);
      expect(board.collectedCents, 9900000);
    });

    test('anything that is not a board is no board, so the screen falls back',
        () {
      for (final value in [
        null,
        'x',
        <String, Object?>{},
        {'board': 'x'},
        {'board': <String, Object?>{'count': 3}},
        {
          'board': {'count': double.nan, 'collectedCents': 1},
        },
      ]) {
        expect(InvoiceBoardTotals.fromCallable(value), isNull, reason: '$value');
      }
      // iOS hands callable maps over as Map<Object?, Object?>.
      expect(
        InvoiceBoardTotals.fromCallable(<Object?, Object?>{
          'board': <Object?, Object?>{'count': 1, 'collectedCents': 0},
        })?.count,
        1,
      );
    });

    test('collected: the server figure, else this month, never a page sum', () {
      expect(
        invoiceCollectedStat(allTimeCents: 500, thisMonthCents: 20).scope,
        InvoiceCollectedScope.allTime,
      );
      expect(invoiceCollectedStat(thisMonthCents: 20).cents, 20);
      expect(
        invoiceCollectedStat(thisMonthCents: 20).scope,
        InvoiceCollectedScope.thisMonth,
      );
      expect(invoiceCollectedStat().scope, InvoiceCollectedScope.unknown);
      expect(invoiceMonthKey('2026-10-05'), '2026-10');
      expect(invoiceMonthKey('nope'), '');
    });
  });

  group('the board', () {
    testWidgets('says "Collected" for the server total', (tester) async {
      await _pump(
        tester,
        invoicesHeaderForTesting(
          counts: const {'open': 3, 'overdue': 1, 'paid': 9, 'all': 12},
          owedCents: 45000,
          collected: const InvoiceCollectedStat(
            InvoiceCollectedScope.allTime,
            1234500,
          ),
        ),
      );
      expect(find.text('COLLECTED'), findsOneWidget);
      expect(find.text(r'$12,345.00'), findsOneWidget);
      expect(find.text(r'$450.00'), findsOneWidget);
      // Counts on every chip once the server has answered.
      expect(find.text('12'), findsOneWidget);
      expect(find.text('9'), findsOneWidget);
    });

    testWidgets('names the month when it falls back, in English and French',
        (tester) async {
      const stat = InvoiceCollectedStat(InvoiceCollectedScope.thisMonth, 30000);
      await _pump(tester, invoicesHeaderForTesting(collected: stat));
      expect(find.text('COLLECTED THIS MONTH'), findsOneWidget);
      expect(find.text(r'$300.00'), findsOneWidget);

      await _pump(
        tester,
        invoicesHeaderForTesting(collected: stat),
        locale: const Locale('fr'),
      );
      expect(find.text('ENCAISSÉ CE MOIS-CI'), findsOneWidget);
    });

    testWidgets('shows a dash, not zero, before anything answers',
        (tester) async {
      await _pump(tester, invoicesHeaderForTesting());
      expect(
        find.descendant(
          of: find.byKey(const Key('invoices-stat-collected')),
          matching: find.text('—'),
        ),
        findsOneWidget,
      );
      // No paid/all counts without the server: a page is not a count. The
      // one "0" is the Open tile.
      expect(find.text('0'), findsOneWidget);
    });
  });

  group('load more', () {
    testWidgets('asks for older invoices and stays busy until they arrive',
        (tester) async {
      var taps = 0;
      await _pump(
        tester,
        InvoicesLoadMore(searching: false, loading: false, onTap: () => taps++),
      );
      expect(find.text('Load older invoices'), findsOneWidget);
      expect(find.byKey(const Key('invoices-search-loaded-hint')), findsNothing);
      await tester.tap(find.byKey(const Key('invoices-load-more')));
      expect(taps, 1);

      await tester.pumpWidget(
        MaterialApp(
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: Scaffold(
            body: InvoicesLoadMore(
              searching: true,
              loading: true,
              onTap: () => taps++,
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byKey(const Key('invoices-search-loaded-hint')), findsOneWidget);
      await tester.tap(find.byKey(const Key('invoices-load-more')));
      expect(taps, 1, reason: 'a busy button does not fire again');
    });

    testWidgets('reads in French', (tester) async {
      await _pump(
        tester,
        InvoicesLoadMore(searching: true, loading: false, onTap: () {}),
        locale: const Locale('fr'),
      );
      expect(find.text('Charger des factures plus anciennes'), findsOneWidget);
      expect(find.textContaining('La recherche couvre'), findsOneWidget);
    });
  });
}

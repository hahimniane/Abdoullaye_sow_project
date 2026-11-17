import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/line_pieces.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/pieces_editor.dart';

// "How many" and a row priced all together in the app's pieces editor
// (docs/WAITING_PACKAGES.md, owner 2026-11-16/17): the same rules as the
// console's editor (admin_web/src/lib/piece-drafts.test.ts).

Future<void> _pump(
  WidgetTester tester,
  PiecesEditorController controller, {
  Locale locale = const Locale('en'),
  Size size = const Size(375, 812),
  bool requirePrices = true,
}) async {
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              PiecesEditor(
                controller: controller,
                describe: (code) => code,
                requirePrices: requirePrices,
              ),
              PiecesTotalLine(controller: controller),
            ],
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

List<List<Object?>> _sent(PiecesEditorController controller) => [
  for (final piece in controller.draftPieces)
    [piece['id'], piece['kind'], piece['priceCents']],
];

String _text(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data ?? '';

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'three boxes for one price, a barrel, and two boxes priced each',
    (tester) async {
      final controller = PiecesEditorController(kind: 'box');
      await _pump(tester, controller);
      // One piece: no price switch, and nothing to count down from.
      expect(find.byKey(const Key('piece-price-all-0')), findsNothing);
      expect(
        tester
            .widget<IconButton>(find.byKey(const Key('piece-fewer-0')))
            .onPressed,
        isNull,
      );

      // Row 1: three boxes, $200 for all three.
      await tester.enterText(
        find.byKey(const Key('piece-description-0')),
        'Clothes',
      );
      await _tap(tester, 'piece-more-0');
      await _tap(tester, 'piece-more-0');
      expect(_text(tester, 'piece-number-0'), '1–3');
      expect(_text(tester, 'pieces-title'), 'Pieces (3)');
      await tester.enterText(find.byKey(const Key('piece-price-0')), '200');
      await tester.pumpAndSettle();
      // Typed first, read as a price for each until said otherwise.
      expect(_text(tester, 'piece-row-sum-0'), r'3 × $200.00 = $600.00');
      await _tap(tester, 'piece-price-all-0');
      // The number stays as typed: $200 for the three, not $600.
      expect(controller.rows[0].price.text, '200');
      expect(_text(tester, 'piece-row-sum-0'), r'2 at $66.67, 1 at $66.66');

      // Row 2: a barrel at $100.
      await _tap(tester, 'pieces-add');
      await _tap(tester, 'piece-kind-1-barrel');
      await tester.enterText(find.byKey(const Key('piece-price-1')), '100');
      expect(_text(tester, 'piece-number-1'), '4');

      // Row 3: two boxes of shoes at $20 each.
      await _tap(tester, 'pieces-add');
      await _tap(tester, 'piece-kind-2-box');
      await tester.enterText(
        find.byKey(const Key('piece-description-2')),
        'Shoes',
      );
      await _tap(tester, 'piece-more-2');
      await tester.enterText(find.byKey(const Key('piece-price-2')), '20');
      await tester.pumpAndSettle();
      expect(_text(tester, 'piece-number-2'), '5–6');
      expect(_text(tester, 'piece-row-sum-2'), r'2 × $20.00 = $40.00');

      // Six pieces, each with its own price; the barrel shares nobody's.
      expect(_sent(controller), [
        ['', 'box', 6667],
        ['', 'box', 6667],
        ['', 'box', 6666],
        ['', 'barrel', 10000],
        ['', 'box', 2000],
        ['', 'box', 2000],
      ]);
      expect(controller.count, 6);
      expect(controller.totalCents, 34000);
      expect(_text(tester, 'pieces-total-amount'), r'$340.00');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('a saved package opens on the rows it was typed as', (
    tester,
  ) async {
    LinePiece box(String id, int cents, [String what = 'Clothes']) =>
        LinePiece(id: id, kind: 'box', description: what, priceCents: cents);
    final controller = PiecesEditorController(
      initial: [
        box('p1', 6667),
        box('p2', 6667),
        box('p3', 6666),
        const LinePiece(id: 'p4', kind: 'barrel', priceCents: 10000),
        box('p5', 2000, 'Shoes'),
        box('p6', 2000, 'Shoes'),
      ],
    );
    await _pump(tester, controller);
    expect(controller.rows.length, 3);
    expect(
      [
        for (final row in controller.rows)
          [row.count, row.priceFor, row.price.text],
      ],
      [
        [3, 'all', '200'],
        [1, 'each', '100'],
        [2, 'each', '20'],
      ],
    );
    expect(_text(tester, 'pieces-title'), 'Pieces (6)');
    expect(_text(tester, 'piece-row-sum-0'), r'2 at $66.67, 1 at $66.66');
    // Saved untouched: exactly the pieces it had, ids, order and prices.
    expect(_sent(controller), [
      ['p1', 'box', 6667],
      ['p2', 'box', 6667],
      ['p3', 'box', 6666],
      ['p4', 'barrel', 10000],
      ['p5', 'box', 2000],
      ['p6', 'box', 2000],
    ]);
    // One fewer box on the first row, then back: every piece keeps its id.
    await _tap(tester, 'piece-fewer-0');
    expect(_sent(controller).take(2).toList(), [
      ['p1', 'box', 10000],
      ['p2', 'box', 10000],
    ]);
    await _tap(tester, 'piece-more-0');
    expect(
      [for (final p in controller.draftPieces.take(3)) p['id']],
      ['p1', 'p2', 'p3'],
    );
    // A fourth: a new piece, the row's $200 shared in four.
    await _tap(tester, 'piece-more-0');
    expect(_sent(controller).take(4).toList(), [
      ['p1', 'box', 5000],
      ['p2', 'box', 5000],
      ['p3', 'box', 5000],
      ['', 'box', 5000],
    ]);
    expect(_text(tester, 'piece-row-sum-0'), r'$50.00 each');
  });

  testWidgets('a number typed for "How many", said back when it is large', (
    tester,
  ) async {
    final controller = PiecesEditorController(limit: 20);
    await _pump(tester, controller);
    await _tap(tester, 'piece-count-0');
    expect(find.text('How many pieces like this one?'), findsOneWidget);
    expect(find.text('From 1 to 20'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('piece-count-field')), '12');
    await tester.pump();
    // Twelve labels: said before it is taken.
    expect(find.text('Prints 12 labels'), findsOneWidget);
    await tester.tap(find.byKey(const Key('piece-count-done')));
    await tester.pumpAndSettle();
    expect(controller.count, 12);
    expect(_text(tester, 'piece-number-0'), '1–12');

    // More than the package has room for is refused, not cut down in silence.
    await _tap(tester, 'piece-count-0');
    await tester.enterText(find.byKey(const Key('piece-count-field')), '30');
    await tester.pump();
    expect(
      tester
          .widget<TextButton>(find.byKey(const Key('piece-count-done')))
          .onPressed,
      isNull,
    );
    await tester.tap(find.byKey(const Key('piece-count-cancel')));
    await tester.pumpAndSettle();
    expect(controller.count, 12);

    // Another row leaves this one 8 more at most.
    await _tap(tester, 'pieces-add');
    expect(controller.maxCount(1), 8);
    controller.setCount(1, 99);
    expect(controller.count, 20);
    expect(controller.canAdd, isFalse);
  });

  testWidgets('a row with no price is the row that says so', (tester) async {
    final controller = PiecesEditorController(kind: 'box');
    await _pump(tester, controller);
    controller.setCount(0, 3);
    controller.setPriceFor(0, 'all');
    await tester.pumpAndSettle();
    expect(controller.errorsFor(0, requirePrice: true), [
      'piece_description_required',
      'piece_price_required',
    ]);
    expect(
      [for (final p in controller.draftPieces) p['priceCents']],
      [null, null, null],
    );
    // Unreadable stays unreadable on every piece: refused, never guessed.
    await tester.enterText(find.byKey(const Key('piece-price-0')), 'abc');
    expect(
      [for (final p in controller.draftPieces) p['priceCents']],
      ['unreadable', 'unreadable', 'unreadable'],
    );
    expect(controller.errorsFor(0), contains('piece_price_invalid'));
  });

  testWidgets('in French, on a small phone, nothing overflows', (tester) async {
    final controller = PiecesEditorController(
      initial: const [
        LinePiece(
          id: 'p1',
          kind: 'box',
          description: 'Habits',
          priceCents: 6667,
        ),
        LinePiece(
          id: 'p2',
          kind: 'box',
          description: 'Habits',
          priceCents: 6667,
        ),
        LinePiece(
          id: 'p3',
          kind: 'box',
          description: 'Habits',
          priceCents: 6666,
        ),
        LinePiece(id: 'p4', kind: 'barrel', priceCents: 10000),
      ],
    );
    await _pump(
      tester,
      controller,
      locale: const Locale('fr'),
      size: const Size(320, 640),
    );
    expect(find.text('Combien'), findsNWidgets(2));
    expect(find.text('Par colis'), findsOneWidget);
    expect(find.text('Les 3 ensemble'), findsOneWidget);
    expect(_text(tester, 'piece-row-sum-0'), contains(' à '));
    await _tap(tester, 'piece-price-each-0');
    expect(_text(tester, 'piece-row-sum-0'), startsWith('3 × '));
    await _tap(tester, 'piece-count-0');
    expect(find.text('Combien de colis comme celui-ci ?'), findsOneWidget);
    expect(find.text('De 1 à 59'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

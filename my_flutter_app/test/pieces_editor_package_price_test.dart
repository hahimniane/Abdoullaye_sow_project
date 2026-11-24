import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/line_pieces.dart';
import 'package:my_flutter_app/services/package_price_mode.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/pieces_editor.dart';

// One price for the whole package in the pieces editor
// (docs/PACKAGE_ONE_PRICE.md): the same rules as the console's editor and as
// `packagePiecePrices`. Piece mode is the form as it always was.

Future<void> _pump(
  WidgetTester tester,
  PiecesEditorController controller, {
  Locale locale = const Locale('en'),
  Size size = const Size(375, 812),
  bool requirePrices = true,
  bool showErrors = false,
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
                showErrors: showErrors,
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

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

String _text(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data ?? '';

LinePiece _saved(String id, int cents, {String kind = 'box'}) => LinePiece(
  id: id,
  kind: kind,
  description: kind == 'barrel' ? '' : 'Clothes',
  priceCents: cents,
);

List<Object?> _prices(PiecesEditorController c) => [
  for (final p in c.draftPieces) p['priceCents'],
];

PiecesEditorController _package({
  List<LinePiece> initial = const [],
  bool isEdit = false,
  int? packagePriceCents,
  int? pickupFeeCents,
}) => PiecesEditorController(
  initial: initial,
  kind: 'box',
  priceMode: packagePriceModePackage,
  isEdit: isEdit,
  packagePriceCents: packagePriceCents,
  pickupFeeCents: pickupFeeCents,
);

void main() {
  testWidgets('a new package: no price on a row, one price for everything', (
    tester,
  ) async {
    final controller = _package();
    await _pump(tester, controller);
    expect(find.byKey(const Key('piece-price-0')), findsNothing);
    expect(find.byKey(const Key('pieces-package-price')), findsOneWidget);
    expect(
      _text(tester, 'pieces-package-price-label'),
      'Price for everything (\$) *',
    );
    expect(_text(tester, 'pieces-package-count'), '1 piece, one price');

    // Several in a row: no "Each piece / All together" switch, no row sum.
    await _tap(tester, 'piece-more-0');
    await _tap(tester, 'piece-more-0');
    expect(find.byKey(const Key('piece-price-each-0')), findsNothing);
    expect(find.byKey(const Key('piece-price-all-0')), findsNothing);
    expect(find.byKey(const Key('piece-row-sum-0')), findsNothing);
    expect(_text(tester, 'pieces-package-count'), '3 pieces, one price');

    await tester.enterText(
      find.byKey(const Key('pieces-package-price')),
      '100',
    );
    await tester.pumpAndSettle();
    expect(_prices(controller), [3334, 3333, 3333]);
    // The price field is the total: no second "Total" line under it.
    expect(controller.totalCents, 10000);
    expect(find.byKey(const Key('pieces-total')), findsNothing);
    // A new package has nothing saved to compare with: no note.
    expect(find.byKey(const Key('pieces-package-note')), findsNothing);
  });

  testWidgets('the pickup fee is its own field and the total adds it', (
    tester,
  ) async {
    final controller = _package(pickupFeeCents: 2000, packagePriceCents: 8000);
    await _pump(tester, controller);
    expect(find.byKey(const Key('pieces-pickup-fee')), findsOneWidget);
    expect(controller.packagePrice.text, '80');
    expect(controller.totalCents, 10000);
    expect(_prices(controller), [8000]);
    // With a fee the total is the price plus the fee: the line stays.
    expect(_text(tester, 'pieces-total-amount'), '\$100.00');
  });

  testWidgets('an edit opens on the sum and says when pieces were added', (
    tester,
  ) async {
    final controller = _package(
      isEdit: true,
      initial: [
        _saved('p1', 12000),
        _saved('p2', 12000),
        _saved('p3', 6000, kind: 'barrel'),
      ],
    );
    await _pump(tester, controller);
    // The two boxes read the same: one row of two, whatever their prices.
    expect(controller.rows.length, 2);
    expect(controller.rows.first.count, 2);
    expect(controller.packagePrice.text, '300');
    expect(find.byKey(const Key('pieces-package-note')), findsNothing);
    // Saved untouched: the item prices stay.
    expect(_prices(controller), [12000, 12000, 6000]);

    await _tap(tester, 'piece-more-0');
    expect(
      _text(tester, 'pieces-package-note'),
      'You added 1 piece. Still \$300.00 for all 4? Change it here if not.',
    );
    expect(_prices(controller), [7500, 7500, 7500, 7500]);

    await _tap(tester, 'piece-more-0');
    expect(
      _text(tester, 'pieces-package-note'),
      'You added 2 pieces. Still \$300.00 for all 5? Change it here if not.',
    );

    // Back to three, then one fewer than saved.
    await _tap(tester, 'piece-fewer-0');
    await _tap(tester, 'piece-fewer-0');
    await _tap(tester, 'piece-fewer-0');
    expect(
      _text(tester, 'pieces-package-note'),
      'You removed 1 piece. Still \$300.00 for the 2 left? Change it here if not.',
    );
    expect(_prices(controller), [15000, 15000]);

    // The note asks "still the same price?": it goes once another price is
    // typed, and comes back with the saved one.
    await tester.enterText(
      find.byKey(const Key('pieces-package-price')),
      '250',
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pieces-package-note')), findsNothing);
    await tester.enterText(
      find.byKey(const Key('pieces-package-price')),
      '300',
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pieces-package-note')), findsOneWidget);

    // No note while the price is blank.
    await tester.enterText(find.byKey(const Key('pieces-package-price')), '');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pieces-package-note')), findsNothing);
  });

  testWidgets('one piece left reads "the piece left"', (tester) async {
    final controller = _package(
      isEdit: true,
      initial: [_saved('p1', 10000), _saved('p2', 20000)],
    );
    await _pump(tester, controller);
    await _tap(tester, 'piece-fewer-0');
    expect(
      _text(tester, 'pieces-package-note'),
      'You removed 1 piece. Still \$300.00 for the piece left? Change it here if not.',
    );
  });

  testWidgets('in French: the label, the count and the note', (tester) async {
    final controller = _package(
      isEdit: true,
      initial: [_saved('p1', 10000), _saved('p2', 20000)],
    );
    await _pump(tester, controller, locale: const Locale('fr'));
    expect(
      _text(tester, 'pieces-package-price-label'),
      'Prix pour le tout (\$) *',
    );
    expect(_text(tester, 'pieces-package-count'), '2 pièces, un seul prix');
    await _tap(tester, 'piece-more-0');
    final note = _text(tester, 'pieces-package-note');
    expect(note, startsWith('Vous avez ajouté 1 pièce. Toujours '));
    expect(note, contains('300,00'));
    expect(note, endsWith('pour les 3 ? Sinon, modifiez-le ici.'));
    await _tap(tester, 'piece-fewer-0');
    await _tap(tester, 'piece-fewer-0');
    expect(
      _text(tester, 'pieces-package-note'),
      startsWith('Vous avez retiré 1 pièce. Toujours '),
    );
    expect(
      _text(tester, 'pieces-package-note'),
      endsWith('pour celle qui reste ? Sinon, modifiez-le ici.'),
    );
  });

  testWidgets('a customer\'s blank price is said at the price field', (
    tester,
  ) async {
    final controller = _package();
    await _pump(tester, controller, showErrors: true);
    expect(find.text('package_price_required'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('pieces-package-price')), 'x');
    await tester.pumpAndSettle();
    expect(find.text('piece_price_invalid'), findsOneWidget);
    expect(find.text('package_price_required'), findsNothing);
    // The row itself has no price to complain about.
    expect(
      controller.errorsFor(0, requirePrice: true),
      isNot(
        anyOf(
          contains('piece_price_required'),
          contains('piece_price_invalid'),
        ),
      ),
    );
  });

  testWidgets('the business\'s own stock may leave the price blank', (
    tester,
  ) async {
    final controller = _package();
    await _pump(tester, controller, showErrors: true, requirePrices: false);
    expect(find.text('package_price_required'), findsNothing);
    expect(
      find.text('Price for everything (\$)'),
      findsOneWidget,
      reason: 'no required mark for stock',
    );
    expect(_prices(controller), [null]);
    expect(controller.priceProblems(), isEmpty);
  });

  testWidgets('a received request opens on the estimate total', (tester) async {
    final controller = _package(
      initial: [
        _saved('p1', 9000),
        _saved('p2', 4000, kind: 'barrel'),
      ],
      packagePriceCents: 13000,
    );
    await _pump(tester, controller);
    expect(controller.packagePrice.text, '130');
    // Nothing is saved yet, so an untouched receive shares the total.
    expect(_prices(controller), [6500, 6500]);
    expect(find.byKey(const Key('pieces-package-note')), findsNothing);
  });

  testWidgets('piece mode is the form as it always was', (tester) async {
    final controller = PiecesEditorController(kind: 'box');
    await _pump(tester, controller);
    expect(controller.isPackageMode, isFalse);
    expect(find.byKey(const Key('piece-price-0')), findsOneWidget);
    expect(find.byKey(const Key('pieces-package-price')), findsNothing);
    expect(find.byKey(const Key('pieces-package-price-block')), findsNothing);
    await _tap(tester, 'piece-more-0');
    expect(find.byKey(const Key('piece-price-each-0')), findsOneWidget);
    expect(find.byKey(const Key('piece-price-all-0')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('piece-price-0')), '45');
    await tester.pumpAndSettle();
    expect(_prices(controller), [4500, 4500]);
    expect(controller.totalCents, 9000);
    expect(controller.priceProblems(requirePrice: true), isEmpty);
  });
}

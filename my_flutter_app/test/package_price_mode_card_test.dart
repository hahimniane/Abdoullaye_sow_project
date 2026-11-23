import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/package_price_mode.dart';
import 'package:my_flutter_app/services/package_price_mode_source.dart';
import 'package:my_flutter_app/services/package_requests.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/package_price_mode_card.dart';

class _Source implements PackagePriceModeSource {
  _Source({this.fail = false});

  final bool fail;
  final controller = StreamController<String>.broadcast();
  final saved = <String>[];
  final gate = Completer<void>();
  bool holdSave = false;

  @override
  Stream<String> watch(String businessId) => controller.stream;

  @override
  Future<String> save(String businessId, String mode) async {
    if (holdSave) await gate.future;
    if (fail) throw Exception('nope');
    saved.add(mode);
    return mode;
  }
}

Future<void> _pump(
  WidgetTester tester,
  PackagePriceModeSource source, {
  bool canEdit = true,
  Locale locale = const Locale('en'),
}) => tester.pumpWidget(
  MaterialApp(
    theme: AppTheme.light,
    locale: locale,
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    home: Scaffold(
      body: PackagePriceModeCard(
        businessId: 'biz',
        canEdit: canEdit,
        source: source,
        timeout: const Duration(seconds: 2),
      ),
    ),
  ),
);

bool _selected(WidgetTester tester, String key) => tester
    .widget<Semantics>(
      find
          .ancestor(of: find.byKey(Key(key)), matching: find.byType(Semantics))
          .first,
    )
    .properties
    .checked!;

void main() {
  testWidgets('a spinner, then the two choices; choosing one saves it', (
    tester,
  ) async {
    final source = _Source();
    await _pump(tester, source);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    source.controller.add(packagePriceModePiece);
    await tester.pumpAndSettle();
    expect(find.text('Package price'), findsOneWidget);
    expect(find.text('A price for each item'), findsOneWidget);
    expect(find.text('One price for the whole package'), findsOneWidget);
    expect(_selected(tester, 'price-mode-piece'), isTrue);

    await tester.tap(find.byKey(const Key('price-mode-package')));
    await tester.pumpAndSettle();
    expect(source.saved, [packagePriceModePackage]);
    expect(_selected(tester, 'price-mode-package'), isTrue);
  });

  testWidgets('a failed save goes back and says so', (tester) async {
    final source = _Source(fail: true);
    await _pump(tester, source);
    source.controller.add(packagePriceModePiece);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('price-mode-package')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('price-mode-error')), findsOneWidget);
    expect(_selected(tester, 'price-mode-piece'), isTrue);
  });

  testWidgets('a read that never answers resolves to "could not load"', (
    tester,
  ) async {
    await _pump(tester, _Source());
    await tester.pump(const Duration(seconds: 3));
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byKey(const Key('price-mode-load-failed')), findsOneWidget);
  });

  testWidgets('others see it read only, in French too', (tester) async {
    final source = _Source();
    await _pump(tester, source, canEdit: false, locale: const Locale('fr'));
    source.controller.add(packagePriceModePackage);
    await tester.pumpAndSettle();
    expect(find.text("Prix d'un colis"), findsOneWidget);
    expect(find.text('Un seul prix pour tout le colis'), findsOneWidget);
    expect(find.byKey(const Key('price-mode-owner-only')), findsOneWidget);
    await tester.tap(find.byKey(const Key('price-mode-piece')));
    await tester.pumpAndSettle();
    expect(source.saved, isEmpty);
  });

  test('the business document says the mode with the proof switches', () {
    expect(
      PackageProofSettings.fromBusiness({}).packagePriceMode,
      packagePriceModePiece,
    );
    final settings = PackageProofSettings.fromBusiness({
      'packagePriceSettings': {'mode': 'package'},
      'shipsByAir': true,
    });
    expect(settings.packagePriceMode, packagePriceModePackage);
    expect(settings.shipsByAir, isTrue);
    expect(settings.anyOn, isFalse);
    expect(settings.toMap().containsKey('packagePriceMode'), isFalse);
  });
}

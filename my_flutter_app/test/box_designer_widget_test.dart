import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/lot_ledger.dart'
    show setMoneyDisplayLanguage;
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/box_designer/box_designer.dart';
import 'package:my_flutter_app/widgets/box_designer/box_geometry.dart';
import 'package:my_flutter_app/widgets/box_designer/box_scene_painter.dart'
    show SceneFraming;

/// The 3D box designer as a customer and as staff meet it.
Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  bool disableAnimations = false,
  double width = 360,
}) async {
  tester.view.physicalSize = Size(width, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  tester.platformDispatcher.accessibilityFeaturesTestValue =
      FakeAccessibilityFeatures(disableAnimations: disableAnimations);
  addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

int? _prices(String id) => switch (id) {
  'small' => 2500,
  'medium' => 3500,
  'large' => 5000,
  _ => null,
};

/// A designer that keeps its own inches, as its parent does.
class _Host extends StatefulWidget {
  const _Host({
    this.start = const BoxDims(14, 10, 8),
    this.badge = BoxBadgePrice.exact,
    this.onDims,
  });

  final BoxDims start;
  final BoxBadgePrice badge;
  final ValueChanged<BoxDims>? onDims;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  late BoxDims dims = widget.start;

  @override
  Widget build(BuildContext context) => BoxDesigner(
    dims: dims,
    badgePrice: widget.badge,
    priceCentsFor: _prices,
    onChanged: (d) {
      setState(() => dims = d);
      widget.onDims?.call(d);
    },
  );
}

String _badge(WidgetTester tester) => tester
    .widget<Text>(
      find.descendant(
        of: find.byKey(const Key('box-badge')),
        matching: find.byType(Text),
      ),
    )
    .data!;

Future<void> _type(WidgetTester tester, String side, String text) async {
  await tester.enterText(find.byKey(Key('box-field-$side')), text);
  await tester.pumpAndSettle();
}

void main() {
  group('editable', () {
    testWidgets('the badge follows the inches typed, with the price', (
      tester,
    ) async {
      BoxDims? last;
      await _pump(tester, _Host(onDims: (d) => last = d));
      // 14 x 10 x 8 is under 18 inches every way: Small.
      expect(_badge(tester), 'Small · \$25.00');
      await _type(tester, 'length', '24');
      await _type(tester, 'width', '18');
      await _type(tester, 'height', '18');
      expect(last, const BoxDims(24, 18, 18));
      expect(_badge(tester), 'Medium · \$35.00');
      // One inch of slack: 31 x 24 x 24 is still Large.
      await _type(tester, 'length', '31');
      await _type(tester, 'width', '24');
      await _type(tester, 'height', '24');
      expect(_badge(tester), 'Large · \$50.00');
    });

    testWidgets('bigger than Large is quoted by the business', (tester) async {
      await _pump(tester, const _Host(start: BoxDims(40, 30, 30)));
      expect(_badge(tester), 'Extra large · the business will quote');
    });

    testWidgets('comparing says "from"', (tester) async {
      await _pump(
        tester,
        const _Host(start: BoxDims(24, 18, 18), badge: BoxBadgePrice.from),
      );
      expect(_badge(tester), 'Medium · from \$35.00');
    });

    testWidgets('a decimal and a comma are read; nonsense is flagged', (
      tester,
    ) async {
      BoxDims? last;
      await _pump(tester, _Host(onDims: (d) => last = d));
      await _type(tester, 'length', '20,5');
      expect(last?.l, 20.5);
      expect(find.byKey(const Key('box-range-error')), findsNothing);
      last = null;
      await _type(tester, 'length', '121');
      expect(last, isNull);
      expect(find.byKey(const Key('box-range-error')), findsOneWidget);
      expect(find.text('Enter 1 to 120 inches.'), findsOneWidget);
    });

    testWidgets('a slider changes the inches by whole inches', (tester) async {
      BoxDims? last;
      await _pump(tester, _Host(onDims: (d) => last = d));
      await tester.drag(
        find.byKey(const Key('box-slider-height')),
        const Offset(80, 0),
      );
      await tester.pumpAndSettle();
      expect(last, isNotNull);
      expect(last!.h, greaterThan(8));
      expect(last!.h, last!.h.roundToDouble());
    });

    testWidgets('dragging the picture spins it and never throws', (
      tester,
    ) async {
      await _pump(tester, const _Host());
      final scene = find.byKey(const Key('box-scene'));
      await tester.drag(scene, const Offset(120, 400));
      await tester.pump();
      await tester.drag(scene, const Offset(-300, -900));
      await tester.pump();
      expect(tester.takeException(), isNull);
    });

    testWidgets('reduced motion frames the box at once, not eased', (
      tester,
    ) async {
      Duration framing() => tester
          .widget<TweenAnimationBuilder<SceneFraming>>(
            find.byType(TweenAnimationBuilder<SceneFraming>),
          )
          .duration;
      await _pump(tester, const _Host());
      expect(framing(), greaterThan(Duration.zero));
      await _pump(tester, const _Host(), disableAnimations: true);
      expect(framing(), Duration.zero);
    });

    testWidgets('French: words and a narrow phone', (tester) async {
      setMoneyDisplayLanguage('fr');
      addTearDown(() => setMoneyDisplayLanguage('en'));
      await _pump(
        tester,
        const _Host(start: BoxDims(24, 18, 18)),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text('Longueur'), findsOneWidget);
      expect(find.text('Largeur'), findsOneWidget);
      expect(find.text('Hauteur'), findsOneWidget);
      expect(_badge(tester), allOf(startsWith('Moyenne · '), contains('35,00')));
      expect(find.text('Faites glisser pour tourner'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('read-only', () {
    testWidgets('no sliders or fields, the inches in a line, still spins', (
      tester,
    ) async {
      await _pump(tester, const BoxDesigner(dims: BoxDims(24, 18, 18)));
      expect(find.byType(Slider), findsNothing);
      expect(find.byType(TextField), findsNothing);
      expect(find.text('24 × 18 × 18 in'), findsOneWidget);
      // Without prices it names the size only.
      expect(find.byKey(const Key('box-badge')), findsOneWidget);
      expect(_badge(tester), 'Medium');
      await tester.drag(
        find.byKey(const Key('box-scene')),
        const Offset(90, 20),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  });
}

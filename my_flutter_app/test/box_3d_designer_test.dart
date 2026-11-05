import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/box_3d_page.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/box_designer/box_3d_web_view.dart';
import 'package:my_flutter_app/widgets/box_designer/box_designer.dart';
import 'package:my_flutter_app/widgets/box_designer/box_geometry.dart';
import 'package:my_flutter_app/widgets/box_designer/box_scene_painter.dart'
    show BoxScenePainter;

/// A stand-in for the embedded page: records what the designer asks of it.
class _FakeWeb implements Box3dWebViewHandle {
  _FakeWeb(this.request);

  final Box3dWebViewRequest request;
  final scripts = <String>[];
  bool disposed = false;

  @override
  Widget build(BuildContext context) =>
      const SizedBox.expand(key: Key('fake-web'));

  @override
  Future<void> runJavaScript(String script) async => scripts.add(script);

  @override
  void dispose() => disposed = true;

  void say(String message) => request.onMessage(message);
}

Future<void> _pump(
  WidgetTester tester,
  Widget Function(Locale) child, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(360, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: SingleChildScrollView(child: child(locale))),
    ),
  );
  await tester.pump();
}

class _Host extends StatefulWidget {
  const _Host({required this.factory, this.editable = true});

  final Box3dWebViewFactory factory;
  final bool editable;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  BoxDims dims = BoxDims.start;

  void setDims(BoxDims d) => setState(() => dims = d);

  @override
  Widget build(BuildContext context) => BoxDesigner(
    dims: dims,
    webViewFactory: widget.factory,
    pageBaseUrl: 'http://localhost:9999/box-3d/',
    onChanged: widget.editable ? (d) => setState(() => dims = d) : null,
  );
}

double _opacity(WidgetTester tester) => tester
    .widget<AnimatedOpacity>(find.byKey(const Key('box-3d-page')))
    .opacity;

bool _pageInTree() => find.byKey(const Key('fake-web')).evaluate().isNotEmpty;

bool _painterInTree() => find
    .byWidgetPredicate((w) => w is CustomPaint && w.painter is BoxScenePainter)
    .evaluate()
    .isNotEmpty;

void main() {
  late List<_FakeWeb> made;
  Box3dWebViewFactory factory() => (request) {
    final web = _FakeWeb(request);
    made.add(web);
    return web;
  };

  setUp(() => made = []);

  testWidgets('loading: the painted scene shows, the page is hidden', (
    tester,
  ) async {
    await _pump(tester, (_) => _Host(factory: factory()));
    expect(made, hasLength(1));
    expect(made.single.request.url.path, '/box-3d/');
    expect(made.single.request.url.queryParameters, {
      'l': '14',
      'w': '10',
      'h': '8',
      'lang': 'en',
    });
    expect(_painterInTree(), isTrue);
    expect(_opacity(tester), 0);
    // The picture can still be spun while it loads.
    await tester.drag(find.byKey(const Key('box-scene')), const Offset(60, 10));
    await tester.pump();
    expect(tester.takeException(), isNull);
    // Let the safety timeout go before the test ends.
    await tester.pump(box3dReadyTimeout);
  });

  testWidgets('"ready" crossfades to the page and the label says so', (
    tester,
  ) async {
    await _pump(tester, (_) => _Host(factory: factory()));
    made.single.say('ready');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(_opacity(tester), 1);
    expect(_pageInTree(), isTrue);
    expect(
      find.bySemanticsLabel(RegExp('next to a person 5 ft 6 in tall')),
      findsOneWidget,
    );
    // The timeout no longer matters.
    await tester.pump(box3dReadyTimeout * 2);
    expect(_pageInTree(), isTrue);
    expect(made.single.disposed, isFalse);
  });

  testWidgets('"failed" keeps the painted scene and lets the page go', (
    tester,
  ) async {
    await _pump(tester, (_) => _Host(factory: factory()));
    made.single.say('failed');
    await tester.pump();
    expect(_pageInTree(), isFalse);
    expect(find.byKey(const Key('box-3d-page')), findsNothing);
    expect(_painterInTree(), isTrue);
    expect(made.single.disposed, isTrue);
    // A late "ready" does not bring it back.
    made.single.say('ready');
    await tester.pump();
    expect(_pageInTree(), isFalse);
  });

  testWidgets('a page error keeps the painted scene', (tester) async {
    await _pump(tester, (_) => _Host(factory: factory()));
    made.single.request.onPageError();
    await tester.pump();
    expect(_pageInTree(), isFalse);
    expect(_painterInTree(), isTrue);
  });

  testWidgets('no "ready" in 10 s keeps the painted scene for good', (
    tester,
  ) async {
    await _pump(tester, (_) => _Host(factory: factory()));
    await tester.pump(const Duration(seconds: 9));
    expect(_pageInTree(), isTrue);
    await tester.pump(const Duration(seconds: 1));
    expect(_pageInTree(), isFalse);
    expect(_painterInTree(), isTrue);
    expect(made.single.disposed, isTrue);
    made.single.say('ready');
    await tester.pump();
    expect(_pageInTree(), isFalse);
  });

  testWidgets('a platform with no WebView keeps the painted scene', (
    tester,
  ) async {
    await _pump(
      tester,
      (_) => _Host(factory: (_) => throw StateError('no webview')),
    );
    expect(_pageInTree(), isFalse);
    expect(_painterInTree(), isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('inches reach the page without a reload, once per frame', (
    tester,
  ) async {
    await _pump(tester, (_) => _Host(factory: factory()));
    final web = made.single;
    web.say('ready');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(web.scripts, isEmpty);
    // Three changes inside one frame: one script, the last inches.
    final host = tester.state<_HostState>(find.byType(_Host));
    host.setDims(const BoxDims(20, 10, 8));
    host.setDims(const BoxDims(21, 10, 8));
    host.setDims(const BoxDims(22, 10, 8));
    await tester.pump();
    expect(web.scripts, [box3dSetDimsScript(const BoxDims(22, 10, 8))]);
    expect(made, hasLength(1), reason: 'the page is never reloaded');
  });

  testWidgets('changes made while loading are sent right after "ready"', (
    tester,
  ) async {
    await _pump(tester, (_) => _Host(factory: factory()));
    final web = made.single;
    await tester.enterText(find.byKey(const Key('box-field-width')), '15');
    await tester.pump();
    expect(web.scripts, isEmpty);
    web.say('ready');
    await tester.pump();
    await tester.pump();
    expect(web.scripts, [box3dSetDimsScript(const BoxDims(14, 15, 8))]);
  });

  testWidgets('a language change calls setLang', (tester) async {
    final locale = ValueNotifier(const Locale('en'));
    final f = factory();
    tester.view.physicalSize = const Size(360, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ValueListenableBuilder<Locale>(
        valueListenable: locale,
        builder: (_, value, _) => MaterialApp(
          theme: AppTheme.light,
          locale: value,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: Scaffold(
            body: SingleChildScrollView(child: _Host(factory: f)),
          ),
        ),
      ),
    );
    final web = made.single;
    web.say('ready');
    await tester.pump();
    locale.value = const Locale('fr');
    await tester.pump();
    await tester.pump();
    expect(web.scripts, [box3dSetLangScript('fr')]);
    expect(made, hasLength(1));
  });

  testWidgets('read-only: the page still shows, controls stay away', (
    tester,
  ) async {
    await _pump(tester, (_) => _Host(factory: factory(), editable: false));
    made.single.say('ready');
    await tester.pump();
    expect(find.byType(Slider), findsNothing);
    expect(find.text('14 × 10 × 8 in'), findsOneWidget);
    expect(_pageInTree(), isTrue);
  });

  testWidgets('leaving the screen disposes the page and its timer', (
    tester,
  ) async {
    await _pump(tester, (_) => _Host(factory: factory()));
    await tester.pumpWidget(const SizedBox());
    expect(made.single.disposed, isTrue);
    // No pending timer is left (the test fails on one).
  });
}

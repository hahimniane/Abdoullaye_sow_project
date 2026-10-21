import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/widgets/system_nav_bar_safe_area.dart';

// Android 15+ edge-to-edge: the app is laid out under a 24px status bar and a
// 48px 3-button navigation bar. Nothing may end up under the navigation bar.
const _statusBar = 24.0;
const _navBar = 48.0;
const _screen = Size(400, 800);

void _phone(WidgetTester tester, {double keyboard = 0}) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = _screen;
  tester.view.viewPadding = const FakeViewPadding(
    top: _statusBar,
    bottom: _navBar,
  );
  tester.view.padding = FakeViewPadding(
    top: _statusBar,
    bottom: keyboard > 0 ? 0 : _navBar,
  );
  tester.view.viewInsets = FakeViewPadding(bottom: keyboard);
  addTearDown(tester.view.reset);
}

Widget _app(TargetPlatform platform, Widget home) => MaterialApp(
  builder: (context, child) =>
      SystemNavBarSafeArea(platform: platform, child: child!),
  home: home,
);

const _bottomKey = Key('bottom');
const _topKey = Key('top');

Widget _edges() => const Stack(
  children: [
    Align(
      alignment: Alignment.topCenter,
      child: SizedBox(key: _topKey, height: 10, width: 10),
    ),
    Align(
      alignment: Alignment.bottomCenter,
      child: SizedBox(key: _bottomKey, height: 10, width: 10),
    ),
  ],
);

void main() {
  test('applies on Android only, never on the web', () {
    expect(
      SystemNavBarSafeArea.appliesTo(TargetPlatform.android, isWeb: false),
      isTrue,
    );
    expect(
      SystemNavBarSafeArea.appliesTo(TargetPlatform.iOS, isWeb: false),
      isFalse,
    );
    expect(
      SystemNavBarSafeArea.appliesTo(TargetPlatform.android, isWeb: true),
      isFalse,
    );
  });

  testWidgets('Android: bottom content stops above the navigation bar', (
    tester,
  ) async {
    _phone(tester);
    await tester.pumpWidget(_app(TargetPlatform.android, _edges()));
    expect(
      tester.getBottomLeft(find.byKey(_bottomKey)).dy,
      _screen.height - _navBar,
    );
    // The status bar is left to app bars / headers (they paint behind it).
    expect(tester.getTopLeft(find.byKey(_topKey)).dy, 0);
  });

  testWidgets('Android: a bottom sheet ends above the navigation bar', (
    tester,
  ) async {
    _phone(tester);
    await tester.pumpWidget(
      _app(
        TargetPlatform.android,
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  builder: (_) => const Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(height: 100),
                      SizedBox(key: _bottomKey, height: 40, width: 100),
                    ],
                  ),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(
      tester.getBottomLeft(find.byKey(_bottomKey)).dy,
      lessThanOrEqualTo(_screen.height - _navBar),
    );
  });

  testWidgets('Android: no extra gap above the keyboard', (tester) async {
    _phone(tester, keyboard: 300);
    await tester.pumpWidget(_app(TargetPlatform.android, _edges()));
    // The keyboard covers the nav bar, so the wrapper adds nothing.
    expect(tester.getBottomLeft(find.byKey(_bottomKey)).dy, _screen.height);
  });

  testWidgets('iOS is unchanged', (tester) async {
    _phone(tester);
    await tester.pumpWidget(_app(TargetPlatform.iOS, _edges()));
    expect(tester.getBottomLeft(find.byKey(_bottomKey)).dy, _screen.height);
  });
}

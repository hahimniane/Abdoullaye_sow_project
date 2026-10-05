import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/screens/staff_home_screen.dart';
import 'package:my_flutter_app/utils/listing_image.dart';
import 'package:my_flutter_app/utils/shared_latest_stream.dart';
import 'package:my_flutter_app/widgets/lazy_indexed_stack.dart';

/// Counts how many times it was created, so a test can tell "kept alive"
/// from "torn down and rebuilt".
class _Counted extends StatefulWidget {
  const _Counted(this.label, this.created);

  final String label;
  final Map<String, int> created;

  @override
  State<_Counted> createState() => _CountedState();
}

class _CountedState extends State<_Counted> {
  int taps = 0;

  @override
  void initState() {
    super.initState();
    widget.created.update(widget.label, (n) => n + 1, ifAbsent: () => 1);
  }

  @override
  Widget build(BuildContext context) => TextButton(
    onPressed: () => setState(() => taps++),
    child: Text('${widget.label} $taps'),
  );
}

Widget _noImage(BuildContext context, Object error, StackTrace? stack) =>
    const SizedBox.shrink();

void main() {
  group('LazyIndexedStack - the staff tabs', () {
    Widget host(int index, List<String> ids, Map<String, int> created) =>
        MaterialApp(
          home: Scaffold(
            body: LazyIndexedStack(
              index: index,
              children: [
                for (final id in ids)
                  KeyedSubtree(
                    key: ValueKey<String>(id),
                    child: _Counted(id, created),
                  ),
              ],
            ),
          ),
        );

    testWidgets('builds a tab on first visit and keeps it after', (
      tester,
    ) async {
      final created = <String, int>{};
      await tester.pumpWidget(host(0, ['home', 'cars', 'settings'], created));
      // Only the tab on screen exists: signing in does not start every tab.
      expect(created, {'home': 1});

      await tester.tap(find.text('home 0'));
      await tester.pump();
      expect(find.text('home 1'), findsOneWidget);

      await tester.pumpWidget(host(1, ['home', 'cars', 'settings'], created));
      await tester.pumpWidget(host(0, ['home', 'cars', 'settings'], created));
      // Back on home: same state (its tap count), never re-created - which
      // for the business home means no listener was dropped and re-read.
      expect(created, {'home': 1, 'cars': 1});
      expect(find.text('home 1'), findsOneWidget);
    });

    testWidgets('a tab keeps its state when tabs appear before it', (
      tester,
    ) async {
      final created = <String, int>{};
      await tester.pumpWidget(host(1, ['home', 'settings'], created));
      await tester.tap(find.text('settings 0'));
      await tester.pump();
      // The business's services load and a Cars tab appears in between.
      await tester.pumpWidget(host(2, ['home', 'cars', 'settings'], created));
      expect(find.text('settings 1'), findsOneWidget);
      expect(created['settings'], 1);
    });

    test('the selected tab follows its id, not its position', () {
      expect(staffTabIndex(['home', 'settings'], null), 0);
      expect(staffTabIndex(['home', 'cars', 'settings'], 'settings'), 2);
      expect(staffTabIndex(['home', 'settings'], 'cars'), 0);
      expect(staffTabIndex(const [], 'cars'), 0);
    });
  });

  group('SharedLatestStream - the destination catalog', () {
    test('every listener shares one upstream and late ones get the latest', () async {
      final upstream = StreamController<int>();
      var starts = 0;
      final shared = SharedLatestStream<int>(() {
        starts++;
        return upstream.stream;
      });
      final a = <int>[];
      final b = <int>[];
      final subA = shared.stream.listen(a.add);
      upstream.add(1);
      await pumpEventQueue();
      final subB = shared.stream.listen(b.add);
      await pumpEventQueue();
      upstream.add(2);
      await pumpEventQueue();
      expect(starts, 1, reason: 'one Cloud Function call for both widgets');
      expect(a, [1, 2]);
      expect(b, [1, 2], reason: 'a late listener gets the cached value first');
      await subA.cancel();
      await subB.cancel();
      await upstream.close();
    });

    test('stops after the last listener, restarts for the next', () async {
      var starts = 0;
      var cancels = 0;
      final shared = SharedLatestStream<int>(() {
        starts++;
        late final StreamController<int> c;
        c = StreamController<int>(
          onListen: () => c.add(starts),
          onCancel: () => cancels++,
        );
        return c.stream;
      });
      final first = <int>[];
      final sub = shared.stream.listen(first.add);
      await pumpEventQueue();
      await sub.cancel();
      await pumpEventQueue();
      expect(cancels, 1);
      expect(shared.isActive, isFalse);
      final second = <int>[];
      final sub2 = shared.stream.listen(second.add);
      await pumpEventQueue();
      expect(starts, 2);
      expect(second, [1, 2], reason: 'cached value, then the fresh one');
      await sub2.cancel();
    });

    test('lingers briefly so stepping between screens does not re-ask', () async {
      final upstream = StreamController<int>.broadcast();
      var starts = 0;
      final shared = SharedLatestStream<int>(() {
        starts++;
        return upstream.stream;
      }, linger: const Duration(milliseconds: 50));
      final sub = shared.stream.listen((_) {});
      await pumpEventQueue();
      await sub.cancel();
      // Back within the linger: the same upstream, no second function call.
      final sub2 = shared.stream.listen((_) {});
      await pumpEventQueue();
      expect(starts, 1);
      await sub2.cancel();
      expect(shared.isActive, isTrue);
      await Future<void>.delayed(const Duration(milliseconds: 80));
      expect(shared.isActive, isFalse);
      await upstream.close();
    });

    test('an error reaches listeners, and a retry starts a fresh upstream', () async {
      var starts = 0;
      final shared = SharedLatestStream<int>(() {
        starts++;
        return starts == 1
            ? Stream<int>.error(StateError('callable refused'))
            : Stream<int>.value(3);
      });
      final errors = <Object>[];
      final sub = shared.stream.listen((_) {}, onError: errors.add);
      await pumpEventQueue();
      expect(errors, hasLength(1));
      await sub.cancel();
      final values = <int>[];
      final retry = shared.stream.listen(values.add);
      await pumpEventQueue();
      expect(starts, 2);
      expect(values, [3]);
      await retry.cancel();
    });
  });

  group('listing photos decode at their shown size', () {
    test('a card decodes at its width in physical pixels', () {
      expect(
        listingImageDecodeWidth(width: 350, height: 176, devicePixelRatio: 3),
        1050,
      );
    });

    test('a squarish thumbnail covers a landscape photo cropped by height', () {
      // 82x70 at 3x: a 16:9 photo cropped to fill needs 70 * 16/9 points.
      expect(
        listingImageDecodeWidth(width: 82, height: 70, devicePixelRatio: 3),
        ((70 * 16 / 9) * 3).ceil(),
      );
    });

    test('is capped, and unbounded boxes decode at the image size', () {
      expect(
        listingImageDecodeWidth(width: 4000, height: 300, devicePixelRatio: 3),
        listingImageMaxDecodeWidth,
      );
      expect(
        listingImageDecodeWidth(
          width: double.infinity,
          height: double.infinity,
          devicePixelRatio: 2,
        ),
        isNull,
      );
    });

    testWidgets('ListingNetworkImage hands the decoder its box width', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Center(
            child: SizedBox(
              width: 200,
              height: 100,
              child: ListingNetworkImage(
                'https://example.invalid/car.jpg',
                errorBuilder: _noImage,
              ),
            ),
          ),
        ),
      );
      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image;
      expect(provider, isA<ResizeImage>());
      final width = (provider as ResizeImage).width;
      final ratio = tester.view.devicePixelRatio;
      // 200 wide beats 100 * 16/9 tall, so the width decides.
      expect(width, (200 * ratio).ceil());
    });
  });
}

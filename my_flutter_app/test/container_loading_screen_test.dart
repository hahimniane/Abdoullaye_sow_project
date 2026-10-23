import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/container_loading_screen.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

/// The loading screen as staff use it: typed codes go through the same path
/// as camera reads (the camera is switched off - no plugin in tests), and a
/// fake caller answers for `assignContainerLines`.

final _box = ShippingContainer.fromMap('c1', {
  'businessId': 'b1',
  'label': 'Sailing 3 Oct, box 2',
  'status': containerStatusLoading,
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
});

typedef _Answer = Object? Function(Map<String, Object?> payload);

/// Records every call and answers from [answers] by action; an answer that
/// is an exception is thrown.
class _FakeCaller {
  _FakeCaller(this.answers);

  final Map<String, _Answer> answers;
  final List<Map<String, Object?>> calls = [];

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    expect(name, 'assignContainerLines');
    calls.add(payload);
    final answer = answers[payload['action']]!(payload);
    if (answer is Exception) throw answer;
    return answer;
  }

  List<Map<String, Object?>> of(String action) =>
      calls.where((c) => c['action'] == action).toList();
}

Map<String, Object?> _scanAnswer(
  String result, {
  String lineId = 'l1',
  String code = 'CL-K7M4P2',
  int pieces = 1,
  int scanned = 1,
}) => {
  'success': true,
  'result': result,
  'line': {
    'lineId': lineId,
    'trackingCode': code,
    'name': 'Mariama Bah',
    'kind': 'barrels',
    'pieceCount': pieces,
    'scannedPieces': scanned,
    'destinationCountryName': 'Guinea',
  },
  'container': {
    'containerId': 'c1',
    'label': 'Sailing 3 Oct, box 2',
    'lineCount': 1,
    'pieceCount': pieces,
  },
};

FirebaseFunctionsException _refusal(
  String code,
  Map<String, Object?> details,
) => FirebaseFunctionsException(
  message: 'refused',
  code: code,
  details: details,
);

Future<List<bool>> _open(
  WidgetTester tester,
  _FakeCaller caller, {
  Locale locale = const Locale('en'),
  Size size = const Size(375, 812),
  Listenable? liveUpdates,
  List<ContainerLine> Function()? liveLines,
}) async {
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final feedback = <bool>[];
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: const Scaffold(body: Text('container page')),
    ),
  );
  tester
      .state<NavigatorState>(find.byType(Navigator))
      .push(
        MaterialPageRoute<void>(
          builder: (_) => ContainerLoadingScreen(
            businessId: 'b1',
            container: _box,
            caller: caller.call,
            cameraEnabled: false,
            feedback: feedback.add,
            liveUpdates: liveUpdates,
            liveLines: liveLines,
          ),
        ),
      );
  await tester.pumpAndSettle();
  return feedback;
}

Future<void> _type(WidgetTester tester, String code) async {
  await tester.enterText(find.byKey(const Key('load-type-code')), code);
  await tester.tap(find.byKey(const Key('load-type-send')));
  await tester.pumpAndSettle();
}

String _totals(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('load-totals'))).data!;

void main() {
  testWidgets('shows the container, where it goes, and a zero total', (
    tester,
  ) async {
    await _open(tester, _FakeCaller({}));
    expect(find.text('Sailing 3 Oct, box 2'), findsOneWidget);
    expect(find.text('To Guinea'), findsOneWidget);
    expect(_totals(tester), '0 packages · 0 pieces scanned');
    expect(find.byKey(const Key('load-no-scans')), findsOneWidget);
    expect(find.text('Done loading'), findsOneWidget);
  });

  testWidgets(
    'a typed code is sent as a scan; loaded, then 2 of 5, then all in',
    (tester) async {
      var scanned = 0;
      final caller = _FakeCaller({
        'scan': (p) {
          scanned++;
          return switch (scanned) {
            1 => _scanAnswer('loaded', pieces: 5, scanned: 1),
            2 => _scanAnswer('counted', pieces: 5, scanned: 2),
            _ => _scanAnswer('all_scanned', pieces: 5, scanned: 5),
          };
        },
      });
      final feedback = await _open(tester, caller);

      await _type(tester, 'cl k7m4p2');
      final first = caller.of('scan').single;
      expect(first['businessId'], 'b1');
      expect(first['containerId'], 'c1');
      expect(first['code'], 'CL-K7M4P2');
      expect(first['scanId'], isA<String>());
      expect(first.containsKey('move'), isFalse);
      expect(find.text('Loaded · 1 of 5'), findsOneWidget);
      expect(_totals(tester), '1 package · 1 piece scanned');
      // What is on the container in all, from the answer.
      expect(
        find.text('On the container: 1 package · 5 pieces'),
        findsOneWidget,
      );
      expect(feedback, [true]);

      await _type(tester, 'CL-K7M4P2');
      expect(find.text('2 of 5'), findsOneWidget);
      expect(_totals(tester), '1 package · 2 pieces scanned');
      // Every scan has its own id.
      expect(caller.of('scan')[1]['scanId'], isNot(first['scanId']));

      await _type(tester, 'CL-K7M4P2');
      expect(find.text('All 5 already in'), findsOneWidget);
      // Nothing changed: it buzzes like a refusal.
      expect(feedback, [true, true, false]);
    },
  );

  testWidgets('a split part code goes through as typed', (tester) async {
    final caller = _FakeCaller({
      'scan': (p) => _scanAnswer('loaded', code: 'CL-K7M4P2-2'),
    });
    await _open(tester, caller);
    await _type(tester, 'clk7m4p2-2');
    expect(caller.of('scan').single['code'], 'CL-K7M4P2-2');
    expect(find.text('CL-K7M4P2-2 · Mariama Bah'), findsOneWidget);
  });

  testWidgets('a code that is not a package is refused at the field', (
    tester,
  ) async {
    final caller = _FakeCaller({});
    await _open(tester, caller);
    await _type(tester, 'hello');
    expect(find.text('That is not a package code.'), findsOneWidget);
    expect(caller.calls, isEmpty);
  });

  testWidgets('a refusal is red, in plain words, and never counted', (
    tester,
  ) async {
    final caller = _FakeCaller({
      'scan': (p) => _refusal('not-found', {'reason': 'line_not_found'}),
    });
    final feedback = await _open(tester, caller);
    await _type(tester, 'CL-K7M4P2');
    expect(find.text('No package has this code.'), findsOneWidget);
    expect(_totals(tester), '0 packages · 0 pieces scanned');
    expect(feedback, [false]);
    expect(find.byKey(const Key('load-undo')), findsNothing);
  });

  testWidgets(
    'no connection: retried once at once, then an error row; never counted',
    (tester) async {
      var online = false;
      final caller = _FakeCaller({
        'scan': (p) =>
            online ? _scanAnswer('loaded') : _refusal('unavailable', {}),
      });
      final feedback = await _open(tester, caller);
      await _type(tester, 'CL-K7M4P2');
      expect(find.text('No connection - scan again'), findsOneWidget);
      expect(_totals(tester), '0 packages · 0 pieces scanned');
      expect(feedback, [false]);
      // One automatic retry of the same request, under the same id.
      var scans = caller.of('scan');
      expect(scans, hasLength(2));
      expect(scans[1]['scanId'], scans[0]['scanId']);

      // The next physical scan of that label is the next piece: a NEW id,
      // or the server would answer it as the first and a piece goes
      // uncounted.
      online = true;
      await _type(tester, 'CL-K7M4P2');
      scans = caller.of('scan');
      expect(scans, hasLength(3));
      expect(scans[2]['scanId'], isNot(scans[0]['scanId']));
      expect(find.text('Loaded'), findsOneWidget);
    },
  );

  testWidgets('Retry on the failed row resends that scan under its id', (
    tester,
  ) async {
    var online = false;
    final caller = _FakeCaller({
      'scan': (p) =>
          online ? _scanAnswer('loaded') : _refusal('unavailable', {}),
    });
    await _open(tester, caller);
    await _type(tester, 'CL-K7M4P2');
    final failedId = caller.of('scan').first['scanId'];
    final retry = find.byWidgetPredicate(
      (w) =>
          w.key is ValueKey<String> &&
          (w.key! as ValueKey<String>).value.startsWith('load-retry-'),
    );
    expect(retry, findsOneWidget);

    online = true;
    await tester.tap(retry);
    await tester.pumpAndSettle();
    final scans = caller.of('scan');
    expect(scans, hasLength(3));
    expect(scans[2]['scanId'], failedId);
    // The same row now says what happened; no second row.
    expect(find.text('Loaded'), findsOneWidget);
    expect(find.text('No connection - scan again'), findsNothing);
    expect(retry, findsNothing);
  });

  testWidgets('a lost answer retried at once counts once', (tester) async {
    var calls = 0;
    final caller = _FakeCaller({
      'scan': (p) => ++calls == 1
          ? _refusal('deadline-exceeded', {})
          : _scanAnswer('loaded'),
    });
    final feedback = await _open(tester, caller);
    await _type(tester, 'CL-K7M4P2');
    final scans = caller.of('scan');
    expect(scans, hasLength(2));
    expect(scans[1]['scanId'], scans[0]['scanId']);
    expect(find.text('Loaded'), findsOneWidget);
    expect(find.text('No connection - scan again'), findsNothing);
    expect(feedback, [true]);
  });

  testWidgets('on another loading container: asked, then moved here', (
    tester,
  ) async {
    final caller = _FakeCaller({
      'scan': (p) => p['move'] == true
          ? _scanAnswer('loaded')
          : _refusal('failed-precondition', {
              'reason': 'line_in_other_container',
              'otherContainerId': 'c9',
              'otherContainerLabel': 'Box 9',
              'otherStatus': 'loading',
              'canMove': true,
            }),
    });
    await _open(tester, caller);
    await _type(tester, 'CL-K7M4P2');
    expect(
      find.text('This package is on Box 9. Move it here?'),
      findsOneWidget,
    );
    // Nothing of it scanned there yet: no warning.
    expect(find.textContaining('already scanned into'), findsNothing);
    await tester.tap(find.text('Move here'));
    await tester.pumpAndSettle();
    final scans = caller.of('scan');
    expect(scans, hasLength(2));
    expect(scans[1]['move'], true);
    expect(find.text('Moved here'), findsOneWidget);
    // The resend replaced the refused row.
    expect(find.text('This package is on Box 9.'), findsNothing);
  });

  testWidgets('on a container that sailed: an error row, no question', (
    tester,
  ) async {
    final caller = _FakeCaller({
      'scan': (p) => _refusal('failed-precondition', {
        'reason': 'line_in_other_container',
        'otherContainerId': 'c9',
        'otherContainerLabel': 'Box 9',
        'otherStatus': 'shipped',
        'canMove': false,
      }),
    });
    await _open(tester, caller);
    await _type(tester, 'CL-K7M4P2');
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('This package already left on Box 9.'), findsOneWidget);
  });

  testWidgets('Undo takes back the newest scan', (tester) async {
    final caller = _FakeCaller({
      'scan': (p) => _scanAnswer('loaded'),
      'undo_scan': (p) => {
        'success': true,
        'result': 'unloaded',
        'line': {
          'lineId': 'l1',
          'trackingCode': 'CL-K7M4P2',
          'pieceCount': 1,
          'scannedPieces': 0,
        },
        'container': {'containerId': 'c1', 'lineCount': 0, 'pieceCount': 0},
      },
    });
    await _open(tester, caller);
    await _type(tester, 'CL-K7M4P2');
    expect(find.byKey(const Key('load-undo')), findsOneWidget);
    await tester.tap(find.byKey(const Key('load-undo')));
    await tester.pumpAndSettle();
    final undo = caller.of('undo_scan').single;
    expect(undo['lineId'], 'l1');
    // It names the scan it takes back, so a double tap undoes only one.
    expect(undo['scanId'], caller.of('scan').single['scanId']);
    expect(find.text('Undone · back to waiting'), findsOneWidget);
    expect(find.byKey(const Key('load-undo')), findsNothing);
    expect(_totals(tester), '0 packages · 0 pieces scanned');
  });

  testWidgets('the move question warns of pieces scanned into the other box', (
    tester,
  ) async {
    final caller = _FakeCaller({
      'scan': (p) => p['move'] == true
          ? _scanAnswer('loaded')
          : _refusal('failed-precondition', {
              'reason': 'line_in_other_container',
              'otherContainerId': 'c9',
              'otherContainerLabel': 'Box 9',
              'otherStatus': 'loading',
              'canMove': true,
              'otherScannedPieces': 3,
            }),
    });
    await _open(tester, caller);
    await _type(tester, 'CL-K7M4P2');
    expect(
      find.text(
        'This package is on Box 9. Move it here?\n\n'
        '3 of its pieces were already scanned into Box 9.',
      ),
      findsOneWidget,
    );
    // The Move button stays.
    await tester.tap(find.text('Move here'));
    await tester.pumpAndSettle();
    expect(caller.of('scan').last['move'], true);
    expect(find.text('Moved here'), findsOneWidget);
  });

  testWidgets('Undo: moved back, and already undone as a quiet note', (
    tester,
  ) async {
    var undos = 0;
    final caller = _FakeCaller({
      'scan': (p) => _scanAnswer('loaded'),
      'undo_scan': (p) => ++undos == 1
          ? {
              'success': true,
              'result': 'moved_back',
              'line': {
                'lineId': 'l1',
                'trackingCode': 'CL-K7M4P2',
                'pieceCount': 1,
                'scannedPieces': 1,
              },
              'movedBackTo': {'containerId': 'c9', 'label': 'Box 9'},
            }
          : {'success': true, 'result': 'already_undone'},
    });
    final feedback = await _open(tester, caller);
    await _type(tester, 'CL-K7M4P2');
    await tester.tap(find.byKey(const Key('load-undo')));
    await tester.pumpAndSettle();
    expect(find.text('Moved back to Box 9'), findsOneWidget);
    // It is off this container: it no longer counts here.
    expect(_totals(tester), '0 packages · 0 pieces scanned');
    expect(feedback, [true, true]);

    await _type(tester, 'CL-K7M4P2');
    await tester.tap(find.byKey(const Key('load-undo')));
    await tester.pumpAndSettle();
    expect(find.text('Already undone'), findsOneWidget);
    // Nothing changed: no buzz, no error.
    expect(feedback, [true, true, true]);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('the total follows the live lines when the screen has them', (
    tester,
  ) async {
    final live = ValueNotifier<List<ContainerLine>>(const []);
    ContainerLine line(String id, int scanned) => ContainerLine.fromMap(id, {
      'businessId': 'b1',
      'containerId': 'c1',
      'containerStatus': containerStatusLoading,
      'kind': containerLineKindBarrels,
      'quantity': 4,
      'ownerKind': containerOwnerCustomer,
      'loadScannedPieces': scanned,
    });
    await _open(
      tester,
      _FakeCaller({}),
      liveUpdates: live,
      liveLines: () => live.value,
    );
    expect(_totals(tester), '0 packages · 0 pieces scanned');
    // Another phone scans.
    live.value = [line('a', 2), line('b', 3), line('c', 0)];
    await tester.pump();
    expect(_totals(tester), '2 packages · 5 pieces scanned');
  });

  testWidgets('Done loading: leave the rest waiting, see what is left, close', (
    tester,
  ) async {
    final caller = _FakeCaller({
      'load_summary': (p) => {
        'success': true,
        'incomplete': [
          {
            'lineId': 'l1',
            'trackingCode': 'CL-K7M4P2',
            'name': 'Mariama Bah',
            'pieceCount': 5,
            'scannedPieces': 2,
          },
          {
            'lineId': 'l2',
            'trackingCode': 'CL-BCDFGH',
            'name': 'Awa Sow',
            'pieceCount': 3,
            'scannedPieces': 1,
          },
        ],
        'unscanned': [
          {
            'lineId': 'l3',
            'trackingCode': 'CL-JKMNPQ',
            'pieceCount': 1,
            'scannedPieces': 0,
          },
        ],
        'waitingCount': 7,
        'waiting': [
          for (var i = 0; i < 7; i++)
            {
              'lineId': 'w$i',
              'trackingCode': 'CL-WAIT2$i',
              'name': 'Waiting $i',
            },
        ],
      },
      'leave_unscanned': (p) => {
        'success': true,
        'line': {'lineId': 'l1', 'pieceCount': 2, 'scannedPieces': 2},
        'part': {
          'lineId': 'p1',
          'trackingCode': 'CL-K7M4P2-2',
          'pieceCount': 3,
        },
        'container': {'containerId': 'c1', 'lineCount': 12, 'pieceCount': 30},
      },
    });
    await _open(tester, caller);
    await tester.tap(find.byKey(const Key('load-done')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('load-summary')), findsOneWidget);
    expect(find.text('2 of 5 pieces scanned'), findsOneWidget);
    expect(find.text('Leave 3 waiting'), findsOneWidget);
    expect(
      find.text('1 package on the container was never scanned'),
      findsOneWidget,
    );
    expect(
      find.text('7 waiting packages for Guinea were not scanned'),
      findsOneWidget,
    );
    expect(find.text('CL-WAIT20 · Waiting 0'), findsOneWidget);
    expect(find.text('and 2 more'), findsOneWidget);

    // Load all keeps it whole: no call.
    await tester.tap(find.byKey(const ValueKey('load-all-l2')));
    await tester.pumpAndSettle();
    expect(find.text('All of it goes'), findsOneWidget);
    expect(caller.of('leave_unscanned'), isEmpty);

    await tester.tap(find.byKey(const ValueKey('load-leave-l1')));
    await tester.pumpAndSettle();
    expect(caller.of('leave_unscanned').single['lineId'], 'l1');
    expect(find.text('3 left waiting as CL-K7M4P2-2'), findsOneWidget);
    // The screen's container line follows the leave answer.
    expect(
      find.text('On the container: 12 packages · 30 pieces'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('load-print-l1')), findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('load-summary-close')));
    await tester.tap(find.byKey(const Key('load-summary-close')));
    await tester.pumpAndSettle();
    // Close leaves the scanner for the container page.
    expect(find.byType(ContainerLoadingScreen), findsNothing);
    expect(find.text('container page'), findsOneWidget);
  });

  testWidgets('Done loading with nothing left says so; Keep scanning stays', (
    tester,
  ) async {
    final caller = _FakeCaller({
      'load_summary': (p) => {
        'success': true,
        'incomplete': [],
        'unscanned': [],
        'waitingCount': 0,
        'waiting': [],
      },
    });
    await _open(tester, caller);
    await tester.tap(find.byKey(const Key('load-done')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('load-summary-clear')), findsOneWidget);
    await tester.tap(find.byKey(const Key('load-summary-keep')));
    await tester.pumpAndSettle();
    expect(find.byType(ContainerLoadingScreen), findsOneWidget);
    expect(find.byKey(const Key('load-summary')), findsNothing);
  });

  testWidgets('French fits a 375-wide phone, scans and summary included', (
    tester,
  ) async {
    var n = 0;
    final caller = _FakeCaller({
      'scan': (p) {
        n++;
        return switch (n) {
          1 => _scanAnswer('loaded', pieces: 12, scanned: 1),
          2 => _scanAnswer('all_scanned', pieces: 12, scanned: 12),
          3 => _refusal('failed-precondition', {
            'reason': 'container_destination_required',
          }),
          _ => _refusal('failed-precondition', {
            'reason': 'line_in_other_container',
            'otherContainerLabel': 'Départ du 3 octobre, conteneur 2',
            'otherStatus': 'arrived',
            'canMove': false,
          }),
        };
      },
      'load_summary': (p) => {
        'success': true,
        'incomplete': [
          {
            'lineId': 'l1',
            'trackingCode': 'CL-K7M4P2-12',
            'name': 'Mariama Bah Diallo Souaré',
            'pieceCount': 12,
            'scannedPieces': 1,
          },
        ],
        'unscanned': [
          {'lineId': 'l3', 'pieceCount': 1},
          {'lineId': 'l4', 'pieceCount': 1},
        ],
        'waitingCount': 120,
        'waiting': [
          {'lineId': 'w1', 'trackingCode': 'CL-WAIT22', 'name': 'Quelqu’un'},
        ],
      },
    });
    await _open(tester, caller, locale: const Locale('fr'));
    expect(find.text('Vers Guinea'), findsOneWidget);
    expect(_totals(tester), '0 colis · 0 pièce scannée');
    for (var i = 0; i < 4; i++) {
      await _type(tester, 'CL-K7M4P2');
    }
    expect(find.text('Chargé · 1 sur 12'), findsOneWidget);
    expect(find.text('Les 12 sont déjà chargés'), findsOneWidget);
    expect(
      find.text('Indiquez d’abord la destination de ce conteneur.'),
      findsOneWidget,
    );
    expect(
      find.text(
        'Ce colis est déjà parti sur Départ du 3 octobre, conteneur 2.',
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const Key('load-done')));
    await tester.pumpAndSettle();
    expect(find.text('Chargement terminé'), findsOneWidget);
    expect(find.text('En laisser 11 en attente'), findsOneWidget);
    expect(find.text('Tout charger'), findsOneWidget);
    expect(
      find.text('2 colis du conteneur n’ont jamais été scannés'),
      findsOneWidget,
    );
    expect(
      find.text('120 colis en attente pour Guinea n’ont pas été scannés'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}

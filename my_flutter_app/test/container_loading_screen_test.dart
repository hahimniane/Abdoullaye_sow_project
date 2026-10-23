import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/container_loading_screen.dart';
import 'package:my_flutter_app/services/container_loading.dart' show isLoadScanId;
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
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
  _FakeCaller(this.answers, {this.unassign});

  final Map<String, _Answer> answers;

  /// Answers `unassignContainerLine` (Take off); null refuses the test.
  final _Answer? unassign;
  final List<Map<String, Object?>> calls = [];
  final List<Map<String, Object?>> unassigned = [];

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    if (name == 'unassignContainerLine') {
      unassigned.add(payload);
      final answer = unassign!(payload);
      if (answer is Exception) throw answer;
      return answer;
    }
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
  List<LotStaff> staff = const [],
  List<bool>? feedbackInto,
}) async {
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final feedback = feedbackInto ?? <bool>[];
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
            staff: staff,
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

  // -------------------------------------------------------------------------
  // Loading lists.
  // -------------------------------------------------------------------------

  final oct23 = DateTime(2026, 10, 23, 15, 5);

  ContainerLine listLine(
    String id, {
    String code = '',
    String customer = '',
    String phone = '',
    String receiver = '',
    int pieces = 1,
    int? scanned,
    DateTime? at,
    String by = '',
    String via = '',
    bool waiting = false,
    String status = containerStatusLoading,
    String destination = 'guinea',
  }) => ContainerLine.fromMap(id, {
    'businessId': 'b1',
    'containerId': waiting ? '' : 'c1',
    'containerStatus': waiting ? containerLineStatusWaiting : status,
    'kind': containerLineKindBarrels,
    'quantity': pieces,
    'ownerKind': containerOwnerCustomer,
    'trackingCode': code,
    'customerName': customer,
    'customerPhone': phone,
    'receiverName': receiver,
    'destinationCountryId': destination,
    'loadScannedPieces': ?scanned,
    if (at != null) 'containerAssignedAt': at.millisecondsSinceEpoch,
    if (by.isNotEmpty) 'containerAssignedByStaffId': by,
    if (via.isNotEmpty) 'containerAssignedVia': via,
  });

  /// Two phones' worth of lines: three on the box, four waiting (three for
  /// Guinea, one for Mali).
  List<ContainerLine> feedLines() => [
    listLine(
      'on1',
      code: 'CL-ON1',
      customer: 'OUMOU BARRY',
      pieces: 3,
      scanned: 2,
      at: oct23,
      by: 'u1',
      via: 'scan',
    ),
    listLine(
      'on2',
      code: 'CL-ON2',
      customer: 'OUMOU BARRY',
      pieces: 3,
      scanned: 3,
      at: oct23.subtract(const Duration(hours: 3)),
      by: 'u2',
      via: 'hand',
    ),
    listLine('on3', code: 'CL-ON3', customer: 'Aliou Diallo', pieces: 2),
    listLine('w1', code: 'CL-W1', customer: 'Fanta Keita', waiting: true),
    listLine('w2', code: 'CL-W2', customer: 'Fanta Keita', waiting: true),
    listLine('w3', code: 'CL-W3', customer: 'Zeinab Sow', waiting: true),
    listLine(
      'w4',
      code: 'CL-W4',
      customer: 'Kadiatou',
      waiting: true,
      destination: 'mali',
    ),
  ];

  const staff = [
    LotStaff(id: 'u1', name: 'Awa Camara'),
    LotStaff(id: 'u2', name: 'Moussa Bah'),
  ];

  Future<ValueNotifier<List<ContainerLine>>> openLists(
    WidgetTester tester,
    _FakeCaller caller, {
    Locale locale = const Locale('en'),
    List<ContainerLine>? lines,
    List<bool>? feedback,
  }) async {
    final live = ValueNotifier<List<ContainerLine>>(lines ?? feedLines());
    await _open(
      tester,
      caller,
      locale: locale,
      liveUpdates: live,
      liveLines: () => live.value,
      staff: staff,
      feedbackInto: feedback,
    );
    return live;
  }

  Future<void> tab(WidgetTester tester, String name) async {
    await tester.tap(find.byKey(ValueKey('load-tab-$name')));
    await tester.pumpAndSettle();
  }

  /// Top-to-bottom order of [keys] on screen.
  List<String> order(WidgetTester tester, List<String> keys) {
    final at = <String, double>{
      for (final k in keys)
        if (find.byKey(ValueKey(k)).evaluate().isNotEmpty)
          k: tester.getTopLeft(find.byKey(ValueKey(k))).dy,
    };
    return at.keys.toList()..sort((a, b) => at[a]!.compareTo(at[b]!));
  }

  testWidgets('the header counts what still waits for the destination', (
    tester,
  ) async {
    await openLists(tester, _FakeCaller({}));
    expect(find.text('3 still waiting for Guinea'), findsOneWidget);
    expect(find.text('Recent scans'), findsOneWidget);
    expect(find.text('On this container (3)'), findsOneWidget);
    expect(find.text('Still to load (3)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the header follows the feed when a package goes on', (
    tester,
  ) async {
    final live = await openLists(tester, _FakeCaller({}));
    live.value = [
      for (final l in feedLines())
        if (l.id != 'w1') l,
    ];
    await tester.pump();
    expect(find.text('2 still waiting for Guinea'), findsOneWidget);
    expect(find.text('Still to load (2)'), findsOneWidget);
  });

  testWidgets('a counted scan of a package already there is a neutral row', (
    tester,
  ) async {
    final caller = _FakeCaller({
      'scan': (p) => {
        'success': true,
        'result': 'counted',
        'line': {
          'lineId': 'on3',
          'trackingCode': 'CL-K7M4P2',
          'name': 'Aliou Diallo',
          'pieceCount': 5,
          'scannedPieces': 1,
          'addedByScan': false,
          'assignedVia': 'hand',
          'customerName': 'Aliou Diallo',
        },
      },
    });
    await _open(tester, caller);
    await _type(tester, 'CL-K7M4P2');
    expect(
      find.text('Already on this container · 1 of 5 scanned'),
      findsOneWidget,
    );
    expect(find.text('Loaded'), findsNothing);
    expect(find.text('1 of 5'), findsNothing);
  });

  testWidgets('Still to load groups by customer; a tap sends a scan', (
    tester,
  ) async {
    final feedback = <bool>[];
    final caller = _FakeCaller({
      'scan': (p) => _scanAnswer('loaded', lineId: 'w1', code: 'CL-W1'),
    });
    await openLists(tester, caller, feedback: feedback);
    await tab(tester, 'stillToLoad');
    // Only the Guinea ones, under their customers.
    expect(find.text('Fanta Keita · 2 packages waiting'), findsOneWidget);
    expect(find.text('Zeinab Sow · 1 package waiting'), findsOneWidget);
    expect(find.text('CL-W4'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('load-still-w1')));
    await tester.pumpAndSettle();
    final scan = caller.of('scan').single;
    expect(scan['businessId'], 'b1');
    expect(scan['containerId'], 'c1');
    expect(scan['code'], 'CL-W1');
    expect(scan['scanId'], isA<String>());
    expect(isLoadScanId(scan['scanId'] as String), isTrue);
    expect(scan.containsKey('move'), isFalse);
    // The tile says how it went, and the same buzz as a scan.
    expect(find.byKey(const ValueKey('load-still-result-w1')), findsOneWidget);
    expect(find.text('Loaded'), findsWidgets);
    expect(feedback, [true]);
    // It is in Recent scans too.
    await tab(tester, 'recent');
    expect(find.text('CL-W1 · Mariama Bah'), findsOneWidget);

    // A tapped package cannot be tapped again while the feed catches up.
    await tab(tester, 'stillToLoad');
    await tester.tap(find.byKey(const ValueKey('load-still-w1')));
    await tester.pumpAndSettle();
    expect(caller.of('scan').length, 1);
  });

  testWidgets(
    'a refused tap in Still to load says why, and can be tried again',
    (tester) async {
      var n = 0;
      final caller = _FakeCaller({
        'scan': (p) {
          n++;
          return n == 1
              ? _refusal('failed-precondition', {'reason': 'container_locked'})
              : _scanAnswer('loaded', lineId: 'w3', code: 'CL-W3');
        },
      });
      final feedback = <bool>[];
      await openLists(tester, caller, feedback: feedback);
      await tab(tester, 'stillToLoad');
      await tester.tap(find.byKey(const ValueKey('load-still-w3')));
      await tester.pumpAndSettle();
      expect(find.text('This container is no longer loading.'), findsOneWidget);
      expect(feedback, [false]);
      await tester.tap(find.byKey(const ValueKey('load-still-w3')));
      await tester.pumpAndSettle();
      expect(caller.of('scan').length, 2);
      // A new request each time.
      expect(
        caller.of('scan')[1]['scanId'],
        isNot(caller.of('scan')[0]['scanId']),
      );
    },
  );

  testWidgets(
    'Still to load: search narrows it, and says when nothing is left',
    (tester) async {
      await openLists(tester, _FakeCaller({}));
      await tab(tester, 'stillToLoad');
      await tester.enterText(
        find.byKey(const Key('load-list-search')),
        'zeinab',
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('load-still-w3')), findsOneWidget);
      expect(find.byKey(const ValueKey('load-still-w1')), findsNothing);
      await tester.enterText(
        find.byKey(const Key('load-list-search')),
        'nobody',
      );
      await tester.pumpAndSettle();
      expect(find.text('No package matches.'), findsOneWidget);
    },
  );

  testWidgets('Still to load with nothing waiting says so', (tester) async {
    await openLists(
      tester,
      _FakeCaller({}),
      lines: [listLine('on3', code: 'CL-ON3', customer: 'Aliou Diallo')],
    );
    expect(find.text('0 still waiting for Guinea'), findsOneWidget);
    await tab(tester, 'stillToLoad');
    expect(find.text('No package is waiting for Guinea.'), findsOneWidget);
  });

  testWidgets('On this container: recently added, with who and how', (
    tester,
  ) async {
    await openLists(tester, _FakeCaller({}));
    await tab(tester, 'onContainer');
    // Newest first; the one with no time last.
    expect(order(tester, ['load-on-on1', 'load-on-on2', 'load-on-on3']), [
      'load-on-on1',
      'load-on-on2',
      'load-on-on3',
    ]);
    final first = tester
        .widget<Text>(find.byKey(const ValueKey('load-on-added-on1')))
        .data!;
    expect(first, startsWith('Added by Awa Camara · By scan · Oct 23'));
    final second = tester
        .widget<Text>(find.byKey(const ValueKey('load-on-added-on2')))
        .data!;
    expect(second, startsWith('Added by Moussa Bah · By hand · Oct 23'));
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('load-on-added-on3'))).data,
      'Added earlier',
    );
    expect(find.text('2 of 3 pieces scanned'), findsOneWidget);
    expect(find.text('2 pieces · Not scanned yet'), findsOneWidget);
  });

  testWidgets('On this container: by customer, and not scanned yet', (
    tester,
  ) async {
    await openLists(tester, _FakeCaller({}));
    await tab(tester, 'onContainer');
    await tester.tap(find.byKey(const ValueKey('load-filter-byCustomer')));
    await tester.pumpAndSettle();
    expect(
      find.text('OUMOU BARRY · 2 packages · 5 of 6 pieces scanned'),
      findsOneWidget,
    );
    expect(
      find.text('Aliou Diallo · 1 package · 0 of 2 pieces scanned'),
      findsOneWidget,
    );
    // The customer is not repeated on each package under the header.
    expect(find.text('CL-ON1'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('load-filter-notScanned')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('load-on-on3')), findsOneWidget);
    expect(find.byKey(const ValueKey('load-on-on1')), findsNothing);
    expect(find.byKey(const ValueKey('load-on-on2')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('load-filter-recent')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('load-on-on1')), findsOneWidget);
  });

  testWidgets('On this container: search by code, name or phone', (
    tester,
  ) async {
    await openLists(
      tester,
      _FakeCaller({}),
      lines: [
        listLine(
          'a',
          code: 'CL-AAA111',
          customer: 'Mariama',
          phone: '+224 600 11 22 33',
        ),
        listLine('b', code: 'CL-BBB222', customer: 'Aliou'),
      ],
    );
    await tab(tester, 'onContainer');
    Future<void> search(String q) async {
      await tester.enterText(find.byKey(const Key('load-list-search')), q);
      await tester.pumpAndSettle();
    }

    await search('bbb2');
    expect(find.byKey(const ValueKey('load-on-b')), findsOneWidget);
    expect(find.byKey(const ValueKey('load-on-a')), findsNothing);
    await search('mariama');
    expect(find.byKey(const ValueKey('load-on-a')), findsOneWidget);
    expect(find.byKey(const ValueKey('load-on-b')), findsNothing);
    await search('600 11');
    expect(find.byKey(const ValueKey('load-on-a')), findsOneWidget);
    await search('zzz');
    expect(find.text('No package matches.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('load-list-search-clear')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('load-on-b')), findsOneWidget);
  });

  testWidgets('Take off asks first, then sends the package back to waiting', (
    tester,
  ) async {
    final feedback = <bool>[];
    final caller = _FakeCaller(
      {},
      unassign: (p) => {'success': true, 'lineId': p['lineId']},
    );
    await openLists(tester, caller, feedback: feedback);
    await tab(tester, 'onContainer');
    await tester.tap(find.byKey(const ValueKey('load-takeoff-on1')));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Take CL-ON1 off Sailing 3 Oct, box 2? It goes back to waiting.',
      ),
      findsOneWidget,
    );
    // Cancel: nothing is sent.
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(caller.unassigned, isEmpty);

    await tester.tap(find.byKey(const ValueKey('load-takeoff-on1')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Take off'));
    await tester.pumpAndSettle();
    expect(caller.unassigned, [
      {'businessId': 'b1', 'lineId': 'on1'},
    ]);
    expect(find.text('Package sent back to waiting.'), findsOneWidget);
    expect(feedback, [true]);
  });

  testWidgets('a refused Take off shows the refusal in plain words', (
    tester,
  ) async {
    final feedback = <bool>[];
    final caller = _FakeCaller(
      {},
      unassign: (p) =>
          _refusal('failed-precondition', {'reason': 'container_locked'}),
    );
    await openLists(tester, caller, feedback: feedback);
    await tab(tester, 'onContainer');
    await tester.tap(find.byKey(const ValueKey('load-takeoff-on2')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Take off'));
    await tester.pumpAndSettle();
    expect(caller.unassigned.length, 1);
    expect(find.textContaining('This container has shipped'), findsOneWidget);
    expect(feedback, [false]);
    // The button is back for another try.
    expect(
      tester
          .widget<TextButton>(find.byKey(const ValueKey('load-takeoff-on2')))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('Take off is not offered once the container is not loading', (
    tester,
  ) async {
    await openLists(
      tester,
      _FakeCaller({}),
      lines: [
        listLine(
          's1',
          code: 'CL-S1',
          customer: 'Aliou',
          status: containerStatusShipped,
        ),
        listLine('l1', code: 'CL-L1', customer: 'Aliou'),
      ],
    );
    await tab(tester, 'onContainer');
    expect(find.byKey(const ValueKey('load-takeoff-l1')), findsOneWidget);
    expect(find.byKey(const ValueKey('load-takeoff-s1')), findsNothing);
  });

  testWidgets('a package taken off in the feed leaves On this container', (
    tester,
  ) async {
    final live = await openLists(tester, _FakeCaller({}));
    await tab(tester, 'onContainer');
    expect(find.byKey(const ValueKey('load-on-on3')), findsOneWidget);
    live.value = [
      for (final l in feedLines())
        if (l.id != 'on3') l,
    ];
    await tester.pump();
    expect(find.byKey(const ValueKey('load-on-on3')), findsNothing);
    expect(find.text('On this container (2)'), findsOneWidget);
  });

  testWidgets('French fits a 375-wide phone, lists included', (tester) async {
    final caller = _FakeCaller({
      'scan': (p) => _scanAnswer('loaded', lineId: 'w1', code: 'CL-W1'),
    }, unassign: (p) => {'success': true});
    await openLists(tester, caller, locale: const Locale('fr'));
    expect(find.text('3 encore en attente pour Guinea'), findsOneWidget);
    expect(find.text('Sur ce conteneur (3)'), findsOneWidget);
    expect(find.text('À charger (3)'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tab(tester, 'onContainer');
    expect(find.text('Ajoutés récemment'), findsOneWidget);
    expect(find.text('Par client'), findsOneWidget);
    expect(find.text('Pas encore scannés'), findsOneWidget);
    expect(find.text('Retirer'), findsWidgets);
    expect(
      find.textContaining('Ajouté par Awa Camara · Par scan'),
      findsOneWidget,
    );
    expect(find.text('Ajouté plus tôt'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const ValueKey('load-filter-byCustomer')));
    await tester.pumpAndSettle();
    expect(
      find.text('OUMOU BARRY · 2 colis · 5 pièces scannées sur 6'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const ValueKey('load-takeoff-on1')));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Retirer CL-ON1 de Sailing 3 Oct, box 2 ? Le colis repasse en attente.',
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Annuler'));
    await tester.pumpAndSettle();

    await tab(tester, 'stillToLoad');
    expect(find.text('Fanta Keita · 2 colis en attente'), findsOneWidget);
    expect(find.text('Charger'), findsWidgets);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byKey(const ValueKey('load-still-w1')));
    await tester.pumpAndSettle();
    expect(find.text('Chargé'), findsWidgets);
    expect(tester.takeException(), isNull);

    // A package of a long name does not push the layout out either.
    await tester.enterText(find.byKey(const Key('load-list-search')), 'x');
    await tester.pumpAndSettle();
    expect(find.text('Aucun colis ne correspond.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the lists keep the scanner and the Done bar on screen', (
    tester,
  ) async {
    await openLists(tester, _FakeCaller({}));
    await tab(tester, 'onContainer');
    expect(find.byKey(const Key('load-type-code')), findsOneWidget);
    expect(find.byKey(const Key('load-done')), findsOneWidget);
    final size = tester.view.physicalSize / tester.view.devicePixelRatio;
    final done = tester.getBottomLeft(find.byKey(const Key('load-done'))).dy;
    expect(done, lessThanOrEqualTo(size.height));
    // The list area is a real, scrollable area of its own.
    final list = tester.getSize(find.byKey(const Key('load-on-list')));
    expect(list.height, greaterThan(40));
  });
}

import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/container_loading_screen.dart';
import 'package:my_flutter_app/services/container_loading.dart';
import 'package:my_flutter_app/services/container_manifest.dart';

/// Scan to load (docs/WAITING_PACKAGES.md "Scan to load"): the pure rules
/// behind the loading screen - the requests, the answers and refusals read
/// into models, the words each refusal gets, the 2 s duplicate guard, the
/// scan ids kept for a retry, the running totals, and the summary rows.
void main() {
  final en = lookupAppLocalizations(const Locale('en'));
  final fr = lookupAppLocalizations(const Locale('fr'));

  group('requests', () {
    test('a scan names the container, the code and its own scan id', () {
      expect(
        loadScanRequest(
          businessId: 'b1',
          containerId: 'c1',
          code: 'CL-K7M4P2',
          scanId: 'scan_abcdefgh',
        ),
        {
          'businessId': 'b1',
          'containerId': 'c1',
          'action': 'scan',
          'code': 'CL-K7M4P2',
          'scanId': 'scan_abcdefgh',
        },
      );
      expect(
        loadScanRequest(
          businessId: 'b1',
          containerId: 'c1',
          code: 'CL-K7M4P2',
          scanId: 'scan_abcdefgh',
          move: true,
        )['move'],
        true,
      );
    });

    test('undo, summary and leave carry their action', () {
      expect(
        loadUndoRequest(businessId: 'b1', containerId: 'c1', lineId: 'l1'),
        {
          'businessId': 'b1',
          'containerId': 'c1',
          'action': 'undo_scan',
          'lineId': 'l1',
        },
      );
      // Undo names the scan it takes back.
      expect(
        loadUndoRequest(
          businessId: 'b1',
          containerId: 'c1',
          lineId: 'l1',
          scanId: 'scan_abcdefgh',
        )['scanId'],
        'scan_abcdefgh',
      );
      expect(loadSummaryRequest(businessId: 'b1', containerId: 'c1'), {
        'businessId': 'b1',
        'containerId': 'c1',
        'action': 'load_summary',
      });
      expect(
        loadLeaveRequest(businessId: 'b1', containerId: 'c1', lineId: 'l1'),
        {
          'businessId': 'b1',
          'containerId': 'c1',
          'action': 'leave_unscanned',
          'lineId': 'l1',
        },
      );
      expect(loadCallable, 'assignContainerLines');
    });

    test('scan ids are fresh and what the server accepts', () {
      final ids = {for (var i = 0; i < 200; i++) newLoadScanId()};
      expect(ids.length, 200);
      for (final id in ids) {
        expect(isLoadScanId(id), isTrue, reason: id);
      }
      expect(isLoadScanId('short'), isFalse);
      expect(isLoadScanId('has space in it'), isFalse);
      expect(isLoadScanId('a' * 65), isFalse);
      expect(isLoadScanId('a' * 64), isTrue);
    });
  });

  group('answers', () {
    test('a scan answer reads the line and the container (iOS maps)', () {
      final answer = LoadAnswer.fromCallable(<Object?, Object?>{
        'success': true,
        'result': 'counted',
        'line': <Object?, Object?>{
          'lineId': 'l1',
          'trackingCode': 'cl-k7m4p2',
          'name': 'Mariama Bah',
          'kind': 'barrels',
          'pieceCount': 5,
          'scannedPieces': 2,
          'destinationCountryName': 'Guinea',
        },
        'container': <Object?, Object?>{
          'containerId': 'c1',
          'label': 'Box 2',
          'lineCount': 37,
          'pieceCount': 52,
        },
      });
      expect(answer.result, loadResultCounted);
      expect(answer.line.lineId, 'l1');
      expect(answer.line.trackingCode, 'CL-K7M4P2');
      expect(answer.line.name, 'Mariama Bah');
      expect(answer.line.pieceCount, 5);
      expect(answer.line.scannedPieces, 2);
      expect(answer.line.unscannedPieces, 3);
      expect(answer.container?.lineCount, 37);
      expect(answer.container?.pieceCount, 52);
    });

    test(
      'a summary reads every list, and the count is never below the list',
      () {
        final summary = LoadSummary.fromCallable({
          'success': true,
          'incomplete': [
            {'lineId': 'a', 'pieceCount': 5, 'scannedPieces': 2},
          ],
          'unscanned': [
            {'lineId': 'b', 'pieceCount': 1, 'scannedPieces': 0},
            {'lineId': 'c', 'pieceCount': 3, 'scannedPieces': 0},
          ],
          'waitingCount': 0,
          'waiting': [
            {'lineId': 'w1', 'trackingCode': 'CL-BCDFGH'},
          ],
        });
        expect(summary.incomplete.single.lineId, 'a');
        expect(summary.unscanned, hasLength(2));
        expect(summary.waitingCount, 1);
      },
    );

    test('leaving pieces answers the waiting part', () {
      final left = LoadLeaveAnswer.fromCallable({
        'success': true,
        'line': {'lineId': 'l1', 'pieceCount': 2, 'scannedPieces': 2},
        'part': {
          'lineId': 'p1',
          'trackingCode': 'CL-K7M4P2-2',
          'pieceCount': 3,
        },
      });
      expect(left.part.lineId, 'p1');
      expect(left.part.trackingCode, 'CL-K7M4P2-2');
      expect(left.part.pieceCount, 3);
      expect(left.container, isNull);
      expect(left.alreadyDone, isFalse);
      expect(
        LoadLeaveAnswer.fromCallable({'alreadyDone': true}).alreadyDone,
        isTrue,
      );
      final withBox = LoadLeaveAnswer.fromCallable({
        'line': {'lineId': 'l1'},
        'part': {'lineId': 'p1'},
        'container': {'containerId': 'c1', 'lineCount': 40, 'pieceCount': 58},
      });
      expect(
        loadContainerTotalsOf(withBox.container),
        const LoadTotals(packages: 40, pieces: 58),
      );
    });
  });

  group('refusals', () {
    test('details are read, and the move is offered only when allowed', () {
      final f = parseLoadFailure('failed-precondition', <Object?, Object?>{
        'reason': 'line_in_other_container',
        'otherContainerId': 'c9',
        'otherContainerLabel': 'Box 9',
        'otherStatus': 'loading',
        'canMove': true,
      });
      expect(f.reason, LoadReason.lineInOtherContainer);
      expect(f.otherContainerLabel, 'Box 9');
      expect(f.offersMove, isTrue);
      expect(f.otherScannedPieces, 0);
      expect(
        parseLoadFailure('failed-precondition', {
          'reason': 'line_in_other_container',
          'otherScannedPieces': 3,
        }).otherScannedPieces,
        3,
      );
      final shipped = parseLoadFailure('failed-precondition', {
        'reason': 'line_in_other_container',
        'otherContainerLabel': 'Box 9',
        'otherStatus': 'shipped',
        'canMove': false,
      });
      expect(shipped.offersMove, isFalse);
      expect(loadRefusalMessage(shipped), LoadMessage.inShippedContainer);
      expect(loadRefusalMessage(f), LoadMessage.inOtherContainer);
      expect(loadMessageText(en, f), 'This package is on Box 9.');
      // No label to name: still plain words.
      expect(
        loadMessageText(
          en,
          const LoadFailure(code: 'x', reason: 'line_in_other_container'),
        ),
        'This package is on another container.',
      );
    });

    test(
      'every reason in the contract has its own words, in both languages',
      () {
        for (final reason in LoadReason.all) {
          final failure = LoadFailure(
            code: 'failed-precondition',
            reason: reason,
          );
          expect(
            loadRefusalMessage(failure),
            isNot(LoadMessage.generic),
            reason: reason,
          );
          for (final l10n in [en, fr]) {
            final text = loadMessageText(l10n, failure);
            expect(text, isNotEmpty, reason: reason);
            expect(text, isNot(l10n.ldgErrGeneric), reason: reason);
          }
        }
        // Each reason gets a different message.
        final messages = {
          for (final reason in LoadReason.all)
            loadRefusalMessage(LoadFailure(code: 'x', reason: reason)),
        };
        expect(messages.length, LoadReason.all.length);
      },
    );

    test('no connection, no access, and anything else', () {
      expect(
        loadRefusalMessage(const LoadFailure(code: 'unavailable')),
        LoadMessage.offline,
      );
      expect(
        loadRefusalMessage(const LoadFailure(code: 'deadline-exceeded')),
        LoadMessage.offline,
      );
      expect(
        loadRefusalMessage(const LoadFailure(code: 'permission-denied')),
        LoadMessage.notAllowed,
      );
      expect(
        loadRefusalMessage(const LoadFailure(code: 'internal')),
        LoadMessage.generic,
      );
      expect(
        loadFailureOf(Exception('SocketException: failed')).offline,
        isTrue,
      );
      expect(
        loadFailureOf(Exception('TimeoutException after 0:00:20')).offline,
        isTrue,
      );
      expect(loadFailureOf(StateError('bad')).offline, isFalse);
      expect(
        loadMessageText(en, const LoadFailure(code: 'unavailable')),
        'No connection - scan again',
      );
      // Undo and Leave name a line: not found there means it left the box.
      expect(
        loadLineActionErrorText(
          en,
          const LoadFailure(code: 'not-found', reason: 'line_not_found'),
          fallback: 'fallback',
        ),
        'This package is no longer on this container.',
      );
      expect(
        loadLineActionErrorText(
          fr,
          const LoadFailure(
            code: 'failed-precondition',
            reason: 'container_locked',
          ),
          fallback: 'fallback',
        ),
        'Ce conteneur n’est plus en chargement.',
      );
      expect(
        loadLineActionErrorText(
          en,
          const LoadFailure(code: 'internal'),
          fallback: 'fallback',
        ),
        'fallback',
      );
      expect(
        loadLineActionErrorText(
          en,
          const LoadFailure(code: 'unavailable'),
          fallback: 'fallback',
        ),
        en.dlvErrOffline,
      );
    });
  });

  group('the duplicate guard', () {
    test('the same code is ignored for 2 s, then counts again', () {
      final guard = LoadDuplicateGuard();
      final t0 = DateTime(2026, 10, 22, 9);
      expect(guard.accept('CL-K7M4P2', t0), isTrue);
      expect(
        guard.accept('CL-K7M4P2', t0.add(const Duration(milliseconds: 300))),
        isFalse,
      );
      expect(
        guard.accept('CL-K7M4P2', t0.add(const Duration(milliseconds: 1999))),
        isFalse,
      );
      // Another label is not held up.
      expect(
        guard.accept('CL-BCDFGH', t0.add(const Duration(milliseconds: 400))),
        isTrue,
      );
      // The window runs from the send, not from the last sighting.
      expect(
        guard.accept('CL-K7M4P2', t0.add(const Duration(seconds: 2))),
        isTrue,
      );
    });

    test('forget lets the code through at once', () {
      final guard = LoadDuplicateGuard();
      final t0 = DateTime(2026, 10, 22, 9);
      guard.accept('CL-K7M4P2', t0);
      guard.forget('CL-K7M4P2');
      expect(
        guard.accept('CL-K7M4P2', t0.add(const Duration(milliseconds: 10))),
        isTrue,
      );
    });
  });

  group('scan ids for retries', () {
    test('only an unanswered send is retried at once, and only once', () {
      const offline = LoadFailure(code: 'unavailable');
      expect(loadShouldAutoRetry(offline, 0), isTrue);
      expect(loadShouldAutoRetry(offline, 1), isFalse);
      // A refusal is an answer: never retried.
      expect(
        loadShouldAutoRetry(
          const LoadFailure(code: 'not-found', reason: 'line_not_found'),
          0,
        ),
        isFalse,
      );
    });

    test('Retry is offered on a row that got no answer, with its id', () {
      const row = LoadRow(
        key: 1,
        code: 'CL-K7M4P2',
        scanId: 'scan_abcdefgh',
        moved: true,
        state: LoadRowState.sending,
      );
      final failed = row.refused(const LoadFailure(code: 'unavailable'));
      expect(loadCanRetry(failed), isTrue);
      expect(failed.scanId, 'scan_abcdefgh');
      // A retried move is still a move.
      expect(failed.moved, isTrue);
      expect(
        loadCanRetry(
          row.refused(
            const LoadFailure(code: 'not-found', reason: 'line_not_found'),
          ),
        ),
        isFalse,
      );
      expect(loadCanRetry(row), isFalse);
    });

    test('a fresh id for every new scan, even of the same label', () {
      final rng = Random(7);
      final a = newLoadScanId(rng);
      final b = newLoadScanId(rng);
      expect(a, isNot(b));
    });
  });

  group('recent scans', () {
    LoadAnswer answer(String result, {int pieces = 5, int scanned = 1}) =>
        LoadAnswer(
          result: result,
          line: LoadLine(
            lineId: 'l1',
            trackingCode: 'CL-K7M4P2',
            pieceCount: pieces,
            scannedPieces: scanned,
          ),
        );
    const sending = LoadRow(
      key: 1,
      code: 'CL-K7M4P2',
      state: LoadRowState.sending,
    );

    test('each result has its colour and words', () {
      expect(sending.tone, LoadTone.pending);
      final loaded = sending.answered(answer('loaded', pieces: 1));
      expect(loaded.tone, LoadTone.green);
      expect(loadRowText(en, loaded), 'Loaded');
      final loadedOfFive = sending.answered(answer('loaded'));
      expect(loadRowText(en, loadedOfFive), 'Loaded · 1 of 5');
      final counted = sending.answered(answer('counted', scanned: 2));
      expect(counted.tone, LoadTone.blue);
      expect(loadRowText(en, counted), '2 of 5');
      expect(loadRowText(fr, counted), '2 sur 5');
      final last = sending.answered(answer('counted', scanned: 5));
      expect(last.tone, LoadTone.green);
      final allIn = sending.answered(answer('all_scanned', scanned: 5));
      expect(allIn.tone, LoadTone.amber);
      expect(loadRowText(en, allIn), 'All 5 already in');
      final refused = sending.refused(
        const LoadFailure(code: 'not-found', reason: 'line_not_found'),
      );
      expect(refused.tone, LoadTone.red);
      expect(loadRowText(en, refused), 'No package has this code.');
      final moved = sending.answered(answer('loaded', pieces: 1), moved: true);
      expect(loadRowText(en, moved), 'Moved here');
      final undone = loaded.undone(answer('unloaded', pieces: 1, scanned: 0));
      expect(undone.tone, LoadTone.grey);
      expect(loadRowText(en, undone), 'Undone · back to waiting');
      final uncounted = counted.undone(answer('uncounted', scanned: 1));
      expect(loadRowText(en, uncounted), 'Undone · 1 of 5');
      final movedBack = loaded.undone(
        LoadAnswer.fromCallable({
          'result': 'moved_back',
          'line': {'lineId': 'l1', 'pieceCount': 1, 'scannedPieces': 1},
          'movedBackTo': {'containerId': 'c9', 'label': 'Box 9'},
        }),
      );
      expect(loadRowText(en, movedBack), 'Moved back to Box 9');
      expect(loadRowText(fr, movedBack), 'Remis sur Box 9');
      final already = loaded.undone(
        LoadAnswer.fromCallable({'result': 'already_undone'}),
      );
      expect(already.tone, LoadTone.grey);
      expect(loadRowText(en, already), 'Already undone');
      // No line in the answer: the row keeps the one it knew.
      expect(already.line?.lineId, 'l1');
    });

    test('undo is offered on the newest scan only, once it counted', () {
      final older = sending.answered(answer('loaded'));
      final newest = const LoadRow(
        key: 2,
        code: 'CL-BCDFGH',
        state: LoadRowState.sending,
      ).answered(answer('counted', scanned: 2));
      final rows = loadRowsWith(loadRowsWith(const [], older), newest);
      expect(rows.first.key, 2);
      expect(loadCanUndo(rows, newest), isTrue);
      expect(loadCanUndo(rows, older), isFalse);
      final refusedTop = loadRowsWith(
        rows,
        const LoadRow(
          key: 3,
          code: 'CL-X',
          state: LoadRowState.sending,
        ).refused(const LoadFailure(code: 'unavailable')),
      );
      expect(loadCanUndo(refusedTop, refusedTop.first), isFalse);
      final allIn = loadRowsWith(
        const [],
        sending.answered(answer('all_scanned', scanned: 5)),
      );
      expect(loadCanUndo(allIn, allIn.first), isFalse);
    });

    test('a row is replaced in place; the list keeps the newest few', () {
      var rows = <LoadRow>[];
      for (var i = 0; i < loadRecentLimit + 5; i++) {
        rows = loadRowsWith(
          rows,
          LoadRow(key: i, code: 'c$i', state: LoadRowState.sending),
        );
      }
      expect(rows, hasLength(loadRecentLimit));
      expect(rows.first.key, loadRecentLimit + 4);
      final replaced = loadRowsWith(
        rows,
        rows[3].refused(const LoadFailure(code: 'unavailable')),
      );
      expect(replaced, hasLength(loadRecentLimit));
      expect(replaced[3].state, LoadRowState.refused);
      expect(replaced[3].key, rows[3].key);
    });
  });

  group('totals', () {
    ContainerLine line(String id, String containerId, int scanned) =>
        ContainerLine.fromMap(id, {
          'businessId': 'b1',
          'containerId': containerId,
          'containerStatus': 'loading',
          'kind': 'barrels',
          'quantity': 5,
          'ownerKind': 'customer',
          'loadScannedPieces': scanned,
        });

    test('from the live lines: scanned packages of this container only', () {
      final lines = [
        line('a', 'c1', 2),
        line('b', 'c1', 1),
        line('c', 'c1', 0),
        line('d', 'c2', 4),
      ];
      expect(lines.first.loadScannedPieces, 2);
      expect(
        loadTotalsOfLines(lines, 'c1'),
        const LoadTotals(packages: 2, pieces: 3),
      );
    });

    test('from this phone answers when there is no live read', () {
      expect(
        loadTotalsOfAnswers(const [
          LoadLine(lineId: 'a', scannedPieces: 3, pieceCount: 5),
          LoadLine(lineId: 'b', scannedPieces: 0, pieceCount: 1),
          LoadLine(lineId: 'c', scannedPieces: 1, pieceCount: 1),
        ]),
        const LoadTotals(packages: 2, pieces: 4),
      );
    });

    test('the running total in words', () {
      expect(
        loadTotalsText(en, const LoadTotals(packages: 37, pieces: 52)),
        '37 packages · 52 pieces scanned',
      );
      expect(
        loadTotalsText(en, const LoadTotals(packages: 1, pieces: 1)),
        '1 package · 1 piece scanned',
      );
      expect(
        loadTotalsText(fr, const LoadTotals(packages: 37, pieces: 52)),
        '37 colis · 52 pièces scannées',
      );
      // French counts zero as singular.
      expect(
        loadTotalsText(fr, const LoadTotals()),
        '0 colis · 0 pièce scannée',
      );
      expect(
        loadContainerTotalsText(en, const LoadTotals(packages: 40, pieces: 61)),
        'On the container: 40 packages · 61 pieces',
      );
      expect(
        loadContainerTotalsText(fr, const LoadTotals(packages: 40, pieces: 61)),
        'Sur le conteneur : 40 colis · 61 pièces',
      );
    });

    test('what is on the container in all, from the live lines', () {
      final lines = [
        line('a', 'c1', 2),
        line('b', 'c1', 0),
        line('d', 'c2', 4),
      ];
      expect(
        loadContainerTotalsOfLines(lines, 'c1'),
        const LoadTotals(packages: 2, pieces: 10),
      );
      expect(loadContainerTotalsOf(null), isNull);
    });
  });

  group('the Done loading summary', () {
    test('shows only the rows that have something in them', () {
      final view = LoadSummaryView.of(
        LoadSummary.fromCallable({
          'incomplete': [
            {'lineId': 'a', 'pieceCount': 5, 'scannedPieces': 2},
            // Not splittable: nothing or everything scanned.
            {'lineId': 'x', 'pieceCount': 5, 'scannedPieces': 0},
            {'lineId': 'y', 'pieceCount': 2, 'scannedPieces': 2},
          ],
          'unscanned': [
            {'lineId': 'b', 'pieceCount': 1},
          ],
          'waitingCount': 8,
          'waiting': [
            for (var i = 0; i < 8; i++) {'lineId': 'w$i'},
          ],
        }),
      );
      expect(view.incomplete.map((l) => l.lineId), ['a']);
      expect(view.incomplete.single.unscannedPieces, 3);
      expect(view.showsUnscanned, isTrue);
      expect(view.unscannedCount, 1);
      expect(view.waitingShown, hasLength(loadSummaryWaitingShown));
      expect(view.waitingMore, 8 - loadSummaryWaitingShown);
      expect(view.allClear, isFalse);
    });

    test('nothing left: all clear', () {
      final view = LoadSummaryView.of(
        LoadSummary.fromCallable({'incomplete': [], 'unscanned': []}),
      );
      expect(view.showsIncomplete, isFalse);
      expect(view.showsUnscanned, isFalse);
      expect(view.showsWaiting, isFalse);
      expect(view.allClear, isTrue);
    });
  });

  // Read from source, like container_manifest_parity_test.dart: the
  // container page needs a live Firestore feed to render.
  group('wiring', () {
    String read(String path) => File(path).readAsStringSync();
    final detail = read('lib/screens/containers_screen.dart');
    final screen = read('lib/screens/container_loading_screen.dart');

    test(
      'Start loading sits on a loading container, for the containers people',
      () {
        expect(detail, contains("Key('container-start-loading')"));
        // The same gate as adding waiting packages (a loading container on
        // the container page), and never for a deliveries-only person.
        expect(
          detail,
          contains('if (container.isLoading && !access.restricted)'),
        );
        expect(detail, contains('ContainerLoadingScreen('));
        expect(detail, contains('liveLines: () => _feed.lines'));
      },
    );

    test('the camera, the label reader and the caller are the shared ones', () {
      expect(screen, contains('ScannerCameraView('));
      expect(screen, contains('BarcodeFormat.qrCode'));
      expect(screen, contains('packageCodeFromScan('));
      expect(screen, contains('this.caller = callContainerCallable'));
      expect(screen, contains('AppFeedback.success()'));
      expect(screen, contains('AppFeedback.error()'));
    });

    test('every string on the loading screen is in both catalogs', () {
      final enArb =
          jsonDecode(read('lib/l10n/app_en.arb')) as Map<String, dynamic>;
      final frArb =
          jsonDecode(read('lib/l10n/app_fr.arb')) as Map<String, dynamic>;
      final used = RegExp(
        r'l10n\.([a-z][A-Za-z0-9]*)',
      ).allMatches(screen).map((m) => m.group(1)!).toSet();
      expect(used.where((k) => k.startsWith('ldg')).length, greaterThan(40));
      for (final key in used) {
        expect(
          enArb.containsKey(key),
          isTrue,
          reason: '$key missing in English',
        );
        expect(
          frArb.containsKey(key),
          isTrue,
          reason: '$key missing in French',
        );
      }
      final enLdg = enArb.keys.where((k) => k.contains('ldg')).toSet();
      final frLdg = frArb.keys.where((k) => k.contains('ldg')).toSet();
      expect(frLdg, enLdg);
    });
  });
}

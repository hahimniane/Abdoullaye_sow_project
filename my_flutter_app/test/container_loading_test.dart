import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/container_loading_screen.dart';
import 'package:my_flutter_app/services/container_loading.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/utils/date_display.dart';

/// Scan to load (docs/WAITING_PACKAGES.md "Scan to load"): the pure rules
/// behind the loading screen - the requests, the answers and refusals read
/// into models, the words each refusal gets, the 2 s duplicate guard, the
/// scan ids kept for a retry, the running totals, and the summary rows.
void main() {
  final en = lookupAppLocalizations(const Locale('en'));
  final fr = lookupAppLocalizations(const Locale('fr'));

  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

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

  group('loading lists', () {
    final oct23 = DateTime(2026, 10, 23, 15, 5);

    ContainerLine line(
      String id, {
      String code = '',
      String customer = '',
      String phone = '',
      String receiver = '',
      String receiverPhone = '',
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
      'receiverPhone': receiverPhone,
      'destinationCountryId': destination,
      'loadScannedPieces': ?scanned,
      if (at != null) 'containerAssignedAt': at.millisecondsSinceEpoch,
      if (by.isNotEmpty) 'containerAssignedByStaffId': by,
      if (via.isNotEmpty) 'containerAssignedVia': via,
    });

    List<String> ids(Iterable<ContainerLine> lines) => [
      for (final l in lines) l.id,
    ];

    test('a line reads the new fields, and older lines have none', () {
      final fresh = line('a', at: oct23, by: 'u1', via: 'scan');
      expect(fresh.containerAssignedAt, oct23);
      expect(fresh.containerAssignedByStaffId, 'u1');
      expect(fresh.containerAssignedVia, 'scan');
      final old = line('b');
      expect(old.containerAssignedAt, isNull);
      expect(old.containerAssignedByStaffId, '');
      expect(old.containerAssignedVia, '');
      // Garbage never throws.
      final odd = ContainerLine.fromMap('c', {
        'containerAssignedAt': 'not a date',
        'containerAssignedByStaffId': 7,
        'containerAssignedVia': null,
      });
      expect(odd.containerAssignedAt, isNull);
      expect(odd.containerAssignedVia, '');
    });

    test('an answer reads the new fields, and an older one has none', () {
      final line = LoadLine.fromMap({
        'lineId': 'l1',
        'addedByScan': true,
        'assignedVia': 'SCAN',
        'assignedAt': oct23.millisecondsSinceEpoch,
        'customerName': 'Oumou Barry',
        'customerPhone': '+224600000000',
      });
      expect(line.addedByScan, isTrue);
      expect(line.assignedVia, loadViaScan);
      expect(line.assignedAt, oct23);
      expect(line.customerName, 'Oumou Barry');
      expect(line.customerPhone, '+224600000000');
      final old = LoadLine.fromMap({'lineId': 'l2'});
      expect(old.addedByScan, isFalse);
      expect(old.assignedVia, '');
      expect(old.assignedAt, isNull);
      expect(old.customerName, '');
      // A via the app does not know, and a null time, read as nothing.
      final odd = LoadLine.fromMap({
        'lineId': 'l3',
        'assignedVia': 'teleport',
        'assignedAt': null,
      });
      expect(odd.assignedVia, '');
      expect(odd.assignedAt, isNull);
    });

    group('the neutral row', () {
      LoadAnswer answer(
        String result, {
        bool addedByScan = false,
        int scanned = 1,
        int pieces = 5,
      }) => LoadAnswer.fromCallable({
        'result': result,
        'line': {
          'lineId': 'l1',
          'trackingCode': 'CL-K7M4P2',
          'pieceCount': pieces,
          'scannedPieces': scanned,
          'addedByScan': addedByScan,
        },
      });
      const sending = LoadRow(
        key: 1,
        code: 'CL-K7M4P2',
        state: LoadRowState.sending,
      );

      test('counted on a package already there is neutral, not Loaded', () {
        final row = sending.answered(answer('counted'));
        expect(row.alreadyOnContainer, isTrue);
        expect(row.tone, LoadTone.neutral);
        expect(
          loadRowText(en, row),
          'Already on this container · 1 of 5 scanned',
        );
        expect(loadRowText(fr, row), 'Déjà sur ce conteneur · 1 sur 5 scannée');
        expect(loadRowText(en, row), isNot(contains('Loaded')));
        // It still counted a piece: Undo takes it back.
        expect(loadCanUndo([row], row), isTrue);
      });

      test('a field the server did not send reads as not added by scan', () {
        final bare = sending.answered(
          LoadAnswer.fromCallable({
            'result': 'counted',
            'line': {'lineId': 'l1', 'pieceCount': 3, 'scannedPieces': 1},
          }),
        );
        expect(bare.tone, LoadTone.neutral);
        expect(loadRowText(en, bare), contains('Already on this container'));
      });

      test('only result loaded is the green Loaded', () {
        final loaded = sending.answered(answer('loaded', pieces: 1));
        expect(loaded.tone, LoadTone.green);
        expect(loadRowText(en, loaded), 'Loaded');
        // Even a loaded answer that does not say addedByScan.
        expect(loaded.alreadyOnContainer, isFalse);
      });

      test('the rule: not added by scan and exactly one piece scanned', () {
        bool rule({required bool byScan, required int scanned}) =>
            loadCountedWasAlreadyOn(
              LoadLine(
                lineId: 'l',
                addedByScan: byScan,
                scannedPieces: scanned,
                pieceCount: 5,
              ),
            );
        expect(rule(byScan: false, scanned: 1), isTrue);
        expect(rule(byScan: true, scanned: 1), isFalse);
        expect(rule(byScan: false, scanned: 2), isFalse);
        expect(rule(byScan: false, scanned: 0), isFalse);
      });

      test('a package this mode loaded keeps its blue "2 of 5"', () {
        final second = sending.answered(
          answer('counted', addedByScan: true, scanned: 2),
        );
        expect(second.tone, LoadTone.blue);
        expect(loadRowText(en, second), '2 of 5');
        final first = sending.answered(
          answer('counted', addedByScan: true, scanned: 1),
        );
        expect(first.tone, LoadTone.blue);
        expect(loadRowText(en, first), '1 of 5');
      });
    });

    group('Recently added', () {
      test('newest first; the ones with no time go last as added earlier', () {
        final lines = [
          line('old1', code: 'CL-B'),
          line(
            'mid',
            code: 'CL-M',
            at: oct23.subtract(const Duration(hours: 2)),
          ),
          line('new', code: 'CL-N', at: oct23),
          line('old0', code: 'CL-A'),
        ];
        expect(ids(loadRecentlyAdded(lines)), ['new', 'mid', 'old0', 'old1']);
        // The same input twice gives the same order.
        expect(
          ids(loadRecentlyAdded(lines.reversed)),
          ids(loadRecentlyAdded(lines)),
        );
      });

      test('who added it and how, in both languages, US dates in English', () {
        final staff = [const LotStaff(id: 'u1', name: 'Awa Camara')];
        // Month first and 12-hour in English, the French form in French.
        expect(displayMonthDayTime(oct23, 'en'), startsWith('Oct 23'));
        expect(displayMonthDayTime(oct23, 'en'), contains('PM'));
        expect(displayMonthDayTime(oct23, 'fr'), '23 oct. 15:05');
        final byScan = line('a', at: oct23, by: 'u1', via: 'scan');
        expect(
          loadAddedText(en, byScan, staff, 'en'),
          'Added by Awa Camara · By scan · ${displayMonthDayTime(oct23, 'en')}',
        );
        expect(
          loadAddedText(fr, byScan, staff, 'fr'),
          'Ajouté par Awa Camara · Par scan · ${displayMonthDayTime(oct23, 'fr')}',
        );
        expect(
          loadAddedText(
            en,
            line('b', at: oct23, by: 'u1', via: 'hand'),
            staff,
            'en',
          ),
          contains('By hand'),
        );
        expect(
          loadAddedText(
            en,
            line('c', at: oct23, by: 'u1', via: 'move'),
            staff,
            'en',
          ),
          contains('Moved'),
        );
        // Someone no longer in the list: how and when, no name.
        expect(
          loadAddedText(
            en,
            line('d', at: oct23, by: 'gone', via: 'scan'),
            staff,
            'en',
          ),
          'By scan · ${displayMonthDayTime(oct23, 'en')}',
        );
        // Put on before this was recorded.
        expect(loadAddedText(en, line('e'), staff, 'en'), 'Added earlier');
        expect(loadAddedText(fr, line('e'), staff, 'fr'), 'Ajouté plus tôt');
      });

      test('the staff name is looked up by id', () {
        final staff = [
          const LotStaff(id: 'u1', name: 'Awa'),
          const LotStaff(id: 'u2', name: 'Moussa'),
        ];
        expect(loadStaffName(staff, 'u2'), 'Moussa');
        expect(loadStaffName(staff, 'zz'), '');
        expect(loadStaffName(staff, ''), '');
      });
    });

    group('By customer', () {
      final lines = [
        line('1', code: 'CL-1', customer: 'OUMOU BARRY', pieces: 2, scanned: 2),
        line(
          '2',
          code: 'CL-2',
          customer: 'oumou  barry',
          pieces: 3,
          scanned: 3,
        ),
        line('3', code: 'CL-3', customer: 'Oumou Barry', pieces: 1, scanned: 0),
        line(
          '4',
          code: 'CL-4',
          customer: 'Aliou Diallo',
          pieces: 4,
          scanned: 1,
        ),
        // No sender: the receiver is the customer.
        line('5', code: 'CL-5', receiver: 'Zeinab Sow', pieces: 1),
        // Neither a name nor a phone.
        line('6', code: 'CL-6'),
      ];

      test('grouped by customer: packages, pieces, pieces scanned', () {
        final groups = loadGroupByCustomer(lines);
        expect(
          [for (final g in groups) g.name],
          ['Aliou Diallo', 'OUMOU BARRY', 'Zeinab Sow', ''],
        );
        final oumou = groups[1];
        expect(ids(oumou.lines), ['1', '2', '3']);
        expect(oumou.packages, 3);
        expect(oumou.pieces, 6);
        expect(oumou.scannedPieces, 5);
        expect(groups[3].key, '');
      });

      test(
        'a header reads like "OUMOU BARRY · 3 packages · 5 of 6 pieces scanned"',
        () {
          final oumou = loadGroupByCustomer(lines)[1];
          expect(
            loadOnGroupText(en, oumou),
            'OUMOU BARRY · 3 packages · 5 of 6 pieces scanned',
          );
          expect(
            loadOnGroupText(fr, oumou),
            'OUMOU BARRY · 3 colis · 5 pièces scannées sur 6',
          );
          final aliou = loadGroupByCustomer(lines)[0];
          expect(
            loadOnGroupText(en, aliou),
            'Aliou Diallo · 1 package · 1 of 4 pieces scanned',
          );
          expect(
            loadOnGroupText(en, loadGroupByCustomer(lines)[3]),
            'No name · 1 package · 0 of 1 piece scanned',
          );
        },
      );

      test('with no name the phone is the customer', () {
        final groups = loadGroupByCustomer([
          line('a', phone: '+224 600 00 00 01'),
          line('b', phone: '+224600000001'),
        ]);
        expect(groups.length, 1);
        expect(groups.single.name, '+224 600 00 00 01');
        expect(groups.single.packages, 2);
      });

      test('the filter builds a header then its packages', () {
        final items = loadOnContainerItems(
          lines,
          LoadListFilter.byCustomer,
          '',
        );
        expect(items.first, isA<LoadGroupItem>());
        expect(
          [for (final i in items) i is LoadGroupItem ? 'G' : 'L'],
          ['G', 'L', 'G', 'L', 'L', 'L', 'G', 'L', 'G', 'L'],
        );
      });
    });

    group('Not scanned yet', () {
      test('0 or absent, nothing else', () {
        final lines = [
          line('zero', code: 'CL-1', scanned: 0),
          line('absent', code: 'CL-2'),
          line('some', code: 'CL-3', scanned: 1),
        ];
        expect(ids(loadNotScanned(lines)), ['zero', 'absent']);
        expect(
          ids(
            loadOnContainerItems(
              lines,
              LoadListFilter.notScanned,
              '',
            ).whereType<LoadLineItem>().map((i) => i.line),
          ),
          ['zero', 'absent'],
        );
      });
    });

    group('search', () {
      final lines = [
        line(
          'a',
          code: 'CL-K7M4P2',
          customer: 'Mariama Bah',
          phone: '+224 622 11 22 33',
          receiver: 'Ibrahima Sow',
          receiverPhone: '+1 (347) 555-0188',
        ),
        line('b', code: 'CL-ZZZ999', customer: 'Aliou Diallo'),
      ];

      test('by code, with or without the dash and in any case', () {
        expect(ids(lines.where((l) => loadLineMatches(l, 'k7m4'))), ['a']);
        expect(ids(lines.where((l) => loadLineMatches(l, 'cl-k7m4p2'))), ['a']);
        expect(ids(lines.where((l) => loadLineMatches(l, 'CLK7M4P2'))), ['a']);
      });

      test('by name, the sender or the receiver', () {
        expect(ids(lines.where((l) => loadLineMatches(l, 'mariama'))), ['a']);
        expect(ids(lines.where((l) => loadLineMatches(l, 'DIALLO'))), ['b']);
        expect(ids(lines.where((l) => loadLineMatches(l, 'ibrahima s'))), [
          'a',
        ]);
      });

      test('by phone however it is punctuated', () {
        expect(ids(lines.where((l) => loadLineMatches(l, '622 11'))), ['a']);
        expect(ids(lines.where((l) => loadLineMatches(l, '+1347555'))), ['a']);
      });

      test('empty or punctuation only matches everything; a miss nothing', () {
        expect(lines.every((l) => loadLineMatches(l, '')), isTrue);
        expect(lines.every((l) => loadLineMatches(l, ' - ')), isTrue);
        expect(lines.any((l) => loadLineMatches(l, 'nobody')), isFalse);
      });

      test('the search narrows every filter', () {
        final items = loadOnContainerItems(
          lines,
          LoadListFilter.recent,
          'aliou',
        );
        expect(items.length, 1);
        expect((items.single as LoadLineItem).line.id, 'b');
      });
    });

    group('Still to load', () {
      final box = ShippingContainer.fromMap('c1', {
        'businessId': 'b1',
        'label': 'Box 1',
        'status': containerStatusLoading,
        'destinationCountryId': 'guinea',
        'destinationCountryName': 'Guinea',
      });
      final lines = [
        line('w1', code: 'CL-W1', customer: 'Aliou Diallo', waiting: true),
        line('w2', code: 'CL-W2', customer: 'Aliou Diallo', waiting: true),
        line('w3', code: 'CL-W3', customer: 'Fanta Keita', waiting: true),
        line(
          'mali',
          customer: 'Fanta Keita',
          waiting: true,
          destination: 'mali',
        ),
        line('on', code: 'CL-ON', customer: 'Aliou Diallo'),
      ];

      test('waiting packages going to the container country, only', () {
        expect(ids(loadStillToLoadLines(lines, box)), ['w1', 'w2', 'w3']);
      });

      test('a container with no destination takes none', () {
        final open = ShippingContainer.fromMap('c2', {
          'businessId': 'b1',
          'status': containerStatusLoading,
        });
        expect(loadStillToLoadLines(lines, open), isEmpty);
      });

      test('grouped by customer, counts in words', () {
        final items = loadStillToLoadItems(
          loadStillToLoadLines(lines, box),
          '',
        );
        final groups = items.whereType<LoadGroupItem>().map((i) => i.group);
        expect(
          [for (final g in groups) loadWaitingGroupText(en, g)],
          [
            'Aliou Diallo · 2 packages waiting',
            'Fanta Keita · 1 package waiting',
          ],
        );
        expect(
          [for (final g in groups) loadWaitingGroupText(fr, g)],
          [
            'Aliou Diallo · 2 colis en attente',
            'Fanta Keita · 1 colis en attente',
          ],
        );
      });

      test('on the container is only this container', () {
        expect(ids(loadOnContainerLines(lines, 'c1')), ['on']);
        expect(loadOnContainerLines(lines, 'c9'), isEmpty);
      });

      test('the header and the empty note in both languages', () {
        expect(
          en.ldgStillWaitingFor(12, 'Guinea'),
          '12 still waiting for Guinea',
        );
        expect(
          fr.ldgStillWaitingFor(12, 'Guinée'),
          '12 encore en attente pour Guinée',
        );
        expect(
          en.ldgNothingToLoad('Guinea'),
          'No package is waiting for Guinea.',
        );
      });
    });

    group('Take off', () {
      test('only while loading, and not once delivered', () {
        expect(loadCanTakeOff(line('a')), isTrue);
        expect(
          loadCanTakeOff(line('b', status: containerStatusShipped)),
          isFalse,
        );
        expect(
          loadCanTakeOff(line('c', status: containerStatusLoading)),
          isTrue,
        );
      });

      test('the confirm question names the code and the container', () {
        expect(
          en.ldgTakeOffMessage('CL-K7M4P2', 'Box 2'),
          'Take CL-K7M4P2 off Box 2? It goes back to waiting.',
        );
        expect(
          fr.ldgTakeOffMessage('CL-K7M4P2', 'Box 2'),
          'Retirer CL-K7M4P2 de Box 2 ? Le colis repasse en attente.',
        );
      });

      test('a refusal is shown in the container words, never raw', () {
        final locked = FirebaseFunctionsException(
          message: 'refused',
          code: 'failed-precondition',
          details: {'reason': 'container_locked'},
        );
        expect(loadTakeOffErrorText(en, locked), en.ctrErrLocked);
        expect(loadTakeOffErrorText(fr, locked), fr.ctrErrLocked);
        final gone = FirebaseFunctionsException(
          message: 'refused',
          code: 'not-found',
          details: {'reason': 'line_not_found'},
        );
        expect(loadTakeOffErrorText(en, gone), en.ctrErrLineNotFound);
        expect(
          loadTakeOffErrorText(
            en,
            FirebaseFunctionsException(message: 'x', code: 'unavailable'),
          ),
          en.dlvErrOffline,
        );
        expect(
          loadTakeOffErrorText(en, StateError('boom')),
          en.lotCouldNotSave,
        );
      });
    });
  });
}

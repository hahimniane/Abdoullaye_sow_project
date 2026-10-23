/// Scan to load (docs/WAITING_PACKAGES.md "Scan to load"): staff open a
/// container that is still loading, tap Start loading, and every package
/// label they scan goes onto that container.
///
/// The pure half of the loading screen: the requests sent to
/// `assignContainerLines` (`action: scan | undo_scan | load_summary |
/// leave_unscanned`), its answers and refusals read into models, which
/// words a refusal gets, the 2 s guard against the camera reading the same
/// label twice, when a scan id is sent again (only to retry the same
/// request - every new scan has a fresh one), the running totals, and which
/// rows the Done loading summary shows. The screen is thin glue over these.
library;

import 'dart:math';

import '../utils/callable_data.dart';
import 'container_manifest.dart';

/// The callable every loading action rides on (no new export).
const loadCallable = 'assignContainerLines';

const loadActionScan = 'scan';
const loadActionUndo = 'undo_scan';
const loadActionSummary = 'load_summary';
const loadActionLeave = 'leave_unscanned';

/// `result` of a scan.
const loadResultLoaded = 'loaded';
const loadResultCounted = 'counted';
const loadResultAllScanned = 'all_scanned';

/// `result` of an undo.
const loadResultUncounted = 'uncounted';
const loadResultUnloaded = 'unloaded';

/// The package went back to the loading container it was moved from.
const loadResultMovedBack = 'moved_back';

/// That scan was already taken back: nothing changed (a double tap, or a
/// retry after a lost answer).
const loadResultAlreadyUndone = 'already_undone';

/// How long the camera ignores a label it has just sent.
const loadDuplicateWindow = Duration(seconds: 2);

/// How many scans the Recent list keeps.
const loadRecentLimit = 40;

/// How many of the waiting packages the summary names before "and N more".
const loadSummaryWaitingShown = 5;

/// `details.reason` of a refused loading action - every one the contract
/// names. A new reason is added here, to [loadRefusalMessage] and to the
/// screen's words together.
abstract final class LoadReason {
  static const lineNotFound = 'line_not_found';
  static const containerLocked = 'container_locked';
  static const destinationRequired = 'container_destination_required';
  static const destinationMismatch = 'destination_mismatch';
  static const lineDelivered = 'line_delivered';
  static const lineInOtherContainer = 'line_in_other_container';
  static const scanCodeInvalid = 'scan_code_invalid';
  static const scanIdInvalid = 'scan_id_invalid';
  static const pieceCountInvalid = 'piece_count_invalid';
  static const actionInvalid = 'load_action_invalid';

  static const all = [
    lineNotFound,
    containerLocked,
    destinationRequired,
    destinationMismatch,
    lineDelivered,
    lineInOtherContainer,
    scanCodeInvalid,
    scanIdInvalid,
    pieceCountInvalid,
    actionInvalid,
  ];
}

// ---------------------------------------------------------------------------
// Requests.
// ---------------------------------------------------------------------------

final _scanIdPattern = RegExp(r'^[A-Za-z0-9_-]{8,64}$');

/// Whether [id] is a scan id the server accepts (8-64 of `[A-Za-z0-9_-]`).
bool isLoadScanId(String id) => _scanIdPattern.hasMatch(id);

/// A fresh id for one scan.
String newLoadScanId([Random? random]) {
  const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  final r = random ?? Random.secure();
  return 'scan_${List.generate(20, (_) => alphabet[r.nextInt(alphabet.length)]).join()}';
}

Map<String, Object?> loadScanRequest({
  required String businessId,
  required String containerId,
  required String code,
  required String scanId,
  bool move = false,
}) => {
  'businessId': businessId,
  'containerId': containerId,
  'action': loadActionScan,
  'code': code,
  'scanId': scanId,
  if (move) 'move': true,
};

/// Takes back [scanId]'s scan of the package: a double tap or a retry after
/// a lost answer takes back only that one scan.
Map<String, Object?> loadUndoRequest({
  required String businessId,
  required String containerId,
  required String lineId,
  String scanId = '',
}) => {
  'businessId': businessId,
  'containerId': containerId,
  'action': loadActionUndo,
  'lineId': lineId,
  if (scanId.isNotEmpty) 'scanId': scanId,
};

Map<String, Object?> loadSummaryRequest({
  required String businessId,
  required String containerId,
}) => {
  'businessId': businessId,
  'containerId': containerId,
  'action': loadActionSummary,
};

Map<String, Object?> loadLeaveRequest({
  required String businessId,
  required String containerId,
  required String lineId,
}) => {
  'businessId': businessId,
  'containerId': containerId,
  'action': loadActionLeave,
  'lineId': lineId,
};

// ---------------------------------------------------------------------------
// Answers.
// ---------------------------------------------------------------------------

/// A package as the loading answers describe it: `{lineId, trackingCode,
/// name (receiver, else customer), kind, pieceCount, scannedPieces,
/// destinationCountryName}`.
class LoadLine {
  const LoadLine({
    required this.lineId,
    this.trackingCode = '',
    this.name = '',
    this.kind = '',
    this.pieceCount = 0,
    this.scannedPieces = 0,
    this.destinationCountryName = '',
  });

  factory LoadLine.fromMap(Object? data) {
    final m = callableMap(data);
    return LoadLine(
      lineId: callableString(m['lineId']),
      trackingCode: callableString(m['trackingCode']).toUpperCase(),
      name: callableString(m['name']),
      kind: callableString(m['kind']),
      pieceCount: max(0, callableInt(m['pieceCount'])),
      scannedPieces: max(0, callableInt(m['scannedPieces'])),
      destinationCountryName: callableString(m['destinationCountryName']),
    );
  }

  final String lineId;
  final String trackingCode;
  final String name;
  final String kind;
  final int pieceCount;
  final int scannedPieces;
  final String destinationCountryName;

  /// Pieces not scanned yet ("Leave N waiting").
  int get unscannedPieces => max(0, pieceCount - scannedPieces);
}

/// The container after a change: `{containerId, label, lineCount,
/// pieceCount}`.
class LoadContainer {
  const LoadContainer({
    required this.containerId,
    this.label = '',
    this.lineCount = 0,
    this.pieceCount = 0,
  });

  factory LoadContainer.fromMap(Object? data) {
    final m = callableMap(data);
    return LoadContainer(
      containerId: callableString(m['containerId']),
      label: callableString(m['label']),
      lineCount: max(0, callableInt(m['lineCount'])),
      pieceCount: max(0, callableInt(m['pieceCount'])),
    );
  }

  final String containerId;
  final String label;
  final int lineCount;
  final int pieceCount;
}

/// What a scan or an undo answered: `{success, result, line, container}`.
class LoadAnswer {
  const LoadAnswer({
    required this.result,
    required this.line,
    this.container,
    this.movedBackTo,
  });

  factory LoadAnswer.fromCallable(Object? data) {
    final m = callableMap(data);
    final container = m['container'];
    final movedBackTo = m['movedBackTo'];
    return LoadAnswer(
      result: callableString(m['result']),
      line: LoadLine.fromMap(m['line']),
      container: container is Map ? LoadContainer.fromMap(container) : null,
      movedBackTo: movedBackTo is Map
          ? LoadContainer.fromMap(movedBackTo)
          : null,
    );
  }

  final String result;
  final LoadLine line;
  final LoadContainer? container;

  /// On an undo answered `moved_back`: the container the package went back
  /// to (`{containerId, label}`).
  final LoadContainer? movedBackTo;
}

/// A split-off part: `{lineId, trackingCode, pieceCount}`.
class LoadPart {
  const LoadPart({
    required this.lineId,
    this.trackingCode = '',
    this.pieceCount = 0,
  });

  factory LoadPart.fromMap(Object? data) {
    final m = callableMap(data);
    return LoadPart(
      lineId: callableString(m['lineId']),
      trackingCode: callableString(m['trackingCode']).toUpperCase(),
      pieceCount: max(0, callableInt(m['pieceCount'])),
    );
  }

  final String lineId;
  final String trackingCode;
  final int pieceCount;
}

/// What `leave_unscanned` answered: `{success, line, part, container}`.
class LoadLeaveAnswer {
  const LoadLeaveAnswer({
    required this.line,
    required this.part,
    this.container,
    this.alreadyDone = false,
  });

  factory LoadLeaveAnswer.fromCallable(Object? data) {
    final m = callableMap(data);
    final container = m['container'];
    return LoadLeaveAnswer(
      line: LoadLine.fromMap(m['line']),
      part: LoadPart.fromMap(m['part']),
      container: container is Map ? LoadContainer.fromMap(container) : null,
      alreadyDone: callableBool(m['alreadyDone']),
    );
  }

  final LoadLine line;
  final LoadPart part;
  final LoadContainer? container;

  /// A retry of a split that already happened: still a success.
  final bool alreadyDone;
}

/// What `load_summary` answered: `{success, container, incomplete,
/// unscanned, waitingCount, waiting}`.
class LoadSummary {
  const LoadSummary({
    this.container,
    this.incomplete = const [],
    this.unscanned = const [],
    this.waitingCount = 0,
    this.waiting = const [],
  });

  factory LoadSummary.fromCallable(Object? data) {
    final m = callableMap(data);
    List<LoadLine> lines(Object? value) => [
      if (value is List)
        for (final item in value)
          if (item is Map) LoadLine.fromMap(item),
    ];
    final container = m['container'];
    final waiting = lines(m['waiting']);
    return LoadSummary(
      container: container is Map ? LoadContainer.fromMap(container) : null,
      incomplete: lines(m['incomplete']),
      unscanned: lines(m['unscanned']),
      // The list holds at most 50; the count is all of them.
      waitingCount: max(callableInt(m['waitingCount']), waiting.length),
      waiting: waiting,
    );
  }

  final LoadContainer? container;
  final List<LoadLine> incomplete;
  final List<LoadLine> unscanned;
  final int waitingCount;
  final List<LoadLine> waiting;
}

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

/// A refused loading call, or one that never got through.
class LoadFailure implements Exception {
  const LoadFailure({
    required this.code,
    this.reason = '',
    this.otherContainerId = '',
    this.otherContainerLabel = '',
    this.otherStatus = '',
    this.canMove = false,
    this.otherScannedPieces = 0,
  });

  /// On `line_in_other_container`: how many of its pieces were already
  /// scanned into the other container (the move question warns of them).
  final int otherScannedPieces;

  /// The Functions code (`failed-precondition`, `not-found`,
  /// `unavailable`...); `unknown` when none came.
  final String code;

  /// `details.reason`, one of [LoadReason.all]; '' when none came.
  final String reason;

  /// On `line_in_other_container`: where the package is now, and whether
  /// it may be moved here (only while that container is still loading).
  final String otherContainerId;
  final String otherContainerLabel;
  final String otherStatus;
  final bool canMove;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  bool get notAllowed => code == 'permission-denied';

  bool get inOtherContainer => reason == LoadReason.lineInOtherContainer;

  /// The move question is asked only when the server says it may move.
  bool get offersMove => inOtherContainer && canMove;

  @override
  String toString() => 'LoadFailure($code $reason)';
}

LoadFailure parseLoadFailure(String code, Object? details) {
  final m = callableMap(details);
  return LoadFailure(
    code: code.trim().toLowerCase(),
    reason: callableString(m['reason']),
    otherContainerId: callableString(m['otherContainerId']),
    otherContainerLabel: callableString(m['otherContainerLabel']),
    otherStatus: callableString(m['otherStatus']),
    canMove: callableBool(m['canMove']),
    otherScannedPieces: max(0, callableInt(m['otherScannedPieces'])),
  );
}

/// A failure that is not the callable's own refusal: offline when the error
/// reads like the network, else unknown.
LoadFailure loadFailureOf(Object error) {
  if (error is LoadFailure) return error;
  final text = error.toString().toLowerCase();
  final offline =
      text.contains('timeout') ||
      text.contains('socket') ||
      text.contains('network') ||
      text.contains('connection') ||
      text.contains('unavailable');
  return LoadFailure(code: offline ? 'unavailable' : 'unknown');
}

/// Which words a failure gets. The screen turns each into its own
/// localized sentence; never the server's English message.
enum LoadMessage {
  offline,
  notAllowed,
  lineNotFound,
  containerLocked,
  destinationRequired,
  destinationMismatch,
  lineDelivered,
  inOtherContainer,
  inShippedContainer,
  codeInvalid,
  scanIdInvalid,
  pieceCountInvalid,
  actionInvalid,
  generic,
}

LoadMessage loadRefusalMessage(LoadFailure failure) {
  switch (failure.reason) {
    case LoadReason.lineNotFound:
      return LoadMessage.lineNotFound;
    case LoadReason.containerLocked:
      return LoadMessage.containerLocked;
    case LoadReason.destinationRequired:
      return LoadMessage.destinationRequired;
    case LoadReason.destinationMismatch:
      return LoadMessage.destinationMismatch;
    case LoadReason.lineDelivered:
      return LoadMessage.lineDelivered;
    case LoadReason.lineInOtherContainer:
      // On a box that sailed (or arrived) it cannot be moved: say so.
      return failure.otherStatus.isNotEmpty &&
              failure.otherStatus != containerStatusLoading
          ? LoadMessage.inShippedContainer
          : LoadMessage.inOtherContainer;
    case LoadReason.scanCodeInvalid:
      return LoadMessage.codeInvalid;
    case LoadReason.scanIdInvalid:
      return LoadMessage.scanIdInvalid;
    case LoadReason.pieceCountInvalid:
      return LoadMessage.pieceCountInvalid;
    case LoadReason.actionInvalid:
      return LoadMessage.actionInvalid;
  }
  if (failure.offline) return LoadMessage.offline;
  if (failure.notAllowed) return LoadMessage.notAllowed;
  return LoadMessage.generic;
}

// ---------------------------------------------------------------------------
// Scanning: the duplicate guard and the scan ids.
// ---------------------------------------------------------------------------

/// The camera sees a label many times a second. A code is sent once, then
/// ignored for [window] from that send; after that the same label counts
/// again (the next piece of the same package carries the same QR).
class LoadDuplicateGuard {
  LoadDuplicateGuard({this.window = loadDuplicateWindow});

  final Duration window;
  final Map<String, DateTime> _sent = {};

  /// Whether [code] seen at [now] should be sent; records it when so.
  bool accept(String code, DateTime now) {
    final last = _sent[code];
    if (last != null && now.difference(last) < window) return false;
    _sent[code] = now;
    // Only the window matters: drop what is long past.
    _sent.removeWhere((_, at) => now.difference(at) >= window * 4);
    return true;
  }

  /// Lets [code] through at once (a scan that failed to send, an undo).
  void forget(String code) => _sent.remove(code);
}

/// Scan ids. Every piece of a package carries the same QR, so every new
/// physical scan gets a fresh id ([newLoadScanId]) - even right after the
/// same label failed to send. An id is sent again only to retry the SAME
/// request: once at once when it got no answer ([loadShouldAutoRetry]),
/// then from the failed row's Retry ([loadCanRetry]). If the first send
/// did land, the server answers it again and counts nothing twice.
///
/// Reusing the id for the next scan of the label would make the server
/// answer that piece as the earlier one: a piece missing from the count,
/// and later "Leave N waiting" splitting off a piece that is in the box.
bool loadShouldAutoRetry(LoadFailure failure, int attempt) =>
    failure.offline && attempt == 0;

// ---------------------------------------------------------------------------
// Recent scans.
// ---------------------------------------------------------------------------

enum LoadRowState { sending, loaded, counted, allScanned, refused, undone }

/// The colour a row is drawn in.
enum LoadTone { pending, green, blue, amber, red, grey }

/// One scan in the Recent list.
class LoadRow {
  const LoadRow({
    required this.key,
    required this.code,
    required this.state,
    this.scanId = '',
    this.line,
    this.failure,
    this.moved = false,
    this.undoResult = '',
    this.movedBackTo = '',
  });

  /// After an undo answered `moved_back`: the container it went back to.
  final String movedBackTo;

  /// Local, stable across a resend (the move question).
  final int key;

  /// The id this scan was sent with: Undo names it, so a double tap or a
  /// retried undo takes back only this one scan.
  final String scanId;
  final String code;
  final LoadRowState state;
  final LoadLine? line;
  final LoadFailure? failure;

  /// Moved here from another loading container (while sending or refused:
  /// the request asked to move it).
  final bool moved;

  /// After an undo: `uncounted` or `unloaded`.
  final String undoResult;

  LoadRow answered(LoadAnswer answer, {bool moved = false}) => LoadRow(
    key: key,
    code: code,
    scanId: scanId,
    state: switch (answer.result) {
      loadResultLoaded => LoadRowState.loaded,
      loadResultCounted => LoadRowState.counted,
      loadResultAllScanned => LoadRowState.allScanned,
      // An answer the contract does not name: shown as counted, since the
      // server took it.
      _ => LoadRowState.counted,
    },
    line: answer.line,
    moved: moved,
  );

  LoadRow refused(LoadFailure failure) => LoadRow(
    key: key,
    code: code,
    scanId: scanId,
    // A move that got no answer is retried as a move.
    moved: moved,
    state: LoadRowState.refused,
    failure: failure,
  );

  /// Sent again (the move question) under a new id.
  LoadRow sending(String newScanId) => LoadRow(
    key: key,
    code: code,
    scanId: newScanId,
    state: LoadRowState.sending,
  );

  LoadRow undone(LoadAnswer answer) => LoadRow(
    key: key,
    code: code,
    scanId: scanId,
    state: LoadRowState.undone,
    // `already_undone` may carry no line: keep what the row knew.
    line: answer.line.lineId.isNotEmpty ? answer.line : line,
    moved: moved,
    undoResult: answer.result,
    movedBackTo: answer.movedBackTo?.label.isNotEmpty == true
        ? answer.movedBackTo!.label
        : (answer.movedBackTo?.containerId ?? ''),
  );

  /// The server took it: what Undo can take back.
  bool get counted =>
      state == LoadRowState.loaded || state == LoadRowState.counted;

  LoadTone get tone => switch (state) {
    LoadRowState.sending => LoadTone.pending,
    LoadRowState.loaded => LoadTone.green,
    LoadRowState.counted =>
      // The last piece of a package completes it: green, like a load.
      line != null &&
              line!.pieceCount > 0 &&
              line!.scannedPieces >= line!.pieceCount
          ? LoadTone.green
          : LoadTone.blue,
    LoadRowState.allScanned => LoadTone.amber,
    LoadRowState.refused => LoadTone.red,
    LoadRowState.undone => LoadTone.grey,
  };
}

/// Retry is offered on a scan that got no answer: it resends the SAME
/// request (same scan id), so a send that did land is not counted twice.
bool loadCanRetry(LoadRow row) =>
    row.state == LoadRowState.refused &&
    (row.failure?.offline ?? false) &&
    isLoadScanId(row.scanId);

/// Undo is offered on the newest scan only, once the server took it.
bool loadCanUndo(List<LoadRow> rows, LoadRow row) =>
    rows.isNotEmpty &&
    rows.first.key == row.key &&
    row.counted &&
    (row.line?.lineId ?? '').isNotEmpty;

/// [rows] with [row] put in place of the one with the same key, or added
/// on top (newest first), kept to [loadRecentLimit].
List<LoadRow> loadRowsWith(List<LoadRow> rows, LoadRow row) {
  final i = rows.indexWhere((r) => r.key == row.key);
  if (i >= 0) {
    return [...rows.sublist(0, i), row, ...rows.sublist(i + 1)];
  }
  final out = [row, ...rows];
  return out.length > loadRecentLimit ? out.sublist(0, loadRecentLimit) : out;
}

// ---------------------------------------------------------------------------
// Totals.
// ---------------------------------------------------------------------------

/// "37 packages · 52 pieces scanned": packages with at least one piece
/// scanned onto this container, and all the pieces scanned.
class LoadTotals {
  const LoadTotals({this.packages = 0, this.pieces = 0});

  final int packages;
  final int pieces;

  @override
  bool operator ==(Object other) =>
      other is LoadTotals &&
      other.packages == packages &&
      other.pieces == pieces;

  @override
  int get hashCode => Object.hash(packages, pieces);

  @override
  String toString() => 'LoadTotals($packages, $pieces)';
}

/// From the live lines (every phone's scans): the lines on [containerId]
/// with their server-kept `loadScannedPieces`.
LoadTotals loadTotalsOfLines(
  Iterable<ContainerLine> lines,
  String containerId,
) {
  var packages = 0;
  var pieces = 0;
  for (final l in lines) {
    if (l.containerId != containerId || l.loadScannedPieces <= 0) continue;
    packages++;
    pieces += l.loadScannedPieces;
  }
  return LoadTotals(packages: packages, pieces: pieces);
}

/// From this phone's answers, when there is no live read: the last known
/// state of each package, by line id.
LoadTotals loadTotalsOfAnswers(Iterable<LoadLine> latestByLine) {
  var packages = 0;
  var pieces = 0;
  for (final l in latestByLine) {
    if (l.scannedPieces <= 0) continue;
    packages++;
    pieces += l.scannedPieces;
  }
  return LoadTotals(packages: packages, pieces: pieces);
}

/// What is on the container in all (scanned or not): packages and pieces.
/// From the live lines when the screen has them.
LoadTotals loadContainerTotalsOfLines(
  Iterable<ContainerLine> lines,
  String containerId,
) {
  var packages = 0;
  var pieces = 0;
  for (final l in lines) {
    if (l.containerId != containerId) continue;
    packages++;
    pieces += l.pieceCount;
  }
  return LoadTotals(packages: packages, pieces: pieces);
}

/// The same from the last answer that carried the container (a scan, an
/// undo, a leave); null before any.
LoadTotals? loadContainerTotalsOf(LoadContainer? container) => container == null
    ? null
    : LoadTotals(packages: container.lineCount, pieces: container.pieceCount);

// ---------------------------------------------------------------------------
// Done loading.
// ---------------------------------------------------------------------------

/// What the Done loading sheet shows, worked out once from the answer.
class LoadSummaryView {
  const LoadSummaryView({
    required this.incomplete,
    required this.unscannedCount,
    required this.waitingCount,
    required this.waitingShown,
    required this.waitingMore,
  });

  factory LoadSummaryView.of(LoadSummary summary) {
    // Only what the server calls incomplete AND can still be split: at
    // least one piece scanned and fewer than all.
    final incomplete = [
      for (final l in summary.incomplete)
        if (l.scannedPieces > 0 && l.scannedPieces < l.pieceCount) l,
    ];
    final shown = summary.waiting.take(loadSummaryWaitingShown).toList();
    return LoadSummaryView(
      incomplete: incomplete,
      unscannedCount: summary.unscanned.length,
      waitingCount: summary.waitingCount,
      waitingShown: shown,
      waitingMore: max(0, summary.waitingCount - shown.length),
    );
  }

  /// Each with "Load all" / "Leave N waiting".
  final List<LoadLine> incomplete;

  /// "N packages on the container were never scanned" (information only).
  final int unscannedCount;

  /// "N waiting packages for the destination were not scanned", the first few
  /// named, then "and N more".
  final int waitingCount;
  final List<LoadLine> waitingShown;
  final int waitingMore;

  bool get showsIncomplete => incomplete.isNotEmpty;
  bool get showsUnscanned => unscannedCount > 0;
  bool get showsWaiting => waitingCount > 0;

  /// Nothing to look at: every package on it scanned in full, none left.
  bool get allClear => !showsIncomplete && !showsUnscanned && !showsWaiting;
}

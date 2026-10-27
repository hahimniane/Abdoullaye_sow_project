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
import 'lot_ledger.dart' show LotStaff;
import 'waiting_packages.dart' show destinationMismatch;

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
/// destinationCountryName}`, and (docs/WAITING_PACKAGES.md "Loading lists")
/// `addedByScan`, `assignedVia`, `assignedAt` (ms or null), `customerName`
/// and `customerPhone`. Older servers send none of the last five.
class LoadLine {
  const LoadLine({
    required this.lineId,
    this.trackingCode = '',
    this.name = '',
    this.kind = '',
    this.pieceCount = 0,
    this.scannedPieces = 0,
    this.destinationCountryName = '',
    this.addedByScan = false,
    this.assignedVia = '',
    this.assignedAt,
    this.customerName = '',
    this.customerPhone = '',
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
      addedByScan: callableBool(m['addedByScan']),
      assignedVia: loadViaOf(callableString(m['assignedVia'])),
      assignedAt: _loadDateOf(m['assignedAt']),
      customerName: callableString(m['customerName']),
      customerPhone: callableString(m['customerPhone']),
    );
  }

  final String lineId;
  final String trackingCode;
  final String name;
  final String kind;
  final int pieceCount;
  final int scannedPieces;
  final String destinationCountryName;

  /// True when scan to load put it on the container (it was waiting).
  /// False or absent: it was already on the container, or was moved here.
  final bool addedByScan;

  /// How it went on: [loadViaHand], [loadViaScan], [loadViaMove]; '' when
  /// the server did not say.
  final String assignedVia;
  final DateTime? assignedAt;

  /// The sender, else the receiver (`lineCustomerName`); '' when absent.
  final String customerName;
  final String customerPhone;

  /// Pieces not scanned yet ("Leave N waiting").
  int get unscannedPieces => max(0, pieceCount - scannedPieces);
}

/// An epoch-milliseconds field from an answer; null when absent or not a
/// time.
DateTime? _loadDateOf(Object? value) {
  final ms = callableInt(value);
  return ms > 0 ? DateTime.fromMillisecondsSinceEpoch(ms) : null;
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

/// The colour a row is drawn in. [neutral] is a package that was already on
/// the container: scanning it counted a piece, but it was not loaded now.
enum LoadTone { pending, green, blue, amber, red, grey, neutral }

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

  /// A `counted` answer for a package that was on the container before any
  /// scan: it did not just load, so the row is neutral ("Already on this
  /// container"), never the green "Loaded" ([loadCountedWasAlreadyOn]).
  bool get alreadyOnContainer =>
      state == LoadRowState.counted &&
      line != null &&
      loadCountedWasAlreadyOn(line!);

  /// The server took it: what Undo can take back.
  bool get counted =>
      state == LoadRowState.loaded || state == LoadRowState.counted;

  /// Neutral when already on the container; green when this piece completes
  /// the package (like a load); else blue, part-way.
  LoadTone get _countedTone {
    if (alreadyOnContainer) return LoadTone.neutral;
    final l = line;
    return l != null && l.pieceCount > 0 && l.scannedPieces >= l.pieceCount
        ? LoadTone.green
        : LoadTone.blue;
  }

  LoadTone get tone => switch (state) {
    LoadRowState.sending => LoadTone.pending,
    LoadRowState.loaded => LoadTone.green,
    LoadRowState.counted => _countedTone,
    LoadRowState.allScanned => LoadTone.amber,
    LoadRowState.refused => LoadTone.red,
    LoadRowState.undone => LoadTone.grey,
  };
}

/// Whether a `counted` answer is the first scan of a package that was
/// already on the container (put on by hand, moved, or before scanning
/// began): it was not added by scan and this is its first piece. Shown as
/// "Already on this container · 1 of N scanned"; green "Loaded" is only for
/// `result: "loaded"`.
bool loadCountedWasAlreadyOn(LoadLine line) =>
    !line.addedByScan && line.scannedPieces == 1;

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

// ---------------------------------------------------------------------------
// Loading lists (docs/WAITING_PACKAGES.md "Loading lists").
// ---------------------------------------------------------------------------

/// `containerAssignedVia`: how a package went onto the container.
const loadViaHand = 'hand';
const loadViaScan = 'scan';
const loadViaMove = 'move';

/// [raw] if it is one of the three ways the server writes, else '' (a line
/// put on before the field existed, or a value this app does not know).
String loadViaOf(String raw) {
  final v = raw.trim().toLowerCase();
  return v == loadViaHand || v == loadViaScan || v == loadViaMove ? v : '';
}

/// The filters of "On this container".
enum LoadListFilter { recent, byCustomer, notScanned }

/// The name of the staff member with [id], or '' when nobody in [staff] has
/// it - the same lookup the waiting packages list uses for "added by".
String loadStaffName(Iterable<LotStaff> staff, String id) {
  if (id.isEmpty) return '';
  for (final s in staff) {
    if (s.id == id) return s.name;
  }
  return '';
}

/// The packages on [containerId] in the live [lines].
List<ContainerLine> loadOnContainerLines(
  Iterable<ContainerLine> lines,
  String containerId,
) => [
  for (final l in lines)
    if (l.containerId == containerId) l,
];

/// Waiting packages of the business going where [container] goes: the ones
/// "Still to load" offers. Mirrors `destinationMismatch`, the rule the server
/// applies to a scan, so a tap is never refused for the destination.
List<ContainerLine> loadStillToLoadLines(
  Iterable<ContainerLine> lines,
  ShippingContainer container,
) => [
  for (final l in lines)
    if (l.isWaiting && destinationMismatch(l, container) == null) l,
];

/// Letters and digits only, lower case: "CL K7M4-P2", "cl-k7m4p2" and
/// "+1 (347) 555" compare by what they say, not how they are punctuated.
String _squash(String text) =>
    text.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

/// Whether [line] answers a search for [query] by code, name or phone - the
/// sender's or the receiver's. An empty query matches everything.
bool loadLineMatches(ContainerLine line, String query) {
  final wanted = _squash(query);
  if (wanted.isEmpty) return true;
  for (final field in [
    line.trackingCode,
    line.customerName,
    line.receiverName,
    line.customerPhone,
    line.receiverPhone,
  ]) {
    if (_squash(field).contains(wanted)) return true;
  }
  return false;
}

int _byCode(ContainerLine a, ContainerLine b) {
  final c = a.trackingCode.compareTo(b.trackingCode);
  return c != 0 ? c : a.id.compareTo(b.id);
}

/// Newest `containerAssignedAt` first; the ones without it ("added
/// earlier") go last, in code order.
List<ContainerLine> loadRecentlyAdded(Iterable<ContainerLine> lines) {
  final out = lines.toList();
  out.sort((a, b) {
    final x = a.containerAssignedAt, y = b.containerAssignedAt;
    if (x == null && y == null) return _byCode(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    final c = y.compareTo(x);
    return c != 0 ? c : _byCode(a, b);
  });
  return out;
}

/// Packages with no piece scanned onto the container yet
/// (`loadScannedPieces` 0 or absent), in [loadRecentlyAdded] order.
List<ContainerLine> loadNotScanned(Iterable<ContainerLine> lines) =>
    loadRecentlyAdded([
      for (final l in lines)
        if (l.loadScannedPieces <= 0) l,
    ]);

/// One customer's packages: their count, their pieces, and how many pieces
/// of them are scanned.
class LoadCustomerGroup {
  const LoadCustomerGroup({
    required this.key,
    required this.name,
    required this.phone,
    required this.lines,
  });

  /// What the packages share (the squashed name, else the squashed phone);
  /// '' for packages with neither.
  final String key;

  /// The customer's name (sender, else receiver - `lineCustomerName`); the
  /// phone when no name was given; '' when neither.
  final String name;
  final String phone;
  final List<ContainerLine> lines;

  int get packages => lines.length;
  int get pieces => lines.fold(0, (sum, l) => sum + l.pieceCount);
  int get scannedPieces => lines.fold(0, (sum, l) => sum + l.loadScannedPieces);
}

/// [lines] grouped by customer (sender, else receiver - `lineCustomer`),
/// groups in name order with the unnamed last, each group's packages in code
/// order. Two packages of one person group even if one spells the name in
/// different case or spacing.
List<LoadCustomerGroup> loadGroupByCustomer(Iterable<ContainerLine> lines) {
  final byKey = <String, List<ContainerLine>>{};
  final names = <String, String>{};
  final phones = <String, String>{};
  for (final l in lines) {
    final who = lineCustomer(l);
    final key = _squash(who.name).isNotEmpty
        ? _squash(who.name)
        : _squash(who.phone);
    byKey.putIfAbsent(key, () => []).add(l);
    if (who.name.isNotEmpty) names.putIfAbsent(key, () => who.name);
    if (who.phone.isNotEmpty) phones.putIfAbsent(key, () => who.phone);
  }
  final groups = [
    for (final e in byKey.entries)
      LoadCustomerGroup(
        key: e.key,
        name: names[e.key] ?? phones[e.key] ?? '',
        phone: phones[e.key] ?? '',
        lines: e.value..sort(_byCode),
      ),
  ];
  groups.sort((a, b) {
    if (a.key.isEmpty != b.key.isEmpty) return a.key.isEmpty ? 1 : -1;
    final c = a.name.toLowerCase().compareTo(b.name.toLowerCase());
    return c != 0 ? c : a.key.compareTo(b.key);
  });
  return groups;
}

/// One row of a list: a customer's header, or a package.
sealed class LoadListItem {
  const LoadListItem();
}

class LoadGroupItem extends LoadListItem {
  const LoadGroupItem(this.group);
  final LoadCustomerGroup group;
}

class LoadLineItem extends LoadListItem {
  const LoadLineItem(this.line);
  final ContainerLine line;
}

List<LoadListItem> _groupedItems(Iterable<ContainerLine> lines) => [
  for (final g in loadGroupByCustomer(lines)) ...[
    LoadGroupItem(g),
    for (final l in g.lines) LoadLineItem(l),
  ],
];

/// What "On this container" draws for [filter] and a search [query]: the
/// packages on the container narrowed by the search, then listed flat
/// (recently added, not scanned yet) or under their customers.
List<LoadListItem> loadOnContainerItems(
  Iterable<ContainerLine> onContainer,
  LoadListFilter filter,
  String query,
) {
  final found = [
    for (final l in onContainer)
      if (loadLineMatches(l, query)) l,
  ];
  return switch (filter) {
    LoadListFilter.recent => [
      for (final l in loadRecentlyAdded(found)) LoadLineItem(l),
    ],
    LoadListFilter.notScanned => [
      for (final l in loadNotScanned(found)) LoadLineItem(l),
    ],
    LoadListFilter.byCustomer => _groupedItems(found),
  };
}

/// What "Still to load" draws: the waiting packages narrowed by [query],
/// under their customers.
List<LoadListItem> loadStillToLoadItems(
  Iterable<ContainerLine> waiting,
  String query,
) => _groupedItems([
  for (final l in waiting)
    if (loadLineMatches(l, query)) l,
]);

/// Take off is offered only while the line's container is loading (a line
/// read with no status is taken to be loading - the screen itself only opens
/// on a loading container) and it has not been handed over.
bool loadCanTakeOff(ContainerLine line) =>
    (line.containerStatus.isEmpty ||
        line.containerStatus == containerStatusLoading) &&
    !line.isDelivered;

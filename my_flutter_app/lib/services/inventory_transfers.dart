/// Inventory store transfers (v5), app side: the transfer as the server
/// stores it, which list tab shows it, how a card reads, who may do what to
/// it, and the requests the screens send.
///
/// The contract is `docs/INVENTORY.md` ("Store transfers (v5)"). Stock moves
/// between the stores of one business in two steps: the source SENDS (the
/// pieces leave it and are in transit, sellable nowhere), the destination
/// CONFIRMS what arrived. What did not arrive goes to the owner, who returns
/// it to the source store or writes it off.
///
/// No Firebase here: every rule is unit-tested in
/// `test/inventory_transfers_test.dart`.
library;

import 'dart:math';

import '../utils/callable_data.dart';
import 'inventory.dart';
import 'inventory_stores.dart';
import 'lot_ledger.dart' show lotDateOf;

/// At most this many products in one transfer (`transfer_lines_too_many`).
const inventoryTransferMaxLines = 100;

/// The receive note and a write-off note: at most this many characters
/// (`note_too_long`).
const inventoryTransferMaxNote = 300;

/// A transfer `in_transit` this long or longer reads "In transit N days"
/// and is highlighted (the server's reminder starts at the same age).
const inventoryTransferLateDays = 2;

// ---------------------------------------------------------------------------
// The model, read from `inventoryTransfers/{id}`.
// ---------------------------------------------------------------------------

enum InventoryTransferStatus {
  draft,
  inTransit,
  received,
  receivedWithDifferences,
  cancelled,
}

InventoryTransferStatus _statusOf(String raw) => switch (raw) {
  'in_transit' => InventoryTransferStatus.inTransit,
  'received' => InventoryTransferStatus.received,
  'received_with_differences' =>
    InventoryTransferStatus.receivedWithDifferences,
  'cancelled' => InventoryTransferStatus.cancelled,
  _ => InventoryTransferStatus.draft,
};

/// What the lists query: `draft`, `in_transit`, `review` (received with
/// differences, a missing line not decided yet) and `done`.
enum InventoryTransferStage { draft, inTransit, review, done }

InventoryTransferStage _stageOf(
  String raw,
  InventoryTransferStatus status,
  int openMissing,
) => switch (raw) {
  'draft' => InventoryTransferStage.draft,
  'in_transit' => InventoryTransferStage.inTransit,
  'review' => InventoryTransferStage.review,
  'done' => InventoryTransferStage.done,
  // A document without a stage: read it from the status.
  _ => switch (status) {
    InventoryTransferStatus.draft => InventoryTransferStage.draft,
    InventoryTransferStatus.inTransit => InventoryTransferStage.inTransit,
    InventoryTransferStatus.receivedWithDifferences =>
      openMissing > 0
          ? InventoryTransferStage.review
          : InventoryTransferStage.done,
    _ => InventoryTransferStage.done,
  },
};

String _text(Object? value, [int max = 200]) {
  if (value == null) return '';
  final text = value.toString().trim();
  return text.length > max ? text.substring(0, max) : text;
}

int _count(Object? value) {
  final n = callableInt(value);
  return n < 0 ? 0 : n;
}

int? _optionalCount(Object? value) {
  if (value == null) return null;
  if (value is num || value is String) return _count(value);
  return null;
}

List<Map<String, dynamic>> _rows(Object? raw) => [
  if (raw is Iterable)
    for (final row in raw)
      if (row is Map) callableMap(row),
];

/// Why the pieces of a written-off line are gone.
const inventoryWriteOffReasons = ['lost', 'damaged', 'stolen', 'other'];

/// One product of a transfer.
class InventoryTransferLine {
  const InventoryTransferLine({
    required this.itemId,
    required this.quantitySent,
    this.name = '',
    this.brand = '',
    this.code = '',
    this.costCents,
    this.quantityReceived,
    this.missing = 0,
    this.resolution = '',
    this.writeOffReason = '',
    this.resolutionNote = '',
    this.resolvedByStaffId = '',
    this.resolvedByName = '',
    this.resolvedAt,
  });

  factory InventoryTransferLine.fromMap(Map<String, dynamic> data) =>
      InventoryTransferLine(
        itemId: _text(data['itemId'], 128),
        name: _text(data['name'], inventoryMaxName),
        brand: _text(data['brand'], inventoryMaxBrand),
        code: _text(data['code'], 20).toUpperCase(),
        costCents: data['costCents'] is num
            ? (data['costCents'] as num).round()
            : null,
        quantitySent: _count(data['quantitySent']),
        quantityReceived: _optionalCount(data['quantityReceived']),
        missing: _count(data['missing']),
        resolution: _text(data['resolution'], 20),
        writeOffReason: _text(data['writeOffReason'], 20),
        resolutionNote: _text(data['resolutionNote'], inventoryTransferMaxNote),
        resolvedByStaffId: _text(data['resolvedByStaffId'], 128),
        resolvedByName: _text(data['resolvedByName'], 120),
        resolvedAt: lotDateOf(data['resolvedAt']),
      );

  final String itemId;
  final String name;
  final String brand;
  final String code;
  final int? costCents;
  final int quantitySent;

  /// Null until the destination confirmed what arrived.
  final int? quantityReceived;

  /// Pieces that did not arrive (0 until received).
  final int missing;

  /// "" (not decided), `returned` or `written_off`.
  final String resolution;

  /// `lost` | `damaged` | `stolen` | `other` for a write-off.
  final String writeOffReason;
  final String resolutionNote;
  final String resolvedByStaffId;
  final String resolvedByName;
  final DateTime? resolvedAt;

  /// "Jordan 11" (brand in front), as everywhere else.
  String get displayName => inventoryDisplayName(brand, name);

  /// Missing pieces the owner has not decided on yet.
  bool get open => missing > 0 && resolution.isEmpty;
}

/// One entry of a transfer's track record, oldest first.
class InventoryTransferEvent {
  const InventoryTransferEvent({
    required this.event,
    this.byStaffId = '',
    this.byName = '',
    this.at,
    this.itemsCount = 0,
    this.receivedCount = 0,
    this.missingCount = 0,
    this.note = '',
    this.itemId = '',
    this.itemName = '',
    this.quantity = 0,
    this.reason = '',
  });

  factory InventoryTransferEvent.fromMap(Map<String, dynamic> data) =>
      InventoryTransferEvent(
        event: _text(data['event'], 40),
        byStaffId: _text(data['byStaffId'], 128),
        byName: _text(data['byName'], 120),
        at: lotDateOf(data['at']),
        itemsCount: _count(data['itemsCount']),
        receivedCount: _count(data['receivedCount']),
        missingCount: _count(data['missingCount']),
        note: _text(data['note'], inventoryTransferMaxNote),
        itemId: _text(data['itemId'], 128),
        itemName: _text(data['itemName'], inventoryMaxName + inventoryMaxBrand),
        quantity: _count(data['quantity']),
        reason: _text(data['reason'], 20),
      );

  /// `draft_created` | `sent` | `cancelled` | `draft_discarded` | `received`
  /// | `returned` | `written_off`.
  final String event;
  final String byStaffId;
  final String byName;
  final DateTime? at;
  final int itemsCount;
  final int receivedCount;
  final int missingCount;
  final String note;
  final String itemId;
  final String itemName;
  final int quantity;
  final String reason;
}

class InventoryTransfer {
  const InventoryTransfer({
    required this.id,
    this.businessId = '',
    this.clientRequestId = '',
    this.code = '',
    this.statusRaw = 'draft',
    this.status = InventoryTransferStatus.draft,
    this.stage = InventoryTransferStage.draft,
    this.fromStoreId = '',
    this.fromStoreName = '',
    this.toStoreId = '',
    this.toStoreName = '',
    this.lines = const [],
    this.productsCount = 0,
    this.itemsCount = 0,
    this.receivedCount,
    this.missingCount = 0,
    this.openMissingCount = 0,
    this.returnedCount = 0,
    this.writtenOffCount = 0,
    this.valueCents = 0,
    this.openMissingValueCents = 0,
    this.linesWithoutCost = 0,
    this.createdByStaffId = '',
    this.createdByName = '',
    this.createdAt,
    this.updatedAt,
    this.sentByStaffId = '',
    this.sentByName = '',
    this.sentAt,
    this.receivedByStaffId = '',
    this.receivedByName = '',
    this.receivedAt,
    this.receiveNote = '',
    this.cancelledByStaffId = '',
    this.cancelledByName = '',
    this.cancelledAt,
    this.settledAt,
    this.timeline = const [],
  });

  /// Reads a document; any field may be missing (a server mid-deploy, a
  /// draft), and times may be Timestamps, DateTimes or ISO strings.
  factory InventoryTransfer.fromMap(String id, Map<String, dynamic> data) {
    final statusRaw = _text(data['status'], 40);
    final status = _statusOf(statusRaw);
    final lines = [
      for (final row in _rows(data['lines']))
        InventoryTransferLine.fromMap(row),
    ];
    final openMissing = data.containsKey('openMissingCount')
        ? _count(data['openMissingCount'])
        : lines.fold<int>(0, (sum, l) => sum + (l.open ? l.missing : 0));
    final sent = lines.fold<int>(0, (sum, l) => sum + l.quantitySent);
    return InventoryTransfer(
      id: id,
      businessId: _text(data['businessId'], 128),
      clientRequestId: _text(data['clientRequestId'], 100),
      code: _text(data['code'], 20).toUpperCase(),
      statusRaw: statusRaw.isEmpty ? 'draft' : statusRaw,
      status: status,
      stage: _stageOf(_text(data['stage'], 20), status, openMissing),
      fromStoreId: _text(data['fromStoreId'], 128),
      fromStoreName: _text(data['fromStoreName'], inventoryMaxStoreName),
      toStoreId: _text(data['toStoreId'], 128),
      toStoreName: _text(data['toStoreName'], inventoryMaxStoreName),
      lines: lines,
      productsCount: data.containsKey('productsCount')
          ? _count(data['productsCount'])
          : lines.length,
      itemsCount: data.containsKey('itemsCount')
          ? _count(data['itemsCount'])
          : sent,
      receivedCount: _optionalCount(data['receivedCount']),
      missingCount: _count(data['missingCount']),
      openMissingCount: openMissing,
      returnedCount: _count(data['returnedCount']),
      writtenOffCount: _count(data['writtenOffCount']),
      valueCents: _count(data['valueCents']),
      openMissingValueCents: _count(data['openMissingValueCents']),
      linesWithoutCost: _count(data['linesWithoutCost']),
      createdByStaffId: _text(data['createdByStaffId'], 128),
      createdByName: _text(data['createdByName'], 120),
      createdAt: lotDateOf(data['createdAt']),
      updatedAt: lotDateOf(data['updatedAt']),
      sentByStaffId: _text(data['sentByStaffId'], 128),
      sentByName: _text(data['sentByName'], 120),
      sentAt: lotDateOf(data['sentAt']),
      receivedByStaffId: _text(data['receivedByStaffId'], 128),
      receivedByName: _text(data['receivedByName'], 120),
      receivedAt: lotDateOf(data['receivedAt']),
      receiveNote: _text(data['receiveNote'], inventoryTransferMaxNote),
      cancelledByStaffId: _text(data['cancelledByStaffId'], 128),
      cancelledByName: _text(data['cancelledByName'], 120),
      cancelledAt: lotDateOf(data['cancelledAt']),
      settledAt: lotDateOf(data['settledAt']),
      timeline: [
        for (final row in _rows(data['timeline']))
          InventoryTransferEvent.fromMap(row),
      ],
    );
  }

  final String id;
  final String businessId;
  final String clientRequestId;
  final String code;

  /// The status as stored (`transfer_not_in_transit` refusals echo it).
  final String statusRaw;
  final InventoryTransferStatus status;
  final InventoryTransferStage stage;
  final String fromStoreId;
  final String fromStoreName;
  final String toStoreId;
  final String toStoreName;
  final List<InventoryTransferLine> lines;
  final int productsCount;
  final int itemsCount;
  final int? receivedCount;
  final int missingCount;
  final int openMissingCount;
  final int returnedCount;
  final int writtenOffCount;
  final int valueCents;
  final int openMissingValueCents;
  final int linesWithoutCost;
  final String createdByStaffId;
  final String createdByName;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String sentByStaffId;
  final String sentByName;
  final DateTime? sentAt;
  final String receivedByStaffId;
  final String receivedByName;
  final DateTime? receivedAt;
  final String receiveNote;
  final String cancelledByStaffId;
  final String cancelledByName;
  final DateTime? cancelledAt;
  final DateTime? settledAt;
  final List<InventoryTransferEvent> timeline;

  bool get isDraft => status == InventoryTransferStatus.draft;
  bool get inTransit => status == InventoryTransferStatus.inTransit;
  bool get inReview => stage == InventoryTransferStage.review;

  /// Received, with or without differences.
  bool get isReceived =>
      status == InventoryTransferStatus.received ||
      status == InventoryTransferStatus.receivedWithDifferences;

  /// The pieces counted at the destination (the lines' sum when the field is
  /// missing).
  int get arrivedCount =>
      receivedCount ??
      lines.fold<int>(0, (sum, l) => sum + (l.quantityReceived ?? 0));

  /// When it was last moved forward, for "newest first".
  DateTime? get sortTime => updatedAt ?? sentAt ?? createdAt;

  /// A source/destination name: the store's current name when the store
  /// list has it, else the snapshot taken when it was saved.
  String fromName(InventoryStoreContext stores) {
    final current = stores.storeName(fromStoreId);
    return current.isNotEmpty ? current : fromStoreName;
  }

  String toName(InventoryStoreContext stores) {
    final current = stores.storeName(toStoreId);
    return current.isNotEmpty ? current : toStoreName;
  }

  InventoryTransferLine? line(String itemId) {
    for (final l in lines) {
      if (l.itemId == itemId) return l;
    }
    return null;
  }
}

/// Newest first by the latest time a transfer moved; no time sinks last.
int _newestFirst(InventoryTransfer a, InventoryTransfer b) {
  final x = a.sortTime, y = b.sortTime;
  if (x == null && y == null) return a.id.compareTo(b.id);
  if (x == null) return 1;
  if (y == null) return -1;
  final byTime = y.compareTo(x);
  return byTime != 0 ? byTime : a.id.compareTo(b.id);
}

// ---------------------------------------------------------------------------
// Who is looking, and what they may do (mirrors the callables).
// ---------------------------------------------------------------------------

/// The person holding the phone, as the transfer rules see them.
class InventoryTransferViewer {
  InventoryTransferViewer({required this.stores, this.userId = ''});

  final InventoryStoreContext stores;

  /// The signed-in uid ('' when unknown): "the sender" may cancel.
  final String userId;

  InventoryAccess get access => stores.access;

  /// The owner, a platform admin (who reads as an owner) or all-stores
  /// staff.
  bool get seesAllStores => access.seesAllStores;

  /// The store a one-store staff member works in ('' for someone who sees
  /// every store, or a staff member without a usable home store).
  String get homeStoreId => stores.homeStoreId;

  /// Staff of a business with several stores who were not given a store:
  /// they see no transfers and can do nothing (the rules refuse it all).
  bool get blocked => stores.homeStoreMissing;

  /// "May send from a store": the owner, a platform admin, all-stores staff,
  /// or staff whose home store it is.
  bool maySendFrom(String storeId) {
    if (storeId.isEmpty || blocked) return false;
    if (seesAllStores) return true;
    return homeStoreId.isNotEmpty && homeStoreId == storeId;
  }

  /// May start a new transfer at all (from their own store, or any).
  bool get canStartTransfer =>
      stores.multi && !blocked && (seesAllStores || homeStoreId.isNotEmpty);
}

/// A draft is sendable/editable by whoever may send from its source store.
bool canEditTransferDraft(InventoryTransfer t, InventoryTransferViewer v) =>
    t.isDraft && v.maySendFrom(t.fromStoreId);

/// Its creator, anyone who may send from its source store, the owner and
/// all-stores staff.
bool canDiscardTransferDraft(InventoryTransfer t, InventoryTransferViewer v) =>
    t.isDraft &&
    !v.blocked &&
    ((v.userId.isNotEmpty && t.createdByStaffId == v.userId) ||
        v.maySendFrom(t.fromStoreId) ||
        v.seesAllStores);

/// In transit: the sender, the owner, a platform admin or all-stores staff.
bool canCancelTransfer(InventoryTransfer t, InventoryTransferViewer v) =>
    t.inTransit &&
    !v.blocked &&
    (v.seesAllStores || (v.userId.isNotEmpty && t.sentByStaffId == v.userId));

/// In transit: the destination store's staff, the owner, a platform admin or
/// all-stores staff.
bool canReceiveTransfer(InventoryTransfer t, InventoryTransferViewer v) =>
    t.inTransit &&
    !v.blocked &&
    (v.seesAllStores ||
        (v.homeStoreId.isNotEmpty && v.homeStoreId == t.toStoreId));

/// In review: the owner, a platform admin or all-stores staff only.
bool canResolveTransfer(InventoryTransfer t, InventoryTransferViewer v) =>
    t.inReview && v.seesAllStores;

/// Whether [t] may be shown to this viewer at all - the reach of the lists
/// and the rules: this business; staff tied to one store see transfers from
/// or to it; staff without a store see none; a draft only to whoever may
/// send from its source store.
bool inventoryTransferVisible(
  InventoryTransfer t, {
  required String businessId,
  required InventoryTransferViewer viewer,
}) {
  if (businessId.isEmpty || t.businessId != businessId) return false;
  if (viewer.blocked) return false;
  if (t.isDraft && !viewer.maySendFrom(t.fromStoreId)) return false;
  if (viewer.seesAllStores) return true;
  final home = viewer.homeStoreId;
  return home.isNotEmpty && (t.fromStoreId == home || t.toStoreId == home);
}

/// Which screen a push tap opens on a transfer.
enum InventoryTransferTarget { receive, review, detail }

/// The receive screen for its destination's staff while in transit, the
/// review for the owner (and all-stores staff) while in review, else its
/// detail.
InventoryTransferTarget inventoryTransferOpenTarget(
  InventoryTransfer t,
  InventoryTransferViewer viewer,
) {
  if (canReceiveTransfer(t, viewer)) return InventoryTransferTarget.receive;
  if (canResolveTransfer(t, viewer)) return InventoryTransferTarget.review;
  return InventoryTransferTarget.detail;
}

// ---------------------------------------------------------------------------
// The list: four tabs and their counts.
// ---------------------------------------------------------------------------

enum InventoryTransferTab { outgoing, incoming, inTransit, review }

/// What the lists show of [transfers] (deduplicated by the caller), for a
/// viewer looking at one store [storeId] (a one-store staff member's home,
/// or the store an all-stores viewer picked) or at every store ('').
///
/// One store S: Outgoing = from S (drafts first, then in transit, then the
/// rest, newest first); Incoming = to S, not drafts (in transit first); In
/// transit = from or to S, in transit; Review = from or to S, in review.
/// Every store: Outgoing = everything, Incoming and In transit = everything
/// in transit, Review = everything in review.
class InventoryTransferLists {
  InventoryTransferLists._(this.tabs, this.counts);

  factory InventoryTransferLists.of(
    Iterable<InventoryTransfer> transfers, {
    required InventoryTransferViewer viewer,
    required String businessId,
    String storeId = '',
  }) {
    final store = viewer.seesAllStores ? storeId : viewer.homeStoreId;
    final shown = [
      for (final t in transfers)
        if (inventoryTransferVisible(t, businessId: businessId, viewer: viewer))
          t,
    ];
    bool at(InventoryTransfer t) =>
        store.isEmpty || t.fromStoreId == store || t.toStoreId == store;
    final outgoing = [
      for (final t in shown)
        if (store.isEmpty || t.fromStoreId == store) t,
    ]..sort(_outgoingOrder);
    final incoming = store.isEmpty
        ? [
            for (final t in shown)
              if (t.inTransit) t,
          ]
        : [
            for (final t in shown)
              if (t.toStoreId == store && !t.isDraft) t,
          ];
    incoming.sort(_incomingOrder);
    final inTransit = [
      for (final t in shown)
        if (t.inTransit && at(t)) t,
    ]..sort(_newestFirst);
    final review = [
      for (final t in shown)
        if (t.inReview && at(t)) t,
    ]..sort(_newestFirst);
    int moving(List<InventoryTransfer> list) =>
        list.where((t) => t.inTransit).length;
    return InventoryTransferLists._(
      {
        InventoryTransferTab.outgoing: outgoing,
        InventoryTransferTab.incoming: incoming,
        InventoryTransferTab.inTransit: inTransit,
        InventoryTransferTab.review: review,
      },
      {
        // A tab's count is what is still on its way (Review: what waits for
        // a decision), not everything it lists.
        InventoryTransferTab.outgoing: moving(outgoing),
        InventoryTransferTab.incoming: moving(incoming),
        InventoryTransferTab.inTransit: inTransit.length,
        InventoryTransferTab.review: review.length,
      },
    );
  }

  final Map<InventoryTransferTab, List<InventoryTransfer>> tabs;
  final Map<InventoryTransferTab, int> counts;

  List<InventoryTransfer> of(InventoryTransferTab tab) => tabs[tab]!;
  int count(InventoryTransferTab tab) => counts[tab]!;
}

int _rankOutgoing(InventoryTransfer t) => switch (t.stage) {
  InventoryTransferStage.draft => 0,
  InventoryTransferStage.inTransit => 1,
  _ => 2,
};

int _outgoingOrder(InventoryTransfer a, InventoryTransfer b) {
  final rank = _rankOutgoing(a).compareTo(_rankOutgoing(b));
  return rank != 0 ? rank : _newestFirst(a, b);
}

int _incomingOrder(InventoryTransfer a, InventoryTransfer b) {
  final rank = (a.inTransit ? 0 : 1).compareTo(b.inTransit ? 0 : 1);
  return rank != 0 ? rank : _newestFirst(a, b);
}

/// The entry tile's two numbers ("Transfers": Incoming and Review), from the
/// open transfers only.
({int incoming, int review}) inventoryTransferEntryCounts(
  Iterable<InventoryTransfer> open, {
  required InventoryTransferViewer viewer,
  required String businessId,
}) {
  final lists = InventoryTransferLists.of(
    open,
    viewer: viewer,
    businessId: businessId,
  );
  return (
    incoming: lists.count(InventoryTransferTab.incoming),
    review: lists.count(InventoryTransferTab.review),
  );
}

// ---------------------------------------------------------------------------
// How a card and a line read (inputs for the localized text).
// ---------------------------------------------------------------------------

enum InventoryTransferCardState {
  draft,
  inTransit,

  /// In transit [inventoryTransferLateDays] days or more: highlighted.
  late,
  review,
  received,

  /// Received with differences, every missing line decided.
  settled,
  cancelled,
}

/// Whole days a transfer has been on its way (by the clock, from `sentAt`);
/// null when it is not in transit or has no send time.
int? inventoryTransferTransitDays(InventoryTransfer t, DateTime now) {
  final sent = t.sentAt;
  if (!t.inTransit || sent == null) return null;
  final hours = now.difference(sent).inHours;
  return hours <= 0 ? 0 : hours ~/ 24;
}

InventoryTransferCardState inventoryTransferCardState(
  InventoryTransfer t,
  DateTime now,
) {
  switch (t.status) {
    case InventoryTransferStatus.draft:
      return InventoryTransferCardState.draft;
    case InventoryTransferStatus.inTransit:
      final days = inventoryTransferTransitDays(t, now) ?? 0;
      return days >= inventoryTransferLateDays
          ? InventoryTransferCardState.late
          : InventoryTransferCardState.inTransit;
    case InventoryTransferStatus.cancelled:
      return InventoryTransferCardState.cancelled;
    case InventoryTransferStatus.received:
      return InventoryTransferCardState.received;
    case InventoryTransferStatus.receivedWithDifferences:
      return t.inReview
          ? InventoryTransferCardState.review
          : InventoryTransferCardState.settled;
  }
}

enum InventoryTransferLineResultKind {
  /// Not received yet.
  pending,
  complete,
  disputed,
  returned,
  writtenOff,
}

/// "Complete", "2 missing · disputed", "2 returned to Bronx store", "2
/// written off · Lost in transit".
({InventoryTransferLineResultKind kind, int quantity, String reason})
inventoryTransferLineResult(InventoryTransferLine line) {
  if (line.quantityReceived == null) {
    return (
      kind: InventoryTransferLineResultKind.pending,
      quantity: 0,
      reason: '',
    );
  }
  if (line.missing <= 0) {
    return (
      kind: InventoryTransferLineResultKind.complete,
      quantity: 0,
      reason: '',
    );
  }
  return switch (line.resolution) {
    'returned' => (
      kind: InventoryTransferLineResultKind.returned,
      quantity: line.missing,
      reason: '',
    ),
    'written_off' => (
      kind: InventoryTransferLineResultKind.writtenOff,
      quantity: line.missing,
      reason: line.writeOffReason,
    ),
    _ => (
      kind: InventoryTransferLineResultKind.disputed,
      quantity: line.missing,
      reason: '',
    ),
  };
}

// ---------------------------------------------------------------------------
// Composing a transfer (New transfer, Continue a draft).
// ---------------------------------------------------------------------------

/// A fresh retry key for one transfer being composed (`clientRequestId`,
/// 8..100 of `[A-Za-z0-9_.:-]`). A draft reopened from the list sends its
/// own key back, so saving again updates the same draft.
String newInventoryTransferRequestId([Random? random, DateTime? now]) {
  final rng = random ?? Random.secure();
  final bytes = [for (var i = 0; i < 12; i++) rng.nextInt(256)];
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  final ms = (now ?? DateTime.now()).millisecondsSinceEpoch;
  return 'transfer-${ms.toRadixString(36)}-$hex';
}

/// One product being sent, as the composer holds it.
class InventoryTransferDraftLine {
  const InventoryTransferDraftLine({
    required this.itemId,
    required this.quantity,
    this.name = '',
    this.code = '',
  });

  final String itemId;

  /// What the product is called on screen ("Jordan 11").
  final String name;
  final String code;
  final int quantity;

  InventoryTransferDraftLine withQuantity(int quantity) =>
      InventoryTransferDraftLine(
        itemId: itemId,
        name: name,
        code: code,
        quantity: quantity,
      );
}

/// The New transfer screen's content: from, to, the products. Immutable;
/// every change answers a new composer.
class InventoryTransferComposer {
  const InventoryTransferComposer({
    required this.clientRequestId,
    this.fromStoreId = '',
    this.toStoreId = '',
    this.lines = const [],
  });

  /// A draft reopened from the list: its key, stores and lines (a product
  /// that appears twice is merged).
  factory InventoryTransferComposer.fromDraft(InventoryTransfer draft) {
    var composer = InventoryTransferComposer(
      clientRequestId: draft.clientRequestId,
      fromStoreId: draft.fromStoreId,
      toStoreId: draft.toStoreId,
    );
    for (final line in draft.lines) {
      composer = composer._merge(
        InventoryTransferDraftLine(
          itemId: line.itemId,
          name: line.displayName,
          code: line.code,
          quantity: line.quantitySent,
        ),
      );
    }
    return composer;
  }

  final String clientRequestId;
  final String fromStoreId;
  final String toStoreId;
  final List<InventoryTransferDraftLine> lines;

  InventoryTransferComposer _copy({
    String? fromStoreId,
    String? toStoreId,
    List<InventoryTransferDraftLine>? lines,
  }) => InventoryTransferComposer(
    clientRequestId: clientRequestId,
    fromStoreId: fromStoreId ?? this.fromStoreId,
    toStoreId: toStoreId ?? this.toStoreId,
    lines: lines ?? this.lines,
  );

  InventoryTransferComposer _merge(InventoryTransferDraftLine line) {
    final index = lines.indexWhere((l) => l.itemId == line.itemId);
    if (index < 0) return _copy(lines: [...lines, line]);
    final merged = [...lines];
    merged[index] = merged[index].withQuantity(
      merged[index].quantity + line.quantity,
    );
    return _copy(lines: merged);
  }

  /// A new source store; a destination equal to it is cleared.
  InventoryTransferComposer withFrom(String storeId) => _copy(
    fromStoreId: storeId,
    toStoreId: toStoreId == storeId ? '' : toStoreId,
  );

  InventoryTransferComposer withTo(String storeId) =>
      _copy(toStoreId: storeId == fromStoreId ? '' : storeId);

  /// Adds one piece of [item] (a second add of the same product adds to its
  /// line), never past [max] - what the source store holds.
  InventoryTransferComposer add(InventoryItem item, {required int max}) {
    final current = quantityOf(item.id);
    if (current >= max) {
      // Already all of them (or the store has none): nothing to add, but a
      // product the store holds none of is still not listed.
      return this;
    }
    if (current == 0 && lines.length >= inventoryTransferMaxLines) return this;
    return _merge(
      InventoryTransferDraftLine(
        itemId: item.id,
        name: item.displayName,
        code: item.code,
        quantity: 1,
      ),
    );
  }

  /// The stepper: from 1 up to [max] (a line is removed with [remove]).
  InventoryTransferComposer setQuantity(
    String itemId,
    int quantity, {
    required int max,
  }) {
    final index = lines.indexWhere((l) => l.itemId == itemId);
    if (index < 0) return this;
    final ceiling = max < 1 ? 1 : max;
    final next = quantity < 1 ? 1 : (quantity > ceiling ? ceiling : quantity);
    final updated = [...lines];
    updated[index] = updated[index].withQuantity(next);
    return _copy(lines: updated);
  }

  InventoryTransferComposer remove(String itemId) => _copy(
    lines: [
      for (final l in lines)
        if (l.itemId != itemId) l,
    ],
  );

  int quantityOf(String itemId) {
    for (final l in lines) {
      if (l.itemId == itemId) return l.quantity;
    }
    return 0;
  }

  int get productsCount => lines.length;
  int get itemsCount => lines.fold<int>(0, (sum, l) => sum + l.quantity);

  /// What stops Save draft / Send, as codes: `store_required` (no
  /// destination), `same_store`, `transfer_lines_required`,
  /// `transfer_lines_too_many`, `quantity_invalid`; for Send also
  /// `insufficient_stock` (a line above what the source holds by [maxOf]).
  List<String> problems({
    required bool sending,
    int Function(String itemId)? maxOf,
  }) {
    final codes = <String>[];
    if (fromStoreId.isEmpty || toStoreId.isEmpty) {
      codes.add('store_required');
    } else if (fromStoreId == toStoreId) {
      codes.add('same_store');
    }
    if (lines.isEmpty) codes.add('transfer_lines_required');
    if (lines.length > inventoryTransferMaxLines) {
      codes.add('transfer_lines_too_many');
    }
    if (lines.any((l) => l.quantity < 1 || l.quantity > inventoryMaxStock)) {
      codes.add('quantity_invalid');
    }
    if (sending &&
        maxOf != null &&
        lines.any((l) => l.quantity > maxOf(l.itemId))) {
      codes.add('insufficient_stock');
    }
    return codes;
  }

  /// `saveInventoryTransferDraft` / `sendInventoryTransfer` take the same
  /// request: the key, both stores and one line per product.
  Map<String, Object?> request(String businessId) => {
    'businessId': businessId,
    'clientRequestId': clientRequestId,
    'fromStoreId': fromStoreId,
    'toStoreId': toStoreId,
    'lines': [
      for (final l in lines) {'itemId': l.itemId, 'quantity': l.quantity},
    ],
  };
}

/// How many of [item] the source store [storeId] holds: its count row, or -
/// for a product not yet counted per store - the whole count at the Main
/// store. This is the most a line may send.
int inventoryTransferMaxFor(
  InventoryItem item,
  InventoryStoreContext stores,
  InventoryStockIndex stock,
  String storeId,
) {
  if (storeId.isEmpty) return 0;
  return stores.countAt(item, stock, storeId)?.quantity ?? 0;
}

// ---------------------------------------------------------------------------
// Receiving.
// ---------------------------------------------------------------------------

/// What the receive screen starts with: every line as sent.
Map<String, int> inventoryTransferReceivePrefill(InventoryTransfer t) => {
  for (final l in t.lines) l.itemId: l.quantitySent,
};

/// The counted pieces (each line clamped to 0..sent).
int inventoryTransferCounted(InventoryTransfer t, Map<String, int> counted) {
  var sum = 0;
  for (final l in t.lines) {
    final n = counted[l.itemId] ?? l.quantitySent;
    sum += n < 0 ? 0 : (n > l.quantitySent ? l.quantitySent : n);
  }
  return sum;
}

/// Pieces sent but not counted.
int inventoryTransferMissing(InventoryTransfer t, Map<String, int> counted) {
  final sent = t.lines.fold<int>(0, (sum, l) => sum + l.quantitySent);
  final missing = sent - inventoryTransferCounted(t, counted);
  return missing < 0 ? 0 : missing;
}

/// The lines that came up short: (line, counted).
List<({InventoryTransferLine line, int counted})> inventoryTransferShortLines(
  InventoryTransfer t,
  Map<String, int> counted,
) => [
  for (final l in t.lines)
    if ((counted[l.itemId] ?? l.quantitySent) < l.quantitySent)
      (line: l, counted: counted[l.itemId]! < 0 ? 0 : counted[l.itemId]!),
];

Map<String, Object?> receiveInventoryTransferRequest({
  required String businessId,
  required InventoryTransfer transfer,
  required Map<String, int> counted,
  required String requestId,
  String note = '',
}) {
  final text = note.trim();
  return {
    'businessId': businessId,
    'transferId': transfer.id,
    'lines': [
      for (final l in transfer.lines)
        {
          'itemId': l.itemId,
          'quantityReceived': () {
            final n = counted[l.itemId] ?? l.quantitySent;
            return n < 0 ? 0 : (n > l.quantitySent ? l.quantitySent : n);
          }(),
        },
    ],
    if (text.isNotEmpty)
      'note': text.length > inventoryTransferMaxNote
          ? text.substring(0, inventoryTransferMaxNote)
          : text,
    'requestId': requestId,
  };
}

Map<String, Object?> cancelInventoryTransferRequest({
  required String businessId,
  required String transferId,
  required String requestId,
}) => {
  'businessId': businessId,
  'transferId': transferId,
  'requestId': requestId,
};

/// `return` (the missing pieces go back to the source) or `write_off` with a
/// reason from [inventoryWriteOffReasons] and an optional note.
Map<String, Object?> resolveInventoryTransferLineRequest({
  required String businessId,
  required String transferId,
  required String itemId,
  required bool writeOff,
  required String requestId,
  String reason = '',
  String note = '',
}) {
  final text = note.trim();
  return {
    'businessId': businessId,
    'transferId': transferId,
    'itemId': itemId,
    'action': writeOff ? 'write_off' : 'return',
    if (writeOff) 'reason': reason,
    if (text.isNotEmpty)
      'note': text.length > inventoryTransferMaxNote
          ? text.substring(0, inventoryTransferMaxNote)
          : text,
    'requestId': requestId,
  };
}

// ---------------------------------------------------------------------------
// Answers.
// ---------------------------------------------------------------------------

/// `sendInventoryTransfer`'s answer (and the draft save's, without counts).
class InventoryTransferSendResult {
  const InventoryTransferSendResult({
    required this.transferId,
    this.code = '',
    this.status = '',
    this.itemsCount = 0,
    this.productsCount = 0,
    this.replayed = false,
  });

  factory InventoryTransferSendResult.fromCallable(Object? data) {
    final map = callableMap(data);
    return InventoryTransferSendResult(
      transferId: _text(map['transferId'], 128),
      code: _text(map['code'], 20).toUpperCase(),
      status: _text(map['status'], 40),
      itemsCount: _count(map['itemsCount']),
      productsCount: _count(map['productsCount']),
      replayed: map['replayed'] == true,
    );
  }

  final String transferId;
  final String code;
  final String status;
  final int itemsCount;
  final int productsCount;
  final bool replayed;
}

/// `receiveInventoryTransfer`'s answer.
class InventoryTransferReceiveResult {
  const InventoryTransferReceiveResult({
    this.status = '',
    this.receivedCount = 0,
    this.missingCount = 0,
    this.replayed = false,
  });

  factory InventoryTransferReceiveResult.fromCallable(Object? data) {
    final map = callableMap(data);
    return InventoryTransferReceiveResult(
      status: _text(map['status'], 40),
      receivedCount: _count(map['receivedCount']),
      missingCount: _count(map['missingCount']),
      replayed: map['replayed'] == true,
    );
  }

  final String status;
  final int receivedCount;
  final int missingCount;
  final bool replayed;
}

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

/// A `transfer_not_in_transit` refusal says what the transfer became, so
/// "Someone already received it" and "It was cancelled" read differently from
/// a generic refusal. Reads `details.status`.
enum InventoryTransferGone { received, cancelled, other }

InventoryTransferGone? inventoryTransferGoneOf(Object? details) {
  if (details is! Map) return null;
  final reason = _text(details['reason'], 60);
  final all = details['reasons'];
  final named =
      reason == 'transfer_not_in_transit' ||
      (all is Iterable && all.contains('transfer_not_in_transit'));
  if (!named) return null;
  final status = _text(details['status'], 40);
  if (status.startsWith('received')) return InventoryTransferGone.received;
  if (status == 'cancelled') return InventoryTransferGone.cancelled;
  return InventoryTransferGone.other;
}

/// `insufficient_stock` carries `details.available` {itemId: count}: what the
/// source store really holds now, so the lines can say so.
Map<String, int> inventoryTransferAvailableOf(Object? details) {
  if (details is! Map) return const {};
  final raw = details['available'];
  if (raw is! Map) return const {};
  return {
    for (final entry in raw.entries) entry.key.toString(): _count(entry.value),
  };
}

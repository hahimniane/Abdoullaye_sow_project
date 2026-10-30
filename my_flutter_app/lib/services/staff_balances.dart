import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../utils/callable_data.dart'
    show callableInt, callableMap, callableString;
import 'business_account_receiver.dart';
import 'lot_ledger.dart' show lotDateOf;
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// Staff balances (docs/STAFF_BALANCES.md): who holds the business's money,
/// who owes it and who is owed, and the two-step handovers that move cash
/// between people. The numbers are worked out on the server
/// (`updateLotExpenseEntry` `staff_balances`); this file reads the answer,
/// sends the actions, and decides who may do what to a handover.

/// How a handover was given (§2).
const staffHandoverMethods = ['cash', 'zelle', 'check', 'deposit', 'other'];

/// The refusals the handover actions can send (§3), as `details.reason`.
const staffBalancesRefusals = {
  'handover_to_self',
  'handover_amount_invalid',
  'handover_method_invalid',
  'handover_receiver_invalid',
  'handover_not_receiver',
  'handover_not_pending',
  'opening_owner_only',
};

/// Where the pending list is allowed to wait before the screen gives up and
/// shows "could not load" - loading always resolves.
const staffBalancesTimeout = Duration(seconds: 25);

String _text(Object? v, [int max = 500]) {
  final t = (v ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

int _cents(Object? v) => callableInt(v);

/// A moment the answer may carry as epoch milliseconds, an ISO string, a
/// Firestore timestamp or the `{_seconds}` shape callables serialize.
DateTime? _moment(Object? v) {
  if (v is Map) {
    final m = callableMap(v);
    final seconds = m['_seconds'] ?? m['seconds'];
    if (seconds is num) {
      return DateTime.fromMillisecondsSinceEpoch(seconds.toInt() * 1000);
    }
    return null;
  }
  return lotDateOf(v);
}

/// One person's line on the Staff balances page (§3 `staff_balances.staff`).
class StaffBalanceRow {
  const StaffBalanceRow({
    required this.staffId,
    required this.name,
    this.collectedCents = 0,
    this.collectedByMethod = const {},
    this.handedOutCents = 0,
    this.receivedFromOthersCents = 0,
    this.pendingOutCents = 0,
    this.pendingInCents = 0,
    this.heldCents = 0,
    this.parkingDueCents = 0,
    this.expenseCreditCents = 0,
    this.expenseOwedToThemCents = 0,
    this.netCents = 0,
  });

  factory StaffBalanceRow.fromMap(Map<String, dynamic> d) {
    final byMethod = callableMap(d['collectedByMethod']);
    return StaffBalanceRow(
      staffId: _text(d['staffId'], 128),
      name: _text(d['name'], 200),
      collectedCents: _cents(d['collectedCents']),
      collectedByMethod: {
        for (final e in byMethod.entries)
          if (_cents(e.value) != 0) e.key: _cents(e.value),
      },
      handedOutCents: _cents(d['handedOutCents']),
      receivedFromOthersCents: _cents(d['receivedFromOthersCents']),
      pendingOutCents: _cents(d['pendingOutCents']),
      pendingInCents: _cents(d['pendingInCents']),
      heldCents: _cents(d['heldCents']),
      parkingDueCents: _cents(d['parkingDueCents']),
      expenseCreditCents: _cents(d['expenseCreditCents']),
      expenseOwedToThemCents: _cents(d['expenseOwedToThemCents']),
      netCents: _cents(d['netCents']),
    );
  }

  final String staffId;
  final String name;

  /// Customer payments they were named as receiving (not the business
  /// account), and how.
  final int collectedCents;
  final Map<String, int> collectedByMethod;
  final int handedOutCents;
  final int receivedFromOthersCents;

  /// Handed over / coming in, waiting for a confirmation. Does not change
  /// [heldCents] until confirmed.
  final int pendingOutCents;
  final int pendingInCents;

  /// What they hold: collected - confirmed out + confirmed in.
  final int heldCents;

  /// Their own parking bill, after the expenses taken off it.
  final int parkingDueCents;

  /// Expenses taken off the parking bill.
  final int expenseCreditCents;

  /// Expenses the business still owes them, past their parking bill.
  final int expenseOwedToThemCents;

  /// Positive: owes the business. Negative: the business owes them.
  final int netCents;
}

/// The business account's line: what reached it, and what is on the way.
class BusinessAccountRow {
  const BusinessAccountRow({this.receivedCents = 0, this.pendingInCents = 0});

  factory BusinessAccountRow.fromMap(Map<String, dynamic> d) =>
      BusinessAccountRow(
        receivedCents: _cents(d['receivedCents']),
        pendingInCents: _cents(d['pendingInCents']),
      );

  final int receivedCents;
  final int pendingInCents;
}

/// One row of `staffHandovers` (§2), or a pending row in the answer.
class StaffHandover {
  const StaffHandover({
    required this.id,
    required this.kind,
    required this.fromStaffId,
    required this.toId,
    required this.amountCents,
    required this.method,
    required this.status,
    this.note = '',
    this.proofPath = '',
    this.createdByUid = '',
    this.createdAt,
    this.confirmedAt,
    this.declinedAt,
    this.declineNote = '',
    this.voidedAt,
    this.voidReason = '',
  });

  factory StaffHandover.fromMap(String id, Map<String, dynamic> d) =>
      StaffHandover(
        id: id.isNotEmpty ? id : _text(d['id'] ?? d['handoverId'], 128),
        kind: _text(d['kind'], 20) == 'opening' ? 'opening' : 'handover',
        fromStaffId: _text(d['fromStaffId'], 128),
        toId: _text(d['toId'], 128),
        amountCents: _cents(d['amountCents']),
        method: _text(d['method'], 40),
        status: _text(d['status'], 20).isEmpty
            ? 'pending'
            : _text(d['status'], 20),
        note: _text(d['note']),
        proofPath: _text(d['proofPath'], 400),
        createdByUid: _text(d['createdByUid'], 128),
        createdAt: _moment(d['createdAt']),
        confirmedAt: _moment(d['confirmedAt']),
        declinedAt: _moment(d['declinedAt']),
        declineNote: _text(d['declineNote']),
        voidedAt: _moment(d['voidedAt']),
        voidReason: _text(d['voidReason']),
      );

  final String id;

  /// `handover` or `opening`.
  final String kind;
  final String fromStaffId;

  /// A staff uid, or [businessAccountReceiver].
  final String toId;
  final int amountCents;
  final String method;

  /// `pending`, `confirmed`, `declined` or `voided`.
  final String status;
  final String note;
  final String proofPath;
  final String createdByUid;
  final DateTime? createdAt;
  final DateTime? confirmedAt;
  final DateTime? declinedAt;
  final String declineNote;
  final DateTime? voidedAt;
  final String voidReason;

  bool get pending => status == 'pending';
  bool get isOpening => kind == 'opening';
  bool get toBusinessAccount => isBusinessAccountReceiver(toId);

  /// When it last changed state, for ordering a history.
  DateTime? get when => voidedAt ?? declinedAt ?? confirmedAt ?? createdAt;
}

/// `staff_balances` (§3).
class StaffBalancesSnapshot {
  const StaffBalancesSnapshot({
    required this.asOf,
    required this.staff,
    required this.businessAccount,
    required this.pending,
  });

  factory StaffBalancesSnapshot.fromCallable(Object? data) {
    final d = callableMap(data);
    final staff = d['staff'];
    final pending = d['pending'];
    return StaffBalancesSnapshot(
      asOf: _moment(d['asOfMs']),
      staff: [
        if (staff is List)
          for (final r in staff)
            if (r is Map) StaffBalanceRow.fromMap(callableMap(r)),
      ],
      businessAccount: BusinessAccountRow.fromMap(
        callableMap(d['businessAccount']),
      ),
      pending: [
        if (pending is List)
          for (final r in pending)
            if (r is Map) StaffHandover.fromMap('', callableMap(r)),
      ],
    );
  }

  final DateTime? asOf;
  final List<StaffBalanceRow> staff;
  final BusinessAccountRow businessAccount;
  final List<StaffHandover> pending;

  /// A name for a staff id or the business account's id; '' when unknown.
  String nameOf(String id) {
    for (final s in staff) {
      if (s.staffId == id) return s.name;
    }
    return '';
  }
}

// ---------------------------------------------------------------------------
// Who may do what to a handover (§1.2, §3). The server decides; the phone only
// decides which buttons to show.
// ---------------------------------------------------------------------------

/// The viewer may confirm or decline: it is pending and addressed to them, or
/// to the business account and they are the owner or a platform admin.
bool canConfirmHandover(
  StaffHandover h, {
  required String uid,
  required bool isOwner,
}) =>
    h.pending &&
    uid.isNotEmpty &&
    (h.toId == uid || (h.toBusinessAccount && isOwner));

/// The viewer may void: the giver while it is pending, or the owner/admin.
bool canVoidHandover(
  StaffHandover h, {
  required String uid,
  required bool isOwner,
}) =>
    h.pending &&
    uid.isNotEmpty &&
    (isOwner || h.fromStaffId == uid || h.createdByUid == uid);

/// The handovers that wait on the viewer's confirmation, oldest first.
List<StaffHandover> handoversWaitingOn(
  Iterable<StaffHandover> all, {
  required String uid,
  required bool isOwner,
}) {
  final out = [
    for (final h in all)
      if (canConfirmHandover(h, uid: uid, isOwner: isOwner)) h,
  ]..sort(compareHandoverOldestFirst);
  return out;
}

int compareHandoverOldestFirst(StaffHandover a, StaffHandover b) {
  final x = a.createdAt?.millisecondsSinceEpoch ?? 0;
  final y = b.createdAt?.millisecondsSinceEpoch ?? 0;
  return x.compareTo(y);
}

int compareHandoverNewestFirst(StaffHandover a, StaffHandover b) {
  final x = a.when?.millisecondsSinceEpoch ?? 0;
  final y = b.when?.millisecondsSinceEpoch ?? 0;
  return y.compareTo(x);
}

/// The handovers a person gave or got, newest first.
List<StaffHandover> handoversOf(Iterable<StaffHandover> all, String staffId) =>
    [
      for (final h in all)
        if (h.fromStaffId == staffId || h.toId == staffId) h,
    ]..sort(compareHandoverNewestFirst);

/// Whether a net is owed by the person (> 0), to the person (< 0) or neither.
enum StaffNetKind { owes, isOwed, settled }

StaffNetKind staffNetKind(int netCents) => netCents > 0
    ? StaffNetKind.owes
    : netCents < 0
    ? StaffNetKind.isOwed
    : StaffNetKind.settled;

// ---------------------------------------------------------------------------
// The service.
// ---------------------------------------------------------------------------

class StaffBalancesFailure implements Exception {
  const StaffBalancesFailure({required this.code, this.reason = ''});

  /// The Functions code (`failed-precondition`, `unavailable`...).
  final String code;

  /// One of [staffBalancesRefusals] when the server named it; else ''.
  final String reason;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  @override
  String toString() => 'StaffBalancesFailure($code $reason)';
}

/// The refusal reason: `details.reason`, else a known code the message is.
StaffBalancesFailure parseStaffBalancesFailure(
  String code,
  Object? details, [
  String? message,
]) {
  var reason = callableString(callableMap(details)['reason']);
  if (reason.isEmpty) {
    final m = (message ?? '').trim();
    if (staffBalancesRefusals.contains(m)) reason = m;
  }
  return StaffBalancesFailure(code: code.trim().toLowerCase(), reason: reason);
}

/// The Staff balances actions on `updateLotExpenseEntry` (no new export),
/// through the caller the other sheets use, so widget tests hand in a fake.
class StaffBalancesService {
  const StaffBalancesService({
    this.caller = callContainerCallable,
    this.timeout = staffBalancesTimeout,
  });

  static const callable = 'updateLotExpenseEntry';

  final ContainerCallableCaller caller;
  final Duration timeout;

  Future<Object?> _call(Map<String, Object?> payload) async {
    try {
      return await caller(callable, payload).timeout(timeout);
    } on FirebaseFunctionsException catch (error) {
      throw parseStaffBalancesFailure(error.code, error.details, error.message);
    } on StaffBalancesFailure {
      rethrow;
    } on TimeoutException {
      throw const StaffBalancesFailure(code: 'unavailable');
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw StaffBalancesFailure(code: offline ? 'unavailable' : 'unknown');
    }
  }

  /// `staff_balances`: everyone's numbers and the pending handovers.
  Future<StaffBalancesSnapshot> load(String businessId) async =>
      StaffBalancesSnapshot.fromCallable(
        await _call({'action': 'staff_balances', 'businessId': businessId}),
      );

  /// `record_handover`: the caller hands [amountCents] to [toId] (a staff uid
  /// or [businessAccountReceiver]). Pending until the receiver confirms.
  Future<void> recordHandover({
    required String businessId,
    required String toId,
    required int amountCents,
    required String method,
    String note = '',
    String proofPath = '',
  }) async {
    await _call({
      'action': 'record_handover',
      'businessId': businessId,
      'toId': toId,
      'amountCents': amountCents,
      'method': method,
      if (note.trim().isNotEmpty) 'note': note.trim(),
      if (proofPath.trim().isNotEmpty) 'proofPath': proofPath.trim(),
    });
  }

  Future<void> confirm(String businessId, String handoverId) async {
    await _call({
      'action': 'confirm_handover',
      'businessId': businessId,
      'handoverId': handoverId,
    });
  }

  Future<void> decline(
    String businessId,
    String handoverId, {
    String note = '',
  }) async {
    await _call({
      'action': 'decline_handover',
      'businessId': businessId,
      'handoverId': handoverId,
      if (note.trim().isNotEmpty) 'note': note.trim(),
    });
  }

  Future<void> voidHandover(
    String businessId,
    String handoverId, {
    String reason = '',
  }) async {
    await _call({
      'action': 'void_handover',
      'businessId': businessId,
      'handoverId': handoverId,
      if (reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  /// `record_opening`: owner/admin only; what [staffId] handed over before
  /// Staff balances existed. Confirmed in one step.
  Future<void> recordOpening({
    required String businessId,
    required String staffId,
    required int amountCents,
    String note = '',
  }) async {
    await _call({
      'action': 'record_opening',
      'businessId': businessId,
      'staffId': staffId,
      'amountCents': amountCents,
      if (note.trim().isNotEmpty) 'note': note.trim(),
    });
  }
}

// ---------------------------------------------------------------------------
// The handovers themselves, live.
// ---------------------------------------------------------------------------

/// A live read of `staffHandovers`, behind an interface so the screen and the
/// menu badge are tested with a fake.
abstract interface class StaffHandoverFeed {
  /// Every handover of the business, or only the pending ones.
  Stream<List<StaffHandover>> watch(
    String businessId, {
    bool pendingOnly = false,
  });
}

/// `staffHandovers where businessId == b` (and `status == pending` for the
/// badge). Equality filters only, so no composite index; sorted on the phone.
/// Members of the business read it (rules), the server alone writes.
class FirestoreStaffHandoverFeed implements StaffHandoverFeed {
  FirestoreStaffHandoverFeed({FirebaseFirestore? firestore})
    : _override = firestore;

  final FirebaseFirestore? _override;
  FirebaseFirestore get _db => _override ?? FirebaseFirestore.instance;

  @override
  Stream<List<StaffHandover>> watch(
    String businessId, {
    bool pendingOnly = false,
  }) {
    var query = _db
        .collection('staffHandovers')
        .where('businessId', isEqualTo: businessId);
    if (pendingOnly) query = query.where('status', isEqualTo: 'pending');
    return query.snapshots().map(
      (snap) =>
          [for (final d in snap.docs) StaffHandover.fromMap(d.id, d.data())]
            ..sort(compareHandoverNewestFirst),
    );
  }
}

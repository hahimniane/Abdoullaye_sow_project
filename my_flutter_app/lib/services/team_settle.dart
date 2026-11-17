/// "I paid everything" (docs/TEAM_SETTLE.md): a team member settles their
/// month at once. A deliberate mirror of the server's `team_settle.js` and
/// the console's `team-settle.ts`; all three run the shared fixture
/// `functions/test/fixtures/team-settle-cases.json`. The amount and the split
/// are frozen when it is filed; it counts once the receiver confirms.
///
/// Pure: no Firebase, no widgets.
library;

import 'business_account_receiver.dart' show businessAccountReceiver;
import '../utils/full_access.dart' show isFullAccessStaff;

abstract final class SettleScope {
  static const everything = 'everything';
  static const cash = 'cash';
  static const parking = 'parking';
  static const all = [everything, cash, parking];
}

/// The refusal codes a settlement can come back with (`details.reason`).
abstract final class SettleRefusal {
  static const noAmount = 'team_settle_no_amount';
  static const moreThanOwed = 'team_settle_more_than_owed';
  static const nothingOwed = 'team_settle_nothing_owed';
  static const scopeInvalid = 'team_settle_scope_invalid';
  static const methodInvalid = 'team_settle_method_invalid';
  static const monthInvalid = 'team_settle_month_invalid';
  static const noStatement = 'team_settle_no_statement';
  static const receiverInvalid = 'team_settle_receiver_invalid';
  static const notOwn = 'team_settle_not_own';
  static const notFound = 'team_settle_not_found';
  static const notReceiver = 'team_settle_not_receiver';
  static const notPending = 'team_settle_not_pending';
  static const notUndoable = 'team_settle_not_undoable';
  static const billChanged = 'team_settle_bill_changed';
  static const ownerOnly = 'team_settle_owner_only';
  static const paybackNotOwed = 'team_payback_not_owed';
  static const paybackMoreThanOwed = 'team_payback_more_than_owed';

  static const all = {
    noAmount,
    moreThanOwed,
    nothingOwed,
    scopeInvalid,
    methodInvalid,
    monthInvalid,
    noStatement,
    receiverInvalid,
    notOwn,
    notFound,
    notReceiver,
    notPending,
    notUndoable,
    billChanged,
    ownerOnly,
    paybackNotOwed,
    paybackMoreThanOwed,
  };
}

int _whole(Object? value) {
  final n = num.tryParse('${value ?? ''}');
  if (n == null || !n.isFinite) return 0;
  // JavaScript's Math.round: halves go up.
  return (n + 0.5).floor();
}

/// A team member's statement as the settlement reads it: parking and jobs,
/// the expenses taken off, the cash they hold.
class SettleStatement {
  const SettleStatement({
    required this.parkingJobsCents,
    required this.expenseCents,
    required this.cashHeldCents,
  });

  final int parkingJobsCents;
  final int expenseCents;
  final int cashHeldCents;
}

/// What a statement can be paid on.
class SettleLimits {
  const SettleLimits({
    required this.parkingDueCents,
    required this.cashDueCents,
  });

  final int parkingDueCents;
  final int cashDueCents;
}

/// What a statement can be paid on: the parking after expenses, and the cash
/// (cut by expenses beyond the bill).
SettleLimits settleLimits(SettleStatement statement) {
  final parking = _whole(statement.parkingJobsCents);
  final expense = _whole(statement.expenseCents) < 0
      ? 0
      : _whole(statement.expenseCents);
  final cash = _whole(statement.cashHeldCents);
  final credit = expense > parking ? expense - parking : 0;
  final parkingDue = parking - expense;
  final cashDue = cash - credit;
  return SettleLimits(
    parkingDueCents: parkingDue > 0 ? parkingDue : 0,
    cashDueCents: cashDue > 0 ? cashDue : 0,
  );
}

/// The full number the statement asks for ("Owes the business $X"); 0 when
/// nothing is owed.
int defaultSettleCents(SettleStatement statement) {
  final limits = settleLimits(statement);
  return limits.parkingDueCents + limits.cashDueCents;
}

/// How one amount is split.
class SettlePlan {
  const SettlePlan({
    required this.ok,
    required this.reason,
    required this.cashCents,
    required this.parkingCents,
    required this.leftCents,
  });

  final bool ok;
  final String reason;
  final int cashCents;
  final int parkingCents;
  final int leftCents;

  Map<String, Object?> toJson() => {
    'ok': ok,
    'reason': reason,
    'cashCents': cashCents,
    'parkingCents': parkingCents,
    'leftCents': leftCents,
  };
}

/// How one amount is split: everything = the cash first, then the parking;
/// cash / parking = only that. [cashHeldCents] / [parkingDueCents], when
/// given, are used as they are instead of the statement's limits.
SettlePlan teamSettlePlan({
  SettleStatement? statement,
  int? cashHeldCents,
  int? parkingDueCents,
  required num amountCents,
  required String scope,
}) {
  final limits = settleLimits(
    statement ??
        const SettleStatement(
          parkingJobsCents: 0,
          expenseCents: 0,
          cashHeldCents: 0,
        ),
  );
  final cashDue = cashHeldCents != null
      ? (_whole(cashHeldCents) < 0 ? 0 : _whole(cashHeldCents))
      : limits.cashDueCents;
  final parkingDue = parkingDueCents != null
      ? (_whole(parkingDueCents) < 0 ? 0 : _whole(parkingDueCents))
      : limits.parkingDueCents;
  final total = cashDue + parkingDue;
  SettlePlan refuse(String reason) => SettlePlan(
    ok: false,
    reason: reason,
    cashCents: 0,
    parkingCents: 0,
    leftCents: total,
  );
  if (!SettleScope.all.contains(scope)) {
    return refuse(SettleRefusal.scopeInvalid);
  }
  final allowed = scope == SettleScope.cash
      ? cashDue
      : scope == SettleScope.parking
      ? parkingDue
      : total;
  if (allowed <= 0) return refuse(SettleRefusal.nothingOwed);
  final raw = amountCents;
  if (!raw.isFinite ||
      raw != raw.roundToDouble() ||
      raw <= 0 ||
      raw > 100000000) {
    return refuse(SettleRefusal.noAmount);
  }
  final amount = raw.toInt();
  if (amount > allowed) return refuse(SettleRefusal.moreThanOwed);
  var cash = 0;
  var parking = 0;
  if (scope == SettleScope.cash) {
    cash = amount;
  } else if (scope == SettleScope.parking) {
    parking = amount;
  } else {
    cash = amount < cashDue ? amount : cashDue;
    final rest = amount - cash;
    parking = rest < parkingDue ? rest : parkingDue;
  }
  return SettlePlan(
    ok: true,
    reason: '',
    cashCents: cash,
    parkingCents: parking,
    leftCents: total - amount > 0 ? total - amount : 0,
  );
}

const _paybackMethods = ['cash', 'zelle', 'check', 'other'];

/// The methods a settlement can be paid by (a pay-back has no deposit).
const settleMethods = ['cash', 'zelle', 'check', 'deposit', 'other'];
const paybackMethods = _paybackMethods;

/// Why "Paid them back" is refused, or ''.
String paybackRefusal({
  required int owesCents,
  required num amountCents,
  required String method,
}) {
  final owes = _whole(owesCents);
  if (owes >= 0) return SettleRefusal.paybackNotOwed;
  if (!_paybackMethods.contains(method)) return SettleRefusal.methodInvalid;
  final raw = amountCents;
  if (!raw.isFinite ||
      raw != raw.roundToDouble() ||
      raw <= 0 ||
      raw > 100000000) {
    return SettleRefusal.noAmount;
  }
  return raw > -owes ? SettleRefusal.paybackMoreThanOwed : '';
}

/// A settlement, as stored in `staffMonthSettlements` (server-written).
class SettlementRecord {
  const SettlementRecord({
    required this.id,
    required this.staffId,
    required this.monthKey,
    required this.amountCents,
    required this.scope,
    required this.cashCents,
    required this.parkingCents,
    required this.statementOwedCents,
    required this.receiverId,
    required this.method,
    required this.note,
    required this.status,
    required this.requestedAtMs,
    required this.requestedByUid,
    required this.confirmedAtMs,
    required this.declinedAtMs,
    required this.declineNote,
    required this.undoneAtMs,
    required this.undoneByUid,
  });

  final String id;
  final String staffId;
  final String monthKey;
  final int amountCents;
  final String scope;
  final int cashCents;
  final int parkingCents;
  final int statementOwedCents;
  final String receiverId;
  final String method;
  final String note;

  /// 'pending', 'confirmed', 'declined' or 'undone'.
  final String status;
  final int requestedAtMs;
  final String requestedByUid;
  final int confirmedAtMs;
  final int declinedAtMs;
  final String declineNote;
  final int undoneAtMs;
  final String undoneByUid;

  bool get pending => status == 'pending';
}

const _statuses = ['pending', 'confirmed', 'declined', 'undone'];

String _text(Object? v) => '${v ?? ''}';

/// The settlements as rows the card can show, oldest first; anything odd is
/// left out.
List<SettlementRecord> settlementRecords(Iterable<Map<String, dynamic>> rows) {
  final out = <SettlementRecord>[];
  for (final row in rows) {
    final status = _text(row['status']);
    final id = _text(row['id']);
    if (!_statuses.contains(status) || id.isEmpty) continue;
    out.add(
      SettlementRecord(
        id: id,
        staffId: _text(row['staffId']),
        monthKey: _text(row['monthKey']),
        amountCents: _whole(row['amountCents']),
        scope: _text(row['scope']),
        cashCents: _whole(row['cashCents']),
        parkingCents: _whole(row['parkingCents']),
        statementOwedCents: _whole(row['statementOwedCents']),
        receiverId: _text(row['receiverId']),
        method: _text(row['method']),
        note: _text(row['note']),
        status: status,
        requestedAtMs: _whole(row['requestedAtMs']),
        requestedByUid: _text(row['requestedByUid']),
        confirmedAtMs: _whole(row['confirmedAtMs']),
        declinedAtMs: _whole(row['declinedAtMs']),
        declineNote: _text(row['declineNote']),
        undoneAtMs: _whole(row['undoneAtMs']),
        undoneByUid: _text(row['undoneByUid']),
      ),
    );
  }
  out.sort((a, b) {
    final c = a.requestedAtMs.compareTo(b.requestedAtMs);
    return c != 0 ? c : a.id.compareTo(b.id);
  });
  return out;
}

/// The settlements of one team member.
List<SettlementRecord> settlementsOf(
  Iterable<SettlementRecord> records,
  String staffId,
) => [
  for (final r in records)
    if (r.staffId == staffId) r,
];

/// Whether the signed-in person answers a pending settlement: named as the
/// receiver (or the owner for the Business account), in a receiver role.
bool mayAnswerSettlement(
  SettlementRecord record, {
  required String uid,
  required bool isReceiver,
}) {
  if (!record.pending || !isReceiver) return false;
  return record.receiverId == businessAccountReceiver ||
      record.receiverId == uid;
}

/// The settlements waiting for this person to confirm, oldest first.
List<SettlementRecord> settlementsWaitingFor(
  Iterable<SettlementRecord> records, {
  required String uid,
  required bool isReceiver,
}) => [
  for (final r in records)
    if (mayAnswerSettlement(r, uid: uid, isReceiver: isReceiver)) r,
];

/// Who can receive the money: the owner and staff with Full access, as
/// `(id, name)` pairs. [profiles] maps a uid to its `users` document; the
/// owner is listed first, as "Owner" ([ownerFallbackName]) when no profile
/// names them.
List<({String id, String name})> settleReceiversOf({
  required Iterable<({String id, String name})> people,
  required Map<String, Map<String, dynamic>> profiles,
  required String ownerUid,
  required String ownerFallbackName,
}) {
  final out = <({String id, String name})>[];
  for (final p in people) {
    final profile = profiles[p.id] ?? const <String, dynamic>{};
    final isReceiver =
        p.id == ownerUid ||
        profile['role'] == 'businessOwner' ||
        isFullAccessStaff(
          role: profile['role'],
          fullAccess: profile['fullAccess'],
          businessId: profile['businessId'],
        );
    if (isReceiver) out.add(p);
  }
  if (ownerUid.isNotEmpty && !out.any((p) => p.id == ownerUid)) {
    out.insert(0, (id: ownerUid, name: ownerFallbackName));
  }
  return out;
}

/// "Check bank" any time (docs/ZELLE_BANK_CHECK.md, "Check bank any time").
///
/// At the counter a customer says "I sent it by Zelle" before anything is
/// recorded. Staff type the exact amount and when it was sent; the server
/// looks in the owner's bank and answers "received", "several" or "not yet".
/// Looking consumes nothing. From a received deposit, "Use for a sale"
/// spends it on one recorded Zelle payment of that amount.
///
/// Everything here is pure (requests, answers, the amount typed, who sees
/// the entry, a short status cache) so it is unit-tested without Firebase;
/// the calls live in `zelle_check_service.dart` and the screens only render.
library;

import '../utils/callable_data.dart';
import '../utils/money_input.dart';
import 'zelle_check.dart';

// ---------------------------------------------------------------------------
// When it was sent.
// ---------------------------------------------------------------------------

/// The windows staff pick from (the server's `since`).
enum BankCheckSince {
  /// The last 15 minutes (the default).
  last15Minutes('15m'),

  /// The last hour.
  lastHour('1h'),

  /// Since midnight in the business's time zone.
  today('today');

  const BankCheckSince(this.wire);

  final String wire;
}

const defaultBankCheckSince = BankCheckSince.last15Minutes;

BankCheckSince? bankCheckSinceOfWire(Object? wire) {
  final text = (wire ?? '').toString().trim();
  for (final since in BankCheckSince.values) {
    if (since.wire == text) return since;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The amount typed.
// ---------------------------------------------------------------------------

/// The largest amount the server checks ($1,000,000.00).
const maxBankCheckCents = 100000000;

enum BankCheckAmountIssue { empty, invalid, notPositive, tooLarge }

/// The typed amount in whole cents, or why it cannot be checked. Read with
/// the app's one money reader: "60,50" is $60.50, ambiguous text is refused.
({int? cents, BankCheckAmountIssue? issue}) readBankCheckAmount(String text) {
  final input = readMoneyInput(text);
  if (input.isEmpty) return (cents: null, issue: BankCheckAmountIssue.empty);
  final cents = input.cents;
  if (cents == null) {
    return (cents: null, issue: BankCheckAmountIssue.invalid);
  }
  if (cents <= 0) {
    return (cents: null, issue: BankCheckAmountIssue.notPositive);
  }
  if (cents > maxBankCheckCents) {
    return (cents: null, issue: BankCheckAmountIssue.tooLarge);
  }
  return (cents: cents, issue: null);
}

// ---------------------------------------------------------------------------
// Requests, exactly as the callables read them.
// ---------------------------------------------------------------------------

/// `checkZellePayment` in standalone mode. `amountCents` is a number, never
/// text. [auto] marks the sheet's own timed re-checks.
Map<String, Object?> standaloneBankCheckRequest(
  String businessId, {
  required int amountCents,
  BankCheckSince since = defaultBankCheckSince,
  bool auto = false,
}) => {
  'businessId': businessId,
  'mode': 'standalone',
  'amountCents': amountCents,
  'since': since.wire,
  if (auto) 'auto': true,
};

/// `confirmZelleCandidate {mode: "records"}`: the recent payments a deposit
/// can confirm, or - with a [query] - those matching it.
Map<String, Object?> bankUseRecordsRequest(
  String businessId,
  String creditId, {
  String query = '',
}) {
  final q = query.replaceAll(RegExp(r'\s+'), ' ').trim();
  return {
    'businessId': businessId,
    'mode': 'records',
    'creditId': creditId,
    if (q.isNotEmpty) 'query': q.length > 80 ? q.substring(0, 80) : q,
  };
}

/// `confirmZelleCandidate {mode: "use"}`: spend the deposit on one payment.
Map<String, Object?> bankUseDepositRequest(
  String businessId,
  String creditId,
  ZelleCheckKind kind,
  String id,
) => {
  'businessId': businessId,
  'mode': 'use',
  'creditId': creditId,
  'kind': kind.wire,
  'id': id,
};

// ---------------------------------------------------------------------------
// Answers.
// ---------------------------------------------------------------------------

String _text(Object? value, int max) {
  final t = (value ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

int? _int(Object? value) =>
    value is num && value.isFinite ? value.round() : null;

DateTime? _instant(Object? value) {
  final ms = _int(value);
  if (ms == null || ms <= 0) return null;
  return DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
}

/// A deposit the bank shows: amount, when (date only when [timeKnown] is
/// false), the sender's name, pending. Never a balance or the bank line.
class BankDeposit {
  const BankDeposit({
    required this.creditId,
    required this.amountCents,
    this.at,
    this.timeKnown = true,
    this.senderName = '',
    this.pending = false,
  });

  /// Null without an id or a positive amount.
  static BankDeposit? fromMap(Object? data) {
    if (data is! Map) return null;
    final map = callableMap(data);
    final id = _text(map['creditId'], 128);
    final cents = _int(map['amountCents']);
    if (id.isEmpty || cents == null || cents <= 0) return null;
    return BankDeposit(
      creditId: id,
      amountCents: cents,
      at: _instant(map['atMs']),
      timeKnown: map['timeKnown'] != false,
      senderName: _text(map['senderName'], 80),
      pending: map['pending'] == true,
    );
  }

  final String creditId;
  final int amountCents;
  final DateTime? at;
  final bool timeKnown;
  final String senderName;
  final bool pending;
}

enum BankCheckOutcome { received, several, notFound }

/// What a standalone check answered.
class BankCheckAnswer {
  const BankCheckAnswer({
    required this.outcome,
    this.deposits = const [],
    this.since,
    this.from,
    this.limitReached = false,
  });

  /// Reads `{result, deposits, since, fromMs, limitReached}`. An answer this
  /// phone cannot read is null: the sheet says it could not check, never
  /// "received".
  static BankCheckAnswer? fromCallable(Object? data) {
    final map = callableMap(data);
    final raw = map['deposits'];
    final seen = <String>{};
    final deposits = [
      if (raw is Iterable)
        for (final d in raw)
          if (BankDeposit.fromMap(d) case final deposit?)
            if (seen.add(deposit.creditId)) deposit,
    ];
    final outcome = switch (_text(map['result'], 20)) {
      'received' => BankCheckOutcome.received,
      'several' => BankCheckOutcome.several,
      'not_found' => BankCheckOutcome.notFound,
      _ => null,
    };
    if (outcome == null) return null;
    // "Received" must say what landed.
    if (outcome != BankCheckOutcome.notFound && deposits.isEmpty) return null;
    return BankCheckAnswer(
      outcome: outcome == BankCheckOutcome.notFound
          ? outcome
          : deposits.length > 1
          ? BankCheckOutcome.several
          : BankCheckOutcome.received,
      deposits: outcome == BankCheckOutcome.notFound ? const [] : deposits,
      since: bankCheckSinceOfWire(map['since']),
      from: _instant(map['fromMs']),
      limitReached: map['limitReached'] == true,
    );
  }

  final BankCheckOutcome outcome;
  final List<BankDeposit> deposits;
  final BankCheckSince? since;
  final DateTime? from;

  /// This month's paid refreshes reached the owner's limit: new deposits
  /// may take longer to show.
  final bool limitReached;
}

/// A payment "Use for a sale" can confirm. [who] and [what] are the
/// business's own words (customer; items or tracking code): never
/// translated.
class BankUseRecord {
  const BankUseRecord({
    required this.kind,
    required this.id,
    required this.amountCents,
    this.at,
    this.who = '',
    this.what = '',
  });

  static BankUseRecord? fromMap(Object? data) {
    if (data is! Map) return null;
    final map = callableMap(data);
    final kind = zelleCheckKindOfWire(map['kind']);
    final id = _text(map['id'], 128);
    final cents = _int(map['amountCents']);
    if (kind == null || id.isEmpty || cents == null || cents <= 0) {
      return null;
    }
    return BankUseRecord(
      kind: kind,
      id: id,
      amountCents: cents,
      at: _instant(map['atMs']),
      who: _text(map['who'], 80),
      what: _text(map['what'], 80),
    );
  }

  final ZelleCheckKind kind;
  final String id;
  final int amountCents;
  final DateTime? at;
  final String who;
  final String what;

  String get key => '${kind.wire}:$id';
}

/// `{records, searched}`.
class BankUseRecords {
  const BankUseRecords({this.records = const [], this.searched = false});

  /// Null when [data] has no `records` list.
  static BankUseRecords? fromCallable(Object? data) {
    final map = callableMap(data);
    final raw = map['records'];
    if (raw is! Iterable) return null;
    final seen = <String>{};
    return BankUseRecords(
      records: [
        for (final r in raw)
          if (BankUseRecord.fromMap(r) case final record?)
            if (seen.add(record.key)) record,
      ],
      searched: map['searched'] == true,
    );
  }

  final List<BankUseRecord> records;
  final bool searched;
}

// ---------------------------------------------------------------------------
// Who sees the "Check bank" entry.
// ---------------------------------------------------------------------------

enum BankCheckEntryState {
  /// Nothing on screen.
  hidden,

  /// "Check bank".
  check,

  /// The owner's hint: connect a bank to check Zelle here.
  connectHint,

  /// The owner's hint: the bank asks to sign in again.
  reconnectHint,
}

/// The entry shows only when the bank is connected and active and the
/// person can check (sells, takes package payments, or owns the business).
/// Without an active bank staff see nothing; the owner sees a hint that
/// opens the bank settings. [status] null (still loading, or unreadable)
/// shows nothing.
BankCheckEntryState bankCheckEntryState({
  required BusinessBankStatus? status,
  required bool isOwner,
  required bool canCheck,
}) {
  if (status == null) return BankCheckEntryState.hidden;
  if (status.active) {
    return canCheck || isOwner
        ? BankCheckEntryState.check
        : BankCheckEntryState.hidden;
  }
  if (!isOwner) return BankCheckEntryState.hidden;
  return status.needsReauth
      ? BankCheckEntryState.reconnectHint
      : BankCheckEntryState.connectHint;
}

/// The bank status a home screen last read, per business, for a short
/// while: going back and forth between homes does not ask again each time.
/// Only answers are kept (a failed read is asked again).
class BankStatusCache {
  BankStatusCache({
    this.ttl = const Duration(minutes: 2),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  /// The one the home screens share.
  static final shared = BankStatusCache();

  final Duration ttl;
  final DateTime Function() _clock;
  final Map<String, ({DateTime at, BusinessBankStatus status})> _entries = {};

  /// The status read less than [ttl] ago, else null.
  BusinessBankStatus? fresh(String businessId) {
    final entry = _entries[businessId];
    if (entry == null) return null;
    if (_clock().difference(entry.at) >= ttl) {
      _entries.remove(businessId);
      return null;
    }
    return entry.status;
  }

  void put(String businessId, BusinessBankStatus status) {
    // A handful of businesses at most; never grows without bound.
    if (_entries.length > 20) _entries.clear();
    _entries[businessId] = (at: _clock(), status: status);
  }

  /// After the owner changed the bank: the next screen asks again.
  void forget(String businessId) => _entries.remove(businessId);
}

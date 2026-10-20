/// Checking a Zelle payment against the owner's bank (docs/ZELLE_BANK_CHECK.md).
///
/// The owner connects the business's bank once (Plaid). After that any staff
/// member can tap "Check Zelle" on a payment recorded as Zelle, and the server
/// looks for a deposit of exactly that amount inside the business's window.
/// Staff never see a balance or another transaction: only "received", "not
/// yet" or a short list of same-amount deposits to pick from by sender name.
///
/// Everything here is pure (request shapes, answer parsing, the auto re-check
/// schedule, the failure codes) so it is unit-tested without Firebase; the
/// callables live in `zelle_check_service.dart` and the screens only render.
library;

import '../utils/callable_data.dart';

// ---------------------------------------------------------------------------
// What is being checked.
// ---------------------------------------------------------------------------

/// The three kinds of record a Zelle payment is written on.
enum ZelleCheckKind {
  /// The money taken at the counter on an inventory sale.
  inventorySale('inventory_sale'),

  /// A later payment against a credit sale.
  inventoryCreditPayment('inventory_credit_payment'),

  /// A payment recorded on a waiting package.
  containerLinePayment('container_line_payment');

  const ZelleCheckKind(this.wire);

  /// The value the server reads in `kind`.
  final String wire;
}

/// The method code a payment recorded as Zelle carries.
const zelleMethod = 'zelle';

/// Whether a payment recorded by [method] can be checked against the bank.
bool isZelleMethod(String method) => method.trim().toLowerCase() == zelleMethod;

// ---------------------------------------------------------------------------
// The window: how far back from the record the bank is searched.
// ---------------------------------------------------------------------------

/// The minutes the owner can pick between (the server takes 2..60).
const bankCheckWindowChoices = <int>[2, 5, 10, 15, 30, 60];
const defaultBankCheckWindowMinutes = 15;
const minBankCheckWindowMinutes = 2;
const maxBankCheckWindowMinutes = 60;

bool bankCheckWindowValid(int minutes) =>
    minutes >= minBankCheckWindowMinutes &&
    minutes <= maxBankCheckWindowMinutes;

// ---------------------------------------------------------------------------
// Requests, exactly as the callables read them.
// ---------------------------------------------------------------------------

/// `createBankLinkToken`: [platform] is `ios` or `android`; [language]
/// (`en` / `fr`, the app's) is the language Plaid Link shows.
Map<String, Object?> createBankLinkTokenRequest(
  String businessId, {
  required String platform,
  String language = '',
}) => {
  'businessId': businessId,
  'platform': platform,
  'language': ?bankLinkLanguage(language),
};

/// The app language as the callables take it (`en` or `fr`); null for any
/// other, so nothing is sent and the server keeps its default.
String? bankLinkLanguage(String languageCode) {
  final code = languageCode.trim().toLowerCase().split(RegExp('[-_]')).first;
  return code == 'en' || code == 'fr' ? code : null;
}

/// `connectBusinessBank`: the Link public token, and the account the owner
/// picked when Link names one.
Map<String, Object?> connectBusinessBankRequest(
  String businessId, {
  required String publicToken,
  String? accountId,
}) => {
  'businessId': businessId,
  'publicToken': publicToken,
  if ((accountId ?? '').trim().isNotEmpty) 'accountId': accountId!.trim(),
};

Map<String, Object?> businessBankRequest(String businessId) => {
  'businessId': businessId,
};

/// `setBankCheckWindow`.
Map<String, Object?> setBankCheckWindowRequest(
  String businessId,
  int minutes,
) => {'businessId': businessId, 'minutes': minutes};

/// `setBankCheckWindow` with the monthly limit of paid refreshes only.
Map<String, Object?> setBankRefreshLimitRequest(
  String businessId,
  int refreshLimit,
) => {'businessId': businessId, 'refreshLimit': refreshLimit};

/// `checkZellePayment`. [auto] marks the sheet's own timed re-checks, which
/// the server does not count as a check someone made; a press of Check (or
/// opening the sheet) sends nothing.
Map<String, Object?> checkZellePaymentRequest(
  String businessId,
  ZelleCheckKind kind,
  String id, {
  bool auto = false,
}) => {
  'businessId': businessId,
  'kind': kind.wire,
  'id': id,
  if (auto) 'auto': true,
};

/// The kind a callable names, or null for one this app does not know.
ZelleCheckKind? zelleCheckKindOfWire(Object? wire) {
  final text = (wire ?? '').toString().trim();
  for (final kind in ZelleCheckKind.values) {
    if (kind.wire == text) return kind;
  }
  return null;
}

/// `confirmZelleCandidate`: the deposit the person picked by sender name.
Map<String, Object?> confirmZelleCandidateRequest(
  String businessId,
  ZelleCheckKind kind,
  String id,
  String creditId,
) => {
  'businessId': businessId,
  'kind': kind.wire,
  'id': id,
  'creditId': creditId,
};

// ---------------------------------------------------------------------------
// Answers.
// ---------------------------------------------------------------------------

int? _optionalInt(Object? value) =>
    value is num && value.isFinite ? value.round() : null;

String _text(Object? value, int max) {
  final t = (value ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

DateTime? _instantOfMs(Object? value) {
  final ms = _optionalInt(value);
  if (ms == null || ms <= 0) return null;
  return DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
}

/// `timeKnown: false` means the bank gave a date only (`atMs` is then noon
/// UTC of that date); anything else, including no field, is a real time.
bool _timeKnown(Object? value) => value != false;

/// The calendar day of a date-only deposit (noon UTC of that day), as a
/// local date for the date helpers. Never shifted by a time zone: the bank's
/// date is the date.
DateTime zelleDepositDay(DateTime at) {
  final utc = at.toUtc();
  return DateTime(utc.year, utc.month, utc.day);
}

/// A deposit the bank shows for the payment.
class ZelleConfirmation {
  const ZelleConfirmation({
    required this.amountCents,
    this.at,
    this.senderName = '',
    this.institutionName = '',
    this.timeKnown = true,
  });

  /// `{amountCents, atMs, timeKnown?, senderName, institutionName}`; null
  /// without a
  /// positive amount (nothing was confirmed).
  static ZelleConfirmation? fromMap(Object? data) {
    if (data is! Map) return null;
    final map = callableMap(data);
    final cents = _optionalInt(map['amountCents']);
    if (cents == null || cents <= 0) return null;
    return ZelleConfirmation(
      amountCents: cents,
      at: _instantOfMs(map['atMs']),
      timeKnown: _timeKnown(map['timeKnown']),
      senderName: _text(map['senderName'], 80),
      institutionName: _text(map['institutionName'], 80),
    );
  }

  final int amountCents;

  /// When the deposit landed (a true instant), if the bank said. With
  /// [timeKnown] false only its date means anything (see [zelleDepositDay]).
  final DateTime? at;

  /// False when the bank gave a date and no time: show the date only.
  final bool timeKnown;
  final String senderName;
  final String institutionName;
}

/// A same-amount deposit the person picks by sender name. A date-only
/// deposit always comes as a choice, even alone, so the person confirms it.
class ZelleCandidate {
  const ZelleCandidate({
    required this.creditId,
    this.at,
    this.senderName = '',
    this.timeKnown = true,
  });

  final String creditId;
  final DateTime? at;
  final String senderName;

  /// False when the bank gave a date and no time.
  final bool timeKnown;
}

enum ZelleCheckOutcome { confirmed, notFound, choose, alreadyConfirmed }

/// What `checkZellePayment` (or `confirmZelleCandidate`) answered.
class ZelleCheckResult {
  const ZelleCheckResult({
    required this.outcome,
    this.confirmation,
    this.candidates = const [],
  });

  /// Reads `{result, confirmation?, candidates?}`. An answer this phone
  /// cannot read is null: the sheet says it could not check, never "found".
  ///
  /// `confirmZelleCandidate` answers with the confirmation only (no
  /// `result`): that reads as [ZelleCheckOutcome.confirmed].
  static ZelleCheckResult? fromCallable(Object? data) {
    final map = callableMap(data);
    final confirmation = ZelleConfirmation.fromMap(map['confirmation']);
    final result = _text(map['result'], 30);
    switch (result) {
      case 'confirmed':
      case 'already_confirmed':
        // "Confirmed" must say what landed; without it the answer is unread.
        if (confirmation == null) return null;
        return ZelleCheckResult(
          outcome: result == 'confirmed'
              ? ZelleCheckOutcome.confirmed
              : ZelleCheckOutcome.alreadyConfirmed,
          confirmation: confirmation,
        );
      case 'not_found':
        return const ZelleCheckResult(outcome: ZelleCheckOutcome.notFound);
      case 'choose':
        final raw = map['candidates'];
        final seen = <String>{};
        final candidates = [
          if (raw is Iterable)
            for (final c in raw)
              if (c is Map)
                if (_text(c['creditId'], 128) case final id
                    when id.isNotEmpty && seen.add(id))
                  ZelleCandidate(
                    creditId: id,
                    at: _instantOfMs(c['atMs']),
                    timeKnown: _timeKnown(c['timeKnown']),
                    senderName: _text(c['senderName'], 80),
                  ),
        ];
        // A choice of nothing cannot be offered. One is fine: a date-only
        // deposit is always confirmed by hand.
        if (candidates.isEmpty) return null;
        return ZelleCheckResult(
          outcome: ZelleCheckOutcome.choose,
          candidates: candidates,
        );
      case '':
        if (confirmation != null) {
          return ZelleCheckResult(
            outcome: ZelleCheckOutcome.confirmed,
            confirmation: confirmation,
          );
        }
        return null;
    }
    return null;
  }

  final ZelleCheckOutcome outcome;
  final ZelleConfirmation? confirmation;
  final List<ZelleCandidate> candidates;

  bool get isConfirmed =>
      outcome == ZelleCheckOutcome.confirmed ||
      outcome == ZelleCheckOutcome.alreadyConfirmed;
}

/// The `bankCheck` the server writes on a sale, a credit payment or a
/// package payment once someone checked it.
class BankCheck {
  const BankCheck({
    required this.status,
    this.creditId = '',
    this.amountCents,
    this.at,
    this.senderName = '',
    this.institutionName = '',
    this.checkedByUid = '',
    this.checkedAt,
    this.timeKnown = true,
  });

  /// Null for a record with no (or an unreadable) `bankCheck`.
  static BankCheck? fromMap(Object? data, {DateTime? Function(Object?)? date}) {
    if (data is! Map) return null;
    final map = callableMap(data);
    final status = switch (_text(map['status'], 20)) {
      'confirmed' => 'confirmed',
      'not_found' => 'not_found',
      _ => '',
    };
    if (status.isEmpty) return null;
    final checkedAt = map['checkedAt'];
    return BankCheck(
      status: status,
      creditId: _text(map['creditId'], 128),
      amountCents: _optionalInt(map['amountCents']),
      at: _instantOfMs(map['atMs']),
      timeKnown: _timeKnown(map['timeKnown']),
      senderName: _text(map['senderName'], 80),
      institutionName: _text(map['institutionName'], 80),
      checkedByUid: _text(map['checkedByUid'], 128),
      checkedAt: date != null
          ? date(checkedAt)
          : checkedAt is DateTime
          ? checkedAt
          : _instantOfMs(checkedAt),
    );
  }

  /// A confirmation fresh from the sheet, before the record's stream shows it.
  factory BankCheck.ofConfirmation(ZelleConfirmation c) => BankCheck(
    status: 'confirmed',
    amountCents: c.amountCents,
    at: c.at,
    timeKnown: c.timeKnown,
    senderName: c.senderName,
    institutionName: c.institutionName,
  );

  /// `confirmed` or `not_found`.
  final String status;
  final String creditId;
  final int? amountCents;
  final DateTime? at;
  final String senderName;
  final String institutionName;
  final String checkedByUid;

  /// A Firestore Timestamp on the record, read through the `date` reader.
  final DateTime? checkedAt;

  /// False when the bank gave the deposit's date only.
  final bool timeKnown;

  bool get confirmed => status == 'confirmed';
}

/// Whether a payment shows the "Bank ✓" chip.
bool showsBankConfirmedChip(BankCheck? check) => check?.confirmed ?? false;

/// Whether a payment offers "Check Zelle": recorded as Zelle, not reverted or
/// voided, money actually taken, and not confirmed already.
bool offersZelleCheck({
  required String method,
  required int amountCents,
  BankCheck? bankCheck,
  bool reverted = false,
}) =>
    isZelleMethod(method) &&
    amountCents > 0 &&
    !reverted &&
    !showsBankConfirmedChip(bankCheck);

// ---------------------------------------------------------------------------
// The bank connection, as the owner (or staff) sees it.
// ---------------------------------------------------------------------------

enum BankLinkStatus { active, needsReauth, disconnected }

BankLinkStatus _bankLinkStatusOf(String value) => switch (value) {
  'active' => BankLinkStatus.active,
  'needs_reauth' => BankLinkStatus.needsReauth,
  _ => BankLinkStatus.disconnected,
};

/// `getBusinessBankStatus`: the owner gets the bank's name, the account's
/// last four digits and the last sync; staff only whether it is connected.
class BusinessBankStatus {
  const BusinessBankStatus({
    required this.connected,
    required this.status,
    this.institutionName = '',
    this.accountMask = '',
    this.windowMinutes = defaultBankCheckWindowMinutes,
    this.lastSyncAt,
    this.accountName = '',
    this.lastErrorCode = '',
    this.refreshLimit = defaultBankRefreshLimit,
    this.usage,
  });

  static const none = BusinessBankStatus(
    connected: false,
    status: BankLinkStatus.disconnected,
  );

  factory BusinessBankStatus.fromCallable(Object? data) {
    final map = callableMap(data);
    final connected = map['connected'] == true;
    var status = _bankLinkStatusOf(_text(map['status'], 20));
    // "Connected" with no usable status still needs nothing from anyone.
    if (connected && status == BankLinkStatus.disconnected) {
      status = BankLinkStatus.active;
    }
    if (!connected) status = BankLinkStatus.disconnected;
    final minutes = _optionalInt(map['windowMinutes']);
    final mask = _text(map['accountMask'], 8).replaceAll(RegExp(r'\D'), '');
    return BusinessBankStatus(
      connected: connected,
      status: status,
      institutionName: _text(map['institutionName'], 80),
      accountMask: mask,
      windowMinutes: minutes != null && bankCheckWindowValid(minutes)
          ? minutes
          : defaultBankCheckWindowMinutes,
      lastSyncAt: _instantOfMs(map['lastSyncAt']),
      accountName: _text(map['accountName'], 80),
      lastErrorCode: _text(map['lastErrorCode'], 80),
      refreshLimit: bankRefreshLimitOf(map['refreshLimit']),
      usage: BankUsage.fromMap(map['usage']),
    );
  }

  final bool connected;

  /// The owner's monthly limit of paid bank refreshes (owner answer only;
  /// staff get the default, never shown to them).
  final int refreshLimit;

  /// This month's checks and refreshes (owner answer only; null for staff).
  final BankUsage? usage;

  /// The account's own name ("Business Checking"), owner only.
  final String accountName;

  /// Plaid's last error on the connection, owner only (not shown as text).
  final String lastErrorCode;
  final BankLinkStatus status;
  final String institutionName;

  /// Digits only ("" when the server sent none).
  final String accountMask;
  final int windowMinutes;
  final DateTime? lastSyncAt;

  bool get needsReauth => connected && status == BankLinkStatus.needsReauth;
  bool get active => connected && status == BankLinkStatus.active;

  BusinessBankStatus copyWith({int? windowMinutes, int? refreshLimit}) =>
      BusinessBankStatus(
        connected: connected,
        status: status,
        institutionName: institutionName,
        accountMask: accountMask,
        windowMinutes: windowMinutes ?? this.windowMinutes,
        lastSyncAt: lastSyncAt,
        accountName: accountName,
        lastErrorCode: lastErrorCode,
        refreshLimit: refreshLimit ?? this.refreshLimit,
        usage: refreshLimit == null
            ? usage
            : usage?.withRefreshLimit(refreshLimit),
      );
}

// ---------------------------------------------------------------------------
// This month's usage and the owner's limit of paid refreshes.
// ---------------------------------------------------------------------------

/// The owner's monthly limit of paid bank refreshes (the server takes
/// 0..1000; 100 until the owner changes it).
const defaultBankRefreshLimit = 100;
const minBankRefreshLimit = 0;
const maxBankRefreshLimit = 1000;

bool bankRefreshLimitValid(int limit) =>
    limit >= minBankRefreshLimit && limit <= maxBankRefreshLimit;

/// A limit read from an answer; the default when absent or out of range.
int bankRefreshLimitOf(Object? value) {
  final limit = value is num && value.isFinite && value == value.roundToDouble()
      ? value.toInt()
      : null;
  return limit != null && bankRefreshLimitValid(limit)
      ? limit
      : defaultBankRefreshLimit;
}

/// A limit the owner typed: digits only, 0..1000; null otherwise (never
/// guessed: "1,000", "12.5" and "-1" are refused).
int? readBankRefreshLimit(String text) {
  final t = text.trim();
  if (t.isEmpty || t.length > 4 || !RegExp(r'^[0-9]+$').hasMatch(t)) {
    return null;
  }
  final limit = int.parse(t);
  return bankRefreshLimitValid(limit) ? limit : null;
}

int _count(Object? value) {
  final n = _optionalInt(value);
  return n == null || n < 0 ? 0 : n;
}

/// One person's share of the month. [name] is "" when the profile has none:
/// screens then say "Team member" - a uid is never shown.
class BankUsageStaff {
  const BankUsageStaff({
    required this.uid,
    this.name = '',
    this.checks = 0,
    this.refreshes = 0,
  });

  final String uid;
  final String name;
  final int checks;
  final int refreshes;
}

/// `usage` in the owner's `getBusinessBankStatus` answer: `{month, checks,
/// refreshes, refreshesFailed, estimatedCostCents, refreshLimit,
/// limitReached, byStaff}`.
class BankUsage {
  const BankUsage({
    this.month = '',
    this.checks = 0,
    this.refreshes = 0,
    this.refreshesFailed = 0,
    this.estimatedCostCents = 0,
    this.refreshLimit = defaultBankRefreshLimit,
    this.limitReached = false,
    this.byStaff = const [],
  });

  /// Null when [data] is not a map (staff answers carry no usage).
  static BankUsage? fromMap(Object? data) {
    if (data is! Map) return null;
    final map = callableMap(data);
    final raw = map['byStaff'];
    final seen = <String>{};
    final limit = bankRefreshLimitOf(map['refreshLimit']);
    final refreshes = _count(map['refreshes']);
    return BankUsage(
      month: _text(map['month'], 7),
      checks: _count(map['checks']),
      refreshes: refreshes,
      refreshesFailed: _count(map['refreshesFailed']),
      estimatedCostCents: _count(map['estimatedCostCents']),
      refreshLimit: limit,
      limitReached: map['limitReached'] == true,
      byStaff: [
        if (raw is Iterable)
          for (final row in raw)
            if (row is Map)
              if (_text(row['uid'], 128) case final uid
                  when uid.isNotEmpty && seen.add(uid))
                BankUsageStaff(
                  uid: uid,
                  name: _text(row['name'], 80),
                  checks: _count(row['checks']),
                  refreshes: _count(row['refreshes']),
                ),
      ],
    );
  }

  /// `yyyy-mm`, the month in New York.
  final String month;
  final int checks;
  final int refreshes;
  final int refreshesFailed;
  final int estimatedCostCents;
  final int refreshLimit;
  final bool limitReached;
  final List<BankUsageStaff> byStaff;

  /// The first day of [month], or null when it cannot be read.
  DateTime? get monthStart {
    final m = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(month);
    if (m == null) return null;
    final month0 = int.parse(m.group(2)!);
    if (month0 < 1 || month0 > 12) return null;
    return DateTime(int.parse(m.group(1)!), month0);
  }

  /// The same month under a new limit (the server says the limit is reached
  /// once the month's refreshes reach it).
  BankUsage withRefreshLimit(int limit) => BankUsage(
    month: month,
    checks: checks,
    refreshes: refreshes,
    refreshesFailed: refreshesFailed,
    estimatedCostCents: estimatedCostCents,
    refreshLimit: limit,
    limitReached: refreshes >= limit,
    byStaff: byStaff,
  );
}

/// `setBankCheckWindow {refreshLimit}`: the limit the server kept, or null
/// when the answer does not say.
int? bankRefreshLimitFromAnswer(Object? data) {
  final value = callableMap(data)['refreshLimit'];
  final limit = value is num && value == value.roundToDouble()
      ? value.toInt()
      : null;
  return limit != null && bankRefreshLimitValid(limit) ? limit : null;
}

/// "Business Checking •••• 1234", whichever parts there are.
String bankAccountLabel(String accountName, String mask) => [
  if (accountName.trim().isNotEmpty) accountName.trim(),
  if (mask.isNotEmpty) bankAccountMaskLabel(mask),
].join(' ');

/// "•••• 1234", or "" without a mask.
String bankAccountMaskLabel(String mask) => mask.isEmpty ? '' : '•••• $mask';

/// `connectBusinessBank`: `{status, institutionName, accountMask,
/// accountName, synced}`.
class BankConnectResult {
  const BankConnectResult({
    required this.status,
    this.institutionName = '',
    this.accountMask = '',
    this.accountName = '',
    this.synced = false,
  });

  factory BankConnectResult.fromCallable(Object? data) {
    final map = callableMap(data);
    return BankConnectResult(
      status: _bankLinkStatusOf(_text(map['status'], 20)),
      institutionName: _text(map['institutionName'], 80),
      accountMask: _text(map['accountMask'], 8).replaceAll(RegExp(r'\D'), ''),
      accountName: _text(map['accountName'], 80),
      synced: map['synced'] == true,
    );
  }

  final BankLinkStatus status;
  final String institutionName;
  final String accountMask;
  final String accountName;

  /// The first sync already ran (the last-sync time is then worth reloading).
  final bool synced;
}

/// `createBankLinkToken`: `{linkToken, expiration, mode}`; null without a
/// token. [mode] is `update` when the server made it to sign in again.
class BankLinkToken {
  const BankLinkToken({
    required this.linkToken,
    this.expiration = '',
    this.mode = 'connect',
  });

  static BankLinkToken? fromCallable(Object? data) {
    final map = callableMap(data);
    final token = _text(map['linkToken'], 400);
    if (token.isEmpty) return null;
    return BankLinkToken(
      linkToken: token,
      expiration: _text(map['expiration'], 60),
      mode: _text(map['mode'], 20) == 'update' ? 'update' : 'connect',
    );
  }

  final String linkToken;
  final String expiration;
  final String mode;

  bool get isUpdate => mode == 'update';
}

// ---------------------------------------------------------------------------
// Failures: the codes the callables send in `details.reason`.
// ---------------------------------------------------------------------------

enum ZelleCheckFailure {
  bankNotConnected,
  bankNeedsReauth,
  notZelle,
  recordNotFound,
  recordVoided,
  bankOwnerRequired,
  windowInvalid,
  bankAccessDenied,
  kindInvalid,
  platformInvalid,
  publicTokenRequired,
  noDepositoryAccount,
  candidateInvalid,

  /// Someone else just matched that deposit: refresh and check again.
  candidateTaken,

  /// The bank (Plaid) did not answer; `details.bankError` may name why.
  bankError,

  /// Check bank: the deposit and the picked payment differ in amount.
  amountMismatch,

  /// Check bank: the typed amount was refused (not whole cents, 0, huge).
  checkAmountInvalid,

  /// Check bank: "when was it sent" was not one the server knows.
  sinceInvalid,

  /// An older server, or a request this app should not send.
  modeInvalid,

  /// The monthly limit of paid refreshes is not 0..1000.
  limitInvalid,

  /// Staff tied to one store asked about another store's money.
  storeNotAllowed,
  network,
  noPermission,
  deviceNotVerified,
  unknown,
}

const _zelleFailureReasons = <String, ZelleCheckFailure>{
  'bank_not_connected': ZelleCheckFailure.bankNotConnected,
  'bank_needs_reauth': ZelleCheckFailure.bankNeedsReauth,
  'not_zelle': ZelleCheckFailure.notZelle,
  'record_not_found': ZelleCheckFailure.recordNotFound,
  'record_voided': ZelleCheckFailure.recordVoided,
  'bank_owner_required': ZelleCheckFailure.bankOwnerRequired,
  'window_invalid': ZelleCheckFailure.windowInvalid,
  'bank_access_denied': ZelleCheckFailure.bankAccessDenied,
  'kind_invalid': ZelleCheckFailure.kindInvalid,
  'platform_invalid': ZelleCheckFailure.platformInvalid,
  'public_token_required': ZelleCheckFailure.publicTokenRequired,
  'no_depository_account': ZelleCheckFailure.noDepositoryAccount,
  'candidate_invalid': ZelleCheckFailure.candidateInvalid,
  'candidate_taken': ZelleCheckFailure.candidateTaken,
  'bank_error': ZelleCheckFailure.bankError,
  'amount_mismatch': ZelleCheckFailure.amountMismatch,
  'check_amount_invalid': ZelleCheckFailure.checkAmountInvalid,
  'since_invalid': ZelleCheckFailure.sinceInvalid,
  'mode_invalid': ZelleCheckFailure.modeInvalid,
  'limit_invalid': ZelleCheckFailure.limitInvalid,
  'store_not_allowed': ZelleCheckFailure.storeNotAllowed,
};

/// The failure a refusal names: `details.reason` (or `details.code`, or one
/// of `details.reasons`) first, then the callable's own code.
ZelleCheckFailure zelleCheckFailureOf({String? code, Object? details}) {
  if (details is Map) {
    final reason = _text(details['reason'] ?? details['code'], 60);
    final known = _zelleFailureReasons[reason];
    if (known != null) return known;
    final all = details['reasons'];
    if (all is Iterable) {
      for (final r in all) {
        final found = _zelleFailureReasons['$r'];
        if (found != null) return found;
      }
    }
  }
  return switch (code) {
    'unavailable' || 'deadline-exceeded' => ZelleCheckFailure.network,
    'permission-denied' => ZelleCheckFailure.noPermission,
    'unauthenticated' => ZelleCheckFailure.deviceNotVerified,
    _ => ZelleCheckFailure.unknown,
  };
}

// ---------------------------------------------------------------------------
// Checking again by itself while the sheet is open.
// ---------------------------------------------------------------------------

/// "Not there yet" re-checks by itself every [interval] for up to [window],
/// with a visible countdown and a Stop. One tick per second; the sheet owns
/// the timer, this only counts, so the schedule is tested without one.
///
/// Check again (by hand) starts a fresh window.
class ZelleRetryCountdown {
  ZelleRetryCountdown({
    this.interval = const Duration(seconds: 20),
    this.window = const Duration(minutes: 3),
  });

  final Duration interval;
  final Duration window;

  int _autoChecks = 0;
  int _secondsLeft = 0;
  bool _running = false;
  bool _stopped = false;

  /// The re-checks a window holds (9 for 20 s over 3 minutes).
  int get maxAutoChecks =>
      interval.inSeconds <= 0 ? 0 : window.inSeconds ~/ interval.inSeconds;

  int get autoChecksDone => _autoChecks;
  int get secondsLeft => _running ? _secondsLeft : 0;
  bool get running => _running;

  /// Stopped by the person (not by the window running out).
  bool get stopped => _stopped;

  /// The window has run out: no more re-checks until Check again.
  bool get exhausted => _autoChecks >= maxAutoChecks;

  /// After a "not found": count down to the next re-check, unless the window
  /// is used up or the person stopped it.
  void scheduleNext() {
    if (_stopped || exhausted) {
      _running = false;
      return;
    }
    _running = true;
    _secondsLeft = interval.inSeconds;
  }

  /// One second passed. True when it is time to check again (the countdown
  /// then waits for [scheduleNext] after that check answers).
  bool tick() {
    if (!_running) return false;
    _secondsLeft -= 1;
    if (_secondsLeft > 0) return false;
    _running = false;
    _autoChecks += 1;
    return true;
  }

  void stop() {
    _running = false;
    _stopped = true;
  }

  /// Check again by hand: a new window.
  void reset() {
    _autoChecks = 0;
    _secondsLeft = 0;
    _running = false;
    _stopped = false;
  }
}

/// The platform the Link token is made for.
String bankLinkPlatform({required bool isIOS}) => isIOS ? 'ios' : 'android';

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

/// `createBankLinkToken`: [platform] is `ios` or `android`.
Map<String, Object?> createBankLinkTokenRequest(
  String businessId, {
  required String platform,
}) => {'businessId': businessId, 'platform': platform};

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

/// `checkZellePayment`.
Map<String, Object?> checkZellePaymentRequest(
  String businessId,
  ZelleCheckKind kind,
  String id,
) => {'businessId': businessId, 'kind': kind.wire, 'id': id};

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

/// A deposit the bank shows for the payment.
class ZelleConfirmation {
  const ZelleConfirmation({
    required this.amountCents,
    this.at,
    this.senderName = '',
    this.institutionName = '',
  });

  /// `{amountCents, atMs, senderName, institutionName}`; null without a
  /// positive amount (nothing was confirmed).
  static ZelleConfirmation? fromMap(Object? data) {
    if (data is! Map) return null;
    final map = callableMap(data);
    final cents = _optionalInt(map['amountCents']);
    if (cents == null || cents <= 0) return null;
    return ZelleConfirmation(
      amountCents: cents,
      at: _instantOfMs(map['atMs']),
      senderName: _text(map['senderName'], 80),
      institutionName: _text(map['institutionName'], 80),
    );
  }

  final int amountCents;

  /// When the deposit landed (a true instant), if the bank said.
  final DateTime? at;
  final String senderName;
  final String institutionName;
}

/// One of several same-amount deposits: the person picks by sender name.
class ZelleCandidate {
  const ZelleCandidate({required this.creditId, this.at, this.senderName = ''});

  final String creditId;
  final DateTime? at;
  final String senderName;
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
                    senderName: _text(c['senderName'], 80),
                  ),
        ];
        // A choice of nothing (or one) is not a choice the sheet can offer.
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
  final DateTime? checkedAt;

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
    );
  }

  final bool connected;
  final BankLinkStatus status;
  final String institutionName;

  /// Digits only ("" when the server sent none).
  final String accountMask;
  final int windowMinutes;
  final DateTime? lastSyncAt;

  bool get needsReauth => connected && status == BankLinkStatus.needsReauth;
  bool get active => connected && status == BankLinkStatus.active;

  BusinessBankStatus copyWith({int? windowMinutes}) => BusinessBankStatus(
    connected: connected,
    status: status,
    institutionName: institutionName,
    accountMask: accountMask,
    windowMinutes: windowMinutes ?? this.windowMinutes,
    lastSyncAt: lastSyncAt,
  );
}

/// "•••• 1234", or "" without a mask.
String bankAccountMaskLabel(String mask) => mask.isEmpty ? '' : '•••• $mask';

/// `connectBusinessBank`: `{status, institutionName, accountMask}`.
class BankConnectResult {
  const BankConnectResult({
    required this.status,
    this.institutionName = '',
    this.accountMask = '',
  });

  factory BankConnectResult.fromCallable(Object? data) {
    final map = callableMap(data);
    return BankConnectResult(
      status: _bankLinkStatusOf(_text(map['status'], 20)),
      institutionName: _text(map['institutionName'], 80),
      accountMask: _text(map['accountMask'], 8).replaceAll(RegExp(r'\D'), ''),
    );
  }

  final BankLinkStatus status;
  final String institutionName;
  final String accountMask;
}

/// `createBankLinkToken`: `{linkToken, expiration}`; null without a token.
class BankLinkToken {
  const BankLinkToken({required this.linkToken, this.expiration = ''});

  static BankLinkToken? fromCallable(Object? data) {
    final map = callableMap(data);
    final token = _text(map['linkToken'], 400);
    if (token.isEmpty) return null;
    return BankLinkToken(
      linkToken: token,
      expiration: _text(map['expiration'], 60),
    );
  }

  final String linkToken;
  final String expiration;
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

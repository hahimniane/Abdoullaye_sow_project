// Phone accounts (docs/PHONE_ACCOUNTS.md): the pure half. Everything the
// app reads from the one `phoneAccount` callable, the refusals it sends, the
// "My packages" model and its grouping, the tracking page's sign-in hints,
// the staff warnings on a record's phones and the resend countdown. No
// Firebase here, so all of it is unit-tested (test/phone_accounts_test.dart).
// The calls themselves live in phone_account_service.dart.

import '../models/guest_tracking_result.dart';
import '../utils/callable_data.dart';

/// The one callable every phone-account action goes through (§5.1).
const phoneAccountCallable = 'phoneAccount';

/// `data.action` values the server dispatches on.
abstract final class PhoneAccountAction {
  static const requestCode = 'requestPhoneLoginCode';
  static const verifyCode = 'verifyPhoneLoginCode';
  static const completeSignIn = 'completePhoneSignIn';
  static const myShipments = 'getMyShipments';
  static const reportNotMine = 'reportShipmentNotMine';
  static const syncRecord = 'syncRecord';
}

/// The two people a record names.
abstract final class PhoneRole {
  static const sender = 'sender';
  static const receiver = 'receiver';
}

/// The `details.reason` values the server refuses with (§5-§6). Screens map
/// each one to their own words ([phoneAccountRefusalText]); the server's
/// English `message` is never shown.
abstract final class PhoneRefusalReason {
  static const phoneInvalid = 'phone_invalid';
  static const needsCountryCode = 'needs_country_code';
  static const trackingNotFound = 'tracking_not_found';
  static const noPhoneOnRecord = 'no_phone_on_record';
  static const rateLimited = 'rate_limited';
  static const whatsappUnavailable = 'whatsapp_unavailable';
  static const signInRequired = 'sign_in_required';
  static const codeWrong = 'code_wrong';
  static const codeExpired = 'code_expired';
  static const tooManyAttempts = 'too_many_attempts';
  static const challengeNotFound = 'challenge_not_found';
  static const phoneInUse = 'phone_in_use';
  static const wrongAccount = 'wrong_account';
  static const proofInvalid = 'proof_invalid';
  static const noVerifiedPhone = 'no_verified_phone';
  static const recordInvalid = 'record_invalid';

  /// Phone-code sign-in is for customers only: an account with business or
  /// platform access signs in with its email and password.
  static const phoneSignInUnavailable = 'phone_sign_in_unavailable';
}

/// A refused call, or one that never got through.
class PhoneAccountRefusal {
  const PhoneAccountRefusal({
    required this.code,
    this.reason = '',
    this.retryAfterMs,
    this.attemptsLeft,
  });

  /// The Functions code: `invalid-argument`, `failed-precondition`,
  /// `resource-exhausted`, `unavailable`...; `unknown` when nothing came.
  final String code;

  /// `details.reason`; '' when none came.
  final String reason;

  /// `rate_limited`: how long until another code may be sent.
  final int? retryAfterMs;

  /// `code_wrong`: tries left before the code locks.
  final int? attemptsLeft;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  /// The code can no longer be used: the screen asks for a new one and lets
  /// the person resend at once.
  bool get needsNewCode =>
      reason == PhoneRefusalReason.codeExpired ||
      reason == PhoneRefusalReason.tooManyAttempts ||
      reason == PhoneRefusalReason.challengeNotFound;

  /// The rate limit, rounded up to whole seconds (0 when none came).
  int get retryAfterSeconds {
    final ms = retryAfterMs ?? 0;
    if (ms <= 0) return 0;
    return (ms + 999) ~/ 1000;
  }
}

PhoneAccountRefusal parsePhoneAccountRefusal(String code, Object? details) {
  final d = callableMap(details);
  int? count(Object? value) =>
      value is num && value.isFinite && value >= 0 ? value.round() : null;
  return PhoneAccountRefusal(
    code: code.trim().toLowerCase(),
    reason: callableString(d['reason']),
    retryAfterMs: count(d['retryAfterMs']),
    attemptsLeft: count(d['attemptsLeft']),
  );
}

/// What PhoneAccountService throws; screens read [refusal].
class PhoneAccountFailure implements Exception {
  const PhoneAccountFailure(this.refusal);

  final PhoneAccountRefusal refusal;

  String get reason => refusal.reason;

  @override
  String toString() => 'PhoneAccountFailure(${refusal.code} ${refusal.reason})';
}

// ---------------------------------------------------------------------------
// Requests and answers of the code flow (§5).
// ---------------------------------------------------------------------------

/// Where a code goes. A typed number, the masked tracking-link flow (the app
/// never sees the record's number), or a number a signed-in account proves
/// to add it (§7).
sealed class PhoneCodeRequest {
  const PhoneCodeRequest();

  Map<String, Object?> toPayload();
}

class TypedPhoneCodeRequest extends PhoneCodeRequest {
  const TypedPhoneCodeRequest(this.phone);

  final String phone;

  @override
  Map<String, Object?> toPayload() => {
    'action': PhoneAccountAction.requestCode,
    'phone': phone.trim(),
  };
}

class TrackingPhoneCodeRequest extends PhoneCodeRequest {
  const TrackingPhoneCodeRequest({
    required this.trackingCode,
    required this.role,
    this.lastTwo = '',
  });

  final String trackingCode;

  /// [PhoneRole.sender] or [PhoneRole.receiver].
  final String role;

  /// What the page showed ("••35"), before the server answered.
  final String lastTwo;

  @override
  Map<String, Object?> toPayload() => {
    'action': PhoneAccountAction.requestCode,
    'trackingCode': trackingCode.trim().toUpperCase(),
    'role': role == PhoneRole.receiver ? PhoneRole.receiver : PhoneRole.sender,
  };
}

class LinkPhoneCodeRequest extends PhoneCodeRequest {
  const LinkPhoneCodeRequest(this.phone);

  final String phone;

  @override
  Map<String, Object?> toPayload() => {
    'action': PhoneAccountAction.requestCode,
    'phone': phone.trim(),
    'purpose': 'link',
  };
}

/// The fallback resend wait when the server names none (§5.1: 30 s).
const defaultResendAfterMs = 30000;

class PhoneLoginChallenge {
  const PhoneLoginChallenge({
    required this.challengeId,
    this.channel = 'whatsapp',
    this.lastTwo = '',
    this.expiresAtMs = 0,
    this.resendAfterMs = defaultResendAfterMs,
  });

  final String challengeId;
  final String channel;
  final String lastTwo;
  final int expiresAtMs;
  final int resendAfterMs;

  int get resendAfterSeconds {
    final ms = resendAfterMs <= 0 ? defaultResendAfterMs : resendAfterMs;
    return (ms + 999) ~/ 1000;
  }

  /// Null when the answer carries no challenge.
  static PhoneLoginChallenge? fromCallable(Object? raw) {
    final d = callableMap(raw);
    final id = callableString(d['challengeId']);
    if (id.isEmpty) return null;
    final resend = callableInt(d['resendAfterMs']);
    return PhoneLoginChallenge(
      challengeId: id,
      channel: callableString(d['channel'], 'whatsapp'),
      lastTwo: callableString(d['lastTwo']),
      expiresAtMs: callableInt(d['expiresAtMs']),
      resendAfterMs: resend > 0 ? resend : defaultResendAfterMs,
    );
  }
}

Map<String, Object?> verifyCodePayload(String challengeId, String code) => {
  'action': PhoneAccountAction.verifyCode,
  'challengeId': challengeId.trim(),
  'code': code.trim(),
};

/// `verifyPhoneLoginCode`: a sign-in token, or (link) what happened to the
/// number.
class PhoneCodeVerified {
  const PhoneCodeVerified({
    this.customToken = '',
    this.uid = '',
    this.isNewAccount = false,
    this.linked = false,
    this.merged = false,
  });

  final String customToken;
  final String uid;
  final bool isNewAccount;
  final bool linked;
  final bool merged;

  bool get signsIn => customToken.isNotEmpty;

  factory PhoneCodeVerified.fromCallable(Object? raw) {
    final d = callableMap(raw);
    return PhoneCodeVerified(
      customToken: callableString(d['customToken']),
      uid: callableString(d['uid']),
      isNewAccount: callableBool(d['isNewAccount']),
      linked: callableBool(d['linked']),
      merged: callableBool(d['merged']),
    );
  }
}

Map<String, Object?> completeSignInPayload({String placeholderIdToken = ''}) =>
    {
      'action': PhoneAccountAction.completeSignIn,
      if (placeholderIdToken.trim().isNotEmpty)
        'placeholderIdToken': placeholderIdToken.trim(),
    };

/// `completePhoneSignIn`: the sign-in bookkeeping, or (with a placeholder's
/// proof) the merge.
class PhoneSignInCompleted {
  const PhoneSignInCompleted({
    this.uid = '',
    this.profileCreated = false,
    this.isNewAccount = false,
    this.linked = false,
    this.merged = false,
  });

  final String uid;
  final bool profileCreated;
  final bool isNewAccount;
  final bool linked;
  final bool merged;

  factory PhoneSignInCompleted.fromCallable(Object? raw) {
    final d = callableMap(raw);
    return PhoneSignInCompleted(
      uid: callableString(d['uid']),
      profileCreated: callableBool(d['profileCreated']),
      isNewAccount: callableBool(d['isNewAccount']),
      linked: callableBool(d['linked']),
      merged: callableBool(d['merged']),
    );
  }
}

// ---------------------------------------------------------------------------
// My packages (§6).
// ---------------------------------------------------------------------------

/// Where the next page starts: `{beforeMs, skipKeys}` as the server sent it.
class MyShipmentsCursor {
  const MyShipmentsCursor({required this.beforeMs, this.skipKeys = const []});

  final int beforeMs;
  final List<String> skipKeys;

  Map<String, Object?> toMap() => {'beforeMs': beforeMs, 'skipKeys': skipKeys};

  static MyShipmentsCursor? fromCallable(Object? raw) {
    if (raw is! Map) return null;
    final d = callableMap(raw);
    final before = callableInt(d['beforeMs']);
    if (before <= 0) return null;
    final keys = d['skipKeys'] is List
        ? [
            for (final key in d['skipKeys'] as List)
              if (callableString(key).isNotEmpty) callableString(key),
          ]
        : const <String>[];
    return MyShipmentsCursor(beforeMs: before, skipKeys: keys);
  }
}

Map<String, Object?> myShipmentsPayload({MyShipmentsCursor? cursor}) => {
  'action': PhoneAccountAction.myShipments,
  if (cursor != null) 'cursor': cursor.toMap(),
};

/// A record the app created directly (the legacy transport form): its phone
/// fields and accounts now, not at its first update (§3.1).
Map<String, Object?> syncRecordPayload({
  required String collection,
  required String id,
}) => {'action': PhoneAccountAction.syncRecord, 'key': '$collection/$id'};

Map<String, Object?> reportNotMinePayload({
  required String key,
  required String role,
}) => {
  'action': PhoneAccountAction.reportNotMine,
  'key': key,
  'role': role == PhoneRole.receiver ? PhoneRole.receiver : PhoneRole.sender,
};

/// The service word on the wire for a package request (it is not a
/// guest-tracking service).
const packageRequestService = 'package_request';

class MyShipmentPart {
  const MyShipmentPart({
    required this.trackingCode,
    required this.stage,
    required this.pieceCount,
  });

  final String trackingCode;
  final GuestTrackingStage? stage;
  final int pieceCount;
}

/// One record in "My packages": what the WhatsApp link already shows, never
/// a price, plus who it is from. Unknown services and stages are kept (an
/// older app meets a newer server) and read as "Shipment" / no stage.
class MyShipmentItem {
  const MyShipmentItem({
    required this.key,
    required this.collection,
    required this.role,
    this.roles = const [],
    this.businessId = '',
    this.businessName = '',
    this.service = '',
    this.trackingCode = '',
    this.stage = '',
    this.pieceCount = 0,
    this.parts = const [],
    this.shipping,
    this.quoteCount = 0,
    this.requestStatus = '',
    this.createdAtMs = 0,
    this.updatedAtMs = 0,
  });

  /// `<collection>/<id>`: what "This isn't mine" names.
  final String key;
  final String collection;

  /// sender | receiver (sender when both).
  final String role;
  final List<String> roles;
  final String businessId;
  final String businessName;

  /// The wire word: barrel, freight, container, package_request...
  final String service;
  final String trackingCode;

  /// The wire stage: booked, in_transit, ... (`requested` for a request).
  final String stage;
  final int pieceCount;
  final List<MyShipmentPart> parts;
  final GuestContainerShipping? shipping;
  final int quoteCount;
  final String requestStatus;
  final int createdAtMs;
  final int updatedAtMs;

  bool get isReceiver => role == PhoneRole.receiver;
  bool get isPackageRequest => service == packageRequestService;

  /// Sent to oneself: the card says both.
  bool get sentToSelf =>
      roles.contains(PhoneRole.sender) && roles.contains(PhoneRole.receiver);

  /// The guest-tracking service, so its words are reused; null for a
  /// package request or a service this app does not know.
  GuestTrackingServiceType? get serviceType =>
      guestTrackingServiceOrNull(service);

  /// The guest-tracking stage, so its words are reused; null for a package
  /// request's `requested` or an unknown stage.
  GuestTrackingStage? get stageValue => guestTrackingStageOrNull(stage);

  DateTime? get createdAt =>
      createdAtMs > 0 ? DateTime.fromMillisecondsSinceEpoch(createdAtMs) : null;
  DateTime? get updatedAt =>
      updatedAtMs > 0 ? DateTime.fromMillisecondsSinceEpoch(updatedAtMs) : null;

  /// Null when the row cannot be named (no key): it could not be reported.
  static MyShipmentItem? fromCallable(Object? raw) {
    final d = callableMap(raw);
    final key = callableString(d['key']);
    if (key.isEmpty || !key.contains('/')) return null;
    final rawRole = callableString(d['role']);
    final role = rawRole == PhoneRole.receiver
        ? PhoneRole.receiver
        : PhoneRole.sender;
    final roles = d['roles'] is List
        ? [
            for (final r in d['roles'] as List)
              if (r == PhoneRole.sender || r == PhoneRole.receiver) r as String,
          ]
        : <String>[];
    if (roles.isEmpty) roles.add(role);
    final service = callableString(d['service']);
    final serviceType = guestTrackingServiceOrNull(service);
    return MyShipmentItem(
      key: key,
      collection: callableString(d['collection'], key.split('/').first),
      role: role,
      roles: roles,
      businessId: callableString(d['businessId']),
      businessName: callableString(d['businessName']),
      service: service,
      trackingCode: callableString(d['trackingCode']),
      stage: callableString(d['stage']),
      pieceCount: _count(d['pieceCount']),
      parts: d['parts'] is List
          ? [
              for (final part in d['parts'] as List)
                if (part is Map &&
                    callableString(part['trackingCode']).isNotEmpty)
                  MyShipmentPart(
                    trackingCode: callableString(part['trackingCode']),
                    stage: guestTrackingStageOrNull(part['stage']),
                    pieceCount: _count(part['pieceCount']),
                  ),
            ]
          : const [],
      shipping: serviceType == null
          ? null
          : GuestContainerShipping.fromWire(serviceType, d['shipping']),
      quoteCount: _count(d['quoteCount']),
      requestStatus: callableString(d['requestStatus']),
      createdAtMs: callableInt(d['createdAtMs']),
      updatedAtMs: callableInt(d['updatedAtMs']),
    );
  }
}

int _count(Object? value) =>
    value is num && value.isFinite && value > 0 ? value.round() : 0;

class MyShipmentsPage {
  const MyShipmentsPage({
    this.items = const [],
    this.nextCursor,
    this.phoneLastTwo = '',
  });

  final List<MyShipmentItem> items;
  final MyShipmentsCursor? nextCursor;
  final String phoneLastTwo;

  bool get hasMore => nextCursor != null;

  factory MyShipmentsPage.fromCallable(Object? raw) {
    final d = callableMap(raw);
    final rows = d['items'] is List ? d['items'] as List : const [];
    return MyShipmentsPage(
      items: [
        for (final row in rows)
          ?MyShipmentItem.fromCallable(row),
      ],
      nextCursor: MyShipmentsCursor.fromCallable(d['nextCursor']),
      phoneLastTwo: callableString(d['phoneLastTwo']),
    );
  }
}

/// A page appended to what is shown: one card per record (a later copy of
/// a key replaces nothing - the first, newer read stays).
List<MyShipmentItem> appendShipmentPage(
  List<MyShipmentItem> shown,
  List<MyShipmentItem> page,
) {
  final seen = {for (final item in shown) item.key};
  return [
    ...shown,
    for (final item in page)
      if (seen.add(item.key)) item,
  ];
}

/// One business's cards in a section, newest first.
class MyShipmentGroup {
  const MyShipmentGroup({
    required this.businessId,
    required this.businessName,
    required this.items,
  });

  final String businessId;
  final String businessName;
  final List<MyShipmentItem> items;
}

class MyShipmentSections {
  const MyShipmentSections({required this.mine, required this.comingToYou});

  /// "My packages": the person sent it (or sent it to themselves).
  final List<MyShipmentGroup> mine;

  /// "Coming to you": `role == receiver`.
  final List<MyShipmentGroup> comingToYou;

  bool get isEmpty => mine.isEmpty && comingToYou.isEmpty;
}

/// The screen's sections: each grouped by business, a business placed by its
/// newest item, items newest first. One pass after one sort - computed once
/// per answer, never per card.
MyShipmentSections groupMyShipments(List<MyShipmentItem> items) {
  final sorted = [...items]
    ..sort((a, b) {
      final byTime = b.createdAtMs.compareTo(a.createdAtMs);
      return byTime != 0 ? byTime : a.key.compareTo(b.key);
    });
  List<MyShipmentGroup> group(Iterable<MyShipmentItem> rows) {
    final order = <String>[];
    final byBusiness = <String, List<MyShipmentItem>>{};
    final names = <String, String>{};
    for (final item in rows) {
      // No business id: grouped under its name, so it still has a header.
      final id = item.businessId.isNotEmpty
          ? item.businessId
          : 'name:${item.businessName}';
      if (!byBusiness.containsKey(id)) {
        order.add(id);
        byBusiness[id] = [];
      }
      byBusiness[id]!.add(item);
      if ((names[id] ?? '').isEmpty && item.businessName.isNotEmpty) {
        names[id] = item.businessName;
      }
    }
    return [
      for (final id in order)
        MyShipmentGroup(
          businessId: id.startsWith('name:') ? '' : id,
          businessName: names[id] ?? '',
          items: byBusiness[id]!,
        ),
    ];
  }

  return MyShipmentSections(
    mine: group(sorted.where((item) => !item.isReceiver)),
    comingToYou: group(sorted.where((item) => item.isReceiver)),
  );
}

// ---------------------------------------------------------------------------
// The tracking page's sign-in hints (§10).
// ---------------------------------------------------------------------------

/// "Sign in as the number ending in ••35": a role and the last two digits,
/// never more of the number.
class TrackingSignInHint {
  const TrackingSignInHint({required this.role, required this.lastTwo});

  final String role;
  final String lastTwo;

  static List<TrackingSignInHint> listFrom(Object? raw) {
    if (raw is! List) return const [];
    final hints = <TrackingSignInHint>[];
    for (final entry in raw) {
      if (entry is! Map) continue;
      final role = entry['role'];
      final lastTwo = callableString(entry['lastTwo']);
      if (role != PhoneRole.sender && role != PhoneRole.receiver) continue;
      if (!RegExp(r'^\d{1,4}$').hasMatch(lastTwo)) continue;
      if (hints.any((hint) => hint.role == role)) continue;
      hints.add(TrackingSignInHint(role: role as String, lastTwo: lastTwo));
    }
    return hints;
  }
}

/// With two numbers on a record the buttons name the role; with one they do
/// not need to.
bool hintsNameTheRole(List<TrackingSignInHint> hints) => hints.length > 1;

// ---------------------------------------------------------------------------
// Staff warnings on a record's phones (§3).
// ---------------------------------------------------------------------------

abstract final class RecordPhoneField {
  static const customer = 'customerPhone';
  static const receiver = 'receiverPhone';
}

/// What staff are told beside one of a record's phones.
class RecordPhoneFlags {
  const RecordPhoneFlags({
    this.needsCountryCode = false,
    this.reportedNotMine = false,
  });

  /// In `phoneCountryCodeMissing`: "Add the country code".
  final bool needsCountryCode;

  /// In `phoneReportedNotMine`: "The person says this number isn't theirs".
  final bool reportedNotMine;

  bool get any => needsCountryCode || reportedNotMine;

  static const none = RecordPhoneFlags();
}

/// A server-written list of raw field names; absent or malformed is empty.
List<String> recordPhoneFieldList(Object? raw) {
  if (raw is! List) return const [];
  return [
    for (final value in raw)
      if (value == RecordPhoneField.customer ||
          value == RecordPhoneField.receiver)
        value as String,
  ];
}

RecordPhoneFlags recordPhoneFlags({
  required String field,
  required List<String> countryCodeMissing,
  required List<String> reportedNotMine,
}) => RecordPhoneFlags(
  needsCountryCode: countryCodeMissing.contains(field),
  reportedNotMine: reportedNotMine.contains(field),
);

/// The same, read off a raw record map (a parking entry's fields).
RecordPhoneFlags recordPhoneFlagsOf(Map<String, dynamic> data, String field) =>
    recordPhoneFlags(
      field: field,
      countryCodeMissing: recordPhoneFieldList(data['phoneCountryCodeMissing']),
      reportedNotMine: recordPhoneFieldList(data['phoneReportedNotMine']),
    );

// ---------------------------------------------------------------------------
// The resend countdown.
// ---------------------------------------------------------------------------

/// "Resend code in 30s": a pure counter the screen ticks once a second (the
/// ZelleRetryCountdown lesson - a widget test drives it with
/// `pump(Duration)`, and nothing spins while it waits).
class ResendCountdown {
  int _secondsLeft = 0;

  int get secondsLeft => _secondsLeft;
  bool get waiting => _secondsLeft > 0;

  void start(int seconds) => _secondsLeft = seconds < 0 ? 0 : seconds;

  /// One second passed. True when the wait just ended.
  bool tick() {
    if (_secondsLeft <= 0) return false;
    _secondsLeft -= 1;
    return _secondsLeft == 0;
  }

  void clear() => _secondsLeft = 0;
}

/// Six digits, nothing else.
bool isCompleteLoginCode(String value) =>
    RegExp(r'^\d{6}$').hasMatch(value.trim());

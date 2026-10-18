/// Package requests (docs/PACKAGE_REQUESTS.md §8): a customer asks a shipping
/// business to take some pieces ("Bring it in" or "Collect from me"), the
/// business answers with an estimate, the customer confirms, and the pieces
/// arrive as a waiting line.
///
/// Everything here is pure - parsing what the server writes or answers, the
/// checks the server makes (mirrored so a field is flagged before the round
/// trip), which state a request is in for the customer and for the business,
/// the estimate lock, the payloads the callables take, and the links that
/// open these screens. The screens are thin glue over it, and every rule is
/// unit-tested in `test/package_requests_test.dart`.
///
/// The server is the authority: every check here is advisory, and a refusal
/// is mapped from its `details.reason` (never its English `message`).
library;

import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;

import '../utils/money_input.dart' show parseMoneyCents;
import 'eastern_clock.dart';
import 'line_pieces.dart' as lp;
import 'lot_ledger.dart' show formatLotCents;
import 'package_codes.dart' show packageLinkHost;

// ---------------------------------------------------------------------------
// Vocabulary (§8.2 / §8.3).
// ---------------------------------------------------------------------------

const requestStatusNew = 'new';
const requestStatusEstimateSent = 'estimate_sent';
const requestStatusConfirmed = 'confirmed';
const requestStatusReceived = 'received';
const requestStatusDeclined = 'declined';
const requestStatusCustomerDeclined = 'customer_declined';
const requestStatusCancelled = 'cancelled';
const requestStatusExpired = 'expired';

/// The statuses the business still has work on: the Requests list and the
/// Expected section read exactly these.
const requestOpenStatuses = <String>[
  requestStatusNew,
  requestStatusEstimateSent,
  requestStatusConfirmed,
];

const requestHandoffBringIn = 'bring_in';
const requestHandoffCollect = 'collect';

const requestWindowMorning = 'morning';
const requestWindowAfternoon = 'afternoon';
const requestWindowEvening = 'evening';
const requestPickupWindows = <String>[
  requestWindowMorning,
  requestWindowAfternoon,
  requestWindowEvening,
];

const requestPieceBarrel = 'barrel';
const requestPieceBox = 'box';
const requestPieceOther = 'other';
const requestPieceKinds = <String>[
  requestPieceBarrel,
  requestPieceBox,
  requestPieceOther,
];

/// Server limits (§8.5 `submitPackageRequest`).
const requestMaxPieces = 20;
const requestMaxPhotosPerPiece = 5;
const requestMaxName = 80;
const requestMaxDescription = 120;
const requestMaxAddress = 200;
const requestMaxNote = 300;
const requestMaxReason = 300;
const requestMaxAreas = 300;
const requestPlannedDaysAhead = 60;

/// `amount_invalid` above this (§8.6 `sendPackageEstimate`).
const requestMaxCents = 10000000;

/// The estimate lock lasts 15 minutes; the editor renews it every 5.
const requestLockHeartbeat = Duration(minutes: 5);

/// The business's zone when its settings name none.
const requestDefaultTimeZone = 'America/New_York';

/// The weekday keys of opening hours, Monday first.
const requestWeekdays = <String>[
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
];

/// The request page and the request link (§8.8).
const requestLinkHost = 'laawoldigital.com';
String requestLinkForSlug(String slug) => 'https://$requestLinkHost/r/$slug';
String estimateLinkForToken(String token) =>
    'https://$packageLinkHost/e/$token';

/// Money as the rest of the app shows it: "$1,234.50".
String formatRequestCents(int cents) => formatLotCents(cents);

// ---------------------------------------------------------------------------
// Reading what the server wrote or answered.
// ---------------------------------------------------------------------------

String _text(Object? value) => value == null ? '' : value.toString().trim();

int? _intOrNull(Object? value) {
  if (value is int) return value;
  if (value is num && value.isFinite) return value.truncate();
  if (value is String) return int.tryParse(value.trim());
  return null;
}

int _int(Object? value) => _intOrNull(value) ?? 0;

bool _bool(Object? value) => value == true;

Map<String, dynamic> _map(Object? value) {
  if (value is Map) {
    return {for (final e in value.entries) e.key.toString(): e.value};
  }
  return const <String, dynamic>{};
}

List<Object?> _list(Object? value) =>
    value is Iterable ? value.toList() : const <Object?>[];

/// A time the server wrote: a Firestore Timestamp, a callable's ISO string,
/// epoch milliseconds, or a serialized `{_seconds}` map. Null otherwise.
DateTime? requestTime(Object? value) {
  if (value == null) return null;
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
  if (value is num && value.isFinite) {
    return DateTime.fromMillisecondsSinceEpoch(value.truncate());
  }
  if (value is String) {
    final text = value.trim();
    if (text.isEmpty) return null;
    return DateTime.tryParse(text)?.toLocal();
  }
  if (value is Map) {
    final seconds = _intOrNull(value['_seconds'] ?? value['seconds']);
    if (seconds != null) {
      return DateTime.fromMillisecondsSinceEpoch(seconds * 1000);
    }
  }
  return null;
}

/// `[key]` as a time, else its epoch-ms twin `[key]Ms` (the server writes
/// both; 0 means unset).
DateTime? _timeOf(Map<String, dynamic> m, String key) {
  final direct = requestTime(m[key]);
  if (direct != null) return direct;
  final ms = _intOrNull(m['${key}Ms']) ?? 0;
  return ms > 0 ? DateTime.fromMillisecondsSinceEpoch(ms) : null;
}

/// One day of opening hours: open or closed, and "HH:MM" from / to.
class RequestDayHours {
  const RequestDayHours({this.open = false, this.from = '', this.to = ''});

  factory RequestDayHours.fromMap(Object? value) {
    final m = _map(value);
    return RequestDayHours(
      open: _bool(m['open']),
      from: _text(m['from']),
      to: _text(m['to']),
    );
  }

  final bool open;
  final String from;
  final String to;

  RequestDayHours copyWith({bool? open, String? from, String? to}) =>
      RequestDayHours(
        open: open ?? this.open,
        from: from ?? this.from,
        to: to ?? this.to,
      );

  Map<String, Object?> toMap() => {'open': open, 'from': from, 'to': to};

  @override
  bool operator ==(Object other) =>
      other is RequestDayHours &&
      other.open == open &&
      other.from == from &&
      other.to == to;

  @override
  int get hashCode => Object.hash(open, from, to);
}

/// A week of opening hours, `mon..sun`. A day not written is closed.
class RequestWeekHours {
  const RequestWeekHours(this.days);

  factory RequestWeekHours.fromMap(Object? value) {
    final m = _map(value);
    return RequestWeekHours({
      for (final day in requestWeekdays) day: RequestDayHours.fromMap(m[day]),
    });
  }

  /// Nine to six on weekdays and Saturday, closed Sunday: where the owner's
  /// editor starts for a location that has none.
  factory RequestWeekHours.standard() => RequestWeekHours({
    for (final day in requestWeekdays)
      day: day == 'sun'
          ? const RequestDayHours(from: '09:00', to: '18:00')
          : const RequestDayHours(open: true, from: '09:00', to: '18:00'),
  });

  final Map<String, RequestDayHours> days;

  RequestDayHours day(String key) => days[key] ?? const RequestDayHours();

  /// The hours for [date]'s weekday.
  RequestDayHours forDate(DateTime date) => day(weekdayKey(date));

  bool get anyOpen => days.values.any((d) => d.open);

  RequestWeekHours withDay(String key, RequestDayHours hours) =>
      RequestWeekHours({...days, key: hours});

  Map<String, Object?> toMap() => {
    for (final day in requestWeekdays) day: this.day(day).toMap(),
  };
}

/// `mon`..`sun` for [date].
String weekdayKey(DateTime date) => requestWeekdays[date.weekday - 1];

/// "2026-10-24" for a calendar day.
String requestDayKey(DateTime day) =>
    '${day.year.toString().padLeft(4, '0')}-'
    '${day.month.toString().padLeft(2, '0')}-'
    '${day.day.toString().padLeft(2, '0')}';

final _dayKey = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');

/// A "YYYY-MM-DD" key as that calendar day (local midnight), else null.
DateTime? requestDayFromKey(String key) {
  final m = _dayKey.firstMatch(key.trim());
  if (m == null) return null;
  final y = int.parse(m[1]!), mo = int.parse(m[2]!), d = int.parse(m[3]!);
  final date = DateTime(y, mo, d);
  if (date.year != y || date.month != mo || date.day != d) return null;
  return date;
}

/// Today in the business's zone. The app knows New York's rules exactly
/// (`eastern_clock.dart`); a business in another zone is read as New York
/// too - the server, which knows every zone, has the last word on a date.
DateTime requestToday(
  DateTime now, {
  String timeZone = requestDefaultTimeZone,
}) => shopToday(now);

/// The last day a customer may plan for: [today] plus 60 calendar days.
/// Counted in days, never as a Duration - 60 × 24 h across the end of
/// daylight time lands on the evening before.
DateTime requestLastPlannedDay(DateTime today) =>
    DateTime(today.year, today.month, today.day + requestPlannedDaysAhead);

final _hhmm = RegExp(r'^([01]\d|2[0-3]):([0-5]\d)$');

/// Minutes after midnight for "HH:MM", or null.
int? requestMinutesOf(String hhmm) {
  final m = _hhmm.firstMatch(hhmm.trim());
  if (m == null) return null;
  return int.parse(m[1]!) * 60 + int.parse(m[2]!);
}

/// "HH:MM" for minutes after midnight.
String requestHhmm(int minutes) {
  final h = (minutes ~/ 60) % 24;
  final m = minutes % 60;
  return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}';
}

class RequestLocation {
  const RequestLocation({
    required this.id,
    required this.label,
    required this.address,
    this.hours,
  });

  factory RequestLocation.fromMap(Object? value) {
    final m = _map(value);
    return RequestLocation(
      id: _text(m['id']),
      label: _text(m['label']),
      address: _text(m['address']),
      hours: m['hours'] == null ? null : RequestWeekHours.fromMap(m['hours']),
    );
  }

  final String id;
  final String label;
  final String address;
  final RequestWeekHours? hours;

  /// What a person reads first: the label, else the address.
  String get title => label.isNotEmpty ? label : address;
}

class RequestPickup {
  const RequestPickup({
    this.address = '',
    this.date = '',
    this.window = '',
    this.note = '',
  });

  factory RequestPickup.fromMap(Object? value) {
    final m = _map(value);
    return RequestPickup(
      address: _text(m['address']),
      date: _text(m['date']),
      window: _text(m['window']),
      note: _text(m['note']),
    );
  }

  final String address;
  final String date;
  final String window;
  final String note;
}

/// When the business will really come (an estimate's `pickupSchedule`).
class RequestSchedule {
  const RequestSchedule({required this.date, required this.window});

  static RequestSchedule? fromMap(Object? value) {
    final m = _map(value);
    final date = _text(m['date']);
    if (date.isEmpty) return null;
    return RequestSchedule(date: date, window: _text(m['window']));
  }

  final String date;
  final String window;

  Map<String, Object?> toMap() => {'date': date, 'window': window};
}

class RequestSize {
  const RequestSize(this.l, this.w, this.h);

  static RequestSize? fromMap(Object? value) {
    if (value is! Map) return null;
    double? n(Object? v) => v is num && v.isFinite ? v.toDouble() : null;
    final l = n(value['l']), w = n(value['w']), h = n(value['h']);
    if (l == null || w == null || h == null) return null;
    return RequestSize(l, w, h);
  }

  final double l;
  final double w;
  final double h;

  Map<String, Object?> toMap() => {'l': l, 'w': w, 'h': h};

  String get text {
    String f(double v) =>
        v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);
    return '${f(l)} × ${f(w)} × ${f(h)} in';
  }
}

class RequestPiece {
  const RequestPiece({
    required this.id,
    required this.kind,
    this.description = '',
    this.sizeIn,
    this.photoPaths = const [],
    this.photoCount = 0,
    this.estimateCents,
  });

  factory RequestPiece.fromMap(Object? value) {
    final m = _map(value);
    final paths = [
      for (final p in _list(m['photoPaths']))
        if (_text(p).isNotEmpty) _text(p),
    ];
    return RequestPiece(
      id: _text(m['id']),
      kind: _text(m['kind']),
      description: _text(m['description']),
      sizeIn: RequestSize.fromMap(m['sizeIn']),
      photoPaths: paths,
      photoCount: m['photoCount'] == null
          ? paths.length
          : _int(m['photoCount']),
      estimateCents: _intOrNull(m['estimateCents']),
    );
  }

  final String id;
  final String kind;
  final String description;
  final RequestSize? sizeIn;
  final List<String> photoPaths;
  final int photoCount;

  /// The price the server prefilled (a barrel's per-barrel price), or null.
  final int? estimateCents;

  bool get isBarrel => kind == requestPieceBarrel;
}

class RequestEstimate {
  const RequestEstimate({
    required this.version,
    required this.totalCents,
    this.pieceCents = const {},
    this.pickupFeeCents,
    this.pickupSchedule,
    this.note = '',
    this.sentByUid = '',
    this.sentByName = '',
    this.sentAt,
    this.auto = false,
  });

  static RequestEstimate? fromMap(Object? value) {
    if (value is! Map) return null;
    final m = _map(value);
    return RequestEstimate(
      version: _int(m['version']),
      totalCents: _int(m['totalCents']),
      pieceCents: {
        for (final p in _list(m['pieces']))
          if (_text(_map(p)['id']).isNotEmpty)
            _text(_map(p)['id']): _int(_map(p)['cents']),
      },
      pickupFeeCents: _intOrNull(m['pickupFeeCents']),
      pickupSchedule: RequestSchedule.fromMap(m['pickupSchedule']),
      note: _text(m['note']),
      sentByUid: _text(m['sentByUid']),
      sentByName: _text(m['sentByName']),
      sentAt: _timeOf(m, 'sentAt'),
      auto: _bool(m['auto']),
    );
  }

  final int version;
  final int totalCents;

  /// Each piece's price by piece id.
  final Map<String, int> pieceCents;
  final int? pickupFeeCents;
  final RequestSchedule? pickupSchedule;
  final String note;
  final String sentByUid;
  final String sentByName;
  final DateTime? sentAt;

  /// Version 1 written by the server for an all-barrel request.
  final bool auto;
}

/// Who holds the estimate lock, and until when.
class RequestLock {
  const RequestLock({
    required this.uid,
    required this.name,
    required this.untilMs,
  });

  static RequestLock? fromMap(Object? value) {
    if (value is! Map) return null;
    final m = _map(value);
    final uid = _text(m['uid']);
    if (uid.isEmpty) return null;
    return RequestLock(
      uid: uid,
      name: _text(m['name']),
      untilMs: _int(m['untilMs']),
    );
  }

  final String uid;
  final String name;
  final int untilMs;

  bool isLive(int nowMs) => untilMs > nowMs;
}

class RequestHistoryEntry {
  const RequestHistoryEntry({
    required this.action,
    this.at,
    this.byUid = '',
    this.byName = '',
    this.version,
    this.totalCents,
    this.reason = '',
  });

  factory RequestHistoryEntry.fromMap(Object? value) {
    final m = _map(value);
    return RequestHistoryEntry(
      action: _text(m['action']),
      at: requestTime(m['atMs']),
      byUid: _text(m['byUid']),
      byName: _text(m['byName']),
      version: _intOrNull(m['version']),
      totalCents: _intOrNull(m['totalCents']),
      reason: _text(m['reason']),
    );
  }

  final String action;
  final DateTime? at;
  final String byUid;
  final String byName;
  final int? version;
  final int? totalCents;
  final String reason;
}

/// A request, from its Firestore document (business staff, the signed-in
/// sender) or from `getPackageRequestByToken`'s public projection. The two
/// shapes name a few things differently; both read into this.
class PackageRequest {
  const PackageRequest({
    required this.id,
    required this.status,
    this.businessId = '',
    this.businessName = '',
    this.businessPhone = '',
    this.code = '',
    this.token = '',
    this.handoff = '',
    this.location,
    this.plannedDate = '',
    this.pickup,
    this.senderName = '',
    this.senderPhone = '',
    this.senderUid = '',
    this.receiverName = '',
    this.receiverPhone = '',
    this.destinationCountryId = '',
    this.destinationCountryName = '',
    this.pieces = const [],
    this.estimate,
    this.estimateHistory = const [],
    this.confirmedVersion,
    this.confirmedAt,
    this.confirmedVia = '',
    this.confirmedTotalCents,
    this.priceDropped = false,
    this.lock,
    this.expiresAt,
    this.lineId = '',
    this.trackingCode = '',
    this.receivedAt,
    this.paymentTiming = '',
    this.paidCents = 0,
    this.isCardOrder = false,
    this.language = '',
    this.declineReason = '',
    this.whatsappUnreachable = false,
    this.history = const [],
    this.createdAt,
    this.updatedAt,
    this.timeZone = requestDefaultTimeZone,
  });

  factory PackageRequest.fromMap(String id, Map<String, dynamic> d) {
    final business = _map(d['business']);
    final destination = _map(d['destination']);
    final sender = _map(d['sender']);
    final receiver = _map(d['receiver']);
    final payment = _map(d['payment']);
    final locationMap = d['location'];
    final location = locationMap is Map
        ? RequestLocation.fromMap(locationMap)
        : (_text(d['locationId']).isEmpty
              ? null
              : RequestLocation(
                  id: _text(d['locationId']),
                  label: '',
                  address: '',
                ));
    final pickup = d['pickup'] is Map
        ? RequestPickup.fromMap(d['pickup'])
        : null;
    final zone = _text(d['timeZone']);
    return PackageRequest(
      id: id.isNotEmpty ? id : _text(d['id']),
      status: _text(d['status']),
      businessId: _text(d['businessId']).isNotEmpty
          ? _text(d['businessId'])
          : _text(business['id']),
      businessName: _text(d['businessName']).isNotEmpty
          ? _text(d['businessName'])
          : _text(business['name']),
      businessPhone: _text(business['phone']),
      code: _text(d['code']),
      token: _text(d['token']),
      handoff: _text(d['handoff']),
      location: location,
      plannedDate: _text(d['plannedDate']),
      pickup: pickup,
      senderName: _text(sender['name']),
      senderPhone: _text(sender['phoneE164']),
      senderUid: _text(sender['uid']),
      receiverName: _text(receiver['name']),
      receiverPhone: _text(receiver['phoneE164']),
      destinationCountryId: _text(d['destinationCountryId']).isNotEmpty
          ? _text(d['destinationCountryId'])
          : _text(destination['id']),
      destinationCountryName: _text(d['destinationCountryName']).isNotEmpty
          ? _text(d['destinationCountryName'])
          : _text(destination['name']),
      pieces: [for (final p in _list(d['pieces'])) RequestPiece.fromMap(p)],
      estimate: RequestEstimate.fromMap(d['estimate']),
      estimateHistory: [
        for (final e in _list(d['estimateHistory']))
          if (RequestEstimate.fromMap(e) case final RequestEstimate est) est,
      ],
      confirmedVersion: _intOrNull(d['confirmedVersion']),
      confirmedAt: _timeOf(d, 'confirmedAt'),
      confirmedVia: _text(d['confirmedVia']),
      confirmedTotalCents: _intOrNull(d['confirmedTotalCents']),
      priceDropped: _bool(d['priceDropped']),
      lock: RequestLock.fromMap(d['lock']),
      expiresAt: _timeOf(d, 'expiresAt'),
      lineId: _text(d['lineId']),
      trackingCode: _text(d['trackingCode']),
      receivedAt: _timeOf(d, 'receivedAt'),
      paymentTiming: _text(payment['timing']),
      paidCents: _int(payment['paidCents']),
      isCardOrder:
          d['cardOrder'] is Map ||
          _text(payment['timing']) == 'card' ||
          _text(d['confirmedVia']) == 'card',
      language: _text(d['language']),
      declineReason: _text(d['declineReason']),
      whatsappUnreachable: _bool(d['whatsappUnreachable']),
      history: [
        for (final h in _list(d['history'])) RequestHistoryEntry.fromMap(h),
      ],
      createdAt: _timeOf(d, 'createdAt'),
      updatedAt: requestTime(d['updatedAt']),
      timeZone: zone.isEmpty ? requestDefaultTimeZone : zone,
    );
  }

  final String id;
  final String status;
  final String businessId;
  final String businessName;

  /// Only the public projection carries it.
  final String businessPhone;
  final String code;
  final String token;
  final String handoff;
  final RequestLocation? location;
  final String plannedDate;
  final RequestPickup? pickup;
  final String senderName;
  final String senderPhone;
  final String senderUid;
  final String receiverName;
  final String receiverPhone;
  final String destinationCountryId;
  final String destinationCountryName;
  final List<RequestPiece> pieces;
  final RequestEstimate? estimate;
  final List<RequestEstimate> estimateHistory;
  final int? confirmedVersion;
  final DateTime? confirmedAt;
  final String confirmedVia;
  final int? confirmedTotalCents;
  final bool priceDropped;
  final RequestLock? lock;
  final DateTime? expiresAt;
  final String lineId;
  final String trackingCode;
  final DateTime? receivedAt;
  final String paymentTiming;
  final int paidCents;
  final bool isCardOrder;
  final String language;
  final String declineReason;
  final bool whatsappUnreachable;
  final List<RequestHistoryEntry> history;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String timeZone;

  bool get isCollect => handoff == requestHandoffCollect;
  bool get isBringIn => !isCollect;
  bool get isOpen => requestOpenStatuses.contains(status);
  int get version => estimate?.version ?? 0;

  /// What the customer owes on the latest estimate, or null with none.
  int? get totalCents => estimate?.totalCents;

  /// A piece's price on the latest estimate, else what the server prefilled.
  int? priceOf(RequestPiece piece) =>
      estimate?.pieceCents[piece.id] ?? piece.estimateCents;

  /// When the customer said they would come, or the pickup day asked for -
  /// or the day the business scheduled, once its estimate names one.
  String get handoffDay => isCollect
      ? (estimate?.pickupSchedule?.date ?? pickup?.date ?? '')
      : plannedDate;

  String get handoffWindow => isCollect
      ? (estimate?.pickupSchedule?.window ?? pickup?.window ?? '')
      : '';
}

// ---------------------------------------------------------------------------
// listPackageRequestOptions.
// ---------------------------------------------------------------------------

class RequestBusiness {
  const RequestBusiness({
    required this.businessId,
    required this.name,
    this.phone = '',
    this.profileImageUrl = '',
    this.slug = '',
    this.acceptRequests = true,
  });

  static RequestBusiness? fromMap(Object? value) {
    if (value is! Map) return null;
    final m = _map(value);
    return RequestBusiness(
      businessId: _text(m['businessId']),
      name: _text(m['name']),
      phone: _text(m['phone']),
      profileImageUrl: _text(m['profileImageUrl']),
      slug: _text(m['slug']),
      acceptRequests: m['acceptRequests'] != false,
    );
  }

  final String businessId;
  final String name;
  final String phone;
  final String profileImageUrl;
  final String slug;
  final bool acceptRequests;
}

/// One business × destination a customer may send to.
class RequestOption {
  const RequestOption({
    required this.businessId,
    required this.businessName,
    required this.countryId,
    required this.countryName,
    this.businessPhone = '',
    this.profileImageUrl = '',
    this.slug = '',
    this.barrelPriceCents,
    this.cardBarrelBooking = false,
    this.bringInAvailable = false,
    this.locations = const [],
    this.collectAvailable = false,
    this.collectAreas = '',
    this.timeZone = requestDefaultTimeZone,
  });

  factory RequestOption.fromMap(Object? value) {
    final m = _map(value);
    final country = _map(m['country']);
    final bring = _map(m['bringIn']);
    final collect = _map(m['collect']);
    final zone = _text(m['timeZone']);
    final locations = [
      for (final l in _list(bring['locations'])) RequestLocation.fromMap(l),
    ].where((l) => l.id.isNotEmpty).toList();
    return RequestOption(
      businessId: _text(m['businessId']),
      businessName: _text(m['businessName']),
      businessPhone: _text(m['businessPhone']),
      profileImageUrl: _text(m['profileImageUrl']),
      slug: _text(m['slug']),
      countryId: _text(country['id']),
      countryName: _text(country['name']),
      barrelPriceCents: _intOrNull(m['barrelPriceCents']),
      cardBarrelBooking: _bool(m['cardBarrelBooking']),
      bringInAvailable: _bool(bring['available']) && locations.isNotEmpty,
      locations: locations,
      collectAvailable: _bool(collect['available']),
      collectAreas: _text(collect['areas']),
      timeZone: zone.isEmpty ? requestDefaultTimeZone : zone,
    );
  }

  final String businessId;
  final String businessName;
  final String businessPhone;
  final String profileImageUrl;
  final String slug;
  final String countryId;
  final String countryName;

  /// Null: barrels need an estimate for this destination.
  final int? barrelPriceCents;
  final bool cardBarrelBooking;
  final bool bringInAvailable;
  final List<RequestLocation> locations;
  final bool collectAvailable;
  final String collectAreas;
  final String timeZone;

  bool get anyHandoff => bringInAvailable || collectAvailable;
}

class RequestOptions {
  const RequestOptions({this.business, this.options = const []});

  factory RequestOptions.fromResponse(Object? data) {
    final m = _map(data);
    return RequestOptions(
      business: RequestBusiness.fromMap(m['business']),
      options: [for (final o in _list(m['options'])) RequestOption.fromMap(o)]
          .where(
            (o) =>
                o.businessId.isNotEmpty &&
                o.countryId.isNotEmpty &&
                o.anyHandoff,
          )
          .toList(),
    );
  }

  /// The business a `/r/<slug>` link chose, else null.
  final RequestBusiness? business;
  final List<RequestOption> options;

  /// Every destination on offer, each once, by name.
  List<({String id, String name})> get countries {
    final seen = <String, String>{};
    for (final o in options) {
      seen.putIfAbsent(o.countryId, () => o.countryName);
    }
    final list = [
      for (final e in seen.entries)
        (id: e.key, name: e.value.isEmpty ? e.key : e.value),
    ]..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return list;
  }

  /// The businesses shipping to [countryId], by name.
  List<RequestOption> forCountry(String countryId) =>
      [
        for (final o in options)
          if (o.countryId == countryId) o,
      ]..sort(
        (a, b) => a.businessName.toLowerCase().compareTo(
          b.businessName.toLowerCase(),
        ),
      );
}

// ---------------------------------------------------------------------------
// The customer's form: what it holds, the server's checks, the payload.
// ---------------------------------------------------------------------------

class RequestPieceDraft {
  const RequestPieceDraft({
    this.kind = requestPieceBarrel,
    this.description = '',
    this.photoPaths = const [],
  });

  final String kind;
  final String description;

  /// Uploaded photos (Storage paths) for this piece.
  final List<String> photoPaths;

  RequestPieceDraft copyWith({
    String? kind,
    String? description,
    List<String>? photoPaths,
  }) => RequestPieceDraft(
    kind: kind ?? this.kind,
    description: description ?? this.description,
    photoPaths: photoPaths ?? this.photoPaths,
  );
}

class RequestDraft {
  const RequestDraft({
    required this.businessId,
    required this.destinationCountryId,
    required this.handoff,
    this.locationId = '',
    this.plannedDate = '',
    this.pickupAddress = '',
    this.pickupDate = '',
    this.pickupWindow = '',
    this.pickupNote = '',
    this.senderName = '',
    this.senderPhone = '',
    this.receiverName = '',
    this.receiverPhone = '',
    this.pieces = const [],
    this.language = 'en',
    this.idempotencyKey = '',
  });

  final String businessId;
  final String destinationCountryId;
  final String handoff;
  final String locationId;
  final String plannedDate;
  final String pickupAddress;
  final String pickupDate;
  final String pickupWindow;
  final String pickupNote;
  final String senderName;
  final String senderPhone;
  final String receiverName;
  final String receiverPhone;
  final List<RequestPieceDraft> pieces;
  final String language;
  final String idempotencyKey;
}

final _e164 = RegExp(r'^\+[1-9]\d{7,14}$');
bool isRequestPhone(String value) => _e164.hasMatch(value.trim());

final _idempotencyKey = RegExp(r'^[A-Za-z0-9_-]{8,80}$');

/// A fresh key for one press of Send: the same key sent again within ten
/// minutes returns the first request instead of a second one.
String newRequestIdempotencyKey([Random? random]) {
  const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  final r = random ?? Random.secure();
  return 'app_${List.generate(24, (_) => alphabet[r.nextInt(alphabet.length)]).join()}';
}

/// The checks `submitPackageRequest` makes, in its codes, against the option
/// the customer picked. [today] is today in the business's zone.
List<String> validateRequestDraft(
  RequestDraft draft, {
  required RequestOption option,
  required DateTime today,
}) {
  final reasons = <String>[];
  void add(String code) {
    if (!reasons.contains(code)) reasons.add(code);
  }

  final todayDay = DateTime(today.year, today.month, today.day);
  final lastDay = requestLastPlannedDay(todayDay);
  bool inWindow(DateTime d) => !d.isBefore(todayDay) && !d.isAfter(lastDay);

  if (draft.handoff == requestHandoffBringIn) {
    final location = option.locations
        .where((l) => l.id == draft.locationId)
        .firstOrNull;
    if (!option.bringInAvailable || location == null) {
      add('location_invalid');
    }
    final day = requestDayFromKey(draft.plannedDate);
    if (day == null || !inWindow(day)) {
      add('planned_date_invalid');
    } else if (location?.hours != null && !location!.hours!.forDate(day).open) {
      add('planned_day_closed');
    }
  } else if (draft.handoff == requestHandoffCollect) {
    if (draft.pickupAddress.trim().isEmpty) add('pickup_address_required');
    if (draft.pickupAddress.trim().length > requestMaxAddress) {
      add('text_too_long');
    }
    final day = requestDayFromKey(draft.pickupDate);
    if (day == null || !inWindow(day)) add('pickup_date_invalid');
    if (!requestPickupWindows.contains(draft.pickupWindow)) {
      add('pickup_window_invalid');
    }
    if (draft.pickupNote.trim().length > requestMaxNote) add('text_too_long');
  } else {
    add('handoff_invalid');
  }

  if (draft.senderName.trim().isEmpty) add('sender_name_required');
  if (draft.senderName.trim().length > requestMaxName) add('text_too_long');
  if (!isRequestPhone(draft.senderPhone)) add('sender_phone_invalid');
  if (draft.receiverName.trim().isEmpty) add('receiver_name_required');
  if (draft.receiverName.trim().length > requestMaxName) add('text_too_long');
  if (!isRequestPhone(draft.receiverPhone)) add('receiver_phone_invalid');

  if (draft.pieces.isEmpty) add('pieces_required');
  if (draft.pieces.length > requestMaxPieces) add('too_many_pieces');
  for (final piece in draft.pieces) {
    if (!requestPieceKinds.contains(piece.kind)) add('piece_kind_invalid');
    final description = piece.description.trim();
    if (piece.kind != requestPieceBarrel && description.isEmpty) {
      add('piece_description_required');
    }
    if (description.length > requestMaxDescription) add('text_too_long');
    if (piece.photoPaths.length > requestMaxPhotosPerPiece) {
      add('too_many_photos');
    }
  }
  if (draft.language != 'en' && draft.language != 'fr') {
    add('language_invalid');
  }
  if (!_idempotencyKey.hasMatch(draft.idempotencyKey)) {
    add('idempotency_key_invalid');
  }
  return reasons;
}

/// Which piece fields a reason code points at, for the form to flag them.
bool pieceNeedsDescription(RequestPieceDraft piece) =>
    piece.kind != requestPieceBarrel && piece.description.trim().isEmpty;

/// The `submitPackageRequest` body (§8.5). Only the handoff's own fields are
/// sent: a pickup address never rides along with a drop-off.
Map<String, Object?> submitRequestPayload(RequestDraft draft) {
  final bring = draft.handoff == requestHandoffBringIn;
  final note = draft.pickupNote.trim();
  return {
    'businessId': draft.businessId,
    'destinationCountryId': draft.destinationCountryId,
    'handoff': draft.handoff,
    if (bring) 'locationId': draft.locationId,
    if (bring) 'plannedDate': draft.plannedDate,
    if (!bring)
      'pickup': {
        'address': draft.pickupAddress.trim(),
        'date': draft.pickupDate,
        'window': draft.pickupWindow,
        if (note.isNotEmpty) 'note': note,
      },
    'sender': {
      'name': draft.senderName.trim(),
      'phoneE164': draft.senderPhone.trim(),
    },
    'receiver': {
      'name': draft.receiverName.trim(),
      'phoneE164': draft.receiverPhone.trim(),
    },
    'pieces': [
      for (final p in draft.pieces)
        {
          'kind': p.kind,
          if (p.description.trim().isNotEmpty)
            'description': p.description.trim(),
          if (p.photoPaths.isNotEmpty) 'photoPaths': p.photoPaths,
        },
    ],
    'language': draft.language,
    'idempotencyKey': draft.idempotencyKey,
  };
}

class RequestSubmitted {
  const RequestSubmitted({
    required this.requestId,
    required this.code,
    required this.token,
    required this.status,
    this.totalCents,
    this.replayed = false,
  });

  factory RequestSubmitted.fromResponse(Object? data) {
    final m = _map(data);
    return RequestSubmitted(
      requestId: _text(m['requestId']),
      code: _text(m['code']),
      token: _text(m['token']),
      status: _text(m['status']),
      totalCents: _intOrNull(m['totalCents']),
      replayed: _bool(m['replayed']),
    );
  }

  final String requestId;
  final String code;
  final String token;
  final String status;
  final int? totalCents;
  final bool replayed;
}

// ---------------------------------------------------------------------------
// Pieces in words.
// ---------------------------------------------------------------------------

class PieceCounts {
  const PieceCounts({this.barrels = 0, this.boxes = 0, this.others = 0});

  final int barrels;
  final int boxes;
  final int others;

  int get total => barrels + boxes + others;
}

PieceCounts countPieceKinds(Iterable<String> kinds) {
  var barrels = 0, boxes = 0, others = 0;
  for (final kind in kinds) {
    switch (kind) {
      case requestPieceBarrel:
        barrels++;
      case requestPieceBox:
        boxes++;
      default:
        others++;
    }
  }
  return PieceCounts(barrels: barrels, boxes: boxes, others: others);
}

PieceCounts countRequestPieces(PackageRequest request) =>
    countPieceKinds(request.pieces.map((p) => p.kind));

// ---------------------------------------------------------------------------
// Where a request stands.
// ---------------------------------------------------------------------------

/// The customer's page states (§8.5 "Page states").
enum CustomerRequestState {
  waitingForEstimate,
  awaitingConfirmation,
  confirmed,
  received,
  declined,
  cancelled,
  customerDeclined,
  expired,
}

CustomerRequestState customerStateOf(PackageRequest request) =>
    switch (request.status) {
      requestStatusEstimateSent => CustomerRequestState.awaitingConfirmation,
      requestStatusConfirmed => CustomerRequestState.confirmed,
      requestStatusReceived => CustomerRequestState.received,
      requestStatusDeclined => CustomerRequestState.declined,
      requestStatusCancelled => CustomerRequestState.cancelled,
      requestStatusCustomerDeclined => CustomerRequestState.customerDeclined,
      requestStatusExpired => CustomerRequestState.expired,
      // `new`, and anything newer than this app: nothing to act on yet.
      _ => CustomerRequestState.waitingForEstimate,
    };

/// Whether the customer can say yes or no now.
bool customerCanAnswer(PackageRequest request) =>
    request.status == requestStatusEstimateSent && request.estimate != null;

/// Whether the customer can still say "No thanks" (any open request but a
/// card-paid one, which is cancelled through its card order instead).
bool customerCanDecline(PackageRequest request) =>
    request.isOpen &&
    !request.isCardOrder &&
    request.status != requestStatusConfirmed;

/// The business's lists: the Requests tab's two chips and the Waiting
/// list's Expected section.
enum BusinessRequestStage {
  needsEstimate,
  waitingForCustomer,
  expected,
  closed,
}

BusinessRequestStage businessStageOf(PackageRequest request) =>
    switch (request.status) {
      requestStatusNew => BusinessRequestStage.needsEstimate,
      requestStatusEstimateSent => BusinessRequestStage.waitingForCustomer,
      requestStatusConfirmed => BusinessRequestStage.expected,
      _ => BusinessRequestStage.closed,
    };

/// Newest first; a request with no time yet (just written) on top.
List<PackageRequest> sortRequestsNewestFirst(Iterable<PackageRequest> list) {
  final out = list.toList();
  out.sort((a, b) {
    final at = a.createdAt, bt = b.createdAt;
    if (at == null && bt == null) return a.id.compareTo(b.id);
    if (at == null) return -1;
    if (bt == null) return 1;
    return bt.compareTo(at);
  });
  return out;
}

List<PackageRequest> requestsInStage(
  Iterable<PackageRequest> list,
  BusinessRequestStage stage,
) => sortRequestsNewestFirst(list.where((r) => businessStageOf(r) == stage));

/// Expected requests read soonest first: the one due today on top.
List<PackageRequest> expectedRequests(Iterable<PackageRequest> list) {
  final out = list
      .where((r) => businessStageOf(r) == BusinessRequestStage.expected)
      .toList();
  out.sort((a, b) {
    final ad = a.handoffDay, bd = b.handoffDay;
    if (ad.isEmpty != bd.isEmpty) return ad.isEmpty ? 1 : -1;
    final byDay = ad.compareTo(bd);
    return byDay != 0 ? byDay : a.id.compareTo(b.id);
  });
  return out;
}

// ---------------------------------------------------------------------------
// The estimate lock.
// ---------------------------------------------------------------------------

enum LockHolder {
  /// No one is writing the estimate.
  nobody,

  /// This person holds it.
  me,

  /// Someone else is writing it now: read only.
  someoneElse,

  /// Someone else held it and let it lapse: it may be taken over.
  lapsed,
}

LockHolder lockHolderOf(
  RequestLock? lock, {
  required String myUid,
  required int nowMs,
}) {
  if (lock == null) return LockHolder.nobody;
  if (lock.uid == myUid) {
    return lock.isLive(nowMs) ? LockHolder.me : LockHolder.nobody;
  }
  return lock.isLive(nowMs) ? LockHolder.someoneElse : LockHolder.lapsed;
}

// ---------------------------------------------------------------------------
// The estimate editor.
// ---------------------------------------------------------------------------

/// "120" or "120.50" for a price field, from cents.
String requestCentsToInput(int cents) =>
    cents % 100 == 0 ? '${cents ~/ 100}' : (cents / 100).toStringAsFixed(2);

/// Where each piece's price field starts: the latest estimate's price, else
/// the business's barrel price the server prefilled, else empty.
Map<String, String> estimatePrefill(PackageRequest request) => {
  for (final piece in request.pieces)
    piece.id: switch (request.priceOf(piece)) {
      final int cents => requestCentsToInput(cents),
      null => '',
    },
};

/// Typed dollars to cents through the app's one money reader.
int? _readCents(String text) => parseMoneyCents(text);

/// The estimate as typed: every piece's cents, the fee, and what is wrong.
class EstimateCheck {
  const EstimateCheck({
    required this.pieceCents,
    required this.missing,
    required this.invalid,
    required this.pickupFeeCents,
    required this.pickupFeeInvalid,
    required this.noteTooLong,
  });

  final Map<String, int> pieceCents;
  final Set<String> missing;
  final Set<String> invalid;
  final int? pickupFeeCents;
  final bool pickupFeeInvalid;
  final bool noteTooLong;

  int get totalCents =>
      pieceCents.values.fold(0, (a, b) => a + b) + (pickupFeeCents ?? 0);

  /// The server's codes for what is wrong, in its order.
  List<String> get reasons => [
    if (missing.isNotEmpty) 'estimate_piece_missing',
    if (invalid.isNotEmpty) 'amount_invalid',
    if (pickupFeeInvalid) 'pickup_fee_invalid',
    if (noteTooLong) 'text_too_long',
  ];

  bool get ok => reasons.isEmpty;
}

EstimateCheck checkEstimate({
  required PackageRequest request,
  required Map<String, String> inputs,
  String pickupFee = '',
  String note = '',
}) {
  final cents = <String, int>{};
  final missing = <String>{};
  final invalid = <String>{};
  for (final piece in request.pieces) {
    final text = (inputs[piece.id] ?? '').trim();
    if (text.isEmpty) {
      missing.add(piece.id);
      continue;
    }
    final value = _readCents(text);
    if (value == null || value < 0 || value > requestMaxCents) {
      invalid.add(piece.id);
      continue;
    }
    cents[piece.id] = value;
  }
  int? fee;
  var feeInvalid = false;
  if (request.isCollect && pickupFee.trim().isNotEmpty) {
    fee = _readCents(pickupFee);
    if (fee == null || fee < 0 || fee > requestMaxCents) {
      feeInvalid = true;
      fee = null;
    }
  }
  return EstimateCheck(
    pieceCents: cents,
    missing: missing,
    invalid: invalid,
    pickupFeeCents: fee,
    pickupFeeInvalid: feeInvalid,
    noteTooLong: note.trim().length > requestMaxNote,
  );
}

/// The `sendPackageEstimate` body.
Map<String, Object?> sendEstimatePayload({
  required String businessId,
  required PackageRequest request,
  required int baseVersion,
  required EstimateCheck check,
  String note = '',
  RequestSchedule? pickupSchedule,
}) => {
  'businessId': businessId,
  'requestId': request.id,
  'baseVersion': baseVersion,
  'pieces': [
    for (final piece in request.pieces)
      {'id': piece.id, 'cents': check.pieceCents[piece.id] ?? 0},
  ],
  if (request.isCollect && check.pickupFeeCents != null)
    'pickupFeeCents': check.pickupFeeCents,
  if (request.isCollect && pickupSchedule != null)
    'pickupSchedule': pickupSchedule.toMap(),
  if (note.trim().isNotEmpty) 'note': note.trim(),
};

class EstimateSent {
  const EstimateSent({
    required this.version,
    required this.status,
    required this.totalCents,
    this.reconfirmRequired = false,
    this.priceDropped = false,
  });

  factory EstimateSent.fromResponse(Object? data) {
    final m = _map(data);
    return EstimateSent(
      version: _int(m['version']),
      status: _text(m['status']),
      totalCents: _int(m['totalCents']),
      reconfirmRequired: _bool(m['reconfirmRequired']),
      priceDropped: _bool(m['priceDropped']),
    );
  }

  final int version;
  final String status;
  final int totalCents;
  final bool reconfirmRequired;
  final bool priceDropped;
}

// ---------------------------------------------------------------------------
// Received.
// ---------------------------------------------------------------------------

/// What each request piece is priced at when the Received sheet opens: the
/// estimate's price (else the piece's own `estimateCents`), plus - for a
/// collected request - the estimate's pickup fee spread over the priced
/// pieces, the odd cents on the first. A line's total is the sum of its
/// pieces (phase 1), so the fee rides inside them. Mirrors
/// `receivePrefillCents` in functions/request_receive.js and the console's
/// package-requests.ts.
Map<String, int?> receivePrefillCents(PackageRequest request) {
  final prices = <String, int?>{
    for (final piece in request.pieces) piece.id: request.priceOf(piece),
  };
  final fee = request.isCollect ? (request.estimate?.pickupFeeCents ?? 0) : 0;
  final priced = [
    for (final e in prices.entries)
      if (e.value != null) e.key,
  ];
  if (fee > 0 && priced.isNotEmpty) {
    final shares = lp.distributeCents(fee, priced.length);
    for (var i = 0; i < priced.length; i++) {
      prices[priced[i]] = prices[priced[i]]! + (shares[i] ?? 0);
    }
  }
  return prices;
}

/// The pickup fee already inside the prefilled prices (shown as a note), 0
/// unless a collected request's estimate names one and a piece is priced.
int receivePickupFeeCents(PackageRequest request) {
  if (!request.isCollect) return 0;
  final fee = request.estimate?.pickupFeeCents ?? 0;
  if (fee <= 0) return 0;
  return request.pieces.any((p) => request.priceOf(p) != null) ? fee : 0;
}

/// A request's pieces as phase 1's line pieces, so staff screens say what a
/// request holds the way they say what a line holds (`containerPiecesSummary`)
/// and the Received editor opens on them. [prices] by piece id, else none.
List<lp.LinePiece> requestLinePieces(
  PackageRequest request, [
  Map<String, int?> prices = const {},
]) => [
  for (final piece in request.pieces)
    lp.LinePiece(
      id: piece.id,
      kind: lp.pieceKinds.contains(piece.kind) ? piece.kind : 'other',
      description: piece.description,
      sizeIn: piece.sizeIn == null
          ? null
          : lp.PieceSize(piece.sizeIn!.l, piece.sizeIn!.w, piece.sizeIn!.h),
      priceCents: prices[piece.id],
    ),
];

/// Where the Received sheet starts, as phase 1's pieces editor takes it: the
/// request's pieces, ids kept, priced by [receivePrefillCents].
List<lp.LinePiece> receivePrefillPieces(PackageRequest request) =>
    requestLinePieces(request, receivePrefillCents(request));

class ReceiveCheck {
  const ReceiveCheck({
    required this.pieces,
    required this.reasons,
    required this.totalCents,
  });

  /// The pieces as `receivePackageRequest` takes them: a request piece by
  /// its id with what it turned out to be, a piece brought on top without
  /// an id (the server numbers it).
  final List<Map<String, Object?>> pieces;

  /// Every problem, as the server names it: phase 1's piece codes, then
  /// `too_many_pieces` (a request holds 20) and `price_required`.
  final List<String> reasons;

  /// The line's price: the sum of the pieces, null while none is priced.
  final int? totalCents;

  bool get ok => reasons.isEmpty;
}

/// The checks `receivePackageRequest` makes on the editor's pieces
/// ([lp.pieceErrors] for each piece, at most [requestMaxPieces], all
/// priced or none).
ReceiveCheck checkReceive(List<Map<String, Object?>> drafts) {
  final reasons = <String>[...lp.pieceErrors(drafts, requestMaxPieces)];
  if (reasons.remove('pieces_too_many')) reasons.add('too_many_pieces');
  final pieces = <Map<String, Object?>>[];
  for (final draft in drafts) {
    final clean = lp.normalizePieces([draft]).first;
    pieces.add({
      'id': (draft['id'] ?? '').toString(),
      'kind': clean.kind,
      'description': clean.description,
      'sizeIn': clean.sizeIn?.toMap(),
      'priceCents': clean.priceCents,
    });
  }
  final priced = pieces.where((p) => p['priceCents'] != null).length;
  if (reasons.isEmpty && priced > 0 && priced < pieces.length) {
    reasons.add('price_required');
  }
  return ReceiveCheck(
    pieces: pieces,
    reasons: reasons,
    totalCents: lp.piecesTotalCents(pieces),
  );
}

/// The `receivePackageRequest` body (§8.6): the pieces as they arrived.
Map<String, Object?> receivePayload({
  required String businessId,
  required String requestId,
  required ReceiveCheck check,
  bool payOnArrival = false,
  Map<String, Object?>? payment,
}) => {
  'businessId': businessId,
  'requestId': requestId,
  'pieces': check.pieces,
  if (payOnArrival) 'payOnArrival': true,
  'payment': ?payment,
};

class RequestReceived {
  const RequestReceived({
    required this.lineId,
    required this.trackingCode,
    this.paidCents = 0,
    this.alreadyReceived = false,
    this.pieces = const [],
  });

  factory RequestReceived.fromResponse(Object? data) {
    final m = _map(data);
    return RequestReceived(
      lineId: _text(m['lineId']),
      trackingCode: _text(m['trackingCode']),
      paidCents: _int(m['paidCents']),
      alreadyReceived: _bool(m['alreadyReceived']),
    );
  }

  final String lineId;
  final String trackingCode;
  final int paidCents;
  final bool alreadyReceived;

  /// The pieces the sheet sent (not part of the server's answer): the line's
  /// pieces until the waiting feed has the line itself, so its labels sheet
  /// counts what actually arrived.
  final List<Map<String, Object?>> pieces;

  RequestReceived withPieces(List<Map<String, Object?>> sent) =>
      RequestReceived(
        lineId: lineId,
        trackingCode: trackingCode,
        paidCents: paidCents,
        alreadyReceived: alreadyReceived,
        pieces: sent,
      );
}

// ---------------------------------------------------------------------------
// A reason (decline, cancel, "No thanks").
// ---------------------------------------------------------------------------

/// Null when [reason] is acceptable; else the server's code.
String? reasonProblem(String reason, {bool required = true}) {
  final text = reason.trim();
  if (required && text.isEmpty) return 'reason_required';
  if (text.length > requestMaxReason) return 'text_too_long';
  return null;
}

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

/// A refusal from any request callable, read from its code and `details`.
class RequestRefusal {
  const RequestRefusal({
    required this.code,
    this.reasons = const [],
    this.currentVersion,
    this.lockedByName = '',
    this.untilMs,
    this.status = '',
  });

  /// The Functions code: `failed-precondition`, `invalid-argument`,
  /// `unauthenticated`, `unavailable`...
  final String code;

  /// `details.reasons`, else `[details.reason]`; empty when none came.
  final List<String> reasons;
  final int? currentVersion;
  final String lockedByName;
  final int? untilMs;
  final String status;

  String get reason => reasons.isEmpty ? '' : reasons.first;
  bool has(String reason) => reasons.contains(reason);
}

RequestRefusal parseRequestRefusal(String code, Object? details) {
  final d = _map(details);
  final reasons = <String>[];
  for (final r in _list(d['reasons'])) {
    final text = _text(r);
    if (text.isNotEmpty && !reasons.contains(text)) reasons.add(text);
  }
  final single = _text(d['reason']);
  if (single.isNotEmpty && !reasons.contains(single)) reasons.insert(0, single);
  return RequestRefusal(
    code: code.trim().toLowerCase(),
    reasons: reasons,
    currentVersion: _intOrNull(d['currentVersion']),
    lockedByName: _text(d['lockedByName']),
    untilMs: _intOrNull(d['untilMs']),
    status: _text(d['status']),
  );
}

/// How a refusal reads when its reason is not one this app knows.
enum RequestFailureKind {
  offline,
  appCheck,
  permission,
  notFound,
  rateLimited,
  generic,
}

RequestFailureKind requestFailureKind(String code) =>
    switch (code.trim().toLowerCase()) {
      'unavailable' ||
      'deadline-exceeded' ||
      'network-request-failed' => RequestFailureKind.offline,
      'unauthenticated' => RequestFailureKind.appCheck,
      'permission-denied' => RequestFailureKind.permission,
      'not-found' => RequestFailureKind.notFound,
      'resource-exhausted' => RequestFailureKind.rateLimited,
      _ => RequestFailureKind.generic,
    };

// ---------------------------------------------------------------------------
// Links that open these screens (§8.8).
// ---------------------------------------------------------------------------

sealed class PackageRequestLink {
  const PackageRequestLink();
}

/// `/e/<token>`: the estimate page.
class EstimateRequestLink extends PackageRequestLink {
  const EstimateRequestLink(this.token);
  final String token;

  @override
  bool operator ==(Object other) =>
      other is EstimateRequestLink && other.token == token;

  @override
  int get hashCode => token.hashCode;
}

/// `/r/<slug>`: the request form with that business chosen; an empty slug
/// is the form from the country step.
class FormRequestLink extends PackageRequestLink {
  const FormRequestLink(this.slug);
  final String slug;

  @override
  bool operator ==(Object other) =>
      other is FormRequestLink && other.slug == slug;

  @override
  int get hashCode => slug.hashCode;
}

final _token = RegExp(r'^[A-Za-z0-9_-]{16,128}$');
final _slug = RegExp(r'^[a-z0-9-]{3,40}$');

bool isRequestSlug(String slug) => _slug.hasMatch(slug);

/// The request link [uri] carries, or null when it is not one of ours.
PackageRequestLink? packageRequestLinkFromUri(Uri? uri) {
  if (uri == null) return null;
  final scheme = uri.scheme.toLowerCase();
  if (scheme != 'https' && scheme != 'http') return null;
  final host = uri.host.toLowerCase();
  final customerHost = host == packageLinkHost;
  final siteHost = host == requestLinkHost || host == 'www.$requestLinkHost';
  if (!customerHost && !siteHost) return null;
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (segments.length == 2) {
    final head = segments.first.toLowerCase();
    if (head == 'e' && customerHost && _token.hasMatch(segments[1])) {
      return EstimateRequestLink(segments[1]);
    }
    if (head == 'r') {
      final slug = segments[1].toLowerCase();
      if (_slug.hasMatch(slug)) return FormRequestLink(slug);
    }
    return null;
  }
  if (segments.isEmpty && customerHost) {
    final service = uri.queryParameters['service'] ?? '';
    if (service == 'package-estimate') {
      final token = uri.queryParameters['t'] ?? '';
      return _token.hasMatch(token) ? EstimateRequestLink(token) : null;
    }
    if (service == 'package-request') {
      final slug = (uri.queryParameters['r'] ?? '').toLowerCase();
      if (slug.isEmpty) return const FormRequestLink('');
      return _slug.hasMatch(slug) ? FormRequestLink(slug) : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Photos (§8.4).
// ---------------------------------------------------------------------------

/// Under the rule's 2 MB ceiling with room to spare; the picker compresses
/// to about 1.5 MB, and a photo that still comes out larger is refused here.
const requestPhotoMaxBytes = 2000000;

/// The picker's settings that bring a phone photo near 1.5 MB.
const requestPhotoMaxWidth = 1600.0;
const requestPhotoQuality = 70;

/// The image type [bytes] really hold (`image/jpeg`, `image/png`,
/// `image/webp`), or null for anything else.
String? sniffRequestPhotoType(List<int> bytes) {
  if (bytes.length >= 3 &&
      bytes[0] == 0xFF &&
      bytes[1] == 0xD8 &&
      bytes[2] == 0xFF) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 &&
      bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4E &&
      bytes[3] == 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 12 &&
      bytes[0] == 0x52 &&
      bytes[1] == 0x49 &&
      bytes[2] == 0x46 &&
      bytes[3] == 0x46 &&
      bytes[8] == 0x57 &&
      bytes[9] == 0x45 &&
      bytes[10] == 0x42 &&
      bytes[11] == 0x50) {
    return 'image/webp';
  }
  return null;
}

String requestPhotoExtension(String contentType) => switch (contentType) {
  'image/png' => 'png',
  'image/webp' => 'webp',
  _ => 'jpg',
};

/// Why a photo cannot be sent, or null when it can.
String? requestPhotoProblem(List<int> bytes) {
  if (sniffRequestPhotoType(bytes) == null) return 'photo_invalid';
  if (bytes.length >= requestPhotoMaxBytes) return 'photo_too_large';
  return null;
}

/// `packageRequestPhotos/{businessId}/{uploaderUid}/{fileId}.{ext}`.
String requestPhotoPath({
  required String businessId,
  required String uploaderUid,
  required String fileId,
  required String contentType,
}) =>
    'packageRequestPhotos/$businessId/$uploaderUid/$fileId.${requestPhotoExtension(contentType)}';

String newRequestPhotoId([Random? random]) {
  const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  final r = random ?? Random.secure();
  return List.generate(20, (_) => alphabet[r.nextInt(alphabet.length)]).join();
}

// ---------------------------------------------------------------------------
// Business settings (§8.3 / §8.6 `setPackageRequestSettings`).
// ---------------------------------------------------------------------------

/// The location id opening hours use for the headquarters address when the
/// business keeps no separate locations.
const requestDefaultLocationId = 'default';

class PackageRequestSettings {
  const PackageRequestSettings({
    this.acceptRequests = false,
    this.openingHours = const {},
    this.pickupEnabled = false,
    this.pickupAreas = '',
    this.cardBarrelBooking = false,
    this.timeZone = requestDefaultTimeZone,
    this.requestSlug = '',
    this.requestSlugEdits = 0,
  });

  /// From the `businesses/{id}` document.
  factory PackageRequestSettings.fromBusiness(Map<String, dynamic> business) {
    final s = _map(business['packageRequestSettings']);
    final hours = _map(s['openingHours']);
    final pickup = _map(s['pickup']);
    final zone = _text(s['timeZone']);
    return PackageRequestSettings(
      acceptRequests: _bool(s['acceptRequests']),
      openingHours: {
        for (final e in hours.entries) e.key: RequestWeekHours.fromMap(e.value),
      },
      pickupEnabled: _bool(pickup['enabled']),
      pickupAreas: _text(pickup['areas']),
      cardBarrelBooking: _bool(s['cardBarrelBooking']),
      timeZone: zone.isEmpty ? requestDefaultTimeZone : zone,
      requestSlug: _text(business['requestSlug']),
      requestSlugEdits: _int(business['requestSlugEdits']),
    );
  }

  final bool acceptRequests;
  final Map<String, RequestWeekHours> openingHours;
  final bool pickupEnabled;
  final String pickupAreas;
  final bool cardBarrelBooking;
  final String timeZone;
  final String requestSlug;
  final int requestSlugEdits;

  /// The owner may change the slug once.
  bool get slugEditable => requestSlug.isEmpty || requestSlugEdits < 1;

  String get requestLink =>
      requestSlug.isEmpty ? '' : requestLinkForSlug(requestSlug);
}

/// The settings checks, in the server's codes.
List<String> validateRequestSettings({
  required Map<String, RequestWeekHours> openingHours,
  required bool pickupEnabled,
  required String pickupAreas,
  String slug = '',
  String currentSlug = '',
}) {
  final reasons = <String>[];
  for (final week in openingHours.values) {
    for (final day in requestWeekdays) {
      final hours = week.day(day);
      if (!hours.open) continue;
      final from = requestMinutesOf(hours.from);
      final to = requestMinutesOf(hours.to);
      if (from == null || to == null || from >= to) {
        if (!reasons.contains('hours_invalid')) reasons.add('hours_invalid');
      }
    }
  }
  if (pickupEnabled && pickupAreas.trim().isEmpty) {
    reasons.add('pickup_areas_required');
  }
  if (pickupAreas.trim().length > requestMaxAreas) reasons.add('text_too_long');
  final s = slug.trim().toLowerCase();
  if (s.isNotEmpty && s != currentSlug && !_slug.hasMatch(s)) {
    reasons.add('slug_invalid');
  }
  return reasons;
}

Map<String, Object?> requestSettingsPayload({
  required String businessId,
  required bool acceptRequests,
  required Map<String, RequestWeekHours> openingHours,
  required bool pickupEnabled,
  required String pickupAreas,
  required bool cardBarrelBooking,
  String slug = '',
  String currentSlug = '',
}) {
  final s = slug.trim().toLowerCase();
  return {
    'businessId': businessId,
    'acceptRequests': acceptRequests,
    'openingHours': {
      for (final e in openingHours.entries) e.key: e.value.toMap(),
    },
    'pickup': {'enabled': pickupEnabled, 'areas': pickupAreas.trim()},
    'cardBarrelBooking': cardBarrelBooking,
    if (s.isNotEmpty && s != currentSlug) 'requestSlug': s,
  };
}

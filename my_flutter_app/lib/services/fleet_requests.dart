// The Fleet callable's requests, refusals and settings (docs/FLEET.md
// section 4). One callable, `fleetAction`, with an `action` per operation;
// the names, inputs and refusal reasons are the server's
// (functions/fleet_handlers.js). Pure: the screens turn a refusal reason into
// words (`fleetRefusalText`), never the server's English message.

import '../utils/business_permissions.dart';
import 'fleet_views.dart' show fleetServiceOn;

/// Who may do what in Fleet (docs/FLEET.md Q6). Fleet staff (`fleet`) see
/// everything and record payments, add cars, drivers and charges; Fleet admins
/// (`fleet_admin`, and the owner and full-access staff) also give and take back
/// plates, waive, undo, remove notes and friends, and change the settings.
class FleetAccess {
  const FleetAccess({required this.staff, required this.admin});

  /// May open Fleet at all (a Fleet admin is also Fleet staff).
  final bool staff;
  final bool admin;

  static const none = FleetAccess(staff: false, admin: false);
}

/// [isStaff] is `AuthProvider`'s staff flag (false for the owner and for
/// full-access staff, who hold every permission); [permissions] the person's
/// business permissions.
FleetAccess fleetAccess({
  required bool isStaff,
  required Iterable<String> permissions,
}) {
  bool has(String p) => canAccessBusinessPermission(
    isStaff: isStaff,
    permissions: permissions,
    permission: p,
  );
  final admin = has(BusinessPermission.fleetAdmin);
  return FleetAccess(
    staff: admin || has(BusinessPermission.fleet),
    admin: admin,
  );
}

/// The one Fleet row on the home: the business has the service and the
/// person holds Fleet access.
bool showsFleetRow({
  required Iterable<String> services,
  required String businessId,
  required FleetAccess access,
}) => businessId.isNotEmpty && fleetServiceOn(services) && access.staff;

/// Every refusal reason the server names for Fleet.
const fleetRefusalReasons = <String>[
  'fleet_off',
  'fleet_admin_only',
  'fleet_not_found',
  'fleet_car_taken',
  'fleet_bad_input',
  'fleet_no_amount',
  'fleet_already_undone',
  'fleet_not_open',
  'fleet_reason_required',
  'fleet_import_locked',
  'fleet_friend_overlap',
  'fleet_note_empty',
  'fleet_note_voided',
  'fleet_bad_file',
  'fleet_deposit_used',
  'fleet_no_bank',
  'fleet_bad_phone',
  'fleet_whatsapp_off',
  'fleet_nothing_owed',
  'fleet_no_phone',
  'fleet_driver_left',
  'fleet_staff_only',
];

/// A Fleet call the server refused, or that never reached it.
class FleetFailure implements Exception {
  const FleetFailure({required this.code, this.reason = ''});

  /// The Functions code (`failed-precondition`, `permission-denied`,
  /// `unavailable`...).
  final String code;

  /// One of [fleetRefusalReasons] when the server named it; else ''.
  final String reason;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  bool get notAllowed => code == 'permission-denied';

  @override
  String toString() => 'FleetFailure($code $reason)';
}

/// The refusal reason from a callable error: `details.reason`.
FleetFailure parseFleetFailure(String code, Object? details) {
  var reason = '';
  if (details is Map) reason = '${details['reason'] ?? ''}'.trim();
  if (!fleetRefusalReasons.contains(reason)) reason = '';
  return FleetFailure(code: code.trim().toLowerCase(), reason: reason);
}

// ---------------------------------------------------------------------------
// Request builders: `{action, businessId, ...}`.
// ---------------------------------------------------------------------------

Map<String, Object?> _req(
  String action,
  String businessId, [
  Map<String, Object?> rest = const {},
]) => {'action': action, 'businessId': businessId, ...rest};

abstract final class FleetRequests {
  static Map<String, Object?> paymentRecord(
    String businessId, {
    required String driverId,
    required int amountCents,
    required String method,
    required String paidDayKey,
    String note = '',
  }) => _req('payment_record', businessId, {
    'driverId': driverId,
    'amountCents': amountCents,
    'method': method,
    'paidDayKey': paidDayKey,
    'note': note,
  });

  static Map<String, Object?> paymentUndo(String b, String paymentId) =>
      _req('payment_undo', b, {'paymentId': paymentId});

  static Map<String, Object?> chargeAdd(
    String b, {
    required String driverId,
    required int amountCents,
    required String label,
    required String dueDayKey,
    String carId = '',
  }) => _req('charge_add', b, {
    'driverId': driverId,
    'amountCents': amountCents,
    'label': label,
    'dueDayKey': dueDayKey,
    if (carId.isNotEmpty) 'carId': carId,
  });

  static Map<String, Object?> billWaive(
    String b, {
    required String billId,
    required String reason,
  }) => _req('bill_waive', b, {'billId': billId, 'reason': reason});

  static Map<String, Object?> driverSave(
    String b, {
    String driverId = '',
    required String name,
    String phone = '',
    String tlcLicense = '',
    String line1 = '',
    String city = '',
    String state = '',
    String zip = '',
    String notes = '',

    /// 'active' | 'left' when editing; null when adding.
    String? status,
  }) => _req('driver_save', b, {
    if (driverId.isNotEmpty) 'driverId': driverId,
    'driver': {
      'name': name,
      'phone': phone,
      'tlcLicense': tlcLicense,
      'address': {'line1': line1, 'city': city, 'state': state, 'zip': zip},
      'notes': notes,
      'status': ?status,
    },
  });

  static Map<String, Object?> carSave(
    String b, {
    String carId = '',
    required String plate,
    String company = '',
    String vehicleType = '',
    String vin = '',
    String registrationExpiry = '',
    String diamondExpiry = '',
    String insurer = '',
    String policyNumber = '',
    int premiumCents = 0,
    int? insuranceDueDay,
    bool insuranceAutopay = false,
    String insurancePaidBy = '',
    String ownership = 'driver',

    /// Set (with an optional day) when the car on the plate changed and the
    /// plate moved to another car; null for a typo or no change.
    bool plateMoved = false,
    String movedSinceDayKey = '',
  }) => _req('car_save', b, {
    if (carId.isNotEmpty) 'carId': carId,
    'car': {
      'plate': plate,
      'company': company,
      'vehicleType': vehicleType,
      'vin': vin,
      'registrationExpiry': registrationExpiry,
      'diamondExpiry': diamondExpiry,
      'insurer': insurer,
      'policyNumber': policyNumber,
      'premiumCents': premiumCents,
      'insuranceDueDay': insuranceDueDay,
      'insuranceAutopay': insuranceAutopay,
      'insurancePaidBy': insurancePaidBy,
      'ownership': ownership,
      if (plateMoved)
        'vehicleChange': {'moved': true, 'sinceDayKey': movedSinceDayKey},
    },
  });

  static Map<String, Object?> assignmentStart(
    String b, {
    required String driverId,
    required String carId,
    required String startDayKey,
    required int rentCents,
    required String period,
    required int dueDay,
  }) => _req('assignment_start', b, {
    'driverId': driverId,
    'carId': carId,
    'startDayKey': startDayKey,
    'rentCents': rentCents,
    'period': period,
    'dueDay': dueDay,
  });

  static Map<String, Object?> assignmentEnd(
    String b, {
    required String assignmentId,
    required String endDayKey,
  }) => _req('assignment_end', b, {
    'assignmentId': assignmentId,
    'endDayKey': endDayKey,
  });

  /// Files are not attached from the phone; the note is text only.
  static Map<String, Object?> noteAdd(
    String b, {
    required String driverId,
    required String text,
  }) => _req('note_add', b, {
    'driverId': driverId,
    'text': text,
    'files': const <Object?>[],
  });

  static Map<String, Object?> noteVoid(String b, String noteId) =>
      _req('note_void', b, {'noteId': noteId});

  static Map<String, Object?> substituteSave(
    String b, {
    required String driverId,
    String carId = '',
    required String name,
    String phone = '',
    String tlcLicense = '',
    required String fromDayKey,
    required String toDayKey,
  }) => _req('substitute_save', b, {
    'driverId': driverId,
    if (carId.isNotEmpty) 'carId': carId,
    'friend': {
      'name': name,
      'phone': phone,
      'tlcLicense': tlcLicense,
      'address': {'line1': '', 'city': '', 'state': '', 'zip': ''},
    },
    'fromDayKey': fromDayKey,
    'toDayKey': toDayKey,
  });

  static Map<String, Object?> substituteVoid(String b, String substituteId) =>
      _req('substitute_void', b, {'substituteId': substituteId});

  static Map<String, Object?> bankStatus(String b) => _req('bank_status', b);

  static Map<String, Object?> bankAssign(
    String b, {
    required String creditId,
    required String driverId,
  }) => _req('bank_assign', b, {'creditId': creditId, 'driverId': driverId});

  static Map<String, Object?> bankCheckNow(String b) =>
      _req('bank_check_now', b);

  static Map<String, Object?> bankRemovedKeep(String b, String paymentId) =>
      _req('bank_removed_keep', b, {'paymentId': paymentId});

  static Map<String, Object?> bankScheduleSave(
    String b,
    FleetBankSchedule schedule,
  ) => _req('bank_schedule_save', b, {'schedule': schedule.toMap()});

  static Map<String, Object?> settingsSave(String b, FleetSettingsView s) =>
      _req('settings_save', b, {
        'settings': {
          'lateFee': {
            'cents': s.lateFeeCents,
            'dayOfMonth': s.lateFeeDay,
            'firstMonth': s.lateFeeFirstMonth,
          },
          'returnRule': s.returnRule,
          'driversSeeOnlyThisBusiness': s.driversSeeOnly,
          'zelle': {'name': s.zelleName, 'handle': s.zelleHandle},
        },
      });

  static Map<String, Object?> whatsappSave(
    String b, {
    required bool enabled,
    List<String>? onlyDriverIds,
  }) => _req('whatsapp_save', b, {
    'enabled': enabled,
    'onlyDriverIds': ?onlyDriverIds,
  });

  static Map<String, Object?> whatsappTest(String b, String phone) =>
      _req('whatsapp_test', b, {'phone': phone});

  static Map<String, Object?> whatsappRemindDriver(String b, String driverId) =>
      _req('whatsapp_remind_driver', b, {'driverId': driverId});
}

// ---------------------------------------------------------------------------
// Settings (`businesses/{id}.fleet.settings`).
// ---------------------------------------------------------------------------

class FleetSettingsView {
  const FleetSettingsView({
    this.lateFeeCents = 0,
    this.lateFeeDay = 5,
    this.lateFeeFirstMonth = '',
    this.returnRule = 'full',
    this.driversSeeOnly = true,
    this.zelleName = '',
    this.zelleHandle = '',
    this.whatsappEnabled = false,
    this.whatsappOnlyDriverIds = const [],
  });

  final int lateFeeCents, lateFeeDay;
  final String lateFeeFirstMonth, returnRule, zelleName, zelleHandle;
  final bool driversSeeOnly, whatsappEnabled;

  /// When set, only these drivers get WhatsApp; empty: every active driver.
  final List<String> whatsappOnlyDriverIds;

  FleetSettingsView copyWith({
    int? lateFeeCents,
    int? lateFeeDay,
    String? lateFeeFirstMonth,
    String? returnRule,
    bool? driversSeeOnly,
    String? zelleName,
    String? zelleHandle,
  }) => FleetSettingsView(
    lateFeeCents: lateFeeCents ?? this.lateFeeCents,
    lateFeeDay: lateFeeDay ?? this.lateFeeDay,
    lateFeeFirstMonth: lateFeeFirstMonth ?? this.lateFeeFirstMonth,
    returnRule: returnRule ?? this.returnRule,
    driversSeeOnly: driversSeeOnly ?? this.driversSeeOnly,
    zelleName: zelleName ?? this.zelleName,
    zelleHandle: zelleHandle ?? this.zelleHandle,
    whatsappEnabled: whatsappEnabled,
    whatsappOnlyDriverIds: whatsappOnlyDriverIds,
  );
}

/// The business's Fleet settings with their defaults (drivers-see-only is on
/// unless turned off).
FleetSettingsView readFleetSettings(Map<String, dynamic>? business) {
  Map<String, dynamic> m(Object? v) => v is Map
      ? {for (final e in v.entries) e.key.toString(): e.value}
      : <String, dynamic>{};
  int n(Object? v) => v is num ? v.round() : int.tryParse('$v') ?? 0;
  String s(Object? v) => (v ?? '').toString().trim();
  final fleet = m(business?['fleet']);
  final st = m(fleet['settings']);
  final fee = m(st['lateFee']);
  final zelle = m(st['zelle']);
  final wa = m(st['whatsapp']);
  final only = wa['onlyDriverIds'];
  return FleetSettingsView(
    lateFeeCents: n(fee['cents']),
    lateFeeDay: n(fee['dayOfMonth']) == 0 ? 5 : n(fee['dayOfMonth']),
    lateFeeFirstMonth: s(fee['firstMonth']),
    returnRule: st['returnRule'] == 'days' ? 'days' : 'full',
    driversSeeOnly: st['driversSeeOnlyThisBusiness'] != false,
    zelleName: s(zelle['name']),
    zelleHandle: s(zelle['handle']),
    whatsappEnabled: wa['enabled'] == true,
    whatsappOnlyDriverIds: only is List
        ? [
            for (final id in only)
              if (id is String && id.isNotEmpty) id,
          ]
        : const [],
  );
}

// ---------------------------------------------------------------------------
// Bank deposits (docs/FLEET.md section 8), mirroring admin_web fleet-bank.ts.
// ---------------------------------------------------------------------------

const fleetBankRefreshEvery = [0, 15, 30, 60];
const fleetPlaidRefreshCents = 12;

class FleetBankSchedule {
  const FleetBankSchedule({
    this.every = 0,
    this.fromHour = 7,
    this.toHour = 23,
    this.monthDays = const [],
    this.mondays = false,
  });

  final int every, fromHour, toHour;
  final List<int> monthDays;
  final bool mondays;

  Map<String, Object?> toMap() => {
    'every': every,
    'fromHour': fromHour,
    'toHour': toHour,
    'monthDays': monthDays,
    'mondays': mondays,
  };

  FleetBankSchedule copyWith({
    int? every,
    int? fromHour,
    int? toHour,
    List<int>? monthDays,
    bool? mondays,
  }) => cleanFleetBankSchedule(
    FleetBankSchedule(
      every: every ?? this.every,
      fromHour: fromHour ?? this.fromHour,
      toHour: toHour ?? this.toHour,
      monthDays: monthDays ?? this.monthDays,
      mondays: mondays ?? this.mondays,
    ),
  );
}

/// The schedule as the server saves it (fleet_bank.cleanBankSchedule).
FleetBankSchedule cleanFleetBankSchedule(Object? input) {
  int whole(Object? v, int min, int max, int fallback) {
    final n = v is num ? v.truncate() : int.tryParse('${v ?? ''}');
    return n != null && n >= min && n <= max ? n : fallback;
  }

  Object? get(String k) => input is Map
      ? input[k]
      : input is FleetBankSchedule
      ? input.toMap()[k]
      : null;
  final every =
      fleetBankRefreshEvery.contains(
        get('every') is num ? (get('every') as num).toInt() : -1,
      )
      ? (get('every') as num).toInt()
      : 0;
  var from = whole(get('fromHour'), 0, 23, 7);
  var to = whole(get('toHour'), 1, 24, 23);
  if (to <= from) {
    from = 7;
    to = 23;
  }
  final raw = get('monthDays');
  final days = <int>{
    if (raw is List)
      for (final d in raw)
        if ((d is num ? d.truncate() : int.tryParse('$d')) case final n?)
          if (n >= 1 && n <= 28) n,
  }.toList()..sort();
  return FleetBankSchedule(
    every: every,
    fromHour: from,
    toHour: to,
    monthDays: days,
    mondays: get('mondays') == true,
  );
}

class FleetBankQuote {
  const FleetBankQuote({
    required this.perDay,
    required this.days,
    required this.perMonth,
    required this.centsEach,
    required this.monthCents,
  });

  final int perDay, days, perMonth, centsEach, monthCents;
}

/// Checks a month and their cost (fleet_bank.bankScheduleQuote).
FleetBankQuote fleetBankScheduleQuote(
  FleetBankSchedule schedule, [
  int centsEach = fleetPlaidRefreshCents,
]) {
  final s = cleanFleetBankSchedule(schedule);
  final price = centsEach >= 0 ? centsEach : fleetPlaidRefreshCents;
  final perDay = s.every > 0 ? (((s.toHour - s.fromHour) * 60) ~/ s.every) : 0;
  final days = s.monthDays.length + (s.mondays ? 4 : 0);
  final perMonth = perDay * days;
  return FleetBankQuote(
    perDay: perDay,
    days: days,
    perMonth: perMonth,
    centsEach: price,
    monthCents: perMonth * price,
  );
}

class FleetWaitingDeposit {
  const FleetWaitingDeposit({
    required this.id,
    required this.amountCents,
    this.senderName = '',
    this.atMs = 0,
    this.dateKey = '',
    this.pending = false,
    this.reason = 'unknown',
  });

  final String id, senderName, dateKey, reason;
  final int amountCents, atMs;
  final bool pending;
}

/// A payment still recorded although the bank took its deposit back.
class FleetRemovedDeposit {
  const FleetRemovedDeposit({
    required this.paymentId,
    required this.driverId,
    required this.amountCents,
    this.paidDayKey = '',
    this.senderName = '',
  });

  final String paymentId, driverId, paidDayKey, senderName;
  final int amountCents;
}

class FleetBankStatus {
  const FleetBankStatus({
    this.schedule = const FleetBankSchedule(),
    this.quote = const FleetBankQuote(
      perDay: 0,
      days: 0,
      perMonth: 0,
      centsEach: fleetPlaidRefreshCents,
      monthCents: 0,
    ),
    this.connected = false,
    this.institutionName = '',
    this.accountMask = '',
    this.waiting = const [],
    this.removed = const [],
    this.lastScheduledMs = 0,
  });

  final FleetBankSchedule schedule;
  final FleetBankQuote quote;
  final bool connected;
  final String institutionName, accountMask;
  final List<FleetWaitingDeposit> waiting;
  final List<FleetRemovedDeposit> removed;
  final int lastScheduledMs;
}

/// The `bank_status` answer, read defensively.
FleetBankStatus readFleetBankStatus(Object? answer) {
  Map<String, dynamic> m(Object? v) => v is Map
      ? {for (final e in v.entries) e.key.toString(): e.value}
      : <String, dynamic>{};
  int n(Object? v) => v is num ? v.round() : int.tryParse('$v') ?? 0;
  String s(Object? v) => (v ?? '').toString();
  final a = m(answer);
  final schedule = cleanFleetBankSchedule(a['schedule']);
  final q = m(a['quote']);
  final bank = m(a['bank']);
  return FleetBankStatus(
    schedule: schedule,
    quote: fleetBankScheduleQuote(
      schedule,
      n(q['centsEach']) == 0 ? fleetPlaidRefreshCents : n(q['centsEach']),
    ),
    connected: bank['connected'] == true,
    institutionName: s(bank['institutionName']),
    accountMask: s(bank['accountMask']),
    waiting: [
      for (final w in (a['waiting'] is List ? a['waiting'] as List : const []))
        if (s(m(w)['id']).isNotEmpty && n(m(w)['amountCents']) > 0)
          FleetWaitingDeposit(
            id: s(m(w)['id']),
            amountCents: n(m(w)['amountCents']),
            senderName: s(m(w)['senderName']),
            atMs: n(m(w)['atMs']),
            dateKey: s(m(w)['dateKey']),
            pending: m(w)['pending'] == true,
            reason: s(m(w)['reason']).isEmpty ? 'unknown' : s(m(w)['reason']),
          ),
    ],
    removed: [
      for (final r in (a['removed'] is List ? a['removed'] as List : const []))
        if (s(m(r)['paymentId']).isNotEmpty && n(m(r)['amountCents']) > 0)
          FleetRemovedDeposit(
            paymentId: s(m(r)['paymentId']),
            driverId: s(m(r)['driverId']),
            amountCents: n(m(r)['amountCents']),
            paidDayKey: s(m(r)['paidDayKey']),
            senderName: s(m(r)['senderName']),
          ),
    ],
    lastScheduledMs: n(a['lastScheduledMs']),
  );
}

/// The reasons a bank deposit waits, as the server names them; anything else
/// reads as an unknown sender.
const fleetWaitingReasons = <String>[
  'two_drivers',
  'undone',
  'possible_duplicate',
  'not_zelle',
  'driver_left',
  'own_transfer',
  'unknown',
];

/// "7 AM", "11 PM", "noon", "midnight" for an hour 0-24 (US 12-hour clock);
/// French uses "7 h".
String fleetHourLabel(int hour, {String language = 'en'}) {
  if (language == 'fr') return hour == 24 || hour == 0 ? 'minuit' : '$hour h';
  if (hour == 0 || hour == 24) return 'midnight';
  if (hour == 12) return 'noon';
  return hour < 12 ? '$hour AM' : '${hour - 12} PM';
}

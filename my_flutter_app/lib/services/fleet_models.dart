// Fleet (TLC plate leasing) records and day arithmetic for the phone
// (docs/FLEET.md section 2). Pure Dart: no Firebase, no clock of its own
// (callers pass day keys). Mirrors admin_web/src/lib/fleet.ts.
//
// Day keys are "YYYY-MM-DD" (America/New_York); money is whole cents.

import 'eastern_clock.dart' show shopToday;
import 'invoice_ledger.dart' show dayLabel, invoiceTodayKey;
import 'lot_ledger.dart' show formatLotCents;
import '../utils/money_input.dart' show parseMoneyCents;

/// The service key a business carries once Fleet is switched on.
const fleetServiceKey = 'fleet';

/// The callable every Fleet operation goes through.
const fleetCallable = 'fleetAction';

String _s(Object? v) => (v ?? '').toString().trim();

int _i(Object? v) {
  if (v is num) return v.isFinite ? v.round() : 0;
  return int.tryParse(_s(v)) ?? 0;
}

Map<String, dynamic> _map(Object? v) {
  if (v is Map) {
    return {for (final e in v.entries) e.key.toString(): e.value};
  }
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _maps(Object? v) =>
    v is List ? [for (final item in v) _map(item)] : const [];

// ---------------------------------------------------------------------------
// Days and months.
// ---------------------------------------------------------------------------

const _dayMs = 86400000;

/// Whole days since 1970-01-01 of a "YYYY-MM-DD" key (0 when it is not one).
int fleetDayNumber(String key) {
  final p = _s(key).split('-');
  if (p.length != 3) return 0;
  final y = int.tryParse(p[0]);
  final m = int.tryParse(p[1]);
  final d = int.tryParse(p[2]);
  if (y == null || m == null || d == null) return 0;
  return (DateTime.utc(y, m, d).millisecondsSinceEpoch / _dayMs).round();
}

/// The day key of a day number.
String fleetDayKeyOf(int n) => DateTime.fromMillisecondsSinceEpoch(
  n * _dayMs,
  isUtc: true,
).toIso8601String().substring(0, 10);

/// Whole days from [fromKey] to [toKey] (negative when toKey is earlier).
int fleetDaysBetween(String fromKey, String toKey) =>
    fleetDayNumber(toKey) - fleetDayNumber(fromKey);

/// Adds [days] to a day key.
String fleetAddDays(String key, int days) =>
    fleetDayKeyOf(fleetDayNumber(key) + days);

/// 1 = Monday ... 7 = Sunday.
int fleetWeekday(String key) {
  final n = fleetDayNumber(key);
  return ((((n + 3) % 7) + 7) % 7) + 1; // 1970-01-01 was a Thursday.
}

/// The day key of [day] in a month, clamped to the month's length (the month
/// may overflow into the next years).
String fleetMonthDay(int year, int month, int day) {
  final y = year + ((month - 1) / 12).floor();
  final m = ((((month - 1) % 12) + 12) % 12) + 1;
  final last = DateTime.utc(y, m + 1, 0).day;
  final d = day < last ? day : last;
  return '$y-${m.toString().padLeft(2, '0')}-${d.toString().padLeft(2, '0')}';
}

/// Today in New York as a day key.
String fleetTodayKey([DateTime? now]) =>
    invoiceTodayKey(shopToday(now ?? DateTime.now()));

/// "2026-11" of a day key.
String fleetMonthOf(String dayKey) {
  final k = _s(dayKey);
  return k.length >= 7 ? k.substring(0, 7) : '';
}

/// The month key [n] months from a month key (n may be negative).
String fleetShiftMonth(String month, int n) {
  final p = month.split('-');
  final y = int.tryParse(p.first) ?? 1970;
  final m = int.tryParse(p.length > 1 ? p[1] : '') ?? 1;
  final total = y * 12 + (m - 1) + n;
  return '${total ~/ 12}-${((total % 12) + 1).toString().padLeft(2, '0')}';
}

/// [count] months ending at [lastMonth], oldest first.
List<String> fleetMonthWindow(String lastMonth, int count) => [
  for (var i = count - 1; i >= 0; i--) fleetShiftMonth(lastMonth, -i),
];

const _monthsEn = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const _monthsFr = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

/// "Nov 2026" in English, "nov. 2026" in French.
String fleetMonthLabel(String month, {String language = 'en'}) {
  final p = month.split('-');
  final y = p.first;
  final m = (int.tryParse(p.length > 1 ? p[1] : '') ?? 1).clamp(1, 12);
  final names = language == 'fr' ? _monthsFr : _monthsEn;
  return '${names[m - 1]} $y';
}

/// "Nov 3, 2026" (US, month first) or "" for a bad key.
String fleetDayLabel(String dayKey) => dayLabel(dayKey);

/// "Nov 3 - Nov 9, 2026"-style span for a week.
String fleetSpanLabel(String fromKey, String toKey) =>
    '${fleetDayLabel(fromKey)} - ${fleetDayLabel(toKey)}';

// ---------------------------------------------------------------------------
// Money typed by a person.
// ---------------------------------------------------------------------------

/// "1,200.50" or "$1200" to cents; null when it is not an amount.
int? fleetDollarsToCents(String input) => parseMoneyCents(input);

/// Cents as the plain number a text box shows: 120050 -> "1200.50", 120000 ->
/// "1200", 0 -> "".
String fleetCentsToInput(Object? cents) {
  final n = _i(cents);
  if (n == 0) return '';
  return n % 100 == 0 ? '${n ~/ 100}' : (n / 100).toStringAsFixed(2);
}

/// Whole-cent money the way the app writes it.
String fleetMoney(int cents, {String? language}) =>
    formatLotCents(cents, language: language);

/// The Zelle amount a driver pays: the dollars owed (rounded up) plus their
/// personal cents, so the amount is the code ("$1,200.07"). Null with no code.
String? fleetZelleAmountText(int owedCents, Object? personalCents) {
  final p = personalCents is num
      ? personalCents.toInt()
      : int.tryParse(_s(personalCents));
  if (p == null || p < 1 || p > 99) return null;
  final dollars = ((owedCents < 0 ? 0 : owedCents) / 100).ceil();
  final whole = dollars.toString().replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ',',
  );
  return '\$$whole.${p.toString().padLeft(2, '0')}';
}

// ---------------------------------------------------------------------------
// Records.
// ---------------------------------------------------------------------------

class FleetDriver {
  const FleetDriver({
    required this.id,
    this.name = '',
    this.phone = '',
    this.tlcLicense = '',
    this.line1 = '',
    this.city = '',
    this.state = '',
    this.zip = '',
    this.status = 'active',
    this.personalCents,
    this.creditCents = 0,
    this.notes = '',
    this.licenseHistory = const [],
  });

  factory FleetDriver.fromMap(String id, Map<String, dynamic> m) {
    final a = _map(m['address']);
    final p = _i(m['personalCents']);
    return FleetDriver(
      id: id,
      name: _s(m['name']),
      phone: _s(m['phone']),
      tlcLicense: _s(m['tlcLicense']),
      line1: _s(a['line1']),
      city: _s(a['city']),
      state: _s(a['state']),
      zip: _s(a['zip']),
      status: _s(m['status']) == 'left' ? 'left' : 'active',
      personalCents: p >= 1 ? p : null,
      creditCents: _i(m['creditCents']) < 0 ? 0 : _i(m['creditCents']),
      notes: _s(m['notes']),
      licenseHistory: _maps(m['licenseHistory']),
    );
  }

  final String id, name, phone, tlcLicense, line1, city, state, zip;
  final String status, notes;
  final int? personalCents;
  final int creditCents;
  final List<Map<String, dynamic>> licenseHistory;

  bool get isActive => status == 'active';

  String get addressLine =>
      [line1, city, state, zip].where((p) => p.isNotEmpty).join(', ');
}

class FleetCar {
  const FleetCar({
    required this.id,
    this.plate = '',
    this.company = '',
    this.vehicleType = '',
    this.vin = '',
    this.registrationExpiry = '',
    this.diamondExpiry = '',
    this.insurer = '',
    this.policyNumber = '',
    this.premiumCents = 0,
    this.insuranceDueDay = 0,
    this.insuranceAutopay = false,
    this.insurancePaidBy = '',
    this.ownership = 'company',
    this.vehicleSince = '',
    this.vehicleHistory = const [],
  });

  factory FleetCar.fromMap(String id, Map<String, dynamic> m) => FleetCar(
    id: id,
    plate: _s(m['plate']),
    company: _s(m['company']),
    vehicleType: _s(m['vehicleType']),
    vin: _s(m['vin']),
    registrationExpiry: _s(m['registrationExpiry']),
    diamondExpiry: _s(m['diamondExpiry']),
    insurer: _s(m['insurer']),
    policyNumber: _s(m['policyNumber']),
    premiumCents: _i(m['premiumCents']),
    insuranceDueDay: _i(m['insuranceDueDay']),
    insuranceAutopay: m['insuranceAutopay'] == true,
    insurancePaidBy: _s(m['insurancePaidBy']),
    ownership: _s(m['ownership']) == 'driver' ? 'driver' : 'company',
    vehicleSince: _s(m['vehicleSince']),
    vehicleHistory: _maps(m['vehicleHistory']),
  );

  final String id, plate, company, vehicleType, vin;
  final String registrationExpiry, diamondExpiry;
  final String insurer, policyNumber, insurancePaidBy, ownership, vehicleSince;
  final int premiumCents, insuranceDueDay;
  final bool insuranceAutopay;
  final List<Map<String, dynamic>> vehicleHistory;
}

class FleetAssignment {
  const FleetAssignment({
    required this.id,
    this.businessId = '',
    this.carId = '',
    this.driverId = '',
    this.startDayKey = '',
    this.endDayKey = '',
    this.rentCents = 0,
    this.period = 'monthly',
    this.dueDay = 1,
    this.billFromDayKey = '',
    this.rentHistory = const [],
  });

  factory FleetAssignment.fromMap(String id, Map<String, dynamic> m) =>
      FleetAssignment(
        id: _s(m['id']).isNotEmpty ? _s(m['id']) : id,
        businessId: _s(m['businessId']),
        carId: _s(m['carId']),
        driverId: _s(m['driverId']),
        startDayKey: _s(m['startDayKey']),
        endDayKey: _s(m['endDayKey']),
        rentCents: _i(m['rentCents']),
        period: _s(m['period']) == 'weekly' ? 'weekly' : 'monthly',
        dueDay: _i(m['dueDay']) == 0 ? 1 : _i(m['dueDay']),
        billFromDayKey: _s(m['billFromDayKey']),
        rentHistory: _maps(m['rentHistory']),
      );

  final String id, businessId, carId, driverId, startDayKey, endDayKey, period;
  final int rentCents, dueDay;

  /// The first day rent is owed from, when later than the start (a driver
  /// brought in from the spreadsheet owes nothing before go-live).
  final String billFromDayKey;

  /// The fee and due day before each change, with the days they applied to:
  /// `{rentCents, dueDay, fromDayKey, toDayKey}` rows.
  final List<Map<String, dynamic>> rentHistory;

  /// No end day: the car is still with the driver.
  bool get isOpen => endDayKey.isEmpty;
}

class FleetBill {
  const FleetBill({
    required this.id,
    this.businessId = '',
    this.driverId = '',
    this.carId = '',
    this.assignmentId = '',
    this.kind = 'rent',
    this.label = '',
    this.periodFrom = '',
    this.periodTo = '',
    this.dueDayKey = '',
    this.amountCents = 0,
    this.paidCents = 0,
    this.status = 'open',
    this.lateFeeForBillId = '',
    this.waivedReason = '',
    this.waivedAtMs = 0,
  });

  factory FleetBill.fromMap(String id, Map<String, dynamic> m) {
    final w = _map(m['waived']);
    return FleetBill(
      id: id,
      businessId: _s(m['businessId']),
      driverId: _s(m['driverId']),
      carId: _s(m['carId']),
      assignmentId: _s(m['assignmentId']),
      kind: _s(m['kind']).isEmpty ? 'rent' : _s(m['kind']),
      label: _s(m['label']),
      periodFrom: _s(m['periodFrom']),
      periodTo: _s(m['periodTo']),
      dueDayKey: _s(m['dueDayKey']),
      amountCents: _i(m['amountCents']),
      paidCents: _i(m['paidCents']),
      status: _s(m['status']).isEmpty ? 'open' : _s(m['status']),
      lateFeeForBillId: _s(m['lateFeeForBillId']),
      waivedReason: _s(w['reason']),
      waivedAtMs: _i(w['atMs']),
    );
  }

  final String id, businessId, driverId, carId, assignmentId, kind, label;
  final String periodFrom, periodTo, dueDayKey, status, lateFeeForBillId;
  final String waivedReason;
  final int amountCents, paidCents, waivedAtMs;

  /// What is still unpaid, never below zero.
  int get remainingCents {
    final r = amountCents - paidCents;
    return r < 0 ? 0 : r;
  }

  bool get isOpen => status == 'open';
}

class FleetPayment {
  const FleetPayment({
    required this.id,
    this.driverId = '',
    this.amountCents = 0,
    this.method = 'other',
    this.paidDayKey = '',
    this.receivedAtMs = 0,
    this.receivedByUid = '',
    this.creditAddedCents = 0,
    this.status = 'recorded',
    this.imported = false,
    this.note = '',
  });

  factory FleetPayment.fromMap(String id, Map<String, dynamic> m) =>
      FleetPayment(
        id: id,
        driverId: _s(m['driverId']),
        amountCents: _i(m['amountCents']),
        method: _s(m['method']).isEmpty ? 'other' : _s(m['method']),
        paidDayKey: _s(m['paidDayKey']),
        receivedAtMs: _i(m['receivedAtMs']),
        receivedByUid: _s(m['receivedByUid']),
        creditAddedCents: _i(m['creditAddedCents']),
        status: _s(m['status']) == 'undone' ? 'undone' : 'recorded',
        imported: m['imported'] == true,
        note: _s(m['note']),
      );

  final String id, driverId, method, paidDayKey, receivedByUid, status, note;
  final int amountCents, receivedAtMs, creditAddedCents;
  final bool imported;

  bool get isRecorded => status == 'recorded';

  /// "import" for spreadsheet history, else the method (zelle, cash, other).
  String get shownMethod => imported ? 'import' : method;
}

class FleetNote {
  const FleetNote({
    required this.id,
    this.driverId = '',
    this.text = '',
    this.files = const [],
    this.byName = '',
    this.atMs = 0,
    this.voided = false,
  });

  factory FleetNote.fromMap(String id, Map<String, dynamic> m) => FleetNote(
    id: id,
    driverId: _s(m['driverId']),
    text: _s(m['text']),
    files: _maps(m['files']),
    byName: _s(m['byName']),
    atMs: _i(m['atMs']),
    voided: m['voided'] != null && m['voided'] != false,
  );

  final String id, driverId, text, byName;
  final List<Map<String, dynamic>> files;
  final int atMs;
  final bool voided;
}

/// A friend who drove a driver's car for some days (`fleetSubstitutes`).
class FleetFriend {
  const FleetFriend({
    required this.id,
    this.driverId = '',
    this.carId = '',
    this.name = '',
    this.phone = '',
    this.tlcLicense = '',
    this.fromDayKey = '',
    this.toDayKey = '',
    this.voided = false,
  });

  factory FleetFriend.fromMap(String id, Map<String, dynamic> m) => FleetFriend(
    id: id,
    driverId: _s(m['driverId']),
    carId: _s(m['carId']),
    name: _s(m['name']),
    phone: _s(m['phone']),
    tlcLicense: _s(m['tlcLicense']),
    fromDayKey: _s(m['fromDayKey']),
    toDayKey: _s(m['toDayKey']),
    voided: m['voided'] == true || m['voided'] is Map,
  );

  final String id, driverId, carId, name, phone, tlcLicense;
  final String fromDayKey, toDayKey;
  final bool voided;
}

/// Everything Fleet reads for one business (one live read per collection).
class FleetData {
  const FleetData({
    this.drivers = const [],
    this.cars = const [],
    this.assignments = const [],
    this.bills = const [],
    this.payments = const [],
    this.notes = const [],
    this.friends = const [],
  });

  final List<FleetDriver> drivers;
  final List<FleetCar> cars;
  final List<FleetAssignment> assignments;
  final List<FleetBill> bills;
  final List<FleetPayment> payments;
  final List<FleetNote> notes;
  final List<FleetFriend> friends;

  static const empty = FleetData();
}

/// [FleetData] grouped by driver and car in one pass, never per row.
class FleetIndex {
  FleetIndex(FleetData data) {
    for (final d in data.drivers) {
      driverById[d.id] = d;
    }
    for (final c in data.cars) {
      carById[c.id] = c;
    }
    for (final b in data.bills) {
      (billsByDriver[b.driverId] ??= []).add(b);
    }
    for (final p in data.payments) {
      (paymentsByDriver[p.driverId] ??= []).add(p);
    }
    for (final n in data.notes) {
      (notesByDriver[n.driverId] ??= []).add(n);
    }
    for (final f in data.friends) {
      (friendsByDriver[f.driverId] ??= []).add(f);
      (friendsByCar[f.carId] ??= []).add(f);
    }
    for (final a in data.assignments) {
      (assignmentsByDriver[a.driverId] ??= []).add(a);
      (assignmentsByCar[a.carId] ??= []).add(a);
      if (a.isOpen) {
        currentByCar[a.carId] = a;
        currentByDriver[a.driverId] = a;
      }
    }
  }

  final driverById = <String, FleetDriver>{};
  final carById = <String, FleetCar>{};
  final billsByDriver = <String, List<FleetBill>>{};
  final paymentsByDriver = <String, List<FleetPayment>>{};
  final notesByDriver = <String, List<FleetNote>>{};
  final friendsByDriver = <String, List<FleetFriend>>{};
  final friendsByCar = <String, List<FleetFriend>>{};
  final assignmentsByDriver = <String, List<FleetAssignment>>{};
  final assignmentsByCar = <String, List<FleetAssignment>>{};

  /// carId / driverId -> the assignment with no end day.
  final currentByCar = <String, FleetAssignment>{};
  final currentByDriver = <String, FleetAssignment>{};
}

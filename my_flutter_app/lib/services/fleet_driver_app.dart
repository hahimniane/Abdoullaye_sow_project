// A Fleet driver's own account in the app (docs/FLEET.md section 11): the
// model of the server's `driver_home` answer and the pure rules the driver
// screens say things with. No Firebase, no clock (the server sends today).
//
// The server decides who is a driver (the signed-in account's verified phone
// is on a driver record) and what they may see; nothing here widens it.

import 'dart:convert';

import 'fleet_billing.dart';
import 'fleet_models.dart';
import 'fleet_views.dart' show FleetExpiry, fleetExpiryState;

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

/// A plate the driver holds now, with the papers a driver must keep valid.
class DriverPlate {
  const DriverPlate({
    this.assignmentId = '',
    this.plate = '',
    this.vehicleType = '',
    this.driverOwnsCar = false,
    this.registrationExpiry = '',
    this.diamondExpiry = '',
    this.insurer = '',
    this.policyNumber = '',
    this.rentCents = 0,
    this.period = 'monthly',
    this.dueDay = 1,
    this.startDayKey = '',
  });

  factory DriverPlate.fromMap(Map<String, dynamic> m) => DriverPlate(
    assignmentId: _s(m['assignmentId']),
    plate: _s(m['plate']),
    vehicleType: _s(m['vehicleType']),
    driverOwnsCar: _s(m['ownership']) == 'driver',
    registrationExpiry: _s(m['registrationExpiry']),
    diamondExpiry: _s(m['diamondExpiry']),
    insurer: _s(m['insurer']),
    policyNumber: _s(m['policyNumber']),
    rentCents: _i(m['rentCents']),
    period: _s(m['period']) == 'weekly' ? 'weekly' : 'monthly',
    dueDay: _i(m['dueDay']) == 0 ? 1 : _i(m['dueDay']),
    startDayKey: _s(m['startDayKey']),
  );

  final String assignmentId, plate, vehicleType, period, startDayKey;
  final String registrationExpiry, diamondExpiry, insurer, policyNumber;
  final bool driverOwnsCar;
  final int rentCents, dueDay;

  bool get isWeekly => period == 'weekly';
}

/// Where a payment the driver reported stands.
enum DriverClaimState {
  /// Waiting for the deposit to show in the business's bank.
  checking,

  /// We asked the driver something on WhatsApp and wait for the answer.
  reply,

  /// A person at the business is looking at it.
  office,
}

class DriverClaim {
  const DriverClaim({
    this.id = '',
    this.amountCents = 0,
    this.state = DriverClaimState.checking,
    this.createdAtMs = 0,
  });

  factory DriverClaim.fromMap(Map<String, dynamic> m) => DriverClaim(
    id: _s(m['id']),
    amountCents: _i(m['amountCents']) < 0 ? 0 : _i(m['amountCents']),
    state: switch (_s(m['state'])) {
      'reply' => DriverClaimState.reply,
      'office' => DriverClaimState.office,
      _ => DriverClaimState.checking,
    },
    createdAtMs: _i(m['createdAtMs']),
  );

  final String id;
  final int amountCents, createdAtMs;
  final DriverClaimState state;
}

/// One fleet business as its driver sees it.
class DriverFleet {
  const DriverFleet({
    this.businessId = '',
    this.businessName = '',
    this.businessPhone = '',
    this.onlyFleet = true,
    this.zelleName = '',
    this.zelleHandle = '',
    this.driverName = '',
    this.left = false,
    this.shipsPackages = false,
    this.sendPackageSlug = '',
    this.balance = const FleetBalance(
      owedCents: 0,
      lateCents: 0,
      creditCents: 0,
    ),
    this.plates = const [],
    this.bills = const [],
    this.payments = const [],
    this.claims = const [],
  });

  factory DriverFleet.fromMap(Map<String, dynamic> m) {
    final zelle = _map(m['zelle']);
    final driver = _map(m['driver']);
    final balance = _map(m['balance']);
    final credit = _i(driver['creditCents']);
    final shipping = _map(m['shipping']);
    return DriverFleet(
      shipsPackages: shipping['enabled'] == true,
      sendPackageSlug: shipping['enabled'] == true
          ? _s(shipping['sendSlug'])
          : '',
      businessId: _s(m['businessId']),
      businessName: _s(m['businessName']),
      businessPhone: _s(m['businessPhone']),
      // On unless the server says the Fleet admin switched it off.
      onlyFleet: m['onlyFleet'] != false,
      zelleName: _s(zelle['name']),
      zelleHandle: _s(zelle['handle']),
      driverName: _s(driver['name']),
      left: _s(driver['status']) == 'left',
      balance: FleetBalance(
        owedCents: _i(balance['owedCents']) < 0 ? 0 : _i(balance['owedCents']),
        lateCents: _i(balance['lateCents']) < 0 ? 0 : _i(balance['lateCents']),
        creditCents: credit < 0 ? 0 : credit,
        nextDueDayKey: _s(balance['nextDueDayKey']),
        nextDueCents: _i(balance['nextDueCents']),
      ),
      plates: [for (final p in _maps(m['plates'])) DriverPlate.fromMap(p)],
      bills: [
        for (final b in _maps(m['bills'])) FleetBill.fromMap(_s(b['id']), b),
      ],
      payments: [
        for (final p in _maps(m['payments']))
          FleetPayment.fromMap(_s(p['id']), {
            ...p,
            // The server says "import" for spreadsheet history.
            if (_s(p['method']) == 'import') 'imported': true,
          }),
      ],
      claims: [for (final c in _maps(m['claims'])) DriverClaim.fromMap(c)],
    );
  }

  final String businessId, businessName, businessPhone;
  final String zelleName, zelleHandle, driverName;

  /// The business wants its drivers to see Fleet and nothing else of Laawol.
  final bool onlyFleet;

  /// The driver has left the business (shown only while they still owe).
  final bool left;

  /// The fleet business also ships packages (docs/FLEET.md Q11: a driver
  /// sees its Fleet pages and its other services, never another business).
  final bool shipsPackages;

  /// Its request link's name when it takes package requests from customers;
  /// '' when it does not.
  final String sendPackageSlug;

  bool get takesPackageRequests => sendPackageSlug.isNotEmpty;
  final FleetBalance balance;
  final List<DriverPlate> plates;

  /// Open bills first (soonest due first), then paid and waived, newest first.
  final List<FleetBill> bills;
  final List<FleetPayment> payments;
  final List<DriverClaim> claims;

  List<FleetBill> get openBills => [
    for (final b in bills)
      if (b.isOpen && b.remainingCents > 0) b,
  ];

  bool get hasZelle => zelleHandle.isNotEmpty;
}

/// The whole `driver_home` answer.
class DriverHome {
  const DriverHome({
    this.todayKey = '',
    this.proofWhatsApp = '',
    this.fleets = const [],
  });

  factory DriverHome.fromMap(Map<String, dynamic> m) => DriverHome(
    todayKey: _s(m['todayKey']),
    proofWhatsApp: _s(m['proofWhatsApp']),
    fleets: [
      for (final f in _maps(m['fleets']))
        if (_s(f['businessId']).isNotEmpty) DriverFleet.fromMap(f),
    ],
  );

  /// Reads what [encode] wrote; null when it is not an answer.
  static DriverHome? decode(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final value = jsonDecode(raw);
      return value is Map ? DriverHome.fromMap(_map(value)) : null;
    } catch (_) {
      return null;
    }
  }

  /// The server's answer as text, to show at once on the next launch.
  static String encode(Map<String, dynamic> answer) => jsonEncode({
    'todayKey': answer['todayKey'],
    'proofWhatsApp': answer['proofWhatsApp'],
    'fleets': answer['fleets'],
  });

  static const none = DriverHome();

  final String todayKey;

  /// Laawol's WhatsApp number, where the Zelle screenshot goes (E.164).
  final String proofWhatsApp;
  final List<DriverFleet> fleets;

  bool get isDriver => fleets.isNotEmpty;

  /// The business whose drivers see only Fleet, when the account drives for
  /// one: the app then opens on it and shows nothing else. With two such
  /// businesses the one that is owed money comes first.
  DriverFleet? get lockedFleet {
    DriverFleet? pick;
    for (final f in fleets) {
      if (!f.onlyFleet) continue;
      if (pick == null ||
          (pick.balance.owedCents == 0 && f.balance.owedCents > 0)) {
        pick = f;
      }
    }
    return pick;
  }
}

// ---------------------------------------------------------------------------
// What the screens say.
// ---------------------------------------------------------------------------

/// Where the driver stands with money, in one word.
enum DriverOwe {
  /// Nothing to pay.
  nothing,

  /// Something to pay, none of it past its day.
  due,

  /// Something is past its day.
  late,
}

/// The headline of the driver's home: how much, and the day that matters
/// (the oldest late day when late, else the next due day).
({DriverOwe state, int cents, String dayKey}) driverOwe(
  DriverFleet fleet,
  String todayKey,
) {
  final owed = fleet.balance.owedCents;
  if (owed <= 0) return (state: DriverOwe.nothing, cents: 0, dayKey: '');
  if (fleet.balance.lateCents > 0) {
    var oldest = '';
    for (final b in fleet.openBills) {
      if (b.dueDayKey.isEmpty || b.dueDayKey.compareTo(todayKey) >= 0) {
        continue;
      }
      if (oldest.isEmpty || b.dueDayKey.compareTo(oldest) < 0) {
        oldest = b.dueDayKey;
      }
    }
    return (state: DriverOwe.late, cents: owed, dayKey: oldest);
  }
  return (
    state: DriverOwe.due,
    cents: owed,
    dayKey: fleet.balance.nextDueDayKey,
  );
}

/// What a bill is, for its title.
enum DriverBillKind { plateFee, lateFee, charge, ticket }

DriverBillKind driverBillKind(FleetBill bill) => switch (bill.kind) {
  'rent' => DriverBillKind.plateFee,
  'late_fee' => DriverBillKind.lateFee,
  'ticket' => DriverBillKind.ticket,
  _ => DriverBillKind.charge,
};

/// The period a plate-fee bill covers: "Dec 2026" for a month, "Dec 7,
/// 2026 - Dec 13, 2026" for a week, '' when the bill names no period.
String driverBillPeriod(FleetBill bill, {String language = 'en'}) {
  if (bill.periodFrom.isEmpty) return '';
  final to = bill.periodTo.isEmpty ? bill.periodFrom : bill.periodTo;
  final days = fleetDayNumber(to) - fleetDayNumber(bill.periodFrom);
  if (days >= 20 || days == 0) {
    return fleetMonthLabel(fleetMonthOf(bill.periodFrom), language: language);
  }
  return fleetSpanLabel(bill.periodFrom, to);
}

/// A bill's state for its chip.
enum DriverBillState { paid, waived, late, open }

DriverBillState driverBillState(FleetBill bill, String todayKey) {
  if (bill.status == 'paid') return DriverBillState.paid;
  if (bill.status == 'waived') return DriverBillState.waived;
  if (bill.remainingCents <= 0) return DriverBillState.paid;
  return bill.dueDayKey.isNotEmpty && bill.dueDayKey.compareTo(todayKey) < 0
      ? DriverBillState.late
      : DriverBillState.open;
}

/// The worst paper of a plate, so My plate can lead with what needs doing.
FleetExpiry driverPlateWorst(DriverPlate plate, String todayKey) {
  const order = [
    FleetExpiry.expired,
    FleetExpiry.soon,
    FleetExpiry.missing,
    FleetExpiry.ok,
  ];
  final states = [
    fleetExpiryState(plate.registrationExpiry, todayKey),
    fleetExpiryState(plate.diamondExpiry, todayKey),
  ];
  for (final s in order) {
    if (states.contains(s)) return s;
  }
  return FleetExpiry.ok;
}

/// The WhatsApp chat with Laawol, opened with [text] ready to send: where a
/// driver sends the Zelle screenshot. Null when the number is not a number.
Uri? driverProofWhatsAppUri(String e164, String text) {
  final digits = e164.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.length < 8 || digits.length > 15) return null;
  return Uri.https('wa.me', '/$digits', {'text': text});
}

/// A phone number the way a person reads it: "+1 (347) 559-6214" for a US
/// number, the number as given otherwise.
String driverPhoneLabel(String e164) {
  final digits = e164.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.length == 11 && digits.startsWith('1')) {
    return '+1 (${digits.substring(1, 4)}) ${digits.substring(4, 7)}-'
        '${digits.substring(7)}';
  }
  return e164.trim();
}

const _monthsShortFr = [
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
const _weekdaysEn = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const _weekdaysFr = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
];
final _dayKey = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');

/// A day the way the driver's language writes it: "Dec 1, 2026" in English
/// (month first), "1er déc. 2026" in French; '' when it is not a day.
String driverDayLabel(String dayKey, {String language = 'en'}) {
  if (language != 'fr') return fleetDayLabel(dayKey);
  final m = _dayKey.firstMatch(dayKey.trim());
  if (m == null) return '';
  final month = int.parse(m.group(2)!);
  final day = int.parse(m.group(3)!);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return '${day == 1 ? '1er' : day} ${_monthsShortFr[month - 1]} '
      '${m.group(1)}';
}

/// The weekday a weekly fee is due on (1 = Monday ... 7 = Sunday).
String driverWeekdayName(int dueDay, {String language = 'en'}) {
  final i = (dueDay < 1 || dueDay > 7 ? 1 : dueDay) - 1;
  return language == 'fr' ? _weekdaysFr[i] : _weekdaysEn[i];
}

/// A day of the month in a sentence: "1" in English, "1er" for the first in
/// French ("le 1er de chaque mois").
String driverDayOfMonth(int day, {String language = 'en'}) =>
    language == 'fr' && day == 1 ? '1er' : '$day';

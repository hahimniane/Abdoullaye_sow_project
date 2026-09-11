/// The lot ledger's numbers, app side. Mirrors `functions/lot_ledger.js` and
/// the read-side arithmetic of the console's Lot ledger panel: which month an
/// entry counts in, what a month earned and cost, what is still owed, and the
/// year series behind the reports. Pure Dart, tested without Firebase.
library;

import 'package:intl/intl.dart';

// ---------------------------------------------------------------------------
// Vocabulary shared with the server.
// ---------------------------------------------------------------------------

const lotCustomActivityId = 'custom';

const lotPaymentMethodLink = 'payment_link';
const lotPaymentMethodDirect = 'direct';

const lotStatusSucceeded = 'succeeded';
const lotStatusAwaitingLink = 'awaiting_payment_link';
const lotStatusAwaitingDirect = 'awaiting_direct_payment';
const lotStatusCancelled = 'cancelled';

const lotReceivedViaOptions = <String>[
  'zelle',
  'cash',
  'cashapp',
  'venmo',
  'check',
  'card_in_person',
  'other',
];

const lotAuctionHouses = <String>[
  'ACV',
  'IAAI',
  'Copart',
  'Adesa',
  'Manheim',
  'Other',
];

const lotExpenseKindFixed = 'fixed';
const lotExpenseKindMetered = 'metered';
const lotExpenseKindOneOff = 'one_off';

/// Proof is asked for at this amount and above when a business has not set
/// its own threshold. Same default as the server.
const lotDefaultProofThresholdCents = 7500;

// ---------------------------------------------------------------------------
// Money and dates.
// ---------------------------------------------------------------------------

String _s(Object? v, [int max = 200]) {
  final t = (v ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

int _cents(Object? v) {
  if (v is int) return v;
  if (v is num) return v.round();
  return int.tryParse((v ?? '').toString()) ?? 0;
}

/// "$1,234.50" — negatives keep their sign in front of the currency mark.
String formatLotCents(int cents) {
  final formatter = NumberFormat.currency(symbol: r'$', decimalDigits: 2);
  final text = formatter.format(cents.abs() / 100);
  return cents < 0 ? '-$text' : text;
}

/// Dollars as typed ("12", "12.5", "$1,200.00") to cents, null when unusable.
int? lotDollarsToCents(String raw) {
  final cleaned = raw.replaceAll(RegExp(r'[$,\s]'), '');
  if (cleaned.isEmpty) return null;
  final value = double.tryParse(cleaned);
  if (value == null || value.isNaN || value.isInfinite) return null;
  return (value * 100).round();
}

/// `yyyy-MM` for a month.
String lotMonthKey(DateTime day) => DateFormat('yyyy-MM').format(day);

/// The first day of the month `yyyy-MM` names; today's month when unparsable.
DateTime lotMonthStart(String key) {
  final parts = key.split('-');
  final y = int.tryParse(parts.elementAtOrNull(0) ?? '');
  final m = int.tryParse(parts.elementAtOrNull(1) ?? '');
  if (y == null || m == null || m < 1 || m > 12) {
    final now = DateTime.now();
    return DateTime(now.year, now.month);
  }
  return DateTime(y, m);
}

String lotShiftMonth(String key, int delta) {
  final start = lotMonthStart(key);
  return lotMonthKey(DateTime(start.year, start.month + delta));
}

/// The twelve month keys of a year, January first.
List<String> lotYearMonths(int year) => [
      for (var m = 1; m <= 12; m++)
        '$year-${m.toString().padLeft(2, '0')}',
    ];

/// Dates are sent frozen at midday so a timezone cannot roll them back a day.
String lotMiddayIso(DateTime day) =>
    '${DateFormat('yyyy-MM-dd').format(day)}T12:00:00';

DateTime? lotDateOf(Object? value) {
  if (value == null) return null;
  if (value is DateTime) return value;
  // A Firestore Timestamp exposes toDate(); keep this file free of the SDK.
  try {
    final dynamic d = value;
    final converted = d.toDate();
    if (converted is DateTime) return converted;
  } catch (_) {}
  if (value is String) return DateTime.tryParse(value);
  if (value is num) {
    return DateTime.fromMillisecondsSinceEpoch(value.toInt());
  }
  return null;
}

// ---------------------------------------------------------------------------
// Records, as the screen reads them.
// ---------------------------------------------------------------------------

class LotActivityType {
  const LotActivityType({
    required this.id,
    required this.label,
    required this.defaultFeeCents,
    required this.needsAuctionHouse,
    required this.active,
    required this.sortOrder,
  });

  final String id;
  final String label;
  final int defaultFeeCents;
  final bool needsAuctionHouse;
  final bool active;
  final int sortOrder;

  factory LotActivityType.fromMap(String id, Map<String, dynamic> d) {
    return LotActivityType(
      id: id,
      label: _s(d['label'], 120),
      defaultFeeCents: _cents(d['defaultFeeCents']),
      needsAuctionHouse: d['needsAuctionHouse'] == true,
      active: d['active'] != false,
      sortOrder: _cents(d['sortOrder']),
    );
  }
}

class LotActivity {
  const LotActivity({
    required this.id,
    required this.activityTypeId,
    required this.activityTypeLabel,
    required this.customLabel,
    required this.feeCents,
    required this.customerName,
    required this.customerPhone,
    required this.customerEmail,
    required this.carMake,
    required this.carModel,
    required this.carYear,
    required this.vinNumber,
    required this.auctionHouse,
    required this.paymentMethod,
    required this.paymentStatus,
    required this.receivedVia,
    required this.receivedByStaffId,
    required this.activityDate,
    required this.activityDateMonth,
    required this.voided,
    required this.voidReason,
    required this.trackingCode,
  });

  final String id;
  final String activityTypeId;
  final String activityTypeLabel;
  final String customLabel;
  final int feeCents;
  final String customerName;
  final String customerPhone;
  final String customerEmail;
  final String carMake;
  final String carModel;
  final String carYear;
  final String vinNumber;
  final String auctionHouse;
  final String paymentMethod;
  final String paymentStatus;
  final String receivedVia;
  final String receivedByStaffId;
  final DateTime? activityDate;
  final String activityDateMonth;
  final bool voided;
  final String voidReason;
  final String trackingCode;

  factory LotActivity.fromMap(String id, Map<String, dynamic> d) {
    final date = lotDateOf(d['activityDate']);
    final explicitMonth = _s(d['activityDateMonth'], 7);
    return LotActivity(
      id: id,
      activityTypeId: _s(d['activityTypeId'], 120),
      activityTypeLabel: _s(d['activityTypeLabel'], 120),
      customLabel: _s(d['customLabel'], 120),
      feeCents: _cents(d['feeCents']),
      customerName: _s(d['customerName']),
      customerPhone: _s(d['customerPhone'], 40),
      customerEmail: _s(d['customerEmail'], 180),
      carMake: _s(d['carMake'], 80),
      carModel: _s(d['carModel'], 80),
      carYear: _s(d['carYear'], 8),
      vinNumber: _s(d['vinNumber'], 17).toUpperCase(),
      auctionHouse: _s(d['auctionHouse'], 40),
      paymentMethod: _s(d['paymentMethod'], 40),
      paymentStatus: _s(d['paymentStatus'], 40),
      receivedVia: _s(d['receivedVia'], 40),
      receivedByStaffId: _s(d['receivedByStaffId'], 120),
      activityDate: date,
      activityDateMonth: RegExp(r'^\d{4}-\d{2}$').hasMatch(explicitMonth)
          ? explicitMonth
          : (date == null ? '' : lotMonthKey(date)),
      voided: d['voided'] == true,
      voidReason: _s(d['voidReason'], 300),
      trackingCode: _s(d['trackingCode'], 40),
    );
  }

  bool get isCustom => activityTypeId == lotCustomActivityId;

  /// What the row is called: the type's label, or what staff typed for a
  /// one-off.
  String get label => isCustom
      ? (customLabel.isNotEmpty ? customLabel : activityTypeLabel)
      : (activityTypeLabel.isNotEmpty ? activityTypeLabel : customLabel);

  /// "2019 Toyota Camry" when the car is known, else the VIN.
  String get vehicleLabel {
    final name = [carYear, carMake, carModel]
        .where((p) => p.isNotEmpty)
        .join(' ');
    return name.isNotEmpty ? name : vinNumber;
  }

  bool get paid => paymentStatus == lotStatusSucceeded;
  bool get awaitingLink => paymentStatus == lotStatusAwaitingLink;
  bool get cancelled => paymentStatus == lotStatusCancelled;

  /// A direct activity logged before its cash arrived: still owed, and settled
  /// only by marking it received (there is no link to re-send).
  bool get awaitingDirect =>
      paymentMethod == lotPaymentMethodDirect &&
      paymentStatus == lotStatusAwaitingDirect;

  /// Still has money to collect: an unpaid link, or a direct activity logged
  /// as owed. Both are settled from the same control; only a link can also be
  /// re-sent. Never a settled, cancelled or voided row.
  bool get canChase => !voided && (awaitingLink || awaitingDirect);

  /// Counts toward revenue: neither voided nor cancelled.
  bool get countsAsRevenue => !voided && !cancelled;

  /// A document exists once the money has a state the customer can be shown:
  /// a receipt when paid, an invoice while the link is open.
  bool get hasDocument => !voided && (paid || awaitingLink);
}

class LotExpenseLine {
  const LotExpenseLine({
    required this.id,
    required this.label,
    required this.detail,
    required this.kind,
    required this.recurringCents,
    required this.onlyMonth,
    required this.active,
    required this.sortOrder,
    required this.createdAt,
  });

  final String id;
  final String label;
  final String detail;
  final String kind;
  final int recurringCents;
  final String onlyMonth;
  final bool active;
  final int sortOrder;
  final DateTime? createdAt;

  factory LotExpenseLine.fromMap(String id, Map<String, dynamic> d) {
    return LotExpenseLine(
      id: id,
      label: _s(d['label'], 120),
      detail: _s(d['detail'], 200),
      kind: _s(d['kind'], 20),
      recurringCents: _cents(d['recurringCents']),
      onlyMonth: _s(d['onlyMonth'], 7),
      active: d['active'] != false,
      sortOrder: _cents(d['sortOrder']),
      createdAt: lotDateOf(d['createdAt']),
    );
  }

  bool get isFixed => kind == lotExpenseKindFixed;
  bool get isMetered => kind == lotExpenseKindMetered;

  /// The first month this line can have cost anything: the month it was set
  /// up. Empty when unknown, which reads as "no lower bound".
  String get firstMonth => createdAt == null ? '' : lotMonthKey(createdAt!);
}

/// A car the lot has already seen, from a parked car, a past activity, or the
/// customer memory. The point of it is that nobody re-types a vehicle the
/// business already has on file.
class LotKnownCar {
  const LotKnownCar({
    required this.vin,
    required this.make,
    required this.model,
    required this.year,
    this.customerName = '',
    this.customerPhone = '',
  });

  final String vin;
  final String make;
  final String model;
  final String year;
  final String customerName;
  final String customerPhone;

  bool get hasVehicle =>
      make.isNotEmpty || model.isNotEmpty || year.isNotEmpty;

  String get label {
    final name = [year, make, model].where((p) => p.isNotEmpty).join(' ');
    return name.isEmpty ? vin : name;
  }

  factory LotKnownCar.fromMap(Map<String, dynamic> d) {
    return LotKnownCar(
      vin: _s(d['vinNumber'], 17).toUpperCase(),
      make: _s(d['carMake'], 80),
      model: _s(d['carModel'], 80),
      year: _s(d['carYear'], 8),
      customerName: _s(d['customerName']).isNotEmpty
          ? _s(d['customerName'])
          : _s(d['ownerName']),
      customerPhone: _s(d['customerPhone'], 40),
    );
  }
}

/// The best record of a VIN the business already holds. Prefers one that
/// actually names the vehicle, so a bare VIN on an old row does not shadow a
/// parked car that knows the make and model.
LotKnownCar? lotFindKnownCar(String vin, List<LotKnownCar> cars) {
  final needle = vin.trim().toUpperCase();
  if (needle.length < 6) return null;
  LotKnownCar? fallback;
  for (final car in cars) {
    if (car.vin != needle) continue;
    if (car.hasVehicle) return car;
    fallback ??= car;
  }
  return fallback;
}

/// What one expense line cost over a span, for the ranking in Reports.
class LotLineSpend {
  const LotLineSpend({
    required this.lineId,
    required this.label,
    required this.cents,
  });

  final String lineId;
  final String label;
  final int cents;
}

class LotExpenseEntry {
  const LotExpenseEntry({
    required this.id,
    required this.lineId,
    required this.month,
    required this.amountCents,
    required this.paidByStaffId,
    required this.note,
    required this.spentAt,
    required this.proofUrl,
    required this.proofFileName,
    required this.voided,
    required this.voidReason,
  });

  final String id;
  final String lineId;
  final String month;
  final int amountCents;
  final String paidByStaffId;
  final String note;
  final DateTime? spentAt;
  final String proofUrl;
  final String proofFileName;
  final bool voided;
  final String voidReason;

  factory LotExpenseEntry.fromMap(String id, Map<String, dynamic> d) {
    final spent = lotDateOf(d['spentAt']);
    final explicit = _s(d['month'], 7);
    return LotExpenseEntry(
      id: id,
      lineId: _s(d['lineId'], 120),
      // The one month an entry counts in: the bill month it was logged
      // against, else the month it was bought. Never both.
      month: RegExp(r'^\d{4}-\d{2}$').hasMatch(explicit)
          ? explicit
          : (spent == null ? '' : lotMonthKey(spent)),
      amountCents: _cents(d['amountCents']),
      paidByStaffId: _s(d['paidByStaffId'], 120),
      note: _s(d['note'], 500),
      spentAt: spent,
      proofUrl: _s(d['proofUrl'], 2000),
      proofFileName: _s(d['proofFileName'], 200),
      voided: d['voided'] == true,
      voidReason: _s(d['voidReason'], 300),
    );
  }

  bool get hasProof => proofUrl.isNotEmpty;
}

class LotAuditEvent {
  const LotAuditEvent({
    required this.id,
    required this.action,
    required this.byStaffId,
    required this.summary,
    required this.at,
  });

  final String id;
  final String action;
  final String byStaffId;
  final String summary;
  final DateTime? at;

  factory LotAuditEvent.fromMap(String id, Map<String, dynamic> d) {
    return LotAuditEvent(
      id: id,
      action: _s(d['action'], 40),
      byStaffId: _s(d['byStaffId'], 120),
      summary: _s(d['summary'], 300),
      at: lotDateOf(d['at']),
    );
  }
}

// ---------------------------------------------------------------------------
// The arithmetic. Every function reads the same records the lists show, so a
// tile and the rows under it can never disagree.
// ---------------------------------------------------------------------------

class LotTypeRevenue {
  const LotTypeRevenue({
    required this.typeId,
    required this.cents,
    required this.count,
  });

  final String typeId;
  final int cents;
  final int count;
}

class LotLedgerMath {
  LotLedgerMath({
    required this.activities,
    required this.lines,
    required this.entries,
    String? nowMonth,
  }) : nowMonth = nowMonth ?? lotMonthKey(DateTime.now());

  final List<LotActivity> activities;
  final List<LotExpenseLine> lines;
  final List<LotExpenseEntry> entries;

  /// The month the report is being read in. A standing charge is not owed for
  /// a month that has not arrived yet.
  final String nowMonth;

  Iterable<LotActivity> activitiesIn(String month) =>
      activities.where((a) => a.activityDateMonth == month);

  /// Revenue a month earned: every live, non-cancelled activity's fee.
  int monthRevenueCents(String month) => activitiesIn(month)
      .where((a) => a.countsAsRevenue)
      .fold(0, (s, a) => s + a.feeCents);

  /// Website links sent this month and not settled.
  int monthAwaitingCents(String month) => activitiesIn(month)
      .where((a) => !a.voided && a.awaitingLink)
      .fold(0, (s, a) => s + a.feeCents);

  /// Revenue by activity type, largest first. One-offs are grouped under
  /// [lotCustomActivityId].
  List<LotTypeRevenue> revenueByType(String month) {
    final totals = <String, List<int>>{};
    for (final a in activitiesIn(month)) {
      if (!a.countsAsRevenue) continue;
      final key = a.isCustom ? lotCustomActivityId : a.activityTypeId;
      final prev = totals.putIfAbsent(key, () => [0, 0]);
      prev[0] += a.feeCents;
      prev[1] += 1;
    }
    final list = [
      for (final e in totals.entries)
        LotTypeRevenue(typeId: e.key, cents: e.value[0], count: e.value[1]),
    ]..sort((a, b) => b.cents.compareTo(a.cents));
    return list;
  }

  Iterable<LotExpenseEntry> get liveEntries => entries.where((e) => !e.voided);

  /// Whether a line that costs the same every month is owed for [month].
  ///
  /// A standing charge belongs to the months the line has actually existed
  /// for: not to months before it was set up, and not to months that have not
  /// happened. Charging it to a whole calendar year the moment it is created
  /// is how a lot that spent \$2,092 in one month reported \$24,092 for the
  /// year, and a margin of -13989%.
  bool fixedLineAppliesTo(LotExpenseLine line, String month) {
    if (!line.isFixed || !line.active) return false;
    if (month.compareTo(nowMonth) > 0) return false;
    final from = line.firstMonth;
    if (from.isNotEmpty && month.compareTo(from) < 0) return false;
    return true;
  }

  bool _overridden(String lineId, String month) =>
      liveEntries.any((e) => e.lineId == lineId && e.month == month);

  String labelForLine(String lineId) =>
      lines.where((l) => l.id == lineId).firstOrNull?.label ?? '';

  /// The purchases logged against a line in a month, live ones only.
  List<LotExpenseEntry> lineEntries(String lineId, String month) => [
        for (final e in liveEntries)
          if (e.lineId == lineId && e.month == month) e,
      ];

  /// What a line cost in a month: its purchases, or — for a line that is the
  /// same every month with nothing logged against it — its standing amount.
  int lineMonthCents(LotExpenseLine line, String month) {
    final logged = lineEntries(line.id, month);
    if (logged.isNotEmpty || !line.isFixed) {
      return logged.fold(0, (s, e) => s + e.amountCents);
    }
    return line.recurringCents;
  }

  /// Every purchase counts in exactly one month, and a fixed line's standing
  /// amount is replaced — not added to — when a live purchase was logged
  /// against it that month. A voided purchase neither counts nor suppresses
  /// the standing amount.
  int monthExpenseCents(String month) {
    var sum = 0;
    for (final e in liveEntries) {
      if (e.month == month) sum += e.amountCents;
    }
    for (final line in lines) {
      if (!fixedLineAppliesTo(line, month)) continue;
      if (!_overridden(line.id, month)) sum += line.recurringCents;
    }
    return sum;
  }

  /// What each line cost across [year], largest first.
  ///
  /// Built from the same per-month rules as [monthExpenseCents], so the parts
  /// always add up to [yearExpenseCents] — a breakdown that disagrees with the
  /// total it sits under is worse than no breakdown.
  List<LotLineSpend> expenseByLine(int year) {
    final totals = <String, int>{};
    void add(String lineId, int cents) {
      if (cents == 0) return;
      totals[lineId] = (totals[lineId] ?? 0) + cents;
    }

    for (final month in lotYearMonths(year)) {
      for (final e in liveEntries) {
        if (e.month == month) add(e.lineId, e.amountCents);
      }
      for (final line in lines) {
        if (!fixedLineAppliesTo(line, month)) continue;
        if (!_overridden(line.id, month)) add(line.id, line.recurringCents);
      }
    }

    final ranked = [
      for (final entry in totals.entries)
        LotLineSpend(
          lineId: entry.key,
          label: labelForLine(entry.key),
          cents: entry.value,
        ),
    ]..sort((a, b) => b.cents.compareTo(a.cents));
    return ranked;
  }

  int monthNetCents(String month) =>
      monthRevenueCents(month) - monthExpenseCents(month);

  List<int> yearRevenueByMonth(int year) =>
      [for (final m in lotYearMonths(year)) monthRevenueCents(m)];

  List<int> yearExpenseByMonth(int year) =>
      [for (final m in lotYearMonths(year)) monthExpenseCents(m)];

  int yearRevenueCents(int year) =>
      yearRevenueByMonth(year).fold(0, (a, b) => a + b);

  int yearExpenseCents(int year) =>
      yearExpenseByMonth(year).fold(0, (a, b) => a + b);
}

/// Whole-percent margin, or null when there is no revenue to divide by.
int? lotMarginPercent(int revenueCents, int netCents) {
  if (revenueCents <= 0) return null;
  return (netCents / revenueCents * 100).round();
}

/// Proof is required at or above the threshold; 0 means never.
bool lotProofRequired(int amountCents, int thresholdCents) {
  if (thresholdCents <= 0) return false;
  return amountCents >= thresholdCents;
}

/// Activities matching a search over VIN, customer name, and phone. An empty
/// query keeps the month scope; a typed one searches every month, the way
/// the console does.
List<LotActivity> lotFilterActivities(
  List<LotActivity> all, {
  required String month,
  required String typeFilter,
  required String query,
}) {
  final q = query.trim().toLowerCase();
  return [
    for (final a in all)
      if ((q.isNotEmpty || a.activityDateMonth == month) &&
          (typeFilter == 'all' ||
              (typeFilter == lotCustomActivityId
                  ? a.isCustom
                  : a.activityTypeId == typeFilter)) &&
          (q.isEmpty ||
              '${a.vinNumber} ${a.customerName} ${a.customerPhone}'
                  .toLowerCase()
                  .contains(q)))
        a,
  ];
}

// ---------------------------------------------------------------------------
// Client-side validation, mirroring the server's codes so the screen can
// refuse before a round trip. The screen maps codes to translated messages.
// ---------------------------------------------------------------------------

class LotActivityDraft {
  const LotActivityDraft({
    required this.activityTypeId,
    required this.customLabel,
    required this.feeCents,
    required this.customerName,
    required this.vinNumber,
    required this.paymentMethod,
    required this.customerPhone,
    required this.customerEmail,
    required this.receivedByStaffId,
    this.paymentReceived = true,
  });

  final String activityTypeId;
  final String customLabel;
  final int? feeCents;
  final String customerName;
  final String vinNumber;
  final String paymentMethod;
  final String customerPhone;
  final String customerEmail;
  final String receivedByStaffId;

  /// Direct only: whether the money is already in hand. When false the activity
  /// is logged as owed and names no one as having received it.
  final bool paymentReceived;
}

List<String> validateLotActivityDraft(
  LotActivityDraft d, {
  required bool lockedPayment,
}) {
  final errors = <String>[];
  if (d.activityTypeId.isEmpty) errors.add('activity_type_invalid');
  if (d.activityTypeId == lotCustomActivityId && d.customLabel.trim().isEmpty) {
    errors.add('custom_label_required');
  }
  if (d.feeCents == null || d.feeCents! < 0) errors.add('fee_required');
  if (d.customerName.trim().isEmpty) errors.add('customer_name_required');
  if (d.vinNumber.trim().isEmpty) errors.add('vin_required');
  if (!lockedPayment) {
    if (d.paymentMethod == lotPaymentMethodLink &&
        d.customerPhone.trim().isEmpty &&
        d.customerEmail.trim().isEmpty) {
      errors.add('payment_link_contact_required');
    }
    // Money taken off-platform must say who held it - but only once it has
    // been received. An activity logged before the money arrives names no one.
    if (d.paymentMethod == lotPaymentMethodDirect &&
        d.paymentReceived &&
        d.receivedByStaffId.trim().isEmpty) {
      errors.add('received_by_required');
    }
  }
  return errors;
}

List<String> validateLotExpenseDraft({
  required int? amountCents,
  required String paidByStaffId,
  required bool hasProof,
  required int thresholdCents,
}) {
  final errors = <String>[];
  if (amountCents == null || amountCents <= 0) {
    errors.add('expense_amount_required');
  }
  if (paidByStaffId.trim().isEmpty) errors.add('expense_paid_by_required');
  if (amountCents != null &&
      lotProofRequired(amountCents, thresholdCents) &&
      !hasProof) {
    errors.add('expense_proof_required');
  }
  return errors;
}

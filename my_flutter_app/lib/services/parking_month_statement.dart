/// Month-end parking bills. Mirrors `functions/parking_month_statement.js`:
/// the same numbers, worked out live from the car - that month's days at the
/// rate, anything unpaid from before as its own line, payments applied
/// oldest month first. Tests pin the three copies to the same results.
library;

import 'package:intl/intl.dart';

import 'lot_ledger.dart' show LotActivity, lotDateOf;
import 'staff_expense_credit.dart';
import 'staff_expense_credit.dart' as credit show earlierExpenseCents;

const _dayMs = 24 * 60 * 60 * 1000;

String _text(Object? v, [int max = 200]) {
  final t = (v ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

/// The UTC calendar day a moment falls on, as a day number.
int? parkingDayNumber(Object? value) {
  final date = lotDateOf(value);
  if (date == null) return null;
  final u = date.toUtc();
  return DateTime.utc(u.year, u.month, u.day).millisecondsSinceEpoch ~/ _dayMs;
}

String _dayKey(int day) => DateTime.fromMillisecondsSinceEpoch(day * _dayMs,
        isUtc: true)
    .toIso8601String()
    .substring(0, 10);

({int first, int last})? parkingMonthDays(String monthKey) {
  final m = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(monthKey.trim());
  if (m == null) return null;
  final year = int.parse(m[1]!);
  final month = int.parse(m[2]!);
  if (month < 1 || month > 12) return null;
  final first = DateTime.utc(year, month, 1).millisecondsSinceEpoch ~/ _dayMs;
  final next = DateTime.utc(year, month + 1, 1).millisecondsSinceEpoch ~/ _dayMs;
  return (first: first, last: next - 1);
}

/// A "whole month" estimate only makes sense for the month still running:
/// today (UTC) is inside it and before its last day. A past month is already
/// whole; on the last day "so far" already is the whole month. Mirrors the
/// console's `parkingMonthCanEstimate`.
bool parkingMonthCanEstimate(String monthKey, [DateTime? now]) {
  final month = parkingMonthDays(monthKey);
  final today = parkingDayNumber(now ?? DateTime.now());
  if (month == null || today == null) return false;
  return today >= month.first && today < month.last;
}

/// The moment a month-end report is worked out "as of". Normally now; for the
/// whole-month estimate of the month still running, its last day at noon UTC,
/// so cars still parked run up to the month's end. Read-only preview - nothing
/// is saved from it. Mirrors the console's `parkingMonthAsOf`.
DateTime parkingMonthAsOf(String monthKey, bool wholeMonth, [DateTime? now]) {
  final at = now ?? DateTime.now();
  if (!wholeMonth || !parkingMonthCanEstimate(monthKey, at)) return at;
  final month = parkingMonthDays(monthKey)!;
  final last = DateTime.fromMillisecondsSinceEpoch(month.last * _dayMs,
      isUtc: true);
  return DateTime.utc(last.year, last.month, last.day, 12);
}

/// The month's last day as a day key ("2026-10-31"), or '' for a bad key.
String parkingMonthLastDayKey(String monthKey) {
  final month = parkingMonthDays(monthKey);
  return month == null ? '' : _dayKey(month.last);
}

String previousParkingMonthKey([DateTime? now]) {
  final n = (now ?? DateTime.now()).toUtc();
  final d = DateTime.utc(n.year, n.month - 1, 1);
  return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}';
}

String shiftParkingMonthKey(String monthKey, int delta) {
  final m = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(monthKey.trim());
  if (m == null) return monthKey;
  final d = DateTime.utc(int.parse(m[1]!), int.parse(m[2]!) + delta, 1);
  return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}';
}

/// "September 2026" in the reader's locale.
String parkingMonthLabel(String monthKey, [String locale = 'en']) {
  final m = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(monthKey.trim());
  if (m == null) return monthKey;
  return DateFormat.yMMMM(locale)
      .format(DateTime.utc(int.parse(m[1]!), int.parse(m[2]!), 1));
}

/// English month name, for the WhatsApp text (mirrors the server's words).
const _monthNamesEn = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
];

/// How a day reads to a person, US style: "Sep 1, 2026" (the key itself when
/// it is not a day). Mirrors the server's `dayLabel` byte for byte - it is
/// what the WhatsApp text shows, so it stays English and needs no intl.
String dayLabel(String key) {
  final k = _text(key, 10);
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(k);
  if (m == null) return k;
  final month = int.parse(m[2]!);
  if (month < 1 || month > 12) return k;
  return '${_monthNamesEn[month - 1].substring(0, 3)} ${int.parse(m[3]!)}, ${m[1]}';
}

String _monthLabelEn(String monthKey) {
  final m = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(monthKey.trim());
  if (m == null) return monthKey;
  return '${_monthNamesEn[int.parse(m[2]!) - 1]} ${m[1]}';
}

int _centsOf(Map<String, dynamic> row, List<String> centsKeys,
    List<String> dollarKeys) {
  for (final key in centsKeys) {
    final n = num.tryParse('${row[key] ?? ''}');
    if (n != null && n > 0) return n.round();
  }
  for (final key in dollarKeys) {
    final n = num.tryParse('${row[key] ?? ''}');
    if (n != null && n > 0) return (n * 100).round();
  }
  return 0;
}

/// What the stay has run up by the end of a given day, in cents.
int parkingAccruedThroughCents(
    Map<String, dynamic> row, int day, int today) {
  final start = parkingDayNumber(row['parkingDate']);
  if (start == null || day < start) return 0;
  final leave = parkingDayNumber(row['parkingEndDate']);
  final end = leave ?? today;
  if (end < start) return 0;
  final through = day < end ? day : end;
  final days = through - start + 1;
  if (leave == null) {
    final daily = ((num.tryParse('${row['dailyRate'] ?? ''}') ?? 0) * 100).round();
    return daily > 0 ? days * daily : 0;
  }
  var total = _centsOf(
      row, const ['amountDueCents', 'totalCostCents'], const ['amountDue', 'totalCost']);
  final stayDays = end - start + 1;
  // Older direct stays could be closed while their open-ended $0 placeholder
  // was left in amountDueCents. Rebuild only those business-entered daily-rate
  // stays; otherwise the paid parking vanishes from month end entirely.
  final legacyDirectStay = total <= 0 &&
      _text(row['paymentMethod'], 40) == 'direct' &&
      (_text(row['source'], 40) == 'business' ||
          row['enteredByBusiness'] == true);
  if (legacyDirectStay) {
    final daily =
        ((num.tryParse('${row['dailyRate'] ?? ''}') ?? 0) * 100).round();
    final minimumDays =
        (num.tryParse('${row['minimumDays'] ?? ''}') ?? 1).floor();
    if (daily > 0) {
      total = (stayDays > minimumDays ? stayDays : minimumDays) * daily;
    }
  }
  return stayDays > 0 ? (total * days / stayDays).round() : 0;
}

int _paidCents(Map<String, dynamic> row, int today) {
  final recorded = (num.tryParse('${row['amountPaidCents'] ?? ''}') ?? 0).round();
  if (recorded > 0) return recorded;
  final status = _text(row['paymentStatus'], 40);
  if (status == 'succeeded' || status == 'paid') {
    return parkingAccruedThroughCents(row, today, today);
  }
  return 0;
}

/// How money came in on a car, as method codes: each recorded payment's
/// `receivedVia`, else the method that settled it, else "card_link" for a
/// payment-link car and "online" for one booked and paid online. Codes, not
/// words - each client names them in its own language. Mirrors the server.
List<String> parkingPaidVia(Map<String, dynamic> row) {
  final via = <String>[];
  void add(Object? v) {
    final code = _text(v, 40).toLowerCase();
    if (code.isNotEmpty && !via.contains(code)) via.add(code);
  }

  final payments = row['parkingPayments'];
  if (payments is List) {
    for (final p in payments) {
      if (p is Map) add(p['receivedVia']);
    }
  }
  if (via.isEmpty) add(row['directPaymentMethod']);
  if (via.isNotEmpty) return via;
  final method = _text(row['paymentMethod'], 40);
  if (method == 'payment_link') return const ['card_link'];
  return method == 'direct' ? const [] : const ['online'];
}

/// How an activity's money came in: its `receivedVia`, else "card_link"
/// when it went out as a payment link. Mirrors the server.
List<String> activityPaidVia(Map<String, dynamic> row) {
  final via = _text(row['receivedVia'], 40).toLowerCase();
  if (via.isNotEmpty) return [via];
  return _text(row['paymentMethod'], 40) == 'payment_link'
      ? const ['card_link']
      : const [];
}

/// "Paid" at month end: billed something for the month and nothing left
/// owing - not for the month and not carried in from before. A customer with
/// nothing billed that month is neither paid nor owing. The one definition;
/// mirrors the server and the console.
bool parkingMonthCustomerPaid({required int monthCents, required int dueCents}) =>
    monthCents > 0 && dueCents <= 0;

class ParkingMonthBill {
  const ParkingMonthBill({
    required this.id,
    required this.monthKey,
    required this.periodFrom,
    required this.periodTo,
    required this.days,
    required this.dayRateCents,
    required this.monthCents,
    required this.monthPaidCents,
    required this.monthUnpaidCents,
    required this.priorUnpaidCents,
    required this.dueCents,
    required this.owes,
    required this.stillParked,
    required this.partialMonth,
    required this.customerName,
    required this.customerPhone,
    required this.customerEmail,
    required this.vehicle,
    required this.vinNumber,
    required this.trackingCode,
    this.paymentMethod = '',
    this.paidVia = const [],
    this.recordable = false,
  });

  final String id;
  final String monthKey;
  final String periodFrom;
  final String periodTo;
  final int days;
  final int dayRateCents;
  final int monthCents;
  final int monthPaidCents;
  final int monthUnpaidCents;
  final int priorUnpaidCents;
  final int dueCents;
  final bool owes;
  final bool stillParked;
  final bool partialMonth;
  final String customerName;
  final String customerPhone;
  final String customerEmail;
  final String vehicle;
  final String vinNumber;
  final String trackingCode;
  final String paymentMethod;

  /// How what was paid toward this month came in (method codes); empty when
  /// nothing was paid toward it.
  final List<String> paidVia;

  /// A payment can be recorded by hand: a direct car the business entered.
  final bool recordable;
}

/// One car's bill for one month, or null when it was not on the lot then.
ParkingMonthBill? parkingMonthStatement(
    Map<String, dynamic> row, String monthKey, [DateTime? now]) {
  if (_text(row['status'], 40) == 'cancelled' || row['voided'] == true) return null;
  // "not_required" is not skipped: open stays were saved that way by mistake
  // while still running up days. A truly free stay runs up $0 and drops out.
  final month = parkingMonthDays(monthKey);
  final start = parkingDayNumber(row['parkingDate']);
  final today = parkingDayNumber(now ?? DateTime.now());
  if (month == null || start == null || today == null) return null;
  final leave = parkingDayNumber(row['parkingEndDate']);
  final lastDay = leave ?? today;
  final from = start > month.first ? start : month.first;
  final to = lastDay < month.last ? lastDay : month.last;
  if (to < from) return null;

  final prior = parkingAccruedThroughCents(row, month.first - 1, today);
  final through = parkingAccruedThroughCents(row, to, today);
  final monthCents = through - prior > 0 ? through - prior : 0;
  if (monthCents <= 0) return null;

  final paid = _paidCents(row, today);
  final priorUnpaid = prior - paid > 0 ? prior - paid : 0;
  final towardMonth = paid - prior > 0 ? paid - prior : 0;
  final monthPaid = towardMonth < monthCents ? towardMonth : monthCents;
  final monthUnpaid = monthCents - monthPaid;
  final days = to - from + 1;
  final customer = _text(row['customerName']).isNotEmpty
      ? _text(row['customerName'])
      : _text(row['ownerName']);

  return ParkingMonthBill(
    id: _text(row['id']),
    monthKey: monthKey,
    periodFrom: _dayKey(from),
    periodTo: _dayKey(to),
    days: days,
    dayRateCents: (monthCents / days).round(),
    monthCents: monthCents,
    monthPaidCents: monthPaid,
    monthUnpaidCents: monthUnpaid,
    priorUnpaidCents: priorUnpaid,
    dueCents: priorUnpaid + monthUnpaid,
    owes: monthUnpaid > 0,
    stillParked: leave == null || lastDay > month.last,
    partialMonth: month.last > today,
    customerName: customer,
    customerPhone: _text(row['customerPhone'], 40),
    customerEmail: _text(row['customerEmail'], 180),
    vehicle: [row['carYear'], row['carMake'], row['carModel']]
        .map((v) => _text(v, 80))
        .where((v) => v.isNotEmpty)
        .join(' '),
    vinNumber: _text(row['vinNumber'], 17).toUpperCase(),
    trackingCode: _text(row['trackingCode'], 40),
    paymentMethod: _text(row['paymentMethod'], 40),
    paidVia: monthPaid > 0 ? parkingPaidVia(row) : const [],
    recordable: _text(row['paymentMethod'], 40) == 'direct' &&
        (_text(row['source'], 40) == 'business' || row['enteredByBusiness'] == true),
  );
}

/// One customer for the month: every car on their phone, with its dates.
/// One ledger activity on a month's bill. Mirrors the server.
class ParkingMonthActivity {
  const ParkingMonthActivity({
    required this.id,
    required this.monthKey,
    required this.date,
    required this.label,
    required this.feeCents,
    required this.paidCents,
    required this.dueCents,
    required this.prior,
    required this.customerName,
    required this.customerPhone,
    required this.customerEmail,
    required this.vehicle,
    required this.vinNumber,
    this.paidVia = const [],
  });

  final String id;
  final String monthKey;
  final String date;
  final String label;
  final int feeCents;
  final int paidCents;
  final int dueCents;

  /// Done before the month and still unpaid: "unpaid from before".
  final bool prior;
  final String customerName;
  final String customerPhone;
  final String customerEmail;
  final String vehicle;
  final String vinNumber;

  /// How what was paid came in (method codes); empty when nothing was.
  final List<String> paidVia;
}

/// An activity dated in the month is that month's; an older one still unpaid
/// comes along as "unpaid from before"; voided and free ones never appear.
ParkingMonthActivity? activityMonthItem(Map<String, dynamic> row, String monthKey) {
  if (row['voided'] == true) return null;
  final fee = (num.tryParse('${row['feeCents'] ?? ''}') ?? 0).round();
  if (fee <= 0) return null;
  final month = parkingMonthDays(monthKey);
  final day = parkingDayNumber(row['activityDate']) ?? parkingDayNumber(row['createdAt']);
  if (month == null || day == null || day > month.last) return null;
  final collected = LotActivity.fromMap(_text(row['id']), row).paidCents;
  final paid = collected < fee ? collected : fee;
  final due = fee - paid > 0 ? fee - paid : 0;
  final prior = day < month.first;
  if (prior && due <= 0) return null;
  final raw = _text(row['customLabel']).isNotEmpty
      ? _text(row['customLabel'])
      : (_text(row['activityTypeLabel']).isNotEmpty ? _text(row['activityTypeLabel']) : 'Activity');
  return ParkingMonthActivity(
    id: _text(row['id']),
    monthKey: monthKey,
    date: _dayKey(day),
    label: raw[0].toUpperCase() + raw.substring(1),
    feeCents: fee,
    paidCents: paid,
    dueCents: due,
    prior: prior,
    customerName: _text(row['customerName']),
    customerPhone: _text(row['customerPhone'], 40),
    customerEmail: _text(row['customerEmail'], 180),
    vehicle: [row['carYear'], row['carMake'], row['carModel']]
        .map((v) => _text(v, 80))
        .where((v) => v.isNotEmpty)
        .join(' '),
    vinNumber: _text(row['vinNumber'], 17).toUpperCase(),
    paidVia: paid > 0 ? activityPaidVia(row) : const [],
  );
}

/// One customer for the month: every car on their phone with its dates,
/// every activity with its date.
class ParkingMonthCustomer {
  const ParkingMonthCustomer({
    required this.key,
    required this.monthKey,
    required this.customerName,
    required this.customerPhone,
    required this.customerEmail,
    required this.cars,
    required this.registeredTo,
    required this.activities,
    required this.olderActivities,
    required this.activityRegisteredTo,
    required this.olderRegisteredTo,
    required this.monthCents,
    required this.monthPaidCents,
    required this.monthUnpaidCents,
    required this.priorUnpaidCents,
    required this.dueCents,
    required this.owes,
    required this.paid,
    required this.paidVia,
    required this.partialMonth,
    int? dueBeforeExpensesCents,
    this.expenseCreditCents = 0,
    this.expenseLines = const [],
    this.earlierExpenseCents = 0,
    this.linkedStaffIds = const [],
  }) : dueBeforeExpensesCents = dueBeforeExpensesCents ?? dueCents;

  final String key;
  final String monthKey;
  final String customerName;
  final String customerPhone;
  final String customerEmail;
  final List<ParkingMonthBill> cars;

  /// Per car (same order): the name it was registered under when it is not
  /// the customer's, else ''.
  final List<String> registeredTo;
  final List<ParkingMonthActivity> activities;
  final List<ParkingMonthActivity> olderActivities;
  final List<String> activityRegisteredTo;
  final List<String> olderRegisteredTo;
  final int monthCents;
  final int monthPaidCents;
  final int monthUnpaidCents;
  final int priorUnpaidCents;
  final int dueCents;
  final bool owes;

  /// Billed for the month and nothing left owing ([parkingMonthCustomerPaid]).
  final bool paid;

  /// How this month's payments came in, method codes in first-seen order.
  final List<String> paidVia;
  final bool partialMonth;

  /// What they owed on the lot before their expenses came off
  /// (docs/STAFF_EXPENSE_CREDIT.md §3); the same as [dueCents] for anyone
  /// who is not a linked staff member. [dueCents] is after expenses.
  final int dueBeforeExpensesCents;

  /// The staff expenses taken off this bill ("Less expenses").
  final int expenseCreditCents;

  /// This month's expenses of the linked staff, oldest first.
  final List<ParkingMonthExpenseLine> expenseLines;

  /// The part of [expenseCreditCents] beyond this month's lines - expenses
  /// of earlier months ("Expenses from earlier months"); 0 when none. The
  /// lines plus this add up to "Less expenses" whenever the credit covered
  /// this month's lines.
  final int earlierExpenseCents;

  /// The staff members linked to this customer.
  final List<String> linkedStaffIds;

  /// The same customer with their staff expenses netted in.
  ParkingMonthCustomer _withExpenses(
    StaffNettedCustomer net,
    List<ParkingMonthExpenseLine> lines,
  ) =>
      ParkingMonthCustomer(
        key: key,
        monthKey: monthKey,
        customerName: customerName,
        customerPhone: customerPhone,
        customerEmail: customerEmail,
        cars: cars,
        registeredTo: registeredTo,
        activities: activities,
        olderActivities: olderActivities,
        activityRegisteredTo: activityRegisteredTo,
        olderRegisteredTo: olderRegisteredTo,
        monthCents: monthCents,
        monthPaidCents: monthPaidCents,
        monthUnpaidCents: monthUnpaidCents,
        priorUnpaidCents: priorUnpaidCents,
        dueCents: net.dueCents,
        owes: net.dueCents > 0,
        paid: parkingMonthCustomerPaid(
          monthCents: monthCents,
          dueCents: net.dueCents,
        ),
        paidVia: paidVia,
        partialMonth: partialMonth,
        dueBeforeExpensesCents: net.dueBeforeExpensesCents,
        expenseCreditCents: net.expenseCreditCents,
        expenseLines: lines,
        earlierExpenseCents: credit.earlierExpenseCents(
          net.expenseCreditCents,
          lines.map((l) => l.amountCents),
        ),
        linkedStaffIds: net.linkedStaffIds,
      );
}

/// One expense a linked staff member paid for the lot this month, as the
/// bill lists it ("Expenses you paid for the lot").
class ParkingMonthExpenseLine {
  const ParkingMonthExpenseLine({
    required this.id,
    required this.date,
    required this.label,
    required this.amountCents,
    required this.staffId,
    required this.staffName,
  });

  final String id;

  /// The day it was bought ("2026-10-03"), or '' when undated.
  final String date;

  /// Its expense line's name, then its note ("grosseries · tissu, cups");
  /// '' when neither (each client then says "Lot expense").
  final String label;
  final int amountCents;
  final String staffId;
  final String staffName;
}

/// One row of "Business owes" on the month end.
class ParkingMonthStaffOwed {
  const ParkingMonthStaffOwed({
    required this.staffId,
    required this.staffName,
    required this.customerKey,
    required this.customerName,
    required this.owedCents,
  });

  final String staffId;
  final String staffName;

  /// The linked customer's key; '' when not linked ("No parking bill").
  final String customerKey;

  /// The linked customer's name (this month's bill, else the link's); ''
  /// when not linked.
  final String customerName;
  final int owedCents;
}

/// What month end needs to net staff expenses into the bills
/// (docs/STAFF_EXPENSE_CREDIT.md): every `lotExpenseEntries` row and every
/// `staffExpenseRepayments` row of the business (both sides are cumulative),
/// the business's `staffParkingLinks`, and the team's names.
class ParkingMonthStaffExpenses {
  const ParkingMonthStaffExpenses({
    this.entries = const [],
    this.repayments = const [],
    this.links = const {},
    this.staffNames = const {},
    this.lines = const [],
  });

  /// Rows with `id, paidByStaffId, amountCents, month, voided, note,
  /// lineId` and `spentAt` (a Timestamp, DateTime or ISO string) or
  /// `spentAtMs`.
  final List<Map<String, dynamic>> entries;

  /// `lotExpenseLines` rows (`id, label`): each expense reads as its line's
  /// name, then its note. Without them it reads as its note.
  final List<Map<String, dynamic>> lines;
  final List<Map<String, dynamic>> repayments;
  final Map<String, dynamic> links;
  final Map<String, String> staffNames;
}

String _normName(String v) => v.trim().toLowerCase().replaceAll(RegExp(r'\s+'), ' ');

/// Who a bill goes to: the phone, last ten digits. Mirrors the server.
String parkingCustomerKeyOf(String phone, String name) {
  var digits = phone.replaceAll(RegExp(r'\D+'), '');
  if (digits.length > 10) digits = digits.substring(digits.length - 10);
  if (digits.length >= 7) return 'phone:$digits';
  return 'name:${_normName(name)}';
}

String parkingCustomerKey(ParkingMonthBill b) =>
    parkingCustomerKeyOf(b.customerPhone, b.customerName);

/// The spelling used most often (capitals ignored), capitalised when typed so.
String mostUsedName(Iterable<String> names) {
  final groups = <String, List<String>>{};
  for (final raw in names) {
    final name = raw.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (name.isEmpty) continue;
    groups.putIfAbsent(_normName(name), () => []).add(name);
  }
  if (groups.isEmpty) return '';
  final best = groups.entries.toList()
    ..sort((a, b) {
      final byCount = b.value.length.compareTo(a.value.length);
      if (byCount != 0) return byCount;
      final byLength = b.key.length.compareTo(a.key.length);
      return byLength != 0 ? byLength : a.key.compareTo(b.key);
    });
  int capitalised(String n) =>
      n.split(' ').where((w) => RegExp(r'^[A-ZÀ-Ý]').hasMatch(w)).length;
  final variants = [...best.first.value]
    ..sort((a, b) => capitalised(b).compareTo(capitalised(a)));
  return variants.first;
}

/// One bill per phone: every car with its dates, every activity with its
/// date. Mirrors the server.
List<ParkingMonthCustomer> parkingMonthCustomers(
  Iterable<ParkingMonthBill> bills, [
  Iterable<ParkingMonthActivity> activities = const [],
]) {
  final carGroups = <String, List<ParkingMonthBill>>{};
  final actGroups = <String, List<ParkingMonthActivity>>{};
  for (final b in bills) {
    carGroups.putIfAbsent(parkingCustomerKey(b), () => []).add(b);
  }
  for (final a in activities) {
    actGroups.putIfAbsent(parkingCustomerKeyOf(a.customerPhone, a.customerName), () => []).add(a);
  }
  final keys = {...carGroups.keys, ...actGroups.keys};
  final customers = <ParkingMonthCustomer>[];
  for (final key in keys) {
    final cars = [...?carGroups[key]]
      ..sort((a, b) {
        final byFrom = a.periodFrom.compareTo(b.periodFrom);
        return byFrom != 0 ? byFrom : a.vehicle.compareTo(b.vehicle);
      });
    final acts = [...?actGroups[key]]
      ..sort((a, b) {
        final byDate = a.date.compareTo(b.date);
        return byDate != 0 ? byDate : a.label.compareTo(b.label);
      });
    final name = mostUsedName([
      ...cars.map((b) => b.customerName),
      ...acts.map((a) => a.customerName),
    ]);
    // Every line says whose name it was registered under, also when it is
    // the name at the top of the bill, so a line never looks unnamed.
    String reg(String n) => n.trim().replaceAll(RegExp(r'\s+'), ' ');
    final inMonth = acts.where((a) => !a.prior).toList();
    final older = acts.where((a) => a.prior).toList();
    int sumCars(int Function(ParkingMonthBill) f) => cars.fold(0, (s, b) => s + f(b));
    int sumActs(List<ParkingMonthActivity> l, int Function(ParkingMonthActivity) f) =>
        l.fold(0, (s, a) => s + f(a));
    final monthCents = sumCars((b) => b.monthCents) + sumActs(inMonth, (a) => a.feeCents);
    final monthPaid = sumCars((b) => b.monthPaidCents) + sumActs(inMonth, (a) => a.paidCents);
    final monthUnpaid = sumCars((b) => b.monthUnpaidCents) + sumActs(inMonth, (a) => a.dueCents);
    final priorUnpaid = sumCars((b) => b.priorUnpaidCents) + sumActs(older, (a) => a.dueCents);
    final due = monthUnpaid + priorUnpaid;
    final paidVia = <String>[];
    for (final codes in [
      for (final b in cars)
        if (b.monthPaidCents > 0) b.paidVia,
      for (final a in inMonth)
        if (a.paidCents > 0) a.paidVia,
    ]) {
      for (final code in codes) {
        if (!paidVia.contains(code)) paidVia.add(code);
      }
    }
    String firstNonEmpty(Iterable<String> values) =>
        values.firstWhere((v) => v.isNotEmpty, orElse: () => '');
    customers.add(ParkingMonthCustomer(
      key: key,
      monthKey: cars.isNotEmpty ? cars.first.monthKey : acts.first.monthKey,
      customerName: name,
      customerPhone: firstNonEmpty([...cars.map((b) => b.customerPhone), ...acts.map((a) => a.customerPhone)]),
      customerEmail: firstNonEmpty([...cars.map((b) => b.customerEmail), ...acts.map((a) => a.customerEmail)]),
      cars: cars,
      registeredTo: [for (final b in cars) reg(b.customerName)],
      activities: inMonth,
      olderActivities: older,
      activityRegisteredTo: [for (final a in inMonth) reg(a.customerName)],
      olderRegisteredTo: [for (final a in older) reg(a.customerName)],
      monthCents: monthCents,
      monthPaidCents: monthPaid,
      monthUnpaidCents: monthUnpaid,
      priorUnpaidCents: priorUnpaid,
      dueCents: due,
      owes: due > 0,
      paid: parkingMonthCustomerPaid(monthCents: monthCents, dueCents: due),
      paidVia: paidVia,
      partialMonth: cars.any((b) => b.partialMonth),
    ));
  }
  customers.sort((a, b) {
    final byDue = b.dueCents.compareTo(a.dueCents);
    return byDue != 0 ? byDue : a.customerName.compareTo(b.customerName);
  });
  return customers;
}

/// One customer's bill as WhatsApp text. Mirrors the server's byte for byte.
String parkingMonthCustomerText(ParkingMonthCustomer c, String businessName) {
  final m = int.tryParse(c.monthKey.length >= 7 ? c.monthKey.substring(5, 7) : '') ?? 0;
  final month = m >= 1 && m <= 12 ? _monthNamesEn[m - 1] : 'the month';
  String named(String r) => r.isNotEmpty ? ' (registered to $r)' : '';
  final lines = <String>[
    '${businessName.trim().isEmpty ? 'Parking' : businessName.trim()} — '
        'Monthly bill, ${_monthLabelEn(c.monthKey)}',
    'For: ${[c.customerName.isEmpty ? '—' : c.customerName, c.customerPhone].where((p) => p.isNotEmpty).join(' · ')}',
  ];
  if (c.cars.isNotEmpty) lines..add('')..add('Parking');
  for (var i = 0; i < c.cars.length; i++) {
    final b = c.cars[i];
    lines
      ..add([b.vehicle.isEmpty ? 'Car' : b.vehicle, if (b.vinNumber.isNotEmpty) 'VIN ${b.vinNumber}'].join(' · ') +
          named(c.registeredTo[i]))
      ..add('  ${dayLabel(b.periodFrom)} to ${dayLabel(b.periodTo)}: ${b.days} day'
          '${b.days == 1 ? '' : 's'} × ${parkingMoney(b.dayRateCents)} — '
          '${parkingMoney(b.monthCents)}');
    if (b.priorUnpaidCents > 0) {
      lines.add('  Unpaid from before — ${parkingMoney(b.priorUnpaidCents)}');
    }
    if (b.monthPaidCents > 0) lines.add('  Paid — -${parkingMoney(b.monthPaidCents)}');
  }
  if (c.activities.isNotEmpty) lines..add('')..add('Activities');
  for (var i = 0; i < c.activities.length; i++) {
    final a = c.activities[i];
    lines.add('${dayLabel(a.date)} · ${a.label}${a.vehicle.isNotEmpty ? ' · ${a.vehicle}' : ''}'
        '${named(c.activityRegisteredTo[i])} — ${parkingMoney(a.feeCents)}');
    if (a.paidCents > 0) lines.add('  Paid — -${parkingMoney(a.paidCents)}');
  }
  if (c.olderActivities.isNotEmpty) {
    lines..add('')..add('Unpaid from before');
    for (var i = 0; i < c.olderActivities.length; i++) {
      final a = c.olderActivities[i];
      lines.add('${dayLabel(a.date)} · ${a.label}${a.vehicle.isNotEmpty ? ' · ${a.vehicle}' : ''}'
          '${named(c.olderRegisteredTo[i])} — ${parkingMoney(a.dueCents)}');
    }
  }
  lines
    ..add('')
    ..add('Total for $month — ${parkingMoney(c.monthCents)}');
  if (c.priorUnpaidCents > 0) {
    lines.add('Unpaid from before — ${parkingMoney(c.priorUnpaidCents)}');
  }
  if (c.monthPaidCents > 0) lines.add('Paid — -${parkingMoney(c.monthPaidCents)}');
  lines.add(c.dueCents > 0 ? 'BALANCE DUE: ${parkingMoney(c.dueCents)}' : 'PAID IN FULL');
  return lines.join('\n');
}

class ParkingMonthSummary {
  const ParkingMonthSummary({
    required this.monthKey,
    required this.carsOnLot,
    required this.carsOwing,
    required this.activitiesInMonth,
    required this.customers,
    required this.customersOwing,
    required this.customersPaid,
    required this.billedCents,
    required this.collectedCents,
    required this.owedCents,
    required this.olderOwedCents,
    required this.dueCents,
    required this.owing,
    required this.bills,
    this.expenseCreditCents = 0,
    this.businessOwes = const [],
    this.businessOwesCents = 0,
  });

  final String monthKey;
  final int carsOnLot;
  final int carsOwing;
  final int activitiesInMonth;
  final List<ParkingMonthCustomer> customers;
  final List<ParkingMonthCustomer> customersOwing;

  /// Billed for the month and fully paid, nothing carried in either.
  final List<ParkingMonthCustomer> customersPaid;
  final int billedCents;
  final int collectedCents;
  final int owedCents;
  final int olderOwedCents;
  /// What customers still owe, after staff expenses came off.
  final int dueCents;
  final List<ParkingMonthBill> owing;
  final List<ParkingMonthBill> bills;

  /// Σ staff expenses taken off this month's bills ("Less staff expenses").
  final int expenseCreditCents;

  /// The staff the business still owes for expenses, most owed first.
  final List<ParkingMonthStaffOwed> businessOwes;
  final int businessOwesCents;
}

/// The month's bills. With [staffExpenses], linked staff members' expenses
/// come off their bills and the business's debts to its staff are listed
/// (docs/STAFF_EXPENSE_CREDIT.md §3); without it, exactly the bills as they
/// were before that feature.
ParkingMonthSummary parkingMonthSummary(
  Iterable<Map<String, dynamic>> rows,
  String monthKey, [
  DateTime? now,
  Iterable<Map<String, dynamic>> activityRows = const [],
  ParkingMonthStaffExpenses? staffExpenses,
]) {
  final bills = [
    for (final row in rows) parkingMonthStatement(row, monthKey, now),
  ].whereType<ParkingMonthBill>().toList();
  final activities = [
    for (final row in activityRows) activityMonthItem(row, monthKey),
  ].whereType<ParkingMonthActivity>().toList();
  final inMonth = activities.where((a) => !a.prior).toList();
  int sumBills(int Function(ParkingMonthBill) f) => bills.fold(0, (s, b) => s + f(b));
  int sumActs(int Function(ParkingMonthActivity) f) => inMonth.fold(0, (s, a) => s + f(a));
  var customers = parkingMonthCustomers(bills, activities);
  var businessOwes = const <ParkingMonthStaffOwed>[];
  var businessOwesCents = 0;
  var expenseCreditCents = 0;
  if (staffExpenses != null) {
    final netted = _netStaffExpenses(customers, monthKey, staffExpenses);
    customers = netted.customers;
    businessOwes = netted.businessOwes;
    businessOwesCents = netted.businessOwesCents;
    expenseCreditCents = netted.expenseCreditCents;
  }
  // A car is owing while its customer still owes after expenses came off;
  // without expenses that is every car with something unpaid this month.
  final stillOwing = {
    for (final c in customers)
      if (c.owes) c.key,
  };
  final owing = bills
      .where((b) => b.owes && stillOwing.contains(parkingCustomerKey(b)))
      .toList()
    ..sort((a, b) {
      final byDue = b.dueCents.compareTo(a.dueCents);
      return byDue != 0 ? byDue : a.customerName.compareTo(b.customerName);
    });
  final customersOwing = customers.where((c) => c.owes).toList();
  return ParkingMonthSummary(
    monthKey: monthKey,
    carsOnLot: bills.length,
    carsOwing: owing.length,
    activitiesInMonth: inMonth.length,
    customers: customers,
    customersOwing: customersOwing,
    customersPaid: customers.where((c) => c.paid).toList(),
    billedCents: sumBills((b) => b.monthCents) + sumActs((a) => a.feeCents),
    collectedCents: sumBills((b) => b.monthPaidCents) + sumActs((a) => a.paidCents),
    owedCents: sumBills((b) => b.monthUnpaidCents) + sumActs((a) => a.dueCents),
    olderOwedCents: customersOwing.fold(0, (s, c) => s + c.priorUnpaidCents),
    dueCents: customersOwing.fold(0, (s, c) => s + c.dueCents),
    owing: owing,
    bills: bills,
    expenseCreditCents: expenseCreditCents,
    businessOwes: businessOwes,
    businessOwesCents: businessOwesCents,
  );
}

({
  List<ParkingMonthCustomer> customers,
  List<ParkingMonthStaffOwed> businessOwes,
  int businessOwesCents,
  int expenseCreditCents,
}) _netStaffExpenses(
  List<ParkingMonthCustomer> customers,
  String monthKey,
  ParkingMonthStaffExpenses input,
) {
  final entries = [
    for (final row in input.entries)
      {
        ...row,
        'spentAtMs': row['spentAtMs'] ??
            lotDateOf(row['spentAt'])?.millisecondsSinceEpoch ??
            0,
      },
  ];
  final net = netStaffExpenses(
    [for (final c in customers) (key: c.key, dueCents: c.dueCents)],
    entries: entries,
    repayments: input.repayments,
    links: input.links,
    monthKey: monthKey,
    staffNames: input.staffNames,
  );
  String dayOf(int ms) {
    if (ms <= 0) return '';
    final day = parkingDayNumber(
        DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true));
    return day == null ? '' : _dayKey(day);
  }

  final lineLabels = expenseLineLabels(input.lines);
  final netted = [
    for (var i = 0; i < customers.length; i++)
      customers[i]._withExpenses(net.customers[i], [
        for (final line in monthExpenseLines(
            entries, monthKey, net.customers[i].linkedStaffIds, lineLabels))
          ParkingMonthExpenseLine(
            id: line.id,
            date: dayOf(line.spentAtMs),
            label: line.label,
            amountCents: line.amountCents,
            staffId: line.staffId,
            staffName: _text(input.staffNames[line.staffId], 120),
          ),
      ]),
  ]..sort((a, b) {
      final byDue = b.dueCents.compareTo(a.dueCents);
      return byDue != 0 ? byDue : a.customerName.compareTo(b.customerName);
    });
  final names = {for (final c in customers) c.key: c.customerName};
  String linkedName(String staffId, String key) {
    if (key.isEmpty) return '';
    final billed = names[key] ?? '';
    if (billed.isNotEmpty) return billed;
    final link = input.links[staffId];
    return link is Map ? _text(link['customerName'], 120) : '';
  }

  return (
    customers: netted,
    businessOwes: [
      for (final row in net.businessOwes)
        ParkingMonthStaffOwed(
          staffId: row.staffId,
          staffName: row.staffName,
          customerKey: row.customerKey,
          customerName: linkedName(row.staffId, row.customerKey),
          owedCents: row.owedCents,
        ),
    ],
    businessOwesCents: net.businessOwesCents,
    expenseCreditCents: net.expenseCreditCents,
  );
}

String parkingMoney(int cents) {
  final whole = NumberFormat('#,##0', 'en_US').format(cents.abs() ~/ 100);
  final part = (cents.abs() % 100).toString().padLeft(2, '0');
  return '${cents < 0 ? '-' : ''}\$$whole.$part';
}

/// The WhatsApp text. Mirrors the server's byte for byte.
String parkingMonthBillText(ParkingMonthBill b, String businessName) {
  final lines = <String>[
    '${businessName.trim().isEmpty ? 'Parking' : businessName.trim()} — '
        'Parking bill, ${_monthLabelEn(b.monthKey)}',
    'For: ${b.customerName.isEmpty ? '—' : b.customerName}',
  ];
  final car = [b.vehicle, if (b.vinNumber.isNotEmpty) 'VIN ${b.vinNumber}']
      .where((p) => p.isNotEmpty)
      .join(' · ');
  if (car.isNotEmpty) lines.add(car);
  lines
    ..add('')
    ..add('${dayLabel(b.periodFrom)} to ${dayLabel(b.periodTo)}: ${b.days} day'
        '${b.days == 1 ? '' : 's'} × ${parkingMoney(b.dayRateCents)} — '
        '${parkingMoney(b.monthCents)}');
  if (b.priorUnpaidCents > 0) {
    lines.add('Unpaid from before — ${parkingMoney(b.priorUnpaidCents)}');
  }
  if (b.monthPaidCents > 0) {
    lines.add('Paid — -${parkingMoney(b.monthPaidCents)}');
  }
  lines.add(b.dueCents > 0
      ? 'BALANCE DUE: ${parkingMoney(b.dueCents)}'
      : 'PAID IN FULL');
  return lines.join('\n');
}

/// One line of "Mark all paid".
class MonthBillPaymentItem {
  const MonthBillPaymentItem({
    required this.kind,
    required this.id,
    required this.label,
    required this.amountCents,
  });

  /// 'car' or 'activity'.
  final String kind;
  final String id;
  final String label;
  final int amountCents;

  MonthBillPaymentItem withAmount(int cents) => MonthBillPaymentItem(
      kind: kind, id: id, label: label, amountCents: cents);
}

/// "Mark all paid": what to record against each line, through the payment
/// each line already takes - a part payment on a car (what the bill shows
/// due on it), an instalment on an activity (the rest of its fee). Payment-
/// link cars are Stripe's to record and are skipped. Mirrors the server.
///
/// A linked staff member's expenses already cover part of the bill
/// (`expenseCreditCents`): they cover the first items in order and only the
/// rest is recorded (`itemsAfterCredit`, docs/STAFF_EXPENSE_CREDIT.md §3).
/// The car rows keep that part "unpaid" on purpose - next month the same
/// cumulative credit covers it again.
({List<MonthBillPaymentItem> items, List<MonthBillPaymentItem> skipped, int totalCents})
    monthBillPaymentPlan(ParkingMonthCustomer c) {
  final items = <MonthBillPaymentItem>[];
  final skipped = <MonthBillPaymentItem>[];
  for (final b in c.cars) {
    if (b.dueCents <= 0) continue;
    final entry = MonthBillPaymentItem(
        kind: 'car', id: b.id, label: b.vehicle.isEmpty ? 'Car' : b.vehicle, amountCents: b.dueCents);
    if (!b.recordable) {
      skipped.add(entry);
    } else {
      items.add(entry);
    }
  }
  for (final a in [...c.activities, ...c.olderActivities]) {
    if (a.dueCents <= 0) continue;
    items.add(MonthBillPaymentItem(
      kind: 'activity',
      id: a.id,
      label: '${a.label}${a.vehicle.isNotEmpty ? ' · ${a.vehicle}' : ''} (${dayLabel(a.date)})',
      amountCents: a.dueCents,
    ));
  }
  final toPay = itemsAfterCredit<MonthBillPaymentItem>(
    items,
    c.expenseCreditCents,
    amountOf: (x) => x.amountCents,
    withAmount: (x, cents) => x.withAmount(cents),
  );
  return (
    items: toPay,
    skipped: skipped,
    totalCents: toPay.fold(0, (s, x) => s + x.amountCents),
  );
}


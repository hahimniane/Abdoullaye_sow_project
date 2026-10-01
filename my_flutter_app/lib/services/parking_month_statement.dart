/// Month-end parking bills. Mirrors `functions/parking_month_statement.js`:
/// the same numbers, worked out live from the car - that month's days at the
/// rate, anything unpaid from before as its own line, payments applied
/// oldest month first. Tests pin the three copies to the same results.
library;

import 'package:intl/intl.dart';

import 'lot_ledger.dart' show lotDateOf;

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
  final total = _centsOf(
      row, const ['amountDueCents', 'totalCostCents'], const ['amountDue', 'totalCost']);
  final stayDays = end - start + 1;
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
}

/// One car's bill for one month, or null when it was not on the lot then.
ParkingMonthBill? parkingMonthStatement(
    Map<String, dynamic> row, String monthKey, [DateTime? now]) {
  if (_text(row['status'], 40) == 'cancelled') return null;
  if (_text(row['paymentStatus'], 40) == 'not_required') return null;
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
    stillParked: lastDay > month.last,
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
  );
}

class ParkingMonthSummary {
  const ParkingMonthSummary({
    required this.monthKey,
    required this.carsOnLot,
    required this.carsOwing,
    required this.billedCents,
    required this.collectedCents,
    required this.owedCents,
    required this.olderOwedCents,
    required this.dueCents,
    required this.owing,
    required this.bills,
  });

  final String monthKey;
  final int carsOnLot;
  final int carsOwing;
  final int billedCents;
  final int collectedCents;
  final int owedCents;
  final int olderOwedCents;
  final int dueCents;
  final List<ParkingMonthBill> owing;
  final List<ParkingMonthBill> bills;
}

ParkingMonthSummary parkingMonthSummary(
    Iterable<Map<String, dynamic>> rows, String monthKey, [DateTime? now]) {
  final bills = [
    for (final row in rows) parkingMonthStatement(row, monthKey, now),
  ].whereType<ParkingMonthBill>().toList();
  final owing = bills.where((b) => b.owes).toList()
    ..sort((a, b) {
      final byDue = b.dueCents.compareTo(a.dueCents);
      return byDue != 0 ? byDue : a.customerName.compareTo(b.customerName);
    });
  int sum(Iterable<ParkingMonthBill> list, int Function(ParkingMonthBill) f) =>
      list.fold(0, (s, b) => s + f(b));
  return ParkingMonthSummary(
    monthKey: monthKey,
    carsOnLot: bills.length,
    carsOwing: owing.length,
    billedCents: sum(bills, (b) => b.monthCents),
    collectedCents: sum(bills, (b) => b.monthPaidCents),
    owedCents: sum(bills, (b) => b.monthUnpaidCents),
    olderOwedCents: sum(owing, (b) => b.priorUnpaidCents),
    dueCents: sum(owing, (b) => b.dueCents),
    owing: owing,
    bills: bills,
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
    ..add('${b.periodFrom} to ${b.periodTo}: ${b.days} day'
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

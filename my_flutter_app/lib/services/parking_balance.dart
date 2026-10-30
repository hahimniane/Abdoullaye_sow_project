/// What a parked car owes right now (docs/PARKING_WHATSAPP.md §2, "Money on
/// the car").
///
/// A deliberate mirror of the server's `parkingBalanceNow` and of the
/// console's copy. All three run the shared fixture
/// `functions/test/fixtures/parking-balance-cases.json`
/// (`test/parking_balance_test.dart` here), so a rule changed in one place
/// and not the others fails a test.
///
/// The accrual is the month-end statement's own
/// ([parkingAccruedThroughCents]): an open stay runs up days x daily rate up
/// to today; a stay with a leave day is worth its total. Payments are the
/// recorded, non-reverted ones ([parkingPaidCentsOf]) - reverting a payment
/// zeroes the running total on the car, so the money it counted is gone from
/// here too.
///
/// Pure: no Firebase, no widgets.
library;

import 'parking_month_statement.dart';

const _dayMs = 24 * 60 * 60 * 1000;

/// One car's money as of a moment, in cents.
class ParkingBalance {
  const ParkingBalance({
    required this.dailyRateCents,
    required this.sinceDayKey,
    required this.leftDayKey,
    required this.days,
    required this.accruedCents,
    required this.paidCents,
    required this.balanceCents,
    required this.paidInFull,
    required this.stillParked,
  });

  final int dailyRateCents;

  /// "YYYY-MM-DD" (UTC calendar day), '' when the car has no start day.
  final String sinceDayKey;

  /// "YYYY-MM-DD" of the day the car leaves / left; null while open-ended.
  final String? leftDayKey;

  /// Days counted so far (a stay stops at today or its leave day, whichever
  /// is first), 0 before it starts.
  final int days;
  final int accruedCents;
  final int paidCents;

  /// What is owed now; never negative.
  final int balanceCents;
  final bool paidInFull;
  final bool stillParked;

  Map<String, Object?> toJson() => {
    'dailyRateCents': dailyRateCents,
    'sinceDayKey': sinceDayKey,
    'leftDayKey': leftDayKey,
    'days': days,
    'accruedCents': accruedCents,
    'paidCents': paidCents,
    'balanceCents': balanceCents,
    'paidInFull': paidInFull,
    'stillParked': stillParked,
  };
}

String _dayKey(int day) => DateTime.fromMillisecondsSinceEpoch(
  day * _dayMs,
  isUtc: true,
).toIso8601String().substring(0, 10);

int _wholeCents(Object? value) {
  final n = num.tryParse('${value ?? ''}');
  return n != null && n.isFinite && n > 0 ? n.round() : 0;
}

int _paymentCents(Map<dynamic, dynamic> payment) {
  final cents = num.tryParse('${payment['amountCents'] ?? ''}');
  if (cents != null && cents.isFinite && cents.round() > 0) {
    return cents.round();
  }
  final dollars = num.tryParse('${payment['amount'] ?? ''}');
  return dollars != null && dollars.isFinite && dollars > 0
      ? (dollars * 100).round()
      : 0;
}

/// What is paid now: the live instalments, or the record's total when it is
/// larger. Once any instalment is reverted, only the live list counts.
/// Mirrors the server's `paidNowCents`.
int _paidNowCents(Map<String, dynamic> car, int today) {
  final raw = car['parkingPayments'];
  final list = raw is List ? raw.whereType<Map>().toList() : const <Map>[];
  final live = list.where((p) => p['reverted'] != true).toList();
  final liveCents = live.fold<int>(0, (sum, p) => sum + _paymentCents(p));
  if (live.length < list.length) return liveCents;
  final recorded = parkingPaidCentsOf(car, today);
  return liveCents > recorded ? liveCents : recorded;
}

/// What [car] (a `parkedCars` document's fields) owes as of [now]. Mirrors
/// the server's `parkingBalanceNow` line for line; null for a voided or
/// cancelled car, or one with no arrival day.
ParkingBalance? parkingBalanceNow(Map<String, dynamic> car, DateTime now) {
  if (car['voided'] == true ||
      '${car['status'] ?? ''}'.trim() == 'cancelled') {
    return null;
  }
  final start = parkingDayNumber(car['parkingDate']);
  final today = parkingDayNumber(now);
  if (start == null || today == null) return null;
  final leave = parkingDayNumber(car['parkingEndDate']);
  final through = leave == null ? today : (today < leave ? today : leave);
  final accrued = parkingAccruedThroughCents(car, today, today);
  final paid = _paidNowCents(car, today);
  final dollars = num.tryParse('${car['dailyRate'] ?? ''}');
  final dailyRateCents = dollars != null && dollars.isFinite && dollars > 0
      ? (dollars * 100).round()
      : _wholeCents(car['dailyRateCents']);
  final days = through - start + 1;
  return ParkingBalance(
    dailyRateCents: dailyRateCents,
    sinceDayKey: _dayKey(start),
    leftDayKey: leave == null ? null : _dayKey(leave),
    days: days > 0 ? days : 0,
    accruedCents: accrued,
    paidCents: paid,
    balanceCents: accrued > paid ? accrued - paid : 0,
    paidInFull: accrued > 0 && paid >= accrued,
    stillParked: leave == null || leave >= today,
  );
}

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

  /// "YYYY-MM-DD" of the day the car leaves / left, '' when none is set.
  final String leftDayKey;

  /// Days counted so far (a stay stops at today or its leave day, whichever
  /// is first), 0 before it starts.
  final int days;
  final int accruedCents;
  final int paidCents;

  /// What is owed now; never negative.
  final int balanceCents;
  final bool paidInFull;
  final bool stillParked;

  Map<String, Object> toJson() => {
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

/// What [car] (a `parkedCars` document's fields) owes as of [now].
ParkingBalance parkingBalanceNow(Map<String, dynamic> car, DateTime now) {
  final today = parkingDayNumber(now) ?? 0;
  final start = parkingDayNumber(car['parkingDate']);
  final leave = parkingDayNumber(car['parkingEndDate']);
  // The accrual below reads the rate in dollars (`dailyRate`), as the
  // month-end statement does; the cents field is only a fallback to show.
  final dailyRateCents =
      _wholeCents((num.tryParse('${car['dailyRate'] ?? ''}') ?? 0) * 100) > 0
      ? _wholeCents((num.tryParse('${car['dailyRate'] ?? ''}') ?? 0) * 100)
      : _wholeCents(car['dailyRateCents']);

  var days = 0;
  if (start != null) {
    final end = leave != null && leave < today ? leave : today;
    days = end >= start ? end - start + 1 : 0;
  }
  final accrued = start == null
      ? 0
      : parkingAccruedThroughCents(car, today, today);
  final paid = parkingPaidCentsOf(car, today);
  final balance = accrued > paid ? accrued - paid : 0;
  return ParkingBalance(
    dailyRateCents: dailyRateCents,
    sinceDayKey: start == null ? '' : _dayKey(start),
    leftDayKey: leave == null ? '' : _dayKey(leave),
    days: days,
    accruedCents: accrued,
    paidCents: paid,
    balanceCents: balance,
    paidInFull: balance == 0 && (accrued > 0 || paid > 0),
    // A booked leave day still ahead is not "left" yet.
    stillParked: leave == null || leave > today,
  );
}

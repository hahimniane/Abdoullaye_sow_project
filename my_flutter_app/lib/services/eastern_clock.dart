/// The shop's clock: America/New_York. The business record has no time zone,
/// every shop so far keeps New York hours, and the server compares credit due
/// dates with today in New York. The US daylight-saving rule (since 2007:
/// second Sunday of March to first Sunday of November, at 2:00 local) is
/// written out here rather than read from a time-zone database, so a day's
/// edges never depend on the phone's own zone and every edge is unit-tested
/// (`sales_history_test.dart`).
///
/// Wall-clock times are carried as `DateTime.utc(...)` values whose fields
/// ARE the New York wall clock (a "wall" date); real instants are true UTC.
library;

/// The n-th Sunday (1-based) of [month] in [year], as a day of the month.
int _nthSunday(int year, int month, int n) {
  final first = DateTime.utc(year, month, 1).weekday; // 1 Mon .. 7 Sun
  final firstSunday = 1 + (7 - first) % 7;
  return firstSunday + 7 * (n - 1);
}

/// When daylight time starts in [year]: 2:00 EST = 07:00 UTC.
DateTime easternDstStartUtc(int year) =>
    DateTime.utc(year, 3, _nthSunday(year, 3, 2), 7);

/// When it ends: 2:00 EDT = 06:00 UTC.
DateTime easternDstEndUtc(int year) =>
    DateTime.utc(year, 11, _nthSunday(year, 11, 1), 6);

/// New York's offset from UTC at [instant]: -4 h in daylight time, else -5 h.
Duration easternOffsetAt(DateTime instant) {
  final utc = instant.toUtc();
  final dst =
      !utc.isBefore(easternDstStartUtc(utc.year)) &&
      utc.isBefore(easternDstEndUtc(utc.year));
  return Duration(hours: dst ? -4 : -5);
}

/// The New York wall clock at [instant] (fields are the wall time).
DateTime easternWall(DateTime instant) {
  final utc = instant.toUtc();
  return utc.add(easternOffsetAt(utc));
}

/// The instant New York's wall clock reads midnight starting [wallDay]
/// (only the date of [wallDay] is used). Midnight is never inside a
/// daylight-saving jump (they happen at 2:00), so this is exact.
DateTime easternMidnightUtc(DateTime wallDay) {
  final guess = DateTime.utc(wallDay.year, wallDay.month, wallDay.day, 5);
  // The offset at that midnight: try daylight (-4) first, check it holds.
  final asDst = guess.subtract(const Duration(hours: 1)); // 04:00 UTC
  if (easternOffsetAt(asDst) == const Duration(hours: -4)) return asDst;
  return guess;
}

/// A wall date with the time dropped.
DateTime wallDate(DateTime wall) =>
    DateTime.utc(wall.year, wall.month, wall.day);

/// A wall date as the local calendar day the date helpers format.
DateTime wallDayAsLocal(DateTime wall) =>
    DateTime(wall.year, wall.month, wall.day);

/// The wall time of [instant] as a local DateTime with the same fields, so
/// `displayTime` prints the shop's clock whatever zone the phone is in.
DateTime easternWallAsLocal(DateTime instant) {
  final w = easternWall(instant);
  return DateTime(w.year, w.month, w.day, w.hour, w.minute, w.second);
}

/// Today in New York, as a local DateTime with those fields: what a due date
/// is compared with, the same day the server uses.
DateTime shopToday(DateTime now) => wallDayAsLocal(easternWall(now));

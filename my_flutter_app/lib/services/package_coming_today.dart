/// "Coming today" (docs/PACKAGE_PRICE_LIST.md §1 decision 6): the confirmed
/// bring-in requests whose customer said they will come today, soonest
/// window first, with the 2-hour window written the way the app's language
/// writes a time of day. Pure: the screens are glue over it.
library;

import 'package_requests.dart';

/// Confirmed (Expected) requests brought in, planned for [now]'s calendar
/// day in each request's own time zone, ordered by the start of their
/// window (a request with no window after those with one), then by id.
List<PackageRequest> comingTodayRequests(
  Iterable<PackageRequest> requests,
  DateTime now,
) {
  final out = [
    for (final r in requests)
      if (businessStageOf(r) == BusinessRequestStage.expected &&
          r.isBringIn &&
          r.plannedDate.isNotEmpty &&
          r.plannedDate ==
              requestDayKey(requestToday(now, timeZone: r.timeZone)))
        r,
  ];
  out.sort((a, b) {
    final am = _startMinutes(a), bm = _startMinutes(b);
    if (am != bm) return am.compareTo(bm);
    return a.id.compareTo(b.id);
  });
  return out;
}

/// Minutes after midnight the window starts; after the end of the day when
/// the request names no window.
int _startMinutes(PackageRequest request) {
  final window = request.plannedWindow;
  return (window == null ? null : requestMinutesOf(window.from)) ?? 24 * 60;
}

/// The requests of [expected] that are not in [coming]: the Expected section
/// under "Coming today" never repeats a card.
List<PackageRequest> expectedExcept(
  Iterable<PackageRequest> expected,
  Iterable<PackageRequest> coming,
) {
  final ids = {for (final r in coming) r.id};
  return [
    for (final r in expected)
      if (!ids.contains(r.id)) r,
  ];
}

/// A time of day as the app writes it: "2:00 PM" in English, "14 h" /
/// "14 h 30" in French. Null when [hhmm] is not "HH:MM".
String? requestClock12(String hhmm, String languageCode) {
  final minutes = requestMinutesOf(hhmm);
  if (minutes == null) return null;
  final h = minutes ~/ 60, m = minutes % 60;
  if (languageCode.toLowerCase().startsWith('fr')) {
    return m == 0 ? '$h h' : '$h h ${m.toString().padLeft(2, '0')}';
  }
  final h12 = h % 12 == 0 ? 12 : h % 12;
  return '$h12:${m.toString().padLeft(2, '0')} ${h < 12 ? 'AM' : 'PM'}';
}

/// "2:00 PM–4:00 PM" / "14 h–16 h" for a window; null when either end is not
/// a time.
String? requestWindowRangeText(String from, String to, String languageCode) {
  final a = requestClock12(from, languageCode);
  final b = requestClock12(to, languageCode);
  return a == null || b == null ? null : '$a–$b';
}

/// A bring-in's window as the app writes it ("2:00 PM–4:00 PM"), or null
/// when the request names none (an old request, or a collection).
String? requestWindowText(PackageRequest request, String languageCode) {
  final window = request.plannedWindow;
  if (window == null || request.isCollect) return null;
  return requestWindowRangeText(window.from, window.to, languageCode);
}

final _rangeWindow = RegExp(r'^(\d{2}:\d{2})-(\d{2}:\d{2})$');

/// A collect request's `pickup.window` written as a range ("14:00-16:00"),
/// or null for the old words (morning / afternoon / evening) and anything
/// else.
String? requestWindowTextOf(String window, String languageCode) {
  final m = _rangeWindow.firstMatch(window.trim());
  if (m == null) return null;
  return requestWindowRangeText(m[1]!, m[2]!, languageCode);
}

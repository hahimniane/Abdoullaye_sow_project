/// How dates read on screen and on paper: US style in English ("Sep 1, 2026",
/// "Sep 1, 2026 3:05 PM"), the French equivalent in French ("1 sept. 2026",
/// "1 sept. 2026 15:05").
///
/// Day keys ("YYYY-MM-DD") are data - stored, compared and sorted as they
/// are. Convert them here only when showing them, and read them as a calendar
/// day so the day never shifts with the time zone.
///
/// The WhatsApp texts in `services/parking_month_statement.dart` and
/// `services/invoice_ledger.dart` are the exception: they mirror the server
/// byte for byte and use their own English `dayLabel`.
library;

import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';

final _dayKeyPattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})');

/// A day key ("2026-09-01", or a longer ISO string starting with one) as that
/// calendar day at local midnight, or null when it is not a real day.
DateTime? parseDayKey(String? key) {
  final m = _dayKeyPattern.firstMatch((key ?? '').trim());
  if (m == null) return null;
  final year = int.parse(m[1]!);
  final month = int.parse(m[2]!);
  final day = int.parse(m[3]!);
  final date = DateTime(year, month, day);
  // DateTime rolls "2026-02-30" over into March; that is not a day.
  if (date.year != year || date.month != month || date.day != day) return null;
  return date;
}

/// The app's current locale tag ("en", "fr"), for the helpers below.
String dateLocaleOf(BuildContext context) =>
    Localizations.localeOf(context).toLanguageTag();

/// A locale tag DateFormat knows ("en", "fr", "en-US" ...), else English.
String _dateLocale(String locale) =>
    Intl.verifiedLocale(locale, DateFormat.localeExists,
        onFailure: (_) => 'en') ??
    'en';

/// "Sep 1, 2026" / "1 sept. 2026" for a day key. A value that is not a day
/// is returned as it was, so nothing ever disappears from the screen.
String displayDay(String? key, String locale) {
  final date = parseDayKey(key);
  if (date == null) return (key ?? '').trim();
  return displayDate(date, locale);
}

/// "Sep 1, 2026" / "1 sept. 2026".
String displayDate(DateTime date, String locale) =>
    DateFormat.yMMMd(_dateLocale(locale)).format(date);

/// "Sep 1, 2026 3:05 PM" / "1 sept. 2026 15:05".
String displayDateTime(DateTime date, String locale) =>
    DateFormat.yMMMd(_dateLocale(locale)).add_jm().format(date);

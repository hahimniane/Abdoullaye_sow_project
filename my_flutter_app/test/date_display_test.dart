import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/utils/date_display.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  group('a day key', () {
    test('reads US style in English: month first, no leading zero', () {
      expect(displayDay('2026-09-01', 'en'), 'Sep 1, 2026');
      expect(displayDay('2026-12-31', 'en'), 'Dec 31, 2026');
      expect(displayDay('2026-09-01', 'en-US'), 'Sep 1, 2026');
    });

    test('reads the French way in French', () {
      expect(displayDay('2026-09-01', 'fr'), '1 sept. 2026');
    });

    test('is a calendar day: it never shifts, whatever the clock', () {
      // The first and last day of a month and year are where a UTC/local
      // mix-up would land on the neighbouring day.
      expect(displayDay('2026-01-01', 'en'), 'Jan 1, 2026');
      expect(displayDay('2025-12-31', 'en'), 'Dec 31, 2025');
      expect(displayDay('2026-10-15T00:00:00Z', 'en'), 'Oct 15, 2026');
      expect(displayDay('2026-10-15T23:59:00-12:00', 'en'), 'Oct 15, 2026');
      final day = parseDayKey('2026-03-08')!;
      expect([day.year, day.month, day.day], [2026, 3, 8]);
    });

    test('anything that is not a day is shown as it was', () {
      expect(parseDayKey('2026-02-30'), isNull);
      expect(displayDay('2026-02-30', 'en'), '2026-02-30');
      expect(displayDay('soon', 'en'), 'soon');
      expect(displayDay('', 'en'), '');
      expect(displayDay(null, 'en'), '');
    });
  });

  group('a moment', () {
    final at = DateTime(2026, 9, 1, 15, 5);

    test('reads with a 12-hour clock in English', () {
      expect(displayDate(at, 'en'), 'Sep 1, 2026');
      expect(
        displayDateTime(at, 'en').replaceAll(' ', ' '),
        'Sep 1, 2026 3:05 PM',
      );
    });

    test('reads the French way in French', () {
      expect(displayDate(at, 'fr'), '1 sept. 2026');
      expect(displayDateTime(at, 'fr'), '1 sept. 2026 15:05');
    });

    test('an unknown locale falls back to English', () {
      expect(displayDate(at, 'zz'), 'Sep 1, 2026');
    });

    String plain(String s) => s.replaceAll(RegExp(r'[  ]'), ' ');

    test('the shorter and longer forms: US in English, French in French', () {
      expect(displayLongDate(at, 'en'), 'September 1, 2026');
      expect(displayLongDate(at, 'fr'), '1 septembre 2026');
      expect(displayMonthDay(at, 'en'), 'Sep 1');
      expect(displayMonthDay(at, 'fr'), '1 sept.');
      expect(plain(displayMonthDayTime(at, 'en')), 'Sep 1 3:05 PM');
      expect(displayMonthDayTime(at, 'fr'), '1 sept. 15:05');
      expect(displayWeekdayMonthDay(at, 'en'), 'Tue, Sep 1');
      expect(displayWeekdayMonthDay(at, 'fr'), 'mar. 1 sept.');
      expect(
        plain(displayWeekdayDateTime(at, 'en')),
        'Tue, Sep 1, 2026 3:05 PM',
      );
      expect(displayWeekdayDateTime(at, 'fr'), 'mar. 1 sept. 2026 15:05');
      expect(plain(displayTime(at, 'en')), '3:05 PM');
      expect(displayTime(at, 'fr'), '15:05');
    });
  });

  test('no screen formats a date without the app locale', () {
    // The regression: DateFormat.yMMMd() with no locale renders English in
    // French mode. Every displayed date goes through these helpers or passes
    // the locale itself; only stored keys (yyyy-MM, yyyy-MM-dd) are exempt.
    final localeLess = RegExp(r"DateFormat(\.[a-zA-Z_]+)?\((\)|'[^']*'\))");
    final offenders = <String>[];
    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      final lines = entity.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        if (!localeLess.hasMatch(line)) continue;
        if (line.contains("'yyyy-MM'") || line.contains("'yyyy-MM-dd'")) {
          continue;
        }
        offenders.add('${entity.path}:${i + 1}');
      }
    }
    expect(offenders, isEmpty);
  });
}

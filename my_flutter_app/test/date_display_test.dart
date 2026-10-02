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
  });
}

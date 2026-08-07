import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

/// "Which cars were parked between the 10th and the 15th."
///
/// The answer is an OVERLAP, not a containment: a car that arrived on the 5th
/// and leaves on the 20th sat in the lot for every day of that window, and a
/// filter that hid it would hide exactly the long stays a business most needs
/// to see. The decision lives outside the widget, so every boundary can be
/// driven here without Firebase and without a screen - and it is a deliberate
/// mirror of the console's `businessParkingWithinRange` in
/// `admin_web/src/lib/business-parking-entry.ts`, because a phone and a
/// browser must not disagree about which cars were in the lot that week.

/// The window every case below is asked about: the 10th to the 15th.
final DateTime from = DateTime(2026, 8, 10);
final DateTime to = DateTime(2026, 8, 15);

Map<String, dynamic> stay({Object? start, Object? end}) => <String, dynamic>{
  'parkingDate': ?start,
  'parkingEndDate': ?end,
};

/// A day at midday UTC - the shape the callables write, chosen so no timezone
/// can roll the parking back a day.
Timestamp midday(int year, int month, int day) =>
    Timestamp.fromDate(DateTime.utc(year, month, day, 12));

void main() {
  group('businessParkingWithinRange', () {
    test('a stay spanning the whole window matches', () {
      // The case the whole rule exists for: arrived before, leaves after.
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 8, 5), end: midday(2026, 8, 20)),
          from,
          to,
        ),
        isTrue,
      );
    });

    test('a stay wholly inside the window matches', () {
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 8, 11), end: midday(2026, 8, 13)),
          from,
          to,
        ),
        isTrue,
      );
    });

    test('both bounds are inclusive', () {
      // Leaving on the first day of the window still counts as parked that
      // day, and so does arriving on the last.
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 8, 1), end: midday(2026, 8, 10)),
          from,
          to,
        ),
        isTrue,
      );
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 8, 15), end: midday(2026, 8, 20)),
          from,
          to,
        ),
        isTrue,
      );
    });

    test('a stay that ended before the window does not match', () {
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 8, 1), end: midday(2026, 8, 9)),
          from,
          to,
        ),
        isFalse,
      );
    });

    test('a stay that starts after the window does not match', () {
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 8, 16), end: midday(2026, 8, 20)),
          from,
          to,
        ),
        isFalse,
      );
    });

    test('one bound alone narrows only that side', () {
      final august = stay(start: midday(2026, 8, 11), end: midday(2026, 8, 13));
      // "Everything from the 10th onwards."
      expect(businessParkingWithinRange(august, from, null), isTrue);
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 8, 1), end: midday(2026, 8, 9)),
          from,
          null,
        ),
        isFalse,
      );
      // "Everything up to the 15th."
      expect(businessParkingWithinRange(august, null, to), isTrue);
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 8, 16), end: midday(2026, 8, 20)),
          null,
          to,
        ),
        isFalse,
      );
    });

    test('no bounds at all is not a narrowing', () {
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 1, 1), end: midday(2026, 1, 2)),
          null,
          null,
        ),
        isTrue,
      );
      // Even a record that could not be placed in time survives "show me
      // everything" - `all` means "do not narrow", not "match everything".
      expect(businessParkingWithinRange(stay(), null, null), isTrue);
    });

    test('Firestore Timestamps are read the same as any other date', () {
      // What actually arrives from the parkedCars stream.
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 8, 12), end: midday(2026, 8, 14)),
          from,
          to,
        ),
        isTrue,
      );
      // And the string forms a record can carry instead.
      expect(
        businessParkingWithinRange(
          stay(start: '2026-08-12', end: '2026-08-14'),
          from,
          to,
        ),
        isTrue,
      );
      expect(
        businessParkingWithinRange(
          stay(start: '2026-08-12T12:00:00Z', end: '2026-08-14T12:00:00Z'),
          from,
          to,
        ),
        isTrue,
      );
      expect(
        businessParkingWithinRange(
          stay(start: DateTime.utc(2026, 8, 12, 12), end: null),
          from,
          to,
        ),
        isTrue,
      );
    });

    test('a car with no end date has not left, so it is still in the lot', () {
      // No end recorded means the car never left. It shows up in a window
      // covering its arrival...
      expect(
        businessParkingWithinRange(stay(start: midday(2026, 8, 12)), from, to),
        isTrue,
      );
      // ...and in every window after it, which is the case a lot most needs:
      // a car that arrived on the 1st and is still sitting there.
      expect(
        businessParkingWithinRange(stay(start: midday(2026, 8, 1)), from, to),
        isTrue,
      );
      // A window entirely before it arrived still excludes it.
      expect(
        businessParkingWithinRange(stay(start: midday(2026, 9, 1)), from, to),
        isFalse,
      );
      // An end with no start is bounded only by that end.
      expect(
        businessParkingWithinRange(stay(end: midday(2026, 8, 12)), from, to),
        isTrue,
      );
      expect(
        businessParkingWithinRange(stay(end: midday(2026, 7, 1)), from, to),
        isFalse,
      );
    });

    test('a record with no dates at all matches nothing', () {
      // It cannot be placed in time, and guessing would put a car in a week
      // it may never have been there.
      expect(businessParkingWithinRange(stay(), from, to), isFalse);
      expect(businessParkingWithinRange(stay(), from, null), isFalse);
      expect(businessParkingWithinRange(stay(), null, to), isFalse);
      expect(
        businessParkingWithinRange(
          <String, dynamic>{'parkingDate': '', 'parkingEndDate': null},
          from,
          to,
        ),
        isFalse,
      );
    });

    test('a one-day stay is found by a window of that one day', () {
      final day = DateTime(2026, 8, 12);
      expect(
        businessParkingWithinRange(
          stay(start: midday(2026, 8, 12), end: midday(2026, 8, 12)),
          day,
          day,
        ),
        isTrue,
      );
    });
  });

  group('the activity list spends the decision it is given', () {
    final source = File('lib/screens/home_menu.dart').readAsStringSync();

    test('the parked-car filter is the pure predicate, not a local rule', () {
      expect(source, contains('businessParkingWithinRange('));
      expect(source, contains('_parkedFrom'));
      expect(source, contains('_parkedTo'));
    });

    test('the range control lives beside the paid/not paid chips', () {
      expect(source, contains("Key('parking-date-range-filter')"));
      expect(source, contains("Key('parking-range-from')"));
      expect(source, contains("Key('parking-range-to')"));
      expect(source, contains("Key('parking-range-clear')"));
      expect(source, contains('l10n.parkedBetween'));
      expect(source, contains('l10n.dateFrom'));
      expect(source, contains('l10n.dateTo'));
      // Offered only where it means something, exactly like the payment
      // chips - the whole block is inside the parking-category branch.
      final block = source.substring(
        source.indexOf("if (selectedCategory == ServiceCategory.parking)"),
        source.indexOf('const SizedBox(height: 16),\n        if (isLoading)'),
      );
      expect(block, contains("Key('parking-date-range-filter')"));
    });

    test('leaving parking clears the dates with the payment filter', () {
      // A narrowing still in force while its control is off screen reads as
      // missing records.
      expect(source, contains('_parkedFrom = null;'));
      expect(source, contains('_parkedTo = null;'));
    });
  });
}

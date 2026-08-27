import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

/// Closing out a walk-up, and saying whether it is still running.
///
/// The app offered a parked-car status dropdown that was read-only for every
/// record the business itself had entered, so from the phone a lot could
/// neither complete a stay nor release a space - both of which the console
/// does from a dropdown on the card. It also offered the customer-booking
/// vocabulary (`reserved`, and no `cancelled`), which is not the vocabulary a
/// business-entered record uses.

void main() {
  group('businessParkingStatusOptions', () {
    test('it is the console\'s list, in the console\'s order', () {
      expect(businessParkingStatusOptions, <String>[
        'active',
        'completed',
        'cancelled',
      ]);
    });

    test('a record keeps whatever status it already has', () {
      // A record parked on a status the console never offers must not have it
      // silently rewritten by opening a dropdown that cannot represent it.
      expect(businessParkingStatusOptionsFor('reserved'), <String>[
        'active',
        'completed',
        'cancelled',
        'reserved',
      ]);
    });

    test('a known status is not duplicated or moved to the end', () {
      expect(
        businessParkingStatusOptionsFor('completed'),
        businessParkingStatusOptions,
      );
      expect(
        businessParkingStatusOptionsFor('  '),
        businessParkingStatusOptions,
      );
    });
  });

  group('businessParkingEndLabel', () {
    Map<String, dynamic> row(Object? end) =>
        <String, dynamic>{'parkingEndDate': ?end};

    test('a stay with no end date has not ended', () {
      expect(
        businessParkingEndLabel(row(null), now: DateTime.utc(2026, 8, 7)),
        BusinessParkingEndLabel.ends,
      );
    });

    test('a stay ending today has not ended yet', () {
      // Whole days, the way the console compares them: a car due out this
      // afternoon is still in the lot.
      expect(
        businessParkingEndLabel(
          row(DateTime.utc(2026, 8, 7, 9)),
          now: DateTime.utc(2026, 8, 7, 23),
        ),
        BusinessParkingEndLabel.ends,
      );
    });

    test('a stay that ended yesterday reads as ended', () {
      expect(
        businessParkingEndLabel(
          row(DateTime.utc(2026, 8, 6)),
          now: DateTime.utc(2026, 8, 7),
        ),
        BusinessParkingEndLabel.ended,
      );
    });

    test('a future stay never reads as ended', () {
      expect(
        businessParkingEndLabel(
          row('2026-09-01T12:00:00Z'),
          now: DateTime.utc(2026, 8, 7),
        ),
        BusinessParkingEndLabel.ends,
      );
    });

    test('an unreadable date is not treated as a stay that ended', () {
      expect(
        businessParkingEndLabel(
          row('not a date'),
          now: DateTime.utc(2026, 8, 7),
        ),
        BusinessParkingEndLabel.ends,
      );
    });
  });

  group('the details screen can move a walk-up\'s status', () {
    final source = File(
      'lib/screens/parked_car_details_screen.dart',
    ).readAsStringSync();

    test('the dropdown offers the business vocabulary on a walk-up', () {
      expect(source, contains('businessParkingStatusOptionsFor(_statusDraft)'));
      expect(source, contains('businessParkingStatusLabel(l10n, status)'));
    });

    test('it saves itself, and not through the frozen Save button', () {
      // A PAID record is frozen for editing, but its car still has to be able
      // to leave the lot - so the status write is gated on the parking
      // permission, never on `canEdit`.
      expect(source, contains('_updateBusinessParkingStatus('));
      expect(source, contains('canSetStatus'));
      final handler = source.substring(
        source.indexOf('Future<void> _updateBusinessParkingStatus('),
        source.indexOf('Future<void> _updateRecord()'),
      );
      expect(handler, contains("collection('parkedCars')"));
      expect(handler, contains("'status': status"));
      expect(handler, contains('l10n.parkingStatusUpdated'));
      expect(handler, contains('showErrorSnackBar('));
      // The end date is the window the server priced. Stamping it here would
      // leave the amount - and any link the customer holds - describing days
      // the record no longer claims.
      expect(handler, isNot(contains('parkingEndDate')));
    });

    test('a cancellation reaches the fields the badge reads', () {
      final handler = source.substring(
        source.indexOf('Future<void> _updateBusinessParkingStatus('),
        source.indexOf('Future<void> _updateRecord()'),
      );
      expect(handler, contains("'status': status}"));
      expect(handler, contains('_paymentFields'));
    });

    test('the end-date field follows the calendar on a walk-up', () {
      expect(source, contains('businessParkingEndLabelText('));
      expect(source, contains('isBusinessEntry: true'));
    });
  });

  group('the status words already existed in both languages', () {
    final english =
        jsonDecode(File('lib/l10n/app_en.arb').readAsStringSync()) as Map;
    final french =
        jsonDecode(File('lib/l10n/app_fr.arb').readAsStringSync()) as Map;

    test('every status and every new label is translated', () {
      for (final key in <String>[
        'active',
        'completed',
        'cancelled',
        'parkingEnds',
        'parkingEnded',
        'parkingStatusUpdated',
        'parkingStatusCouldNotBeUpdated',
        'searchParkedCars',
        'noParkingRecordsMatchFilter',
        'vinNumberOptional',
      ]) {
        expect(english[key], isA<String>(), reason: '$key missing in English');
        expect(french[key], isA<String>(), reason: '$key missing in French');
        expect(
          french[key],
          isNot(english[key]),
          reason: '$key was never translated',
        );
      }
    });
  });
}

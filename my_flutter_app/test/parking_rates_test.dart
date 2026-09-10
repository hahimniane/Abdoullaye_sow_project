import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/parking_rates.dart';

/// A lot can charge more than one price - a bigger space, a long-stay deal, a
/// rate for the dealer who brings six cars at once. Staff pick the card when
/// they record the car, and the money must follow the card they picked.
void main() {
  test('only cards that can price a stay are kept', () {
    final cards = normalizeParkingRates([
      {'id': 'ok', 'label': 'Standard', 'dailyRate': 12},
      {'id': '', 'label': 'No id', 'dailyRate': 12},
      {'id': 'noname', 'label': '', 'dailyRate': 12},
      {'id': 'free', 'label': 'No rate', 'dailyRate': 0},
      {'id': 'ok', 'label': 'Duplicate', 'dailyRate': 99},
      'not a map',
    ]);
    expect(cards.map((c) => c.id), ['ok']);
    expect(cards.single.dailyRate, 12);
    // Blank optionals settle at zero; a minimum stay is at least one day.
    expect(cards.single.weeklyRate, 0);
    expect(cards.single.minimumDays, 1);
    // Nothing at all is not an error, just no cards.
    expect(normalizeParkingRates(null), isEmpty);
  });

  test('the picker offers the standard rate first, then each card', () {
    final choices = parkingRateChoices({
      'parkingDailyRate': 12,
      'parkingRates': [
        {'id': 'suv', 'label': 'SUV / oversize', 'dailyRate': 18},
        {'id': 'long', 'label': 'Long stay', 'dailyRate': 9},
      ],
    });
    expect(choices.map((c) => c.id), ['', 'suv', 'long']);
    // The standard rate carries an empty id - exactly what the server reads
    // as "no card chosen", so the default costs nothing to express.
    expect(choices.first.id, '');
    expect(choices[1].optionLabel, 'SUV / oversize - \$18.00/day');
  });

  test('a lot with one price has nothing to choose between', () {
    expect(parkingRateChoices({'parkingDailyRate': 12}).length, 1);
    // And a lot that has set no rate at all offers nothing rather than $0.
    expect(parkingRateChoices(const {}), isEmpty);
  });

  test('the walk-up form only sends a price when one was chosen', () {
    final service =
        File('lib/services/business_parking_entry.dart').readAsStringSync();
    expect(service, contains("if (_trimmed(draft.parkingRateId, 60).isNotEmpty)"));
    final screen = File('lib/screens/park_car_screen.dart').readAsStringSync();
    // The picker is absent when there is nothing to pick.
    expect(screen, contains('if (_rateChoices.length > 1)'));
    expect(screen, contains('parkingRateId: _rateId'));
  });
}

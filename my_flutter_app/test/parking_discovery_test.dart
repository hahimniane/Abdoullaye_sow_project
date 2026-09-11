import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// A customer who does not already know the name of a town could not find a
/// lot in it: the search demanded a city, and the picker offered every city
/// in the country. They now browse the lots that exist and tap one to pick
/// it.
void main() {
  final screen = File('lib/screens/park_car_screen.dart').readAsStringSync();
  final service = File('lib/services/parking_service.dart').readAsStringSync();

  test('the search does not demand a city', () {
    final search = screen.substring(
      screen.indexOf('Future<void> _searchParkingOptions()'),
      screen.indexOf('Future<void> _findParkingAndAdvance()'),
    );
    expect(search, isNot(contains('pleaseEnterParkingCity')));
    final advance = screen.substring(
      screen.indexOf('Future<void> _findParkingAndAdvance()'),
      screen.indexOf('/// Tapping a lot in the list picks that lot.'),
    );
    expect(advance, isNot(contains('pleaseEnterParkingCity')));
    // And the service sends dates only when there are some.
    expect(service, contains('if (startDate != null)'));
  });

  test('state and town pickers come from lots that exist', () {
    expect(screen, contains('List<String> get _browseStates'));
    expect(screen, contains('List<String> get _browseCities'));
    expect(screen, isNot(contains("businessCityOptions('United States'")));
  });

  test('tapping a lot selects it, priced for the chosen dates', () {
    final chooser = screen.substring(
      screen.indexOf('Future<void> _chooseBrowsedPlace('),
      screen.indexOf('void _goToParkingStep('),
    );
    expect(chooser, contains('await _searchParkingOptions();'));
    expect(chooser, contains('option.businessId == place.businessId'));
    expect(chooser, contains('_selectedParkingOption = match;'));
    expect(chooser, contains('_customerStep = 1;'));
    expect(screen, contains('() => _chooseBrowsedPlace(place)'));
  });

  test('distance is only shown when the customer shared a location', () {
    final tile = screen.substring(
      screen.indexOf('class _ParkingPlaceTile'),
      screen.indexOf('/// One remembered customer, offered as something to tap.'),
    );
    expect(tile, contains('if (miles != null)'));
    expect(tile, contains("'\${place.availableSpaces} free'"));
  });
}

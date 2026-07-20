import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/business_profile_validation.dart';

void main() {
  group('parking capacity validation', () {
    test('accepts an address-based parking location without coordinates', () {
      expect(
        parkingCapacityNeedsAttention(
          offersParking: true,
          addressLine1: '100 Test Avenue',
          country: 'Guinea',
          state: '',
          city: 'Conakry',
          totalSpaces: 8,
          blockedSpaces: 1,
          dailyRate: 25,
          minimumDays: 1,
        ),
        isFalse,
      );
    });

    test('requires address location details when parking is offered', () {
      expect(
        parkingCapacityNeedsAttention(
          offersParking: true,
          addressLine1: '',
          country: 'United States',
          state: 'NY',
          city: 'Bronx',
          totalSpaces: 8,
          blockedSpaces: 0,
          dailyRate: 25,
          minimumDays: 1,
        ),
        isTrue,
      );
    });

    test('requires a state for United States parking addresses', () {
      expect(
        parkingCapacityNeedsAttention(
          offersParking: true,
          addressLine1: '100 Test Avenue',
          country: 'United States',
          state: '',
          city: 'Bronx',
          totalSpaces: 8,
          blockedSpaces: 0,
          dailyRate: 25,
          minimumDays: 1,
        ),
        isTrue,
      );
    });

    test('ignores parking fields when parking is not offered', () {
      expect(
        parkingCapacityNeedsAttention(
          offersParking: false,
          addressLine1: '',
          country: '',
          state: '',
          city: '',
          totalSpaces: 0,
          blockedSpaces: 0,
          dailyRate: 0,
          minimumDays: 0,
        ),
        isFalse,
      );
    });
  });

  group('parking coordinate ownership', () {
    test('preserves metadata when the address did not change', () {
      expect(
        parkingLocationChanged(
          currentAddressLine1: '100 Test Avenue',
          currentCountry: 'United States',
          currentState: 'NY',
          currentCity: 'Bronx',
          nextAddressLine1: '100 Test Avenue ',
          nextCountry: ' United States',
          nextState: 'NY',
          nextCity: 'Bronx',
        ),
        isFalse,
      );
    });

    test('marks hidden coordinates stale when the address changes', () {
      expect(
        parkingLocationChanged(
          currentAddressLine1: '100 Test Avenue',
          currentCountry: 'United States',
          currentState: 'NY',
          currentCity: 'Bronx',
          nextAddressLine1: '200 Test Avenue',
          nextCountry: 'United States',
          nextState: 'NY',
          nextCity: 'Bronx',
        ),
        isTrue,
      );
    });
  });

  test('business parking capacity form does not expose coordinate fields', () {
    final source = File(
      'lib/screens/business_profile_screen.dart',
    ).readAsStringSync();

    expect(source, contains('parkingAddressLine1Controller'));
    expect(source, isNot(contains('parkingLatitudeController')));
    expect(source, isNot(contains('parkingLongitudeController')));
    expect(source, isNot(contains('l10n.parkingLatitude')));
    expect(source, isNot(contains('l10n.parkingLongitude')));
    expect(source, contains('AppColors.errorRed'));
    expect(source, contains('Scrollable.ensureVisible'));
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/data/business_location_catalog.dart';

void main() {
  group('business location catalog', () {
    test('provides selectable countries and cities', () {
      expect(businessCountryOptions(null), contains('United States'));
      expect(businessCountryOptions(null), contains('Guinea'));
      expect(businessCityOptions('United States', null), contains('Manhattan'));
      expect(businessCityOptions('Guinea', null), contains('Conakry'));
    });

    test('preserves legacy country and city values in selects', () {
      expect(businessCountryOptions('Atlantis').first, 'Atlantis');
      expect(
        businessCityOptions('United States', 'Old Town').first,
        'Old Town',
      );
    });

    test(
      'uses legacy state as United States fallback only without country',
      () {
        expect(
          defaultBusinessCountry(country: 'Senegal', state: 'NY'),
          'Senegal',
        );
        expect(
          defaultBusinessCountry(country: '', state: 'NY'),
          'United States',
        );
        expect(defaultBusinessCountry(country: '', state: ''), isNull);
      },
    );
  });
}

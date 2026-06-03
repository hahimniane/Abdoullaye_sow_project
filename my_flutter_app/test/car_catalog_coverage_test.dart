import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  late List<Map<String, dynamic>> catalog;

  setUpAll(() {
    final file = File('assets/data/car_models_flutter.json');
    catalog = (jsonDecode(file.readAsStringSync()) as List<dynamic>)
        .cast<Map<String, dynamic>>();
  });

  test('includes common US-market makes', () {
    final makes = catalog.map((entry) => entry['brand'] as String).toSet();

    expect(
      makes,
      containsAll(<String>[
        'Acura',
        'Audi',
        'BMW',
        'Buick',
        'Cadillac',
        'Chevrolet',
        'Ford',
        'GMC',
        'Honda',
        'Hyundai',
        'Jaguar',
        'Jeep',
        'Kia',
        'Land Rover',
        'Lexus',
        'Mercedes-Benz',
        'MINI',
        'Nissan',
        'Ram',
        'Rivian',
        'Subaru',
        'Tesla',
        'Toyota',
        'Volkswagen',
        'Volvo',
      ]),
    );
  });

  test('includes common US-market models that were previously missing', () {
    expect(hasModel(catalog, 'BMW', 'X1'), isTrue);
    expect(hasModel(catalog, 'Cadillac', 'Escalade'), isTrue);
    expect(hasModel(catalog, 'Jeep', 'Wrangler'), isTrue);
    expect(hasModel(catalog, 'Land Rover', 'Range Rover'), isTrue);
    expect(hasModel(catalog, 'Mercedes-Benz', 'C-Class'), isTrue);
    expect(hasModel(catalog, 'MINI', 'Countryman'), isTrue);
    expect(hasModel(catalog, 'Ram', '1500'), isTrue);
    expect(hasModel(catalog, 'Tesla', 'Model Y'), isTrue);
  });

  test('BMW X1 includes 2017 for decoded VIN matching', () {
    final entry = catalog.singleWhere(
      (entry) => entry['brand'] == 'BMW' && entry['model'] == 'X1',
    );

    expect(entry['startYear'], lessThanOrEqualTo(2017));
    final endYear = entry['endYear'];
    expect(endYear == 'Present' || (endYear as int) >= 2017, isTrue);
  });
}

bool hasModel(List<Map<String, dynamic>> catalog, String brand, String model) {
  return catalog.any(
    (entry) => entry['brand'] == brand && entry['model'] == model,
  );
}

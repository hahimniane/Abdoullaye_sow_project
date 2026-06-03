import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/vin_catalog_matcher.dart';
import 'package:my_flutter_app/services/vin_decoder_service.dart';

void main() {
  test('matches decoded make model and year case-insensitively', () {
    final match = matchDecodedVehicleToCatalog(
      decoded: const DecodedVehicleInfo(
        vin: '1HGCM82633A004352',
        make: 'honda',
        model: 'accord',
        year: '2003',
      ),
      makeOptions: const ['Honda', 'Toyota'],
      modelsForMake: (_) => const ['Accord', 'Civic'],
      yearsForModel: (_, _) => const ['2004', '2003', '2002'],
    );

    expect(match.make, 'Honda');
    expect(match.model, 'Accord');
    expect(match.year, '2003');
    expect(match.isComplete, isTrue);
  });

  test('matches decoded Toyota Camry VIN payload to populate form fields', () {
    final match = matchDecodedVehicleToCatalog(
      decoded: const DecodedVehicleInfo(
        vin: '4T1BF1FK9HU603521',
        make: 'TOYOTA',
        model: 'Camry',
        year: '2017',
        trim: 'LE/SE/XLE/XSE',
        bodyClass: 'Sedan/Saloon',
        fuelType: 'Gasoline',
      ),
      makeOptions: const ['Honda', 'Toyota'],
      modelsForMake: (_) => const ['Camry', 'Corolla'],
      yearsForModel: (_, _) => const ['2018', '2017', '2016'],
    );

    expect(match.make, 'Toyota');
    expect(match.model, 'Camry');
    expect(match.year, '2017');
    expect(match.isComplete, isTrue);
  });

  test('uses decoded model and year when model is missing from catalog', () {
    final match = matchDecodedVehicleToCatalog(
      decoded: const DecodedVehicleInfo(
        vin: 'WBXHT3Z36HH4A55362',
        make: 'BMW',
        model: 'X1 xDrive28iBr',
        year: '2017',
      ),
      makeOptions: const ['BMW'],
      modelsForMake: (_) => const ['3 Series', '5 Series', '7 Series', 'X5'],
      yearsForModel: (_, _) => const [],
    );

    expect(match.make, 'BMW');
    expect(match.model, 'X1');
    expect(match.year, '2017');
    expect(match.modelOptions.first, 'X1');
    expect(match.yearOptions.first, '2017');
    expect(match.isComplete, isTrue);
  });

  test('preserves unmatched decoded model for staff review', () {
    final match = matchDecodedVehicleToCatalog(
      decoded: const DecodedVehicleInfo(
        vin: '1HGCM82633A004352',
        make: 'Honda',
        model: 'Accord Crosstour',
        year: '2010',
      ),
      makeOptions: const ['Honda'],
      modelsForMake: (_) => const ['Accord'],
      yearsForModel: (_, _) => const ['2010'],
    );

    expect(match.make, 'Honda');
    expect(match.model, 'Accord Crosstour');
    expect(match.year, '2010');
    expect(match.isComplete, isTrue);
  });
}

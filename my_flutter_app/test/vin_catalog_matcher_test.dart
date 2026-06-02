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

  test('leaves unmatched decoded model for staff review', () {
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
    expect(match.model, isNull);
    expect(match.year, isNull);
    expect(match.isComplete, isFalse);
  });
}

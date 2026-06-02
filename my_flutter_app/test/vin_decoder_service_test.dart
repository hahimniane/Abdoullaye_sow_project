import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/vin_decoder_service.dart';

void main() {
  test('normalizes NHTSA vehicle identity response', () {
    final decoded = parseNhtsaVinResponse('1HGCM82633A004352', {
      'Results': [
        {
          'VIN': '1HGCM82633A004352',
          'ErrorCode': '0',
          'Make': 'HONDA',
          'Model': 'Accord',
          'ModelYear': '2003',
          'Trim': 'EX',
          'BodyClass': 'Sedan/Saloon',
          'EngineCylinders': '6',
          'DisplacementL': '3.0',
          'FuelTypePrimary': 'Gasoline',
        },
      ],
    });

    expect(decoded.vin, '1HGCM82633A004352');
    expect(decoded.make, 'HONDA');
    expect(decoded.model, 'Accord');
    expect(decoded.year, '2003');
    expect(decoded.trim, 'EX');
    expect(decoded.bodyClass, 'Sedan/Saloon');
    expect(decoded.engine, '6 cyl 3.0L');
    expect(decoded.fuelType, 'Gasoline');
  });

  test('throws readable failure when NHTSA returns no identity', () {
    expect(
      () => parseNhtsaVinResponse('1HGCM82633A004352', {
        'Results': [
          {
            'VIN': '1HGCM82633A004352',
            'ErrorCode': '5',
            'ErrorText': 'Invalid check digit',
          },
        ],
      }),
      throwsA(isA<VinDecodeException>()),
    );
  });
}

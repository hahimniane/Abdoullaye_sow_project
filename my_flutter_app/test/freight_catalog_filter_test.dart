import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/business_service.dart';
import 'package:my_flutter_app/services/business_service.dart';

void main() {
  test('priced Conakry Express Senegal freight survives the iOS catalog parse', () {
    // Live callable row (Aug 29 2026 sandbox): freight-only, no barrel rate.
    // Nested Map<Object?, Object?> is what the iOS Functions plugin returns.
    final raw = <Object?, Object?>{
      'options': <Object?>[
        <Object?, Object?>{
          'id': 'conakry_express_senegal',
          'businessId': 'conakry_express',
          'businessName': 'Conakry Express',
          'businessStatus': 'approved',
          'enabledServices': <Object?>['freight'],
          'country': <Object?, Object?>{
            'id': 'senegal',
            'name': 'Senegal',
            'code': 'SN',
            'isActive': true,
            'freightAirPricePerKg': 12.5,
            'freightSeaPricePerKg': 4,
            'serviceAvailability': <Object?, Object?>{
              'barrelShipping': false,
              'freightAir': true,
              'freightSea': true,
            },
          },
        },
      ],
    };

    final options = destinationOptionsFromCallableData(raw);
    final freight = freightEligibleOptions(options);

    expect(options, hasLength(1));
    expect(freight, hasLength(1));
    expect(freight.single.businessName, 'Conakry Express');
    expect(freight.single.country.name, 'Senegal');
    expect(freight.single.country.freightAirPricePerKg, 12.5);
    expect(freight.single.country.freightSeaPricePerKg, 4);
    expect(freight.single.isAvailableFor(BusinessServiceKey.freight), isTrue);
    expect(freight.single.isAvailableFor(BusinessServiceKey.barrelShipping), isFalse);
  });

  test('a barrel-only business is not a freight option', () {
    final options = destinationOptionsFromCallableData({
      'options': [
        {
          'id': 'biz_gn',
          'businessId': 'biz',
          'businessName': 'Barrels Only',
          'businessStatus': 'approved',
          'enabledServices': ['barrelShipping'],
          'country': {
            'id': 'gn',
            'name': 'Guinea',
            'isActive': true,
            'barrelShippingPrice': 225,
          },
        },
      ],
    });

    expect(freightEligibleOptions(options), isEmpty);
    expect(options.single.isAvailableForAnyShippingService, isTrue);
  });
}

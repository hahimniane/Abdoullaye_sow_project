import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/business_destination_option.dart';
import 'package:my_flutter_app/models/business_service.dart';

Map<String, dynamic> optionData({
  required List<String> services,
  double barrelRate = 0,
  double airRate = 0,
  double seaRate = 0,
  List<String>? airDepartureDays,
  List<String>? seaDepartureDays,
  Map<String, bool>? serviceAvailability,
}) {
  final country = <String, dynamic>{
    'id': 'gn',
    'name': 'Guinea',
    'isActive': true,
    'barrelShippingPrice': barrelRate,
    'freightAirPricePerKg': airRate,
    'freightSeaPricePerKg': seaRate,
    'freightAirDepartureDays': airDepartureDays ?? const <String>[],
    'freightSeaDepartureDays': seaDepartureDays ?? const <String>[],
  };
  if (serviceAvailability != null) {
    country['serviceAvailability'] = serviceAvailability;
  }
  return {
    'id': 'biz_gn',
    'businessId': 'biz',
    'businessName': 'Business',
    'businessStatus': 'approved',
    'enabledServices': services,
    'country': country,
  };
}

void main() {
  test('freight-only destinations do not require a barrel rate', () {
    final option = BusinessDestinationOption.fromFunctionData(
      optionData(services: ['freight'], seaRate: 5),
    );
    expect(option.isAvailableFor(BusinessServiceKey.freight), isTrue);
    expect(option.isAvailableForAnyShippingService, isTrue);
    expect(option.isAvailable, isFalse);
  });

  test(
    'transport destinations require approval and service, not barrel price',
    () {
      final option = BusinessDestinationOption.fromFunctionData(
        optionData(
          services: ['carTransport'],
          serviceAvailability: {
            'barrelShipping': false,
            'freightAir': false,
            'freightSea': false,
            'carTransport': true,
          },
        ),
      );
      expect(option.isAvailableFor(BusinessServiceKey.carTransport), isTrue);
      expect(option.isAvailable, isFalse);
    },
  );

  test('barrel destinations still require a positive barrel price', () {
    final unavailable = BusinessDestinationOption.fromFunctionData(
      optionData(services: ['barrelShipping']),
    );
    final available = BusinessDestinationOption.fromFunctionData(
      optionData(services: ['barrelShipping'], barrelRate: 225),
    );
    expect(
      unavailable.isAvailableFor(BusinessServiceKey.barrelShipping),
      isFalse,
    );
    expect(available.isAvailableFor(BusinessServiceKey.barrelShipping), isTrue);
  });

  test('explicit service toggles override legacy rates', () {
    final option = BusinessDestinationOption.fromFunctionData(
      optionData(
        services: ['barrelShipping', 'freight'],
        barrelRate: 225,
        airRate: 12,
        seaRate: 5,
        serviceAvailability: {
          'barrelShipping': false,
          'freightAir': false,
          'freightSea': true,
          'carTransport': false,
        },
      ),
    );

    expect(option.isAvailableFor(BusinessServiceKey.barrelShipping), isFalse);
    expect(option.country.freightAvailable('air'), isFalse);
    expect(option.country.freightAvailable('sea'), isTrue);
    expect(option.isAvailableFor(BusinessServiceKey.freight), isTrue);
  });

  test('car transport uses its destination toggle without a price', () {
    final unavailable = BusinessDestinationOption.fromFunctionData(
      optionData(
        services: ['carTransport'],
        serviceAvailability: {
          'barrelShipping': false,
          'freightAir': false,
          'freightSea': false,
          'carTransport': false,
        },
      ),
    );
    final available = BusinessDestinationOption.fromFunctionData(
      optionData(
        services: ['carTransport'],
        serviceAvailability: {
          'barrelShipping': false,
          'freightAir': false,
          'freightSea': false,
          'carTransport': true,
        },
      ),
    );

    expect(
      unavailable.isAvailableFor(BusinessServiceKey.carTransport),
      isFalse,
    );
    expect(available.isAvailableFor(BusinessServiceKey.carTransport), isTrue);
  });

  test('a global service disable overrides stale country coverage', () {
    final option = BusinessDestinationOption.fromFunctionData(
      optionData(
        services: ['freight'],
        barrelRate: 225,
        serviceAvailability: {
          'barrelShipping': true,
          'freightAir': false,
          'freightSea': false,
          'carTransport': true,
        },
      ),
    );

    expect(option.isAvailableFor(BusinessServiceKey.barrelShipping), isFalse);
    expect(option.isAvailableFor(BusinessServiceKey.carTransport), isFalse);
  });

  test('legacy active rows do not imply car transport coverage', () {
    final option = BusinessDestinationOption.fromFunctionData(
      optionData(services: ['carTransport'], barrelRate: 225),
    );

    expect(option.country.carTransportAvailable, isFalse);
    expect(option.isAvailableFor(BusinessServiceKey.carTransport), isFalse);
  });

  test('freight departure days are normalized in calendar order', () {
    final option = BusinessDestinationOption.fromFunctionData(
      optionData(
        services: ['freight'],
        airRate: 12,
        airDepartureDays: ['thursday', 'monday', 'funday', 'thursday'],
        seaDepartureDays: ['saturday'],
      ),
    );

    expect(option.country.freightAirDepartureDays, ['monday', 'thursday']);
    expect(option.country.freightSeaDepartureDays, ['saturday']);
  });
}

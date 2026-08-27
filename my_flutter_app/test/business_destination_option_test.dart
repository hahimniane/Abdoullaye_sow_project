import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/business_destination_option.dart';
import 'package:my_flutter_app/models/business_service.dart';
import 'package:my_flutter_app/services/freight_coverage.dart';

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

  test('destination delivery is read off the wire whole', () {
    final data = optionData(services: ['freight'], seaRate: 5)
      ..['freightDestinationDeliveryAvailable'] = true
      ..['freightDestinationDeliveryFee'] = 15;
    final option = BusinessDestinationOption.fromFunctionData(data);

    expect(option.freightDestinationDeliveryAvailable, isTrue);
    expect(option.freightDestinationDeliveryFee, 15);
    expect(option.freightDelivery.offered, isTrue);
    expect(option.freightDelivery.feeCents, 1500);
  });

  test('a business that publishes no delivery fee is not offering it', () {
    // Opted in with nothing priced is an unfinished setting, and a business
    // that never touched the setting offers nothing at all.
    final unpriced = BusinessDestinationOption.fromFunctionData(
      optionData(services: ['freight'], seaRate: 5)
        ..['freightDestinationDeliveryAvailable'] = true,
    );
    final untouched = BusinessDestinationOption.fromFunctionData(
      optionData(services: ['freight'], seaRate: 5),
    );

    expect(unpriced.freightDelivery.offered, isFalse);
    expect(untouched.freightDestinationDeliveryAvailable, isFalse);
    expect(untouched.freightDelivery.offered, isFalse);
    expect(untouched.freightDestinationDeliveryFee, 0);
  });

  test('coverage arrives as one flag and nothing else', () {
    final covers = BusinessDestinationOption.fromFunctionData(
      optionData(services: ['freight'], seaRate: 5)
        ..['freightCoverage'] = {'coversLoss': true},
    );
    final bare = BusinessDestinationOption.fromFunctionData(
      optionData(services: ['freight'], seaRate: 5)
        ..['freightCoverage'] = {'coversLoss': false},
    );
    final noFreight = BusinessDestinationOption.fromFunctionData(
      optionData(services: ['barrelShipping'], barrelRate: 225),
    );

    expect(covers.freightCoverage?.coversLoss, isTrue);
    expect(covers.freightCoverageSummary, FreightCoverageSummary.coversLoss);
    expect(bare.freightCoverageSummary, FreightCoverageSummary.noCoverage);
    // Null is "no freight at all", which is not the same as covering nothing.
    expect(noFreight.freightCoverage, isNull);
    expect(
      noFreight.freightCoverageSummary,
      FreightCoverageSummary.notOffered,
    );
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

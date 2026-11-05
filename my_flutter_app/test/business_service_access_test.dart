import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/business_service.dart';

void main() {
  test('missing legacy service data keeps the compatibility catalog', () {
    expect(normalizeBusinessServices(null), defaultBusinessServiceValues);
  });

  test('explicit empty and malformed service data fail closed', () {
    expect(normalizeBusinessServices(const <String>[]), isEmpty);
    expect(normalizeBusinessServices('freight'), isEmpty);
  });

  test('only known explicitly enabled services are retained', () {
    expect(
      normalizeBusinessServices(const ['freight', 'unknown', 'carParking']),
      const ['freight', 'carParking'],
    );
  });

  group('Freight is retired (folded into Send a package)', () {
    test('a new business is not given Freight', () {
      expect(defaultBusinessServiceValues, isNot(contains('freight')));
      expect(normalizeBusinessServices(null), isNot(contains('freight')));
    });

    test('no picker offers Freight to an owner', () {
      final keys = [for (final s in ownerBusinessServiceCatalog) s.key];
      expect(keys, isNot(contains(BusinessServiceKey.freight)));
      expect(keys, isNot(contains(BusinessServiceKey.inventory)));
    });

    test('a platform admin sees Freight only on a business that has it', () {
      List<BusinessServiceKey> keys(List<String> current) => [
        for (final s in adminBusinessServiceCatalog(current)) s.key,
      ];
      expect(
        keys(const ['carParking']),
        isNot(contains(BusinessServiceKey.freight)),
      );
      expect(
        keys(const ['carParking', 'freight']),
        contains(BusinessServiceKey.freight),
      );
    });

    test('a stored Freight still parses, so old records stay reachable', () {
      expect(
        BusinessServiceKey.fromValue('freight'),
        BusinessServiceKey.freight,
      );
      expect(normalizeBusinessServices(const ['freight']), const ['freight']);
      // A business with only the retired service still has containers.
      expect(businessHasShippingService(const ['freight']), isTrue);
    });
  });
}

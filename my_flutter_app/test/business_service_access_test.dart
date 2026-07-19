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
}

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/drop_off_address.dart';

void main() {
  test('prefers a headquarters street over the generic drop-off label', () {
    expect(
      resolveOfficeDropOffAddress(
        officeAddress: '',
        fallbackAddress: '12 Kaloum Street, Conakry, Guinea',
        genericLabel: 'Drop-off office',
      ),
      '12 Kaloum Street, Conakry, Guinea',
    );
  });

  test('does not treat a generic label as a real office street', () {
    expect(isGenericOfficeDropOffAddress('Drop-off office'), isTrue);
    expect(isGenericOfficeDropOffAddress('the business office'), isTrue);
    expect(
      resolveOfficeDropOffAddress(
        officeAddress: 'Drop-off office',
        fallbackAddress: '',
        genericLabel: 'Drop-off office',
      ),
      'Drop-off office',
    );
  });
}

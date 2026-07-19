import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/phone_number_validator.dart';

void main() {
  group('PhoneNumberValidator E.164 verification input', () {
    test('accepts an international number with common spacing', () {
      expect(PhoneNumberValidator.isValidE164('+1 (718) 555-0100'), isTrue);
      expect(
        PhoneNumberValidator.normalized('+1 (718) 555-0100'),
        '+17185550100',
      );
    });

    test('requires a plus sign, country code, and valid E.164 length', () {
      expect(PhoneNumberValidator.isValidE164('7185550100'), isFalse);
      expect(PhoneNumberValidator.isValidE164('+0123456789'), isFalse);
      expect(PhoneNumberValidator.isValidE164('+1234567'), isFalse);
      expect(PhoneNumberValidator.isValidE164('+1234567890123456'), isFalse);
    });

    test('matches a verified Auth phone to a formatted profile phone', () {
      expect(
        PhoneNumberValidator.matches('+17185550100', '+1 (718) 555-0100'),
        isTrue,
      );
      expect(
        PhoneNumberValidator.matches('+17185550100', '+17185550101'),
        isFalse,
      );
      expect(PhoneNumberValidator.matches(null, '+17185550100'), isFalse);
    });
  });
}

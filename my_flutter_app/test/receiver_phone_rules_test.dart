import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/utils/receiver_phone_rules.dart';

void main() {
  const guinea = DestinationCountry(id: 'guinea', name: 'Guinea', code: 'GN');
  const sierraLeone = DestinationCountry(
    id: 'sierra-leone',
    name: 'Sierra Leone',
    code: 'SL',
  );
  const hongKong = DestinationCountry(
    id: 'hong-kong',
    name: 'Hong Kong',
    code: 'HK',
  );

  String? validate(
    String value,
    DestinationCountry destination, {
    bool whatsApp = false,
  }) {
    return ReceiverPhoneRules.validate(
      value: value,
      destination: destination,
      allowDifferentCountry: whatsApp,
      requiredMessage: 'required',
      invalidPhoneMessage: 'invalid',
      invalidInternationalPhoneMessage: 'invalid international',
      whatsAppCountryCodeMessage: 'include country code',
      destinationMismatchMessage: (name, prefix) => '$name:$prefix',
    );
  }

  test('accepts destination numbers for Guinea and Sierra Leone', () {
    expect(validate('+224 622 12 34 56', guinea), isNull);
    expect(validate('+232 76 123456', sierraLeone), isNull);
  });

  test('uses the shared catalog for formerly missing destination codes', () {
    expect(validate('+852 5123 4567', hongKong), isNull);
    expect(validate('+1 202 555 0184', hongKong), 'Hong Kong:+852');
  });

  test('rejects a different-country number unless marked for WhatsApp', () {
    expect(validate('+1 202 555 0184', guinea), 'Guinea:+224');
    expect(validate('+1 202 555 0184', guinea, whatsApp: true), isNull);
  });

  test('WhatsApp exception still requires an explicit country code', () {
    expect(
      validate('202 555 0184', guinea, whatsApp: true),
      'include country code',
    );
  });

  test('detects when the WhatsApp explanation should be offered', () {
    expect(
      ReceiverPhoneRules.isDifferentCountryNumber(
        value: '+1 202 555 0184',
        destination: sierraLeone,
      ),
      isTrue,
    );
    expect(
      ReceiverPhoneRules.isDifferentCountryNumber(
        value: '+232 76 123456',
        destination: sierraLeone,
      ),
      isFalse,
    );
  });
}

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/guest_checkout_service.dart';

void main() {
  group('a guest\'s details', () {
    test('are trimmed and lowercased', () {
      final contact = normalizeGuestContact(
        name: '  Mariama Diallo ',
        email: ' Mariama@Example.COM ',
        phone: '+1 (201) 555-0147',
      );
      expect(contact.name, 'Mariama Diallo');
      expect(contact.email, 'mariama@example.com');
      expect(contact.phone, '+12015550147');
    });

    test('travel to the backend under the keys it reads', () {
      final contact = normalizeGuestContact(
        name: 'A',
        email: 'a@b.co',
        phone: '2015550147',
      );
      expect(contact.toJson(), {
        'name': 'A',
        'email': 'a@b.co',
        'phone': '2015550147',
      });
    });
  });

  group('checking a guest\'s details', () {
    test('names every unusable field at once', () {
      // One problem revealed per attempt turns a single mistake into three
      // trips through the form.
      expect(guestContactProblems(name: '', email: '', phone: ''), [
        GuestContactField.name,
        GuestContactField.email,
        GuestContactField.phone,
      ]);
    });

    test('accepts a complete set', () {
      expect(
        guestContactProblems(
          name: 'Mariama',
          email: 'm@example.com',
          phone: '+12015550147',
        ),
        isEmpty,
      );
    });

    test('rejects a number that is not one', () {
      for (final phone in ['12345', 'call me', '1234567890123456', '']) {
        expect(
          guestContactProblems(name: 'A', email: 'a@b.co', phone: phone),
          [GuestContactField.phone],
          reason: phone,
        );
      }
    });

    test('rejects an address that could not receive a receipt', () {
      for (final email in ['nope', 'a@b', '@b.co', '']) {
        expect(
          guestContactProblems(name: 'A', email: email, phone: '2015550147'),
          [GuestContactField.email],
          reason: email,
        );
      }
    });
  });

  group('what a booking carries', () {
    test('is nothing at all before a guest session starts', () {
      // No anonymous session means the caller is either signed in or not
      // booking yet; either way a guest block would be wrong.
      expect(GuestCheckoutSession().payloadFields(), isEmpty);
    });
  });

  group('what carries a guest to the backend', () {
    test('every service a guest can book attaches the block', () {
      // Found the hard way: the price-request path does not go through the
      // checkout call, so wiring only the checkout left guests rejected with
      // "Enter your contact details to continue".
      for (final path in const [
        'lib/services/freight_shipment_service.dart',
        'lib/services/barrel_shipment_service.dart',
        'lib/services/freight_quote_service.dart',
      ]) {
        expect(
          File(path).readAsStringSync(),
          contains('guestCheckout.payloadFields()'),
          reason: path,
        );
      }
    });
  });

  group('where a guest lands when they want to track', () {
    test('an anonymous session still gets the lookup, not an account list', () {
      // Giving a guest a customer profile so notifications can reach them
      // also made the app treat them as a signed-in customer, which sent
      // them to an empty list instead of the one screen that takes the
      // tracking number they were told to keep.
      final screen = File('lib/screens/tracking_screen.dart').readAsStringSync();
      expect(screen, contains('user?.isAnonymous'));
      expect(screen, contains('customerUid == null || guestSession'));
    });
  });
}

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations_en.dart';
import 'package:my_flutter_app/l10n/app_localizations_fr.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/services/destination_pickup.dart';

/// Pickup details per destination: what the app checks before it calls
/// `setDestinationPickup`, and that it agrees with the server and the
/// console (functions/destination_pickup.js is the authority).
void main() {
  final en = AppLocalizationsEn();
  final fr = AppLocalizationsFr();

  group('checking what the owner typed', () {
    test('blank is fine everywhere', () {
      expect(pickupCityError(en, ''), isNull);
      expect(pickupAddressError(en, ''), isNull);
      expect(pickupPhoneError(en, ''), isNull);
    });

    test('the phone must carry its country code', () {
      expect(pickupPhoneError(en, '+224 620 00 00 00'), isNull);
      expect(pickupPhoneError(en, '620000000'), en.dstPickupPhoneInvalid);
      expect(pickupPhoneError(fr, '620000000'), fr.dstPickupPhoneInvalid);
      expect(en.dstPickupPhoneInvalid, isNot(fr.dstPickupPhoneInvalid));
    });

    test('the city and address have the server limits', () {
      expect(pickupCityError(en, 'x' * pickupCityMaxLength), isNull);
      expect(pickupCityError(en, 'x' * (pickupCityMaxLength + 1)),
          en.dstPickupCityTooLong);
      expect(pickupAddressError(en, 'y' * pickupAddressMaxLength), isNull);
      expect(pickupAddressError(fr, 'y' * (pickupAddressMaxLength + 1)),
          fr.dstPickupAddressTooLong);
      final server = File('functions/destination_pickup.js').readAsStringSync();
      expect(server, contains('pickupCity: $pickupCityMaxLength,'));
      expect(server, contains('pickupAddress: $pickupAddressMaxLength,'));
      expect(server, contains(r'const E164 = /^\+[1-9]\d{7,14}$/;'));
    });
  });

  group('saving', () {
    test('calls setDestinationPickup with the tidied values', () async {
      final calls = <(String, Map<String, Object?>)>[];
      final saved = await saveDestinationPickup(
        businessId: 'b1',
        countryId: 'guinea',
        before: const DestinationPickup(),
        after: const DestinationPickup(
          city: ' Conakry ',
          address: 'Madina\n  near the market',
          phone: '+224 620-00 00 00',
        ),
        caller: (name, payload) async {
          calls.add((name, payload));
          return null;
        },
      );
      expect(saved, isTrue);
      expect(calls.single.$1, 'setDestinationPickup');
      expect(calls.single.$2, {
        'businessId': 'b1',
        'countryId': 'guinea',
        'pickupCity': 'Conakry',
        'pickupAddress': 'Madina near the market',
        'pickupPhone': '+224620000000',
      });
    });

    test('sends nothing when nothing changed, and blanks clear', () async {
      final calls = <Map<String, Object?>>[];
      Future<Object?> caller(String _, Map<String, Object?> payload) async {
        calls.add(payload);
        return null;
      }

      const stored = DestinationCountry(
        id: 'guinea',
        name: 'Guinea',
        pickupCity: 'Conakry',
        pickupAddress: 'Madina',
        pickupPhone: '+224620000000',
      );
      final before = DestinationPickup.of(stored);
      expect(
        await saveDestinationPickup(
          businessId: 'b1',
          countryId: 'guinea',
          before: before,
          after: const DestinationPickup(
            city: 'Conakry',
            address: 'Madina',
            phone: '+224 620 00 00 00',
          ),
          caller: caller,
        ),
        isFalse,
      );
      expect(calls, isEmpty);
      await saveDestinationPickup(
        businessId: 'b1',
        countryId: 'guinea',
        before: before,
        after: const DestinationPickup(city: 'Conakry'),
        caller: caller,
      );
      expect(calls.single['pickupAddress'], '');
      expect(calls.single['pickupPhone'], '');
    });
  });

  test('both clients save pickup through the callable', () {
    final screen = File(
      'lib/screens/destination_countries_screen.dart',
    ).readAsStringSync();
    expect(screen, contains('await saveDestinationPickup('));
    expect(screen, contains('CountryPhoneField('));
    expect(screen, contains("Key('dst-pickup-phone')"));
    // The coverage write never carries them.
    final write = screen.substring(
      screen.indexOf(".collection('destinationCountries')\n          .doc(id)"),
      screen.indexOf('await saveDestinationPickup('),
    );
    expect(write, isNot(contains('pickupCity')));
    final console = File(
      '../admin_web/src/components/business/operations-panels.tsx',
    ).readAsStringSync();
    expect(console, contains('httpsCallable(functions, "setDestinationPickup")'));
    final backend = File('functions/index.js').readAsStringSync();
    expect(backend, contains('exports.setDestinationPickup = onCall('));
  });
}

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/freight_delivery.dart';

/// Delivering the parcel to the receiver's own address at the destination.
/// Twin of `functions/test/freight-delivery.test.js` and the web mirror: the
/// fee previewed here is the fee the callable charges, and an address is the
/// whole point of the option, so an empty one never reaches the server.

void main() {
  group('what a business publishes', () {
    test('an opted-in business with a fee offers it', () {
      final policy = freightDeliveryPolicy(available: true, fee: 15);
      expect(policy.offered, isTrue);
      expect(policy.fee, 15);
      expect(policy.feeCents, 1500);
    });

    test('opted in but unpriced is an unfinished setting, not free', () {
      final policy = freightDeliveryPolicy(available: true, fee: 0);
      expect(policy.offered, isFalse);
      expect(policy.feeCents, 0);
    });

    test('opting out drops the fee with it', () {
      final policy = freightDeliveryPolicy(available: false, fee: 25);
      expect(policy.offered, isFalse);
      expect(policy.fee, 0);
    });

    test('an awkward fee rounds to the cent the server charges', () {
      expect(freightDeliveryPolicy(available: true, fee: 12.345).feeCents, 1235);
    });
  });

  group('whether a choice can be booked', () {
    test('collection needs nothing else', () {
      expect(
        deliveryChoiceIsComplete(wantsDelivery: false, receiverAddress: ''),
        isTrue,
      );
    });

    test('delivery without an address is not bookable', () {
      for (final address in ['', '   ']) {
        expect(
          deliveryChoiceIsComplete(
            wantsDelivery: true,
            receiverAddress: address,
          ),
          isFalse,
          reason: 'for "$address"',
        );
      }
    });

    test('an address longer than the server accepts is refused here', () {
      expect(
        deliveryChoiceIsComplete(
          wantsDelivery: true,
          receiverAddress: 'a' * (maxReceiverAddressLength + 1),
        ),
        isFalse,
      );
      expect(
        deliveryChoiceIsComplete(
          wantsDelivery: true,
          receiverAddress: 'a' * maxReceiverAddressLength,
        ),
        isTrue,
      );
    });
  });

  group('the words a customer reads', () {
    Map<String, Object?> arb(String locale) =>
        jsonDecode(File('lib/l10n/app_$locale.arb').readAsStringSync())
            as Map<String, Object?>;

    test('every delivery string exists in both catalogs', () {
      final en = arb('en');
      final fr = arb('fr');
      const keys = <String>[
        'freightDestinationDeliveryTitle',
        'freightDestinationDeliveryCollect',
        'freightDestinationDeliveryCollectHelp',
        'freightDestinationDeliveryToAddress',
        'freightDestinationDeliveryFeeLabel',
        'freightReceiverAddressLabel',
        'freightReceiverAddressHint',
        'freightReceiverAddressHelper',
        'freightReceiverAddressRequired',
        'freightReceiverAddressTooLong',
        'outForDelivery',
        'freightNextOutForDelivery',
      ];
      for (final key in keys) {
        expect(en[key], isNotNull, reason: 'app_en.arb is missing $key');
        expect(fr[key], isNotNull, reason: 'app_fr.arb is missing $key');
        expect(
          (fr[key] as String).trim(),
          isNotEmpty,
          reason: 'app_fr.arb has an empty $key',
        );
      }
    });
  });

  group('the booking screen keeps its side of the bargain', () {
    final screen = File(
      'lib/screens/send_freight_screen.dart',
    ).readAsStringSync();

    test('the choice is only offered by a business that offers it', () {
      expect(screen, contains('if (_deliveryPolicy.offered) ...['));
      expect(screen, contains('_destinationDeliverySection(theme, l10n)'));
      // A business swap must not carry the previous one's offer with it.
      expect(
        screen,
        contains(
          'bool get _deliveryChosen => _deliveryPolicy.offered && '
          '_destinationDelivery;',
        ),
      );
      expect(screen, contains('_resetDestinationDelivery()'));
    });

    test('the fee reaches the total and the price breakdown', () {
      expect(
        screen,
        contains('double get _appliedDeliveryFee {'),
      );
      expect(
        screen,
        contains(
          'double get _totalPrice => _price + _appliedPickupFee + '
          '_appliedDeliveryFee;',
        ),
      );
      expect(screen, contains('freightDestinationDeliveryFeeLabel'));
    });

    test('the choice and the address reach the callable', () {
      expect(screen, contains('destinationDelivery: _deliveryChosen'));
      expect(
        screen,
        contains('receiverAddress: _deliveryChosen ? _receiverAddress : null'),
      );
    });

    test('an incomplete address holds the order', () {
      expect(screen, contains('deliveryChoiceIsComplete('));
      expect(screen, contains('_deliveryBlocksSubmit'));
      expect(screen, contains('freightReceiverAddressRequired'));
    });

    test('the destination address is free text, not the US fields', () {
      // Conakry, Dakar and Bamako addresses are a neighbourhood and a
      // landmark rather than a house number on a named street, so the
      // structured fields have nowhere to put them.
      expect(screen, contains('controller: _receiverAddressController'));
      expect(screen, contains('freightReceiverAddressHint'));
      expect(
        screen,
        isNot(contains('StructuredAddressFields(\n                controller: '
            '_receiverAddressController')),
      );
    });
  });

  group('the service sends what the callable expects', () {
    final service = File(
      'lib/services/freight_shipment_service.dart',
    ).readAsStringSync();

    test('delivery is omitted rather than sent as false', () {
      expect(
        service,
        contains("if (destinationDelivery) 'destinationDelivery': true"),
      );
      expect(service, contains("'receiverAddress': ?receiverAddress"));
    });

    test('no declared value is sent from a current build', () {
      expect(service, isNot(contains('declaredValue')));
    });
  });
}

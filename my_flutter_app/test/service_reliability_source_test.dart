import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/services_hub_screen.dart';

void main() {
  test('orders wait for every service stream before leaving loading state', () {
    final source = File('lib/screens/orders_screen.dart').readAsStringSync();
    expect(source, contains('_cars == null ||'));
    expect(source, contains('_freight == null ||'));
    expect(source, isNot(contains('_cars == null &&\n      _barrels')));
  });

  test(
    'freight discovery distinguishes load failure from an empty catalog',
    () {
      final source = File(
        'lib/screens/send_freight_screen.dart',
      ).readAsStringSync();
      expect(source, contains('bool _loadFailed = false;'));
      expect(source, contains('l10n.couldNotLoadFreightOptions'));
      expect(source, contains('onPressed: _load'));
    },
  );

  test('freight booking mode cards have bounded height in the scroll form', () {
    final source = File(
      'lib/screens/send_freight_screen.dart',
    ).readAsStringSync();
    expect(source, contains('IntrinsicHeight('));
    expect(source, contains('crossAxisAlignment: CrossAxisAlignment.stretch'));
  });

  test(
    'car transport uses marketplace quotes instead of preassigning a business',
    () {
      final screen = File(
        'lib/screens/request_transport_screen.dart',
      ).readAsStringSync();
      final service = File(
        'lib/services/transport_service.dart',
      ).readAsStringSync();

      expect(screen, contains('SearchableDestinationCountryField'));
      expect(screen, isNot(contains('_selectedOption')));
      expect(service, isNot(contains("required String businessId")));
      expect(service, contains("'selectTransportQuote'"));
      expect(service, contains("'cancelTransportQuoteRequest'"));
      expect(service, contains("collection('transportQuotes')"));
    },
  );

  testWidgets('shipping service hub renders its French service labels', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        locale: Locale('fr'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: ShippingTab(),
      ),
    );

    expect(find.text('Expédition'), findsOneWidget);
    expect(find.text('Envoyer un baril'), findsOneWidget);
    expect(find.text('Barils partagés'), findsOneWidget);
    expect(find.text('Fret'), findsOneWidget);
    expect(find.text('Transporter une voiture'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

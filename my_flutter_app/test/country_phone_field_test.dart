import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/data/calling_code_catalog.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/widgets/country_phone_field.dart';

Widget _host({
  required TextEditingController controller,
  Locale locale = const Locale('en'),
  bool showClearButton = false,
}) {
  return MaterialApp(
    locale: locale,
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    home: Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: CountryPhoneField(
          fieldKey: const Key('phone-field'),
          controller: controller,
          labelText: 'Phone',
          showClearButton: showClearButton,
        ),
      ),
    ),
  );
}

void main() {
  test('catalog exposes common and formerly missing calling codes', () {
    expect(CallingCodeCatalog.optionForCountryCode('US')?.dialCode, '+1');
    expect(CallingCodeCatalog.optionForCountryCode('GN')?.dialCode, '+224');
    expect(CallingCodeCatalog.optionForCountryCode('HK')?.dialCode, '+852');
    expect(
      CallingCodeCatalog.composeInternationalPhone(
        callingCode: '+224',
        nationalNumber: '622 12 34 56',
      ),
      '+224622123456',
    );
    expect(
      CallingCodeCatalog.optionForPhoneNumber('+224622123456')?.countryCode,
      'GN',
    );
  });

  testWidgets('local typing is saved with the selected country code', (
    tester,
  ) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(_host(controller: controller));

    await tester.enterText(find.byKey(const Key('phone-field')), '7185550100');
    await tester.pump();

    expect(controller.text, '+17185550100');
    expect(
      tester
          .widget<TextFormField>(find.byKey(const Key('phone-field')))
          .controller
          ?.text,
      '7185550100',
    );
  });

  testWidgets('changing country replaces the previous dial code', (
    tester,
  ) async {
    final controller = TextEditingController(text: '+17185550100');
    addTearDown(controller.dispose);
    await tester.pumpWidget(_host(controller: controller));

    await tester.tap(find.text('+1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Guinea'));
    await tester.pumpAndSettle();

    expect(controller.text, '+2247185550100');
    expect(
      tester
          .widget<TextFormField>(find.byKey(const Key('phone-field')))
          .controller
          ?.text,
      '7185550100',
    );
  });

  testWidgets('country selector copy is localized in French', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      _host(controller: controller, locale: const Locale('fr')),
    );

    await tester.tap(find.text('+1'));
    await tester.pumpAndSettle();

    expect(find.text('Sélectionner l’indicatif du pays'), findsOneWidget);
    expect(find.text('Rechercher un pays ou un indicatif'), findsOneWidget);
  });

  testWidgets('clear button removes a saved phone and resets the country', (
    tester,
  ) async {
    final controller = TextEditingController(text: '+23276123456');
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      _host(controller: controller, showClearButton: true),
    );

    expect(find.text('+232'), findsOneWidget);
    expect(
      tester
          .widget<TextFormField>(find.byKey(const Key('phone-field')))
          .controller
          ?.text,
      '76123456',
    );

    await tester.tap(find.byIcon(Icons.clear_rounded));
    await tester.pump();

    expect(controller.text, '');
    expect(find.text('+1'), findsOneWidget);
    expect(find.byIcon(Icons.clear_rounded), findsNothing);
    expect(
      tester
          .widget<TextFormField>(find.byKey(const Key('phone-field')))
          .controller
          ?.text,
      '',
    );
  });
}

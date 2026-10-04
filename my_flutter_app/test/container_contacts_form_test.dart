import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/lot_customers.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/country_phone_field.dart';

/// The container line's contacts, as staff meet them: the add-line form and
/// the contacts sheet. Phones come from the calling-code picker so WhatsApp
/// updates can reach them; each person has a switch, on by default and
/// meaningless without a number; a number missing its country code is
/// called out. The surrounding screens need a signed-in business, so the
/// sheets are pumped on their own.
final _box = ShippingContainer.fromMap('c1', {
  'businessId': 'b1',
  'label': 'Sailing 3 Oct, box 2',
  'status': containerStatusLoading,
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
});

ContainerLine _line(Map<String, dynamic> extra) => ContainerLine.fromMap('l1', {
      'businessId': 'b1',
      'containerId': 'c1',
      'kind': containerLineKindBarrels,
      'quantity': 2,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      ...extra,
    });

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(430, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: SafeArea(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

SwitchListTile _switch(WidgetTester tester, String key) =>
    tester.widget<SwitchListTile>(find.byKey(Key(key)));

String _stored(WidgetTester tester, String fieldKey) {
  final field = tester.widget<CountryPhoneField>(
    find.ancestor(
      of: find.byKey(Key(fieldKey)),
      matching: find.byType(CountryPhoneField),
    ),
  );
  return field.controller.text;
}

void main() {
  testWidgets(
      'the add-line form asks for phones through the picker, each with a switch',
      (tester) async {
    await _pump(
      tester,
      containerLineFormSheetForTesting(
        container: _box,
        customerCountryCode: 'US',
        receiverCountryCode: 'GN',
        customers: const [
          LotCustomer(
            id: 'k1',
            name: 'Fatou Diallo',
            phone: '622112233',
            email: '',
            lastSeenMs: 1,
          ),
        ],
      ),
    );
    await tester.tap(find.text('Barrels'));
    await tester.pumpAndSettle();

    // Both phones are the shared picker, never a free-text field: the
    // customer's starts in the business's country, the receiver's in the
    // country the box is going to.
    expect(find.byType(CountryPhoneField), findsNWidgets(2));
    expect(
      find.descendant(
        of: find.ancestor(
          of: find.byKey(const Key('line-phone')),
          matching: find.byType(CountryPhoneField),
        ),
        matching: find.text('+1'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.ancestor(
          of: find.byKey(const Key('line-receiver-phone')),
          matching: find.byType(CountryPhoneField),
        ),
        matching: find.text('+224'),
      ),
      findsOneWidget,
    );

    // No number, nobody to tell: the switch is off, disabled, and says why.
    final emptySwitch = _switch(tester, 'line-phone-notify');
    expect(emptySwitch.value, isFalse);
    expect(emptySwitch.onChanged, isNull);
    expect(
      find.text('Send this person WhatsApp updates about this shipment'),
      findsNWidgets(2),
    );
    expect(find.text('Add a phone number to turn this on.'), findsNWidgets(2));

    // A number typed in the receiver's country is stored in full and turns
    // the switch on by default; staff can still switch it off.
    await tester.enterText(
        find.byKey(const Key('line-receiver-phone')), '620000000');
    await tester.pumpAndSettle();
    expect(_stored(tester, 'line-receiver-phone'), '+224620000000');
    final receiverSwitch = _switch(tester, 'line-receiver-phone-notify');
    expect(receiverSwitch.value, isTrue);
    expect(receiverSwitch.onChanged, isNotNull);
    expect(find.byKey(const Key('line-receiver-phone-country-warning')),
        findsNothing);
    await tester.tap(find.byKey(const Key('line-receiver-phone-notify')));
    await tester.pumpAndSettle();
    expect(_switch(tester, 'line-receiver-phone-notify').value, isFalse);

    // Picking a remembered customer still fills the name and the phone; a
    // number remembered without its country code is called out.
    await tester.enterText(find.byKey(const Key('line-customer')), 'Fat');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Fatou Diallo'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('line-customer')))
          .controller!
          .text,
      'Fatou Diallo',
    );
    expect(_stored(tester, 'line-phone'), '622112233');
    expect(find.byKey(const Key('line-phone-country-warning')), findsOneWidget);
    expect(
      find.text(
          'Add the country code so WhatsApp updates can reach this number.'),
      findsOneWidget,
    );
    expect(_switch(tester, 'line-phone-notify').value, isTrue);

    // Choosing the country (or retyping) gives it the code; the warning goes.
    await tester.enterText(find.byKey(const Key('line-phone')), '6465550100');
    await tester.pumpAndSettle();
    expect(_stored(tester, 'line-phone'), '+16465550100');
    expect(find.byKey(const Key('line-phone-country-warning')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the form reads in French', (tester) async {
    await _pump(
      tester,
      containerLineFormSheetForTesting(container: _box),
      locale: const Locale('fr'),
    );
    await tester.tap(find.text('Des barils'));
    await tester.pumpAndSettle();
    expect(
      find.text(
          'Envoyer à cette personne les mises à jour WhatsApp de cet envoi'),
      findsNWidgets(2),
    );
    expect(
      find.text('Ajoutez un numéro de téléphone pour activer cette option.'),
      findsNWidgets(2),
    );
    // The longest French labels (the switch, the save buttons) fit.
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'the contacts sheet starts from the line and refuses what the server would',
      (tester) async {
    await _pump(
      tester,
      containerLineContactsSheetForTesting(
        line: _line({
          'trackingCode': 'CL-K7M4P2',
          'customerPhone': '+16465550100',
          'receiverName': 'Mariama Bah',
          'receiverPhone': '+224620000000',
          'notifyReceiver': false,
        }),
        customerCountryCode: 'US',
        receiverCountryCode: 'GN',
      ),
    );

    expect(find.text('Edit contacts'), findsOneWidget);
    expect(
      find.text('Names and phones can be corrected at any time, even after '
          'the container ships.'),
      findsOneWidget,
    );
    expect(_stored(tester, 'contacts-phone'), '+16465550100');
    expect(_stored(tester, 'contacts-receiver-phone'), '+224620000000');
    // A switch staff turned off stays off; the other stays on.
    expect(_switch(tester, 'contacts-phone-notify').value, isTrue);
    expect(_switch(tester, 'contacts-receiver-phone-notify').value, isFalse);

    // A customer's line keeps a customer: refused at the field, before any
    // round trip (none could be made here - there is no Firebase app).
    await tester.enterText(find.byKey(const Key('contacts-customer')), ' ');
    await tester.tap(find.byKey(const Key('contacts-save')));
    await tester.pumpAndSettle();
    expect(find.text("Enter the customer's name."), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an older local number opens in the destination country form',
      (tester) async {
    // Lines saved before the picker carry local numbers. The picker shows
    // them under the country it starts in and stores the full form, so a
    // save sends a number WhatsApp can reach - and the warning, read after
    // the field settles, does not cry wolf about it.
    await _pump(
      tester,
      containerLineContactsSheetForTesting(
        line: _line({
          'ownerKind': containerOwnerStock,
          'customerName': '',
          'receiverName': 'Agent',
          'receiverPhone': '620000000',
        }),
        receiverCountryCode: 'GN',
      ),
    );
    expect(find.byKey(const Key('contacts-customer')), findsNothing,
        reason: 'stock names no customer');
    expect(find.byKey(const Key('contacts-phone')), findsNothing);
    expect(_stored(tester, 'contacts-receiver-phone'), '+224620000000');
    expect(find.byKey(const Key('contacts-receiver-phone-country-warning')),
        findsNothing);
    expect(_switch(tester, 'contacts-receiver-phone-notify').value, isTrue);
  });

  testWidgets('a shipped line still offers its contacts, and only those',
      (tester) async {
    final line = _line({
      'containerStatus': containerStatusShipped,
      'trackingCode': 'CL-K7M4P2',
      'customerPhone': '622112233',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224620000000',
    });
    await _pump(
      tester,
      containerLineActionsSheetForTesting(line: line, open: false),
    );
    expect(find.byKey(const Key('line-edit-contacts')), findsOneWidget);
    expect(find.byKey(const Key('line-move')), findsNothing);
    expect(find.byKey(const Key('line-remove')), findsNothing);

    // The tile names the code, who hears about it, and whose number cannot
    // be reached.
    expect(find.text('Tracking code CL-K7M4P2'), findsOneWidget);
    expect(find.text('WhatsApp updates to Mariama Bah'), findsOneWidget);
    expect(
      find.text("The customer's phone has no country code, so WhatsApp "
          "updates can't reach it."),
      findsOneWidget,
    );
  });

  testWidgets('a loading line offers contacts beside move and remove',
      (tester) async {
    await _pump(
      tester,
      containerLineActionsSheetForTesting(
        line: _line({'customerPhone': '+16465550100', 'notifyCustomer': false}),
        open: true,
      ),
    );
    expect(find.byKey(const Key('line-edit-contacts')), findsOneWidget);
    expect(find.byKey(const Key('line-move')), findsOneWidget);
    expect(find.byKey(const Key('line-remove')), findsOneWidget);
    // A phone with its switch off: nobody hears, and the tile says so.
    expect(find.text('No WhatsApp updates'), findsOneWidget);
    expect(find.textContaining('Tracking code'), findsNothing,
        reason: 'older lines have no code until the box moves');
  });
}

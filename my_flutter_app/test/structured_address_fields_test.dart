import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/structured_address.dart';
import 'package:my_flutter_app/services/barrel_shipment_service.dart';
import 'package:my_flutter_app/widgets/structured_address_fields.dart';

/// Backlog item 1: the customer's address is separate, editable fields on
/// every surface, the apartment is the customer's own field, and the composed
/// line is still what reaches the pricing and checkout callables.

const _apartmentLabel = 'Apartment, suite, or unit (optional)';
const _cityLabel = 'City';
const _postalLabel = 'ZIP or postal code';

class _Host extends StatefulWidget {
  const _Host({required this.suggestions});

  final List<BarrelAddressSuggestion> suggestions;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  final controller = TextEditingController();
  StructuredAddress address = StructuredAddress.empty;
  BarrelAddressSuggestion? lastSuggestion;

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(
        body: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: StructuredAddressFields(
              controller: controller,
              value: address,
              fetchSuggestions: (_) async => widget.suggestions,
              onChanged: (value, suggestion) {
                setState(() {
                  address = value;
                  if (suggestion != null) lastSuggestion = suggestion;
                });
              },
            ),
          ),
        ),
      ),
    );
  }
}

Finder _field(String label) => find.widgetWithText(TextFormField, label);

_HostState _state(WidgetTester tester) =>
    tester.state<_HostState>(find.byType(_Host));

/// Lets the street box's suggestion debounce fire and resolve, so no timer
/// outlives the test.
Future<void> _drainSuggestionDebounce(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 600));
  await tester.pumpAndSettle();
}

const _suggestion = BarrelAddressSuggestion(
  description: '3184 Webster Ave, Bronx, NY 10467, USA',
  placeId: 'place-1',
  borough: 'Bronx',
  postalCode: '10467',
  streetLine: '3184 Webster Ave',
  // Google autocompletes buildings, not units, so the apartment a suggestion
  // carries is empty in practice - which is exactly why it must not win.
  city: 'Bronx',
  state: 'New York',
  stateCode: 'NY',
  country: 'United States',
);

void main() {
  testWidgets('typed parts compose into the single line the callables take', (
    tester,
  ) async {
    await tester.pumpWidget(const _Host(suggestions: [_suggestion]));

    await tester.enterText(find.byType(TextFormField).first, '3184 Webster Ave');
    await tester.enterText(_field(_apartmentLabel), 'Apt 4B');
    await tester.enterText(_field(_cityLabel), 'Bronx');
    await tester.enterText(_field(_postalLabel), '10467');
    await _drainSuggestionDebounce(tester);

    // State and ZIP are one segment, and the apartment sits right after the
    // street line - identical to functions/address_components.js and
    // admin_web/src/lib/address-fields.ts.
    expect(
      _state(tester).address.composeLine(),
      '3184 Webster Ave, Apt 4B, Bronx, 10467',
    );
  });

  testWidgets('state and country are catalog pickers, not free text', (
    tester,
  ) async {
    // The web console uses catalogs for these. Free text here would let the
    // same customer store "NY" on one device and "New York" on the other.
    await tester.pumpWidget(const _Host(suggestions: [_suggestion]));
    expect(find.byType(DropdownButtonFormField<String>), findsNWidgets(2));

    final source = File(
      'lib/widgets/structured_address_fields.dart',
    ).readAsStringSync();
    // Sourced from the app's own catalogs, not a second hardcoded list.
    expect(source, contains('usStateOptions('));
    expect(source, contains('CountryCatalog.all'));
    // Long names must not overflow the row.
    expect(source, contains('isExpanded: true'));
  });

  testWidgets('a free-typed street line alone still produces a usable line', (
    tester,
  ) async {
    await tester.pumpWidget(const _Host(suggestions: [_suggestion]));

    // Nobody is forced to accept a suggestion: a customer who types the whole
    // address into the street box must still reach checkout.
    await tester.enterText(
      find.byType(TextFormField).first,
      '3184 Webster Ave, Bronx, NY 10467',
    );
    await _drainSuggestionDebounce(tester);

    expect(
      _state(tester).address.composeLine(),
      '3184 Webster Ave, Bronx, NY 10467',
    );
  });

  testWidgets('a suggestion fills the parts and never eats the apartment', (
    tester,
  ) async {
    await tester.pumpWidget(const _Host(suggestions: [_suggestion]));

    await tester.enterText(_field(_apartmentLabel), 'Apt 4B');
    await tester.pump();
    await tester.enterText(find.byType(TextFormField).first, '3184 Webster');
    await _drainSuggestionDebounce(tester);

    await tester.tap(find.text(_suggestion.description).last);
    await _drainSuggestionDebounce(tester);

    final result = _state(tester).address;
    expect(result.streetLine, '3184 Webster Ave');
    expect(result.apartment, 'Apt 4B', reason: 'the typed unit must survive');
    expect(result.city, 'Bronx');
    // The abbreviation is what belongs in the state box.
    expect(result.state, 'NY');
    expect(result.postalCode, '10467');
    expect(result.country, 'United States');
    expect(
      result.composeLine(),
      '3184 Webster Ave, Apt 4B, Bronx, NY 10467, United States',
    );
    // The suggestion travels with the change so a caller can apply the
    // borough in the same state update instead of a second, racing one.
    expect(_state(tester).lastSuggestion?.borough, 'Bronx');
  });

  test('both customer pickup screens use the one shared widget', () {
    for (final path in const [
      'lib/screens/send_barrel_screen.dart',
      'lib/screens/send_freight_screen.dart',
    ]) {
      final source = File(path).readAsStringSync();
      expect(
        source,
        contains("import '../widgets/structured_address_fields.dart';"),
        reason: '$path must reuse the shared address widget',
      );
      expect(
        source,
        contains('StructuredAddressFields('),
        reason: '$path must render the split fields',
      );
      // The composed line, not a raw controller, is what reaches the
      // callables - a screen that sends the street box alone drops the parts.
      expect(
        source.contains('pickupAddress: _pickupAddressController.text'),
        isFalse,
        reason: '$path must send the composed line',
      );
    }
  });
}

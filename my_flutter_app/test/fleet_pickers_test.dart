import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/data/car_catalog.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/barrel_shipment_service.dart';
import 'package:my_flutter_app/services/fleet_pickers.dart';
import 'package:my_flutter_app/widgets/fleet_pickers.dart';

// Made-up data only: the repository is public.

final _catalog = FleetCatalogLookup(
  makes: () => ['Honda', 'Toyota', 'Land Rover'],
  models: (make) => switch (make) {
    'Toyota' => ['Camry', 'RAV4'],
    'Honda' => ['Accord'],
    'Land Rover' => ['Defender'],
    _ => [],
  },
  years: (make, model) => ['2022', '2021', '2020'],
);

Widget _host(Widget child) => MaterialApp(
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

void main() {
  group('known values', () {
    test('folds case and spacing, keeps the first spelling, sorts A-Z', () {
      expect(
        fleetKnownValues(['dala  cars inc', 'Dala Cars Inc', '', 'Acme Fleet']),
        ['Acme Fleet', 'dala cars inc'],
      );
    });
    test('optionsWith adds the current value once', () {
      expect(fleetOptionsWith(['A', 'B'], 'c'), ['c', 'A', 'B']);
      expect(fleetOptionsWith(['A', 'B'], 'a'), ['A', 'B']);
    });
    test('a typed value snaps to the saved spelling', () {
      expect(
        fleetMatchKnown(['Dala Cars Inc'], ' dala  cars inc '),
        'Dala Cars Inc',
      );
      expect(fleetMatchKnown(['Dala Cars Inc'], 'New Co'), 'New Co');
    });
  });

  test('due days', () {
    expect(fleetMonthDays.first, 1);
    expect(fleetMonthDays.last, 28);
    expect(fleetWeekdayNumbers, [1, 2, 3, 4, 5, 6, 7]);
  });

  group('charge label', () {
    test('compose and split round trip', () {
      expect(
        fleetComposeChargeLabel('Ticket', 'T123 · Oct 3'),
        'Ticket · T123 · Oct 3',
      );
      expect(fleetComposeChargeLabel('Toll', ''), 'Toll');
      expect(fleetComposeChargeLabel('', ' Tow '), 'Tow');
      final s = fleetSplitChargeLabel('ticket · T123 · Oct 3');
      expect(s.reason, 'Ticket');
      expect(s.details, 'T123 · Oct 3');
      expect(fleetSplitChargeLabel('Toll').reason, 'Toll');
      expect(fleetSplitChargeLabel('Tow fee').reason, '');
      expect(fleetSplitChargeLabel('Tow fee').details, 'Tow fee');
    });
  });

  test('state code', () {
    expect(fleetStateCode('ny'), 'NY');
    expect(fleetStateCode('New York'), 'NY');
    expect(fleetStateCode(''), '');
    expect(fleetStateCode('Ontario'), 'Ontario');
  });

  group('vehicle line', () {
    test('compose', () {
      expect(
        fleetComposeVehicleType(
          const FleetVehicleParts(make: 'Toyota', model: 'Camry', year: '2021'),
        ),
        'Toyota Camry 2021',
      );
      expect(
        fleetComposeVehicleType(const FleetVehicleParts(make: 'Honda')),
        'Honda',
      );
    });
    test('reads year last, year first, longest make', () {
      expect(
        fleetSplitVehicleType('Toyota Camry 2021', _catalog),
        const FleetVehicleParts(make: 'Toyota', model: 'Camry', year: '2021'),
      );
      expect(
        fleetSplitVehicleType('2020 honda accord', _catalog),
        const FleetVehicleParts(make: 'Honda', model: 'Accord', year: '2020'),
      );
      expect(
        fleetSplitVehicleType('Land Rover Defender', _catalog)?.make,
        'Land Rover',
      );
      expect(fleetSplitVehicleType('Toyota', _catalog)?.model, '');
      expect(fleetSplitVehicleType('', _catalog), const FleetVehicleParts());
    });
    test('unreadable lines are null', () {
      expect(fleetSplitVehicleType('Zoomcar X1', _catalog), isNull);
      expect(fleetSplitVehicleType('Toyota Nothing', _catalog), isNull);
      expect(fleetSplitVehicleType('Toyota Camry 1999', _catalog), isNull);
    });
  });

  group('VIN', () {
    test('clean needs 17 characters', () {
      expect(fleetCleanVin('abc'), '');
      expect(fleetCleanVin('1hgcm82633a004352'), '1HGCM82633A004352');
    });
    String same(String make, String model) => model;
    test('filled, unknown make, unreadable, offline', () {
      final ok = fleetVinResultFrom(
        {'Make': 'TOYOTA', 'Model': 'Camry', 'ModelYear': '2021'},
        _catalog,
        same,
      );
      expect(ok.kind, FleetVinKind.filled);
      expect(ok.parts.make, 'Toyota');
      expect(ok.parts.model, 'Camry');
      expect(ok.parts.year, '2021');
      expect(
        fleetVinResultFrom({'Make': 'Zoom', 'Model': 'X'}, _catalog, same).kind,
        FleetVinKind.unknownMake,
      );
      expect(
        fleetVinResultFrom({}, _catalog, same).kind,
        FleetVinKind.unreadable,
      );
      expect(
        fleetVinResultFrom(null, _catalog, same).kind,
        FleetVinKind.offline,
      );
    });
  });

  group('widgets', () {
    testWidgets('pick or add: pick a saved value, or add a new one', (
      tester,
    ) async {
      var value = '';
      await tester.pumpWidget(
        _host(
          StatefulBuilder(
            builder: (context, set) => FleetPickOrAdd(
              label: 'Insurer',
              value: value,
              known: const ['Acme Cover'],
              addLabel: 'Add a new insurer…',
              onChanged: (v) => set(() => value = v),
            ),
          ),
        ),
      );
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Acme Cover').last);
      await tester.pumpAndSettle();
      expect(value, 'Acme Cover');
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add a new insurer…').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('fleet-pick-add-text')),
        'acme cover',
      );
      await tester.tap(find.byKey(const Key('fleet-pick-back')));
      await tester.pumpAndSettle();
      expect(value, 'Acme Cover'); // snapped to the saved spelling
    });

    testWidgets('due day: weekdays for weekly, 1-28 for monthly', (
      tester,
    ) async {
      int? picked;
      await tester.pumpWidget(
        _host(
          FleetDueDayField(
            label: 'Due weekday',
            value: 1,
            weekly: true,
            onChanged: (d) => picked = d,
          ),
        ),
      );
      await tester.tap(find.byType(DropdownButtonFormField<int>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Friday').last);
      await tester.pumpAndSettle();
      expect(picked, 5);
    });

    testWidgets('address: a suggestion fills street, state, city and zip', (
      tester,
    ) async {
      final line1 = TextEditingController();
      final city = TextEditingController();
      final state = TextEditingController();
      final zip = TextEditingController();
      await tester.pumpWidget(
        _host(
          FleetAddressFields(
            line1: line1,
            city: city,
            state: state,
            zip: zip,
            fetchSuggestions: (q) async => const [
              BarrelAddressSuggestion(
                description: '1 Sample Rd, Albany, NY 12207',
                placeId: 'p1',
                streetLine: '1 Sample Rd',
                city: 'Albany',
                stateCode: 'NY',
                postalCode: '12207',
              ),
            ],
          ),
        ),
      );
      await tester.enterText(
        find.byKey(const Key('fleet-address-street')),
        '1 Sample',
      );
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pumpAndSettle();
      await tester.tap(find.text('1 Sample Rd, Albany, NY 12207'));
      await tester.pumpAndSettle();
      expect(line1.text, '1 Sample Rd');
      expect(state.text, 'NY');
      expect(city.text, 'Albany');
      expect(zip.text, '12207');
    });

    testWidgets('address: Other city reveals a typed city', (tester) async {
      final city = TextEditingController();
      final state = TextEditingController(text: 'dc');
      await tester.pumpWidget(
        _host(
          FleetAddressFields(
            line1: TextEditingController(),
            city: city,
            state: state,
            zip: TextEditingController(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('fleet-address-city-DC-')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Other city').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'City name'),
        'Smallville',
      );
      expect(city.text, 'Smallville');
    });

    testWidgets('car on the plate: an old line is read back, a VIN fills it', (
      tester,
    ) async {
      final vin = TextEditingController();
      var saved = '';
      await tester.runAsync(() => CarCatalog.instance.load());
      final make = CarCatalog.instance.getMakes().first;
      final model = CarCatalog.instance.getModels(make).first;
      final year = CarCatalog.instance.getYears(make, model).first;
      await tester.pumpWidget(
        _host(
          FleetPlateCarFields(
            vinController: vin,
            vehicleType: '$make $model $year',
            onVehicleType: (v) => saved = v,
            decodeVin: (v) async => {
              'Make': make,
              'Model': model,
              'ModelYear': year,
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(make), findsWidgets);
      vin.text = '1ABCD23456E789012';
      await tester.pumpAndSettle();
      expect(saved, '$make $model $year');
      expect(find.text('Filled from the VIN.'), findsOneWidget);
    });

    testWidgets('car on the plate: an unreadable old line shows Saved as', (
      tester,
    ) async {
      await tester.runAsync(() => CarCatalog.instance.load());
      await tester.pumpWidget(
        _host(
          FleetPlateCarFields(
            vinController: TextEditingController(),
            vehicleType: 'Zoomcar X1 2020',
            onVehicleType: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Zoomcar X1 2020'), findsOneWidget);
    });

    testWidgets('charge reason fields name the reason in French', (
      tester,
    ) async {
      final details = TextEditingController();
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('fr'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: FleetChargeReasonFields(
              reason: 'Ticket',
              details: details,
              onReason: (_) {},
            ),
          ),
        ),
      );
      expect(find.text('Amende'), findsOneWidget);
    });
  });
}

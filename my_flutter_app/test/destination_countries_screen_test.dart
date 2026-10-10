import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:provider/provider.dart';
import 'package:my_flutter_app/screens/destination_countries_screen.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

/// Records every callable the screen makes, so no test touches Firebase.
class _Calls {
  final List<(String, Map<String, Object?>)> log = [];

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add((name, payload));
    return null;
  }

  List<Map<String, Object?>> of(String name) => [
    for (final c in log)
      if (c.$1 == name) c.$2,
  ];
}

// A fully set-up active destination, the main one (never served), and an
// empty record the platform's seed action wrote.
const _guinea = DestinationCountry(
  id: 'guinea',
  name: 'Guinea',
  code: 'GN',
  isActive: true,
  barrelShippingAvailable: true,
  barrelShippingPrice: 120,
);
const _senegal = DestinationCountry(
  id: 'senegal',
  name: 'Senegal',
  code: 'SN',
  isMain: true,
);
const _albania = DestinationCountry(id: 'albania', name: 'Albania', code: 'AL');

Future<void> _pump(
  WidgetTester tester,
  List<DestinationCountry> records,
  _Calls calls, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(430, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final language = LanguageProvider()..setLanguage(locale.languageCode);
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: language,
      child: MaterialApp(
        theme: AppTheme.light,
        locale: locale,
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: DestinationCountriesScreen(
          businessId: 'b1',
          records: (_) => Stream.value(records),
          caller: calls.call,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('the list', () {
    testWidgets('hides an empty seeded record, shows the active and the main',
        (tester) async {
      await _pump(tester, [_albania, _guinea, _senegal], _Calls());
      expect(find.text('Guinea'), findsOneWidget);
      expect(find.text('Senegal'), findsOneWidget);
      expect(find.text('Albania'), findsNothing);
      // The count follows the listed ones, not the 3 records held.
      expect(find.text('2 destinations in use'), findsOneWidget);
    });

    testWidgets('search covers only the listed destinations', (tester) async {
      await _pump(tester, [_albania, _guinea, _senegal], _Calls());
      await tester.enterText(find.byType(TextField).first, 'alb');
      await tester.pumpAndSettle();
      expect(find.text('Albania'), findsNothing);
      expect(find.text('No results found'), findsOneWidget);
      await tester.enterText(find.byType(TextField).first, 'sen');
      await tester.pumpAndSettle();
      expect(find.text('Senegal'), findsOneWidget);
      expect(find.text('Guinea'), findsNothing);
    });

    testWidgets('with nothing in use, it leads with Add country', (tester) async {
      await _pump(tester, [_albania], _Calls());
      expect(find.byKey(const Key('dst-listed-count')), findsNothing);
      expect(find.textContaining('You have no destinations yet'), findsOneWidget);
      expect(find.text('Add country'), findsOneWidget);
      // The seed button is still reachable, but the empty state is not
      // telling the business to seed.
      expect(find.byKey(const Key('dst-seed')), findsOneWidget);
      expect(find.textContaining('Seed the full country catalog'), findsNothing);
    });

    testWidgets('renders in French', (tester) async {
      await _pump(tester, [_guinea], _Calls(), locale: const Locale('fr'));
      expect(find.text('1 destination utilisée'), findsOneWidget);
      expect(find.text('Ajouter un pays'), findsOneWidget);
    });
  });

  group('Add country', () {
    testWidgets('offers a country whose record exists but is unused',
        (tester) async {
      await _pump(tester, [_albania, _guinea], _Calls());
      await tester.tap(find.byKey(const Key('dst-add-country')));
      await tester.pumpAndSettle();
      expect(find.text('Add a country'), findsOneWidget);
      // Hidden from the list, offered here.
      expect(find.byKey(const Key('dst-add-albania')), findsOneWidget);
      // Already listed: not offered.
      expect(find.byKey(const Key('dst-add-guinea')), findsNothing);
    });

    testWidgets('offers a country that has no record at all', (tester) async {
      await _pump(tester, [_guinea], _Calls());
      await tester.tap(find.byKey(const Key('dst-add-country')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('dst-add-search')), 'france');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('dst-add-france')), findsOneWidget);
      expect(find.byKey(const Key('dst-add-albania')), findsNothing);
    });
  });

  group('main destination', () {
    testWidgets('the star marks the main one and offers "Make main" on others',
        (tester) async {
      await _pump(tester, [_guinea, _senegal], _Calls());
      expect(
        tester
            .widget<IconButton>(find.byKey(const Key('dst-main-senegal')))
            .isSelected,
        isTrue,
      );
      expect(find.byTooltip('Main destination'), findsOneWidget);
      expect(find.byTooltip('Make main'), findsOneWidget);
    });

    testWidgets('tapping the star calls setMainDestination for that country',
        (tester) async {
      final calls = _Calls();
      await _pump(tester, [_guinea, _senegal], calls);
      await tester.tap(find.byKey(const Key('dst-main-guinea')));
      await tester.pumpAndSettle();
      expect(calls.of('setMainDestination'), [
        {'businessId': 'b1', 'countryId': 'guinea'},
      ]);
      expect(find.text('Main destination saved.'), findsOneWidget);
    });

    testWidgets('tapping the star of the main one clears it', (tester) async {
      final calls = _Calls();
      await _pump(tester, [_guinea, _senegal], calls);
      await tester.tap(find.byKey(const Key('dst-main-senegal')));
      await tester.pumpAndSettle();
      expect(calls.of('setMainDestination'), [
        {'businessId': 'b1', 'countryId': ''},
      ]);
    });
  });

  group('seed the full catalog', () {
    testWidgets('asks first, and only then calls the callable', (tester) async {
      final calls = _Calls();
      await _pump(tester, [_guinea], calls);
      await tester.tap(find.byKey(const Key('dst-seed')));
      await tester.pumpAndSettle();
      expect(find.text('Add every country?'), findsOneWidget);
      expect(find.textContaining('about 250'), findsOneWidget);
      expect(find.textContaining('stay hidden'), findsOneWidget);
      expect(calls.log, isEmpty);

      await tester.tap(find.byKey(const Key('dst-seed-confirm-yes')));
      await tester.pumpAndSettle();
      expect(calls.of('seedDestinationCountries'), hasLength(1));
    });

    testWidgets('cancelling sends nothing', (tester) async {
      final calls = _Calls();
      await _pump(tester, [_guinea], calls);
      await tester.tap(find.byKey(const Key('dst-seed')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('dst-seed-cancel')));
      await tester.pumpAndSettle();
      expect(find.text('Add every country?'), findsNothing);
      expect(calls.log, isEmpty);
    });
  });
}

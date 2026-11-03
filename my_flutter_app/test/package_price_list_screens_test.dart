import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/screens/business_requests_screen.dart';
import 'package:my_flutter_app/screens/package_price_list_screen.dart';
import 'package:my_flutter_app/screens/receive_request_sheet.dart';
import 'package:my_flutter_app/screens/waiting_packages_screen.dart';
import 'package:my_flutter_app/services/business_price_list.dart';
import 'package:my_flutter_app/services/package_coming_today.dart';
import 'package:my_flutter_app/services/package_requests.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

import 'fixtures/fake_package_requests.dart';

/// The business side of price lists as staff meet it: the Price list screen
/// (per country, Sea | Air, items, per-pound rates, departure days, the
/// "Laawol set up your prices" banner, History, read-only for staff), "Coming
/// today" in the Waiting list, and the weight that prices a piece at Received.
/// Firebase is the fake service.

const _guinea = DestinationCountry(
  id: 'guinea',
  name: 'Guinea',
  isActive: true,
);
const _senegal = DestinationCountry(
  id: 'senegal',
  name: 'Senegal',
  isActive: true,
  sortOrder: 1,
);
const _mali = DestinationCountry(
  id: 'mali',
  name: 'Mali',
  isActive: false,
  sortOrder: 2,
);

Stream<List<DestinationCountry>> _countries(String _) =>
    Stream.value(const [_guinea, _senegal, _mali]);

PackagePriceList _list({
  bool needsCheck = false,
  Map<String, dynamic>? routes,
  List<Map<String, dynamic>> history = const [],
}) => PackagePriceList.fromMap({
  'routes':
      routes ??
      {
        'guinea': {
          'sea': {
            'items': [
              {
                'id': 'i_phone',
                'categoryId': 'electronics',
                'label': 'Phone',
                'priceCents': 4000,
                'includedLb': 2,
              },
            ],
            'perLbCents': {'clothing': 600},
            'departure': {
              'weekdays': ['tue', 'fri'],
              'everyWeeks': 1,
              'anchorDate': '',
            },
          },
        },
      },
  'needsCheck': needsCheck,
  'history': history,
});

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  double width = 430,
  bool settle = true,
}) async {
  tester.view.physicalSize = Size(width, 2600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: child,
    ),
  );
  // A spinner never settles: a test that is looking at one pumps by hand.
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

/// A Text whose words read as [expected]. intl puts a narrow no-break space
/// (U+202F) before "AM"/"PM"; people read it as a space, so the test does too
/// instead of pinning an invisible character.
Finder _textReads(String expected) => find.byWidgetPredicate(
  (w) =>
      w is Text &&
      (w.data ?? '').replaceAll(RegExp('[\\u202F\\u00A0]'), ' ') == expected,
  description: 'Text reading "$expected"',
);

Future<void> _tap(WidgetTester tester, Object key) async {
  final finder = find.byKey(key is Key ? key : Key(key as String));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _type(WidgetTester tester, Object key, String text) async {
  final finder = find.byKey(key is Key ? key : Key(key as String));
  await tester.ensureVisible(finder);
  await tester.enterText(finder, text);
  await tester.pumpAndSettle();
}

void main() {
  group('Price list', () {
    Future<FakePackageRequests> open(
      WidgetTester tester, {
      PackagePriceList? list,
      bool canEdit = true,
      Locale locale = const Locale('en'),
      double width = 430,
      Stream<List<DestinationCountry>> Function(String)? countries,
    }) async {
      final fake = FakePackageRequests()..priceList = list ?? _list();
      await _pump(
        tester,
        PackagePriceListScreen(
          businessId: 'b1',
          service: fake,
          canEdit: canEdit,
          countries: countries ?? _countries,
        ),
        locale: locale,
        width: width,
      );
      return fake;
    }

    testWidgets('opens on the first country by sea, with what is stored', (
      tester,
    ) async {
      await open(tester);
      expect(find.text('Price list'), findsOneWidget);
      // Active countries, and one that is not active but holds no route, is
      // left out.
      expect(find.byKey(const ValueKey('ppl-country:guinea')), findsOneWidget);
      expect(find.byKey(const ValueKey('ppl-country:senegal')), findsOneWidget);
      expect(find.byKey(const ValueKey('ppl-country:mali')), findsNothing);
      expect(find.text('Phone'), findsOneWidget);
      expect(find.text(r'$40'), findsOneWidget);
      expect(find.text('Electronics · up to 2 lb each'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('ppl-rate-field:guinea:sea:clothing')),
            )
            .controller!
            .text,
        '6',
      );
      expect(find.byKey(const Key('ppl-save')), findsOneWidget);
      expect(find.byKey(const Key('ppl-unsaved')), findsNothing);
      expect(find.byKey(const Key('ppl-needs-check')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Air and another country are their own lists', (tester) async {
      await open(tester);
      await _tap(tester, const ValueKey('ppl-mode:air'));
      expect(find.text('Phone'), findsNothing);
      expect(find.byKey(const Key('ppl-no-items')), findsOneWidget);
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('ppl-rate-field:guinea:air:clothing')),
            )
            .controller!
            .text,
        '',
      );
      await _tap(tester, const ValueKey('ppl-mode:sea'));
      await _tap(tester, const ValueKey('ppl-country:senegal'));
      expect(find.text('Phone'), findsNothing);
      expect(find.byKey(const Key('ppl-no-items')), findsOneWidget);
    });

    testWidgets('saves the whole list: an item, a rate, departure days', (
      tester,
    ) async {
      final fake = await open(tester, list: PackagePriceList.empty);
      await _tap(tester, 'ppl-add-item');
      await _type(tester, 'ppl-item-name', 'Phone');
      await _tap(tester, 'ppl-item-category');
      await tester.tap(find.text('Electronics').last);
      await tester.pumpAndSettle();
      await _type(tester, 'ppl-item-price', '40');
      await _type(tester, 'ppl-item-covers', '2');
      await _tap(tester, 'ppl-item-done');
      expect(find.text('Phone'), findsOneWidget);
      expect(find.byKey(const Key('ppl-unsaved')), findsOneWidget);
      await _type(
        tester,
        const ValueKey('ppl-rate-field:guinea:sea:clothing'),
        '6,50',
      );
      await _tap(tester, const ValueKey('ppl-day:fri'));
      await _tap(tester, const ValueKey('ppl-day:tue'));
      await _tap(tester, 'ppl-save');
      final body = fake.of('setPackageRequestSettings').single;
      expect(body['action'], 'price_list');
      expect(body['businessId'], 'b1');
      expect(body['routes'], {
        'guinea': {
          'sea': {
            'items': [
              {
                'label': 'Phone',
                'categoryId': 'electronics',
                'priceCents': 4000,
                'includedLb': 2.0,
              },
            ],
            'perLbCents': {'clothing': 650},
            'departure': {
              'weekdays': ['tue', 'fri'],
              'everyWeeks': 1,
              'anchorDate': '',
            },
          },
        },
      });
      expect(find.text('Prices saved.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an item is edited and removed, its id kept', (tester) async {
      final fake = await open(tester);
      await _tap(tester, const ValueKey('ppl-item:0'));
      await _type(tester, 'ppl-item-name', 'Smartphone');
      await _type(tester, 'ppl-item-price', '45.5');
      await _tap(tester, 'ppl-item-done');
      expect(find.text('Smartphone'), findsOneWidget);
      expect(find.text(r'$45.50'), findsOneWidget);
      await _tap(tester, 'ppl-save');
      final items =
          ((fake.of('setPackageRequestSettings').single['routes']
                      as Map)['guinea']
                  as Map)['sea']['items']
              as List;
      expect(items.single['id'], 'i_phone');
      expect(items.single['label'], 'Smartphone');
      expect(items.single['priceCents'], 4550);

      await _tap(tester, const ValueKey('ppl-item:0'));
      await _tap(tester, 'ppl-item-remove');
      expect(find.text('Smartphone'), findsNothing);
      expect(find.byKey(const Key('ppl-no-items')), findsOneWidget);
    });

    testWidgets('an item with no price is refused in the sheet', (
      tester,
    ) async {
      await open(tester, list: PackagePriceList.empty);
      await _tap(tester, 'ppl-add-item');
      await _type(tester, 'ppl-item-name', 'Phone');
      await _tap(tester, 'ppl-item-done');
      expect(
        find.text(r'Enter a price between $0.01 and $10,000.'),
        findsOneWidget,
      );
      // The sheet stays open to fix it.
      expect(find.byKey(const Key('ppl-item-name')), findsOneWidget);
    });

    testWidgets('a problem found here is said, and nothing is sent', (
      tester,
    ) async {
      final fake = await open(tester, list: PackagePriceList.empty);
      for (var i = 0; i < 2; i++) {
        await _tap(tester, 'ppl-add-item');
        await _type(tester, 'ppl-item-name', 'Phone');
        await _type(tester, 'ppl-item-price', '${40 + i}');
        await _tap(tester, 'ppl-item-done');
      }
      await _tap(tester, 'ppl-save');
      expect(find.text('Two items have the same name.'), findsOneWidget);
      expect(fake.of('setPackageRequestSettings'), isEmpty);
    });

    testWidgets('every few weeks needs a day to count from', (tester) async {
      final fake = await open(tester, list: PackagePriceList.empty);
      await _tap(tester, const ValueKey('ppl-day:tue'));
      expect(find.byKey(const Key('ppl-anchor')), findsNothing);
      await _tap(tester, 'ppl-weeks-more');
      expect(find.text('Every 2 weeks'), findsOneWidget);
      expect(find.byKey(const Key('ppl-anchor')), findsOneWidget);
      await _tap(tester, 'ppl-save');
      expect(
        find.text('Pick the days it leaves, and how many weeks apart.'),
        findsOneWidget,
      );
      expect(fake.of('setPackageRequestSettings'), isEmpty);
      await _tap(tester, 'ppl-weeks-less');
      expect(find.text('Every week'), findsOneWidget);
      await _tap(tester, 'ppl-save');
      expect(fake.of('setPackageRequestSettings'), hasLength(1));
    });

    testWidgets('a refusal from the server is said in words, per code', (
      tester,
    ) async {
      final fake = await open(tester);
      fake.refuse['setPackageRequestSettings'] = FakePackageRequests.failure(
        'invalid-argument',
        {
          'reason': 'country_unknown',
          'reasons': ['country_unknown'],
        },
      );
      await _type(
        tester,
        const ValueKey('ppl-rate-field:guinea:sea:clothing'),
        '7',
      );
      await _tap(tester, 'ppl-save');
      expect(find.text('That country is not one you ship to.'), findsOneWidget);
      // The typing is still there to fix.
      expect(find.byKey(const Key('ppl-unsaved')), findsOneWidget);
    });

    testWidgets('every refusal code has words in both languages', (
      tester,
    ) async {
      await open(tester);
      final context = tester.element(find.byKey(const Key('price-list')));
      final en = AppLocalizations.of(context)!;
      final fr = await AppLocalizations.delegate.load(const Locale('fr'));
      for (final code in priceListReasonCodes) {
        final english = priceListReasonText(en, code);
        final french = priceListReasonText(fr, code);
        expect(english, isNotNull, reason: '$code has no English');
        expect(french, isNotNull, reason: '$code has no French');
        expect(french, isNot(english), reason: '$code is not translated');
      }
    });

    testWidgets('a list Laawol set up asks to be checked until Looks right', (
      tester,
    ) async {
      final fake = await open(tester, list: _list(needsCheck: true));
      expect(
        find.text('Laawol set up your prices - please check them.'),
        findsOneWidget,
      );
      await _tap(tester, 'ppl-looks-right');
      final body = fake.of('setPackageRequestSettings').single;
      expect(body, {'action': 'price_list_checked', 'businessId': 'b1'});
      expect(find.byKey(const Key('ppl-needs-check')), findsNothing);
      expect(
        find.text('Thanks. Your price list is marked as checked.'),
        findsOneWidget,
      );
    });

    testWidgets('a business that already checked sees no banner', (
      tester,
    ) async {
      await open(tester, list: _list());
      expect(find.byKey(const Key('ppl-needs-check')), findsNothing);
    });

    testWidgets('a newer list from the server shows while nothing is typed', (
      tester,
    ) async {
      final fake = await open(tester);
      fake.priceLists.add(
        _list(
          needsCheck: true,
          routes: {
            'guinea': {
              'sea': {
                'items': [
                  {
                    'id': 'i_tv',
                    'categoryId': 'fragile',
                    'label': 'TV',
                    'priceCents': 12000,
                    'includedLb': 0,
                  },
                ],
              },
            },
          },
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('TV'), findsOneWidget);
      expect(find.text('Phone'), findsNothing);
      expect(find.byKey(const Key('ppl-needs-check')), findsOneWidget);
    });

    testWidgets('typing is kept when the list changes under it', (
      tester,
    ) async {
      final fake = await open(tester);
      await _type(
        tester,
        const ValueKey('ppl-rate-field:guinea:sea:clothing'),
        '9',
      );
      fake.priceLists.add(_list(needsCheck: true));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('ppl-needs-check')), findsOneWidget);
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('ppl-rate-field:guinea:sea:clothing')),
            )
            .controller!
            .text,
        '9',
      );
    });

    testWidgets('staff read the list and cannot change or save it', (
      tester,
    ) async {
      final fake = await open(
        tester,
        canEdit: false,
        list: _list(needsCheck: true),
      );
      expect(find.byKey(const Key('ppl-read-only')), findsOneWidget);
      expect(find.text('Phone'), findsOneWidget);
      expect(find.byKey(const Key('ppl-save')), findsNothing);
      expect(find.byKey(const Key('ppl-add-item')), findsNothing);
      // Staff never tap Looks right either: it is the owner's word.
      expect(find.byKey(const Key('ppl-looks-right')), findsNothing);
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('ppl-rate-field:guinea:sea:clothing')),
            )
            .enabled,
        isFalse,
      );
      expect(
        tester
            .widget<FilterChip>(find.byKey(const ValueKey('ppl-day:mon')))
            .onSelected,
        isNull,
      );
      await tester.tap(find.text('Phone'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('ppl-item-name')), findsNothing);
      expect(fake.of('setPackageRequestSettings'), isEmpty);
    });

    testWidgets('History lists every save and check, newest first', (
      tester,
    ) async {
      await open(
        tester,
        list: _list(
          history: [
            {
              'atMs': DateTime(2026, 11, 3, 14, 5).millisecondsSinceEpoch,
              'byName': 'Laawol Admin',
              'byLaawol': true,
              'action': 'saved',
              'countries': ['guinea', 'senegal'],
            },
            {
              'atMs': DateTime(2026, 11, 4, 9, 30).millisecondsSinceEpoch,
              'byName': 'Awa',
              'action': 'checked',
              'countries': [],
            },
          ],
        ),
      );
      final first = find.byKey(const ValueKey('ppl-history:0'));
      await tester.ensureVisible(first);
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: first,
          matching: find.text('Marked as checked by Awa'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: first, matching: _textReads('Nov 4, 2026 9:30 AM')),
        findsOneWidget,
      );
      final second = find.byKey(const ValueKey('ppl-history:1'));
      expect(
        find.descendant(
          of: second,
          matching: find.text('Saved by Laawol Admin (Laawol)'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: second,
          matching: _textReads('Nov 3, 2026 2:05 PM · Changed: Guinea, Senegal'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('a business with no history says so', (tester) async {
      await open(tester);
      await tester.ensureVisible(find.byKey(const Key('ppl-history-empty')));
      expect(find.text('No changes yet'), findsOneWidget);
    });

    testWidgets('no destination countries says so', (tester) async {
      await open(
        tester,
        countries: (_) => Stream.value(const <DestinationCountry>[]),
      );
      expect(find.byKey(const Key('ppl-no-countries')), findsOneWidget);
      expect(find.byKey(const Key('ppl-save')), findsNothing);
    });

    testWidgets('a load that fails offers Retry and resolves', (tester) async {
      final fake = FakePackageRequests();
      final failing = StreamController<List<DestinationCountry>>();
      await _pump(
        tester,
        PackagePriceListScreen(
          businessId: 'b1',
          service: fake,
          canEdit: true,
          countries: (_) => failing.stream,
        ),
        settle: false,
      );
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      failing.addError('offline');
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('request-load-failed')), findsOneWidget);
      expect(find.text('Could not load the price list.'), findsOneWidget);
      await failing.close();
    });

    testWidgets('a load that never answers ends in Retry, not a spinner', (
      tester,
    ) async {
      final fake = FakePackageRequests();
      await _pump(
        tester,
        PackagePriceListScreen(
          businessId: 'b1',
          service: fake,
          canEdit: true,
          countries: (_) => StreamController<List<DestinationCountry>>().stream,
        ),
      );
      await tester.pump(const Duration(seconds: 21));
      expect(find.byKey(const Key('request-load-failed')), findsOneWidget);
    });

    testWidgets('fits a narrow French phone', (tester) async {
      await open(
        tester,
        list: _list(needsCheck: true),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text('Liste de prix'), findsOneWidget);
      expect(
        find.text('Laawol a préparé vos prix - veuillez les vérifier.'),
        findsOneWidget,
      );
      expect(find.text("C'est bon"), findsOneWidget);
      expect(find.text('Électronique · jusqu\'à 2 lb chacun'), findsOneWidget);
      expect(find.text('Prix par livre'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('ppl-save')));
      expect(find.text('Enregistrer les prix'), findsOneWidget);
      expect(tester.takeException(), isNull);
      // The longest "repeat" wording still fits between its two buttons.
      for (var i = 0; i < 7; i++) {
        await _tap(tester, 'ppl-weeks-more');
      }
      expect(find.text('Toutes les 8 semaines'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _tap(tester, 'ppl-add-item');
      expect(find.text('Nouvel article'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('the way in', () {
    testWidgets('Requests opens the price list for its owner', (tester) async {
      final fake = FakePackageRequests()
        ..initialOpen = const []
        ..priceList = _list();
      await _pump(
        tester,
        BusinessRequestsScreen(
          businessId: 'b1',
          service: fake,
          canManageSettings: true,
          priceListCountries: _countries,
        ),
      );
      await tester.tap(find.byKey(const Key('requests-price-list')));
      await tester.pumpAndSettle();
      expect(find.byType(PackagePriceListScreen), findsOneWidget);
      final screen = tester.widget<PackagePriceListScreen>(
        find.byType(PackagePriceListScreen),
      );
      expect(screen.canEdit, isTrue);
      expect(screen.businessId, 'b1');
      // What the owner meets is the real list, editable.
      expect(find.text('Phone'), findsOneWidget);
      expect(find.byKey(const Key('ppl-save')), findsOneWidget);
    });

    testWidgets('and read-only for staff', (tester) async {
      final fake = FakePackageRequests()
        ..initialOpen = const []
        ..priceList = _list();
      await _pump(
        tester,
        BusinessRequestsScreen(
          businessId: 'b1',
          service: fake,
          canManageSettings: false,
          priceListCountries: _countries,
        ),
      );
      await tester.tap(find.byKey(const Key('requests-price-list')));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<PackagePriceListScreen>(find.byType(PackagePriceListScreen))
            .canEdit,
        isFalse,
      );
      // Staff read the same list but cannot save or add to it.
      expect(find.text('Phone'), findsOneWidget);
      expect(find.byKey(const Key('ppl-save')), findsNothing);
      expect(find.byKey(const Key('ppl-add-item')), findsNothing);
    });
  });

  group('Coming today', () {
    // Tuesday, Nov 3, 2026, noon in New York.
    final now = DateTime.utc(2026, 11, 3, 17);

    PackageRequest req(String id, Map<String, dynamic> extra) =>
        PackageRequest.fromMap(id, {
          'businessId': 'b1',
          'code': 'R-${id.toUpperCase()}AAAA',
          'status': 'confirmed',
          'handoff': 'bring_in',
          'location': {'id': 'loc1', 'label': 'Bronx shop'},
          'plannedDate': '2026-11-03',
          'sender': {'name': 'Fatou $id', 'phoneE164': '+19175551234'},
          'receiver': {'name': 'Mariama Bah'},
          'destinationCountryName': 'Guinea',
          'pieces': [
            {'id': 'p1', 'kind': 'barrel', 'estimateCents': 12000},
          ],
          ...extra,
        });

    Widget list(List<PackageRequest> expected) {
      final coming = comingTodayRequests(expected, now);
      return Scaffold(
        body: WaitingPackagesList(
          lines: const [],
          staff: const [],
          anyAtAll: false,
          searching: false,
          onTap: null,
          onPrint: null,
          comingToday: coming,
          expected: expectedExcept(expected, coming),
          onReceived: (_) {},
        ),
      );
    }

    final requests = [
      req('late', {
        'plannedWindow': {'from': '16:00', 'to': '18:00'},
      }),
      req('early', {
        'plannedWindow': {'from': '14:00', 'to': '16:00'},
      }),
      req('later', {
        'plannedDate': '2026-11-05',
        'plannedWindow': {'from': '10:00', 'to': '12:00'},
      }),
    ];

    testWidgets('sits above Expected, soonest window first, 12-hour', (
      tester,
    ) async {
      await _pump(tester, list(requests));
      expect(find.text('Coming today · 2'), findsOneWidget);
      expect(find.text('Expected · 1'), findsOneWidget);
      final early = tester.getTopLeft(
        find.byKey(const ValueKey('expected:early')),
      );
      final late = tester.getTopLeft(
        find.byKey(const ValueKey('expected:late')),
      );
      final later = tester.getTopLeft(
        find.byKey(const ValueKey('expected:later')),
      );
      expect(early.dy, lessThan(late.dy));
      expect(late.dy, lessThan(later.dy));
      expect(
        find.text('Planned Tue, Nov 3 · 2:00 PM–4:00 PM · Bronx shop'),
        findsOneWidget,
      );
      expect(
        find.text('Planned Tue, Nov 3 · 4:00 PM–6:00 PM · Bronx shop'),
        findsOneWidget,
      );
      // A later day keeps its window too, but is not "today".
      expect(
        find.text('Planned Thu, Nov 5 · 10:00 AM–12:00 PM · Bronx shop'),
        findsOneWidget,
      );
    });

    testWidgets('a card is in one section only', (tester) async {
      await _pump(tester, list(requests));
      expect(find.byKey(const ValueKey('expected:early')), findsOneWidget);
      expect(find.byKey(const ValueKey('expected:later')), findsOneWidget);
    });

    testWidgets('nothing today leaves Expected as it was', (tester) async {
      await _pump(tester, list([requests.last]));
      expect(find.textContaining('Coming today'), findsNothing);
      expect(find.text('Expected · 1'), findsOneWidget);
    });

    testWidgets('only today: no empty Expected heading', (tester) async {
      await _pump(tester, list([requests.first]));
      expect(find.text('Coming today · 1'), findsOneWidget);
      expect(find.textContaining('Expected'), findsNothing);
      expect(find.text('In the shop · 0'), findsOneWidget);
    });

    testWidgets('a request with no window still comes today', (tester) async {
      await _pump(tester, list([req('nowin', const {})]));
      expect(find.text('Coming today · 1'), findsOneWidget);
      expect(find.text('Planned Tue, Nov 3 · Bronx shop'), findsOneWidget);
    });

    testWidgets('French on a narrow phone: 14 h–16 h', (tester) async {
      await _pump(
        tester,
        list(requests),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text("Attendus aujourd'hui · 2"), findsOneWidget);
      expect(find.textContaining('14 h–16 h'), findsOneWidget);
      expect(find.textContaining('16 h–18 h'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the Requests card says the window it was asked for', (
      tester,
    ) async {
      final fake = FakePackageRequests()
        ..initialOpen = [
          PackageRequest.fromMap('a', {
            'businessId': 'b1',
            'status': 'new',
            'handoff': 'bring_in',
            'plannedDate': '2026-11-03',
            'plannedWindow': {'from': '14:00', 'to': '16:00'},
            'sender': {'name': 'Fatou Diallo'},
            'pieces': [
              {'id': 'p1', 'kind': 'barrel'},
            ],
          }),
        ];
      await _pump(
        tester,
        BusinessRequestsScreen(
          businessId: 'b1',
          service: fake,
          canManageSettings: true,
        ),
      );
      expect(
        find.textContaining('Tue, Nov 3 · 2:00 PM–4:00 PM'),
        findsOneWidget,
      );
    });
  });

  group('Received, priced by weight', () {
    PackageRequest request({String shipMode = 'sea'}) =>
        PackageRequest.fromMap('r1', {
          'businessId': 'b1',
          'code': 'R-R1AAAA',
          'status': 'confirmed',
          'handoff': 'bring_in',
          'shipMode': shipMode,
          'plannedDate': '2026-11-03',
          'sender': {'name': 'Fatou Diallo', 'phoneE164': '+19175551234'},
          'receiver': {'name': 'Mariama Bah'},
          'destinationCountryName': 'Guinea',
          'pieces': [
            {
              'id': 'p1',
              'kind': 'other',
              'description': '2 × Phone',
              'estimateCents': 8000,
              'price': {
                'source': 'item',
                'itemId': 'i_phone',
                'label': 'Phone',
                'categoryId': 'electronics',
                'quantity': 2,
                'unitCents': 4000,
                'includedLb': 2,
                'excessPerLbCents': 450,
                'perLbCents': null,
                'weightLb': null,
              },
            },
            {
              'id': 'p2',
              'kind': 'other',
              'description': 'Clothes and fabric · 10 lb',
              'estimateCents': 6000,
              'price': {
                'source': 'per_lb',
                'itemId': '',
                'label': 'Clothes and fabric',
                'categoryId': 'clothing',
                'quantity': 1,
                'unitCents': null,
                'includedLb': 0,
                'excessPerLbCents': null,
                'perLbCents': 600,
                'weightLb': 10,
              },
            },
            {
              'id': 'p3',
              'kind': 'barrel',
              'estimateCents': 12000,
              'price': {
                'source': 'barrel',
                'label': 'Barrel',
                'quantity': 1,
                'unitCents': 12000,
              },
            },
            {'id': 'p4', 'kind': 'other', 'description': 'Old thing', 'estimateCents': 1000},
          ],
        });

    Future<FakePackageRequests> open(
      WidgetTester tester,
      PackageRequest r, {
      bool shipsByAir = false,
      Locale locale = const Locale('en'),
      double width = 430,
    }) async {
      final fake = FakePackageRequests();
      await _pump(
        tester,
        Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              key: const Key('open-receive'),
              onPressed: () => showReceiveRequestSheet(
                context,
                businessId: 'b1',
                request: r,
                service: fake,
                shipsByAir: shipsByAir,
              ),
              child: const Text('open'),
            ),
          ),
        ),
        locale: locale,
        width: width,
      );
      await _tap(tester, 'open-receive');
      return fake;
    }

    String priceOf(WidgetTester tester, int i) => tester
        .widget<TextField>(find.byKey(Key('piece-price-$i')))
        .controller!
        .text;

    testWidgets('only pieces the scale decides ask for a weight', (
      tester,
    ) async {
      await open(tester, request());
      expect(find.byKey(const Key('piece-weight-0')), findsOneWidget);
      expect(find.byKey(const Key('piece-weight-1')), findsOneWidget);
      expect(find.byKey(const Key('piece-weight-2')), findsNothing);
      expect(find.byKey(const Key('piece-weight-3')), findsNothing);
      expect(find.text('Weight (lb)'), findsNWidgets(2));
      // Prices open on the estimate; a by-the-pound piece opens on the
      // customer's pounds, an item on none.
      expect(priceOf(tester, 0), '80');
      expect(priceOf(tester, 1), '60');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('piece-weight-0')))
            .controller!
            .text,
        '',
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('piece-weight-1')))
            .controller!
            .text,
        '10',
      );
    });

    testWidgets('a weight sets the price from the list, and stays editable', (
      tester,
    ) async {
      final fake = await open(tester, request());
      // Per pound: 12.5 lb at $6 is $75.
      await _type(tester, 'piece-weight-1', '12.5');
      expect(priceOf(tester, 1), '75');
      // Two phones cover 4 lb: 3 lb is still the fixed $80.
      await _type(tester, 'piece-weight-0', '3');
      expect(priceOf(tester, 0), '80');
      // 5 lb is 1 lb over: $80 + $4.50.
      await _type(tester, 'piece-weight-0', '5');
      expect(priceOf(tester, 0), '84.50');
      expect(
        tester.widget<Text>(find.byKey(const Key('pieces-total-amount'))).data,
        r'$289.50',
      );
      // Staff can still change it.
      await _type(tester, 'piece-price-0', '90');
      expect(priceOf(tester, 0), '90');
      await _tap(tester, 'receive-save');
      final pieces = fake.of('receivePackageRequest').single['pieces'] as List;
      expect(
        [for (final p in pieces) (p as Map)['priceCents']],
        [9000, 7500, 12000, 1000],
      );
    });

    testWidgets('a weight that is not a number leaves the price alone', (
      tester,
    ) async {
      await open(tester, request());
      await _type(tester, 'piece-weight-1', '0');
      expect(priceOf(tester, 1), '60');
      await _type(tester, 'piece-weight-1', '.');
      expect(priceOf(tester, 1), '60');
    });

    testWidgets('the weight sits in the piece it belongs to when one goes', (
      tester,
    ) async {
      await open(tester, request());
      await _tap(tester, 'piece-remove-0');
      // The by-the-pound piece is first now, still on its own pounds.
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('piece-weight-0')))
            .controller!
            .text,
        '10',
      );
      expect(find.byKey(const Key('piece-weight-1')), findsNothing);
    });

    testWidgets('Ships by opens on what the customer chose', (tester) async {
      final fake = await open(tester, request(shipMode: 'air'));
      // Even a business that has not ticked "ships by air" is asked, since
      // the customer asked for Air.
      expect(find.byKey(const Key('ship-mode-choice')), findsOneWidget);
      expect(find.byKey(const Key('proof-weight')), findsOneWidget);
      await _type(tester, 'proof-weight', '12');
      await _tap(tester, 'receive-save');
      expect(fake.of('receivePackageRequest').single['shipMode'], 'air');
    });

    testWidgets('a sea request on a business that ships by air opens on Sea', (
      tester,
    ) async {
      final fake = await open(tester, request(), shipsByAir: true);
      expect(find.byKey(const Key('ship-mode-choice')), findsOneWidget);
      expect(find.byKey(const Key('proof-weight')), findsNothing);
      await _tap(tester, 'receive-save');
      expect(fake.of('receivePackageRequest').single['shipMode'], 'sea');
    });

    testWidgets('a sea request on a sea-only business sends no mode', (
      tester,
    ) async {
      final fake = await open(tester, request());
      expect(find.byKey(const Key('ship-mode-choice')), findsNothing);
      await _tap(tester, 'receive-save');
      expect(
        fake.of('receivePackageRequest').single.containsKey('shipMode'),
        isFalse,
      );
    });

    testWidgets('fits a narrow French phone', (tester) async {
      await open(tester, request(), locale: const Locale('fr'), width: 320);
      expect(find.text('Poids (lb)'), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    });
  });
}

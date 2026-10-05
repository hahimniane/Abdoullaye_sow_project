import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Source contracts for the data-scaling audit. These screens sit behind a
/// signed-in business with live Firestore streams, so - the way the other
/// parity tests here do - the rules are asserted on the source:
///
///  - no whole-history listener on a business's record collections: every
///    such read goes through a scoped, bounded spec in
///    `lib/services/business_activity_queries.dart` (whose shapes and
///    indexes `firestore_query_scope_test.dart` checks);
///  - no `limit` without an `orderBy`;
///  - no stream or listener built inside `build` in the widgets that used to
///    rebuild theirs on every keystroke or tab tap.
void main() {
  String read(String path) => File(path).readAsStringSync();

  /// The bodies of every `Widget build(BuildContext context) {...}` in
  /// [source], found by brace matching.
  List<String> buildBodies(String source) {
    final bodies = <String>[];
    const marker = 'Widget build(BuildContext context) {';
    var from = 0;
    while (true) {
      final at = source.indexOf(marker, from);
      if (at < 0) break;
      var depth = 0;
      var i = at + marker.length - 1;
      for (; i < source.length; i++) {
        final ch = source[i];
        if (ch == '{') depth++;
        if (ch == '}') {
          depth--;
          if (depth == 0) break;
        }
      }
      bodies.add(source.substring(at, i + 1));
      from = i;
    }
    return bodies;
  }

  const recordCollections = [
    'parkedCars',
    'barrelShipments',
    'freightShipments',
    'transportRequests',
    'transportOpportunities',
    'lotActivities',
    'lotExpenseEntries',
    'cars',
  ];

  const scaledScreens = [
    'lib/screens/home_menu.dart',
    'lib/screens/invoices_screen.dart',
    'lib/screens/parking_month_end_screen.dart',
    'lib/screens/lot_ledger_screen.dart',
    'lib/screens/containers_screen.dart',
    'lib/screens/sell_cars_screen.dart',
  ];

  group('no whole-history listeners on business records', () {
    for (final path in scaledScreens) {
      test('$path reads its records through scoped specs', () {
        final source = read(path);
        for (final collection in recordCollections) {
          expect(
            RegExp("(collection|scoped)\\(\\s*'$collection'\\s*\\)")
                .hasMatch(source),
            isFalse,
            reason: '$path opens $collection directly; use a spec from '
                'business_activity_queries.dart (business-scoped and bounded)',
          );
        }
      });

      test('$path never limits without ordering', () {
        final source = read(path);
        for (final match in RegExp(r'\.limit\(').allMatches(source)) {
          // The query chain the limit closes: back to the statement start.
          final start = source.lastIndexOf(';', match.start);
          final chain = source.substring(start < 0 ? 0 : start, match.start);
          expect(
            chain.contains('.orderBy('),
            isTrue,
            reason: '$path: a limit without an orderBy reads an arbitrary '
                'subset: ...${chain.substring(chain.length > 120 ? chain.length - 120 : 0)}',
          );
        }
      });
    }

    test('the admin home is confined to the business being viewed', () {
      final home = read('lib/screens/home_menu.dart');
      // The old scope() returned the whole platform for an admin.
      expect(home, isNot(contains('if (auth.isAdmin) return collection')));
      expect(home, isNot(contains('auth.isAdmin\n          ? freightCollection')));
      expect(home, contains("_businessId = (auth.businessId ?? '').trim();"));
      expect(home, contains('final hasBusiness = businessId.isNotEmpty;'));
    });

    test('the home lists open work live and history on request', () {
      final home = read('lib/screens/home_menu.dart');
      expect(home, contains('businessHistoryPageSpec('));
      expect(home, contains('.startAfterDocument(pager.docs.last)'));
      expect(home, contains("Key('activity-load-history')"));
      expect(home, contains('l10n.activityShowHistory'));
      expect(home, contains('l10n.activityLoadMoreHistory'));
      // The spinner always resolves.
      expect(home, contains('_loadingSafety = Timer('));
    });

    test('the month end reads the month, as the server job does', () {
      final screen = read('lib/screens/parking_month_end_screen.dart');
      for (final spec in [
        'parkedCarsEndingFromSpec(id, startMs)',
        'lotActivitiesBetweenSpec(',
        'lotActivitiesUnsettledSpec(id)',
        'lotActivitiesUndatedSpec(id)',
      ]) {
        expect(screen, contains(spec));
      }
      expect(screen, contains('_showMonth('));
      expect(screen, contains('_loadingSafety = Timer('));
    });

    test('invoices keep a VIN memory, not every car and job', () {
      final screen = read('lib/screens/invoices_screen.dart');
      expect(screen, contains('KnownCarLookup.forBusiness('));
      expect(screen, contains('.findExact(vin)'));
    });

    test('a container detail shares the list screen feed', () {
      final screen = read('lib/screens/containers_screen.dart');
      expect(screen, contains('class ContainerFeed extends ChangeNotifier'));
      expect(screen, contains('feed: _feed,'));
      expect(
        screen,
        contains('widget.feed ?? (_ownFeed = ContainerFeed(widget.businessId))'),
      );
      // One containers listener and one lines listener in the whole file.
      expect("scoped('containers')".allMatches(screen).length, 1);
      expect("scoped('containerLines')".allMatches(screen).length, 1);
    });

    test('the marketplace pages instead of reading every listing', () {
      final screen = read('lib/screens/sell_cars_screen.dart');
      expect(screen, contains('marketplaceCarsSpec('));
      expect(screen, contains("Key('marketplace-load-more')"));
      expect(screen, contains('l10n.marketplaceLoadMoreCars'));
    });
  });

  group('no streams built inside build', () {
    final widgets = <String, List<String>>{
      'lib/screens/staff_home_screen.dart': ['.snapshots()'],
      'lib/screens/staff_car_management_screen.dart': ['.snapshots()'],
      'lib/screens/staff_purchase_management_screen.dart': ['.snapshots()'],
      'lib/widgets/customer_notification_bell.dart': ['.snapshots()'],
      'lib/widgets/destination_country_field.dart': ['activeCountries()'],
      'lib/screens/send_barrel_screen.dart': ['optionsForCountry('],
      'lib/screens/sell_cars_screen.dart': [
        'favoriteIdsStream()',
        'activeViewingReservationsForUser(',
        '.snapshots()',
      ],
    };
    widgets.forEach((path, factories) {
      test(path, () {
        for (final body in buildBodies(read(path))) {
          for (final factory in factories) {
            expect(
              body.contains(factory),
              isFalse,
              reason: '$path builds a stream with $factory inside build; '
                  'hold it in State and rebuild it only when its inputs change',
            );
          }
        }
      });
    });

    test('the destination catalog is one shared upstream', () {
      final service = read('lib/services/business_service.dart');
      expect(service, contains('SharedLatestStream<List<BusinessDestinationOption>>('));
      expect(service, contains('_sharedDestinationOptions.putIfAbsent('));
    });

    test('staff tabs are kept alive and the business stream made once', () {
      final shell = read('lib/screens/staff_home_screen.dart');
      expect(shell, contains('LazyIndexedStack('));
      expect(shell, contains('key: ValueKey<String>(tab.id)'));
      expect(shell, isNot(contains('Expanded(child: screens[currentIndex])')));
      expect(shell, contains('_businessStreamFor(businessId)'));
    });

    test('the app shell rebuilds for the locale, not for every auth change', () {
      final main = read('lib/main.dart');
      expect(main, isNot(contains('Consumer2<LanguageProvider, AuthProvider>')));
      expect(main, contains('Consumer<LanguageProvider>('));
    });
  });

  group('long lists are built lazily', () {
    test('the business home feed is a sliver list, filtered once per change', () {
      final home = read('lib/screens/home_menu.dart');
      expect(home, contains('SliverList.builder('));
      expect(home, isNot(contains('...records.map((record)')));
      expect(home, contains('if (key == _filteredKey) return _filteredCache;'));
      expect(home, contains('if (key == _tilesKey) return _tilesCache;'));
      // build reads the filtered list once and hands it on.
      final build = buildBodies(home).firstWhere(
        (body) => body.contains('CustomScrollView('),
      );
      expect('_filteredRecords'.allMatches(build).length, 1);
      expect('_overviewTiles()'.allMatches(build).length, 1);
    });

    test('the ledger activity list builds rows on demand', () {
      final ledger = read('lib/screens/lot_ledger_screen.dart');
      expect(ledger, contains('itemCount: header.length + listed.length'));
      expect(ledger, isNot(contains('for (final row in rows)\n                _ActivityCard(')));
    });
  });

  group('marketplace photos', () {
    test('are downscaled before upload', () {
      final listings = read('lib/screens/staff_car_management_screen.dart');
      expect(listings, contains('pickMultiImage(\n        maxWidth: listingPhotoMaxDimension,'));
      expect(listings, contains('imageQuality: listingPhotoQuality'));
    });

    test('are decoded at the size they are shown', () {
      for (final path in [
        'lib/screens/sell_cars_screen.dart',
        'lib/screens/favorite_cars_screen.dart',
        'lib/screens/car_details_screen.dart',
        'lib/screens/staff_car_management_screen.dart',
      ]) {
        final source = read(path);
        expect(source, contains('ListingNetworkImage('), reason: path);
        expect(source, isNot(contains('Image.network(')), reason: path);
      }
    });
  });
}

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_service_overview.dart';
import 'package:my_flutter_app/utils/business_permissions.dart';

/// "Why is [Record a parked car] under recent activities... people should have
/// easy access to all of the services right in the homescreen."
///
/// The screen answered that with a grid, and a grid is only worth the space if
/// every tile is a service the business actually offers and every number means
/// something operationally. Both of those are decisions, so both live outside
/// the widget: `AuthProvider` builds Firebase in its field initialisers and
/// cannot be constructed in a widget test.

/// A permission predicate for a member of staff scoped to [granted]. An owner
/// is `owner()` below - not staff, so every permission is theirs.
bool Function(String) staff(List<String> granted) =>
    (permission) => canAccessBusinessPermission(
      isStaff: true,
      permissions: granted,
      permission: permission,
    );

bool Function(String) owner() =>
    (permission) => canAccessBusinessPermission(
      isStaff: false,
      permissions: const <String>[],
      permission: permission,
    );

/// A business-entered parked car. Only these carry a payment the lot is owed;
/// a customer's own booking is the marketplace's business, not the lot's.
Map<String, dynamic> car({
  String source = 'business',
  String paymentStatus = 'awaiting_direct_payment',
  String status = 'active',
}) => <String, dynamic>{
  'source': source,
  'paymentMethod': 'direct',
  'paymentStatus': paymentStatus,
  'status': status,
};

List<BusinessServiceTile> tilesFor({
  required List<String> services,
  required bool Function(String) hasPermission,
  List<Map<String, dynamic>> parkedCars = const [],
  List<String> barrels = const [],
  List<String> freight = const [],
  List<String> transport = const [],
}) => businessServiceOverviewTiles(
  services: services,
  hasPermission: hasPermission,
  parkedCarFields: parkedCars,
  barrelStatuses: barrels,
  freightStatuses: freight,
  transportStatuses: transport,
);

void main() {
  group('which tiles a business sees', () {
    test('a lot that only parks cars sees one tile, not four', () {
      final tiles = tilesFor(
        services: const ['carParking'],
        hasPermission: owner(),
      );
      expect(tiles.map((tile) => tile.category), [ServiceCategory.parking]);
    });

    test('a service the business does not offer never appears', () {
      final tiles = tilesFor(
        services: const ['carParking', 'freight'],
        hasPermission: owner(),
      );
      expect(tiles.map((tile) => tile.category), [
        ServiceCategory.parking,
        ServiceCategory.freight,
      ]);
      expect(
        tiles.map((tile) => tile.category),
        isNot(contains(ServiceCategory.barrels)),
      );
      expect(
        tiles.map((tile) => tile.category),
        isNot(contains(ServiceCategory.transport)),
      );
    });

    test('an offered service the signed-in person cannot see is not a tile', () {
      // The business ships barrels; this member of staff is scoped to parking.
      // A tile whose records the feed would hide is a door to an empty room.
      final tiles = tilesFor(
        services: const ['carParking', 'barrelShipping'],
        hasPermission: staff(const [BusinessPermission.parking]),
      );
      expect(tiles.map((tile) => tile.category), [ServiceCategory.parking]);
    });

    test('a business with no service data reads as the whole catalogue', () {
      // Legacy documents predate `businessServices`; the compatibility rule is
      // `normalizeBusinessServices`', and the grid must not read them as a
      // business that offers nothing.
      final tiles = tilesFor(services: const [], hasPermission: owner());
      expect(tiles.map((tile) => tile.category), [
        ServiceCategory.parking,
        ServiceCategory.barrels,
        ServiceCategory.freight,
        ServiceCategory.transport,
      ]);
    });

    test('a business with nothing enabled gets no grid at all', () {
      expect(
        tilesFor(
          services: const ['carSales'],
          hasPermission: staff(const <String>[]),
        ),
        isEmpty,
      );
    });

    test('car sales is never a tile, however it is enabled', () {
      // Nothing on this screen subscribes to listings or purchases, so a sales
      // tile would carry a meaningless count and open an always-empty list.
      for (final permissions in <List<String>>[
        [BusinessPermission.listings],
        [BusinessPermission.purchases],
      ]) {
        final tiles = tilesFor(
          services: const ['carSales', 'carParking'],
          hasPermission: staff([...permissions, BusinessPermission.parking]),
        );
        expect(tiles.map((tile) => tile.category), [ServiceCategory.parking]);
      }
      // It is still a category the feed knows about, so a record that somehow
      // arrives is not orphaned - it just has no tile.
      expect(
        businessActivityCategories(
          services: const ['carSales'],
          hasPermission: owner(),
        ),
        contains(ServiceCategory.sales),
      );
    });

    test('the tiles come out in the grid order, not the map order', () {
      final tiles = tilesFor(
        services: const ['carTransport', 'freight', 'carParking'],
        hasPermission: owner(),
      );
      expect(tiles.map((tile) => tile.category), [
        ServiceCategory.parking,
        ServiceCategory.freight,
        ServiceCategory.transport,
      ]);
    });
  });

  group('what each number means', () {
    test('parking counts what the lot is still owed, not what is parked', () {
      final tiles = tilesFor(
        services: const ['carParking'],
        hasPermission: owner(),
        parkedCars: [
          car(),
          car(),
          car(paymentStatus: 'succeeded'),
          car(paymentStatus: 'not_required'),
        ],
      );
      expect(tiles.single.count, 2);
      expect(tiles.single.countIsUnpaid, isTrue);
    });

    test('a customer booking is not money this lot is owed', () {
      expect(businessParkingUnpaidCount([car(source: 'customer')]), 0);
    });

    test('paid wins over cancelled, so a released space is not chased', () {
      // The precedence rule is the console's and lives in
      // `businessParkingPaymentTone`; the count must not re-answer it.
      expect(
        businessParkingUnpaidCount([
          car(paymentStatus: 'succeeded', status: 'cancelled'),
        ]),
        0,
      );
      // An unpaid cancellation has nothing left to collect either.
      expect(businessParkingUnpaidCount([car(status: 'cancelled')]), 0);
    });

    test('nothing outstanding is zero, not a missing tile', () {
      final tiles = tilesFor(
        services: const ['carParking'],
        hasPermission: owner(),
        parkedCars: [car(paymentStatus: 'succeeded')],
      );
      expect(tiles.single.count, 0);
    });

    test('the shipping services count what is still open', () {
      final tiles = tilesFor(
        services: const ['barrelShipping', 'freight', 'carTransport'],
        hasPermission: owner(),
        barrels: const ['pending', 'in_transit', 'completed', 'cancelled'],
        freight: const ['pending_payment', 'delivered'],
        transport: const ['not_started', 'scheduled', 'completed'],
      );
      expect(tiles.map((tile) => tile.count), [2, 1, 2]);
      expect(tiles.every((tile) => tile.countIsUnpaid), isFalse);
    });

    test('the final statuses are the console\'s, whatever the casing', () {
      for (final status in businessServiceFinalStatuses) {
        expect(businessServiceStatusIsOpen(status), isFalse);
        expect(
          businessServiceStatusIsOpen(' ${status.toUpperCase()} '),
          isFalse,
        );
      }
      expect(businessServiceFinalStatuses, containsAll(<String>['sold']));
    });

    test('a record with no status recorded still counts as open', () {
      // Under-counting work is the direction that loses money.
      expect(businessServiceOpenCount(const ['', '   ']), 2);
    });
  });

  group('tapping a tile', () {
    test('narrows the feed to that service', () {
      expect(
        businessServiceOverviewSelection(
          ServiceCategory.all,
          ServiceCategory.barrels,
        ),
        ServiceCategory.barrels,
      );
      expect(
        businessServiceOverviewSelection(
          ServiceCategory.parking,
          ServiceCategory.barrels,
        ),
        ServiceCategory.barrels,
      );
    });

    test('tapping the selected tile again is the way back to everything', () {
      // With the chips gone the tiles are the only control, so each one has to
      // be its own escape hatch.
      expect(
        businessServiceOverviewSelection(
          ServiceCategory.parking,
          ServiceCategory.parking,
        ),
        ServiceCategory.all,
      );
    });
  });

  group('the home screen spends the decisions it is given', () {
    final home = File('lib/screens/home_menu.dart').readAsStringSync();

    test('the services card is a grid, not a paragraph', () {
      expect(home, contains("Key('service-overview-grid')"));
      expect(home, contains('businessServiceOverviewTiles('));
      expect(home, contains('businessActivityCategories('));
      // The grid and the feed's own gate come from the same decision, so a
      // tile can never offer a service whose records are hidden.
      expect(home, contains('_enabledActivityCategories()'));
    });

    test('the counts come from the lists already subscribed to', () {
      expect(home, contains('parkedCarFields: _parkedCars.map('));
      expect(home, contains('barrelStatuses: _barrelShipments.map('));
      expect(home, contains('freightStatuses: _freightStatuses'));
      expect(home, contains('transportStatuses: _transportRequests.map('));
      // Four subscriptions before the grid existed, four after: the counts are
      // derived from what was already on screen, not bought with reads.
      expect(
        'FirebaseFirestore.instance.collection('.allMatches(home).length,
        4,
      );
      expect('.snapshots().listen('.allMatches(home).length, 4);
      // The freight status comes out of the snapshot the feed already reads.
      expect(home, contains('_freightStatuses\n            ..clear()'));
    });

    test('the duplicate filter chips are gone', () {
      // The tiles do what the ServiceCategory chips did; two controls for one
      // job is what put the daily action below the fold in the first place.
      expect(home, isNot(contains('ServiceCategory.values.map')));
      expect(home, contains("Key('activity-show-all')"));
      expect(home, contains('businessServiceOverviewSelection('));
    });

    test('the console demotes and says that it leaves the app', () {
      final console = home.indexOf('l10n.openBusinessConsole');
      final note = home.indexOf('l10n.businessOperationsWebNote');
      expect(home, contains('AsyncActionButton.outlined'));
      expect(note, greaterThan(console));
      // Still the assistant, unchanged.
      expect(home, contains("Key('open-business-assistant')"));
    });
  });

  group('every new string is in both catalogs', () {
    Map<String, dynamic> catalog(String path) =>
        jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;

    final en = catalog('lib/l10n/app_en.arb');
    final fr = catalog('lib/l10n/app_fr.arb');

    test('the overview copy is bilingual', () {
      for (final key in const [
        'businessServiceOverviewUnpaid',
        'businessServiceOverviewOpen',
        'businessServiceOverviewShowAll',
        'businessServiceOverviewEmpty',
        'businessOperationsWebNote',
      ]) {
        expect(en[key], isNotNull, reason: 'missing English $key');
        expect(fr[key], isNotNull, reason: 'missing French $key');
        expect(en[key], isNot(fr[key]), reason: '$key is not translated');
      }
    });

    test('the console paragraph is now one line', () {
      // Five lines of prose above the fold is what buried the grid.
      expect((en['businessOperationsWebNote'] as String).length, lessThan(120));
      expect((fr['businessOperationsWebNote'] as String).length, lessThan(160));
    });
  });
}

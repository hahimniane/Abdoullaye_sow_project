import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/business_service.dart';
import 'package:my_flutter_app/screens/containers_screen.dart'
    show ContainersEntry;
import 'package:my_flutter_app/screens/shipping_home_section.dart';
import 'package:my_flutter_app/services/business_activity_queries.dart';
import 'package:my_flutter_app/services/package_requests.dart';
import 'package:my_flutter_app/services/shipping_home.dart';
import 'package:my_flutter_app/services/shop_home.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/home_destinations.dart';

import 'fixtures/fake_package_requests.dart';

/// The simple shipping home (docs/SHIPPING_SIMPLE_HOME.md, part H): who gets
/// it, which rows it lists, and what each row opens. The gate and the rows
/// are pure and tested for every role; the section is rendered with a fake
/// facts loader, a fake request service and a recording opener, in English
/// and French. The wiring in the home is checked by reading its source, the
/// way the other home contracts do (the home itself reads Firebase).

const _ship = ['barrelShipping', 'freight'];

ShippingHomeLayout _layout({
  bool isAdmin = false,
  bool dashboard = true,
  bool containers = true,
  bool inventory = false,
  Iterable<String> services = _ship,
}) => shippingHomeLayout(
  isAdmin: isAdmin,
  hasBusinessDashboardAccess: dashboard,
  canUseContainers: containers,
  canUseInventory: inventory,
  services: services,
);

const _air = ShippingHomeFacts(shipsByAir: true, hasSeaContainer: false);
const _airAndSea = ShippingHomeFacts(shipsByAir: true, hasSeaContainer: true);
const _seaOnly = ShippingHomeFacts(shipsByAir: false, hasSeaContainer: true);

PackageRequest _request(String id, String status) => PackageRequest.fromMap(id, {
  'businessId': 'b1',
  'businessName': 'Test Express',
  'code': 'R-${id.toUpperCase()}AAAA',
  'token': 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
  'handoff': 'bring_in',
  'plannedDate': '2026-10-24',
  'sender': {'name': 'Test Sender', 'phoneE164': '+15555550101', 'uid': 'u1'},
  'receiver': {'name': 'Test Receiver', 'phoneE164': '+15555550102'},
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
  'pieces': [
    {'id': 'p1', 'kind': 'barrel', 'estimateCents': 12000},
  ],
  'status': status,
  'createdAt': DateTime(2026, 10, 22, 12),
});

class _Opened {
  final List<(ContainersEntry, bool)> calls = [];
  void call(ContainersEntry entry, {bool registerOnOpen = false}) =>
      calls.add((entry, registerOnOpen));
}

HomeDestination _row(String key, String title) => HomeDestination(
  rowKey: Key(key),
  icon: Icons.circle_outlined,
  title: title,
  onTap: () {},
);

Future<_Opened> _pump(
  WidgetTester tester, {
  Future<ShippingHomeFacts> Function(String)? facts,
  FakePackageRequests? requests,
  String name = 'Test Air Cargo',
  String? approval,
  bool containersRow = true,
  bool deliveriesRow = false,
  bool moneyRows = true,
  Locale locale = const Locale('en'),
  double width = 390,
  double textScale = 1,
}) async {
  tester.view.physicalSize = Size(width, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final opened = _Opened();
  final fake = requests ?? FakePackageRequests();
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: ShippingHomeSection(
            key: UniqueKey(),
            businessId: 'b1',
            businessName: name,
            approvalStatus: approval,
            containersRow: containersRow
                ? _row('open-containers', 'Containers')
                : null,
            deliveriesRow: deliveriesRow
                ? _row('open-deliveries', 'Deliveries')
                : null,
            moneyRows: moneyRows
                ? [
                    _row('open-invoices', 'Invoices & receipts'),
                    _row('open-staff-balances', 'Staff balances'),
                  ]
                : const [],
            factsLoader: facts ?? (_) async => _air,
            requestServiceBuilder: () => fake,
            opener: opened.call,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return opened;
}

void main() {
  group('who gets the simple home', () {
    test('package shipping only: barrels, freight, or both', () {
      expect(_layout(), ShippingHomeLayout.simple);
      expect(
        _layout(services: ['barrelShipping']),
        ShippingHomeLayout.simple,
      );
      expect(_layout(services: ['freight']), ShippingHomeLayout.simple);
    });

    test('any other service keeps today\'s home', () {
      for (final other in [
        'carParking',
        'carSales',
        'carTransport',
        'inventory',
        'sharedBarrels',
      ]) {
        expect(
          _layout(services: [..._ship, other]),
          ShippingHomeLayout.standard,
          reason: other,
        );
        expect(
          _layout(services: [other]),
          ShippingHomeLayout.standard,
          reason: other,
        );
      }
    });

    test('no services at all keeps today\'s home', () {
      expect(_layout(services: const []), ShippingHomeLayout.standard);
    });

    test('a platform admin keeps today\'s home', () {
      expect(_layout(isAdmin: true), ShippingHomeLayout.standard);
    });

    test('someone with no business dashboard keeps today\'s home', () {
      expect(_layout(dashboard: false), ShippingHomeLayout.standard);
    });

    test('a destination clerk without Containers keeps today\'s home', () {
      expect(_layout(containers: false), ShippingHomeLayout.standard);
    });

    test('someone who can use Inventory keeps today\'s home', () {
      expect(_layout(inventory: true), ShippingHomeLayout.standard);
    });

    test('the shipping services are the stored values of the enum', () {
      expect(shippingHomeServices, {
        BusinessServiceKey.barrelShipping.value,
        BusinessServiceKey.freight.value,
      });
    });

    test('a shop is decided first: shopHomeLayout answers before this one', () {
      // A shop (Inventory only) is not a package shipper, whatever it holds.
      expect(
        shopHomeLayout(
          isAdmin: false,
          hasBusinessDashboardAccess: true,
          canUseInventory: true,
          hasServiceSections: false,
        ),
        ShopHomeLayout.shopOnly,
      );
      final home = File('lib/screens/home_menu.dart').readAsStringSync();
      final shop = home.indexOf('final layout = shopHomeLayout(');
      final ship = home.indexOf('shippingHomeLayout(', shop);
      expect(shop, greaterThan(0));
      expect(ship, greaterThan(shop));
      expect(
        home.substring(shop, ship),
        contains('layout == ShopHomeLayout.standard'),
      );
    });
  });

  group('air only', () {
    test('ships by air and has no sea container', () {
      expect(airOnlyBusiness(shipsByAir: true, hasSeaContainer: false), isTrue);
    });

    test('a sea container, or no air at all, is not air only', () {
      expect(airOnlyBusiness(shipsByAir: true, hasSeaContainer: true), isFalse);
      expect(
        airOnlyBusiness(shipsByAir: false, hasSeaContainer: false),
        isFalse,
      );
      expect(
        airOnlyBusiness(shipsByAir: false, hasSeaContainer: true),
        isFalse,
      );
    });

    test('facts that could not be read give today\'s Containers row', () {
      expect(ShippingHomeFacts.unknown.airOnly, isFalse);
    });
  });

  group('the rows, top to bottom', () {
    test('air only: Packages here, On the way', () {
      expect(
        shippingHomePlaces(facts: _air, openRequests: 0, canUseDeliveries: false),
        [ShippingHomePlace.packagesHere, ShippingHomePlace.onTheWay],
      );
    });

    test('with a sea container: Packages here, Containers', () {
      for (final facts in [_airAndSea, _seaOnly, ShippingHomeFacts.unknown]) {
        expect(
          shippingHomePlaces(
            facts: facts,
            openRequests: 0,
            canUseDeliveries: false,
          ),
          [ShippingHomePlace.packagesHere, ShippingHomePlace.containers],
        );
      }
    });

    test('Requests only while some wait, first; Deliveries last', () {
      expect(
        shippingHomePlaces(facts: _air, openRequests: 3, canUseDeliveries: true),
        [
          ShippingHomePlace.requests,
          ShippingHomePlace.packagesHere,
          ShippingHomePlace.onTheWay,
          ShippingHomePlace.deliveries,
        ],
      );
    });

    test('while the facts load, the row that depends on them is not there', () {
      expect(
        shippingHomePlaces(
          facts: null,
          openRequests: 0,
          canUseDeliveries: true,
        ),
        [ShippingHomePlace.packagesHere, ShippingHomePlace.deliveries],
      );
    });
  });

  group('the count queries', () {
    test('both name the business and the air one names the mode', () {
      final all = containersCountSpec(' b1 ');
      final air = airContainersCountSpec('b1');
      expect(all.collection, 'containers');
      expect(all.businessId, 'b1');
      expect(air.businessId, 'b1');
      expect(air.filters.map((f) => f.field), ['businessId', 'shipMode']);
      expect(air.filters.last.value, 'air');
      // Equalities only: merged single-field indexes, no composite index.
      expect(all.compositeIndex, isNull);
      expect(air.compositeIndex, isNull);
    });
  });

  group('the simple home', () {
    testWidgets('air only: Register a package, Packages here, On the way', (
      tester,
    ) async {
      await _pump(tester);
      expect(find.byKey(const Key('shipping-home')), findsOneWidget);
      expect(find.text('Test Air Cargo'), findsOneWidget);
      expect(find.byKey(const Key('register-package')), findsOneWidget);
      expect(find.text('Register a package'), findsOneWidget);
      expect(find.byKey(const Key('open-packages-here')), findsOneWidget);
      expect(find.text('Packages here'), findsOneWidget);
      expect(find.byKey(const Key('open-on-the-way')), findsOneWidget);
      expect(find.text('On the way'), findsOneWidget);
      // The word Container never appears for an air-only business.
      expect(find.byKey(const Key('open-containers')), findsNothing);
      expect(find.textContaining('Container'), findsNothing);
      // No service tiles, no parking.
      expect(find.byKey(const Key('service-overview-grid')), findsNothing);
      expect(find.byKey(const Key('record-parked-car')), findsNothing);
    });

    testWidgets('with a sea container the Containers row stays', (
      tester,
    ) async {
      await _pump(tester, facts: (_) async => _airAndSea);
      expect(find.byKey(const Key('open-containers')), findsOneWidget);
      expect(find.byKey(const Key('open-on-the-way')), findsNothing);
      expect(find.byKey(const Key('open-packages-here')), findsOneWidget);
    });

    testWidgets('Money is quiet: Invoices and Staff balances, same keys', (
      tester,
    ) async {
      await _pump(tester);
      expect(find.byKey(const Key('shipping-money-title')), findsOneWidget);
      expect(find.byKey(const Key('open-invoices')), findsOneWidget);
      expect(find.byKey(const Key('open-staff-balances')), findsOneWidget);
    });

    testWidgets('no Money heading when the person holds neither', (
      tester,
    ) async {
      await _pump(tester, moneyRows: false);
      expect(find.byKey(const Key('shipping-money-title')), findsNothing);
    });

    testWidgets('Deliveries only for someone who holds the access', (
      tester,
    ) async {
      await _pump(tester, deliveriesRow: true);
      expect(find.byKey(const Key('open-deliveries')), findsOneWidget);
      await _pump(tester, deliveriesRow: false);
      expect(find.byKey(const Key('open-deliveries')), findsNothing);
    });

    testWidgets('the tail is the shared one: console and assistant', (
      tester,
    ) async {
      await _pump(tester);
      expect(find.byType(BusinessHomeTail), findsOneWidget);
      expect(find.byKey(const Key('open-business-assistant')), findsOneWidget);
    });

    testWidgets('while the facts load the dependent row is simply not there', (
      tester,
    ) async {
      final pending = Completer<ShippingHomeFacts>();
      await _pump(tester, facts: (_) => pending.future);
      expect(find.byKey(const Key('register-package')), findsOneWidget);
      expect(find.byKey(const Key('open-packages-here')), findsOneWidget);
      expect(find.byKey(const Key('open-on-the-way')), findsNothing);
      expect(find.byKey(const Key('open-containers')), findsNothing);
      pending.complete(_air);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('open-on-the-way')), findsOneWidget);
    });

    testWidgets('a failed read falls back to the Containers row', (
      tester,
    ) async {
      await _pump(tester, facts: (_) async => throw StateError('offline'));
      expect(find.byKey(const Key('open-containers')), findsOneWidget);
      expect(find.byKey(const Key('open-on-the-way')), findsNothing);
    });

    testWidgets('a read that never answers resolves to the Containers row', (
      tester,
    ) async {
      // Never completes: the home must not wait for it forever.
      await _pump(tester, facts: (_) => Completer<ShippingHomeFacts>().future);
      expect(find.byKey(const Key('open-containers')), findsNothing);
      await tester.pump(const Duration(seconds: 11));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('open-containers')), findsOneWidget);
    });

    testWidgets('Requests shows only while customers wait, with the count', (
      tester,
    ) async {
      await _pump(tester);
      expect(find.byKey(const Key('open-package-requests')), findsNothing);

      final fake = FakePackageRequests()
        ..initialOpen = [
          _request('a', 'new'),
          _request('b', 'new'),
          // Confirmed ones are Expected on the waiting list, not Requests.
          _request('c', 'confirmed'),
        ];
      await _pump(tester, requests: fake);
      expect(find.byKey(const Key('open-package-requests')), findsOneWidget);
      expect(find.text('2 open requests'), findsOneWidget);
    });

    testWidgets('a pending business shows the calm note, an approved one not', (
      tester,
    ) async {
      await _pump(tester, approval: 'pending');
      expect(find.byKey(const Key('shop-approval-note')), findsOneWidget);
      await _pump(tester, approval: 'approved');
      expect(find.byKey(const Key('shop-approval-note')), findsNothing);
      await _pump(tester);
      expect(find.byKey(const Key('shop-approval-note')), findsNothing);
    });

    testWidgets('each row opens its place; Register opens the form at once', (
      tester,
    ) async {
      final fake = FakePackageRequests()..initialOpen = [_request('a', 'new')];
      final opened = await _pump(tester, requests: fake);
      Future<void> tap(String key) async {
        await tester.tap(find.byKey(Key(key)));
        await tester.pumpAndSettle();
      }

      await tap('register-package');
      await tap('open-packages-here');
      await tap('open-on-the-way');
      await tap('open-package-requests');
      expect(opened.calls, [
        (ContainersEntry.waiting, true),
        (ContainersEntry.waiting, false),
        (ContainersEntry.shipments, false),
        (ContainersEntry.requests, false),
      ]);
    });

    testWidgets('French: 320 wide, text at 130%: everything fits', (
      tester,
    ) async {
      final fake = FakePackageRequests()..initialOpen = [_request('a', 'new')];
      await _pump(
        tester,
        locale: const Locale('fr'),
        width: 320,
        textScale: 1.3,
        requests: fake,
        deliveriesRow: true,
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Enregistrer un colis'), findsOneWidget);
      expect(find.text('Colis ici'), findsOneWidget);
      expect(find.text('En route'), findsOneWidget);
      expect(find.text('Argent'), findsOneWidget);
      expect(find.textContaining('Container'), findsNothing);
    });

    testWidgets('English: 320 wide, text at 130%: everything fits', (
      tester,
    ) async {
      await _pump(tester, width: 320, textScale: 1.3, deliveriesRow: true);
      expect(tester.takeException(), isNull);
    });
  });

  group('the home uses it', () {
    String home() => File('lib/screens/home_menu.dart').readAsStringSync();

    test('a parking business\'s home is unchanged', () {
      final src = home();
      // The standard sections are all still there, behind the same gates.
      for (final key in [
        "Key('record-parked-car')",
        "Key('service-overview-grid')",
        "Key('open-lot-ledger')",
        "Key('open-containers')",
        "Key('open-invoices')",
        "Key('open-staff-balances')",
        'HomeDestinationGroup(rows: destinations)',
        'BusinessHomeTail(',
      ]) {
        expect(src, contains(key), reason: key);
      }
      // The register action is the simple home's alone.
      expect(src, isNot(contains("Key('register-package')")));
      // A parking business is not a package shipper.
      expect(
        _layout(services: ['carParking', 'barrelShipping']),
        ShippingHomeLayout.standard,
      );
      // The simple home is one branch; the standard one is its else.
      final branch = src.indexOf('else if (simpleShipping) ...[');
      final standard = src.indexOf('] else ...[', branch);
      expect(branch, greaterThan(0));
      expect(standard, greaterThan(branch));
      expect(src.substring(standard), contains('_ServicesSection('));
      expect(src.substring(branch, standard), isNot(contains('_ServicesSection(')));
    });

    test('the standard home keeps its header row for the simple one too', () {
      final src = home();
      expect(src, contains('if (layout == ShopHomeLayout.standard) ...['));
      expect(src, contains('CustomerNotificationBell()'));
      expect(src, contains('LanguageToggle()'));
    });

    test('the simple home lists the home\'s own rows, by key', () {
      final src = home();
      for (final key in [
        'open-containers',
        'open-invoices',
        'open-staff-balances',
      ]) {
        expect(src, contains("'$key'"), reason: key);
      }
      // Deliveries is one definition for both homes; the standard home still
      // lists it only for destination staff without Containers.
      expect(src, contains('_deliveriesDestination('));
      expect(src, contains('auth.hasDeliveriesAccess &&\n      !auth.hasContainersAccess'));
    });

    test('the activity feed shows under it only when it has records', () {
      final src = home();
      final branch = src.indexOf('else if (simpleShipping) ...[');
      final standard = src.indexOf('] else ...[', branch);
      final block = src.substring(branch, standard);
      expect(block, contains('if (showRecords) ...['));
      expect(block, contains('activity,'));
      // And no history button on a clean screen.
      expect(src, contains('(simpleShipping && !showRecords)'));
    });
  });
}

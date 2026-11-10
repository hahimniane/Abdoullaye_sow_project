import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/screens/business_requests_screen.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/waiting_packages_screen.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_request_feed.dart';
import 'package:my_flutter_app/services/package_requests.dart'
    show PackageProofSettings;
import 'package:my_flutter_app/services/waiting_packages.dart'
    show DestinationRef;
import 'package:my_flutter_app/theme/app_theme.dart';

import 'fixtures/fake_package_requests.dart';

/// The places the containers screen opens on (docs/SHIPPING_SIMPLE_HOME.md,
/// H4): the waiting list, what has left, and the requests - each straight
/// away, with no Containers screen underneath - and the screen's own default,
/// which stays exactly what it was. The screen is given its feeds through
/// the test seed, so nothing here touches Firebase.

ShippingContainer _box(
  String id, {
  String status = 'loading',
  String mode = 'air',
  String label = 'Box',
  Map<String, dynamic> extra = const {},
}) => ShippingContainer.fromMap(id, {
  'businessId': 'b1',
  'label': label,
  'status': status,
  'shipMode': mode,
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
  ...extra,
});

ContainerLine _waiting([
  Map<String, dynamic> extra = const {},
  String id = 'w1',
]) => ContainerLine.fromMap(id, {
  'businessId': 'b1',
  'containerId': '',
  'containerStatus': containerLineStatusWaiting,
  'kind': containerLineKindBarrels,
  'quantity': 1,
  'ownerKind': containerOwnerCustomer,
  'customerName': 'Test Sender',
  'customerPhone': '+15555550101',
  'receiverName': 'Test Receiver',
  'receiverPhone': '+15555550102',
  'trackingCode': 'CL-TEST01',
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
  'shipMode': 'air',
  ...extra,
});

const _destinations = [
  DestinationCountry(
    id: 'guinea',
    name: 'Guinea',
    isMain: true,
  ),
];

ContainersScreenSeed _seed({
  List<ShippingContainer> containers = const [],
  List<ContainerLine> lines = const [],
  PackageProofSettings settings = const PackageProofSettings(shipsByAir: true),
  FakePackageRequests? fake,
}) => ContainersScreenSeed(
  feed: ContainerFeed.fixed('b1', containers: containers, lines: lines),
  requests: PackageRequestFeed(
    'b1',
    service: fake ?? (FakePackageRequests()..initialOpen = []),
  ),
  destinations: _destinations,
  businessName: 'Test Air Cargo',
  proofSettings: settings,
);

Future<void> _pump(
  WidgetTester tester,
  ContainersScreenSeed seed, {
  ContainersEntry entry = ContainersEntry.waiting,
  bool registerOnOpen = false,
  Locale locale = const Locale('en'),
  double width = 430,
}) async {
  tester.view.physicalSize = Size(width, 3200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: ContainersScreen(
        key: UniqueKey(),
        businessId: 'b1',
        entry: entry,
        registerOnOpen: registerOnOpen,
        seed: seed,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _Pushes extends NavigatorObserver {
  int pushed = 0;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushed++;
  }
}

void main() {
  group('the default', () {
    test('opens the Containers screen, with no register form', () {
      const screen = ContainersScreen(businessId: 'b1');
      expect(screen.entry, ContainersEntry.containers);
      expect(screen.registerOnOpen, isFalse);
      expect(screen.seed, isNull);
    });

    test('the Containers build is still the one it was', () {
      final src = File('lib/screens/containers_screen.dart').readAsStringSync();
      // The shipments flag changes nothing unless the entry asks for it.
      expect(
        src,
        contains(
          'final shipments = widget.entry == ContainersEntry.shipments;',
        ),
      );
      for (final kept in [
        'onOpenWaiting: _openWaiting,',
        'onOpenRequests: _openRequests,',
        'label: l10n.ctrNewContainer,',
        'BankCheckEntry(',
        'ContainerVolumeCard(',
        'onScan: _openScan,',
      ]) {
        expect(src, contains(kept), reason: kept);
      }
      // The header still offers all three states.
      expect(src, contains(': containerStatuses,'));
    });

    test('the screen lists three entries and a test seed only', () {
      expect(ContainersEntry.values.map((e) => e.name), [
        'containers',
        'waiting',
        'shipments',
        'requests',
      ]);
    });
  });

  group('waiting', () {
    testWidgets('is the waiting list itself, with no Containers screen', (
      tester,
    ) async {
      await _pump(tester, _seed(lines: [_waiting()]));
      expect(find.byType(WaitingPackagesScreen), findsOneWidget);
      expect(find.byKey(const Key('containers-search')), findsNothing);
      expect(find.byKey(const Key('containers-open-waiting')), findsNothing);
      expect(find.byKey(const Key('waiting-count')), findsOneWidget);
      expect(find.text('1 package waiting'), findsOneWidget);
    });

    testWidgets('a business with a sea container keeps the old title', (
      tester,
    ) async {
      await _pump(
        tester,
        _seed(containers: [_box('c1', mode: 'sea'), _box('c2')]),
      );
      expect(find.text('Waiting for a container'), findsOneWidget);
      expect(find.text('Packages here'), findsNothing);
    });

    testWidgets('an air-only business: Packages here, no Sea / Air chips', (
      tester,
    ) async {
      await _pump(tester, _seed(containers: [_box('c1')]));
      expect(find.byKey(const Key('waiting-title')), findsOneWidget);
      expect(find.text('Packages here'), findsOneWidget);
      expect(find.text('Waiting for a container'), findsNothing);
      expect(find.byKey(const Key('waiting-ship-mode-air')), findsNothing);
      expect(find.byKey(const Key('waiting-ship-mode-sea')), findsNothing);
    });

    testWidgets('a business that never shipped by air is not air only', (
      tester,
    ) async {
      await _pump(
        tester,
        _seed(settings: const PackageProofSettings(), containers: [_box('c1')]),
      );
      expect(find.text('Waiting for a container'), findsOneWidget);
    });

    String? searchHint(WidgetTester tester, String key) => tester
        .widget<TextField>(find.byKey(Key(key)))
        .decoration
        ?.hintText;

    testWidgets('an air-only business: the search offers no VIN', (
      tester,
    ) async {
      await _pump(tester, _seed(containers: [_box('c1')], lines: [_waiting()]));
      expect(searchHint(tester, 'waiting-search'), 'Customer, receiver or phone');
      // Nothing on the list of a business that only flies names a container.
      expect(find.textContaining(RegExp('[Cc]ontainer')), findsNothing);
    });

    testWidgets('with a sea container the search still offers the VIN', (
      tester,
    ) async {
      await _pump(tester, _seed(containers: [_box('c1', mode: 'sea')]));
      expect(searchHint(tester, 'waiting-search'), 'VIN, customer or phone');
    });

    testWidgets('French: the air-only search hint', (tester) async {
      await _pump(
        tester,
        _seed(containers: [_box('c1')]),
        locale: const Locale('fr'),
        width: 360,
      );
      expect(
        searchHint(tester, 'waiting-search'),
        'Client, destinataire ou téléphone',
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('French: Colis ici', (tester) async {
      await _pump(
        tester,
        _seed(containers: [_box('c1')]),
        locale: const Locale('fr'),
        width: 360,
      );
      expect(find.text('Colis ici'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('does not open the register form unless asked', (
      tester,
    ) async {
      await _pump(tester, _seed(containers: [_box('c1')]));
      expect(find.byKey(const Key('line-save')), findsNothing);
    });

    testWidgets('registerOnOpen opens the form once, on Air with no choice', (
      tester,
    ) async {
      await _pump(
        tester,
        _seed(containers: [_box('c1')]),
        registerOnOpen: true,
      );
      expect(find.byKey(const Key('line-save')), findsOneWidget);
      expect(find.byKey(const Key('ship-mode-choice')), findsNothing);
      // Air: the proof section is on the form.
      expect(find.byKey(const Key('proof-weight')), findsOneWidget);
      // Close it: it does not come back by itself.
      Navigator.of(tester.element(find.byKey(const Key('line-save')))).pop();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('line-save')), findsNothing);
      await tester.pump(const Duration(seconds: 1));
      expect(find.byKey(const Key('line-save')), findsNothing);
    });

    testWidgets('registerOnOpen with sea packages offers Sea · Air', (
      tester,
    ) async {
      await _pump(
        tester,
        _seed(containers: [_box('c1', mode: 'sea')]),
        registerOnOpen: true,
      );
      expect(find.byKey(const Key('line-save')), findsOneWidget);
      expect(find.byKey(const Key('ship-mode-choice')), findsOneWidget);
    });
  });

  group('the register form', () {
    Future<void> openForm(
      WidgetTester tester, {
      required bool airOnly,
      Locale locale = const Locale('en'),
    }) async {
      tester.view.physicalSize = const Size(430, 3200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: SingleChildScrollView(
              child: waitingPackageSheetForTesting(
                caller: (name, payload) async => null,
                destinations: _destinations,
                defaultDestination: const DestinationRef('guinea', 'Guinea'),
                proofSettings: const PackageProofSettings(shipsByAir: true),
                airOnly: airOnly,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('air only: starts on Air, no Sea · Air choice', (tester) async {
      await openForm(tester, airOnly: true);
      expect(find.byKey(const Key('ship-mode-choice')), findsNothing);
      expect(find.byKey(const Key('proof-weight')), findsOneWidget);
    });

    testWidgets('otherwise: the choice, starting on Sea (as it was)', (
      tester,
    ) async {
      await openForm(tester, airOnly: false);
      expect(find.byKey(const Key('ship-mode-choice')), findsOneWidget);
      expect(find.byKey(const Key('proof-weight')), findsNothing);
    });

    bool kindSelected(WidgetTester tester, String kind) =>
        // ignore: avoid_dynamic_calls
        (tester.widget(find.byKey(Key('piece-kind-0-$kind'))) as dynamic)
                .selected
            as bool;

    testWidgets('air only: no car question, no container word, a box first', (
      tester,
    ) async {
      await openForm(tester, airOnly: true);
      // "A car | Barrels & boxes" is not asked.
      expect(find.byKey(const Key('line-kind-car')), findsNothing);
      expect(find.byKey(const Key('line-kind-pieces')), findsNothing);
      expect(find.text('It waits here until you send it.'), findsOneWidget);
      expect(find.textContaining('container'), findsNothing);
      // A barrel does not fly: the first piece is a box.
      expect(kindSelected(tester, 'box'), isTrue);
      expect(kindSelected(tester, 'barrel'), isFalse);
    });

    testWidgets('otherwise: the car question and a barrel first (as it was)', (
      tester,
    ) async {
      await openForm(tester, airOnly: false);
      expect(find.byKey(const Key('line-kind-car')), findsOneWidget);
      expect(find.byKey(const Key('line-kind-pieces')), findsOneWidget);
      expect(
        find.text('It waits here until a container takes it.'),
        findsOneWidget,
      );
      expect(kindSelected(tester, 'barrel'), isTrue);
    });

    testWidgets('air only, French: no conteneur, and the buttons fit', (
      tester,
    ) async {
      await openForm(tester, airOnly: true, locale: const Locale('fr'));
      expect(find.text("Il attend ici jusqu'à l'envoi."), findsOneWidget);
      expect(find.textContaining('conteneur'), findsNothing);
      expect(
        find.text('Enregistrer + un autre, même expéditeur'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('shipments', () {
    final shipped = _box(
      'c1',
      status: 'shipped',
      label: 'Flight 11/02/2026',
      extra: {'lineCount': 3},
    );
    final arrived = _box('c2', status: 'arrived', label: 'Flight 10/12/2026');
    final loading = _box('c3', label: 'Flight 11/14/2026');

    testWidgets('titled On the way, opening on what has shipped', (
      tester,
    ) async {
      await _pump(
        tester,
        _seed(containers: [shipped, arrived, loading]),
        entry: ContainersEntry.shipments,
      );
      expect(find.text('On the way'), findsOneWidget);
      expect(find.text('Flight 11/02/2026'), findsOneWidget);
      // Neither what is arrived nor what is still loading, yet.
      expect(find.text('Flight 10/12/2026'), findsNothing);
      expect(find.text('Flight 11/14/2026'), findsNothing);
    });

    testWidgets('offers Shipped and Arrived (ready for pickup) only', (
      tester,
    ) async {
      await _pump(
        tester,
        _seed(containers: [shipped, arrived, loading]),
        entry: ContainersEntry.shipments,
      );
      // "Arrived" is what the app calls Ready for pickup.
      expect(find.text('Shipped'), findsWidgets);
      expect(find.text('Ready for pickup'), findsWidgets);
      expect(find.text('Loading'), findsNothing);
      await tester.tap(find.text('Ready for pickup').first);
      await tester.pumpAndSettle();
      expect(find.text('Flight 10/12/2026'), findsOneWidget);
      expect(find.text('Flight 11/02/2026'), findsNothing);
    });

    testWidgets('no create button, no Waiting or Requests shortcuts', (
      tester,
    ) async {
      await _pump(
        tester,
        _seed(containers: [shipped]),
        entry: ContainersEntry.shipments,
      );
      expect(find.text('New container'), findsNothing);
      expect(find.byKey(const Key('containers-open-waiting')), findsNothing);
      expect(find.byKey(const Key('containers-open-requests')), findsNothing);
      expect(find.byKey(const Key('containers-bank-check')), findsNothing);
    });

    testWidgets('nothing on the way says where to send from', (tester) async {
      await _pump(
        tester,
        _seed(containers: [loading]),
        entry: ContainersEntry.shipments,
      );
      expect(
        find.text('Nothing on the way. Send packages from Packages here.'),
        findsOneWidget,
      );
    });

    testWidgets('search finds what has left, not what still waits', (
      tester,
    ) async {
      await _pump(
        tester,
        _seed(
          containers: [shipped, loading],
          lines: [
            _waiting({
              'containerId': 'c1',
              'containerStatus': 'shipped',
              'trackingCode': 'CL-SHIP01',
            }, 'l1'),
            _waiting({
              'containerId': 'c3',
              'containerStatus': 'loading',
              'trackingCode': 'CL-LOAD01',
            }, 'l2'),
            _waiting({'trackingCode': 'CL-WAIT01'}, 'l3'),
          ],
        ),
        entry: ContainersEntry.shipments,
      );
      await tester.enterText(
        find.byKey(const Key('containers-search')),
        'Test Sender',
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('hit-l1')), findsOneWidget);
      expect(find.byKey(const ValueKey('hit-l2')), findsNothing);
      expect(find.byKey(const ValueKey('hit-l3')), findsNothing);
    });

    testWidgets('tapping one opens its detail page', (tester) async {
      // The detail page reads the live business, which a widget test does
      // not have: only that the tap pushes a page is checked here.
      final observer = _Pushes();
      tester.view.physicalSize = const Size(430, 3200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          navigatorObservers: [observer],
          home: ContainersScreen(
            businessId: 'b1',
            entry: ContainersEntry.shipments,
            seed: _seed(containers: [shipped]),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final before = observer.pushed;
      await tester.tap(find.text('Flight 11/02/2026'));
      await tester.pump();
      tester.takeException();
      expect(observer.pushed, before + 1);
    });

    testWidgets('air only: the search offers no VIN', (tester) async {
      await _pump(
        tester,
        _seed(containers: [shipped]),
        entry: ContainersEntry.shipments,
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('containers-search')))
            .decoration
            ?.hintText,
        'Customer, receiver or phone',
      );
      expect(find.textContaining(RegExp('[Cc]ontainer')), findsNothing);
    });

    testWidgets('French reads En route', (tester) async {
      await _pump(
        tester,
        _seed(containers: [shipped]),
        entry: ContainersEntry.shipments,
        locale: const Locale('fr'),
        width: 430,
      );
      expect(find.text('En route'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('requests', () {
    testWidgets('is the requests screen itself', (tester) async {
      await _pump(tester, _seed(), entry: ContainersEntry.requests);
      expect(find.byType(BusinessRequestsScreen), findsOneWidget);
      expect(find.byKey(const Key('containers-search')), findsNothing);
    });
  });

  group('containers (the default)', () {
    testWidgets('keeps Waiting, Requests, all three states and New container', (
      tester,
    ) async {
      await _pump(
        tester,
        _seed(containers: [_box('c1', mode: 'sea'), _box('c2')]),
        entry: ContainersEntry.containers,
      );
      expect(find.text('Containers'), findsOneWidget);
      expect(find.byKey(const Key('containers-open-waiting')), findsOneWidget);
      expect(find.byKey(const Key('containers-open-requests')), findsOneWidget);
      expect(find.text('Loading'), findsWidgets);
      expect(find.text('Shipped'), findsOneWidget);
      expect(find.text('Ready for pickup'), findsOneWidget);
      expect(find.text('New container'), findsOneWidget);
    });
  });
}

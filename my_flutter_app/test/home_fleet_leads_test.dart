import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/shipping_home_section.dart';
import 'package:my_flutter_app/services/business_home.dart';
import 'package:my_flutter_app/services/shipping_home.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/business_home_column.dart';

import 'fixtures/fake_package_requests.dart';

/// Fleet leads, Requests next (docs/FLEET.md section 17): a plate-leasing
/// business opens its home on Fleet, then the Requests row, and keeps
/// everything else folded under "More shipping".

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  double width = 390,
}) async {
  tester.view.physicalSize = Size(width, 3000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

Widget _home({required List<Widget> lead}) => Builder(
  builder: (context) {
    final l10n = AppLocalizations.of(context)!;
    return BusinessHomeColumn(
      parts: const [HomePart.shipping],
      header: const Text('Test Fleet Co', key: Key('home-business-name')),
      lead: lead,
      foldLabel: l10n.hflMoreShipping,
      shop: (_) => const SizedBox.shrink(),
      shipping: () => ShippingHomeSection(
        key: const Key('shipping-home-section'),
        businessId: 'b1',
        showTail: false,
        hideRequests: lead.isNotEmpty,
        factsLoader: (_) async => ShippingHomeFacts.unknown,
        requestServiceBuilder: () => FakePackageRequests(),
      ),
      services: (_) => const SizedBox.shrink(),
    );
  },
);

List<Widget> _fleetLead() => [
  const SizedBox(key: Key('home-fleet-block'), height: 200),
  ShippingHomeSection(
    businessId: 'b1',
    requestsOnly: true,
    factsLoader: (_) async => throw StateError('requests-only reads no facts'),
    requestServiceBuilder: () => FakePackageRequests(),
  ),
];

final _fleet = find.byKey(const Key('home-fleet-block'));
final _requests = find.byKey(const Key('open-package-requests'));
final _register = find.byKey(const Key('register-package'));
final _fold = find.byKey(const Key('home-fold-toggle'));

void main() {
  group('homeLeads', () {
    test('Fleet then Requests for whoever may open Fleet and ship', () {
      expect(homeLeads(canOpenFleet: true, canShip: true), [
        HomeLead.fleet,
        HomeLead.requests,
      ]);
    });
    test('Fleet alone when they may not ship', () {
      expect(homeLeads(canOpenFleet: true, canShip: false), [HomeLead.fleet]);
    });
    test('nothing leads without Fleet: the home is unchanged', () {
      expect(homeLeads(canOpenFleet: false, canShip: true), isEmpty);
      expect(homeLeads(canOpenFleet: false, canShip: false), isEmpty);
    });
  });

  group('the home when Fleet leads', () {
    testWidgets('Fleet first, Requests next, the rest folded and reachable', (
      tester,
    ) async {
      await _pump(tester, _home(lead: _fleetLead()));
      expect(_fleet, findsOneWidget);
      // One Requests row, shown even with nothing open, under Fleet.
      expect(_requests, findsOneWidget);
      expect(find.text('No open requests'), findsOneWidget);
      expect(
        tester.getTopLeft(_requests).dy,
        greaterThan(tester.getTopLeft(_fleet).dy),
      );
      // Register a package is kept, folded under More shipping.
      expect(find.text('More shipping'), findsOneWidget);
      expect(_register, findsNothing);
      await tester.tap(_fold);
      await tester.pumpAndSettle();
      expect(_register, findsOneWidget);
      expect(
        tester.getTopLeft(_register).dy,
        greaterThan(tester.getTopLeft(_requests).dy),
      );
      // The folded block does not repeat the Requests row.
      expect(_requests, findsOneWidget);
      // The same tap folds it again.
      await tester.tap(_fold);
      await tester.pumpAndSettle();
      expect(_register, findsNothing);
    });

    testWidgets('without leads the home is exactly as before', (tester) async {
      await _pump(tester, _home(lead: const []));
      expect(_fold, findsNothing);
      expect(_register, findsOneWidget);
    });

    testWidgets('French, 320 wide: the labels fit', (tester) async {
      await _pump(
        tester,
        _home(lead: _fleetLead()),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text("Autres outils d'expédition"), findsOneWidget);
      expect(find.text('Aucune demande ouverte'), findsOneWidget);
      await tester.tap(_fold);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('the wiring, read from the source', () {
    final home = File('lib/screens/home_menu.dart').readAsStringSync();
    test('the home asks homeLeads with the Fleet row gate', () {
      expect(home, contains('homeLeads('));
      expect(home, contains('canOpenFleet: _showsFleetRow(auth)'));
    });
    test('the folded shipping block hides its Requests row', () {
      expect(home, contains('hideRequests: requestsLead'));
    });
    test('each Fleet place opens the Fleet page on its tab', () {
      expect(home, contains('initialTab: tab'));
      for (final tab in [
        'needs',
        'drivers',
        'plates',
        'payments',
        'paperwork',
      ]) {
        expect(home, contains('FleetTab.$tab'));
      }
    });
  });
}

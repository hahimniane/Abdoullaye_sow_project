import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/waiting_packages_screen.dart';
import 'package:my_flutter_app/services/container_loading.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_proof.dart';
import 'package:my_flutter_app/services/waiting_packages.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';

/// "Ships by: Sea · Air" (docs/AIR_PACKAGES.md §7): the choice on the
/// waiting package form, the proof section only for Air, the wrong-mode
/// refusal both ways, the Air badge and the Sea / Air filter.

ShippingContainer box({String mode = 'sea', String dest = 'guinea'}) =>
    ShippingContainer.fromMap('c1', {
      'businessId': 'b1',
      'label': 'Box 1',
      'status': 'loading',
      'shipMode': mode,
      'destinationCountryId': dest,
      'destinationCountryName': 'Guinea',
    });

ContainerLine waiting([
  Map<String, dynamic> extra = const {},
  String id = 'l1',
]) => ContainerLine.fromMap(id, {
  'businessId': 'b1',
  'containerId': '',
  'containerStatus': containerLineStatusWaiting,
  'kind': containerLineKindBarrels,
  'quantity': 2,
  'ownerKind': containerOwnerCustomer,
  'customerName': 'Fatou Diallo',
  'customerPhone': '+19175551234',
  'receiverName': 'Mariama Bah',
  'receiverPhone': '+224621234567',
  'trackingCode': 'CL-K7M4P2',
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
  ...extra,
});

Future<void> pump(
  WidgetTester tester,
  Widget child, {
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
      home: Scaffold(body: Builder(builder: (_) => child)),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> tap(WidgetTester tester, String key) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> type(WidgetTester tester, String key, String text) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.enterText(finder, text);
  await tester.pumpAndSettle();
}

void main() {
  group('the rules', () {
    test('a line reads sea unless marked air', () {
      expect(waiting().shipMode, 'sea');
      expect(waiting().isAirPackage, isFalse);
      expect(waiting({'shipMode': 'AIR'}).isAirPackage, isTrue);
    });

    test('a package rides only a container of the same mode, both ways', () {
      expect(shipModeMismatch(waiting(), box()), isNull);
      expect(
        shipModeMismatch(waiting(), box(mode: 'air')),
        'ship_mode_mismatch',
      );
      expect(
        shipModeMismatch(waiting({'shipMode': 'air'}), box()),
        'ship_mode_mismatch',
      );
      expect(
        shipModeMismatch(waiting({'shipMode': 'air'}), box(mode: 'air')),
        isNull,
      );
      // The destination still comes first.
      expect(
        assignmentRefusal(waiting(), box(mode: 'air', dest: 'senegal')),
        'destination_mismatch',
      );
      final entries = assignableLines([
        waiting(),
        waiting({'shipMode': 'air'}, 'l2'),
      ], box(mode: 'air'));
      expect(entries.map((e) => e.refusal), ['ship_mode_mismatch', null]);
      // "Still to load" never offers a package going the other way.
      expect(
        loadStillToLoadLines([
          waiting(),
          waiting({'shipMode': 'air'}, 'l2'),
        ], box(mode: 'air')).map((l) => l.id),
        ['l2'],
      );
    });

    test('the refusal names how the package goes', () {
      final sea = parseContainerRefusal({
        'reason': 'ship_mode_mismatch',
        'shipMode': 'sea',
        'lineIds': ['l1'],
      }, 'x');
      expect(sea.codes, ['ship_mode_mismatch']);
      expect(sea.lineIds, ['l1']);
      final air = parseContainerRefusal({
        'reason': 'ship_mode_mismatch',
        'shipMode': 'air',
      }, 'x');
      expect(air.codes, ['ship_mode_mismatch_air']);
      for (final code in [
        'ship_mode_mismatch',
        'ship_mode_mismatch_air',
        'ship_mode_locked',
        'ship_mode_invalid',
      ]) {
        expect(containerRefusalCodes, contains(code));
      }
      expect(
        loadRefusalMessage(
          parseLoadFailure('failed-precondition', {
            'reason': 'ship_mode_mismatch',
            'shipMode': 'air',
          }),
        ),
        LoadMessage.shipModeMismatchAir,
      );
      expect(
        loadRefusalMessage(
          parseLoadFailure('failed-precondition', {
            'reason': 'ship_mode_mismatch',
            'shipMode': 'sea',
          }),
        ),
        LoadMessage.shipModeMismatch,
      );
      expect(LoadReason.all, contains('ship_mode_mismatch'));
    });

    testWidgets('the refusal text, in English and French', (tester) async {
      late AppLocalizations en;
      late AppLocalizations fr;
      await pump(
        tester,
        Builder(
          builder: (context) {
            en = AppLocalizations.of(context)!;
            return const SizedBox();
          },
        ),
      );
      await pump(
        tester,
        Builder(
          builder: (context) {
            fr = AppLocalizations.of(context)!;
            return const SizedBox();
          },
        ),
        locale: const Locale('fr'),
      );
      expect(
        containerErrorText(en, 'ship_mode_mismatch'),
        "This package is marked to go by sea; this is a flight. Change the "
        "package's Ships by first.",
      );
      expect(
        containerErrorText(en, 'ship_mode_mismatch_air'),
        "This package is marked to go by air; this is a sea container. "
        "Change the package's Ships by first.",
      );
      for (final code in [
        'ship_mode_mismatch',
        'ship_mode_mismatch_air',
        'ship_mode_locked',
        'ship_mode_invalid',
      ]) {
        expect(
          containerErrorText(fr, code),
          isNot(containerErrorText(en, code)),
        );
      }
    });

    test('the waiting list filters by mode; the requests carry it', () {
      final lines = [
        waiting(),
        waiting({'shipMode': 'air'}, 'l2'),
      ];
      expect(filterWaitingByShipMode(lines, '').length, 2);
      expect(filterWaitingByShipMode(lines, 'air').map((l) => l.id), ['l2']);
      expect(filterWaitingByShipMode(lines, 'sea').map((l) => l.id), ['l1']);
      const draft = ContainerLineDraft(
        kind: containerLineKindBarrels,
        quantity: 1,
        ownerKind: containerOwnerCustomer,
        receiverName: 'Mariama',
        destinationCountryId: 'guinea',
        shipMode: 'air',
      );
      expect(addWaitingPackageRequest('b1', draft)['shipMode'], 'air');
      final edit = updateWaitingPackageRequest('b1', 'l1', draft);
      expect((edit['line'] as Map)['shipMode'], 'air');
      // A container line never sends one.
      expect(containerLineRecord(draft).containsKey('shipMode'), isFalse);
      const none = ContainerLineDraft(
        kind: containerLineKindBarrels,
        quantity: 1,
        ownerKind: containerOwnerCustomer,
      );
      expect(
        addWaitingPackageRequest('b1', none).containsKey('shipMode'),
        isFalse,
      );
    });
  });

  group('the waiting package form', () {
    Future<Object?> Function(String, Map<String, Object?>) caller(
      List<(String, Map<String, Object?>)> log,
    ) => (name, payload) async {
      log.add((name, payload));
      return {'lineId': 'l9', 'trackingCode': 'CL-BCDFGH'};
    };

    Future<void> open(
      WidgetTester tester,
      List<(String, Map<String, Object?>)> log, {
      PackageProofSettings settings = const PackageProofSettings(),
      ContainerLine? existing,
      Locale locale = const Locale('en'),
      double width = 430,
    }) async {
      await pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            key: const Key('open'),
            onPressed: () => showLotSheet<void>(
              context,
              waitingPackageSheetForTesting(
                caller: caller(log),
                proofSettings: settings,
                existing: existing,
                defaultDestination: const DestinationRef('guinea', 'Guinea'),
              ),
            ),
            child: const Text('open'),
          ),
        ),
        locale: locale,
        width: width,
      );
      await tap(tester, 'open');
    }

    testWidgets('has no choice and the sea form without shipsByAir', (
      tester,
    ) async {
      final log = <(String, Map<String, Object?>)>[];
      await open(tester, log);
      expect(find.byKey(const Key('ship-mode-choice')), findsNothing);
      expect(find.byKey(const Key('proof-weight')), findsNothing);
      expect(find.byKey(const Key('proof-photo-camera')), findsNothing);
      await type(tester, 'line-customer', 'Fatou Diallo');
      await type(tester, 'line-receiver', 'Mariama Bah');
      await tap(tester, 'line-save');
      final sent = log.where((c) => c.$1 == 'addWaitingPackage').single.$2;
      expect(sent['shipMode'], 'sea');
      expect(sent.containsKey('photoPaths'), isFalse);
    });

    testWidgets('Sea hides the proof fields; Air shows them', (tester) async {
      final log = <(String, Map<String, Object?>)>[];
      await open(
        tester,
        log,
        settings: const PackageProofSettings(
          shipsByAir: true,
          photosRequired: true,
        ),
      );
      expect(find.byKey(const Key('ship-mode-choice')), findsOneWidget);
      expect(find.byKey(const Key('proof-weight')), findsNothing);
      await tap(tester, 'ship-mode-air');
      expect(find.byKey(const Key('proof-weight')), findsOneWidget);
      expect(find.byKey(const Key('proof-photos-required')), findsOneWidget);
      await tap(tester, 'ship-mode-sea');
      expect(find.byKey(const Key('proof-weight')), findsNothing);
      // Sea never needs a photo, even with the switch on.
      await type(tester, 'line-customer', 'Fatou Diallo');
      await type(tester, 'line-receiver', 'Mariama Bah');
      await tap(tester, 'line-save');
      final sent = log.where((c) => c.$1 == 'addWaitingPackage').single.$2;
      expect(sent['shipMode'], 'sea');
    });

    testWidgets('opens an edit on the line\'s own mode', (tester) async {
      final log = <(String, Map<String, Object?>)>[];
      await open(
        tester,
        log,
        settings: const PackageProofSettings(shipsByAir: true),
        existing: waiting({'shipMode': 'air', 'weightLb': 3}),
      );
      expect(find.byKey(const Key('proof-weight')), findsOneWidget);
      await tap(tester, 'ship-mode-sea');
      await tap(tester, 'line-save-edit');
      final sent = log.where((c) => c.$1 == 'updateContainerLine').single.$2;
      final line = sent['line'] as Map;
      expect(line['shipMode'], 'sea');
      // Hidden, the stored proof is not sent, so it is kept.
      expect(line.containsKey('weightLb'), isFalse);
    });

    testWidgets('fits a 360 px French phone', (tester) async {
      final log = <(String, Map<String, Object?>)>[];
      await open(
        tester,
        log,
        settings: const PackageProofSettings(shipsByAir: true),
        locale: const Locale('fr'),
        width: 360,
      );
      expect(find.text('Expédié par'), findsOneWidget);
      expect(find.text('Mer'), findsOneWidget);
      await tap(tester, 'ship-mode-air');
      expect(find.text('Poids'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('a line added onto a container', () {
    Future<void> openOn(WidgetTester tester, ShippingContainer c) => pump(
      tester,
      SingleChildScrollView(
        child: containerLineFormSheetForTesting(container: c),
      ),
    );

    testWidgets('shows the proof section only on a flight', (tester) async {
      await openOn(tester, box());
      await tap(tester, 'line-kind-pieces');
      expect(find.byKey(const Key('ship-mode-choice')), findsNothing);
      expect(find.byKey(const Key('proof-weight')), findsNothing);
      await openOn(tester, box(mode: 'air'));
      await tap(tester, 'line-kind-pieces');
      expect(find.byKey(const Key('ship-mode-choice')), findsNothing);
      expect(find.byKey(const Key('proof-weight')), findsOneWidget);
    });
  });

  group('the waiting list', () {
    testWidgets('marks an air package with a badge', (tester) async {
      await pump(
        tester,
        waitingPackagesListForTesting(
          lines: [
            waiting(),
            waiting({'shipMode': 'air'}, 'l2'),
          ],
        ),
      );
      expect(find.byKey(const Key('air-package-badge')), findsOneWidget);
    });
  });
}

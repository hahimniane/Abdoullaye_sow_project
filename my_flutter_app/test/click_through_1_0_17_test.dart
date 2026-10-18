import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/business_requests_screen.dart';
import 'package:my_flutter_app/screens/customer_home_screen.dart';
import 'package:my_flutter_app/screens/package_estimate_screen.dart';
import 'package:my_flutter_app/screens/receive_request_sheet.dart';
import 'package:my_flutter_app/screens/waiting_packages_screen.dart';
import 'package:my_flutter_app/services/business_volume.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/line_pieces.dart' show LineGroupSummary;
import 'package:my_flutter_app/services/lot_ledger.dart';
import 'package:my_flutter_app/services/package_request_service.dart';
import 'package:my_flutter_app/services/package_requests.dart';
import 'package:my_flutter_app/services/waiting_packages.dart';
import 'package:my_flutter_app/theme/app_colors.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/container_volume_card.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';

import 'fixtures/fake_package_requests.dart';

/// Regressions from the release 1.0.17 pre-deploy click-through (the Flutter
/// web build at phone width against the emulators). Each group names the
/// defect it pins.

// Thursday, Oct 22, 2026, noon in New York.
final _nowMs = DateTime.utc(2026, 10, 22, 16).millisecondsSinceEpoch;

PackageRequest _req(
  String id,
  String status, [
  Map<String, dynamic> extra = const {},
]) => PackageRequest.fromMap(id, {
  'businessId': 'b1',
  'businessName': 'Conakry Express',
  'code': 'R-${id.toUpperCase()}AAAA',
  'token': 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
  'handoff': 'bring_in',
  'location': {'id': 'loc1', 'label': 'Bronx shop', 'address': '1 Main St'},
  'plannedDate': '2026-10-24',
  'sender': {'name': 'Fatou Diallo', 'phoneE164': '+19175551234', 'uid': 'u1'},
  'receiver': {'name': 'Mariama Bah', 'phoneE164': '+224621234567'},
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
  'pieces': [
    {'id': 'p1', 'kind': 'barrel', 'estimateCents': 12000},
    {'id': 'p2', 'kind': 'other', 'description': 'Flat-screen TV'},
  ],
  'status': status,
  'createdAt': DateTime.fromMillisecondsSinceEpoch(_nowMs - 3600000),
  ...extra,
});

/// A collect request whose customer left a note for the driver.
PackageRequest _collect(String id, String status) => _req(id, status, {
  'handoff': 'collect',
  'pickup': {
    'address': '12 Grand Concourse',
    'date': '2026-10-27',
    'window': 'morning',
    'note': 'Ring twice, 3rd floor',
  },
});

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  double width = 430,
}) async {
  tester.view.physicalSize = Size(width, 2400);
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
  await tester.pumpAndSettle();
}

ContainerLine _line(String id, Map<String, dynamic> extra) =>
    ContainerLine.fromMap(id, {
      'businessId': 'b1',
      'containerId': '',
      'containerStatus': containerLineStatusWaiting,
      'kind': containerLineKindBarrels,
      'quantity': 1,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'destinationCountryName': 'Guinea',
      'createdAt': DateTime(2026, 10, 1, 9, 30),
      ...extra,
    });

/// CL-Q7F3W9 went into a container with $300.00 of its pieces; its part
/// CL-Q7F3W9-2 ($45.00) waits. Payments live on the root.
final _root = _line('q7', {
  'containerId': 'c1',
  'containerStatus': containerStatusLoading,
  'trackingCode': 'CL-Q7F3W9',
  'rootLineId': 'q7',
  'lastPartIndex': 2,
  'priceCents': 30000,
  'paidCents': 0,
});
final _part = _line('q7-2', {
  'trackingCode': 'CL-Q7F3W9-2',
  'rootLineId': 'q7',
  'partIndex': 2,
  'priceCents': 4500,
  'paidCents': 0,
});

void main() {
  group('7 · a split part always shows its whole package', () {
    Widget list(
      List<ContainerLine> lines,
      Map<String, LineGroupSummary> groups, {
      List<PackageRequest> expected = const [],
    }) => Scaffold(
      body: WaitingPackagesList(
        lines: lines,
        groups: groups,
        staff: const [],
        anyAtAll: true,
        searching: false,
        onTap: null,
        onPrint: null,
        expected: expected,
      ),
    );

    testWidgets('with an Expected request above it (the click-through case)', (
      tester,
    ) async {
      // The Waiting list draws the waiting lines, but groups from every
      // line the feed holds - the root is in a container.
      final groups = lineGroupsByRoot([_root, _part]);
      await _pump(
        tester,
        list([_part], groups, expected: [_req('d', 'confirmed')]),
      );
      expect(find.text('Expected · 1'), findsOneWidget);
      // Before the fix this card read "$0.00 of $45.00" and no "Part" line.
      expect(find.text(r'$0.00 of $345.00'), findsOneWidget);
      expect(find.text(r'$0.00 of $45.00'), findsNothing);
      expect(find.byKey(const Key('waiting-part-of')), findsOneWidget);
      expect(find.text('Part 2 of CL-Q7F3W9'), findsOneWidget);
    });

    testWidgets('and without one, the same', (tester) async {
      await _pump(tester, list([_part], lineGroupsByRoot([_root, _part])));
      expect(find.text(r'$0.00 of $345.00'), findsOneWidget);
      expect(find.text('Part 2 of CL-Q7F3W9'), findsOneWidget);
    });

    testWidgets(
      'lines arriving part first: never the part alone as a balance',
      (tester) async {
        // A stream that delivers the part before its root (or a list that
        // holds only some lines) must not show the part's own price as the
        // package's balance; once the root is there, the group shows.
        await _pump(tester, list([_part], lineGroupsByRoot([_part])));
        expect(find.byKey(const Key('waiting-group-loading')), findsOneWidget);
        expect(find.byKey(const Key('package-paid-of-price')), findsNothing);
        await _pump(tester, list([_part], lineGroupsByRoot([_part, _root])));
        expect(find.byKey(const Key('waiting-group-loading')), findsNothing);
        expect(find.text(r'$0.00 of $345.00'), findsOneWidget);
        expect(groupHasRoot(lineGroupsByRoot([_part])['q7']!), isFalse);
        expect(groupHasRoot(lineGroupsByRoot([_part, _root])['q7']!), isTrue);
      },
    );

    test('every waiting card is given its group (compile-time required)', () {
      final source = File(
        'lib/screens/waiting_packages_screen.dart',
      ).readAsStringSync();
      final cards = RegExp(r'WaitingPackageCard\(').allMatches(source).length;
      final withGroup = RegExp(
        r'WaitingPackageCard\([^;]*?group: lineGroupOf\(line, groups\)',
        dotAll: true,
      ).allMatches(source).length;
      // The constructor, plus the two lists that draw cards.
      expect(cards, 3);
      expect(withGroup, 2);
      expect(source, contains('required this.group,'));
    });
  });

  group("4 · a collect request's pickup note reaches staff", () {
    testWidgets('Requests card, labelled; French too', (tester) async {
      final fake = FakePackageRequests()..initialOpen = [_collect('a', 'new')];
      await _pump(
        tester,
        BusinessRequestsScreen(
          businessId: 'b1',
          service: fake,
          canManageSettings: true,
          myUid: 'me',
        ),
      );
      expect(find.text('Note: Ring twice, 3rd floor'), findsOneWidget);
    });

    testWidgets('Expected row, in French', (tester) async {
      await _pump(
        tester,
        Scaffold(
          body: WaitingPackagesList(
            lines: const [],
            staff: const [],
            anyAtAll: false,
            searching: false,
            onTap: null,
            onPrint: null,
            expected: [_collect('e', 'confirmed')],
          ),
        ),
        locale: const Locale('fr'),
      );
      expect(find.text('Note : Ring twice, 3rd floor'), findsOneWidget);
    });

    testWidgets('the estimate screen', (tester) async {
      final fake = FakePackageRequests();
      fake.initialDocs['a'] = _collect('a', 'new');
      await _pump(
        tester,
        PackageEstimateScreen(
          businessId: 'b1',
          requestId: 'a',
          service: fake,
          myUid: 'me',
          nowMs: () => _nowMs,
          onCall: (_) async {},
        ),
      );
      expect(find.text('Note: Ring twice, 3rd floor'), findsOneWidget);
    });

    testWidgets('the Received sheet', (tester) async {
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
                request: _collect('a', 'confirmed'),
                service: fake,
                staff: const [LotStaff(id: 's1', name: 'Awa Camara')],
              ),
              child: const Text('open'),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open-receive')));
      await tester.pumpAndSettle();
      expect(find.text('Note: Ring twice, 3rd floor'), findsOneWidget);
    });

    test('a bring-in request has no pickup note', () {
      expect(_req('a', 'new').pickupNote, '');
      expect(_collect('a', 'new').pickupNote, 'Ring twice, 3rd floor');
    });
  });

  group('5 · the real pickup day and window, checked as the server does', () {
    final now = DateTime.fromMillisecondsSinceEpoch(_nowMs);

    test('today .. +60 days with a window; no day sends none', () {
      bool bad(String date, String window) =>
          estimateScheduleInvalid(date: date, window: window, now: now);
      expect(bad('', ''), isFalse);
      expect(bad('2026-10-22', 'evening'), isFalse);
      expect(bad('2026-10-21', 'evening'), isTrue);
      expect(bad('2026-12-21', 'morning'), isFalse);
      expect(bad('2026-12-22', 'morning'), isTrue);
      expect(bad('2026-10-23', ''), isTrue);
      expect(bad('nope', 'morning'), isTrue);
    });

    test('checkEstimate refuses it before the round trip', () {
      final request = _collect('a', 'new');
      final past = checkEstimate(
        request: request,
        inputs: const {'p1': '120', 'p2': '45'},
        scheduleDate: '2026-10-01',
        scheduleWindow: 'morning',
        now: now,
      );
      expect(past.reasons, ['pickup_schedule_invalid']);
      final fine = checkEstimate(
        request: request,
        inputs: const {'p1': '120', 'p2': '45'},
        scheduleDate: '2026-10-27',
        scheduleWindow: 'afternoon',
        now: now,
      );
      expect(fine.ok, isTrue);
      // A bring-in request never judges a schedule.
      expect(
        checkEstimate(
          request: _req('b', 'new'),
          inputs: const {'p1': '120', 'p2': '45'},
          scheduleDate: '2026-10-01',
          now: now,
        ).ok,
        isTrue,
      );
    });

    testWidgets('a passed preferred day is refused at the field, not sent', (
      tester,
    ) async {
      final fake = FakePackageRequests();
      fake.initialDocs['a'] = _req('a', 'new', {
        'handoff': 'collect',
        'pickup': {
          'address': '9 Elm',
          'date': '2026-10-01',
          'window': 'morning',
        },
      });
      await _pump(
        tester,
        PackageEstimateScreen(
          businessId: 'b1',
          requestId: 'a',
          service: fake,
          myUid: 'me',
          nowMs: () => _nowMs,
          onCall: (_) async {},
        ),
      );
      final price = find.byKey(const Key('estimate-price:p2'));
      await tester.ensureVisible(price);
      await tester.enterText(price, '45');
      final send = find.byKey(const Key('estimate-send'));
      await tester.ensureVisible(send);
      await tester.pumpAndSettle();
      await tester.tap(send);
      await tester.pumpAndSettle();
      expect(fake.of('sendPackageEstimate'), isEmpty);
      expect(find.byKey(const Key('estimate-schedule-error')), findsOneWidget);
    });
  });

  group('6 · a button with nothing to do looks it', () {
    BoxDecoration surface(WidgetTester tester) =>
        tester
                .widget<Container>(
                  find.byKey(const ValueKey('lot-sheet-button-surface')),
                )
                .decoration!
            as BoxDecoration;

    testWidgets('onTap null and not busy: disabled fill and muted label', (
      tester,
    ) async {
      await _pump(
        tester,
        const Scaffold(body: LotSheetButton(label: 'Send', onTap: null)),
      );
      expect(surface(tester).color, lotSheetButtonDisabledColor);
      expect(
        tester.widget<Text>(find.text('Send')).style!.color,
        AppColors.muted,
      );
    });

    testWidgets('enabled and busy keep their looks', (tester) async {
      await _pump(
        tester,
        Scaffold(
          body: LotSheetButton(label: 'Send', onTap: () {}),
        ),
      );
      expect(surface(tester).color, AppColors.cobalt);
      await _pump(
        tester,
        Scaffold(body: LotSheetButton(label: 'Send', onTap: null, busy: true)),
      );
      expect(surface(tester).color, AppColors.cobalt.withValues(alpha: 0.5));
    });

    testWidgets("Send estimate while someone else holds the lock is disabled", (
      tester,
    ) async {
      final fake = FakePackageRequests()
        ..refuse['startPackageEstimate'] =
            FakePackageRequests.failure('failed-precondition', {
              'reason': 'estimate_locked',
              'lockedByName': 'Mariama',
              'untilMs': _nowMs + 10 * 60000,
            });
      fake.initialDocs['a'] = _req('a', 'new');
      await _pump(
        tester,
        PackageEstimateScreen(
          businessId: 'b1',
          requestId: 'a',
          service: fake,
          myUid: 'me',
          nowMs: () => _nowMs,
          onCall: (_) async {},
        ),
      );
      final send = find.descendant(
        of: find.byKey(const Key('estimate-send')),
        matching: find.byKey(const ValueKey('lot-sheet-button-surface')),
      );
      expect(
        (tester.widget<Container>(send).decoration! as BoxDecoration).color,
        lotSheetButtonDisabledColor,
      );
    });
  });

  group('10 · Start a shipment offers Send a package', () {
    test('the centre truck lists every Shipping hub service', () {
      final l10n = lookupAppLocalizations(const Locale('en'));
      final routes = [
        for (final o in shipSheetOptions(l10n, sharedBarrels: true)) o.route,
      ];
      expect(routes, contains('/package-request'));
      // The Shipping hub's routes, in its order.
      final hub = File(
        'lib/screens/services_hub_screen.dart',
      ).readAsStringSync();
      final tab = hub.substring(
        hub.indexOf('class ShippingTab'),
        hub.indexOf('class CarsTab'),
      );
      final hubRoutes = [
        for (final m in RegExp(r"'(/[a-z-]+)'").allMatches(tab)) m.group(1),
      ];
      expect(routes, hubRoutes);
      expect([
        for (final o in shipSheetOptions(l10n, sharedBarrels: false)) o.route,
      ], isNot(contains('/open-barrels')));
      final send = shipSheetOptions(l10n, sharedBarrels: false).last;
      expect(send.title, 'Send a package');
    });
  });

  group('12 · This month stays live', () {
    test('the signature moves with what the month counts, not with money', () {
      final a = volumeFeedSignature([_part], const []);
      expect(volumeFeedSignature([_part, _root], const []), isNot(a));
      final paid = _line('q7-2', {
        'trackingCode': 'CL-Q7F3W9-2',
        'rootLineId': 'q7',
        'partIndex': 2,
        'priceCents': 4500,
        'paidCents': 4500,
      });
      expect(volumeFeedSignature([paid], const []), a);
      final loading = ShippingContainer.fromMap('c1', {
        'businessId': 'b1',
        'status': containerStatusLoading,
      });
      final shipped = ShippingContainer.fromMap('c1', {
        'businessId': 'b1',
        'status': containerStatusShipped,
      });
      expect(
        volumeFeedSignature([_part], [loading]),
        isNot(volumeFeedSignature([_part], [shipped])),
      );
    });

    testWidgets('a change reloads the card after the recount settles', (
      tester,
    ) async {
      var calls = 0;
      final service = BusinessVolumeService(
        caller: (name, payload) async {
          calls++;
          return {
            'month': '2026-10',
            'totals': {'pieces': calls * 3, 'containersShipped': 1},
          };
        },
      );
      Widget card(Object? key) => Scaffold(
        body: ContainerVolumeCard(
          businessId: 'b1',
          service: service,
          refreshKey: key,
        ),
      );
      await _pump(tester, card(null));
      expect(calls, 1);
      expect(find.text('3 pieces received'), findsOneWidget);
      // The screen's first load is no change.
      await _pump(tester, card('a'));
      await tester.pump(const Duration(seconds: 5));
      expect(calls, 1);
      // A line received: reload once the burst settles, numbers kept meanwhile.
      await _pump(tester, card('b'));
      expect(find.text('3 pieces received'), findsOneWidget);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(calls, 2);
      expect(find.text('6 pieces received'), findsOneWidget);
      // The same key again: nothing.
      await _pump(tester, card('b'));
      await tester.pump(const Duration(seconds: 5));
      expect(calls, 2);
    });
  });

  group('13 · nobody is shown by their uid', () {
    test('the profile chain, then a word', () {
      expect(
        personDisplayName({'fullName': ' Awa ', 'email': 'a@b.co'}),
        'Awa',
      );
      expect(personDisplayName({'displayName': 'Mariama'}), 'Mariama');
      expect(personDisplayName({'name': 'Ibrahima'}), 'Ibrahima');
      expect(personDisplayName({'email': 'a@b.co'}), 'a@b.co');
      expect(personDisplayName({}), '');
      expect(
        lotStaffFromProfile('dala-owner', {}, unnamed: 'Team member').name,
        'Team member',
      );
      final owner = withBusinessOwner(
        const [],
        ownerUid: 'dala-owner',
        unnamedLabel: 'Business owner',
      ).single;
      expect(owner.id, 'dala-owner');
      expect(owner.name, 'Business owner');
      expect(
        withBusinessOwner(const [], ownerUid: 'dala-owner').single.name,
        isNot('dala-owner'),
      );
    });

    test('the screens read names through the chain, never `?? d.id`', () {
      for (final path in [
        'lib/screens/containers_screen.dart',
        'lib/screens/lot_ledger_screen.dart',
        'lib/screens/invoices_screen.dart',
        'lib/services/inventory_service.dart',
      ]) {
        final source = File(path).readAsStringSync();
        expect(
          RegExp(r"\['email'\] \?\?\s*d\.id\)").hasMatch(source),
          isFalse,
          reason: path,
        );
      }
      final containers = File(
        'lib/screens/containers_screen.dart',
      ).readAsStringSync();
      // A profile with no name that is the owner reads as the owner.
      expect(containers, contains('orElse: () => l10n.lotBusinessOwner'));
      expect(
        containers,
        contains('name: p.id == _ownerUid ? owner : l10n.lotUnnamedPerson'),
      );
    });
  });

  group('14 · one part or several, said right', () {
    test('English and French', () {
      final en = lookupAppLocalizations(const Locale('en'));
      final fr = lookupAppLocalizations(const Locale('fr'));
      expect(
        en.pcsPrintPartsMessage(1, 'CL-FMFBVS-2'),
        'CL-FMFBVS-2 stays on the waiting list under a new code, so its old '
        'labels are wrong. Print new ones now.',
      );
      expect(
        en.pcsPrintPartsMessage(2, 'CL-A-2, CL-B-2'),
        startsWith('CL-A-2, CL-B-2 stay on the waiting list under new codes'),
      );
      expect(
        fr.pcsPrintPartsMessage(1, 'CL-FMFBVS-2'),
        startsWith('CL-FMFBVS-2 reste en attente avec un nouveau code'),
      );
      expect(
        fr.pcsPrintPartsMessage(2, 'CL-A-2, CL-B-2'),
        startsWith('CL-A-2, CL-B-2 restent en attente avec de nouveaux codes'),
      );
    });
  });

  group('15 · a request photo is looked up once per path', () {
    test('the same path shares one lookup; a failure is retried', () async {
      final asked = <String>[];
      var fail = true;
      final cache = RequestPhotoUrlCache((path) async {
        asked.add(path);
        if (path == 'bad' && fail) throw StateError('offline');
        return 'https://x/$path';
      });
      final first = await Future.wait([
        for (var i = 0; i < 8; i++) cache.get('a.jpg'),
      ]);
      expect(first.toSet(), {'https://x/a.jpg'});
      expect(asked, ['a.jpg']);
      await expectLater(cache.get('bad'), throwsStateError);
      fail = false;
      expect(await cache.get('bad'), 'https://x/bad');
      expect(asked, ['a.jpg', 'bad', 'bad']);
    });

    test('it holds at most maxEntries paths', () async {
      final cache = RequestPhotoUrlCache((p) async => p, maxEntries: 2);
      await cache.get('a');
      await cache.get('b');
      await cache.get('c');
      expect(cache.length, 2);
    });

    test('the Firebase service goes through the shared cache', () {
      final source = File(
        'lib/services/package_request_service.dart',
      ).readAsStringSync();
      expect(source, contains('static final RequestPhotoUrlCache _photoUrls'));
      expect(source, contains('_photoUrls.get(path)'));
    });
  });

  group('11 · one French word per piece kind, and French money', () {
    tearDown(() => setMoneyDisplayLanguage('en'));

    test('money follows the app language: "190,00 \$" in French', () {
      expect(formatLotCents(19000), r'$190.00');
      expect(formatLotCents(19000, language: 'fr'), '190,00\u00a0\$');
      expect(formatLotCents(125050, language: 'fr'), '1\u202f250,50\u00a0\$');
      expect(formatLotCents(-500, language: 'fr'), '-5,00\u00a0\$');
      setMoneyDisplayLanguage('fr');
      expect(formatLotCents(19000), '190,00\u00a0\$');
      expect(formatRequestCents(4500), '45,00\u00a0\$');
      setMoneyDisplayLanguage('en');
      expect(formatLotCents(19000), r'$190.00');
      // The shell sets it from the chosen language.
      expect(
        File('lib/main.dart').readAsStringSync(),
        contains(
          'setMoneyDisplayLanguage(languageProvider.currentLocale.languageCode);',
        ),
      );
    });

    test('baril, carton, autre; a piece is a colis', () {
      final fr = lookupAppLocalizations(const Locale('fr'));
      expect(
        [fr.pcsKindBarrel, fr.pcsKindBox, fr.pcsKindOther],
        ['Baril', 'Carton', 'Autre'],
      );
      expect(
        [fr.prqKindBarrel, fr.prqKindBox],
        [fr.pcsKindBarrel, fr.pcsKindBox],
      );
      expect(fr.pcsAddPiece, 'Ajouter un autre colis');
      expect(fr.pcsPieceCount(3), '3 colis');
      expect(fr.pcsBoxesCount(2), '2 cartons');
      expect(fr.volumePiecesReceived(1), '1 colis reçu');
      final arb = File('lib/l10n/app_fr.arb').readAsStringSync();
      expect(RegExp(r'fûts?\b', caseSensitive: false).hasMatch(arb), isFalse);
      final pieceWords = RegExp(
        r'"(pcs|ctr|pkg|volume|wpk|prq)[A-Za-z]*": "[^"]*\bpièces?\b',
      );
      expect(pieceWords.allMatches(arb).map((m) => m.group(0)), isEmpty);
    });
  });
}

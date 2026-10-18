import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/business_requests_screen.dart';
import 'package:my_flutter_app/screens/package_estimate_screen.dart';
import 'package:my_flutter_app/screens/package_request_settings_screen.dart';
import 'package:my_flutter_app/screens/receive_request_sheet.dart';
import 'package:my_flutter_app/screens/waiting_packages_screen.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/services/package_request_service.dart';
import 'package:my_flutter_app/services/package_requests.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

import 'fixtures/fake_package_requests.dart';

/// The business side of package requests as staff meet it: Requests with
/// its two piles, the estimate editor and its lock, Expected in the Waiting
/// list, the Received sheet, and the owner's settings - in English and on a
/// narrow French phone. Firebase is the fake service.

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
  'history': [
    {'atMs': _nowMs - 3600000, 'action': 'submitted', 'byName': 'Fatou Diallo'},
  ],
  'createdAt': DateTime.fromMillisecondsSinceEpoch(_nowMs - 3600000),
  ...extra,
});

Map<String, dynamic> _estimate(int version, int total) => {
  'version': version,
  'totalCents': total,
  'pieces': [
    {'id': 'p1', 'cents': 12000},
    {'id': 'p2', 'cents': total - 12000},
  ],
};

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

Future<void> _tap(WidgetTester tester, String key) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _type(WidgetTester tester, String key, String text) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.enterText(finder, text);
  await tester.pumpAndSettle();
}

void main() {
  group('Requests', () {
    final requests = [
      _req('a', 'new'),
      _req('b', 'new', {
        'lock': {'uid': 'u9', 'name': 'Mariama', 'untilMs': 1 << 50},
        'whatsappUnreachable': true,
        'pieces': [
          {
            'id': 'p1',
            'kind': 'box',
            'description': 'Clothes',
            'photoPaths': ['packageRequestPhotos/b1/u1/abcdefgh.jpg'],
          },
        ],
      }),
      _req('c', 'estimate_sent', {'estimate': _estimate(1, 16500)}),
      _req('d', 'confirmed', {'estimate': _estimate(1, 16500)}),
    ];

    Future<FakePackageRequests> open(
      WidgetTester tester, {
      List<PackageRequest>? list,
      String focus = '',
      Locale locale = const Locale('en'),
      double width = 430,
    }) async {
      final fake = FakePackageRequests()..initialOpen = list ?? requests;
      await _pump(
        tester,
        BusinessRequestsScreen(
          businessId: 'b1',
          service: fake,
          canManageSettings: true,
          myUid: 'me',
          focusRequestId: focus,
        ),
        locale: locale,
        width: width,
      );
      return fake;
    }

    testWidgets('two piles with their counts; cards say how and when',
        (tester) async {
      await open(tester);
      expect(find.text('Needs estimate · 2'), findsOneWidget);
      expect(find.text('Waiting for customer · 1'), findsOneWidget);
      expect(find.text('Bring it in · Brings it Sat, Oct 24'), findsWidgets);
      expect(find.text('Mariama is writing the estimate'), findsOneWidget);
      expect(find.text('Customer not reachable on WhatsApp'), findsOneWidget);
      // Said the way a line's pieces are (phase 1's containerPiecesSummary).
      expect(find.textContaining('1 barrel, Flat-screen TV · Guinea'), findsOneWidget);
      // The confirmed one is Expected, in the Waiting list - not here.
      expect(find.byKey(const ValueKey('request-card:d')), findsNothing);
    });

    testWidgets('Customer agreed by phone confirms the shown version',
        (tester) async {
      final fake = await open(tester);
      await _tap(tester, 'requests-chip-waiting');
      expect(find.text(r'Estimate $165.00'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('request-agreed-by-phone:c')));
      await tester.pumpAndSettle();
      expect(find.text('Customer agreed by phone?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Customer agreed by phone'));
      await tester.pumpAndSettle();
      expect(
        fake.of('confirmPackageRequestByPhone').single,
        {'requestId': 'c', 'version': 1},
      );
      expect(find.text('Confirmed for the customer.'), findsOneWidget);
    });

    testWidgets('empty piles', (tester) async {
      await open(tester, list: const []);
      expect(find.text('Nothing to estimate'), findsOneWidget);
      await _tap(tester, 'requests-chip-waiting');
      expect(find.text('No estimate waiting for an answer'), findsOneWidget);
    });

    testWidgets('a notification opens its request', (tester) async {
      await open(tester, focus: 'c');
      expect(find.byKey(const Key('estimate-screen')), findsOneWidget);
    });

    testWidgets('fits a narrow French phone', (tester) async {
      await open(tester, locale: const Locale('fr'), width: 320);
      expect(find.text('À estimer · 2'), findsOneWidget);
      expect(find.text('En attente du client · 1'), findsOneWidget);
      expect(find.text('Mariama rédige l’estimation'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('the estimate editor', () {
    Future<FakePackageRequests> open(
      WidgetTester tester,
      PackageRequest request, {
      FakePackageRequests? service,
      Locale locale = const Locale('en'),
      double width = 430,
    }) async {
      final fake = service ?? FakePackageRequests();
      fake.initialDocs[request.id] = request;
      await _pump(
        tester,
        PackageEstimateScreen(
          businessId: 'b1',
          requestId: request.id,
          service: fake,
          myUid: 'me',
          nowMs: () => _nowMs,
          onCall: (_) async {},
        ),
        locale: locale,
        width: width,
      );
      return fake;
    }

    testWidgets('takes the lock, prefills the barrel, sends every price',
        (tester) async {
      final fake = await open(tester, _req('a', 'new'));
      expect(fake.of('startPackageEstimate').single['takeover'], isFalse);
      expect(find.byKey(const Key('estimate-lock-mine')), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byKey(const Key('estimate-price:p1'))).controller!.text,
        '120',
      );
      // A piece with no price is refused at the field.
      await _tap(tester, 'estimate-send');
      expect(find.text('Enter a price.'), findsOneWidget);
      expect(fake.of('sendPackageEstimate'), isEmpty);
      await _type(tester, 'estimate-price:p2', '45');
      await _type(tester, 'estimate-note', 'See you Saturday');
      await _tap(tester, 'estimate-send');
      expect(fake.of('sendPackageEstimate').single, {
        'businessId': 'b1',
        'requestId': 'a',
        'baseVersion': 0,
        'pieces': [
          {'id': 'p1', 'cents': 12000},
          {'id': 'p2', 'cents': 4500},
        ],
        'note': 'See you Saturday',
      });
      expect(find.text('Estimate sent.'), findsOneWidget);
      // History names who did what.
      expect(find.text('Sent by the customer'), findsOneWidget);
    });

    testWidgets('a total that went up asks the customer again', (tester) async {
      final fake = FakePackageRequests()
        ..grant = const RequestLockGrant(
          lock: RequestLock(uid: 'me', name: 'Me', untilMs: 1 << 50),
          version: 1,
        )
        ..sent = const EstimateSent(
          version: 2,
          status: 'estimate_sent',
          totalCents: 20000,
          reconfirmRequired: true,
        );
      await open(
        tester,
        _req('d', 'confirmed', {'estimate': _estimate(1, 16500)}),
        service: fake,
      );
      await _type(tester, 'estimate-price:p2', '80');
      await _tap(tester, 'estimate-send');
      expect(fake.of('sendPackageEstimate').single['baseVersion'], 1);
      expect(
        find.text(
          'Estimate sent. The total went up, so the customer must confirm again.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('someone else\'s live lock leaves it read only', (tester) async {
      final fake = FakePackageRequests()
        ..refuse['startPackageEstimate'] = FakePackageRequests.failure(
          'failed-precondition',
          {
            'reason': 'estimate_locked',
            'lockedByName': 'Mariama',
            'untilMs': _nowMs + 10 * 60000,
          },
        );
      await open(tester, _req('a', 'new'), service: fake);
      expect(find.byKey(const Key('estimate-lock-other')), findsOneWidget);
      expect(find.textContaining('Mariama is writing the estimate until'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byKey(const Key('estimate-price:p2'))).enabled,
        isFalse,
      );
      expect(find.byKey(const Key('estimate-take-over')), findsNothing);
      await _tap(tester, 'estimate-send');
      expect(fake.of('sendPackageEstimate'), isEmpty);
    });

    testWidgets('a lapsed lock can be taken over', (tester) async {
      final fake = FakePackageRequests()
        ..refuse['startPackageEstimate'] = FakePackageRequests.failure(
          'failed-precondition',
          {
            'reason': 'estimate_locked',
            'lockedByName': 'Mariama',
            'untilMs': _nowMs - 1,
          },
        );
      await open(tester, _req('a', 'new'), service: fake);
      expect(find.text('Mariama stopped writing. You can take over.'), findsOneWidget);
      fake.refuse.clear();
      await _tap(tester, 'estimate-take-over');
      expect(fake.of('startPackageEstimate').last['takeover'], isTrue);
      expect(find.byKey(const Key('estimate-lock-mine')), findsOneWidget);
    });

    testWidgets('a version that moves under the editor asks for a refresh',
        (tester) async {
      final fake = await open(
        tester,
        _req('c', 'estimate_sent', {'estimate': _estimate(1, 16500)}),
      );
      fake.grant = const RequestLockGrant(
        lock: RequestLock(uid: 'me', name: 'Me', untilMs: 1 << 50),
        version: 1,
      );
      fake.doc('c').add(
        _req('c', 'estimate_sent', {'estimate': _estimate(2, 17000)}),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('estimate-stale')), findsOneWidget);
      await _tap(tester, 'estimate-send');
      expect(fake.of('sendPackageEstimate'), isEmpty);
      await _tap(tester, 'estimate-refresh');
      expect(find.byKey(const Key('estimate-stale')), findsNothing);
      expect(
        tester.widget<TextField>(find.byKey(const Key('estimate-price:p2'))).controller!.text,
        '50',
      );
      await _tap(tester, 'estimate-send');
      expect(fake.of('sendPackageEstimate').single['baseVersion'], 2);
    });

    testWidgets('the server\'s stale answer also asks for a refresh',
        (tester) async {
      final fake = FakePackageRequests()
        ..refuse['sendPackageEstimate'] = FakePackageRequests.failure(
          'failed-precondition',
          {'reason': 'estimate_stale', 'currentVersion': 2},
        );
      await open(tester, _req('a', 'new'), service: fake);
      await _type(tester, 'estimate-price:p2', '45');
      await _tap(tester, 'estimate-send');
      expect(find.byKey(const Key('estimate-stale')), findsOneWidget);
    });

    testWidgets('Decline needs a reason', (tester) async {
      final fake = await open(tester, _req('a', 'new'));
      await _tap(tester, 'estimate-decline');
      await _tap(tester, 'request-reason-confirm');
      expect(find.text('Give a reason.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('request-reason')), 'No TVs');
      await _tap(tester, 'request-reason-confirm');
      expect(
        fake.of('declinePackageRequest').single,
        {'requestId': 'a', 'reason': 'No TVs'},
      );
      expect(find.text('Request declined.'), findsOneWidget);
    });

    testWidgets('a closed request is read only', (tester) async {
      final fake = await open(tester, _req('a', 'received'));
      expect(find.byKey(const Key('estimate-closed')), findsOneWidget);
      expect(fake.of('startPackageEstimate'), isEmpty);
      expect(find.byKey(const Key('estimate-send')), findsNothing);
    });

    testWidgets('fits a narrow French phone, a collection', (tester) async {
      await open(
        tester,
        _req('a', 'new', {
          'handoff': 'collect',
          'pickup': {
            'address': '9 Elm St, Bronx',
            'date': '2026-10-25',
            'window': 'evening',
            'note': '',
          },
        }),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text('Envoyer l’estimation sur WhatsApp'), findsOneWidget);
      expect(find.text('Frais de ramassage (\$, facultatif)'), findsOneWidget);
      await _tap(tester, 'estimate-send');
      expect(find.text('Indiquez un prix.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('Expected in the Waiting list', () {
    Widget list(
      List<PackageRequest> expected, {
      List<String>? received,
      List<String>? cancelled,
    }) => Scaffold(
      body: WaitingPackagesList(
        lines: const [],
        staff: const [],
        anyAtAll: false,
        searching: false,
        onTap: null,
        onPrint: null,
        expected: expected,
        onReceived: (r) => received?.add(r.id),
        onCancelRequest: (r) => cancelled?.add(r.id),
      ),
    );

    testWidgets('above In the shop, with Received and Cancel', (tester) async {
      final received = <String>[];
      final cancelled = <String>[];
      await _pump(
        tester,
        list(
          [
            _req('d', 'confirmed', {'estimate': _estimate(1, 16500)}),
            _req('e', 'confirmed', {
              'handoff': 'collect',
              'pickup': {'address': '9 Elm', 'date': '2026-10-27', 'window': 'morning'},
              'payment': {'timing': 'card', 'paidCents': 24000},
              'cardOrder': {'orderId': 'o1', 'shipmentId': 's1'},
            }),
          ],
          received: received,
          cancelled: cancelled,
        ),
      );
      expect(find.text('Expected · 2'), findsOneWidget);
      expect(find.text('In the shop · 0'), findsOneWidget);
      expect(find.text('Planned Sat, Oct 24 · Bronx shop'), findsOneWidget);
      expect(find.text('Collect Tue, Oct 27, Morning · 9 Elm'), findsOneWidget);
      expect(find.text('Paid online'), findsOneWidget);
      // What is expected reads as the line it becomes (phase 1's summary),
      // never the legacy "N × description".
      expect(
        find.textContaining('1 barrel, Flat-screen TV · Guinea'),
        findsNWidgets(2),
      );
      expect(find.textContaining(' × '), findsNothing);
      expect(find.text('Picked up · Received'), findsOneWidget);
      // A card-paid order is cancelled through its card order, not here.
      expect(find.byKey(const ValueKey('expected-cancel:e')), findsNothing);
      await _tap(tester, 'expected-received:d');
      await tester.tap(find.byKey(const ValueKey('expected-cancel:d')));
      await tester.pumpAndSettle();
      expect(received, ['d']);
      expect(cancelled, ['d']);
    });

    testWidgets('fits a narrow French phone', (tester) async {
      await _pump(
        tester,
        list([_req('d', 'confirmed')]),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text('Attendus · 1'), findsOneWidget);
      expect(find.text('En boutique · 0'), findsOneWidget);
      expect(find.text('Annuler la demande'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('Received', () {
    const staff = [LotStaff(id: 's1', name: 'Awa Camara')];

    Future<({FakePackageRequests fake, List<RequestReceived?> results})> open(
      WidgetTester tester,
      PackageRequest request, {
      Locale locale = const Locale('en'),
      double width = 430,
    }) async {
      final fake = FakePackageRequests();
      final results = <RequestReceived?>[];
      await _pump(
        tester,
        Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              key: const Key('open-receive'),
              onPressed: () async => results.add(
                await showReceiveRequestSheet(
                  context,
                  businessId: 'b1',
                  request: request,
                  service: fake,
                  staff: staff,
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
        locale: locale,
        width: width,
      );
      await _tap(tester, 'open-receive');
      return (fake: fake, results: results);
    }

    String totalShown(WidgetTester tester) => tester
        .widget<Text>(find.byKey(const Key('pieces-total-amount')))
        .data!;

    testWidgets('prices from the estimate, a payment, then the line',
        (tester) async {
      final opened = await open(
        tester,
        _req('d', 'confirmed', {'estimate': _estimate(1, 16500)}),
      );
      // Phase 1's pieces editor, on the request's pieces.
      expect(find.byKey(const Key('pieces-editor')), findsOneWidget);
      expect(totalShown(tester), r'$165.00');
      await _type(tester, 'piece-price-1', '50');
      expect(totalShown(tester), r'$170.00');
      await _tap(tester, 'wpk-money-received');
      await _tap(tester, 'receive-save');
      expect(find.text('Say which staff member received the payment.'), findsNothing);
      expect(opened.fake.of('receivePackageRequest'), isEmpty);
      await _tap(tester, 'wpk-money-received-by');
      await tester.tap(find.text('Awa Camara'));
      await tester.pumpAndSettle();
      await _tap(tester, 'receive-save');
      final body = opened.fake.of('receivePackageRequest').single;
      expect(body['pieces'], [
        {'id': 'p1', 'kind': 'barrel', 'description': '', 'sizeIn': null,
          'priceCents': 12000},
        {'id': 'p2', 'kind': 'other', 'description': 'Flat-screen TV',
          'sizeIn': null, 'priceCents': 5000},
      ]);
      expect(body['payment'], {
        'amountCents': 17000,
        'method': 'cash',
        'receivedByStaffId': 's1',
      });
      expect(opened.results.single?.trackingCode, 'CL-K7M4P2');
    });

    testWidgets('adds a piece the customer brought and drops one that did '
        'not come', (tester) async {
      final opened = await open(
        tester,
        _req('d', 'confirmed', {'estimate': _estimate(1, 16500)}),
      );
      // The TV did not come.
      await _tap(tester, 'piece-remove-1');
      // A box of shoes came on top.
      await _tap(tester, 'pieces-add');
      await _tap(tester, 'piece-kind-1-box');
      await _type(tester, 'piece-description-1', 'Shoes');
      await _type(tester, 'piece-price-1', '25');
      expect(totalShown(tester), r'$145.00');
      await _tap(tester, 'receive-save');
      final body = opened.fake.of('receivePackageRequest').single;
      expect(body['pieces'], [
        {'id': 'p1', 'kind': 'barrel', 'description': '', 'sizeIn': null,
          'priceCents': 12000},
        {'id': '', 'kind': 'box', 'description': 'Shoes', 'sizeIn': null,
          'priceCents': 2500},
      ]);
    });

    testWidgets("a collection's pickup fee is inside the prices",
        (tester) async {
      await open(
        tester,
        _req('d', 'confirmed', {
          'handoff': 'collect',
          'estimate': {..._estimate(1, 16500), 'pickupFeeCents': 1000},
        }),
      );
      expect(totalShown(tester), r'$175.00');
      expect(
        find.text(r'The prices include the pickup fee in the estimate: $10.00.'),
        findsOneWidget,
      );
    });

    testWidgets('some priced and some not is refused', (tester) async {
      final opened = await open(tester, _req('d', 'confirmed'));
      // Only the barrel has a price: the TV has none.
      expect(find.text('Price every piece, or none.'), findsOneWidget);
      await _tap(tester, 'receive-save');
      expect(opened.fake.of('receivePackageRequest'), isEmpty);
    });

    testWidgets('a card-paid order takes no payment', (tester) async {
      await open(
        tester,
        _req('e', 'confirmed', {
          'estimate': _estimate(1, 24000),
          'payment': {'timing': 'card', 'paidCents': 24000},
        }),
      );
      expect(
        find.text(r'Paid online by card: $240.00. No payment to take.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('wpk-money-received')), findsNothing);
    });

    testWidgets('fits a narrow French phone', (tester) async {
      await open(
        tester,
        _req('d', 'confirmed', {'estimate': _estimate(1, 16500)}),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text('Reçu · imprimer les étiquettes'), findsOneWidget);
      expect(find.text('Le destinataire paie à l’arrivée'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('owner settings', () {
    Future<FakePackageRequests> open(
      WidgetTester tester, {
      bool canEdit = true,
      PackageRequestSettings settings = const PackageRequestSettings(
        requestSlug: 'conakry',
      ),
      Locale locale = const Locale('en'),
      double width = 430,
      List<String>? shared,
    }) async {
      final fake = FakePackageRequests()..settings = settings;
      await _pump(
        tester,
        PackageRequestSettingsScreen(
          businessId: 'b1',
          canEdit: canEdit,
          service: fake,
          locations: (_) => Stream.value(const []),
          onShare: (link) async => shared?.add(link),
        ),
        locale: locale,
        width: width,
      );
      return fake;
    }

    testWidgets('saves accept, hours, pickup areas and card barrels',
        (tester) async {
      final fake = await open(tester);
      expect(find.text('https://laawoldigital.com/r/conakry'), findsOneWidget);
      await _tap(tester, 'settings-accept');
      await _tap(tester, 'settings-pickup');
      await _tap(tester, 'settings-save');
      expect(find.text('Say which areas you cover.'), findsWidgets);
      expect(fake.of('setPackageRequestSettings'), isEmpty);
      await _type(tester, 'settings-areas', 'Bronx, Harlem');
      await _tap(tester, 'settings-card-barrels');
      await _tap(tester, 'settings-save');
      final body = fake.of('setPackageRequestSettings').single;
      expect(body['acceptRequests'], isTrue);
      expect(body['pickup'], {'enabled': true, 'areas': 'Bronx, Harlem'});
      expect(body['cardBarrelBooking'], isTrue);
      expect(body.containsKey('requestSlug'), isFalse);
      final hours = (body['openingHours'] as Map)['default'] as Map;
      expect(hours['mon'], {'open': true, 'from': '09:00', 'to': '18:00'});
      expect(hours['sun'], {'open': false, 'from': '09:00', 'to': '18:00'});
      expect(find.text('Settings saved.'), findsOneWidget);
    });

    testWidgets('the link: share and QR', (tester) async {
      final shared = <String>[];
      final fake = await open(tester, shared: shared);
      await _tap(tester, 'settings-share');
      expect(shared, ['https://laawoldigital.com/r/conakry']);
      await _tap(tester, 'settings-qr');
      expect(fake.of('getPackageRequestLinkQr').single, {'businessId': 'b1'});
      expect(
        find.text('Print it for your counter. It opens your request form.'),
        findsOneWidget,
      );
    });

    testWidgets('a slug already changed once is locked', (tester) async {
      await open(
        tester,
        settings: const PackageRequestSettings(
          requestSlug: 'conakry',
          requestSlugEdits: 1,
        ),
      );
      expect(find.text('The link name was already changed once.'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byKey(const Key('settings-slug'))).enabled,
        isFalse,
      );
    });

    testWidgets('staff read the settings and cannot save', (tester) async {
      await open(tester, canEdit: false);
      expect(
        find.text('Only the owner can change these settings.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('settings-save')), findsNothing);
      expect(find.byKey(const Key('settings-slug')), findsNothing);
      // The link and its QR are for everyone at the counter.
      expect(find.byKey(const Key('settings-qr')), findsOneWidget);
    });

    testWidgets('before the first save there is no link yet', (tester) async {
      await open(tester, settings: const PackageRequestSettings());
      expect(find.text('Save once to get your link.'), findsOneWidget);
      expect(find.byKey(const Key('settings-copy')), findsNothing);
    });

    testWidgets('fits a narrow French phone', (tester) async {
      await open(tester, locale: const Locale('fr'), width: 320);
      expect(find.text('Accepter les demandes d’envoi'), findsOneWidget);
      expect(find.text('Heures d’ouverture'), findsOneWidget);
      expect(find.text('Adresse principale'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

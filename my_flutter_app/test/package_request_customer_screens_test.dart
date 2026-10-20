import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/my_package_requests_screen.dart';
import 'package:my_flutter_app/screens/package_request_detail_screen.dart';
import 'package:my_flutter_app/screens/package_request_form_screen.dart';
import 'package:my_flutter_app/services/package_requests.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

import 'fixtures/fake_package_requests.dart';

/// The customer's package-request screens as a signed-in customer meets
/// them: the form step by step, its checks and refusals, the sent page,
/// My requests, and every state of the estimate page - in English and on a
/// narrow French phone. Firebase is the fake service.

const _customer = RequestCustomer(
  uid: 'u1',
  name: 'Fatou Diallo',
  phone: '+19175551234',
);

const _token = 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDE';

RequestOptions _options({bool bring = true, bool collect = true, int? price = 12000}) =>
    RequestOptions.fromResponse({
      'business': null,
      'options': [
        {
          'businessId': 'b1',
          'businessName': 'Conakry Express',
          'country': {'id': 'guinea', 'name': 'Guinea'},
          'barrelPriceCents': price,
          'bringIn': {
            'available': bring,
            'locations': [
              {
                'id': 'loc1',
                'label': 'Bronx shop',
                'address': '1 Main St, Bronx',
                'hours': RequestWeekHours.standard().toMap(),
              },
            ],
          },
          'collect': {'available': collect, 'areas': 'Bronx, Harlem'},
        },
      ],
    });

PackageRequest _request(String status, [Map<String, dynamic> extra = const {}]) =>
    PackageRequest.fromMap('r1', {
      'id': 'r1',
      'code': 'R-K7M4P',
      'status': status,
      'handoff': 'bring_in',
      'business': {'id': 'b1', 'name': 'Conakry Express', 'phone': '+17185550000'},
      'destination': {'id': 'guinea', 'name': 'Guinea'},
      'location': {
        'id': 'loc1',
        'label': 'Bronx shop',
        'address': '1 Main St',
        'hours': RequestWeekHours.standard().toMap(),
      },
      'plannedDate': '2026-10-24',
      'sender': {'name': 'Fatou Diallo'},
      'receiver': {'name': 'Mariama Bah'},
      'pieces': [
        {'id': 'p1', 'kind': 'barrel', 'description': ''},
        {'id': 'p2', 'kind': 'other', 'description': 'Flat-screen TV'},
      ],
      'estimate': status == 'new'
          ? null
          : {
              'version': 2,
              'totalCents': 16500,
              'pieces': [
                {'id': 'p1', 'cents': 12000},
                {'id': 'p2', 'cents': 4500},
              ],
              'note': 'Wrap the TV well',
            },
      'expiresAt': '2026-11-05T15:00:00.000Z',
      'payment': {'timing': 'at_handoff', 'paidCents': 0},
      ...extra,
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

Future<void> _tap(WidgetTester tester, String key) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _type(WidgetTester tester, String key, String text) async {
  final field = find.descendant(
    of: find.byKey(Key(key)),
    matching: find.byType(TextField),
  );
  final target = field.evaluate().isEmpty ? find.byKey(Key(key)) : field.first;
  await tester.ensureVisible(target);
  await tester.enterText(target, text);
  await tester.pumpAndSettle();
}

PackageRequestFormScreen _form(
  FakePackageRequests fake, {
  RequestCustomer? customer = _customer,
  RequestPhotoPicker? picker,
}) => PackageRequestFormScreen(
  service: fake,
  customer: customer,
  // Thursday, Oct 22, 2026, noon in New York.
  clock: () => DateTime.utc(2026, 10, 22, 16),
  photoPicker: picker ?? (_) async => null,
  addressSuggestions: (_) async => const [],
);

Future<void> _pickDay(WidgetTester tester, String key, String day) async {
  await _tap(tester, key);
  await tester.tap(find.text(day));
  await tester.pumpAndSettle();
  await tester.tap(find.text('OK'));
  await tester.pumpAndSettle();
}

void main() {
  group('Send a package', () {
    testWidgets('a signed-out phone fills the form and sends, no sign-in',
        (tester) async {
      // Scanning a business QR must never start with "Sign in": the form
      // shows at once and the sender types their own name and WhatsApp.
      final fake = FakePackageRequests()..options = _options();
      await _pump(tester, _form(fake, customer: null));
      expect(find.byKey(const Key('request-sign-in')), findsNothing);
      expect(find.text('Sign in to send a request'), findsNothing);
      await _tap(tester, 'request-bring-in');
      await _pickDay(tester, 'request-planned-day', '24');
      await _type(tester, 'request-sender-name', 'Awa Camara');
      await _type(tester, 'request-sender-phone', '9175550188');
      await _type(tester, 'request-receiver-name', 'Mariama Bah');
      await _type(tester, 'request-receiver-phone', '621234567');
      await _tap(tester, 'request-send');
      final sent = fake.of('submitPackageRequest').single;
      expect(sent['sender'], {'name': 'Awa Camara', 'phoneE164': '+19175550188'});
      expect(find.byKey(const Key('request-sent-code')), findsOneWidget);
    });

    testWidgets('a failed load says so and retries', (tester) async {
      final fake = FakePackageRequests()
        ..optionsError = FakePackageRequests.failure('unavailable');
      await _pump(tester, _form(fake));
      expect(
        find.text('You’re offline. Check your connection and try again.'),
        findsOneWidget,
      );
      fake
        ..optionsError = null
        ..options = _options();
      await _tap(tester, 'request-retry');
      expect(find.byKey(const Key('request-form')), findsOneWidget);
      expect(fake.of('listPackageRequestOptions'), hasLength(2));
    });

    testWidgets('a business that stopped taking requests', (tester) async {
      final fake = FakePackageRequests()
        ..options = RequestOptions.fromResponse({
          'business': {
            'businessId': 'b1',
            'name': 'Conakry Express',
            'acceptRequests': false,
          },
          'options': [],
        });
      await _pump(tester, _form(fake));
      expect(
        find.text('Conakry Express is not taking requests right now.'),
        findsOneWidget,
      );
    });

    testWidgets('nobody takes requests: an empty state', (tester) async {
      final fake = FakePackageRequests();
      await _pump(tester, _form(fake));
      expect(find.byKey(const Key('request-no-options')), findsOneWidget);
    });

    testWidgets('a drop-off from country to the sent page', (tester) async {
      final fake = FakePackageRequests()..options = _options();
      await _pump(tester, _form(fake));
      // One country and one business: both chosen already, the barrel price
      // shown on the business card.
      expect(find.text('Guinea'), findsOneWidget);
      expect(find.text(r'$120.00 per barrel'), findsOneWidget);
      // Nothing about handoff details until the question is answered.
      expect(find.byKey(const Key('request-planned-day')), findsNothing);
      await _tap(tester, 'request-bring-in');
      expect(find.byKey(const Key('request-pickup-address')), findsNothing);
      await _pickDay(tester, 'request-planned-day', '24');
      // The day's hours (intl puts a narrow space before AM/PM).
      expect(
        find.textContaining(RegExp(r'^Open 9:00\sAM – 6:00\sPM that day')),
        findsOneWidget,
      );
      // The sender comes from the profile.
      expect(find.text('Fatou Diallo'), findsOneWidget);
      await _type(tester, 'request-receiver-name', 'Mariama Bah');
      await _type(tester, 'request-receiver-phone', '621234567');
      expect(find.byKey(const Key('request-barrel-price:0')), findsOneWidget);
      await _tap(tester, 'request-add-piece');
      await _tap(tester, 'request-kind-1:other');
      await _type(tester, 'request-piece-description:1', 'Flat-screen TV');
      expect(
        find.text(
          'The business sends you an estimate on WhatsApp before anything is '
          'decided. You pay when you drop it off.',
        ),
        findsOneWidget,
      );
      await _tap(tester, 'request-send');

      final sent = fake.of('submitPackageRequest').single;
      expect(sent['businessId'], 'b1');
      expect(sent['handoff'], 'bring_in');
      expect(sent['locationId'], 'loc1');
      expect(sent['plannedDate'], '2026-10-24');
      expect(sent.containsKey('pickup'), isFalse);
      expect(sent['sender'], {'name': 'Fatou Diallo', 'phoneE164': '+19175551234'});
      expect(sent['receiver'], {'name': 'Mariama Bah', 'phoneE164': '+224621234567'});
      expect(sent['pieces'], [
        {'kind': 'barrel'},
        {'kind': 'other', 'description': 'Flat-screen TV'},
      ]);
      expect(sent['language'], 'en');
      expect(
        RegExp(r'^[A-Za-z0-9_-]{8,80}$').hasMatch(sent['idempotencyKey'] as String),
        isTrue,
      );

      // The sent page: the code and three next steps.
      expect(find.byKey(const Key('request-sent-code')), findsOneWidget);
      expect(find.text('R-K7M4P'), findsOneWidget);
      expect(find.text('Sent to Conakry Express'), findsOneWidget);
      expect(find.byKey(const Key('request-next-step:2')), findsOneWidget);
      expect(
        find.text('Bring your pieces on the day you planned and pay there.'),
        findsOneWidget,
      );
    });

    testWidgets('Send checks every field first and sends nothing', (tester) async {
      final fake = FakePackageRequests()..options = _options();
      await _pump(tester, _form(fake, customer: const RequestCustomer(uid: 'u1')));
      await _tap(tester, 'request-bring-in');
      await _tap(tester, 'request-kind-0:box');
      await _tap(tester, 'request-send');
      expect(fake.of('submitPackageRequest'), isEmpty);
      expect(
        find.text('Choose a day between today and 60 days from now.'),
        findsOneWidget,
      );
      expect(find.text('Enter your name.'), findsOneWidget);
      expect(
        find.text('Enter your WhatsApp number with its country code.'),
        findsOneWidget,
      );
      expect(find.text('Enter the receiver’s name.'), findsOneWidget);
      expect(find.text('Say what it is.'), findsOneWidget);
      expect(find.text('Check the highlighted fields.'), findsOneWidget);
    });

    testWidgets('a closed day is refused at the field', (tester) async {
      final fake = FakePackageRequests()..options = _options();
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-bring-in');
      // Sunday the 25th: the shop is closed.
      await _pickDay(tester, 'request-planned-day', '25');
      expect(find.text('Closed that day. Pick another day.'), findsOneWidget);
      await _type(tester, 'request-receiver-name', 'Mariama');
      await _type(tester, 'request-receiver-phone', '621234567');
      await _tap(tester, 'request-send');
      expect(find.text('The business is closed that day.'), findsOneWidget);
      expect(fake.of('submitPackageRequest'), isEmpty);
    });

    testWidgets('Collect from me asks for the pickup, and only then', (tester) async {
      final fake = FakePackageRequests()..options = _options();
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-collect');
      expect(find.text('Picks up in: Bronx, Harlem'), findsOneWidget);
      expect(find.byKey(const Key('request-planned-day')), findsNothing);
      await _type(tester, 'request-pickup-address', '9 Elm St');
      await _pickDay(tester, 'request-pickup-day', '25');
      await _tap(tester, 'request-window:evening');
      await _type(tester, 'request-receiver-name', 'Mariama');
      await _type(tester, 'request-receiver-phone', '621234567');
      await _tap(tester, 'request-send');
      final sent = fake.of('submitPackageRequest').single;
      expect(sent.containsKey('locationId'), isFalse);
      expect((sent['pickup'] as Map)['date'], '2026-10-25');
      expect((sent['pickup'] as Map)['window'], 'evening');
      expect((sent['pickup'] as Map)['address'], contains('9 Elm St'));
      expect(
        find.text('The business collects your pieces and you pay then.'),
        findsOneWidget,
      );
    });

    testWidgets('a handoff the business does not offer cannot be chosen',
        (tester) async {
      final fake = FakePackageRequests()..options = _options(collect: false);
      await _pump(tester, _form(fake));
      expect(find.text('Not offered by this business'), findsOneWidget);
      await _tap(tester, 'request-collect');
      expect(find.byKey(const Key('request-pickup-address')), findsNothing);
    });

    testWidgets('the server\'s refusal is said in our words', (tester) async {
      final fake = FakePackageRequests()
        ..options = _options()
        ..refuse['submitPackageRequest'] = FakePackageRequests.failure(
          'resource-exhausted',
          {'reason': 'rate_limited'},
        );
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-bring-in');
      await _pickDay(tester, 'request-planned-day', '24');
      await _type(tester, 'request-receiver-name', 'Mariama');
      await _type(tester, 'request-receiver-phone', '621234567');
      await _tap(tester, 'request-send');
      expect(
        find.text('Too many requests in a short time. Try again in an hour.'),
        findsOneWidget,
      );
      // Still on the form, nothing lost.
      expect(find.byKey(const Key('request-form')), findsOneWidget);
    });

    testWidgets('Send cannot go twice while it is on its way', (tester) async {
      final fake = FakePackageRequests()..options = _options();
      final gate = Completer<void>();
      fake.hold['submitPackageRequest'] = gate;
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-bring-in');
      await _pickDay(tester, 'request-planned-day', '24');
      await _type(tester, 'request-receiver-name', 'Mariama');
      await _type(tester, 'request-receiver-phone', '621234567');
      await tester.ensureVisible(find.byKey(const Key('request-send')));
      await tester.tap(find.byKey(const Key('request-send')));
      await tester.pump();
      expect(find.text('Sending…'), findsOneWidget);
      await tester.tap(find.byKey(const Key('request-send')));
      await tester.pump();
      expect(fake.of('submitPackageRequest'), hasLength(1));
      gate.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('photos upload into the business folder; a non-image is refused',
        (tester) async {
      final fake = FakePackageRequests()..options = _options();
      var bytes = Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
      await _pump(tester, _form(fake, picker: (_) async => PickedRequestPhoto(bytes)));
      await _tap(tester, 'request-bring-in');
      await _tap(tester, 'request-kind-0:other');
      await _tap(tester, 'request-add-photo:0');
      await tester.tap(find.text('Choose from photos'));
      await tester.pumpAndSettle();
      expect(fake.of('uploadPhoto').single, {'businessId': 'b1', 'type': 'image/jpeg'});
      expect(find.text('Photos: 1 of 5'), findsOneWidget);

      bytes = Uint8List.fromList([0x47, 0x49, 0x46, 0x38]);
      await _tap(tester, 'request-add-photo:0');
      await tester.tap(find.text('Take a photo'));
      await tester.pumpAndSettle();
      expect(
        find.text('Only photos can be added (JPEG, PNG or WebP).'),
        findsOneWidget,
      );
      expect(fake.of('uploadPhoto'), hasLength(1));
    });

    testWidgets('fits a narrow French phone, collection, with its errors',
        (tester) async {
      final fake = FakePackageRequests()..options = _options(price: null);
      await _pump(
        tester,
        _form(fake, customer: const RequestCustomer(uid: 'u1')),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text('Barils sur estimation'), findsWidgets);
      await _tap(tester, 'request-collect');
      await _tap(tester, 'request-kind-0:other');
      await _tap(tester, 'request-add-piece');
      await _tap(tester, 'request-send');
      expect(find.text('Indiquez l’adresse de ramassage.'), findsOneWidget);
      expect(find.text('Choisissez matin, après-midi ou soir.'), findsOneWidget);
      expect(find.text('Dites ce que c’est.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('the estimate page', () {
    Future<FakePackageRequests> open(
      WidgetTester tester,
      PackageRequest request, {
      Locale locale = const Locale('en'),
      double width = 430,
      List<String>? tracked,
    }) async {
      final fake = FakePackageRequests()..byToken = request;
      await _pump(
        tester,
        PackageRequestDetailScreen(
          token: _token,
          service: fake,
          onTrack: (_, code) => tracked?.add(code),
          onCall: (_) async {},
        ),
        locale: locale,
        width: width,
      );
      return fake;
    }

    testWidgets('waiting for the estimate', (tester) async {
      await open(tester, _request('new'));
      expect(find.byKey(const Key('request-state:waitingForEstimate')), findsOneWidget);
      expect(find.text('Conakry Express is preparing your estimate.'), findsOneWidget);
      expect(find.text('Price to come'), findsWidgets);
      expect(find.byKey(const Key('request-confirm')), findsNothing);
    });

    testWidgets('an estimate to confirm: pieces, prices, total, where, phone',
        (tester) async {
      final fake = await open(tester, _request('estimate_sent'));
      expect(find.text('Your estimate is ready'), findsOneWidget);
      expect(find.text(r'$120.00'), findsOneWidget);
      expect(find.text(r'$45.00'), findsOneWidget);
      expect(find.text(r'$165.00'), findsOneWidget);
      expect(find.text('Wrap the TV well'), findsOneWidget);
      expect(find.text('Planned for Sat, Oct 24'), findsOneWidget);
      expect(find.text('Bronx shop'), findsOneWidget);
      expect(find.text('Call Conakry Express'), findsOneWidget);
      expect(find.textContaining('Answer by'), findsOneWidget);
      await _tap(tester, 'request-confirm');
      expect(
        fake.of('confirmPackageEstimate').single,
        {'token': _token, 'version': 2},
      );
      expect(find.text('Estimate confirmed.'), findsOneWidget);
    });

    testWidgets('confirming a version that just changed shows the new one',
        (tester) async {
      final fake = await open(tester, _request('estimate_sent'));
      fake
        ..refuse['confirmPackageEstimate'] = FakePackageRequests.failure(
          'failed-precondition',
          {'reason': 'estimate_changed', 'currentVersion': 3},
        )
        ..byToken = _request('estimate_sent', {
          'estimate': {
            'version': 3,
            'totalCents': 17000,
            'pieces': [
              {'id': 'p1', 'cents': 12000},
              {'id': 'p2', 'cents': 5000},
            ],
          },
        });
      await _tap(tester, 'request-confirm');
      expect(find.byKey(const Key('request-changed-banner')), findsOneWidget);
      expect(find.text(r'$170.00'), findsOneWidget);
      fake.refuse.clear();
      await _tap(tester, 'request-confirm');
      expect(fake.of('confirmPackageEstimate').last['version'], 3);
    });

    testWidgets('No thanks asks why (optional) and tells the business',
        (tester) async {
      final fake = await open(tester, _request('estimate_sent'));
      await _tap(tester, 'request-no-thanks');
      expect(find.text('Say no to this estimate?'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('request-reason')), 'Too much');
      await _tap(tester, 'request-reason-confirm');
      expect(
        fake.of('declinePackageEstimate').single,
        {'token': _token, 'reason': 'Too much'},
      );
      expect(find.text('Done. The business is told.'), findsOneWidget);
    });

    testWidgets('confirmed, with the price-down note', (tester) async {
      await open(tester, _request('confirmed', {'priceDropped': true}));
      expect(find.text('You confirmed this estimate'), findsOneWidget);
      expect(
        find.text('The price went down since you confirmed. Nothing else to do.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('request-confirm')), findsNothing);
    });

    testWidgets('confirmed by phone', (tester) async {
      await open(tester, _request('confirmed', {'confirmedVia': 'staff_phone'}));
      expect(find.text('Confirmed by phone with Conakry Express'), findsOneWidget);
    });

    testWidgets('declined and cancelled show the reason', (tester) async {
      await open(tester, _request('declined', {'declineReason': 'We no longer ship TVs'}));
      expect(find.text('Conakry Express declined this request'), findsOneWidget);
      expect(find.text('Reason: We no longer ship TVs'), findsOneWidget);
    });

    testWidgets('cancelled', (tester) async {
      await open(tester, _request('cancelled', {'declineReason': 'Never came'}));
      expect(find.text('Conakry Express cancelled this request'), findsOneWidget);
      expect(find.text('Reason: Never came'), findsOneWidget);
    });

    testWidgets('the customer said no', (tester) async {
      await open(tester, _request('customer_declined'));
      expect(find.text('You said no to this estimate'), findsOneWidget);
    });

    testWidgets('expired', (tester) async {
      await open(tester, _request('expired'));
      expect(find.text('This request expired'), findsOneWidget);
      expect(
        find.text('Send a new request if you still need to ship.'),
        findsOneWidget,
      );
    });

    testWidgets('received: the tracking code opens tracking', (tester) async {
      final tracked = <String>[];
      await open(
        tester,
        _request('received', {'trackingCode': 'CL-K7M4P2'}),
        tracked: tracked,
      );
      expect(find.text('Conakry Express received your pieces'), findsOneWidget);
      expect(find.text('Tracking code CL-K7M4P2'), findsOneWidget);
      await _tap(tester, 'request-track');
      expect(tracked, ['CL-K7M4P2']);
    });

    testWidgets('an unknown link says it cannot be found', (tester) async {
      final fake = FakePackageRequests();
      await _pump(tester, PackageRequestDetailScreen(token: _token, service: fake));
      expect(find.text('This request can’t be found.'), findsOneWidget);
    });

    testWidgets('a sender\'s own request stays live from its document',
        (tester) async {
      final fake = FakePackageRequests()
        ..byToken = _request('new')
        ..initialDocs['r1'] = PackageRequest.fromMap('r1', {
          'status': 'new',
          'token': _token,
          'businessName': 'Conakry Express',
        });
      await _pump(
        tester,
        PackageRequestDetailScreen(requestId: 'r1', service: fake),
      );
      expect(find.text('Conakry Express is preparing your estimate.'), findsOneWidget);
      fake.byToken = _request('estimate_sent');
      fake.doc('r1').add(PackageRequest.fromMap('r1', {
        'status': 'estimate_sent',
        'token': _token,
        'estimate': {'version': 2, 'totalCents': 16500},
      }));
      await tester.pumpAndSettle();
      expect(find.text('Your estimate is ready'), findsOneWidget);
      expect(fake.of('getPackageRequestByToken').length, greaterThanOrEqualTo(2));
    });

    testWidgets('fits a narrow French phone', (tester) async {
      await open(
        tester,
        _request('estimate_sent'),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text('Votre estimation est prête'), findsOneWidget);
      expect(find.text('Confirmer'), findsOneWidget);
      expect(find.text('Non merci'), findsOneWidget);
      expect(find.text('Prévu le sam. 24 oct.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('My requests', () {
    PackageRequest mine(String id, String status) => PackageRequest.fromMap(id, {
      'businessName': 'Conakry Express',
      'code': 'R-$id',
      'status': status,
      'token': _token,
      'destinationCountryName': 'Guinea',
      'pieces': [
        {'id': 'p1', 'kind': 'barrel'},
        {'id': 'p2', 'kind': 'barrel'},
        {'id': 'p3', 'kind': 'box', 'description': 'Clothes'},
      ],
      'estimate': status == 'new' ? null : {'version': 1, 'totalCents': 25000},
      'createdAt': DateTime(2026, 10, 20),
    });

    testWidgets('lists them with status, pieces and total', (tester) async {
      final fake = FakePackageRequests()
        ..initialMine = [mine('AAAAA', 'estimate_sent'), mine('BBBBB', 'new')];
      await _pump(
        tester,
        MyPackageRequestsScreen(service: fake, customer: _customer),
      );
      expect(find.text('Estimate ready'), findsOneWidget);
      expect(find.text('Waiting for estimate'), findsOneWidget);
      expect(find.text('R-AAAAA · 2 barrels · 1 box · Guinea'), findsOneWidget);
      expect(find.text(r'Estimate $250.00 · Sent Oct 20, 2026'), findsOneWidget);
      expect(fake.calls.first.$1, 'watchMine');
      expect(fake.calls.first.$2, {'uid': 'u1'});
    });

    testWidgets('empty, and signed out', (tester) async {
      final fake = FakePackageRequests()..initialMine = const [];
      await _pump(
        tester,
        MyPackageRequestsScreen(service: fake, customer: _customer),
      );
      expect(find.byKey(const Key('my-requests-empty')), findsOneWidget);
      expect(find.text('New request'), findsOneWidget);
    });

    testWidgets('signed out asks to sign in', (tester) async {
      await _pump(tester, MyPackageRequestsScreen(service: FakePackageRequests()));
      expect(find.byKey(const Key('my-requests-sign-in')), findsOneWidget);
    });

    testWidgets('fits a narrow French phone', (tester) async {
      final fake = FakePackageRequests()
        ..initialMine = [mine('AAAAA', 'customer_declined')];
      await _pump(
        tester,
        MyPackageRequestsScreen(service: fake, customer: _customer),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text('Vous avez refusé'), findsOneWidget);
      expect(find.text('R-AAAAA · 2 barils · 1 carton · Guinea'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

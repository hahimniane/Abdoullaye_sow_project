import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/screens/package_estimate_screen.dart';
import 'package:my_flutter_app/screens/package_price_list_screen.dart';
import 'package:my_flutter_app/screens/package_request_detail_screen.dart';
import 'package:my_flutter_app/screens/package_request_form_screen.dart';
import 'package:my_flutter_app/services/business_price_list.dart';
import 'package:my_flutter_app/services/package_request_compare.dart';
import 'package:my_flutter_app/services/package_requests.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

import 'fixtures/fake_package_requests.dart';

/// Box sizes and Pay now in the app (docs/PACKAGE_BOX_SIZES_PAY_NOW.md): the
/// customer's box line, the card link on a request, what staff see of a box
/// and of a payment, the Pay now switch and the Box sizes prices. Firebase is
/// the fake service.

const _token = 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDE';
final _nowMs = DateTime.utc(2026, 10, 22, 16).millisecondsSinceEpoch;

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  double width = 430,
}) async {
  tester.view.physicalSize = Size(width, 6000);
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

// ---------------------------------------------------------------------------
// The pure parts.
// ---------------------------------------------------------------------------

void main() {
  group('pieces and Pay now as the server writes them', () {
    test('a box piece reads its size, inches and price snapshot', () {
      final piece = RequestPiece.fromMap({
        'id': 'p1',
        'kind': 'box',
        'boxSize': 'large',
        'dimsIn': {'l': 30, 'w': 24, 'h': 20.5},
        'quantity': 2,
        'price': {
          'source': 'box_size',
          'boxSize': 'large',
          'label': 'Large box',
          'quantity': 2,
          'unitCents': 5000,
        },
      });
      expect(piece.isSizedBox, isTrue);
      expect(piece.boxSize, 'large');
      expect(piece.dimsIn!.text, '30 × 24 × 20.5 in');
      // The size comes from the price when the piece says none.
      expect(
        RequestPiece.fromMap({
          'id': 'p2',
          'kind': 'box',
          'price': {'source': 'box_size', 'boxSize': 'small'},
        }).boxSize,
        'small',
      );
      // An old described box is not a sized one.
      expect(
        RequestPiece.fromMap({
          'id': 'p3',
          'kind': 'box',
          'description': 'Books',
        }).isSizedBox,
        isFalse,
      );
    });

    test('payNow reads the token projection and the business document', () {
      final open = RequestPayNow.fromMap({
        'status': 'open',
        'amountCents': 13000,
        'linkUrl': 'https://laawoldigital.com/p?t=abc',
        'paidCents': 0,
        'refundedCents': 0,
      })!;
      expect(open.canPay, isTrue);
      expect(open.wasPaid, isFalse);
      final doc = RequestPayNow.fromMap({
        'status': 'partly_refunded',
        'amountCents': 13000,
        'paidCents': 13000,
        'refundedCents': 3000,
        'chargeType': 'platform',
        'refunds': [
          {'amountCents': 3000, 'byName': 'Mariama', 'reason': 'Too big'},
        ],
        'messages': [
          {'ok': true},
        ],
      })!;
      expect(doc.wasPaid, isTrue);
      expect(doc.keptCents, 10000);
      expect(doc.refunds.single.byName, 'Mariama');
      expect(doc.messageCount, 1);
      expect(RequestPayNow.fromMap(null), isNull);
      expect(RequestPayNow.fromMap({'amountCents': 5}), isNull);
    });

    test('balance, overpaid and refundable follow what the card kept', () {
      const paid = RequestPayNow(
        status: 'paid',
        paidCents: 13000,
        amountCents: 13000,
      );
      // Total rose: the difference is paid at the counter.
      expect(payNowBalanceCents(15000, paid), 2000);
      expect(payNowOverpaidCents(15000, paid), 0);
      // Total fell: staff are prompted to refund the difference.
      expect(payNowBalanceCents(11000, paid), 0);
      expect(payNowOverpaidCents(11000, paid), 2000);
      expect(payNowRefundableCents(paid), 13000);
      const open = RequestPayNow(status: 'open', amountCents: 13000);
      expect(payNowBalanceCents(15000, open), 0);
      expect(payNowRefundableCents(open), 0);
      expect(payNowBalanceCents(null, paid), 0);
    });

    test('who may refund, and what a refund may be', () {
      expect(canRefundPayNow(isStaff: false, permissions: const []), isTrue);
      expect(
        canRefundPayNow(isStaff: true, permissions: const ['containers']),
        isFalse,
      );
      expect(
        canRefundPayNow(isStaff: true, permissions: const ['void']),
        isFalse,
      );
      expect(
        canRefundPayNow(isStaff: true, permissions: const ['ledger']),
        isFalse,
      );
      expect(
        canRefundPayNow(
            isStaff: true, permissions: const ['containers', 'ledger']),
        isTrue,
      );
      expect(parseRefundCents('12.50', 2000), 1250);
      expect(parseRefundCents('0', 2000), isNull);
      expect(parseRefundCents('20.01', 2000), isNull);
      expect(parseRefundCents('x', 2000), isNull);
    });

    test('the switch is one: payNow, else the old card switch', () {
      PackageRequestSettings of(Map<String, dynamic> s) =>
          PackageRequestSettings.fromBusiness({'packageRequestSettings': s});
      expect(of({'cardBarrelBooking': true}).payNow, isTrue);
      expect(of({'payNow': false, 'cardBarrelBooking': true}).payNow, isFalse);
      expect(of({}).payNow, isFalse);
      final body = requestSettingsPayload(
        businessId: 'b1',
        acceptRequests: true,
        openingHours: const {},
        pickupEnabled: false,
        pickupAreas: '',
        cardBarrelBooking: false,
        payNow: true,
      );
      expect(body['payNow'], isTrue);
      expect(body['cardBarrelBooking'], isTrue);
    });
  });

  group('the box line a customer sends', () {
    test('goes out as {kind, boxSize, dimsIn, quantity, photoPaths}', () {
      const line = BasketBox(
        boxSize: 'medium',
        dimsIn: RequestSize(24, 18, 18),
        quantity: 2,
        photoPaths: ['p/1.jpg'],
      );
      expect(line.valid, isTrue);
      expect(requestPiecePayload(line.toDraft()), {
        'kind': 'box',
        'boxSize': 'medium',
        'dimsIn': {'l': 24.0, 'w': 18.0, 'h': 18.0},
        'quantity': 2,
        'photoPaths': ['p/1.jpg'],
      });
      expect(line.toPricingPiece(), {
        'kind': 'box',
        'boxSize': 'medium',
        'dimsIn': {'l': 24.0, 'w': 18.0, 'h': 18.0},
        'quantity': 2,
      });
      // A picture alone: no inches in the payload.
      expect(
        requestPiecePayload(
          const BasketBox(boxSize: 'xl', quantity: 1).toDraft(),
        ),
        {'kind': 'box', 'boxSize': 'xl', 'quantity': 1},
      );
    });

    test('is not complete without a size or inches', () {
      expect(const BasketBox().valid, isFalse);
      expect(const BasketBox(boxSize: 'huge').valid, isFalse);
      expect(const BasketBox(boxSize: 'small', quantity: 0).valid, isFalse);
      expect(const BasketBox(dimsIn: RequestSize(10, 10, 10)).valid, isTrue);
    });

    test('the basket counts a box line as one piece', () {
      const basket = RequestBasket(
        boxes: [BasketBox(boxSize: 'small', quantity: 3)],
        barrels: 1,
      );
      expect(basket.pieceCount, 2);
      expect(basket.hasPriceable, isTrue);
      final drafts = basketDrafts(
        basket,
        const RequestCatalog(),
        RequestOption.fromMap({
          'businessId': 'b1',
          'businessName': 'X',
          'country': {'id': 'guinea', 'name': 'Guinea'},
        }),
        'sea',
      );
      expect(drafts.map((d) => d.kind), ['barrel', 'box']);
      expect(drafts.last.quantity, 3);
    });
  });

  // -------------------------------------------------------------------------
  // The customer's form.
  // -------------------------------------------------------------------------

  group('Send a package: boxes', () {
    Map<String, Object?> option({Map<String, Object?>? air}) => {
      'businessId': 'b1',
      'businessName': 'Conakry Express',
      'country': {'id': 'guinea', 'name': 'Guinea'},
      'barrelPriceCents': 12000,
      'bringIn': {
        'available': true,
        'locations': [
          {
            'id': 'loc1',
            'label': 'Bronx shop',
            'address': '1 Main St, Bronx',
            'hours': RequestWeekHours.standard().toMap(),
          },
        ],
      },
      'collect': {'available': false, 'areas': ''},
      'routes': {
        'sea': {
          'items': [],
          'perLbCents': {},
          'boxPricesCents': {'small': 2500, 'medium': 3500, 'large': 5000},
        },
        'air': air,
      },
      'departures': {
        'sea': {'dateKey': '', 'source': 'none'},
        'air': {'dateKey': '', 'source': 'none'},
      },
      'shipsByAir': air != null,
    };

    PackageRequestFormScreen form(FakePackageRequests fake) =>
        PackageRequestFormScreen(
          service: fake,
          customer: const RequestCustomer(
            uid: 'u1',
            name: 'Fatou Diallo',
            phone: '+19175551234',
          ),
          clock: () => DateTime.utc(2026, 10, 22, 16),
          photoPicker: (_) async => null,
          addressSuggestions: (_) async => const [],
        );

    Future<FakePackageRequests> open(
      WidgetTester tester, {
      Locale locale = const Locale('en'),
      double width = 430,
      Map<String, Object?>? air,
    }) async {
      final fake = FakePackageRequests()
        ..options = RequestOptions.fromResponse({
          'options': [option(air: air)],
        });
      await _pump(tester, form(fake), locale: locale, width: width);
      if (air == null) {
        // Sea is the only mode: already chosen.
      } else {
        await _tap(tester, 'request-mode:sea');
      }
      return fake;
    }

    String total(WidgetTester tester) => tester
        .widget<Text>(find.byKey(const Key('request-row-total:b1')))
        .data!;

    testWidgets('size picture cards and a quantity price the box', (
      tester,
    ) async {
      await open(tester);
      expect(find.byKey(const Key('request-add-box')), findsOneWidget);
      await _tap(tester, 'request-add-box');
      for (final id in ['small', 'medium', 'large', 'xl']) {
        expect(
          find.byKey(Key('request-box-size:0:$id')),
          findsOneWidget,
          reason: id,
        );
      }
      // Extra large says the business quotes it.
      expect(find.text('The business will quote this size.'), findsOneWidget);
      await _tap(tester, 'request-box-size:0:medium');
      await _tap(tester, 'request-box-qty:0:plus');
      await _tap(tester, 'request-bring-in');
      expect(total(tester), r'$70.00');
      // Large instead: $100.
      await _tap(tester, 'request-box-size:0:large');
      expect(total(tester), r'$100.00');
      // The quantity never goes below one.
      await _tap(tester, 'request-box-qty:0:minus');
      await _tap(tester, 'request-box-qty:0:minus');
      expect(find.byKey(const Key('request-box-qty:0:qty')), findsOneWidget);
      expect(
        tester
            .widget<Text>(find.byKey(const Key('request-box-qty:0:qty')))
            .data,
        '1',
      );
    });

    testWidgets('Know the inches? opens the designer; the size follows', (
      tester,
    ) async {
      final fake = await open(tester);
      await _tap(tester, 'request-add-box');
      await _tap(tester, 'request-box-inches:0');
      expect(find.text('Your box'), findsOneWidget);
      // "from $X" while no business is chosen.
      expect(find.byKey(const Key('box-badge')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('box-field-length')), '24');
      await tester.enterText(find.byKey(const Key('box-field-width')), '18');
      await tester.enterText(find.byKey(const Key('box-field-height')), '18');
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byKey(const Key('box-badge')),
          matching: find.textContaining('Medium'),
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('box-designer-use')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('request-box-summary:0')), findsOneWidget);
      expect(
        tester
            .widget<Text>(find.byKey(const Key('request-box-summary:0')))
            .data,
        '24 × 18 × 18 in · Medium',
      );
      // The inches decide the size: Medium is selected on the cards.
      await _tap(tester, 'request-bring-in');
      expect(total(tester), r'$35.00');
      // Choosing a picture replaces the inches.
      await _tap(tester, 'request-box-size:0:small');
      expect(find.byKey(const Key('request-box-summary:0')), findsNothing);
      expect(total(tester), r'$25.00');
      // Inches again, then send with them.
      await _tap(tester, 'request-box-inches:0');
      await tester.tap(find.byKey(const Key('box-designer-use')));
      await tester.pumpAndSettle();
      await _tap(tester, 'request-planned-day');
      await tester.tap(find.text('24'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await _tap(tester, 'request-window:10:00-12:00');
      await _type(tester, 'request-receiver-name', 'Mariama Bah');
      await _type(tester, 'request-receiver-phone', '621234567');
      await _tap(tester, 'request-send');
      final pieces = fake.of('submitPackageRequest').single['pieces'] as List;
      expect(pieces, hasLength(1));
      expect(pieces.single, {
        'kind': 'box',
        'boxSize': 'small',
        'dimsIn': {'l': 14.0, 'w': 10.0, 'h': 8.0},
        'quantity': 1,
      });
    });

    testWidgets('a box with no size and no inches stops Send', (tester) async {
      final fake = await open(tester);
      await _tap(tester, 'request-add-box');
      await _tap(tester, 'request-bring-in');
      await _tap(tester, 'request-send');
      expect(fake.of('submitPackageRequest'), isEmpty);
    });

    testWidgets('boxes are Sea only: Air hides them', (tester) async {
      await open(
        tester,
        air: {
          'items': [],
          'perLbCents': {'clothing': 900},
        },
      );
      expect(find.byKey(const Key('request-add-box')), findsOneWidget);
      await _tap(tester, 'request-add-box');
      await _tap(tester, 'request-box-size:0:small');
      await _tap(tester, 'request-mode:air');
      expect(find.byKey(const Key('request-add-box')), findsNothing);
      expect(find.byKey(const Key('request-box-size:0:small')), findsNothing);
      // Back to Sea: the box line went away with Air.
      await _tap(tester, 'request-mode:sea');
      expect(find.byKey(const Key('request-box-size:0:small')), findsNothing);
    });

    testWidgets('French on a narrow phone', (tester) async {
      await open(tester, locale: const Locale('fr'), width: 320);
      await _tap(tester, 'request-add-box');
      expect(find.text('Cartons'), findsWidgets);
      expect(find.text('Petite'), findsOneWidget);
      expect(find.text('Moyenne'), findsOneWidget);
      expect(find.text('Grande'), findsOneWidget);
      expect(find.text('Très grande'), findsOneWidget);
      expect(find.text('Vous connaissez les pouces ?'), findsOneWidget);
      await _tap(tester, 'request-box-inches:0');
      expect(find.text('Votre carton'), findsOneWidget);
      expect(find.text('Utiliser ces pouces'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  // -------------------------------------------------------------------------
  // The request page: Pay now.
  // -------------------------------------------------------------------------

  PackageRequest request(
    String status, {
    Map<String, dynamic>? payNow,
    int total = 13000,
    List<Map<String, dynamic>>? pieces,
  }) => PackageRequest.fromMap('r1', {
    'id': 'r1',
    'code': 'R-K7M4P',
    'status': status,
    'token': _token,
    'handoff': 'bring_in',
    'business': {
      'id': 'b1',
      'name': 'Conakry Express',
      'phone': '+17185550000',
    },
    'businessId': 'b1',
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
    'confirmedVia': 'form',
    'pieces':
        pieces ??
        [
          {
            'id': 'p1',
            'kind': 'box',
            'boxSize': 'large',
            'dimsIn': {'l': 30, 'w': 24, 'h': 20},
            'quantity': 2,
            'photoPaths': <String>[],
            'price': {
              'source': 'box_size',
              'boxSize': 'large',
              'label': 'Large box',
              'quantity': 2,
              'unitCents': 6500,
            },
          },
        ],
    'estimate': {
      'version': 1,
      'totalCents': total,
      'pieces': [
        {'id': 'p1', 'cents': total},
      ],
    },
    'payNow': payNow,
    'history': <Map<String, dynamic>>[],
    'createdAt': DateTime.fromMillisecondsSinceEpoch(_nowMs - 3600000),
  });

  group('the request page: Pay now and box details', () {
    Future<List<String>> open(
      WidgetTester tester,
      PackageRequest r, {
      Locale locale = const Locale('en'),
      double width = 430,
      bool opens = true,
    }) async {
      final opened = <String>[];
      final fake = FakePackageRequests()..byToken = r;
      await _pump(
        tester,
        PackageRequestDetailScreen(
          token: _token,
          service: fake,
          onCall: (_) async {},
          onOpenLink: (url) async {
            opened.add(url);
            return opens;
          },
        ),
        locale: locale,
        width: width,
      );
      return opened;
    }

    const link = 'https://laawoldigital.com/p?t=abc123';

    testWidgets('the box shows in the customer\'s words, with its inches', (
      tester,
    ) async {
      await open(tester, request('confirmed'));
      expect(find.text('2 × Large box'), findsOneWidget);
      expect(find.textContaining('30 × 24 × 20 in'), findsOneWidget);
    });

    testWidgets('an open link: an optional Pay now button opens it', (
      tester,
    ) async {
      final opened = await open(
        tester,
        request(
          'confirmed',
          payNow: {
            'status': 'open',
            'amountCents': 13000,
            'linkUrl': link,
            'paidCents': 0,
            'refundedCents': 0,
          },
        ),
      );
      expect(find.text(r'Pay now $130.00'), findsOneWidget);
      expect(find.textContaining('Optional'), findsOneWidget);
      await _tap(tester, 'pay-now-button');
      expect(opened, [link]);
    });

    testWidgets('a link that will not open says so and can be tried again', (
      tester,
    ) async {
      final opened = await open(
        tester,
        request(
          'confirmed',
          payNow: {'status': 'open', 'amountCents': 13000, 'linkUrl': link},
        ),
        opens: false,
      );
      await _tap(tester, 'pay-now-button');
      expect(
        find.text('Could not open the payment page. Try again.'),
        findsOneWidget,
      );
      await tester.pump(const Duration(seconds: 8));
      await _tap(tester, 'pay-now-button');
      expect(opened, hasLength(2));
    });

    testWidgets('paid: Paid online, no button; a higher total is a balance', (
      tester,
    ) async {
      await open(
        tester,
        request(
          'confirmed',
          total: 15000,
          payNow: {
            'status': 'paid',
            'amountCents': 13000,
            'paidCents': 13000,
            'refundedCents': 0,
          },
        ),
      );
      expect(find.byKey(const Key('pay-now-button')), findsNothing);
      expect(find.text(r'Paid online $130.00'), findsOneWidget);
      expect(find.text(r'Balance due at the counter: $20.00'), findsOneWidget);
    });

    testWidgets('refunded: Paid online and Refunded', (tester) async {
      await open(
        tester,
        request(
          'confirmed',
          payNow: {
            'status': 'refunded',
            'amountCents': 13000,
            'paidCents': 13000,
            'refundedCents': 13000,
          },
        ),
      );
      expect(find.text(r'Paid online $130.00'), findsOneWidget);
      expect(find.text(r'Refunded $130.00'), findsOneWidget);
      expect(find.byKey(const Key('pay-now-button')), findsNothing);
    });

    testWidgets('a cancelled link and no link', (tester) async {
      await open(
        tester,
        request('cancelled', payNow: {'status': 'cancelled', 'amountCents': 1}),
      );
      expect(find.byKey(const Key('pay-now-cancelled')), findsOneWidget);
      expect(find.byKey(const Key('pay-now-button')), findsNothing);
    });

    testWidgets('no payNow: nothing about it', (tester) async {
      await open(tester, request('confirmed'));
      expect(find.byKey(const Key('pay-now-card')), findsNothing);
      expect(find.byKey(const Key('pay-now-paid')), findsNothing);
    });

    testWidgets('French on a narrow phone', (tester) async {
      await open(
        tester,
        request(
          'confirmed',
          payNow: {'status': 'open', 'amountCents': 13000, 'linkUrl': link},
        ),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.textContaining('Payer maintenant'), findsOneWidget);
      expect(find.textContaining('Facultatif'), findsOneWidget);
      expect(find.text('2 × Grande boîte'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  // -------------------------------------------------------------------------
  // What staff see.
  // -------------------------------------------------------------------------

  group('the business request page', () {
    Future<FakePackageRequests> open(
      WidgetTester tester,
      PackageRequest r, {
      bool? canRefund,
      Locale locale = const Locale('en'),
      double width = 430,
      RequestPayNow? answer,
    }) async {
      final fake = FakePackageRequests()
        ..initialDocs[r.id] = r
        ..payNowAnswer = answer;
      await _pump(
        tester,
        PackageEstimateScreen(
          businessId: 'b1',
          requestId: r.id,
          service: fake,
          myUid: 'me',
          nowMs: () => _nowMs,
          onCall: (_) async {},
          canRefund: canRefund,
        ),
        locale: locale,
        width: width,
      );
      return fake;
    }

    Map<String, dynamic> paid({int refunded = 0}) => {
      'status': refunded > 0 ? 'partly_refunded' : 'paid',
      'amountCents': 13000,
      'paidCents': 13000,
      'refundedCents': refunded,
    };

    testWidgets('a box: picture, size, inches and a read-only 3D box', (
      tester,
    ) async {
      await open(tester, request('confirmed'));
      expect(find.byKey(const Key('box-detail-size')), findsOneWidget);
      expect(find.text('2 × Large'), findsOneWidget);
      expect(find.byKey(const Key('box-detail-inches')), findsOneWidget);
      expect(find.text('30 × 24 × 20 in'), findsWidgets);
      expect(find.byKey(const Key('box-detail-3d')), findsNothing);
      await _tap(tester, 'box-detail-toggle');
      expect(find.byKey(const Key('box-detail-3d')), findsOneWidget);
      // Read-only: the same box, no sliders, no fields.
      expect(find.byType(Slider), findsNothing);
      expect(find.byKey(const Key('box-readonly-dims')), findsOneWidget);
      await _tap(tester, 'box-detail-toggle');
      expect(find.byKey(const Key('box-detail-3d')), findsNothing);
    });

    testWidgets('an Extra large box without inches has no 3D box', (
      tester,
    ) async {
      await open(
        tester,
        request(
          'confirmed',
          pieces: [
            {
              'id': 'p1',
              'kind': 'box',
              'boxSize': 'xl',
              'quantity': 1,
              'photoPaths': <String>[],
            },
          ],
        ),
      );
      expect(find.byKey(const Key('box-detail-size')), findsOneWidget);
      expect(find.byKey(const Key('box-detail-toggle')), findsNothing);
    });

    testWidgets('Link sent, with Send the link again', (tester) async {
      final fake = await open(
        tester,
        request(
          'confirmed',
          payNow: {
            'status': 'open',
            'amountCents': 13000,
            'linkUrl': 'https://laawoldigital.com/p?t=x',
            'messages': [
              {'ok': true},
            ],
          },
        ),
      );
      expect(find.text('Link sent'), findsOneWidget);
      expect(find.byKey(const Key('pay-now-refund')), findsNothing);
      await _tap(tester, 'pay-now-resend');
      expect(fake.of('setPackageRequestSettings').single, {
        'action': 'pay_resend',
        'businessId': 'b1',
        'requestId': 'r1',
      });
      expect(find.text('Payment link sent.'), findsOneWidget);
    });

    testWidgets('a refusal to resend is said in words', (tester) async {
      final fake = FakePackageRequests()
        ..refuse['setPackageRequestSettings'] = FakePackageRequests.failure(
          'permission-denied',
          {'reason': 'not_allowed'},
        );
      final r = request(
        'confirmed',
        payNow: {'status': 'open', 'amountCents': 13000, 'linkUrl': 'u'},
      );
      fake.initialDocs[r.id] = r;
      await _pump(
        tester,
        PackageEstimateScreen(
          businessId: 'b1',
          requestId: r.id,
          service: fake,
          myUid: 'me',
          nowMs: () => _nowMs,
          onCall: (_) async {},
        ),
      );
      await _tap(tester, 'pay-now-resend');
      expect(
        find.text('Only the owner, an admin or staff who can void may refund.'),
        findsOneWidget,
      );
    });

    testWidgets('paid: Paid online and a Refund for who may', (tester) async {
      final fake = await open(
        tester,
        request('confirmed', payNow: paid()),
        canRefund: true,
        answer: const RequestPayNow(status: 'partly_refunded'),
      );
      expect(find.text(r'Paid online $130.00'), findsOneWidget);
      await _tap(tester, 'pay-now-refund');
      // Up to what was paid, filled in; a bigger amount is refused first.
      final amount = tester.widget<TextField>(
        find.byKey(const Key('pay-now-refund-amount')),
      );
      expect(amount.controller!.text, '130');
      await _type(tester, 'pay-now-refund-amount', '200');
      await _tap(tester, 'pay-now-refund-confirm');
      expect(find.text('That is more than was paid by card.'), findsOneWidget);
      expect(fake.of('setPackageRequestSettings'), isEmpty);
      await _type(tester, 'pay-now-refund-amount', '30,50');
      await _type(tester, 'pay-now-refund-reason', 'Box was smaller');
      await _tap(tester, 'pay-now-refund-confirm');
      expect(fake.of('setPackageRequestSettings').single, {
        'action': 'pay_refund',
        'businessId': 'b1',
        'requestId': 'r1',
        'amountCents': 3050,
        'reason': 'Box was smaller',
      });
      expect(find.text(r'Refunded $30.50.'), findsOneWidget);
    });

    testWidgets('staff who may not void never see Refund', (tester) async {
      await open(
        tester,
        request('confirmed', payNow: paid()),
        canRefund: false,
      );
      expect(find.text(r'Paid online $130.00'), findsOneWidget);
      expect(find.byKey(const Key('pay-now-refund')), findsNothing);
    });

    testWidgets('partly refunded shows both chips', (tester) async {
      await open(
        tester,
        request('confirmed', payNow: paid(refunded: 3000)),
        canRefund: true,
      );
      expect(find.text(r'Paid online $130.00'), findsOneWidget);
      expect(find.text(r'Refunded $30.00'), findsOneWidget);
    });

    testWidgets('a total that fell asks to refund the difference', (
      tester,
    ) async {
      final fake = await open(
        tester,
        request('confirmed', total: 11000, payNow: paid()),
        canRefund: true,
      );
      expect(find.byKey(const Key('pay-now-over')), findsOneWidget);
      expect(find.textContaining(r'Refund $20.00?'), findsOneWidget);
      await _tap(tester, 'pay-now-refund-difference');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('pay-now-refund-amount')))
            .controller!
            .text,
        '20',
      );
      await _tap(tester, 'pay-now-refund-confirm');
      expect(fake.of('setPackageRequestSettings').single['amountCents'], 2000);
    });

    testWidgets('a total that rose shows the balance for the counter', (
      tester,
    ) async {
      await open(tester, request('confirmed', total: 15000, payNow: paid()));
      expect(find.text(r'Balance due at the counter: $20.00'), findsOneWidget);
    });

    testWidgets('French on a narrow phone', (tester) async {
      await open(
        tester,
        request('confirmed', payNow: paid(refunded: 3000)),
        canRefund: true,
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.textContaining('Payé en ligne'), findsOneWidget);
      expect(find.text('Rembourser'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  // -------------------------------------------------------------------------
  // The price list: Box sizes.
  // -------------------------------------------------------------------------

  group('the price list: Box sizes', () {
    const guinea = DestinationCountry(
      id: 'guinea',
      name: 'Guinea',
      isActive: true,
    );

    Future<FakePackageRequests> open(
      WidgetTester tester, {
      Locale locale = const Locale('en'),
      double width = 430,
      bool canEdit = true,
      Map<String, dynamic>? sea,
    }) async {
      final fake = FakePackageRequests()
        ..priceList = PackagePriceList.fromMap({
          'routes': {
            'guinea': {
              'sea':
                  sea ??
                  {
                    'items': [],
                    'perLbCents': {'clothing': 600},
                    'boxPricesCents': {'medium': 3500},
                  },
            },
          },
        });
      await _pump(
        tester,
        PackagePriceListScreen(
          businessId: 'b1',
          service: fake,
          canEdit: canEdit,
          countries: (_) => Stream.value(const [guinea]),
        ),
        locale: locale,
        width: width,
      );
      return fake;
    }

    testWidgets('three prices and an Extra large you quote', (tester) async {
      await open(tester);
      expect(find.byKey(const Key('ppl-box-sizes')), findsOneWidget);
      expect(find.text('Box sizes'), findsOneWidget);
      expect(find.text('About a shoebox'), findsOneWidget);
      expect(find.text('About a microwave box'), findsOneWidget);
      expect(find.text('About a TV box'), findsOneWidget);
      expect(find.text('Extra large: you quote it'), findsOneWidget);
      // What is stored is what the fields open on.
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('ppl-box-field:guinea:medium')),
            )
            .controller!
            .text,
        '35',
      );
      // No price field for Extra large.
      expect(
        find.byKey(const ValueKey('ppl-box-field:guinea:xl')),
        findsNothing,
      );
    });

    testWidgets('typed prices save as boxPricesCents on the Sea route', (
      tester,
    ) async {
      final fake = await open(tester);
      await tester.enterText(
        find.byKey(const ValueKey('ppl-box-field:guinea:small')),
        '25',
      );
      await tester.enterText(
        find.byKey(const ValueKey('ppl-box-field:guinea:large')),
        '50.50',
      );
      await tester.pumpAndSettle();
      await _tap(tester, 'ppl-save');
      final routes =
          fake.of('setPackageRequestSettings').single['routes'] as Map;
      final sea = (routes['guinea'] as Map)['sea'] as Map;
      expect(sea['boxPricesCents'], {
        'small': 2500,
        'medium': 3500,
        'large': 5050,
      });
    });

    testWidgets('Air has no box prices and sends none', (tester) async {
      final fake = await open(tester);
      await _tap(tester, 'ppl-mode:air');
      expect(find.byKey(const Key('ppl-box-sizes')), findsNothing);
      await _tap(tester, 'ppl-mode:sea');
      expect(find.byKey(const Key('ppl-box-sizes')), findsOneWidget);
      expect(fake.of('setPackageRequestSettings'), isEmpty);
    });

    testWidgets('staff read the prices but cannot type', (tester) async {
      await open(tester, canEdit: false);
      final field = tester.widget<TextField>(
        find.byKey(const ValueKey('ppl-box-field:guinea:medium')),
      );
      expect(field.enabled, isFalse);
    });

    testWidgets('French on a narrow phone', (tester) async {
      await open(tester, locale: const Locale('fr'), width: 320);
      expect(find.text('Tailles de cartons'), findsOneWidget);
      expect(find.text('Très grande : vous donnez le prix'), findsOneWidget);
      expect(find.text('Moyenne'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    test('box prices ride only a Sea route in the payload', () {
      const draft = PriceRouteDraft(boxPrices: {'small': '25', 'xl': ''});
      expect(draft.toPayload()!['boxPricesCents'], {'small': 2500});
      expect(
        draft.toPayload(sea: false)!.containsKey('boxPricesCents'),
        isFalse,
      );
      expect(const PriceRouteDraft().isEmpty, isTrue);
      expect(draft.isEmpty, isFalse);
      expect(
        PriceRouteDraft.of(
          PriceRoute.fromMap({
            'boxPricesCents': {'large': 5000, 'small': 0},
          }),
        ).boxPrices,
        {'large': '50'},
      );
    });
  });
}

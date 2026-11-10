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
import 'package:my_flutter_app/widgets/package_request_compare_widgets.dart';

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

const _atlanticId = 'b1';
const _baobabId = 'b2';

/// One business as `listPackageRequestOptions` describes it for Guinea.
Map<String, Object?> _optionMap({
  String id = _atlanticId,
  String name = 'Conakry Express',
  bool bring = true,
  bool collect = true,
  int? barrel = 12000,
  Map<String, Object?>? sea,
  Map<String, Object?>? air,
  double? rating,
  int reviews = 0,
  bool covers = false,
  Map<String, Object?>? seaDeparture,
}) => {
  'businessId': id,
  'businessName': name,
  'country': {'id': 'guinea', 'name': 'Guinea'},
  'barrelPriceCents': barrel,
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
  'routes': {'sea': sea, 'air': air},
  'departures': {
    'sea': seaDeparture ?? {'dateKey': '', 'source': 'none'},
    'air': {'dateKey': '', 'source': 'none'},
  },
  'shipsByAir': air != null,
  'rating': rating,
  'reviewCount': reviews,
  'coversLoss': covers,
};

Map<String, Object?> _priceItem(String label, int cents, {int includedLb = 0}) =>
    {
      'id': 'i_${label.toLowerCase()}',
      'categoryId': 'electronics',
      'label': label,
      'priceCents': cents,
      'includedLb': includedLb,
    };

/// Conakry Express: phones $40 (up to 2 lb each) by sea, $60 by air; clothes
/// $6/lb by sea; barrels $120; picks up; rated 4.5; pays back if lost.
Map<String, Object?> _conakry({bool bring = true, bool collect = true}) =>
    _optionMap(
      bring: bring,
      collect: collect,
      sea: {
        'items': [_priceItem('Phone', 4000, includedLb: 2)],
        'perLbCents': {'clothing': 600},
      },
      air: {
        'items': [_priceItem('Phone', 6000)],
        'perLbCents': {'clothing': 900},
      },
      rating: 4.5,
      reviews: 10,
      covers: true,
      seaDeparture: {'dateKey': '2026-11-14', 'source': 'schedule'},
    );

/// Baobab Cargo: phones $35 and TVs $120 by sea, no barrels, no air, drop-off
/// only, no rating yet.
Map<String, Object?> _baobab() => _optionMap(
  id: _baobabId,
  name: 'Baobab Cargo',
  collect: false,
  barrel: null,
  sea: {
    'items': [
      _priceItem('Phone', 3500),
      {
        'id': 'i_tv',
        'categoryId': 'fragile',
        'label': 'TV',
        'priceCents': 12000,
        'includedLb': 0,
      },
    ],
    'perLbCents': {'clothing': 650},
  },
  seaDeparture: {'dateKey': '2026-11-06', 'source': 'planned'},
);

RequestOptions _response(
  List<Map<String, Object?>> options, {
  Map<String, Object?>? business,
}) => RequestOptions.fromResponse({'business': business, 'options': options});

/// Two businesses ship to Guinea: the customer compares them.
RequestOptions _bothBusinesses() => _response([_conakry(), _baobab()]);

/// One business only (what the old tests used): Conakry Express, with the
/// barrel price shown as `price`, or an estimate when null.
RequestOptions _options({
  bool bring = true,
  bool collect = true,
  int? price = 12000,
}) => _response([
  {..._conakry(bring: bring, collect: collect), 'barrelPriceCents': price},
]);

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
  // Tall, so the whole form is built: a ListView builds only what is near
  // the screen, and these tests tap down to Send.
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

PackageRequestFormScreen _form(
  FakePackageRequests fake, {
  RequestCustomer? customer = _customer,
  RequestPhotoPicker? picker,
  String slug = '',
}) => PackageRequestFormScreen(
  service: fake,
  slug: slug,
  customer: customer,
  // Thursday, Oct 22, 2026, noon in New York.
  clock: () => DateTime.utc(2026, 10, 22, 16),
  photoPicker: picker ?? (_) async => null,
  addressSuggestions: (_) async => const [],
);

/// The calendar's day [day] (Oct 2026), then OK. A day the business cannot
/// take is greyed out in the calendar: tapping it leaves the calendar on the
/// day it opened on.
Future<void> _pickDay(WidgetTester tester, String key, String day) async {
  await _tap(tester, key);
  await tester.tap(find.text(day));
  await tester.pumpAndSettle();
  await tester.tap(find.text('OK'));
  await tester.pumpAndSettle();
}

Future<void> _addPhones(WidgetTester tester, int count) async {
  for (var i = 0; i < count; i++) {
    await _tap(tester, 'request-item-phone|electronics:plus');
  }
}

/// The height of a business's card: smaller is higher up the comparison.
double _top(WidgetTester tester, String businessId) =>
    tester.getTopLeft(find.byKey(ValueKey('request-business:$businessId'))).dy;

String _totalOf(WidgetTester tester, String businessId) => tester
    .widget<Text>(find.byKey(Key('request-row-total:$businessId')))
    .data!;

/// A bring-in request to Conakry Express for [phones] phones, up to (not
/// including) the receiver.
Future<FakePackageRequests> _toBusiness(
  WidgetTester tester, {
  int phones = 2,
  RequestOptions? options,
}) async {
  final fake = FakePackageRequests()..options = options ?? _bothBusinesses();
  await _pump(tester, _form(fake));
  await _tap(tester, 'request-mode:sea');
  await _addPhones(tester, phones);
  await _tap(tester, 'request-bring-in');
  if (phones > 0) await _tap(tester, 'request-business:$_atlanticId');
  return fake;
}

Future<void> _fillPeople(WidgetTester tester) async {
  await _type(tester, 'request-receiver-name', 'Mariama Bah');
  await _type(tester, 'request-receiver-phone', '621234567');
}

void main() {
  group('Send a package: the steps', () {
    testWidgets('each step shows once the one before it is answered', (
      tester,
    ) async {
      final fake = FakePackageRequests()..options = _bothBusinesses();
      await _pump(tester, _form(fake));
      // One country: chosen already. Air is offered, so Sea or Air is asked
      // before anything is priced.
      expect(find.text('Guinea'), findsOneWidget);
      expect(find.byKey(const Key('request-mode:sea')), findsOneWidget);
      expect(find.byKey(const Key('request-mode:air')), findsOneWidget);
      expect(find.byKey(const Key('request-bring-in')), findsNothing);
      expect(find.byKey(const ValueKey('request-item:phone|electronics')),
          findsNothing);

      await _tap(tester, 'request-mode:sea');
      expect(find.byKey(const ValueKey('request-item:phone|electronics')),
          findsOneWidget);
      expect(find.byKey(const ValueKey('request-item:tv|fragile')),
          findsOneWidget);
      expect(find.byKey(const Key('request-barrels')), findsOneWidget);
      expect(find.byKey(const Key('request-bring-in')), findsOneWidget);
      // How it gets there is asked, but no business is compared before it is
      // answered, and no day before a business is chosen.
      expect(find.byKey(const ValueKey('request-business:b1')), findsNothing);
      expect(find.byKey(const Key('request-sender-name')), findsNothing);

      await _tap(tester, 'request-bring-in');
      expect(find.byKey(const Key('request-add-items-hint')), findsOneWidget);
      expect(find.byKey(const ValueKey('request-business:b1')), findsNothing);

      await _addPhones(tester, 1);
      expect(find.byKey(const ValueKey('request-business:b1')), findsOneWidget);
      expect(find.byKey(const ValueKey('request-business:b2')), findsOneWidget);
      // Two businesses: the customer chooses; until then no day, no people.
      expect(find.byKey(const Key('request-planned-day')), findsNothing);
      expect(find.byKey(const Key('request-send')), findsNothing);

      await _tap(tester, 'request-business:$_atlanticId');
      expect(find.byKey(const Key('request-planned-day')), findsOneWidget);
      expect(find.byKey(const Key('request-send')), findsOneWidget);
      // The day comes first; its time windows wait for it.
      expect(find.byKey(const Key('request-windows-hint')), findsOneWidget);
      expect(find.byKey(const Key('request-window:09:00-11:00')), findsNothing);
    });

    testWidgets('only one business ships there: it is already chosen', (
      tester,
    ) async {
      final fake = FakePackageRequests()..options = _options();
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-mode:sea');
      await _addPhones(tester, 1);
      await _tap(tester, 'request-bring-in');
      // No choosing among one: its day and people are there at once.
      expect(find.byKey(const Key('request-planned-day')), findsOneWidget);
      expect(find.byKey(const Key('request-sender-name')), findsOneWidget);
    });

    testWidgets('a country where nobody ships by air skips Sea or Air', (
      tester,
    ) async {
      final fake = FakePackageRequests()
        ..options = _response([_baobab()]);
      await _pump(tester, _form(fake));
      expect(find.byKey(const Key('request-mode:air')), findsNothing);
      // Straight to what is being sent, priced by sea.
      expect(find.byKey(const ValueKey('request-item:phone|electronics')),
          findsOneWidget);
    });
  });

  group('Send a package: comparing businesses', () {
    testWidgets('every business shows the total for these items', (
      tester,
    ) async {
      await _toBusiness(tester);
      await _tap(tester, 'request-business:$_atlanticId');
      // 2 phones: Conakry Express $40 each, but only up to 2 lb each, so the
      // counter scale can still add to it: "about". Baobab Cargo $35 each,
      // any weight.
      expect(_totalOf(tester, _atlanticId), r'about $80.00');
      expect(_totalOf(tester, _baobabId), r'$70.00');
      // The default order puts the lowest total first.
      expect(_top(tester, _baobabId), lessThan(_top(tester, _atlanticId)));
      expect(find.text('★ 4.5 (10)'), findsOneWidget);
      expect(find.text('No ratings yet'), findsOneWidget);
    });

    testWidgets('a business with no price for an item says it will quote', (
      tester,
    ) async {
      final fake = await _toBusiness(tester, phones: 0);
      // Only Baobab Cargo lists TVs.
      await _tap(tester, 'request-item-tv|fragile:plus');
      expect(_totalOf(tester, _baobabId), r'$120.00');
      expect(_totalOf(tester, _atlanticId), 'Sends you a price');
      // A phone Conakry Express can price: part of the total, one piece left.
      await _addPhones(tester, 1);
      expect(_totalOf(tester, _atlanticId), r'$40.00 + 1 to quote');
      expect(_totalOf(tester, _baobabId), r'$155.00');
      // Every piece priced comes before one left to quote.
      expect(_top(tester, _baobabId), lessThan(_top(tester, _atlanticId)));
      expect(fake.of('submitPackageRequest'), isEmpty);
    });

    testWidgets('the sorts reorder the businesses', (tester) async {
      await _toBusiness(tester);
      await _tap(tester, 'request-sort:rating');
      expect(_top(tester, _atlanticId), lessThan(_top(tester, _baobabId)));
      await _tap(tester, 'request-sort:price');
      expect(_top(tester, _baobabId), lessThan(_top(tester, _atlanticId)));
      await _tap(tester, 'request-sort:rating');
      await _tap(tester, 'request-sort:soonest');
      // Baobab Cargo's container leaves Nov 6, Conakry Express's Nov 14.
      expect(_top(tester, _baobabId), lessThan(_top(tester, _atlanticId)));
    });

    testWidgets('the filters keep only the businesses that match', (
      tester,
    ) async {
      await _toBusiness(tester);
      // Only Conakry Express picks up, pays back if lost, and has a rating.
      for (final filter in ['picksUp', 'paysBack', 'rated']) {
        await _tap(tester, 'request-filter:$filter');
        expect(find.byKey(const ValueKey('request-business:b1')),
            findsOneWidget, reason: filter);
        expect(find.byKey(const ValueKey('request-business:b2')), findsNothing,
            reason: filter);
        await _tap(tester, 'request-filter:$filter');
        expect(find.byKey(const ValueKey('request-business:b2')),
            findsOneWidget, reason: 'off again: $filter');
      }
    });

    testWidgets('filters that match nobody say so', (tester) async {
      final fake = FakePackageRequests()
        ..options = _response([_baobab(), _optionMap(
          id: 'b3',
          name: 'Dakar Cargo',
          sea: {
            'items': [_priceItem('Phone', 3800)],
          },
        )]);
      await _pump(tester, _form(fake));
      // Nobody here ships by air: no Sea or Air question.
      await _addPhones(tester, 1);
      await _tap(tester, 'request-bring-in');
      await _tap(tester, 'request-filter:rated');
      expect(find.byKey(const Key('request-no-rows')), findsOneWidget);
      expect(find.text('No business matches these filters.'), findsOneWidget);
    });

    testWidgets('when each container leaves, or that it is not confirmed', (
      tester,
    ) async {
      final fake = FakePackageRequests()
        ..options = _response([
          {
            ..._conakry(),
            'departures': {
              'sea': {
                'dateKey': '2026-11-14',
                'source': 'schedule',
                'approximate': true,
              },
              'air': {'dateKey': '', 'source': 'none'},
            },
          },
          {
            ..._baobab(),
            'departures': {
              'sea': {'dateKey': '2026-11-06', 'source': 'planned'},
              'air': {'dateKey': '', 'source': 'none'},
            },
          },
          _optionMap(
            id: 'b3',
            name: 'Dakar Cargo',
            sea: {
              'items': [_priceItem('Phone', 3800)],
            },
            seaDeparture: {'dateKey': '', 'source': 'unconfirmed'},
          ),
        ]);
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-mode:sea');
      await _addPhones(tester, 1);
      await _tap(tester, 'request-bring-in');
      String say(String id) => tester
          .widget<Text>(find.byKey(Key('request-row-departure:$id')))
          .data!;
      expect(say('b1'), 'Next container: around Nov 14');
      expect(say('b2'), 'Next container: Fri, Nov 6');
      expect(say('b3'), 'Departure date not confirmed');
    });

    testWidgets('Air offers only the businesses that ship by air', (
      tester,
    ) async {
      await _toBusiness(tester);
      await _tap(tester, 'request-mode:air');
      // The two phones carry over; Baobab Cargo does not ship by air, and
      // barrels are a sea service.
      expect(find.byKey(const ValueKey('request-business:b2')), findsNothing);
      expect(find.byKey(const ValueKey('request-business:b1')), findsOneWidget);
      expect(find.byKey(const Key('request-barrels')), findsNothing);
      expect(_totalOf(tester, _atlanticId), r'$120.00');
      // Back to Sea: both are offered again at their sea prices.
      await _tap(tester, 'request-mode:sea');
      expect(_totalOf(tester, _baobabId), r'$70.00');
      expect(_totalOf(tester, _atlanticId), r'about $80.00');
    });

    testWidgets('a business that takes no drop-offs cannot be chosen', (
      tester,
    ) async {
      final fake = FakePackageRequests()
        ..options = _response([
          _conakry(),
          _optionMap(
            id: 'b3',
            name: 'Pickup Only',
            bring: false,
            sea: {
              'items': [_priceItem('Phone', 3000)],
            },
          ),
        ]);
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-mode:sea');
      await _addPhones(tester, 1);
      await _tap(tester, 'request-bring-in');
      expect(find.text('Doesn’t take drop-offs'), findsOneWidget);
      // Pickup Only is cheaper but cannot be chosen; Conakry Express is the
      // only one left, so it is chosen already.
      expect(find.byKey(const Key('request-planned-day')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('request-business:b3')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('request-planned-day')), findsOneWidget);
      expect(_top(tester, _atlanticId),
          lessThan(_top(tester, 'b3')));
    });

    testWidgets('a business\'s own link shows that business only', (
      tester,
    ) async {
      final fake = FakePackageRequests()
        ..options = _response(
          [_conakry()],
          business: {
            'businessId': _atlanticId,
            'name': 'Conakry Express',
            'acceptRequests': true,
          },
        );
      await _pump(tester, _form(fake, slug: 'conakry'));
      expect(fake.of('listPackageRequestOptions').single['slug'], 'conakry');
      await _tap(tester, 'request-mode:sea');
      await _addPhones(tester, 1);
      await _tap(tester, 'request-bring-in');
      // "Your price", not a comparison: no sorts, no filters.
      expect(find.text('Your price'), findsOneWidget);
      expect(find.text('Compare prices'), findsNothing);
      expect(find.byKey(const Key('request-sort:best')), findsNothing);
      expect(find.byKey(const Key('request-filter:picksUp')), findsNothing);
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:10:00-12:00');
      await _fillPeople(tester);
      await _tap(tester, 'request-send');
      final sent = fake.of('submitPackageRequest').single;
      // Found through the business, not through Laawol's comparison.
      expect(sent['foundVia'], 'business');
      expect(sent['channel'], 'app');
    });
  });

  group('Send a package: what is being sent', () {
    testWidgets('size buttons fill in the pounds and the total reads about', (
      tester,
    ) async {
      final fake = FakePackageRequests()..options = _bothBusinesses();
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-mode:sea');
      await _tap(tester, 'request-bring-in');
      await _tap(tester, 'request-add-weight:clothing');
      expect(find.text('Weight (lb)'), findsOneWidget);
      await _tap(tester, 'request-size:0:suitcase');
      final field = tester.widget<TextField>(
        find.byKey(const Key('request-weight:0')),
      );
      expect(field.controller!.text, '50');
      // 50 lb at $6/lb and $6.50/lb: weighed at the counter, so "about".
      expect(_totalOf(tester, _atlanticId), r'about $300.00');
      expect(_totalOf(tester, _baobabId), r'about $325.00');

      // Typing another weight is allowed and un-selects the size button.
      bool selected(String id) => tester
          .widget<RequestPill>(find.byKey(Key('request-size:0:$id')))
          .selected;
      expect(selected('suitcase'), isTrue);
      await _type(tester, 'request-weight:0', '12,5');
      expect(selected('suitcase'), isFalse);
      expect(_totalOf(tester, _atlanticId), r'about $75.00');
      await _tap(tester, 'request-size:0:small_bag');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('request-weight:0')))
            .controller!
            .text,
        '10',
      );
      expect(_totalOf(tester, _atlanticId), r'about $60.00');
    });

    testWidgets('a weight that is not a number is refused at Send', (
      tester,
    ) async {
      final fake = FakePackageRequests()
        ..options = _response([_conakry()]);
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-mode:sea');
      await _tap(tester, 'request-bring-in');
      await _tap(tester, 'request-add-weight:clothing');
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:10:00-12:00');
      await _fillPeople(tester);
      await _type(tester, 'request-sender-name', 'Awa Camara');
      await _type(tester, 'request-sender-phone', '9175550188');
      await _tap(tester, 'request-send');
      expect(find.text('Enter the weight in pounds (0.1 to 2,000).'),
          findsOneWidget);
      expect(fake.of('submitPackageRequest'), isEmpty);
    });

    testWidgets('something else needs words, and a photo can go with it', (
      tester,
    ) async {
      final fake = FakePackageRequests()..options = _options();
      var bytes = Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
      await _pump(
        tester,
        _form(fake, picker: (_) async => PickedRequestPhoto(bytes)),
      );
      await _tap(tester, 'request-mode:sea');
      await _tap(tester, 'request-bring-in');
      await _tap(tester, 'request-add-else');
      await _tap(tester, 'request-add-photo:0');
      await tester.tap(find.text('Choose from photos'));
      await tester.pumpAndSettle();
      expect(find.text('Photos: 1 of 5'), findsOneWidget);
      // Photos go up into the business folder when it is sent, not before.
      expect(fake.of('uploadPhoto'), isEmpty);
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:10:00-12:00');
      await _fillPeople(tester);
      await _type(tester, 'request-sender-name', 'Awa Camara');
      await _type(tester, 'request-sender-phone', '9175550188');
      await _tap(tester, 'request-send');
      expect(find.text('Say what it is.'), findsOneWidget);
      expect(fake.of('submitPackageRequest'), isEmpty);

      await _type(tester, 'request-else-description:0', 'Flat-screen TV');
      await _tap(tester, 'request-send');
      expect(fake.of('uploadPhoto').single,
          {'businessId': 'b1', 'type': 'image/jpeg'});
      final piece = (fake.of('submitPackageRequest').single['pieces'] as List)
          .single as Map;
      expect(piece['kind'], 'other');
      expect(piece['description'], 'Flat-screen TV');
      expect(piece['photoPaths'], hasLength(1));
      // The ask-me piece has no price, so the business sends one.
      expect(find.byKey(const Key('request-sent-quote')), findsOneWidget);
    });

    testWidgets('a non-image is refused', (tester) async {
      final fake = FakePackageRequests()..options = _options();
      final bytes = Uint8List.fromList([0x47, 0x49, 0x46, 0x38]);
      await _pump(
        tester,
        _form(fake, picker: (_) async => PickedRequestPhoto(bytes)),
      );
      await _tap(tester, 'request-mode:sea');
      await _tap(tester, 'request-add-else');
      await _tap(tester, 'request-add-photo:0');
      await tester.tap(find.text('Take a photo'));
      await tester.pumpAndSettle();
      expect(
        find.text('Only photos can be added (JPEG, PNG or WebP).'),
        findsOneWidget,
      );
      expect(find.text('Photos: 1 of 5'), findsNothing);
    });
  });

  group('Send a package: bringing it in', () {
    testWidgets('a day and a 2-hour window inside the opening hours', (
      tester,
    ) async {
      await _toBusiness(tester);
      await _pickDay(tester, 'request-planned-day', '24');
      // The day's hours (intl puts a narrow space before AM/PM).
      expect(
        find.textContaining(RegExp(r'^Open 9:00\sAM – 6:00\sPM that day')),
        findsOneWidget,
      );
      // Every hour from 9 to 4 starts a 2-hour window inside 9-6.
      for (final from in [9, 10, 11, 12, 13, 14, 15, 16]) {
        final key = '${from.toString().padLeft(2, '0')}:00-'
            '${(from + 2).toString().padLeft(2, '0')}:00';
        expect(find.byKey(Key('request-window:$key')), findsOneWidget,
            reason: key);
      }
      expect(find.byKey(const Key('request-window:17:00-19:00')), findsNothing);
      expect(find.text('9–11 AM'), findsOneWidget);
      expect(find.text('4–6 PM'), findsOneWidget);
      await _tap(tester, 'request-window:13:00-15:00');
      expect(
        tester
            .widget<RequestPill>(
              find.byKey(const Key('request-window:13:00-15:00')),
            )
            .selected,
        isTrue,
      );
      // Choosing another day starts the window over.
      await _pickDay(tester, 'request-planned-day', '23');
      expect(
        tester
            .widget<RequestPill>(
              find.byKey(const Key('request-window:13:00-15:00')),
            )
            .selected,
        isFalse,
      );
    });

    testWidgets('today offers only the windows that have not started', (
      tester,
    ) async {
      await _toBusiness(tester);
      // It is noon: 1 PM is the first window that has not started.
      await _pickDay(tester, 'request-planned-day', '22');
      expect(find.byKey(const Key('request-window:11:00-13:00')), findsNothing);
      expect(find.byKey(const Key('request-window:12:00-14:00')), findsNothing);
      expect(find.byKey(const Key('request-window:13:00-15:00')), findsOneWidget);
      expect(find.byKey(const Key('request-window:16:00-18:00')), findsOneWidget);
    });

    testWidgets('a closed day cannot be chosen', (tester) async {
      await _toBusiness(tester);
      // Sunday the 25th: the shop is closed, so the calendar will not take it
      // and the field keeps the day it opened on (today).
      await _pickDay(tester, 'request-planned-day', '25');
      expect(find.textContaining('Oct 25'), findsNothing);
      expect(find.textContaining('Oct 22'), findsWidgets);
    });

    testWidgets('Send needs a window, and says so at the window', (
      tester,
    ) async {
      final fake = await _toBusiness(tester);
      await _pickDay(tester, 'request-planned-day', '24');
      await _fillPeople(tester);
      await _type(tester, 'request-sender-name', 'Awa Camara');
      await _type(tester, 'request-sender-phone', '9175550188');
      await _tap(tester, 'request-send');
      expect(find.byKey(const Key('request-window-error')), findsOneWidget);
      expect(find.text('Choose a time window.'), findsOneWidget);
      expect(fake.of('submitPackageRequest'), isEmpty);
      // Choosing one clears it.
      await _tap(tester, 'request-window:10:00-12:00');
      expect(find.byKey(const Key('request-window-error')), findsNothing);
    });

    testWidgets('the whole request goes to the server as priced, then the sent page', (
      tester,
    ) async {
      final fake = await _toBusiness(tester);
      fake.submitted = const RequestSubmitted(
        requestId: 'r1',
        code: 'R-K7M4P',
        token: _token,
        status: 'confirmed',
        totalCents: 8000,
      );
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:14:00-16:00');
      // The sender comes from the profile.
      expect(find.text('Fatou Diallo'), findsOneWidget);
      await _fillPeople(tester);
      // Every piece is priced: no card, you pay when you drop it off.
      expect(
        find.text('Total \$80.00. You pay at drop-off, no card now.'),
        findsOneWidget,
      );
      // "Up to 2 lb each" is weighed at the counter: said before Send.
      expect(find.byKey(const Key('request-weighed-note')), findsOneWidget);
      await _tap(tester, 'request-send');

      final sent = fake.of('submitPackageRequest').single;
      expect(sent['businessId'], 'b1');
      expect(sent['destinationCountryId'], 'guinea');
      expect(sent['handoff'], 'bring_in');
      expect(sent['shipMode'], 'sea');
      expect(sent['channel'], 'app');
      expect(sent['foundVia'], 'laawol');
      expect(sent['locationId'], 'loc1');
      expect(sent['plannedDate'], '2026-10-24');
      expect(sent['plannedWindow'], {'from': '14:00', 'to': '16:00'});
      expect(sent.containsKey('pickup'), isFalse);
      expect(sent['sender'],
          {'name': 'Fatou Diallo', 'phoneE164': '+19175551234'});
      expect(sent['receiver'],
          {'name': 'Mariama Bah', 'phoneE164': '+224621234567'});
      // A priced item goes by its id and count, never by an amount.
      expect(sent['pieces'], [
        {'priceItemId': 'i_phone', 'quantity': 2, 'label': 'Phone'},
      ]);
      expect(sent['language'], 'en');
      expect(
        RegExp(r'^[A-Za-z0-9_-]{8,80}$')
            .hasMatch(sent['idempotencyKey'] as String),
        isTrue,
      );

      // The sent page: all set, when and where, the total, the code.
      expect(find.byKey(const Key('request-sent-code')), findsOneWidget);
      expect(find.text('R-K7M4P'), findsOneWidget);
      expect(find.text('Sent to Conakry Express'), findsOneWidget);
      expect(
        find.text(
          'You’re all set — bring it Sat, Oct 24, 2–4 PM to 1 Main St, Bronx.',
        ),
        findsOneWidget,
      );
      expect(find.text(r'Total: $80.00'), findsOneWidget);
      expect(find.text('You pay at drop-off.'), findsOneWidget);
      expect(find.byKey(const Key('request-sent-weighed')), findsOneWidget);
    });

    testWidgets('a barrel is priced by the business and sent as a barrel', (
      tester,
    ) async {
      final fake = FakePackageRequests()..options = _options();
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-mode:sea');
      await _tap(tester, 'request-barrels:plus');
      await _tap(tester, 'request-bring-in');
      expect(_totalOf(tester, _atlanticId), r'$120.00');
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:09:00-11:00');
      await _fillPeople(tester);
      await _tap(tester, 'request-send');
      expect(fake.of('submitPackageRequest').single['pieces'], [
        {'kind': 'barrel'},
      ]);
    });

    testWidgets('pieces to quote: the business sends the price, not the form', (
      tester,
    ) async {
      // Conakry Express has no TV price.
      final fake = await _toBusiness(tester, phones: 1);
      await _tap(tester, 'request-item-tv|fragile:plus');
      await _tap(tester, 'request-business:$_atlanticId');
      expect(
        find.text(
          'Conakry Express will send you the price of the items to quote on '
          'WhatsApp.',
        ),
        findsOneWidget,
      );
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:09:00-11:00');
      await _fillPeople(tester);
      await _tap(tester, 'request-send');
      // The TV is not on its list: it goes as a described piece to quote.
      expect(fake.of('submitPackageRequest').single['pieces'], [
        {'priceItemId': 'i_phone', 'quantity': 1, 'label': 'Phone'},
        {'kind': 'other', 'description': 'TV'},
      ]);
      expect(find.byKey(const Key('request-sent-quote')), findsOneWidget);
    });
  });

  group('Send a package: picking it up', () {
    Future<FakePackageRequests> toAddress(WidgetTester tester) async {
      final fake = FakePackageRequests()
        ..options = _bothBusinesses()
        ..pickupQuoteAnswers = {
          _atlanticId: const PickupQuote(
            businessId: _atlanticId,
            available: true,
            priced: true,
            feeCents: 1500,
            distanceMiles: 3.2,
          ),
        };
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-mode:sea');
      await _addPhones(tester, 2);
      await _tap(tester, 'request-collect');
      return fake;
    }

    testWidgets('no prices are shown until the address has been checked', (
      tester,
    ) async {
      await toAddress(tester);
      expect(find.byKey(const Key('request-pickup-address')), findsOneWidget);
      expect(find.byKey(const Key('request-see-prices')), findsOneWidget);
      expect(find.byKey(const ValueKey('request-business:b1')), findsNothing);
      expect(find.byKey(const Key('request-planned-day')), findsNothing);
      // Checking nothing says what is missing.
      await _tap(tester, 'request-see-prices');
      expect(find.text('Enter the pickup address.'), findsOneWidget);
    });

    testWidgets('the instant pickup fee joins each total', (tester) async {
      final fake = await toAddress(tester);
      await _type(tester, 'request-pickup-address', '9 Elm St');
      await _tap(tester, 'request-see-prices');
      final ask = fake.of('listPackageRequestOptions')
          .singleWhere((c) => c['action'] == 'pickup_quote');
      expect(ask['address'], contains('9 Elm St'));
      // Only businesses that pick up are asked.
      expect(ask['businessIds'], [_atlanticId]);
      // 2 phones $80.00 + the $15.00 pickup: one number, the fee spelled out.
      expect(_totalOf(tester, _atlanticId), r'about $95.00');
      expect(find.text(r'Includes $15.00 pickup'), findsOneWidget);
      // Baobab Cargo does not pick up: shown, but not choosable.
      expect(find.text('Doesn’t pick up there'), findsOneWidget);
      // So the one that does is already chosen: its day and window follow.
      expect(find.byKey(const Key('request-pickup-day')), findsOneWidget);
    });

    testWidgets('a business whose staff set the fee says so', (tester) async {
      final fake = await toAddress(tester);
      fake.pickupQuoteAnswers = {
        _atlanticId: const PickupQuote(
          businessId: _atlanticId,
          available: true,
        ),
      };
      await _type(tester, 'request-pickup-address', '9 Elm St');
      await _tap(tester, 'request-see-prices');
      expect(find.text('Pickup fee set by the business'), findsOneWidget);
      // The total leaves the unknown fee out.
      expect(_totalOf(tester, _atlanticId), r'about $80.00');
    });

    testWidgets('a business out of range is refused in words', (tester) async {
      final fake = await toAddress(tester);
      fake.pickupQuoteAnswers = {
        _atlanticId: const PickupQuote(
          businessId: _atlanticId,
          reason: 'pickup_out_of_range',
        ),
      };
      await _type(tester, 'request-pickup-address', '9 Elm St');
      await _tap(tester, 'request-see-prices');
      expect(
        find.text('Your address is too far for this business to pick up.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('request-pickup-day')), findsNothing);
    });

    testWidgets('a failed fee check says so, and a new address asks again', (
      tester,
    ) async {
      final fake = await toAddress(tester);
      fake.refuse['listPackageRequestOptions'] =
          FakePackageRequests.failure('unavailable');
      await _type(tester, 'request-pickup-address', '9 Elm St');
      await _tap(tester, 'request-see-prices');
      expect(find.byKey(const Key('request-quote-error')), findsOneWidget);
      fake.refuse.clear();
      await _tap(tester, 'request-see-prices');
      expect(find.byKey(const Key('request-quote-error')), findsNothing);
      expect(find.byKey(const ValueKey('request-business:b1')), findsOneWidget);
      // A fee is for one address: change it and the prices go until checked.
      await _type(tester, 'request-pickup-address', '77 Oak Ave');
      expect(find.byKey(const ValueKey('request-business:b1')), findsNothing);
      expect(find.byKey(const Key('request-pickup-day')), findsNothing);
      // Let the address field's suggestion timer run out.
      await tester.pump(const Duration(seconds: 2));
    });

    testWidgets('a day, a window and the note go with the pickup', (
      tester,
    ) async {
      final fake = await toAddress(tester);
      await _type(tester, 'request-pickup-address', '9 Elm St');
      await _tap(tester, 'request-see-prices');
      // Pickup days are not limited to opening hours: Sunday is fine.
      await _pickDay(tester, 'request-pickup-day', '25');
      // 7 AM to 9 PM in seven back-to-back 2-hour windows.
      expect(find.byKey(const Key('request-window:07:00-09:00')), findsOneWidget);
      expect(find.byKey(const Key('request-window:19:00-21:00')), findsOneWidget);
      expect(find.byKey(const Key('request-window:09:00-11:00')), findsOneWidget);
      expect(find.byKey(const Key('request-window:10:00-12:00')), findsNothing);
      await _tap(tester, 'request-window:09:00-11:00');
      await _type(tester, 'request-pickup-note', 'Ring twice');
      await _fillPeople(tester);
      expect(
        find.text('Total \$95.00. You pay when it is picked up, no card now.'),
        findsOneWidget,
      );
      await _tap(tester, 'request-send');
      final sent = fake.of('submitPackageRequest').single;
      expect(sent['handoff'], 'collect');
      expect(sent['businessId'], _atlanticId);
      expect(sent.containsKey('locationId'), isFalse);
      expect(sent.containsKey('plannedWindow'), isFalse);
      final pickup = sent['pickup'] as Map;
      expect(pickup['date'], '2026-10-25');
      expect(pickup['window'], '09:00-11:00');
      expect(pickup['note'], 'Ring twice');
      expect(pickup['address'], contains('9 Elm St'));
      // No fee amount is sent: the server quotes it.
      expect(sent.containsKey('pickupFeeCents'), isFalse);
      expect(pickup.containsKey('feeCents'), isFalse);
    });

    testWidgets('Send needs a pickup window', (tester) async {
      final fake = await toAddress(tester);
      await _type(tester, 'request-pickup-address', '9 Elm St');
      await _tap(tester, 'request-see-prices');
      await _pickDay(tester, 'request-pickup-day', '25');
      await _fillPeople(tester);
      await _type(tester, 'request-sender-name', 'Fatou Diallo');
      await _tap(tester, 'request-send');
      expect(find.text('Choose a time window.'), findsOneWidget);
      expect(fake.of('submitPackageRequest'), isEmpty);
    });

    testWidgets('a handoff nobody offers cannot be chosen', (tester) async {
      final fake = FakePackageRequests()..options = _options(collect: false);
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-mode:sea');
      expect(find.text('Not offered by this business'), findsOneWidget);
      await _tap(tester, 'request-collect');
      expect(find.byKey(const Key('request-pickup-address')), findsNothing);
    });
  });

  group('Send a package', () {
    testWidgets('a signed-out phone fills the form and sends, no sign-in', (
      tester,
    ) async {
      // Scanning a business QR must never start with "Sign in": the form
      // shows at once and the sender types their own name and WhatsApp.
      final fake = FakePackageRequests()..options = _options();
      await _pump(tester, _form(fake, customer: null));
      expect(find.byKey(const Key('request-sign-in')), findsNothing);
      expect(find.text('Sign in to send a request'), findsNothing);
      await _tap(tester, 'request-mode:sea');
      await _addPhones(tester, 1);
      await _tap(tester, 'request-bring-in');
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:10:00-12:00');
      await _type(tester, 'request-sender-name', 'Awa Camara');
      await _type(tester, 'request-sender-phone', '9175550188');
      await _fillPeople(tester);
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

    testWidgets('Send checks every field first and sends nothing', (
      tester,
    ) async {
      final fake = FakePackageRequests()..options = _bothBusinesses();
      // Signed in but with no name or number on the profile.
      await _pump(
        tester,
        _form(fake, customer: const RequestCustomer(uid: 'u1')),
      );
      await _tap(tester, 'request-mode:sea');
      await _addPhones(tester, 1);
      await _tap(tester, 'request-bring-in');
      await _tap(tester, 'request-business:$_atlanticId');
      await _tap(tester, 'request-add-else');
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

    testWidgets('the server\'s refusal is said in our words', (tester) async {
      final fake = await _toBusiness(tester, phones: 1);
      fake.refuse['submitPackageRequest'] = FakePackageRequests.failure(
        'resource-exhausted',
        {'reason': 'rate_limited'},
      );
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:10:00-12:00');
      await _fillPeople(tester);
      await _tap(tester, 'request-send');
      expect(
        find.text('Too many requests in a short time. Try again in an hour.'),
        findsOneWidget,
      );
      // Still on the form, nothing lost.
      expect(find.byKey(const Key('request-form')), findsOneWidget);
      expect(find.byKey(const Key('request-item-phone|electronics:qty')),
          findsOneWidget);
    });

    testWidgets('Send cannot go twice while it is on its way', (tester) async {
      final fake = await _toBusiness(tester, phones: 1);
      final gate = Completer<void>();
      fake.hold['submitPackageRequest'] = gate;
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:10:00-12:00');
      await _fillPeople(tester);
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

    testWidgets('fits a narrow French phone, comparison and pickup, with errors', (
      tester,
    ) async {
      final fake = FakePackageRequests()..options = _bothBusinesses();
      await _pump(
        tester,
        _form(fake, customer: const RequestCustomer(uid: 'u1')),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text('Mer'), findsOneWidget);
      expect(find.text('Avion'), findsOneWidget);
      await _tap(tester, 'request-mode:sea');
      await _addPhones(tester, 2);
      await _tap(tester, 'request-add-weight:clothing');
      await _tap(tester, 'request-size:0:suitcase');
      await _tap(tester, 'request-add-else');
      await _tap(tester, 'request-bring-in');
      expect(find.byKey(const ValueKey('request-business:b1')), findsOneWidget);
      await _tap(tester, 'request-business:$_atlanticId');
      await _tap(tester, 'request-send');
      expect(find.text('Dites ce que c’est.'), findsOneWidget);
      expect(tester.takeException(), isNull);
      // Pickup, French, same width.
      await _tap(tester, 'request-collect');
      await _tap(tester, 'request-see-prices');
      expect(find.text('Indiquez l’adresse de ramassage.'), findsOneWidget);
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

  // Kilos (docs/SHIPPING_SIMPLE_HOME.md K2, K7): a business that prices by the
  // kilo is asked kilos on its own link; comparing asks pounds; the unit is
  // always sent.
  group('Send a package: weights in kilos', () {
    Map<String, Object?> kiloBusiness() => _optionMap(
      id: 'k1',
      name: 'Kilo Cargo',
      sea: {
        'items': [_priceItem('Phone', 4000, includedLb: 2)],
        'perLbCents': {'clothing': 700},
        'unit': 'kg',
      },
    );

    Map<String, Object?> link() => {
      'businessId': 'k1',
      'name': 'Kilo Cargo',
      'acceptRequests': true,
    };

    Future<FakePackageRequests> ownLink(WidgetTester tester) async {
      final fake = FakePackageRequests()
        ..options = _response([kiloBusiness()], business: link());
      await _pump(tester, _form(fake, slug: 'kilo'));
      // No business here ships by air, so Sea is not asked.
      await _tap(tester, 'request-bring-in');
      return fake;
    }

    testWidgets('on its own link: kilos, with kilo size buttons and a kilo price', (
      tester,
    ) async {
      await ownLink(tester);
      expect(find.text('Up to 2 kg each'), findsOneWidget);
      await _tap(tester, 'request-add-weight:clothing');
      expect(find.text('Weight (kg)'), findsOneWidget);
      expect(find.text('Suitcase · 23 kg'), findsOneWidget);
      await _tap(tester, 'request-size:0:suitcase');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('request-weight:0')))
            .controller!
            .text,
        '23',
      );
      // 23 kg at $7 a kilo, weighed at the counter.
      expect(_totalOf(tester, 'k1'), r'about $161.00');
    });

    testWidgets('the unit can be switched; the number is converted, not the price', (
      tester,
    ) async {
      await ownLink(tester);
      await _tap(tester, 'request-add-weight:clothing');
      await _type(tester, 'request-weight:0', '10');
      expect(_totalOf(tester, 'k1'), r'about $70.00');
      await _tap(tester, 'request-unit:0:lb');
      expect(find.text('Weight (lb)'), findsOneWidget);
      // 10 kg is 22 lb (22.0462, to a tenth).
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('request-weight:0')))
            .controller!
            .text,
        '22',
      );
      // 22 lb is 10 kg on the business's list, to a tenth: $70.
      expect(_totalOf(tester, 'k1'), r'about $70.00');
    });

    testWidgets('what is sent names the unit it was typed in', (tester) async {
      final fake = await ownLink(tester);
      await _tap(tester, 'request-add-weight:clothing');
      await _tap(tester, 'request-size:0:suitcase');
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:10:00-12:00');
      await _fillPeople(tester);
      await _tap(tester, 'request-send');
      final piece = (fake.of('submitPackageRequest').single['pieces'] as List)
          .single as Map;
      expect(piece['categoryId'], 'clothing');
      expect(piece['weightLb'], 23);
      expect(piece['weightUnit'], 'kg');
      expect(piece['sizePreset'], 'suitcase');
    });

    testWidgets('a kilo weight too high is refused in kilos', (tester) async {
      final fake = await ownLink(tester);
      await _tap(tester, 'request-add-weight:clothing');
      await _type(tester, 'request-weight:0', '901');
      await _pickDay(tester, 'request-planned-day', '24');
      await _tap(tester, 'request-window:10:00-12:00');
      await _fillPeople(tester);
      await _tap(tester, 'request-send');
      expect(
        find.text('Enter the weight in kilos (0.1 to 900).'),
        findsOneWidget,
      );
      expect(fake.of('submitPackageRequest'), isEmpty);
    });

    testWidgets('comparing asks pounds, and each business prices its own unit', (
      tester,
    ) async {
      final fake = FakePackageRequests()
        ..options = _response([_baobab(), kiloBusiness()]);
      await _pump(tester, _form(fake));
      await _tap(tester, 'request-bring-in');
      await _tap(tester, 'request-add-weight:clothing');
      expect(find.text('Weight (lb)'), findsOneWidget);
      expect(find.text('Suitcase · 50 lb'), findsOneWidget);
      await _tap(tester, 'request-size:0:suitcase');
      // 50 lb: $6.50 a pound at Baobab; 22.7 kg at $7 a kilo at Kilo Cargo.
      expect(_totalOf(tester, _baobabId), r'about $325.00');
      expect(_totalOf(tester, 'k1'), r'about $158.90');
    });

    testWidgets('a pounds business is asked pounds on its own link', (
      tester,
    ) async {
      final fake = FakePackageRequests()
        ..options = _response(
          [_conakry()],
          business: {
            'businessId': _atlanticId,
            'name': 'Conakry Express',
            'acceptRequests': true,
          },
        );
      await _pump(tester, _form(fake, slug: 'conakry'));
      await _tap(tester, 'request-mode:sea');
      await _tap(tester, 'request-bring-in');
      await _tap(tester, 'request-add-weight:clothing');
      expect(find.text('Weight (lb)'), findsOneWidget);
      expect(find.text('Up to 2 lb each'), findsOneWidget);
    });

    testWidgets('reads in French on a narrow phone', (tester) async {
      final fake = FakePackageRequests()
        ..options = _response([kiloBusiness()], business: link());
      await _pump(
        tester,
        _form(fake, slug: 'kilo'),
        locale: const Locale('fr'),
        width: 320,
      );
      await _tap(tester, 'request-bring-in');
      expect(find.text('Jusqu’à 2 kg chacun'), findsOneWidget);
      await _tap(tester, 'request-add-weight:clothing');
      expect(find.text('Poids (kg)'), findsOneWidget);
      expect(find.text('Valise · 23 kg'), findsOneWidget);
      expect(find.text('Kilos (kg)'), findsOneWidget);
      expect(find.text('Livres (lb)'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

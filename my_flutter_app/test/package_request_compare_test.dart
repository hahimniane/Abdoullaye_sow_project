import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/package_price_list.dart';
import 'package:my_flutter_app/services/package_request_compare.dart';
import 'package:my_flutter_app/services/package_requests.dart';

/// The customer's flow as pure logic: the catalog the businesses' price lists
/// make, the basket, the comparison with its sorts and filters, the windows,
/// and what goes to the server.

Map<String, Object?> _item(
  String label,
  String category,
  int cents, {
  int includedLb = 0,
  String? id,
}) => {
  'id': id ?? itemIdFor(label),
  'categoryId': category,
  'label': label,
  'priceCents': cents,
  'includedLb': includedLb,
};

RequestOption _option(
  String id,
  String name, {
  Map<String, Object?>? sea,
  Map<String, Object?>? air,
  int? barrel,
  bool bring = true,
  bool collect = true,
  bool shipsByAir = false,
  double? rating,
  int reviews = 0,
  bool covers = false,
  Map<String, Object?>? seaDeparture,
}) => RequestOption.fromMap({
  'businessId': id,
  'businessName': name,
  'country': {'id': 'guinea', 'name': 'Guinea'},
  'barrelPriceCents': barrel,
  'bringIn': {
    'available': bring,
    'locations': [
      {
        'id': 'loc1',
        'label': 'Shop',
        'address': '1 Main St',
        'hours': RequestWeekHours.standard().toMap(),
      },
    ],
  },
  'collect': {'available': collect, 'areas': 'Bronx'},
  'routes': {'sea': sea, 'air': air},
  'departures': {
    'sea': seaDeparture ?? {'dateKey': '', 'source': 'none'},
    'air': {'dateKey': '', 'source': 'none'},
  },
  'shipsByAir': shipsByAir || air != null,
  'rating': rating,
  'reviewCount': reviews,
  'coversLoss': covers,
});

// Atlantic: phones $40 (up to 2 lb), laptops $70, clothes $6/lb, barrels $120.
final _atlantic = _option(
  'a',
  'Atlantic',
  sea: {
    'items': [
      _item('Phone', 'electronics', 4000, includedLb: 2),
      _item('Laptop', 'electronics', 7000),
    ],
    'perLbCents': {'clothing': 600},
  },
  air: {
    'items': [_item('Phone', 'electronics', 6000)],
    'perLbCents': {'clothing': 900},
  },
  barrel: 12000,
  rating: 4.5,
  reviews: 10,
  covers: true,
  seaDeparture: {'dateKey': '2026-11-14', 'source': 'schedule'},
);

// Baobab: phones $35 (any weight), TVs $120, food $5/lb, no barrels, no air.
final _baobab = _option(
  'b',
  'Baobab',
  sea: {
    'items': [
      _item('phone', 'electronics', 3500),
      _item('TV', 'fragile', 12000),
    ],
    'perLbCents': {'food': 500, 'clothing': 650},
  },
  collect: false,
  seaDeparture: {'dateKey': '2026-11-06', 'source': 'planned'},
);

// Cissé: nothing priced, barrels only.
final _cisse = _option('c', 'Cissé', barrel: 11000);

void main() {
  group('the catalog', () {
    test('is the union of the items by name and category', () {
      final catalog = buildRequestCatalog([_atlantic, _baobab, _cisse], 'sea');
      expect(
        [for (final i in catalog.items) i.label],
        ['Laptop', 'Phone', 'TV'],
      );
      // "Phone" and "phone" are one item.
      expect(catalog.item(catalogItemKey('PHONE', 'electronics')), isNotNull);
      expect(catalog.items.map((i) => i.categoryId), [
        'electronics',
        'electronics',
        'fragile',
      ]);
    });

    test('offers the per-pound categories any business prices, in order', () {
      final catalog = buildRequestCatalog([_atlantic, _baobab], 'sea');
      expect(catalog.perLbCategoryIds, ['clothing', 'food']);
    });

    test(
      'offers barrels by sea when some business has a price, never by air',
      () {
        expect(buildRequestCatalog([_baobab], 'sea').barrel, isFalse);
        expect(buildRequestCatalog([_baobab, _cisse], 'sea').barrel, isTrue);
        expect(buildRequestCatalog([_atlantic], 'air').barrel, isFalse);
      },
    );

    test(
      'the air catalog comes from the air routes of those that ship by air',
      () {
        final offered = offeredForMode([_atlantic, _baobab, _cisse], 'air');
        expect(offered.map((o) => o.businessId), ['a']);
        final catalog = buildRequestCatalog(offered, 'air');
        expect([for (final i in catalog.items) i.label], ['Phone']);
        expect(catalog.perLbCategoryIds, ['clothing']);
      },
    );

    test(
      '"up to X lb each" only when every business listing it covers a weight',
      () {
        final twoLb = buildRequestCatalog([_atlantic], 'sea');
        expect(
          twoLb.item(catalogItemKey('Phone', 'electronics'))!.includedLb,
          2,
        );
        // Baobab sells phones at any weight: no promise of a limit.
        final mixed = buildRequestCatalog([_atlantic, _baobab], 'sea');
        expect(
          mixed.item(catalogItemKey('Phone', 'electronics'))!.includedLb,
          0,
        );
        final smallest = buildRequestCatalog([
          _atlantic,
          _option(
            'd',
            'Dakar',
            sea: {
              'items': [_item('Phone', 'electronics', 3800, includedLb: 1)],
            },
          ),
        ], 'sea');
        expect(
          smallest.item(catalogItemKey('Phone', 'electronics'))!.includedLb,
          1,
        );
      },
    );

    test('Air is on offer only when a business ships by air', () {
      expect(anyOfferedForMode([_baobab, _cisse], 'air'), isFalse);
      expect(anyOfferedForMode([_baobab, _atlantic], 'air'), isTrue);
      expect(anyOfferedForMode([_baobab], 'sea'), isTrue);
    });

    test(
      'an option from an old server (no routes) adds nothing but its barrel',
      () {
        final old = RequestOption.fromMap({
          'businessId': 'o',
          'businessName': 'Old',
          'country': {'id': 'guinea', 'name': 'Guinea'},
          'barrelPriceCents': 9000,
          'bringIn': {'available': false, 'locations': []},
          'collect': {'available': true},
        });
        final catalog = buildRequestCatalog([old], 'sea');
        expect(catalog.items, isEmpty);
        expect(catalog.perLbCategoryIds, isEmpty);
        expect(catalog.barrel, isTrue);
      },
    );
  });

  group('the weight field', () {
    test('reads dots and commas and rounds to a tenth', () {
      expect(parseWeightLb('50'), 50);
      expect(parseWeightLb('12,5'), 12.5);
      expect(parseWeightLb(' 12.34 '), 12.3);
    });
    test('refuses what the server refuses', () {
      expect(parseWeightLb(''), isNull);
      expect(parseWeightLb('abc'), isNull);
      expect(parseWeightLb('0'), isNull);
      expect(parseWeightLb('2000.1'), isNull);
      expect(parseWeightLb('2000'), 2000);
    });
  });

  group('the basket', () {
    final catalog = buildRequestCatalog([_atlantic, _baobab, _cisse], 'sea');
    final phone = catalogItemKey('Phone', 'electronics');
    final tv = catalogItemKey('TV', 'fragile');

    test('counts pieces: an item row once, each barrel on its own', () {
      final basket = RequestBasket(
        items: {phone: 3, tv: 1},
        weights: const [BasketWeight(categoryId: 'clothing', weightLb: 50)],
        barrels: 2,
        others: const [BasketOther(description: 'Car parts')],
      );
      expect(basket.pieceCount, 6);
      expect(const RequestBasket().isEmpty, isTrue);
    });

    test('an item a business does not list is a piece it must quote', () {
      final basket = RequestBasket(items: {tv: 1});
      final atlantic = basketPricingPieces(basket, catalog, _atlantic, 'sea');
      expect(atlantic.single['priceItemId'], 'i__unlisted');
      final baobab = basketPricingPieces(basket, catalog, _baobab, 'sea');
      expect(baobab.single['priceItemId'], 'i_tv');
    });

    test('drafts use each business\'s own item id', () {
      final basket = RequestBasket(items: {phone: 2});
      final forAtlantic = basketDrafts(basket, catalog, _atlantic, 'sea');
      final forBaobab = basketDrafts(basket, catalog, _baobab, 'sea');
      expect(requestPiecePayload(forAtlantic.single), {
        'priceItemId': 'i_phone',
        'quantity': 2,
        'label': 'Phone',
      });
      expect(forBaobab.single.priceItemId, 'i_phone');
    });

    test('an unlisted item is sent as words for the business to price', () {
      final drafts = basketDrafts(
        RequestBasket(items: {tv: 2}),
        catalog,
        _atlantic,
        'sea',
      );
      expect(requestPiecePayload(drafts.single), {
        'kind': 'other',
        'description': '2 × TV',
      });
    });

    test('every kind of piece in the shape the server takes', () {
      final drafts = basketDrafts(
        RequestBasket(
          items: {phone: 1},
          weights: const [
            BasketWeight(
              categoryId: 'clothing',
              weightLb: 50,
              sizePreset: 'suitcase',
            ),
          ],
          barrels: 1,
          others: const [
            BasketOther(description: 'Car parts', photoPaths: ['p/1.jpg']),
          ],
        ),
        catalog,
        _atlantic,
        'sea',
      );
      expect(
        [for (final d in drafts) requestPiecePayload(d)],
        [
          {'priceItemId': 'i_phone', 'quantity': 1, 'label': 'Phone'},
          {
            'categoryId': 'clothing',
            'weightLb': 50.0,
            'sizePreset': 'suitcase',
          },
          {'kind': 'barrel'},
          {
            'kind': 'other',
            'description': 'Car parts',
            'photoPaths': ['p/1.jpg'],
          },
        ],
      );
    });

    test('an empty weight or text is kept so the form flags it', () {
      final drafts = basketDrafts(
        const RequestBasket(
          weights: [BasketWeight(categoryId: 'clothing')],
          others: [BasketOther()],
        ),
        catalog,
        _atlantic,
        'sea',
      );
      final reasons = validateRequestDraft(
        RequestDraft(
          businessId: 'a',
          destinationCountryId: 'guinea',
          handoff: requestHandoffBringIn,
          locationId: 'loc1',
          plannedDate: '2026-10-24',
          senderName: 'A',
          senderPhone: '+19175551234',
          receiverName: 'B',
          receiverPhone: '+224621234567',
          pieces: drafts,
          idempotencyKey: 'app_abcdefgh12345678',
        ),
        option: _atlantic,
        today: DateTime(2026, 10, 22),
      );
      expect(
        reasons,
        containsAll(['weight_invalid', 'piece_description_required']),
      );
    });

    test('incomplete pieces are not priced', () {
      final pieces = basketPricingPieces(
        const RequestBasket(
          weights: [BasketWeight(categoryId: 'clothing')],
          others: [BasketOther()],
        ),
        catalog,
        _atlantic,
        'sea',
      );
      expect(pieces, isEmpty);
    });
  });

  group('the comparison', () {
    final catalog = buildRequestCatalog([_atlantic, _baobab, _cisse], 'sea');
    final phone = catalogItemKey('Phone', 'electronics');
    final tv = catalogItemKey('TV', 'fragile');
    final options = [_atlantic, _baobab, _cisse];

    ComparisonRow row(List<ComparisonRow> rows, String id) =>
        rows.firstWhere((r) => r.option.businessId == id);

    test('prices the basket at each business\'s list', () {
      final rows = comparisonRows(
        options: options,
        mode: 'sea',
        catalog: catalog,
        handoff: requestHandoffBringIn,
        basket: RequestBasket(items: {phone: 2}),
      );
      // 2 phones: Atlantic $80 (up to 2 lb: weighed), Baobab $70 (any weight).
      expect(row(rows, 'a').basket.totalCents, 8000);
      expect(row(rows, 'a').priceKind, RowPriceKind.about);
      expect(row(rows, 'b').basket.totalCents, 7000);
      expect(row(rows, 'b').priceKind, RowPriceKind.total);
      expect(row(rows, 'c').priceKind, RowPriceKind.toQuote);
    });

    test('says "about" when something is weighed at the counter', () {
      final rows = comparisonRows(
        options: options,
        mode: 'sea',
        catalog: catalog,
        handoff: requestHandoffBringIn,
        basket: const RequestBasket(
          weights: [BasketWeight(categoryId: 'clothing', weightLb: 50)],
        ),
      );
      expect(row(rows, 'a').basket.totalCents, 30000);
      expect(row(rows, 'a').priceKind, RowPriceKind.about);
      expect(row(rows, 'b').basket.totalCents, 32500);
    });

    test('says "+ N to quote" when part of the basket has no price', () {
      final rows = comparisonRows(
        options: options,
        mode: 'sea',
        catalog: catalog,
        handoff: requestHandoffBringIn,
        basket: RequestBasket(
          items: {phone: 1, tv: 1},
          others: const [BasketOther(description: 'Car parts')],
        ),
      );
      final atlantic = row(rows, 'a');
      expect(atlantic.priceKind, RowPriceKind.partial);
      expect(atlantic.basket.pricedCents, 4000);
      expect(atlantic.basket.unpricedCount, 2);
      expect(row(rows, 'b').basket.unpricedCount, 1);
    });

    test('a barrel is priced by each business\'s barrel price', () {
      final rows = comparisonRows(
        options: options,
        mode: 'sea',
        catalog: catalog,
        handoff: requestHandoffBringIn,
        basket: const RequestBasket(barrels: 2),
      );
      expect(row(rows, 'a').basket.totalCents, 24000);
      expect(row(rows, 'c').basket.totalCents, 22000);
      expect(row(rows, 'b').priceKind, RowPriceKind.toQuote);
    });

    test('a pickup adds each business\'s fee', () {
      final rows = comparisonRows(
        options: options,
        mode: 'sea',
        catalog: catalog,
        handoff: requestHandoffCollect,
        basket: RequestBasket(items: {phone: 1}),
        quotes: {
          'a': const PickupQuote(
            businessId: 'a',
            available: true,
            priced: true,
            feeCents: 1800,
          ),
          'c': const PickupQuote(businessId: 'c', available: true),
        },
      );
      expect(row(rows, 'a').basket.totalCents, 5800);
      expect(row(rows, 'a').pickupFeeCents, 1800);
      // Cissé picks up but its staff set the fee.
      expect(row(rows, 'c').feePending, isTrue);
      expect(row(rows, 'c').pickupFeeCents, isNull);
    });

    test('a business that does not pick up there cannot be chosen', () {
      final rows = comparisonRows(
        options: options,
        mode: 'sea',
        catalog: catalog,
        handoff: requestHandoffCollect,
        basket: RequestBasket(items: {phone: 1}),
        quotes: {
          'a': const PickupQuote(
            businessId: 'a',
            available: false,
            reason: 'pickup_out_of_range',
          ),
        },
      );
      expect(row(rows, 'a').unavailableReason, 'pickup_out_of_range');
      // Baobab never picks up at all.
      expect(row(rows, 'b').unavailableReason, 'collect_unavailable');
      expect(row(rows, 'a').available, isFalse);
      expect(row(rows, 'c').available, isTrue);
    });

    test('a business without drop-off cannot be chosen to bring to', () {
      final rows = comparisonRows(
        options: [_option('n', 'No shop', bring: false)],
        mode: 'sea',
        catalog: const RequestCatalog(),
        handoff: requestHandoffBringIn,
        basket: const RequestBasket(barrels: 1),
      );
      expect(rows.single.unavailableReason, 'bring_in_unavailable');
    });

    group('arranged', () {
      final rows = comparisonRows(
        options: options,
        mode: 'sea',
        catalog: catalog,
        handoff: requestHandoffBringIn,
        basket: RequestBasket(items: {phone: 1, tv: 1}),
      );
      List<String> ids(List<ComparisonRow> list) => [
        for (final r in list) r.option.businessId,
      ];

      test('best match: all priced first, cheapest first', () {
        // Baobab prices both ($155); Atlantic leaves the TV to quote; Cissé both.
        expect(ids(arrangeRows(rows)), ['b', 'a', 'c']);
      });

      test('soonest departure puts the nearest date first and none last', () {
        expect(ids(arrangeRows(rows, sort: 'soonest')), ['b', 'a', 'c']);
      });

      test('highest rated puts the rated ones first', () {
        expect(ids(arrangeRows(rows, sort: 'rating')), ['a', 'b', 'c']);
      });

      test('lowest price', () {
        expect(ids(arrangeRows(rows, sort: 'price')), ['b', 'a', 'c']);
      });

      test('filters: picks up, pays back if lost, has a rating', () {
        expect(
          ids(arrangeRows(rows, filters: const CompareFilters(picksUp: true))),
          ['a', 'c'],
        );
        expect(
          ids(arrangeRows(rows, filters: const CompareFilters(paysBack: true))),
          ['a'],
        );
        expect(
          ids(arrangeRows(rows, filters: const CompareFilters(rated: true))),
          ['a'],
        );
        expect(
          ids(
            arrangeRows(
              rows,
              filters: const CompareFilters(picksUp: true, rated: true),
            ),
          ),
          ['a'],
        );
      });

      test('a business that cannot be chosen goes last, whatever the sort', () {
        final pickup = comparisonRows(
          options: options,
          mode: 'sea',
          catalog: catalog,
          handoff: requestHandoffCollect,
          basket: RequestBasket(items: {phone: 1}),
          quotes: {
            'c': const PickupQuote(
              businessId: 'c',
              available: false,
              reason: 'pickup_out_of_area',
            ),
          },
        );
        // Baobab does not collect, Cissé is out of area: Atlantic alone is
        // choosable and leads.
        expect(ids(arrangeRows(pickup)).first, 'a');
        expect(ids(arrangeRows(pickup)).length, 3);
        expect(
          arrangeRows(
            pickup,
          ).where((r) => r.available).map((r) => r.option.businessId),
          ['a'],
        );
      });
    });
  });

  group('windows', () {
    RequestDayHours hours(String from, String to, {bool open = true}) =>
        RequestDayHours(open: open, from: from, to: to);
    List<String> keys(List<RequestTimeWindow> w) => [
      for (final x in w) requestWindowKey(x),
    ];

    test('a 9 to 6 day has hourly 2-hour windows', () {
      expect(keys(dropOffWindows(hours('09:00', '18:00'))), [
        '09:00-11:00',
        '10:00-12:00',
        '11:00-13:00',
        '12:00-14:00',
        '13:00-15:00',
        '14:00-16:00',
        '15:00-17:00',
        '16:00-18:00',
      ]);
    });

    test('starts on the hour, inside the hours', () {
      expect(keys(dropOffWindows(hours('09:30', '13:15'))), [
        '10:00-12:00',
        '11:00-13:00',
      ]);
    });

    test('a short day is one window, the whole day', () {
      expect(keys(dropOffWindows(hours('10:00', '11:30'))), ['10:00-11:30']);
      expect(keys(dropOffWindows(hours('10:00', '12:00'))), ['10:00-12:00']);
    });

    test('a day too short or closed has none', () {
      expect(dropOffWindows(hours('10:00', '10:20')), isEmpty);
      expect(dropOffWindows(hours('09:00', '18:00', open: false)), isEmpty);
      expect(dropOffWindows(hours('', '')), isEmpty);
    });

    test('a window that already started is left out', () {
      // 12:30 in the afternoon: the 12:00 window has started.
      expect(
        keys(
          dropOffWindows(hours('09:00', '18:00'), afterMinutes: 12 * 60 + 30),
        ),
        ['13:00-15:00', '14:00-16:00', '15:00-17:00', '16:00-18:00'],
      );
      expect(
        dropOffWindows(hours('09:00', '18:00'), afterMinutes: 17 * 60),
        isEmpty,
      );
    });

    test('every window fits what the server takes', () {
      for (final w in dropOffWindows(hours('08:15', '19:40'))) {
        expect(
          requestWindowFits(w.from, w.to, hours('08:15', '19:40')),
          isTrue,
          reason: requestWindowKey(w),
        );
      }
    });

    test('pickup windows run 07:00 to 21:00', () {
      final slots = pickupWindowSlots();
      expect(slots.first.from, '07:00');
      expect(slots.last.to, '21:00');
      expect(slots.length, 7);
      for (final w in slots) {
        expect(requestPickupRange(requestWindowKey(w)), isNotNull);
      }
    });

    test('a pickup window outside 07:00-21:00 or too long is refused', () {
      expect(requestPickupRange('06:00-08:00'), isNull);
      expect(requestPickupRange('20:00-22:00'), isNull);
      expect(requestPickupRange('08:00-11:00'), isNull);
      expect(requestPickupRange('08:00-08:20'), isNull);
      expect(requestPickupRange('morning'), isNull);
      expect(requestPickupRange('14:00-16:00'), isNotNull);
    });

    test('the first day a rule accepts', () {
      final sunday = DateTime(2026, 10, 25);
      expect(
        firstSelectableDay(
          sunday,
          DateTime(2026, 12, 25),
          (d) => d.weekday != DateTime.sunday,
        ),
        DateTime(2026, 10, 26),
      );
      expect(firstSelectableDay(sunday, sunday, (d) => false), isNull);
    });
  });

  group('words about a window', () {
    test('English: 2-4 PM, 11 AM-1 PM, full times off the hour', () {
      expect(requestWindowShortText('14:00', '16:00', 'en'), '2–4 PM');
      expect(requestWindowShortText('11:00', '13:00', 'en'), '11 AM–1 PM');
      expect(requestWindowShortText('09:00', '11:00', 'en'), '9–11 AM');
      expect(
        requestWindowShortText('09:30', '11:30', 'en'),
        '9:30 AM–11:30 AM',
      );
      expect(requestWindowShortText('12:00', '14:00', 'en'), '12–2 PM');
    });
    test('French: 14 h-16 h', () {
      expect(requestWindowShortText('14:00', '16:00', 'fr'), '14 h–16 h');
      expect(requestWindowShortText('09:30', '11:30', 'fr'), '9 h 30–11 h 30');
    });
    test('not a time', () {
      expect(requestWindowShortText('x', '16:00', 'en'), isNull);
    });
  });

  group('what goes to the server', () {
    RequestDraft draft({
      String handoff = requestHandoffBringIn,
      List<RequestPieceDraft>? pieces,
      String shipMode = 'sea',
      String channel = 'app',
      RequestTimeWindow? window = const RequestTimeWindow(
        from: '14:00',
        to: '16:00',
      ),
      String pickupWindow = '14:00-16:00',
    }) => RequestDraft(
      businessId: 'a',
      destinationCountryId: 'guinea',
      handoff: handoff,
      locationId: 'loc1',
      plannedDate: '2026-10-24',
      pickupAddress: '9 Elm St, Bronx, NY',
      pickupDate: '2026-10-25',
      pickupWindow: pickupWindow,
      senderName: 'Fatou',
      senderPhone: '+19175551234',
      receiverName: 'Mariama',
      receiverPhone: '+224621234567',
      pieces:
          pieces ??
          [
            const RequestPieceDraft.item(
              itemId: 'i_phone',
              itemLabel: 'Phone',
              quantity: 2,
            ),
          ],
      idempotencyKey: 'app_abcdefgh12345678',
      shipMode: shipMode,
      foundVia: 'laawol',
      channel: channel,
      plannedWindow: window,
    );

    test('a drop-off carries the mode, found via, channel and window', () {
      final payload = submitRequestPayload(draft());
      expect(payload['shipMode'], 'sea');
      expect(payload['channel'], 'app');
      expect(payload['foundVia'], 'laawol');
      expect(payload['plannedWindow'], {'from': '14:00', 'to': '16:00'});
      expect(payload['plannedDate'], '2026-10-24');
      expect(payload.containsKey('pickup'), isFalse);
      expect(payload['pieces'], [
        {'priceItemId': 'i_phone', 'quantity': 2, 'label': 'Phone'},
      ]);
    });

    test('a pickup sends its window as HH:MM-HH:MM and no drop-off fields', () {
      final payload = submitRequestPayload(
        draft(handoff: requestHandoffCollect),
      );
      expect(payload.containsKey('plannedWindow'), isFalse);
      expect(payload.containsKey('locationId'), isFalse);
      expect((payload['pickup'] as Map)['window'], '14:00-16:00');
      expect((payload['pickup'] as Map)['date'], '2026-10-25');
    });

    test('a request from before price lists keeps its old shape', () {
      final payload = submitRequestPayload(
        draft(
          shipMode: '',
          channel: '',
          window: null,
          pieces: const [
            RequestPieceDraft(kind: requestPieceBox, description: 'TV'),
          ],
        ),
      );
      expect(payload.containsKey('shipMode'), isFalse);
      expect(payload.containsKey('channel'), isFalse);
      expect(payload.containsKey('foundVia'), isFalse);
      expect(payload.containsKey('plannedWindow'), isFalse);
      expect(payload['pieces'], [
        {'kind': 'box', 'description': 'TV'},
      ]);
    });

    List<String> check(
      RequestDraft d, {
      RequestOption? option,
      bool requireWindow = true,
    }) => validateRequestDraft(
      d,
      option: option ?? _atlantic,
      today: DateTime(2026, 10, 22),
      requireWindow: requireWindow,
    );

    test('a good request has no reasons', () {
      expect(check(draft()), isEmpty);
      expect(check(draft(handoff: requestHandoffCollect)), isEmpty);
    });

    test(
      'the window must be 30 minutes to 2 hours inside the day\'s hours',
      () {
        expect(
          check(
            draft(
              window: const RequestTimeWindow(from: '08:00', to: '10:00'),
            ),
          ),
          ['window_invalid'],
        );
        expect(
          check(
            draft(
              window: const RequestTimeWindow(from: '10:00', to: '13:00'),
            ),
          ),
          ['window_invalid'],
        );
        expect(check(draft(window: null)), ['window_invalid']);
        expect(check(draft(window: null), requireWindow: false), isEmpty);
      },
    );

    test('a pickup window out of range is refused', () {
      expect(
        check(
          draft(handoff: requestHandoffCollect, pickupWindow: '22:00-23:00'),
        ),
        ['pickup_window_invalid'],
      );
      // The old words still read.
      expect(
        check(draft(handoff: requestHandoffCollect, pickupWindow: 'evening')),
        isEmpty,
      );
    });

    test('mode and channel', () {
      expect(check(draft(shipMode: 'train')), ['ship_mode_invalid']);
      expect(check(draft(shipMode: 'air')), isEmpty);
      expect(check(draft(shipMode: 'air'), option: _baobab), [
        'air_unavailable',
      ]);
      expect(check(draft(channel: 'fax')), ['channel_invalid']);
    });

    test('quantity and weight', () {
      expect(
        check(
          draft(
            pieces: const [
              RequestPieceDraft.item(
                itemId: 'i_phone',
                itemLabel: 'Phone',
                quantity: 51,
              ),
            ],
          ),
        ),
        ['quantity_invalid'],
      );
      expect(
        check(
          draft(
            pieces: const [
              RequestPieceDraft.byWeight(categoryId: 'clothing', weightLb: 0),
            ],
          ),
        ),
        ['weight_invalid'],
      );
      expect(
        check(
          draft(
            pieces: const [
              RequestPieceDraft.byWeight(categoryId: 'toys', weightLb: 5),
            ],
          ),
        ),
        ['category_invalid'],
      );
    });

    test('a piece from the list needs no description', () {
      expect(
        pieceNeedsDescription(
          const RequestPieceDraft.item(
            itemId: 'i_phone',
            itemLabel: 'Phone',
            quantity: 1,
          ),
        ),
        isFalse,
      );
      expect(
        pieceNeedsDescription(const RequestPieceDraft(kind: requestPieceOther)),
        isTrue,
      );
    });
  });

  group('what the server sends', () {
    test('an option carries its routes, departures, rating and cover', () {
      expect(_atlantic.routeFor('sea')!['items'], hasLength(2));
      expect(_atlantic.routeFor('air')!['perLbCents'], {'clothing': 900});
      expect(_baobab.routeFor('air'), isNull);
      expect(_atlantic.departureFor('sea').dateKey, '2026-11-14');
      expect(_atlantic.departureFor('air').source, 'none');
      expect(_atlantic.rating, 4.5);
      expect(_atlantic.reviewCount, 10);
      expect(_atlantic.hasRating, isTrue);
      expect(_baobab.hasRating, isFalse);
      expect(_atlantic.coversLoss, isTrue);
      expect(_atlantic.shipsByAir, isTrue);
      expect(_baobab.shipsByAir, isFalse);
    });

    test('pickup quotes by business', () {
      final quotes = PickupQuote.fromResponse({
        'quotes': [
          {
            'businessId': 'a',
            'available': true,
            'priced': true,
            'feeCents': 1800,
            'distanceMiles': 4.2,
            'borough': 'Bronx',
            'reason': '',
          },
          {
            'businessId': 'b',
            'available': false,
            'reason': 'pickup_out_of_range',
          },
          {'available': true},
        ],
      });
      expect(quotes.keys, ['a', 'b']);
      expect(quotes['a']!.shownFeeCents, 1800);
      expect(quotes['a']!.borough, 'Bronx');
      expect(quotes['b']!.reason, 'pickup_out_of_range');
      expect(quotes['b']!.shownFeeCents, isNull);
    });

    test('a reschedule answer', () {
      final r = RequestRescheduled.fromResponse({
        'success': true,
        'plannedDate': '2026-11-06',
        'plannedWindow': {'from': '14:00', 'to': '16:00'},
      });
      expect(r.plannedDate, '2026-11-06');
      expect(r.window!.to, '16:00');
    });
  });
}

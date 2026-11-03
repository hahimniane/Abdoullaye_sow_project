import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_price_list.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_coming_today.dart';
import 'package:my_flutter_app/services/package_price_list.dart';
import 'package:my_flutter_app/services/package_requests.dart';

/// The business side of price lists, as pure logic: what the screen reads
/// from `packagePriceLists/{id}`, what the editor sends back, "Coming
/// today", the 2-hour window in words, and a container's planned departure.
void main() {
  final fixture =
      jsonDecode(
            File(
              'functions/test/fixtures/package-price-list-cases.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  Object? json(Object? value) => jsonDecode(jsonEncode(value));

  PackagePriceList stored() => PackagePriceList.fromMap({
    'businessId': 'b1',
    'routes': {
      'guinea': {'sea': fixture['route']},
    },
    'needsCheck': true,
    'updatedAtMs': 1000,
    'updatedByName': 'Laawol Admin',
    'updatedByLaawol': true,
    'history': [
      {
        'atMs': 1000,
        'byName': 'Laawol Admin',
        'byLaawol': true,
        'action': 'saved',
        'countries': ['guinea'],
      },
      {'atMs': 2000, 'byName': 'Awa', 'action': 'checked', 'countries': []},
    ],
  });

  group('reading the stored list', () {
    test('routes, banner flag and history', () {
      final list = stored();
      expect(list.needsCheck, isTrue);
      expect(list.updatedByLaawol, isTrue);
      final route = list.route('guinea', 'sea')!;
      expect(route.items.map((i) => i.label), ['Phone', 'Laptop', 'TV 43 in']);
      expect(route.items.first.includedLb, 2);
      expect(route.perLbCents, {'clothing': 600, 'food': 500, 'general': 450});
      expect(route.weekdays, ['tue', 'fri']);
      expect(route.everyWeeks, 1);
      expect(list.route('guinea', 'air'), isNull);
      expect(list.route('senegal', 'sea'), isNull);
      // Newest first for the History list.
      expect(list.historyNewestFirst.first.isChecked, isTrue);
      expect(list.historyNewestFirst.last.countries, ['guinea']);
    });

    test('a business with no list reads as empty', () {
      final list = PackagePriceList.fromMap(null);
      expect(list.routes, isEmpty);
      expect(list.needsCheck, isFalse);
      expect(list.history, isEmpty);
    });
  });

  group('the editor payload', () {
    test('a stored route comes back exactly as the server stores it', () {
      final draft = priceListDraftOf(stored(), ['guinea']);
      final payload = priceListRoutesPayload(draft, ['guinea']);
      expect(payload.keys, ['guinea']);
      expect((payload['guinea'] as Map).keys, ['sea']);
      // Sent to the server's own rule, it is the stored route again.
      final sea = (payload['guinea'] as Map)['sea'];
      final checked = validateRoute(sea);
      expect(checked.errors, isEmpty);
      expect(json(checked.route), fixture['route']);
    });

    test('empty modes and unknown countries are not sent', () {
      final draft = <String, Map<String, PriceRouteDraft>>{
        'guinea': {
          'sea': const PriceRouteDraft(
            items: [
              PriceItemDraft(
                label: 'Phone',
                price: '40',
                categoryId: 'electronics',
              ),
            ],
          ),
          'air': const PriceRouteDraft(),
        },
        'senegal': {
          'sea': const PriceRouteDraft(rates: {'food': '5'}),
        },
        'mali': {
          'sea': const PriceRouteDraft(),
          'air': const PriceRouteDraft(),
        },
      };
      final payload = priceListRoutesPayload(draft, ['guinea', 'mali']);
      expect(payload.keys, ['guinea']);
      expect((payload['guinea'] as Map).keys, ['sea']);
    });

    test('money is read in cents and a weight of 0 or blank covers all', () {
      const route = PriceRouteDraft(
        items: [
          PriceItemDraft(
            label: 'Phone',
            categoryId: 'electronics',
            price: '40.50',
            includedLb: '2,5',
          ),
          PriceItemDraft(label: 'TV', categoryId: 'fragile', price: '120'),
        ],
        rates: {'clothing': '6', 'food': '', 'general': '4,50'},
        weekdays: {'fri', 'tue'},
      );
      final validated = validateRoute(route.toPayload());
      expect(validated.errors, isEmpty);
      final items = validated.route!['items'] as List;
      expect((items[0] as Map)['priceCents'], 4050);
      expect((items[0] as Map)['includedLb'], 2.5);
      expect((items[1] as Map)['priceCents'], 12000);
      expect((items[1] as Map)['includedLb'], 0);
      expect(validated.route!['perLbCents'], {'clothing': 600, 'general': 450});
      expect((validated.route!['departure'] as Map)['weekdays'], [
        'tue',
        'fri',
      ]);
    });

    test('a kept item id survives a rename', () {
      const item = PriceItemDraft(
        id: 'i_phone',
        label: 'Smartphone',
        categoryId: 'electronics',
        price: '40',
      );
      final validated = validateRoute({
        'items': [item.toPayload()],
      });
      expect((validated.route!['items'] as List).single['id'], 'i_phone');
    });
  });

  group('problems found before the round trip', () {
    List<String> codes(PriceRouteDraft route) {
      final draft = {
        'guinea': {'sea': route},
      };
      return [
        for (final p in priceListProblems(draft, ['guinea'])) p.code,
      ];
    }

    test('a valid list has none', () {
      expect(
        codes(
          const PriceRouteDraft(
            items: [PriceItemDraft(label: 'Phone', price: '40')],
          ),
        ),
        isEmpty,
      );
    });

    test('each problem is named as the server names it', () {
      expect(
        codes(const PriceRouteDraft(items: [PriceItemDraft(price: '40')])),
        ['label_required'],
      );
      expect(
        codes(
          const PriceRouteDraft(
            items: [PriceItemDraft(label: 'Phone', price: 'abc')],
          ),
        ),
        ['price_invalid'],
      );
      expect(
        codes(
          const PriceRouteDraft(
            items: [PriceItemDraft(label: 'Phone', price: '0')],
          ),
        ),
        ['price_invalid'],
      );
      expect(
        codes(
          const PriceRouteDraft(
            items: [
              PriceItemDraft(label: 'Phone', price: '40'),
              PriceItemDraft(label: ' phone ', price: '50'),
            ],
          ),
        ),
        ['label_duplicate'],
      );
      expect(
        codes(
          const PriceRouteDraft(
            items: [
              PriceItemDraft(label: 'Phone', price: '40', includedLb: '900'),
            ],
          ),
        ),
        ['included_invalid'],
      );
      expect(codes(const PriceRouteDraft(rates: {'food': 'x'})), [
        'per_lb_invalid',
      ]);
    });

    test('every N weeks needs a day to count from', () {
      expect(codes(const PriceRouteDraft(weekdays: {'tue'}, everyWeeks: 2)), [
        'departure_invalid',
      ]);
      expect(
        codes(
          const PriceRouteDraft(
            weekdays: {'tue'},
            everyWeeks: 2,
            anchorDate: '2026-11-03',
          ),
        ),
        isEmpty,
      );
    });

    test('a problem says which country and mode it is in', () {
      final problems = priceListProblems(
        {
          'guinea': {'sea': const PriceRouteDraft()},
          'senegal': {
            'air': const PriceRouteDraft(rates: {'food': 'x'}),
          },
        },
        ['guinea', 'senegal'],
      );
      expect(problems.single.countryId, 'senegal');
      expect(problems.single.mode, 'air');
    });
  });

  group('unsaved changes', () {
    test('what is stored, opened and untouched, is unchanged', () {
      final list = stored();
      final draft = priceListDraftOf(list, ['guinea']);
      expect(priceListChanged(list, draft, ['guinea']), isFalse);
    });

    test('an edit is a change; undoing it is not', () {
      final list = stored();
      final draft = priceListDraftOf(list, ['guinea']);
      final route = draft['guinea']!['sea']!;
      final edited = {
        'guinea': {
          ...draft['guinea']!,
          'sea': route.copyWith(rates: {...route.rates, 'food': '5.25'}),
        },
      };
      expect(priceListChanged(list, edited, ['guinea']), isTrue);
      final undone = {
        'guinea': {
          ...draft['guinea']!,
          'sea': route.copyWith(rates: {...route.rates, 'food': '5'}),
        },
      };
      expect(priceListChanged(list, undone, ['guinea']), isFalse);
    });
  });

  test('a price snapshot weighs when the counter scale decides it', () {
    expect(
      priceSnapshotWeighs({'source': 'per_lb', 'perLbCents': 600}),
      isTrue,
    );
    expect(
      priceSnapshotWeighs({'source': 'item', 'includedLb': 2, 'unitCents': 1}),
      isTrue,
    );
    expect(
      priceSnapshotWeighs({'source': 'item', 'includedLb': 0, 'unitCents': 1}),
      isFalse,
    );
    expect(priceSnapshotWeighs({'source': 'barrel'}), isFalse);
    expect(priceSnapshotWeighs(null), isFalse);
  });

  group('a request as it is read', () {
    test('the new fields', () {
      final r = PackageRequest.fromMap('r1', {
        'status': 'confirmed',
        'shipMode': 'air',
        'foundVia': 'laawol',
        'channel': 'app',
        'handoff': 'bring_in',
        'plannedDate': '2026-11-03',
        'plannedWindow': {'from': '14:00', 'to': '16:00'},
        'pickup': {
          'address': '9 Elm',
          'window': '09:00-11:00',
          'feeCents': 1500,
        },
        'pieces': [
          {
            'id': 'p1',
            'kind': 'other',
            'description': '2 × Phone',
            'quantity': 2,
            'price': {'source': 'item', 'includedLb': 2, 'unitCents': 4000},
          },
          {
            'id': 'p2',
            'kind': 'other',
            'weightLb': 12.5,
            'sizePreset': 'small_bag',
            'price': {'source': 'per_lb', 'perLbCents': 600, 'weightLb': 12.5},
          },
        ],
      });
      expect(r.isAirRequest, isTrue);
      expect(r.foundVia, 'laawol');
      expect(r.channel, 'app');
      expect(r.plannedWindow?.from, '14:00');
      expect(r.plannedWindow?.to, '16:00');
      expect(r.pickup?.feeCents, 1500);
      expect(r.pickup?.window, '09:00-11:00');
      expect(r.pieces[0].quantity, 2);
      expect(r.pieces[0].price?['source'], 'item');
      expect(r.pieces[1].weightLb, 12.5);
      expect(r.pieces[1].sizePreset, 'small_bag');
    });

    test('an old request still reads', () {
      final r = PackageRequest.fromMap('r2', {
        'status': 'new',
        'plannedDate': '2026-10-24',
        'pieces': [
          {'id': 'p1', 'kind': 'barrel', 'estimateCents': 12000},
        ],
      });
      expect(r.shipMode, '');
      expect(r.isAirRequest, isFalse);
      expect(r.plannedWindow, isNull);
      expect(r.pieces.single.price, isNull);
      expect(r.pieces.single.quantity, isNull);
    });

    test('a window that is not two times is none', () {
      final r = PackageRequest.fromMap('r3', {
        'status': 'confirmed',
        'plannedWindow': {'from': '2pm', 'to': '16:00'},
      });
      expect(r.plannedWindow, isNull);
    });
  });

  group('Coming today', () {
    // Tuesday, Nov 3, 2026, noon in New York.
    final now = DateTime.utc(2026, 11, 3, 17);

    PackageRequest req(String id, Map<String, dynamic> extra) =>
        PackageRequest.fromMap(id, {
          'status': 'confirmed',
          'handoff': 'bring_in',
          'plannedDate': '2026-11-03',
          ...extra,
        });

    test('today\'s confirmed bring-ins, soonest window first', () {
      final list = comingTodayRequests([
        req('late', {
          'plannedWindow': {'from': '16:00', 'to': '18:00'},
        }),
        req('none', const {}),
        req('early', {
          'plannedWindow': {'from': '09:30', 'to': '11:30'},
        }),
        req('tomorrow', {'plannedDate': '2026-11-04'}),
        req('collect', {'handoff': 'collect'}),
        req('estimate', {'status': 'estimate_sent'}),
        req('received', {'status': 'received'}),
        req('also-late', {
          'plannedWindow': {'from': '16:00', 'to': '18:00'},
        }),
      ], now);
      expect(
        [for (final r in list) r.id],
        ['early', 'also-late', 'late', 'none'],
      );
    });

    test('the day is the business\'s, not UTC\'s', () {
      // 03:00 UTC on Nov 4 is still the evening of Nov 3 in New York.
      final evening = DateTime.utc(2026, 11, 4, 3);
      expect(comingTodayRequests([req('a', const {})], evening), hasLength(1));
      final morning = DateTime.utc(2026, 11, 4, 12);
      expect(comingTodayRequests([req('a', const {})], morning), isEmpty);
    });

    test('Expected never repeats a card shown under Coming today', () {
      final a = req('a', const {});
      final b = req('b', {'plannedDate': '2026-11-05'});
      final coming = comingTodayRequests([a, b], now);
      expect(
        [
          for (final r in expectedExcept([a, b], coming)) r.id,
        ],
        ['b'],
      );
    });
  });

  group('a window in words', () {
    test('English, 12-hour', () {
      expect(requestWindowRangeText('14:00', '16:00', 'en'), '2:00 PM–4:00 PM');
      expect(
        requestWindowRangeText('09:30', '11:30', 'en'),
        '9:30 AM–11:30 AM',
      );
      expect(
        requestWindowRangeText('00:00', '12:00', 'en'),
        '12:00 AM–12:00 PM',
      );
    });

    test('French', () {
      expect(requestWindowRangeText('14:00', '16:00', 'fr'), '14 h–16 h');
      expect(requestWindowRangeText('09:30', '11:30', 'fr'), '9 h 30–11 h 30');
    });

    test('not a time is none', () {
      expect(requestWindowRangeText('x', '16:00', 'en'), isNull);
    });

    test('a pickup window reads as a range, the old words are left alone', () {
      expect(requestWindowTextOf('14:00-16:00', 'en'), '2:00 PM–4:00 PM');
      expect(requestWindowTextOf('morning', 'en'), isNull);
    });
  });

  group('a container\'s planned departure', () {
    test('is optional and recorded as typed', () {
      expect(validateContainer(const ContainerDraft(label: 'Box 1')), isEmpty);
      final record = containerRecord(
        const ContainerDraft(
          label: 'Box 1',
          plannedDepartureDate: '2026-11-14',
        ),
      );
      expect(record['plannedDepartureDate'], '2026-11-14');
      expect(
        containerRecord(
          const ContainerDraft(label: 'Box 1'),
        )['plannedDepartureDate'],
        '',
      );
    });

    test('must be a real day', () {
      expect(
        validateContainer(
          const ContainerDraft(
            label: 'Box 1',
            plannedDepartureDate: '2026-02-30',
          ),
        ),
        ['planned_departure_invalid'],
      );
      expect(
        validateContainer(
          const ContainerDraft(label: 'Box 1', plannedDepartureDate: 'soon'),
        ),
        ['planned_departure_invalid'],
      );
    });

    test('is read from the stored container', () {
      final c = ShippingContainer.fromMap('c1', {
        'businessId': 'b1',
        'label': 'Box 1',
        'plannedDepartureDate': '2026-11-14',
      });
      expect(c.plannedDepartureDate, '2026-11-14');
      expect(
        ShippingContainer.fromMap('c2', {
          'businessId': 'b1',
        }).plannedDepartureDate,
        '',
      );
    });
  });
}

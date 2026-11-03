import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/package_price_list.dart';

/// The app's mirror of `functions/package_price_list.js`. The server, the
/// console and the app each run every case of the shared fixture
/// (`functions/test/fixtures/package-price-list-cases.json`) and must produce
/// exactly its `expect`.
void main() {
  final fixture =
      jsonDecode(
            File(
              'functions/test/fixtures/package-price-list-cases.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;

  List<Map<String, dynamic>> cases(String key) =>
      (fixture[key] as List).cast<Map<String, dynamic>>();
  Map<String, dynamic> map(Object? value) =>
      (value as Map).cast<String, dynamic>();
  final route = map(fixture['route']);

  /// Through JSON, as the fixture was written: `2.0` is `2`.
  Object? json(Object? value) => jsonDecode(jsonEncode(value));

  test('the fixture has its cases', () {
    expect(cases('baskets').length, greaterThanOrEqualTo(6));
    expect(cases('counter').length, greaterThanOrEqualTo(5));
    expect(cases('departures').length, greaterThanOrEqualTo(6));
    expect(cases('routes').length, greaterThanOrEqualTo(4));
  });

  group('priceBasket, the shared cases', () {
    for (final c in cases('baskets')) {
      test(c['name'], () {
        final ctx = map(c['ctx']);
        final got = priceBasket(
          c['route'] == null ? null : map(c['route']),
          c['pieces'],
          barrelPriceCents: ctx['barrelPriceCents'] as int?,
          pickupFeeCents: ctx['pickupFeeCents'] as int?,
        );
        expect(json(got.toMap()), c['expect']);
      });
    }
  });

  group('counterPriceCents, the shared cases', () {
    for (final c in cases('counter')) {
      test(c['name'], () {
        expect(counterPriceCents(map(c['price']), c['weighedLb']), c['expect']);
      });
    }
  });

  group('nextDeparture, the shared cases', () {
    for (final c in cases('departures')) {
      test(c['name'], () {
        final input = map(c['input']);
        final got = nextDeparture(
          departure: input['departure'],
          planned: input['planned'],
          todayKey: input['todayKey'] as String,
        );
        expect(json(got.toMap()), c['expect']);
      });
    }
  });

  group('rankOptions, the shared cases', () {
    final rank = map(fixture['rank']);
    final expected = map(rank['expect']);
    for (final sort in priceSorts) {
      test(sort, () {
        final got = rankOptions(rank['options'] as List, sort);
        expect([for (final o in got) o['businessId']], expected[sort]);
      });
    }
    test('every sort in the fixture is a sort the app has', () {
      expect(expected.keys.toSet(), priceSorts.toSet());
    });
    test('an unknown sort is the default one', () {
      expect([
        for (final o in rankOptions(rank['options'] as List, 'nope'))
          o['businessId'],
      ], expected['best']);
    });
  });

  group('validateRoute, the shared cases', () {
    for (final c in cases('routes')) {
      test(c['name'], () {
        expect(json(validateRoute(c['raw']).toMap()), c['expect']);
      });
    }
  });

  group('the rules the server tests beside the fixture', () {
    test('a phone box packed out with shoes is charged at the excess rate', () {
      final priced = pricePiece(route, {'priceItemId': 'i_phone'});
      expect(priced.price!['excessPerLbCents'], 450);
      expect(counterPriceCents(priced.price, 2), 4000);
      expect(counterPriceCents(priced.price, 6), 4000 + 4 * 450);
    });

    test('a whole list refuses countries the business does not ship to', () {
      final result = validatePriceList(
        {
          'routes': {
            'gn': {
              'air': {
                'items': [
                  {
                    'label': 'Phone',
                    'categoryId': 'electronics',
                    'priceCents': 4000,
                  },
                ],
              },
            },
            'zz': {
              'sea': {
                'perLbCents': {'food': 300},
              },
            },
          },
        },
        ['gn'],
      );
      expect(result.routes, isNull);
      expect(result.errors, ['country_unknown']);
    });

    test('a whole list keeps only priced modes and countries', () {
      final result = validatePriceList(
        {
          'routes': {
            'gn': {
              'air': {
                'perLbCents': {'clothing': 700},
              },
              'sea': null,
            },
            'sn': {
              'sea': {'items': []},
            },
          },
        },
        ['gn', 'sn'],
      );
      expect(result.errors, isEmpty);
      expect(result.routes!.keys, ['gn']);
      expect(result.routes!['gn']!.keys, ['air']);
      final air = routeOf({'routes': result.routes}, 'gn', 'air')!;
      expect((air['perLbCents'] as Map)['clothing'], 700);
      expect(routeOf({'routes': result.routes}, 'gn', 'sea'), isNull);
    });

    test('an unknown mode is refused', () {
      final result = validatePriceList(
        {
          'routes': {
            'gn': {'train': <String, dynamic>{}},
          },
        },
        ['gn'],
      );
      expect(result.errors, ['mode_invalid']);
    });

    test('item ids come from names and stay stable', () {
      expect(itemIdFor('Télé 43"'), 'i_tele_43');
      expect(itemIdFor('   '), 'i_item');
      expect(itemIdFor('Phone (any)'), 'i_phone_any');
      expect(itemIdFor('Crème à Raser'), 'i_creme_a_raser');
    });

    test('found via: anything but business is Laawol', () {
      expect(foundVia('business'), 'business');
      expect(foundVia(''), 'laawol');
      expect(foundVia(null), 'laawol');
      expect(foundVia('other'), 'laawol');
    });

    test('every 2 weeks skips the off week', () {
      final departure = {
        'weekdays': ['sat'],
        'everyWeeks': 2,
        'anchorDate': '2026-11-07',
      };
      expect(nextScheduledDate(departure, '2026-11-08'), '2026-11-21');
      expect(nextScheduledDate(departure, '2026-11-07'), '2026-11-07');
    });
  });

  group('days', () {
    test('dateKeyValid refuses what is not a calendar day', () {
      expect(dateKeyValid('2026-11-03'), isTrue);
      expect(dateKeyValid('2026-02-30'), isFalse);
      expect(dateKeyValid('2026-1-3'), isFalse);
      expect(dateKeyValid(''), isFalse);
    });

    test('addDays and weekdayOf cross months, years and daylight time', () {
      expect(addDays('2026-11-03', 1), '2026-11-04');
      expect(addDays('2026-12-31', 1), '2027-01-01');
      expect(addDays('2026-03-01', -1), '2026-02-28');
      // Daylight time ended on 2026-11-01: still exactly one day.
      expect(addDays('2026-10-31', 2), '2026-11-02');
      expect(weekdayOf('2026-11-03'), 'tue');
      expect(weekdayOf('2026-11-08'), 'sun');
      expect(weekdayOf('2026-11-02'), 'mon');
    });
  });

  group('repricePieces', () {
    Map<String, dynamic> stored(
      Map<String, dynamic> piece,
      Map<String, dynamic> r,
    ) {
      final priced = pricePiece(r, piece);
      return {
        'id': 'p1',
        'estimateCents': priced.estimateCents,
        'price': priced.price,
      };
    }

    test('moves list-priced pieces and says when the total went up', () {
      final before = [
        stored({'priceItemId': 'i_phone', 'quantity': 2}, route),
        {
          'id': 'p2',
          'kind': 'barrel',
          'estimateCents': 12500,
          'price': {'source': 'barrel', 'unitCents': 12500},
        },
        {'id': 'p3', 'kind': 'box', 'estimateCents': null, 'price': null},
      ];
      final dearer = {
        ...route,
        'items': [
          for (final i in route['items'] as List)
            map(i)['id'] == 'i_phone' ? {...map(i), 'priceCents': 4500} : i,
        ],
      };
      final out = repricePieces(before, dearer);
      expect(out.changed, isTrue);
      expect(out.wentUp, isTrue);
      expect(out.pieces[0]['estimateCents'], 9000);
      expect(out.pieces[1], before[1]);
      expect(out.pieces[2], before[2]);
      expect(out.cents, {'p1': 9000});
    });

    test('a cheaper price changes without going up; no change is none', () {
      final before = [
        stored({'categoryId': 'clothing', 'weightLb': 50}, route),
      ];
      final cheaper = {
        ...route,
        'perLbCents': {'clothing': 500},
      };
      final out = repricePieces(before, cheaper);
      expect(out.changed, isTrue);
      expect(out.wentUp, isFalse);
      expect(out.pieces[0]['estimateCents'], 25000);
      expect(repricePieces(before, route).changed, isFalse);
    });

    test('an item taken off the list keeps its price', () {
      final before = [
        stored({'priceItemId': 'i_laptop'}, route),
      ];
      final out = repricePieces(before, {...route, 'items': <Object?>[]});
      expect(out.changed, isFalse);
      expect(out.pieces[0]['estimateCents'], 7000);
    });
  });

  group('the category and size lists', () {
    test('every category has both languages', () {
      expect(priceCategories.map((c) => c.id), [
        'general',
        'clothing',
        'food',
        'documents',
        'cosmetics',
        'electronics',
        'fragile',
      ]);
      for (final c in priceCategories) {
        expect(c.label('en'), isNotEmpty);
        expect(c.label('fr'), isNotEmpty);
      }
    });

    test('the size buttons fill 10, 50 and 70 pounds', () {
      expect(
        [for (final p in sizePresets) (p.id, p.lb)],
        [('small_bag', 10), ('suitcase', 50), ('big_box', 70)],
      );
    });
  });
}

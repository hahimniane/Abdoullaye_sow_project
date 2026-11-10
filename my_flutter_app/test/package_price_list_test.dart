import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/package_price_list.dart';
import 'package:my_flutter_app/services/package_proof.dart';

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
          lang: ctx['lang'] as String?,
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

  group('box sizes, the shared cases', () {
    final box = map(fixture['boxSizes']);
    List<Map<String, dynamic>> boxCases(String key) =>
        (box[key] as List).cast<Map<String, dynamic>>();

    test('the fixture has its cases and the sizes are Laawol\'s', () {
      expect(boxCases('sizeFor').length, greaterThanOrEqualTo(20));
      expect(boxCases('dims').length, greaterThanOrEqualTo(5));
      expect(boxCases('routes').length, greaterThanOrEqualTo(10));
      expect(boxCases('pieces').length, greaterThanOrEqualTo(20));
      expect(boxCases('baskets').length, greaterThanOrEqualTo(3));
      expect(
        [for (final b in boxSizes) b.id],
        ['small', 'medium', 'large', 'xl'],
      );
      expect(boxSlackIn, 1);
      expect(boxDimMaxIn, 120);
      expect(boxSizes.last.maxIn, isNull);
      expect(boxSizes.first.label('fr'), 'Petite');
      expect(boxSizes[1].example('fr'), 'Environ un carton de micro-ondes');
    });

    for (final c in boxCases('sizeFor')) {
      test('size: ${c['name']}', () {
        expect(boxSizeFor(c['dims']), c['expect']);
      });
    }
    for (final c in boxCases('dims')) {
      test('dims: ${c['name']}', () {
        expect(json(cleanDims(c['raw'])), c['expect']);
      });
    }
    for (final c in boxCases('routes')) {
      test('route: ${c['name']}', () {
        final got = c.containsKey('mode')
            ? validateRoute(c['raw'], mode: c['mode'] as String)
            : validateRoute(c['raw']);
        expect(json(got.toMap()), c['expect']);
      });
    }
    for (final c in boxCases('pieces')) {
      test('piece: ${c['name']}', () {
        final ctx = c['ctx'] == null
            ? const <String, dynamic>{}
            : map(c['ctx']);
        final got = pricePiece(
          c['route'] == null ? null : map(c['route']),
          c['piece'],
          barrelPriceCents: ctx['barrelPriceCents'] as int?,
          lang: ctx['lang'] as String?,
        );
        expect(json(got.toMap()), c['expect']);
      });
    }
    for (final c in boxCases('baskets')) {
      test('basket: ${c['name']}', () {
        final ctx = map(c['ctx']);
        final got = priceBasket(
          map(c['route']),
          c['pieces'],
          barrelPriceCents: ctx['barrelPriceCents'] as int?,
          pickupFeeCents: ctx['pickupFeeCents'] as int?,
          lang: ctx['lang'] as String?,
        );
        expect(json(got.toMap()), c['expect']);
      });
    }
  });

  group('box sizes, the rules the server tests beside the fixture', () {
    final route = <String, dynamic>{
      'items': <Object?>[],
      'perLbCents': <String, int>{},
      'departure': null,
      'boxPricesCents': {'small': 2500, 'medium': 3500, 'large': 5500},
    };
    Map<String, dynamic> stored(Map<String, Object?> piece) {
      final out = pricePiece(route, piece);
      return {
        'id': 'p1',
        ...piece,
        'price': out.price,
        'estimateCents': out.estimateCents,
      };
    }

    test('a whole list refuses box prices on an air route', () {
      final air = validatePriceList(
        {
          'routes': {
            'gn': {
              'air': {
                'boxPricesCents': {'small': 2500},
              },
              'sea': {
                'boxPricesCents': {'small': 2500},
              },
            },
          },
        },
        ['gn'],
      );
      expect(air.routes, isNull);
      expect(air.errors, ['box_sizes_sea_only']);
    });

    test('a whole list keeps Sea box prices', () {
      final sea = validatePriceList(
        {
          'routes': {
            'gn': {
              'sea': {
                'boxPricesCents': {'small': 2500, 'medium': 3500},
              },
            },
          },
        },
        ['gn'],
      );
      expect(sea.errors, isEmpty);
      expect(sea.routes!['gn']!['sea']!['boxPricesCents'], {
        'small': 2500,
        'medium': 3500,
      });
    });

    test('the new refusals have messages', () {
      for (final code in [
        'box_sizes_sea_only',
        'box_price_invalid',
        'box_size_invalid',
        'dims_invalid',
      ]) {
        expect(priceListMessages[code], isNotNull, reason: code);
      }
    });

    test('the counter does not move a box price', () {
      final priced = pricePiece(route, {
        'kind': 'box',
        'boxSize': 'medium',
        'quantity': 2,
      });
      expect(counterPriceCents(priced.price, 99), 7000);
    });

    test('re-prices a box at today\'s list', () {
      final before = [
        stored({'kind': 'box', 'boxSize': 'medium', 'quantity': 2}),
      ];
      final dearer = {
        ...route,
        'boxPricesCents': {'small': 2500, 'medium': 4000, 'large': 5500},
      };
      final out = repricePieces(before, dearer);
      expect(out.changed, isTrue);
      expect(out.wentUp, isTrue);
      expect(out.cents['p1'], 8000);
      expect(out.pieces[0]['price']['unitCents'], 4000);
      expect(repricePieces(before, route).changed, isFalse);
    });

    test('a box whose size left the list keeps its price', () {
      final before = [
        stored({'kind': 'box', 'boxSize': 'medium'}),
      ];
      final out = repricePieces(before, {...route, 'boxPricesCents': {}});
      expect(out.changed, isFalse);
      expect(out.pieces[0]['estimateCents'], 3500);
    });
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

  // Kilos (docs/SHIPPING_SIMPLE_HOME.md K): the `kilos` section of the shared
  // fixture. Every case kind it holds is replayed here, as the server and the
  // console replay it.
  group('kilos, the shared cases', () {
    final k = map(fixture['kilos']);
    List<Map<String, dynamic>> kilos(String key) =>
        (k[key] as List).cast<Map<String, dynamic>>();
    Map<String, dynamic>? routeIn(Object? value) =>
        value == null ? null : map(value);

    test('the fixture has its cases', () {
      expect(kilos('lists').length, greaterThanOrEqualTo(8));
      expect(kilos('pieces').length, greaterThanOrEqualTo(15));
      expect(kilos('baskets').length, greaterThanOrEqualTo(2));
      expect(kilos('counter').length, greaterThanOrEqualTo(4));
      expect(kilos('reprice').length, greaterThanOrEqualTo(4));
      expect(kilos('convert').length, greaterThanOrEqualTo(6));
      expect(kilos('rates').length, greaterThanOrEqualTo(4));
      expect(kilos('weightIn').length, greaterThanOrEqualTo(5));
      expect(kilos('weights').length, greaterThanOrEqualTo(10));
      expect(kilos('weightText').length, greaterThanOrEqualTo(6));
    });

    for (final c in kilos('lists')) {
      test('kilo list: ${c['name']}', () {
        final got = validatePriceList(
          c['raw'],
          (c['countryIds'] as List).cast<String>(),
        );
        expect(json(got.toMap()), c['expect']);
      });
    }
    for (final c in kilos('pieces')) {
      test('kilo piece: ${c['name']}', () {
        final ctx = c['ctx'] == null
            ? const <String, dynamic>{}
            : map(c['ctx']);
        final got = pricePiece(
          routeIn(c['route']),
          c['piece'],
          barrelPriceCents: ctx['barrelPriceCents'] as int?,
          lang: ctx['lang'] as String?,
        );
        expect(json(got.toMap()), c['expect']);
      });
    }
    for (final c in kilos('baskets')) {
      test('kilo basket: ${c['name']}', () {
        final ctx = c['ctx'] == null
            ? const <String, dynamic>{}
            : map(c['ctx']);
        final got = priceBasket(
          routeIn(c['route']),
          c['pieces'],
          barrelPriceCents: ctx['barrelPriceCents'] as int?,
          pickupFeeCents: ctx['pickupFeeCents'] as int?,
          lang: ctx['lang'] as String?,
        );
        expect(json(got.toMap()), c['expect']);
      });
    }
    for (final c in kilos('counter')) {
      test('kilo counter: ${c['name']}', () {
        expect(counterPriceCents(map(c['price']), c['weighed']), c['expect']);
      });
    }
    for (final c in kilos('reprice')) {
      test('kilo reprice: ${c['name']}', () {
        final out = repricePieces(c['pieces'], routeIn(c['route']));
        expect(
          json({
            'pieces': out.pieces,
            'changed': out.changed,
            'wentUp': out.wentUp,
            'cents': out.cents,
          }),
          c['expect'],
        );
      });
    }
    for (final c in kilos('convert')) {
      test('convert: ${c['name']}', () {
        expect(
          convertWeight(c['value'], c['from'] as String, c['to'] as String),
          c['expect'],
        );
      });
    }
    for (final c in kilos('rates')) {
      test('rate in: ${c['name']}', () {
        expect(
          rateIn(c['cents'] as int, c['from'] as String, c['to'] as String),
          c['expect'],
        );
      });
    }
    for (final c in kilos('weightIn')) {
      test('weight in: ${c['name']}', () {
        expect(weightIn(c['unit'] as String, c['line']), c['expect']);
      });
    }
    for (final c in kilos('weights')) {
      test('weight: ${c['name']}', () {
        final input = map(c['input']);
        final got = normalizeWeight(
          weightLb: input['weightLb'],
          weightKg: input['weightKg'],
        );
        expect({
          'weightLb': got.weightLb,
          'weightKg': got.weightKg,
          'error': got.error,
        }, c['expect']);
      });
    }
    for (final c in kilos('weightText')) {
      test('weight text: ${c['name']}', () {
        expect(weightText(c['weight'], c['lang'] as String), c['expect']);
      });
    }
  });

  group('kilos, the rules pinned by hand', () {
    final kg = map(fixture['kilos']['route']);
    final lbRoute = map(fixture['kilos']['lbRoute']);

    test('\$25/kg x 10 kg is exactly \$250.00', () {
      final out = pricePiece(kg, {'categoryId': 'general', 'weightLb': 10});
      expect(out.estimateCents, 25000);
      expect(out.price!['unit'], 'kg');
      expect(out.price!['weightLb'], 10);
      expect(out.description, 'General goods · 10 kg');
    });

    test('a pounds list and its routes carry no unit key anywhere', () {
      final list = validatePriceList(
        {
          'weightUnit': 'lb',
          'routes': {
            'gn': {
              'sea': {
                'perLbCents': {'general': 450},
                'items': [
                  {
                    'label': 'Phone',
                    'categoryId': 'electronics',
                    'priceCents': 4000,
                    'includedLb': 2,
                  },
                ],
              },
            },
          },
        },
        ['gn'],
      );
      expect(jsonEncode(list.routes), isNot(contains('unit')));
      final sea = list.routes!['gn']!['sea']!;
      final piece = pricePiece(sea, {'categoryId': 'general', 'weightLb': 50});
      expect(piece.price!.containsKey('unit'), isFalse);
      final item = pricePiece(sea, {'priceItemId': 'i_phone'});
      expect(item.price!.containsKey('unit'), isFalse);
    });

    test('the rounding is to a tenth, before pricing', () {
      // 10 lb = 4.5359 kg -> 4.5 kg, not 4.5359 (which would price 11339.8).
      final out = pricePiece(kg, {
        'categoryId': 'general',
        'weightLb': 10,
        'weightUnit': 'lb',
      });
      expect(out.price!['weightLb'], 4.5);
      expect(out.estimateCents, 11250);
    });

    test('a weight is checked in the unit it was typed in', () {
      expect(
        pricePiece(lbRoute, {
          'categoryId': 'general',
          'weightLb': 901,
          'weightUnit': 'kg',
        }).error,
        'weight_kg_invalid',
      );
      expect(
        pricePiece(lbRoute, {'categoryId': 'general', 'weightLb': 901}).error,
        '',
      );
      expect(
        pricePiece(kg, {'categoryId': 'general', 'weightLb': 901}).error,
        'weight_kg_invalid',
      );
    });

    test('each refusal has a message; the kilo list names kilos', () {
      for (final code in ['unit_invalid', 'weight_kg_invalid']) {
        expect(priceListMessages[code], isNotEmpty, reason: code);
      }
      expect(priceListMessage('per_lb_invalid', 'kg'), contains('per kilo'));
      expect(priceListMessage('per_lb_invalid', 'lb'), contains('per pound'));
      expect(priceListMessage('included_invalid', 'kg'), contains('kg'));
      expect(
        priceListMessage('price_invalid', 'kg'),
        priceListMessages['price_invalid'],
      );
      expect(priceListMessage('nope'), '');
    });

    test('the size presets have a kilo weight', () {
      expect([for (final p in sizePresets) p.kg], [5, 23, 32]);
      expect([for (final p in sizePresets) p.lb], [10, 50, 70]);
      expect([for (final p in sizePresets) p.inUnit('kg')], [5, 23, 32]);
      expect([for (final p in sizePresets) p.inUnit('lb')], [10, 50, 70]);
      expect(PriceLimit.weightKg, 900);
      expect(kgToLb, 2.20462);
    });

    test('unitOf answers kg only for a kilo route, snapshot or list', () {
      expect(unitOf(kg), 'kg');
      expect(unitOf({'weightUnit': 'kg'}), 'kg');
      expect(unitOf(route), 'lb');
      expect(unitOf(null), 'lb');
      expect(unitOf({'unit': 'oz'}), 'lb');
    });

    test('a counter price in kilos for a line weighed in the other unit', () {
      final price = pricePiece(kg, {
        'categoryId': 'general',
        'weightLb': 10,
      }).price;
      // Staff weighed 27.6 lb: the caller converts to the price's unit first.
      final weighed = weightIn(unitOf(price), {'weightLb': 27.6});
      expect(weighed, 12.5);
      expect(counterPriceCents(price, weighed), 31250);
    });

    test('a kilo field typed in kilos makes the pounds a line stores', () {
      expect(weightLbFromKg(0.1), 0.2);
      expect(weightLbFromKg(0.01), 0.1);
      expect(weightLbFromKg(900), 1984.2);
    });

    test('weightText keeps its pounds call and takes a line', () {
      expect(weightText(4.5, 'fr'), '4,5 lb');
      expect(weightText({'weightLb': 22, 'weightKg': 10}), '10 kg');
      expect(weightText({'weightLb': 22, 'weightKg': null}), '22 lb');
      expect(weightText({}), '');
      expect(weightText(null), '');
    });
  });
}

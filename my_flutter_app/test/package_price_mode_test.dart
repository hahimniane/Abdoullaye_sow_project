import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/line_pieces.dart';
import 'package:my_flutter_app/services/package_price_mode.dart';
import 'package:my_flutter_app/services/piece_rows.dart';

/// One price for the whole package (docs/PACKAGE_ONE_PRICE.md): the app's
/// mirror of `functions/package_price_mode.js`. The server, the console and
/// the app each run every case of the shared fixture
/// (`functions/test/fixtures/package-price-cases.json`) and must produce
/// exactly its `expected`.

LinePiece _piece(
  String id,
  int? cents, {
  String kind = 'box',
  String description = 'Clothes',
  PieceSize? size,
}) => LinePiece(
  id: id,
  kind: kind,
  description: description,
  sizeIn: size,
  priceCents: cents,
);

void main() {
  final fixture =
      jsonDecode(
            File(
              'functions/test/fixtures/package-price-cases.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  final cases = (fixture['cases'] as List).cast<Map<String, dynamic>>();

  group('the shared package-price cases', () {
    test('there are cases', () => expect(cases.length, greaterThan(10)));

    for (final c in cases) {
      test(c['note'] as String, () {
        final total = c['total'];
        final stored = c['stored'] as List?;
        final result = packagePiecePrices(
          total is int ? total : null,
          [for (final id in (c['ids'] as List)) id as String],
          stored == null
              ? null
              : [
                  for (final s in stored)
                    _piece((s as Map)['id'] as String, s['priceCents'] as int?),
                ],
        );
        expect(result, equals(c['expected']));
      });
    }

    test('the server module exports what the app mirrors', () {
      final js = File('functions/package_price_mode.js').readAsStringSync();
      for (final name in [
        'priceModeOf',
        'validPriceMode',
        'packagePiecePrices',
      ]) {
        expect(js, contains(name));
      }
    });
  });

  group('the mode', () {
    test('piece unless the business says package', () {
      expect(packagePriceModeOf(null), packagePriceModePiece);
      expect(packagePriceModeOf({}), packagePriceModePiece);
      expect(
        packagePriceModeOf({'packagePriceSettings': 'package'}),
        packagePriceModePiece,
      );
      expect(
        packagePriceModeOf({
          'packagePriceSettings': {'mode': 'weird'},
        }),
        packagePriceModePiece,
      );
      expect(
        packagePriceModeOf({
          'packagePriceSettings': {'mode': 'package'},
        }),
        packagePriceModePackage,
      );
    });

    test('a mode is valid only when it is one of the two', () {
      expect(validPackagePriceMode('piece'), 'piece');
      expect(validPackagePriceMode('package'), 'package');
      expect(validPackagePriceMode('PACKAGE'), '');
      expect(validPackagePriceMode(null), '');
      expect(validPackagePriceMode(3), '');
    });
  });

  group('rows from a saved package, by shape only', () {
    test('prices are ignored: pieces that read the same are one row', () {
      final saved = [
        _piece('p1', 12000),
        _piece('p2', 12000),
        _piece('p3', 6000),
        _piece('p4', null, kind: 'barrel', description: ''),
      ];
      final groups = groupPieceRows(saved, ignorePrices: true);
      expect(groups.map((g) => g.count), [3, 1]);
      expect(groups.every((g) => g.priceCents == null), isTrue);
      expect(groups.every((g) => g.priceFor == priceForEach), isTrue);
      // The same pieces in the per-piece form split on their prices.
      expect(groupPieceRows(saved).length, greaterThan(2));
    });

    test('a different size or description is another row', () {
      final groups = groupPieceRows([
        _piece('p1', 100, size: const PieceSize(10, 10, 10)),
        _piece('p2', 100),
        _piece('p3', 100, description: 'Shoes'),
      ], ignorePrices: true);
      expect(groups.map((g) => g.count), [1, 1, 1]);
    });
  });

  group('the price field opens on', () {
    test('the sum of the saved prices, blank when none has one', () {
      expect(
        packagePricePrefill([_piece('p1', 12000), _piece('p2', 6000)]),
        18000,
      );
      expect(packagePricePrefill([_piece('p1', 0)]), 0);
      expect(packagePricePrefill([_piece('p1', null)]), isNull);
      expect(packagePricePrefill(const []), isNull);
      expect(packagePricePrefill([_piece('p1', 500), _piece('p2', null)]), 500);
    });

    test('a request: the estimates added up, only when all have one', () {
      expect(packagePriceFromEstimates([9000, 4000]), 13000);
      expect(packagePriceFromEstimates([9000, null]), isNull);
      expect(packagePriceFromEstimates(const []), isNull);
    });
  });

  group('the price as typed', () {
    test('reads dollars and cents; blank is nothing; junk is invalid', () {
      expect(readPackagePriceField('300').cents, 30000);
      expect(readPackagePriceField('45,50').cents, 4550);
      expect(readPackagePriceField('').cents, isNull);
      expect(readPackagePriceField('').invalid, isFalse);
      expect(readPackagePriceField('abc').invalid, isTrue);
      expect(readPackagePriceField('-5').invalid, isTrue);
      expect(readPackagePriceField('0').cents, 0);
    });

    test('problems: a customer needs more than \$0, stock may be blank', () {
      expect(packagePriceProblems('', requirePrice: true), [
        'package_price_required',
      ]);
      expect(packagePriceProblems('0', requirePrice: true), [
        'package_price_required',
      ]);
      expect(packagePriceProblems('250', requirePrice: true), isEmpty);
      expect(packagePriceProblems('', requirePrice: false), isEmpty);
      expect(packagePriceProblems('0', requirePrice: false), isEmpty);
      expect(packagePriceProblems('x', requirePrice: true), [
        'piece_price_invalid',
      ]);
      expect(packagePriceProblems('-1', requirePrice: false), [
        'piece_price_invalid',
      ]);
    });

    test('the total is the price plus the pickup fee', () {
      expect(packageTotalCents('300', 2000), 32000);
      expect(packageTotalCents('300'), 30000);
      expect(packageTotalCents('', 2000), isNull);
      expect(packageTotalCents('x', 2000), isNull);
      expect(packageTotalCents('0', 0), isNull);
    });
  });

  group('what is sent', () {
    final saved = [
      _piece('p1', 12000),
      _piece('p2', 12000),
      _piece('p3', 6000),
    ];
    List<Map<String, Object?>> drafts(List<String> ids) => [
      for (final id in ids) {'id': id, 'kind': 'box', 'description': 'Clothes'},
    ];
    List<Object?> prices(List<Map<String, Object?>> sent) => [
      for (final p in sent) p['priceCents'],
    ];

    test('a new package shares the price among its pieces', () {
      final sent = packagePieceDrafts(drafts(['', '', '']), priceText: '100');
      expect(prices(sent), [3334, 3333, 3333]);
      expect(sent.first['kind'], 'box');
    });

    test('an edit saved untouched keeps the item prices', () {
      final sent = packagePieceDrafts(
        drafts(['p1', 'p2', 'p3']),
        priceText: '300',
        stored: saved,
      );
      expect(prices(sent), [12000, 12000, 6000]);
    });

    test('a piece added shares the price among four', () {
      final sent = packagePieceDrafts(
        drafts(['p1', 'p2', 'p3', '']),
        priceText: '300',
        stored: saved,
      );
      expect(prices(sent), [7500, 7500, 7500, 7500]);
    });

    test('a piece removed shares the price among two', () {
      final sent = packagePieceDrafts(
        drafts(['p1', 'p3']),
        priceText: '300',
        stored: saved,
      );
      expect(prices(sent), [15000, 15000]);
    });

    test('a changed price shares again', () {
      final sent = packagePieceDrafts(
        drafts(['p1', 'p2', 'p3']),
        priceText: '330',
        stored: saved,
      );
      expect(prices(sent), [11000, 11000, 11000]);
    });

    test('no price typed: no piece has one; junk stays unreadable', () {
      expect(prices(packagePieceDrafts(drafts(['', '']), priceText: '')), [
        null,
        null,
      ]);
      final junk = packagePieceDrafts(drafts(['', '']), priceText: 'abc');
      expect(prices(junk), ['unreadable', 'unreadable']);
      expect(pieceErrors(junk), contains('piece_price_invalid'));
    });

    test('for a customer the sent pieces pass the server\'s price rule', () {
      final sent = packagePieceDrafts(drafts(['', '']), priceText: '80');
      expect(piecePriceRequiredErrors(sent), isEmpty);
      final blank = packagePieceDrafts(drafts(['', '']), priceText: '');
      expect(piecePriceRequiredErrors(blank), ['piece_price_required']);
    });
  });

  test('the count change under the price', () {
    expect(packagePieceCountChange(3, 4), (added: 1, removed: 0));
    expect(packagePieceCountChange(3, 1), (added: 0, removed: 2));
    expect(packagePieceCountChange(3, 3), (added: 0, removed: 0));
    expect(packagePieceCountChange(0, 5), (added: 0, removed: 0));
  });
}

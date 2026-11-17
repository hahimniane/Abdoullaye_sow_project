import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/line_pieces.dart';
import 'package:my_flutter_app/services/piece_rows.dart';

// The editor's rows (docs/WAITING_PACKAGES.md "How many, and a row priced
// all together"). The console reads the same lines the same way
// (admin_web/src/lib/piece-drafts.test.ts): the cases below are its cases.

LinePiece _box(String id, int? cents, {String what = 'Clothes'}) =>
    LinePiece(id: id, kind: 'box', description: what, priceCents: cents);

LinePiece _barrel(String id, int? cents) =>
    LinePiece(id: id, kind: 'barrel', priceCents: cents);

List<List<Object?>> _read(List<PieceRowGroup> rows) => [
  for (final row in rows)
    [
      [for (final p in row.pieces) p.id],
      row.priceFor,
      row.priceCents,
    ],
];

void main() {
  test('identical pieces that follow each other are one row', () {
    final rows = groupPieceRows([
      _box('p1', 4500),
      _box('p2', 4500),
      _barrel('p3', 12000),
      // The same as the first two, but not next to them: its own row, so
      // the order (and the labels' numbers) is kept.
      _box('p4', 4500),
      // Another price, and not a cent's share of one amount: its own row.
      _box('p5', 5000),
    ]);
    expect(_read(rows), [
      [
        ['p1', 'p2'],
        'each',
        4500,
      ],
      [
        ['p3'],
        'each',
        12000,
      ],
      [
        ['p4'],
        'each',
        4500,
      ],
      [
        ['p5'],
        'each',
        5000,
      ],
    ]);
  });

  test('prices a cent apart are a row priced together for their sum', () {
    // Three boxes for \$200 together, then a barrel at \$100.
    final rows = groupPieceRows([
      _box('p1', 6667),
      _box('p2', 6667),
      _box('p3', 6666),
      _barrel('p4', 10000),
    ]);
    expect(_read(rows), [
      [
        ['p1', 'p2', 'p3'],
        'all',
        20000,
      ],
      [
        ['p4'],
        'each',
        10000,
      ],
    ]);
    // One price changed by hand: no longer one shared amount.
    final edited = groupPieceRows([
      _box('p1', 9000),
      _box('p2', 6667),
      _box('p3', 6666),
    ]);
    expect(_read(edited), [
      [
        ['p1'],
        'each',
        9000,
      ],
      [
        ['p2', 'p3'],
        'all',
        13333,
      ],
    ]);
  });

  test('what a piece is, its size and its price all tell rows apart', () {
    expect(
      groupPieceRows([
        _box('p1', 4500),
        _box('p2', 4500, what: 'Shoes'),
      ]).length,
      2,
    );
    expect(groupPieceRows([_box('p1', 4500), _barrel('p2', 4500)]).length, 2);
    const sized = LinePiece(
      id: 'p2',
      kind: 'box',
      description: 'Clothes',
      sizeIn: PieceSize(20, 20, 18),
      priceCents: 4500,
    );
    expect(groupPieceRows([_box('p1', 4500), sized]).length, 2);
    expect(groupPieceRows([sized, sized]).single.count, 2);
    // Not priced yet: one row, no price.
    final unpriced = groupPieceRows([_barrel('p1', null), _barrel('p2', null)]);
    expect(_read(unpriced), [
      [
        ['p1', 'p2'],
        'each',
        null,
      ],
    ]);
    // A priced piece and an unpriced one are not one amount.
    expect(groupPieceRows([_barrel('p1', 100), _barrel('p2', null)]).length, 2);
    expect(groupPieceRows(const <LinePiece>[]), isEmpty);
  });

  test('a piece kept alone never joins a row, nor has one join it', () {
    final rows = groupPieceRows([
      _box('p1', 4500),
      _box('p2', 4500),
      _box('p3', 4500),
    ], keepAlone: (piece) => piece.id == 'p2');
    expect([for (final row in rows) row.count], [1, 1, 1]);
  });

  test('a row shares its amount among its own pieces only', () {
    // The odd cents go to the first pieces; they add up to exactly \$200.
    expect(rowPieceCents(20000, 3, priceForAll), [6667, 6667, 6666]);
    expect(rowPieceCents(15000, 3, priceForAll), [5000, 5000, 5000]);
    expect(rowPieceCents(2000, 2, priceForEach), [2000, 2000]);
    // A row of one is priced each, whatever the switch was left on.
    expect(rowPricedTogether(priceForAll, 1), isFalse);
    expect(rowPieceCents(20000, 1, priceForAll), [20000]);
    expect(rowPieceCents(null, 3, priceForAll), [null, null, null]);
    expect(rowPieceCents(null, 2, priceForEach), [null, null]);
    expect(rowPieceCents(1, 4, priceForAll), [1, 0, 0, 0]);
  });

  test('what was grouped is sent back exactly as it was stored', () {
    final stored = [
      _box('p1', 6667),
      _box('p2', 6667),
      _box('p3', 6666),
      _barrel('p4', 10000),
      _box('p5', 2000, what: 'Shoes'),
      _box('p6', 2000, what: 'Shoes'),
    ];
    final sent = [
      for (final row in groupPieceRows(stored))
        ...rowPieceCents(row.priceCents, row.count, row.priceFor),
    ];
    expect(sent, [for (final p in stored) p.priceCents]);
  });

  test('the line under a row priced together says how it is shared', () {
    expect(rowShareRuns(15000, 3), [(count: 3, cents: 5000)]);
    expect(rowShareRuns(20000, 3), [
      (count: 2, cents: 6667),
      (count: 1, cents: 6666),
    ]);
    expect(rowShareRuns(20000, 1), isEmpty);
    expect(rowShareRuns(null, 3), isEmpty);
  });
}

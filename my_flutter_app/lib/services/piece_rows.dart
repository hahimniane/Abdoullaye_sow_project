/// The rows of the pieces editor (docs/WAITING_PACKAGES.md "How many, and a
/// row priced all together", owner 2026-11-16): identical pieces are one row
/// with its "How many", priced each or all of the row together. Only a way
/// of typing - a saved line is one piece per physical thing, each with its
/// own price - so nothing here is stored and no server rule knows it.
///
/// The console's half is `admin_web/src/lib/piece-drafts.ts`
/// (`pieceDraftsFromLine`, `piecesPayload`); the two must read the same line
/// the same way.
///
/// Pure: no Flutter, no Firebase.
library;

import 'line_pieces.dart';

/// A row of several priced piece by piece: each costs the price typed.
const priceForEach = 'each';

/// A row of several priced together: the amount typed is for all of the
/// row's pieces, shared among them only - never with another row's.
const priceForAll = 'all';

/// A "How many" above this is said back before it is taken (30 typed for 3
/// prints 30 labels).
const pieceCountConfirmAbove = 10;

/// A run of stored pieces the editor opens as one row.
class PieceRowGroup {
  const PieceRowGroup({
    required this.pieces,
    required this.priceFor,
    required this.priceCents,
  });

  /// The row's pieces, in the line's order: the first is the row's own, the
  /// others keep their ids beside it.
  final List<LinePiece> pieces;

  /// [priceForEach] or [priceForAll].
  final String priceFor;

  /// What the row's price field opens on: one piece's price, or - priced
  /// together - the sum of the row's pieces. Null while not priced.
  final int? priceCents;

  int get count => pieces.length;
}

bool _sameSize(PieceSize? a, PieceSize? b) {
  if (a == null || b == null) return a == null && b == null;
  return a.l == b.l && a.w == b.w && a.h == b.h;
}

/// Still one amount shared evenly: none of the pieces priced, or every one
/// priced and the prices are their sum spread as the form spreads it.
bool _sharedEvenly(List<int?> prices) {
  if (prices.every((cents) => cents == null)) return true;
  if (prices.contains(null)) return false;
  final cents = prices.cast<int>();
  final even = distributeCents(
    cents.fold<int>(0, (a, b) => a + b),
    cents.length,
  );
  for (var i = 0; i < cents.length; i++) {
    if (cents[i] != even[i]) return false;
  }
  return true;
}

/// A stored line's pieces as the editor's rows. Pieces that follow each
/// other, read the same (kind, description, size) and whose prices are one
/// amount shared evenly are one row: the same price on each is "each piece
/// at that price"; prices a cent apart (an amount that did not divide) are
/// "all together" for their sum. The same piece further down stays its own
/// row, so the order - and the numbers on the labels - never changes.
///
/// [keepAlone] holds a piece out of any run: one priced by its weight at
/// Received keeps its own row and its own weight field.
///
/// [ignorePrices] groups by shape alone (kind, description, size): the form
/// of a business that prices a package with one price
/// (docs/PACKAGE_ONE_PRICE.md), where a piece's own price is not on a row.
/// The groups then carry no price and are priced each.
List<PieceRowGroup> groupPieceRows(
  Iterable<LinePiece> pieces, {
  bool Function(LinePiece piece)? keepAlone,
  bool ignorePrices = false,
}) {
  final runs = <List<LinePiece>>[];
  for (final piece in pieces) {
    final last = runs.isEmpty ? null : runs.last;
    final alone = keepAlone?.call(piece) ?? false;
    final joins =
        last != null &&
        !alone &&
        !(keepAlone?.call(last.first) ?? false) &&
        last.first.kind == piece.kind &&
        last.first.description == piece.description &&
        _sameSize(last.first.sizeIn, piece.sizeIn) &&
        (ignorePrices ||
            _sharedEvenly([
              for (final p in last) p.priceCents,
              piece.priceCents,
            ]));
    if (joins) {
      last.add(piece);
    } else {
      runs.add([piece]);
    }
  }
  if (ignorePrices) {
    return [
      for (final run in runs)
        PieceRowGroup(
          pieces: List.unmodifiable(run),
          priceFor: priceForEach,
          priceCents: null,
        ),
    ];
  }
  return [
    for (final run in runs)
      () {
        final first = run.first.priceCents;
        final same = run.every((p) => p.priceCents == first);
        return PieceRowGroup(
          pieces: List.unmodifiable(run),
          priceFor: same ? priceForEach : priceForAll,
          priceCents: first == null
              ? null
              : same
              ? first
              : run.fold<int>(0, (sum, p) => sum + (p.priceCents ?? 0)),
        );
      }(),
  ];
}

/// Whether a row's price is one amount for all its pieces: asked for, on a
/// row of several. A row of one is always priced each.
bool rowPricedTogether(String priceFor, int count) =>
    priceFor == priceForAll && count > 1;

/// The price of each of a row's [count] pieces from the price typed
/// ([cents]; null for none). Priced each, every piece costs it; priced
/// together, it is spread over the row's own pieces as evenly as cents
/// allow, the odd cents on the first ones (`distributeCents`, the server's
/// rule), so they add up to exactly what was typed.
List<int?> rowPieceCents(int? cents, int count, String priceFor) =>
    rowPricedTogether(priceFor, count)
    ? distributeCents(cents, count)
    : List<int?>.filled(count < 1 ? 1 : count, cents);

/// How a row priced together is shared, for the line under it: the price
/// of the first pieces and how many take it, then the others'. One entry
/// when the amount divides. Empty for a row of one or no price.
List<({int count, int cents})> rowShareRuns(int? cents, int count) {
  if (cents == null || count < 2) return const [];
  final shares = distributeCents(cents, count).cast<int>();
  final high = shares.where((c) => c == shares.first).length;
  return [
    (count: high, cents: shares.first),
    if (high < count) (count: count - high, cents: shares.last),
  ];
}

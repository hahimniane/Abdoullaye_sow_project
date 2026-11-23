/// How a business prices a package (docs/PACKAGE_ONE_PRICE.md), app side.
///
/// `piece` (the default): staff type a price on each row of pieces.
/// `package`: staff type ONE price for the whole package and it is shared
/// equally among the package's pieces (odd cents on the first ones), so every
/// reader of piece prices - a split across containers, the receipt, the
/// business's bill - keeps working on the same numbers.
///
/// Mirrors `functions/package_price_mode.js` (`priceModeOf`, `validPriceMode`,
/// `packagePiecePrices`); `functions/test/fixtures/package-price-cases.json`
/// is run by the server, the console and this file's test.
///
/// Pure: no Flutter, no Firebase.
library;

import '../utils/money_input.dart';
import 'line_pieces.dart';

/// One price on each row of pieces (today's form).
const packagePriceModePiece = 'piece';

/// One price for the whole package.
const packagePriceModePackage = 'package';

const packagePriceModes = [packagePriceModePiece, packagePriceModePackage];

/// The business's setting callable.
const packagePriceModeCallable = 'setPackagePriceMode';

/// How a business prices a package: `businesses/{id}.packagePriceSettings
/// .mode`; [packagePriceModePiece] when unset or unknown.
String packagePriceModeOf(Map<dynamic, dynamic>? business) {
  final settings = business?['packagePriceSettings'];
  final mode = settings is Map ? settings['mode'] : null;
  return mode == packagePriceModePackage
      ? packagePriceModePackage
      : packagePriceModePiece;
}

/// [value] when it is a mode, else "" (`validPriceMode`).
String validPackagePriceMode(Object? value) =>
    value is String && packagePriceModes.contains(value) ? value : '';

bool _wholeCents(Object? value) => value is int && value >= 0;

/// Each piece's price when one price was typed for the whole package.
///
/// [totalCents] is the price typed (the pickup fee is never part of it), null
/// for none. [ids] are the pieces' ids in the form's order, "" for a new
/// piece. [stored] are the package's pieces as saved, when it is an edit.
///
/// The total is shared equally among the pieces, in order, except when the
/// pieces are exactly the stored ones (same ids, same order, each priced) and
/// the total equals the stored sum: then the stored prices come back
/// untouched, so saving an old item-by-item package without changing
/// anything changes nothing. No usable total: every piece null.
List<int?> packagePiecePrices(
  int? totalCents,
  List<String> ids, [
  List<LinePiece>? stored,
]) {
  if (ids.isEmpty) return const [];
  if (!_wholeCents(totalCents)) return List<int?>.filled(ids.length, null);
  final saved = stored ?? const <LinePiece>[];
  var same = saved.length == ids.length;
  if (same) {
    for (var i = 0; i < saved.length; i++) {
      if (ids[i].isEmpty ||
          saved[i].id != ids[i] ||
          !_wholeCents(saved[i].priceCents)) {
        same = false;
        break;
      }
    }
  }
  if (same &&
      saved.fold<int>(0, (sum, p) => sum + p.priceCents!) == totalCents) {
    return [for (final p in saved) p.priceCents];
  }
  return distributeCents(totalCents, ids.length);
}

/// What the one price field opens on for a saved package: the sum of its
/// pieces' prices, null when no piece has one (a blank field).
int? packagePricePrefill(Iterable<LinePiece> saved) {
  var total = 0;
  var any = false;
  for (final piece in saved) {
    final cents = piece.priceCents;
    if (cents == null) continue;
    any = true;
    total += cents;
  }
  return any ? total : null;
}

/// What the one price field opens on when a customer's request is received:
/// the estimate's total (the pieces' estimates added up, never the pickup
/// fee) when every piece has an estimate, else null.
int? packagePriceFromEstimates(Iterable<int?> estimates) {
  var total = 0;
  var count = 0;
  for (final cents in estimates) {
    if (cents == null) return null;
    total += cents;
    count++;
  }
  return count == 0 ? null : total;
}

/// The one price field as typed.
class PackagePriceReading {
  const PackagePriceReading({this.cents, this.invalid = false});

  /// Whole cents (zero allowed); null while blank or unreadable.
  final int? cents;

  /// Something was typed that is not a price (not money, or below zero).
  final bool invalid;
}

PackagePriceReading readPackagePriceField(String text) {
  final reading = readMoneyInput(text);
  if (reading.isEmpty) return const PackagePriceReading();
  final cents = reading.cents;
  if (cents == null || cents < 0) {
    return const PackagePriceReading(invalid: true);
  }
  return PackagePriceReading(cents: cents);
}

/// The problems with the one price, as the server names them: `piece_price_
/// invalid` for something unreadable or negative; for a customer's package
/// ([requirePrice]) `package_price_required` when it is blank or $0. The
/// business's own stock may leave it blank.
List<String> packagePriceProblems(String text, {required bool requirePrice}) {
  final reading = readPackagePriceField(text);
  if (reading.invalid) return const ['piece_price_invalid'];
  if (requirePrice && (reading.cents ?? 0) <= 0) {
    return const ['package_price_required'];
  }
  return const [];
}

/// The pieces as the form sends them, each with its share of the one price
/// ([packagePiecePrices]). [drafts] are the pieces in the form's order (an
/// `id` each, "" for a new one); [stored] the saved line's pieces when
/// editing. A price that cannot be read stays "unreadable" on every piece,
/// so it is refused and never guessed.
List<Map<String, Object?>> packagePieceDrafts(
  List<Map<String, Object?>> drafts, {
  required String priceText,
  List<LinePiece>? stored,
}) {
  final reading = readPackagePriceField(priceText);
  final ids = [for (final d in drafts) (d['id'] ?? '').toString()];
  final prices = reading.invalid
      ? List<Object?>.filled(drafts.length, 'unreadable')
      : packagePiecePrices(reading.cents, ids, stored);
  return [
    for (var i = 0; i < drafts.length; i++)
      {...drafts[i], 'priceCents': prices[i]},
  ];
}

/// The package total: the one price plus the pickup fee. Null while no price
/// is typed (a fee alone is not a price) or when it all comes to nothing.
int? packageTotalCents(String priceText, [int pickupFeeCents = 0]) {
  final cents = readPackagePriceField(priceText).cents;
  if (cents == null) return null;
  final total = cents + pickupFeeCents;
  return total > 0 ? total : null;
}

/// How the pieces' count compares with what was saved, for the note under
/// the price: [added] more or [removed] fewer; both 0 when equal or new.
({int added, int removed}) packagePieceCountChange(int saved, int now) {
  if (saved <= 0) return (added: 0, removed: 0);
  return (
    added: now > saved ? now - saved : 0,
    removed: now < saved ? saved - now : 0,
  );
}

/// The counter's "From the price list" (docs/SHIPPING_SIMPLE_HOME.md P): a
/// piece's description and price filled from the business's own price list.
///
/// Pure. It is a calculator over `pricePiece` and nothing else - the same
/// function the customer's estimate and the server run - so the counter and
/// the customer can never disagree on the arithmetic. Nothing here is
/// stored: the fill only types into the piece's fields, which staff can still
/// edit.
library;

import 'package_price_list.dart';

/// One thing the list prices, for the picker.
class PriceFillChoice {
  const PriceFillChoice.item({
    required this.id,
    required this.label,
    required this.priceCents,
    this.includedLb = 0,
  }) : byWeight = false;

  const PriceFillChoice.weight({
    required this.id,
    required this.label,
    required this.priceCents,
  }) : byWeight = true,
       includedLb = 0;

  /// An item's id, or a category's id for a by-weight kind.
  final String id;

  /// The item's name, or the category's name in the staff's language.
  final String label;

  /// An item's fixed price, or a by-weight kind's rate per unit.
  final int priceCents;

  /// A by-weight kind: asks the weight, price = rate x weight.
  final bool byWeight;

  /// An item whose price covers only this much weight each (the list's
  /// unit); 0 = any weight.
  final num includedLb;
}

/// Whether a route has anything to fill from: an item, or a rate.
bool priceFillAvailable(Map<String, dynamic>? route) =>
    route != null &&
    (priceFillItems(route).isNotEmpty ||
        priceFillWeightKinds(route, 'en').isNotEmpty);

List<Map<String, dynamic>> _rows(Object? value) => [
  if (value is Iterable)
    for (final row in value)
      if (row is Map) {for (final e in row.entries) e.key.toString(): e.value},
];

/// The route's items, by name.
List<PriceFillChoice> priceFillItems(Map<String, dynamic>? route) {
  final out = [
    for (final row in _rows(route?['items']))
      if ((row['id'] ?? '').toString().isNotEmpty &&
          (row['label'] ?? '').toString().trim().isNotEmpty &&
          row['priceCents'] is num &&
          (row['priceCents'] as num) > 0)
        PriceFillChoice.item(
          id: row['id'].toString(),
          label: row['label'].toString().trim(),
          priceCents: (row['priceCents'] as num).toInt(),
          includedLb: row['includedLb'] is num ? row['includedLb'] as num : 0,
        ),
  ];
  out.sort((a, b) => foldAccents(a.label).compareTo(foldAccents(b.label)));
  return out;
}

/// The categories the route prices by weight, in the shared order, named in
/// [languageCode].
List<PriceFillChoice> priceFillWeightKinds(
  Map<String, dynamic>? route,
  String languageCode,
) {
  final rates = route?['perLbCents'];
  if (rates is! Map) return const [];
  return [
    for (final category in priceCategories)
      if (rates[category.id] is num && (rates[category.id] as num) > 0)
        PriceFillChoice.weight(
          id: category.id,
          label: category.label(languageCode),
          priceCents: (rates[category.id] as num).toInt(),
        ),
  ];
}

/// What picking a thing fills in.
class PriceFill {
  const PriceFill({
    required this.description,
    required this.priceCents,
    this.weight,
    this.unit = 'lb',
  });

  /// "2 × Phone" / "General goods · 10 kg": the piece's description, when it
  /// has none typed.
  final String description;
  final int priceCents;

  /// The weight typed for a by-weight kind, in [unit] (the list's); null for
  /// an item.
  final double? weight;
  final String unit;
}

/// The outcome of a fill: [fill] when it priced, else [error], a refusal code
/// of the price list (`quantity_invalid`, `weight_invalid`,
/// `weight_kg_invalid`, `item_unknown`, ...) or `no_price` when the list has
/// no rate for it.
typedef PriceFillResult = ({PriceFill? fill, String error});

/// An item [quantity] times: price = unit price x quantity through
/// `pricePiece`.
PriceFillResult fillFromItem(
  Map<String, dynamic>? route,
  String itemId, {
  int quantity = 1,
  String? lang,
}) {
  final priced = pricePiece(route, {
    'priceItemId': itemId,
    'quantity': quantity,
  }, lang: lang);
  if (priced.error.isNotEmpty) return (fill: null, error: priced.error);
  final cents = priced.estimateCents;
  if (priced.price == null || cents == null) {
    return (fill: null, error: 'item_unknown');
  }
  return (
    fill: PriceFill(
      description: priced.description,
      priceCents: cents,
      unit: unitOf(route),
    ),
    error: '',
  );
}

/// A by-weight kind weighed [weight] in the list's unit: price = rate x
/// weight through `pricePiece` (the weight is rounded to a tenth there).
PriceFillResult fillFromWeight(
  Map<String, dynamic>? route,
  String categoryId,
  Object? weight, {
  String? lang,
}) {
  final unit = unitOf(route);
  // Nothing typed yet is a weight to ask for, not a piece to quote.
  if (weight == null || weight.toString().trim().isEmpty) {
    return (
      fill: null,
      error: unit == 'kg' ? 'weight_kg_invalid' : 'weight_invalid',
    );
  }
  final priced = pricePiece(route, {
    'categoryId': categoryId,
    'weightLb': weight,
    'weightUnit': unit,
  }, lang: lang);
  if (priced.error.isNotEmpty) return (fill: null, error: priced.error);
  final cents = priced.estimateCents;
  final weighed = priced.price?['weightLb'];
  if (cents == null || weighed is! num) {
    return (fill: null, error: 'no_price');
  }
  return (
    fill: PriceFill(
      description: priced.description,
      priceCents: cents,
      weight: weighed.toDouble(),
      unit: unit,
    ),
    error: '',
  );
}

/// The package weight a set of by-weight fills adds up to, to a tenth: what
/// an air package's empty weight field is filled with. Null when none.
double? sumFilledWeights(Iterable<double?> weights) {
  var sum = 0.0;
  var any = false;
  for (final w in weights) {
    if (w == null || !(w > 0)) continue;
    sum += w;
    any = true;
  }
  return any ? (sum * 10).round() / 10 : null;
}

/// What a business carries, and what it charges for each of those things.
///
/// Mirror of `my_flutter_app/functions/freight_payback.js` (the authority)
/// and `admin_web/src/lib/freight-payback.ts`. All three clients must price
/// the same item identically; the server re-prices everything anyway, so a
/// drifted mirror shows a wrong number only until the callable answers.
///
/// Nothing here says what a missing parcel is worth. A business either makes
/// good on one or it does not - the single flag in `services/freight_coverage
/// .dart` - and a figure per item invited exactly the haggling the design
/// exists to remove.
library;

class FreightPaybackLookup {
  const FreightPaybackLookup({
    required this.listed,
    this.source,
    this.label = '',
  });

  /// Whether this business lists the item at all. A routing answer, not a
  /// promise: a row it has is a row a customer can pick, and anything else
  /// becomes a price request.
  final bool listed;

  /// 'item' for an exact row, 'other' for the category catch-all.
  final String? source;
  final String label;
}

/// Whether this business lists the item: exact row first, then the category's
/// catch-all. Unlisted is a routing answer - it sends the booking to the
/// quote-request path instead of instant booking.
FreightPaybackLookup freightPaybackFor({
  required Map<String, dynamic>? table,
  required String categoryId,
  String itemId = '',
}) {
  final entry = table?[categoryId.trim()];
  if (entry is! Map) {
    return const FreightPaybackLookup(listed: false);
  }
  final wanted = itemId.trim();
  final items = entry['items'];
  if (wanted.isNotEmpty && items is List) {
    for (final raw in items) {
      if (raw is Map && raw['id'] == wanted) {
        return FreightPaybackLookup(
          listed: true,
          source: 'item',
          label: (raw['label'] ?? '') as String,
        );
      }
    }
  }
  // The category's catch-all covers anything else in it, when the business
  // has priced one.
  final otherMode = entry['otherPricingMode'];
  if (otherMode != null && '$otherMode'.isNotEmpty) {
    return const FreightPaybackLookup(listed: true, source: 'other');
  }
  return const FreightPaybackLookup(listed: false);
}

/// How one item is charged for: a set price, or the scale.
///
/// Mirror of `freightItemPricing` in the functions authority. [mode] is
/// `'flat'` or `'per_kg'`; [source] is `'item'` for the exact row, `'other'`
/// for the category catch-all, and null when nothing in the table spoke.
class FreightItemPricing {
  const FreightItemPricing({
    required this.priced,
    required this.mode,
    required this.flatPrice,
    required this.includedKg,
    required this.weightFactor,
    required this.needsWeightAtBooking,
    required this.weighsAtDropOff,
    this.source,
  });

  /// Whether this business has put a number on this item at all. False sends
  /// the customer to a price request: a price nobody set is not a price to
  /// show, and every other field here is meaningless while this is false.
  final bool priced;

  /// `'flat'`, `'per_kg'`, or null when nothing priced it.
  final String? mode;

  /// What the business charges for this item, whole. Zero when priced by
  /// weight.
  final double flatPrice;

  /// How much weight the set price already covers. Zero means it covers the
  /// parcel however heavy it is.
  final double includedKg;

  /// One for a by-weight item, so the destination's per-kg rate is what the
  /// customer pays. Zero when set-priced or unpriced.
  final double weightFactor;

  /// Whether the customer must say what the parcel weighs to be quoted.
  final bool needsWeightAtBooking;

  /// Whether the business puts it on the scale at the counter.
  final bool weighsAtDropOff;

  final String? source;

  bool get isFlat => mode == 'flat';
}

/// Nothing to charge from, so nothing to show.
const _unpriced = FreightItemPricing(
  priced: false,
  mode: null,
  flatPrice: 0,
  includedKg: 0,
  weightFactor: 0,
  needsWeightAtBooking: false,
  weighsAtDropOff: false,
);

/// Reads a stored number the way the server's `Number(x) || fallback` does:
/// anything unreadable falls back rather than throwing, because one bad value
/// in a business's table must not stop a customer being quoted.
double _numberOr(Object? value, double fallback) {
  final parsed = value is num
      ? value.toDouble()
      : double.tryParse('${value ?? ''}');
  return parsed != null && parsed.isFinite ? parsed : fallback;
}

/// How to charge for one item: a set price, or by weight.
///
/// Resolves in the same order the listing does - the exact row, then the
/// category catch-all - so the price and the cover answer always come from
/// the same place. Anything the business has not put a number on comes back
/// unpriced, and the customer asks it for a price instead of being shown one
/// the platform invented.
FreightItemPricing freightItemPricing({
  required Map<String, dynamic>? table,
  required String categoryId,
  String itemId = '',
}) {
  final entry = table?[categoryId.trim()];
  if (entry is! Map) return _unpriced;

  final wanted = itemId.trim();
  Map? row;
  final items = entry['items'];
  if (wanted.isNotEmpty && items is List) {
    for (final raw in items) {
      if (raw is Map && raw['id'] == wanted) {
        row = raw;
        break;
      }
    }
  }

  FreightItemPricing read(
    String source,
    Object? mode,
    Object? flat,
    Object? included,
  ) {
    if (mode == 'flat') {
      final includedKg = _numberOr(included, 0);
      return FreightItemPricing(
        priced: true,
        mode: 'flat',
        flatPrice: _numberOr(flat, 0),
        includedKg: includedKg,
        weightFactor: 0,
        // The customer is never asked to guess the weight of a known object.
        // They pick "iPhone 16", see the price, and that is the transaction.
        needsWeightAtBooking: false,
        // The business still puts it on the scale when the price covers only
        // so much: a phone in a carton packed out with shoes is not the
        // parcel that was priced. No allowance means nothing is weighed.
        weighsAtDropOff: includedKg > 0,
        source: source,
      );
    }
    // By weight is this business's own per-kg rate for the route, plain. A
    // unitless factor was a number the business had to reason about instead
    // of a price it could state.
    return FreightItemPricing(
      priced: true,
      mode: 'per_kg',
      flatPrice: 0,
      includedKg: 0,
      weightFactor: 1,
      needsWeightAtBooking: true,
      weighsAtDropOff: true,
      source: source,
    );
  }

  if (row != null) {
    // A listed row that names no pricing has never been quoted by this
    // business. It goes to a price request rather than inheriting a number
    // from its category or from the catch-all.
    final rowMode = row['pricingMode'];
    return rowMode != null && '$rowMode'.isNotEmpty
        ? read('item', rowMode, row['flatPrice'], row['includedKg'])
        : _unpriced;
  }
  final otherMode = entry['otherPricingMode'];
  if (otherMode != null && '$otherMode'.isNotEmpty) {
    return read(
      'other',
      otherMode,
      entry['otherFlatPrice'],
      entry['otherIncludedKg'],
    );
  }
  return _unpriced;
}

/// The funnel's synthetic id for "something not on anyone's list".
const otherItemId = '__other';

Map<String, dynamic>? _providerTable(Map<String, dynamic>? table) {
  if (table == null || table.isEmpty) return null;
  return table;
}

class FreightItemChoice {
  const FreightItemChoice({required this.id, required this.label});

  final String id;
  final String label;
}

/// The item choices for a category, across every provider serving the
/// route. Mirror of `freightItemChoicesFor` in the web lib and the
/// functions authority - the funnel asks WHAT before WHO on every client.
///
/// Every row any provider lists is offered, priced or not, and the catch-all
/// closes the list: an item nobody has quoted is a question the customer can
/// still ask, so no answer here is a dead end.
List<FreightItemChoice> freightItemChoicesFor(
  List<Map<String, dynamic>?> tables,
  String categoryId,
) {
  final seen = <String, String>{};
  for (final raw in tables) {
    final table = _providerTable(raw);
    if (table == null) continue;
    final entry = table[categoryId.trim()];
    if (entry is! Map) continue;
    final items = entry['items'];
    if (items is List) {
      for (final row in items) {
        if (row is! Map) continue;
        final id = (row['id'] ?? '').toString().trim();
        final label = (row['label'] ?? '').toString().trim();
        if (id.isNotEmpty && label.isNotEmpty && !seen.containsKey(id)) {
          seen[id] = label;
        }
      }
    }
  }
  return [
    ...(seen.entries
        .map((e) => FreightItemChoice(id: e.key, label: e.value))
        .toList()
      ..sort((a, b) => a.label.compareTo(b.label))),
    const FreightItemChoice(id: otherItemId, label: 'Something else'),
  ];
}

/// Whether one provider can be booked for this item on the spot - the same
/// resolution the server prices and covers with, so a business only reaches
/// the booking form when its own table answers both questions.
bool providerQualifiesForItem(
  Map<String, dynamic>? table,
  String categoryId,
  String itemId,
) {
  final resolved = _providerTable(table);
  if (resolved == null) return false;
  final wanted = itemId == otherItemId ? '' : itemId;
  return freightItemPricing(
        table: resolved,
        categoryId: categoryId,
        itemId: wanted,
      ).priced &&
      freightPaybackFor(
        table: resolved,
        categoryId: categoryId,
        itemId: wanted,
      ).listed;
}

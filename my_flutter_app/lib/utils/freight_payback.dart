/// What a lost parcel pays back - the business's table, not the sender's
/// claim.
///
/// Mirror of `my_flutter_app/functions/freight_payback.js` (the authority)
/// and `admin_web/src/lib/freight-payback.ts`. All three clients must price
/// the same item identically; the server re-prices everything anyway, so a
/// drifted mirror shows a wrong number only until the callable answers.
library;

class FreightPaybackLookup {
  const FreightPaybackLookup({
    required this.listed,
    required this.paybackAmount,
    this.source,
    this.label = '',
  });

  final bool listed;
  final double paybackAmount;

  /// 'item' for an exact row, 'other' for the category catch-all.
  final String? source;
  final String label;
}

/// The payback row for an item: exact row first, then the category's
/// catch-all. Unlisted is a routing answer - it sends the booking to the
/// quote-request path instead of instant booking.
FreightPaybackLookup freightPaybackFor({
  required Map<String, dynamic>? table,
  required String categoryId,
  String itemId = '',
}) {
  final entry = table?[categoryId.trim()];
  if (entry is! Map) {
    return const FreightPaybackLookup(listed: false, paybackAmount: 0);
  }
  final wanted = itemId.trim();
  final items = entry['items'];
  if (wanted.isNotEmpty && items is List) {
    for (final raw in items) {
      if (raw is Map && raw['id'] == wanted) {
        return FreightPaybackLookup(
          listed: true,
          paybackAmount: (raw['paybackAmount'] as num?)?.toDouble() ?? 0,
          source: 'item',
          label: (raw['label'] ?? '') as String,
        );
      }
    }
  }
  final other = (entry['otherPaybackAmount'] as num?)?.toDouble() ?? 0;
  if (other > 0) {
    return FreightPaybackLookup(
      listed: true,
      paybackAmount: other,
      source: 'other',
    );
  }
  return const FreightPaybackLookup(listed: false, paybackAmount: 0);
}

/// How one item is charged for: a set price, or the scale.
///
/// Mirror of `freightItemPricing` in the functions authority. [mode] is
/// `'flat'` or `'per_kg'`; [source] is `'item'` for the exact row, `'other'`
/// for the category catch-all, and null when nothing in the table spoke.
class FreightItemPricing {
  const FreightItemPricing({
    required this.mode,
    required this.flatPrice,
    required this.includedKg,
    required this.weightFactor,
    required this.needsWeightAtBooking,
    required this.weighsAtDropOff,
    this.source,
  });

  final String mode;

  /// What the business charges for this item, whole. Zero when priced by
  /// weight.
  final double flatPrice;

  /// How much weight the set price already covers. Zero means it covers the
  /// parcel however heavy it is.
  final double includedKg;

  /// Applied on top of the destination's per-kg rate. Zero when set-priced.
  final double weightFactor;

  /// Whether the customer must say what the parcel weighs to be quoted.
  final bool needsWeightAtBooking;

  /// Whether the business puts it on the scale at the counter.
  final bool weighsAtDropOff;

  final String? source;

  bool get isFlat => mode == 'flat';
}

/// Reads a stored number the way the server's `Number(x) || fallback` does:
/// anything unreadable falls back rather than throwing, because one bad value
/// in a business's table must not stop a customer being quoted.
double _numberOr(Object? value, double fallback) {
  final parsed = value is num
      ? value.toDouble()
      : double.tryParse('${value ?? ''}');
  return parsed != null && parsed.isFinite ? parsed : fallback;
}

FreightItemPricing _byWeight(double weightFactor, String? source) =>
    FreightItemPricing(
      mode: 'per_kg',
      flatPrice: 0,
      includedKg: 0,
      weightFactor: weightFactor,
      needsWeightAtBooking: true,
      weighsAtDropOff: true,
      source: source,
    );

/// How to charge for one item: a set price, or by weight.
///
/// Resolves in the same order the payback does - the exact row, then the
/// category catch-all - so the price and the promise always come from the
/// same place. A row that names no pricing falls through to the category
/// multiplier, which is how every booking was priced before rows could carry
/// a price of their own.
FreightItemPricing freightItemPricing({
  required Map<String, dynamic>? table,
  required String categoryId,
  String itemId = '',
  double categoryMultiplier = 1,
}) {
  final entry = table?[categoryId.trim()];
  if (entry is! Map) return _byWeight(categoryMultiplier, null);

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
    Object? factor,
  ) {
    if (mode == 'flat') {
      final includedKg = _numberOr(included, 0);
      return FreightItemPricing(
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
    final resolved = _numberOr(factor, 0);
    return _byWeight(resolved > 0 ? resolved : categoryMultiplier, source);
  }

  if (row != null) {
    // A listed row that states no pricing is one saved before pricing
    // existed. It keeps the category multiplier it has always been charged
    // at - NOT the catch-all's price, which is for things nobody listed and
    // would silently reprice every legacy row the day this ships.
    final rowMode = row['pricingMode'];
    return rowMode != null && '$rowMode'.isNotEmpty
        ? read(
            'item',
            rowMode,
            row['flatPrice'],
            row['includedKg'],
            row['weightFactor'],
          )
        : _byWeight(categoryMultiplier, 'item');
  }
  final otherMode = entry['otherPricingMode'];
  if (otherMode != null && '$otherMode'.isNotEmpty) {
    return read(
      'other',
      otherMode,
      entry['otherFlatPrice'],
      entry['otherIncludedKg'],
      entry['otherWeightFactor'],
    );
  }
  return _byWeight(categoryMultiplier, null);
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
List<FreightItemChoice> freightItemChoicesFor(
  List<Map<String, dynamic>?> tables,
  String categoryId,
) {
  final seen = <String, String>{};
  var anyCatchAll = false;
  for (final raw in tables) {
    final table = _providerTable(raw);
    if (table == null) {
      anyCatchAll = true;
      continue;
    }
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
    if (((entry['otherPaybackAmount'] as num?)?.toDouble() ?? 0) > 0) {
      anyCatchAll = true;
    }
  }
  final choices = seen.entries
      .map((e) => FreightItemChoice(id: e.key, label: e.value))
      .toList()
    ..sort((a, b) => a.label.compareTo(b.label));
  if (anyCatchAll) {
    choices.add(
      const FreightItemChoice(id: otherItemId, label: 'Something else'),
    );
  }
  return choices;
}

/// Whether one provider can instant-book this item - the same resolution
/// the server prices with.
bool providerQualifiesForItem(
  Map<String, dynamic>? table,
  String categoryId,
  String itemId,
) {
  final resolved = _providerTable(table);
  if (resolved == null) return true;
  return freightPaybackFor(
    table: resolved,
    categoryId: categoryId,
    itemId: itemId == otherItemId ? '' : itemId,
  ).listed;
}

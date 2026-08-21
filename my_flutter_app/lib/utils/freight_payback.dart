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

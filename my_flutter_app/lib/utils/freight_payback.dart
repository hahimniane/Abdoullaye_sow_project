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

/// The coverage fee in cents for a payback amount under the business's
/// rate - the only arithmetic a client is trusted to preview.
int coverageFeeCentsFor(double paybackAmount, double ratePct) {
  final paybackCents = (paybackAmount * 100).round();
  if (paybackCents <= 0 || ratePct <= 0) return 0;
  return (paybackCents * (ratePct / 100)).round();
}

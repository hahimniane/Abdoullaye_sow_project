/// The app's view of the box sizes (docs/PACKAGE_BOX_SIZES_PAY_NOW.md §1-§2):
/// which size some inches make, what a size is called and shown as, and a
/// business's prices for them.
///
/// The rules themselves - the four sizes, the 1-inch slack, which size a box
/// fits - live once in `package_price_list.dart`, the mirror of the server's
/// (`BOX_SIZES`, `boxSizeFor`); this file only reads them for the screens,
/// so no screen carries its own copy.
library;

import '../widgets/box_designer/box_geometry.dart' show BoxDims;
import 'package_price_list.dart';

/// The size that is always quoted, never priced.
const boxSizeXl = 'xl';

/// The size [dims] make, or null when they are not 1 to 120 inches.
String? boxSizeIdOf(BoxDims dims) => boxSizeFor(dims.toMap());

BoxSize? _sizeOf(String id) {
  for (final s in boxSizes) {
    if (s.id == id) return s;
  }
  return null;
}

/// "Medium" / "Moyenne" (the id itself for a size nobody knows).
String boxSizeName(String id, String language) {
  final size = _sizeOf(id);
  if (size == null) return id;
  return size.label(language);
}

/// "About a microwave box" / "Environ un carton de micro-ondes".
String boxSizeExample(String id, String language) {
  final size = _sizeOf(id);
  if (size == null) return '';
  return size.example(language);
}

/// The picture of a size (drawn in one style, with a sneaker for scale).
String boxSizeAsset(String id) => 'assets/box_sizes/$id.png';

/// A business's price for a size, in cents, from its Sea [route] (the
/// public route `boxPricesCents`); null when it did not price that size
/// (the business quotes it). Extra large is never priced.
int? boxPriceCents(Map<String, dynamic>? route, String sizeId) {
  if (sizeId == boxSizeXl) return null;
  final prices = route?['boxPricesCents'];
  if (prices is! Map) return null;
  final value = prices[sizeId];
  return value is num && value.isFinite && value > 0 ? value.toInt() : null;
}

/// The lowest price any of the [routes] asks for a size ("from $35"), or
/// null when none priced it.
int? cheapestBoxPriceCents(
  Iterable<Map<String, dynamic>?> routes,
  String sizeId,
) {
  int? best;
  for (final route in routes) {
    final cents = boxPriceCents(route, sizeId);
    if (cents != null && (best == null || cents < best)) best = cents;
  }
  return best;
}

/// What is in the parcel. App side.
///
/// A deliberate mirror of the server's pure module,
/// `functions/freight_categories.js`.
///
/// The server's split is kept here on purpose: the **platform owns the list**,
/// so a customer holding a phone finds "Electronics" at every business and can
/// compare two quotes; the **business owns the price**. The category sorts the
/// parcel and names the payback row to look in; what the parcel costs comes
/// from the item row the business priced (`utils/freight_payback.dart`), so
/// every default here is 1 and no category moves a price on its own.
///
/// Everything in this file is pure: no Firebase, no widgets, so
/// `test/freight_category_test.dart` drives it directly. The words a customer
/// reads for the standard rows live in `utils/freight_category_localization.dart`
/// - the labels below are the server's English and only surface for a row this
/// app does not know about.
library;

/// Nothing outside this band. A typo in a business's settings should not make
/// a parcel free or absurd. `MIN_MULTIPLIER`/`MAX_MULTIPLIER` on the server.
const double minFreightCategoryMultiplier = 0.5;
const double maxFreightCategoryMultiplier = 10;

/// A business may not drown the customer in choices.
/// `MAX_CUSTOM_CATEGORIES` on the server.
const int maxCustomFreightCategories = 6;

/// One row of the platform's list, with the price the platform starts it at.
class StandardFreightCategory {
  const StandardFreightCategory({
    required this.id,
    required this.englishLabel,
    required this.englishHint,
    required this.defaultMultiplier,
  });

  final String id;

  /// The server's own wording. The screens show the localized label instead;
  /// this is the floor for anything that reaches the UI without one.
  final String englishLabel;
  final String englishHint;

  /// A starting point, not policy: a business overrides what it disagrees with.
  final double defaultMultiplier;
}

/// The rows every business has, in the order a customer sees them.
/// `STANDARD_FREIGHT_CATEGORIES` on the server; keep the two in sync.
///
/// "general" is first because it is the honest answer for most parcels and
/// nobody should have to hunt for it.
const List<StandardFreightCategory> standardFreightCategories =
    <StandardFreightCategory>[
      StandardFreightCategory(
        id: 'general',
        englishLabel: 'General goods',
        englishHint: 'Household items, gifts, anything not listed below',
        defaultMultiplier: 1,
      ),
      StandardFreightCategory(
        id: 'clothing',
        englishLabel: 'Clothes and fabric',
        englishHint: 'Clothing, shoes, cloth, bedding',
        defaultMultiplier: 1,
      ),
      StandardFreightCategory(
        id: 'food',
        englishLabel: 'Food',
        englishHint: 'Dry and packaged food only',
        defaultMultiplier: 1,
      ),
      StandardFreightCategory(
        id: 'documents',
        englishLabel: 'Documents',
        englishHint: 'Papers, certificates, printed matter',
        defaultMultiplier: 1,
      ),
      StandardFreightCategory(
        id: 'cosmetics',
        englishLabel: 'Cosmetics and liquids',
        englishHint: 'Creams, perfumes, hair products',
        defaultMultiplier: 1,
      ),
      StandardFreightCategory(
        id: 'electronics',
        englishLabel: 'Electronics',
        englishHint: 'Phones, laptops, tablets, chargers',
        defaultMultiplier: 1,
      ),
      StandardFreightCategory(
        id: 'fragile',
        englishLabel: 'Fragile items',
        englishHint: 'Glass, ceramics, anything breakable',
        defaultMultiplier: 1,
      ),
    ];

/// The ids of [standardFreightCategories], in platform order.
const List<String> standardFreightCategoryIds = <String>[
  'general',
  'clothing',
  'food',
  'documents',
  'cosmetics',
  'electronics',
  'fragile',
];

/// The row a customer picks, priced for one business.
class FreightCategory {
  const FreightCategory({
    required this.id,
    required this.label,
    this.hint = '',
    this.multiplier = 1,
    this.custom = false,
  });

  final String id;

  /// The server's wording. Localized by id for standard rows; a business's own
  /// category has only this, because the business wrote it.
  final String label;
  final String hint;

  /// Applied on top of the destination's per-kg rate. Never the rate itself.
  final double multiplier;

  /// True when the business invented this row rather than the platform.
  final bool custom;

  /// Whether choosing this changes what the parcel costs. A row at 1 is worth
  /// saying so about: "standard rate" is reassuring, a silent "1.0x" is not.
  bool get changesPrice => multiplier != 1;

  /// Reads one row as the callable returns it. Null when there is no usable id
  /// or label - a nameless choice is not a choice.
  static FreightCategory? fromWire(Object? value) {
    if (value is! Map) return null;
    final id = (value['id'] ?? '').toString().trim().toLowerCase();
    final label = (value['label'] ?? '').toString().trim();
    if (id.isEmpty || label.isEmpty) return null;
    return FreightCategory(
      id: id,
      label: label,
      hint: (value['hint'] ?? '').toString().trim(),
      multiplier: normalizeFreightMultiplier(value['multiplier']),
      custom: value['custom'] == true,
    );
  }

  /// Reads the `freightCategories` list off one destination option. Duplicate
  /// ids are dropped: the customer would have no way to tell two identical
  /// rows apart, and the server prices whichever one it finds first.
  static List<FreightCategory> listFromWire(Object? value) {
    if (value is! List) return const <FreightCategory>[];
    final seen = <String>{};
    final categories = <FreightCategory>[];
    for (final raw in value) {
      final category = fromWire(raw);
      if (category == null || !seen.add(category.id)) continue;
      categories.add(category);
    }
    return List<FreightCategory>.unmodifiable(categories);
  }

  @override
  String toString() => 'FreightCategory($id, x$multiplier)';
}

/// Coerces a stored multiplier into something usable.
///
/// Anything unreadable falls back rather than throwing: a bad value in one
/// business's settings must not stop a customer getting a quote, and the
/// fallback is exactly what the price was before categories existed.
double normalizeFreightMultiplier(Object? value, {double fallback = 1}) {
  final parsed = value is num ? value.toDouble() : double.tryParse('${value ?? ''}');
  if (parsed == null || !parsed.isFinite || parsed <= 0) return fallback;
  return parsed.clamp(minFreightCategoryMultiplier, maxFreightCategoryMultiplier)
      .toDouble();
}

/// Builds the list for a business straight from its document.
///
/// Only the Firestore fallback path needs this - the callable already sends
/// `freightCategories` - but a customer on a project where the callable is not
/// deployed must still see the same rows at the same prices.
/// `freightCategoriesForBusiness` on the server.
List<FreightCategory> freightCategoriesFromBusinessData(
  Map<String, dynamic>? business,
) {
  final rawOverrides = business?['freightCategoryRates'];
  final overrides = rawOverrides is Map ? rawOverrides : const {};
  final categories = <FreightCategory>[
    for (final standard in standardFreightCategories)
      FreightCategory(
        id: standard.id,
        label: standard.englishLabel,
        hint: standard.englishHint,
        multiplier: normalizeFreightMultiplier(
          overrides[standard.id],
          fallback: standard.defaultMultiplier,
        ),
      ),
  ];
  final rawExtras = business?['freightCustomCategories'];
  if (rawExtras is List) {
    final seen = <String>{...standardFreightCategoryIds};
    var added = 0;
    for (final raw in rawExtras) {
      final category = normalizeCustomFreightCategory(raw);
      if (category == null || !seen.add(category.id)) continue;
      categories.add(category);
      if (++added >= maxCustomFreightCategories) break;
    }
  }
  return List<FreightCategory>.unmodifiable(categories);
}

/// Trims and bounds a business's own category, or rejects it.
/// `normalizeCustomCategory` on the server, including the rule that a business
/// may not shadow a standard row - that list is the shared vocabulary the
/// customer compares businesses with.
FreightCategory? normalizeCustomFreightCategory(Object? value) {
  if (value is! Map) return null;
  final id = (value['id'] ?? '')
      .toString()
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9_-]'), '');
  var label = (value['label'] ?? '').toString().trim();
  if (id.isEmpty || label.isEmpty) return null;
  if (standardFreightCategoryIds.contains(id)) return null;
  if (label.length > 60) label = label.substring(0, 60);
  var hint = (value['hint'] ?? '').toString().trim();
  if (hint.length > 120) hint = hint.substring(0, 120);
  return FreightCategory(
    id: id,
    label: label,
    hint: hint,
    multiplier: normalizeFreightMultiplier(value['multiplier']),
    custom: true,
  );
}

/// The row with this id, or null when the business does not offer it. A
/// business can retire a category while a customer has the screen open, and a
/// quote for a row that no longer exists is a quote the server will not honour.
FreightCategory? freightCategoryLookup(
  List<FreightCategory> categories,
  String? categoryId,
) {
  final id = (categoryId ?? '').trim().toLowerCase();
  if (id.isEmpty) return null;
  for (final category in categories) {
    if (category.id == id) return category;
  }
  return null;
}

/// The multiplier to charge for a chosen category.
///
/// An unknown or missing category resolves to 1 - the price freight had before
/// this existed - so a screen that has not loaded a list yet quotes the old
/// price rather than a wrong one. `freightCategoryMultiplier` on the server.
double freightCategoryMultiplier(
  List<FreightCategory> categories,
  String? categoryId,
) {
  final id = (categoryId ?? '').trim().toLowerCase();
  if (id.isEmpty) return 1;
  for (final category in categories) {
    if (category.id == id) return category.multiplier;
  }
  return 1;
}

/// Which row to start on. "general" is the honest answer for most parcels; if
/// a business somehow has no standard rows, the first one it does have.
/// Empty when the business offers no freight categories at all.
String defaultFreightCategoryId(List<FreightCategory> categories) {
  if (categories.isEmpty) return '';
  for (final category in categories) {
    if (category.id == 'general') return category.id;
  }
  return categories.first.id;
}

/// What the shipping half of the parcel costs, to the cent.
///
/// Mirrors the server's rounding (`Math.round(kg * rate * multiplier * 100)`)
/// so the figure on the button is the figure on the card statement.
double freightShippingFee({
  required double weightKg,
  required double ratePerKg,
  double multiplier = 1,
}) {
  final raw = weightKg * ratePerKg * multiplier;
  if (!raw.isFinite || raw <= 0) return 0;
  return (raw * 100).round() / 100;
}

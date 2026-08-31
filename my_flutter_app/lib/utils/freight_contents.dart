/// What is inside one box, as a list instead of a single pick.
///
/// Mirror of `functions/freight_contents.js` and the web's
/// `lib/freight-contents.ts` - the server is the authority on validation
/// and price; this exists so the form refuses junk before a round trip and
/// shows the same estimate the server will charge. The declaration stores
/// FACTS and never a price.
library;

import 'freight_payback.dart';

const int maxContentItems = 10;
const int maxItemQuantity = 99;
const int maxContentLabelLength = 60;

/// The platform's category vocabulary, mirrored from
/// `functions/freight_categories.js` - the platform owns the list so a
/// request means the same thing to every business asked.
class FreightContentsCategory {
  const FreightContentsCategory({required this.id, required this.label});

  final String id;
  final String label;
}

const List<FreightContentsCategory> standardFreightCategories = [
  FreightContentsCategory(id: 'general', label: 'General goods'),
  FreightContentsCategory(id: 'clothing', label: 'Clothes and fabric'),
  FreightContentsCategory(id: 'food', label: 'Food'),
  FreightContentsCategory(id: 'documents', label: 'Documents'),
  FreightContentsCategory(id: 'cosmetics', label: 'Cosmetics and liquids'),
  FreightContentsCategory(id: 'electronics', label: 'Electronics'),
  FreightContentsCategory(id: 'fragile', label: 'Fragile items'),
];

/// Platform-standard item rows per category, mirrored from
/// `functions/freight_payback.js` STANDARD_FREIGHT_ITEMS.
const Map<String, List<FreightItemChoice>> standardFreightItems = {
  'electronics': [
    FreightItemChoice(id: 'iphone', label: 'iPhone'),
    FreightItemChoice(id: 'samsung-phone', label: 'Samsung phone'),
    FreightItemChoice(id: 'other-phone', label: 'Other phone'),
    FreightItemChoice(id: 'laptop', label: 'Laptop'),
    FreightItemChoice(id: 'tablet', label: 'Tablet'),
    FreightItemChoice(id: 'tv', label: 'Television'),
    FreightItemChoice(id: 'game-console', label: 'Game console'),
  ],
  'cosmetics': [
    FreightItemChoice(id: 'perfume', label: 'Perfume'),
    FreightItemChoice(id: 'hair-products', label: 'Hair products'),
  ],
  'fragile': [
    FreightItemChoice(id: 'dishes', label: 'Dishes and glassware'),
  ],
};

class ContentsItem {
  const ContentsItem({
    required this.categoryId,
    this.itemId = '',
    required this.label,
    this.quantity = 1,
  });

  final String categoryId;
  final String itemId;
  final String label;
  final int quantity;

  ContentsItem copyWith({
    String? categoryId,
    String? itemId,
    String? label,
    int? quantity,
  }) {
    return ContentsItem(
      categoryId: categoryId ?? this.categoryId,
      itemId: itemId ?? this.itemId,
      label: label ?? this.label,
      quantity: quantity ?? this.quantity,
    );
  }

  Map<String, dynamic> toJson() => {
    'categoryId': categoryId,
    'itemId': itemId,
    'label': label,
    'quantity': quantity,
  };
}

class FreightContents {
  const FreightContents({
    this.items = const [],
    this.otherGoodsKg = 0,
    this.otherCategoryId = 'general',
    this.totalWeightKg = 0,
  });

  final List<ContentsItem> items;
  final double otherGoodsKg;
  final String otherCategoryId;
  final double totalWeightKg;

  bool get declared => items.isNotEmpty || otherGoodsKg > 0;

  /// The callable fields a declaration travels as. Empty when nothing was
  /// declared, so a prose-only request keeps its old shape exactly.
  Map<String, dynamic> payloadFields() {
    if (!declared) return const {};
    return {
      if (items.isNotEmpty)
        'contentsItems': items.map((item) => item.toJson()).toList(),
      if (otherGoodsKg > 0) ...{
        'otherGoodsKg': otherGoodsKg,
        'otherCategoryId': otherCategoryId.isEmpty
            ? 'general'
            : otherCategoryId,
      },
      if (totalWeightKg > 0) 'totalWeightKg': totalWeightKg,
    };
  }

  /// One line saying what is in the box.
  String summary() {
    final parts = [
      for (final item in items) '${item.quantity} × ${item.label}',
      if (otherGoodsKg > 0) '$otherGoodsKg kg',
    ];
    return parts.join(', ');
  }
}

/// Why this declaration cannot be sent, as an error code the screen turns
/// into words - or null when it can. The server re-validates everything.
String? contentsProblem(FreightContents contents) {
  if (contents.items.length > maxContentItems) return 'too_many_items';
  final categoryIds = standardFreightCategories.map((c) => c.id).toSet();
  for (final item in contents.items) {
    if (!categoryIds.contains(item.categoryId)) return 'category_invalid';
    final label = item.label.trim();
    if (label.isEmpty || label.length > maxContentLabelLength) {
      return 'label_invalid';
    }
    if (item.quantity < 1 || item.quantity > maxItemQuantity) {
      return 'quantity_invalid';
    }
  }
  return null;
}

class ContentsPricing {
  const ContentsPricing({
    required this.ok,
    this.error = '',
    this.itemLabel = '',
    this.flatCents = 0,
    this.includedKg = 0,
    this.weighedKg = 0,
    this.weighedCents = 0,
    this.estimateCents = 0,
  });

  final bool ok;
  final String error;
  final String itemLabel;
  final int flatCents;
  final double includedKg;
  final double weighedKg;
  final int weighedCents;
  final int estimateCents;
}

/// The declared box priced through ONE business's catalogue - the same rule
/// the server enforces: every listed item must carry a set price from this
/// business, and everything else rides in the one weighed bucket.
ContentsPricing priceContentsForBusiness({
  required Map<String, dynamic>? table,
  required int ratePerKgCents,
  required FreightContents contents,
}) {
  if (ratePerKgCents <= 0) {
    return const ContentsPricing(ok: false, error: 'route_rate_missing');
  }
  var flatCents = 0;
  var includedKg = 0.0;
  for (final item in contents.items) {
    final pricing = freightItemPricing(
      table: table,
      categoryId: item.categoryId,
      itemId: item.itemId,
    );
    if (!pricing.priced) {
      return ContentsPricing(
        ok: false,
        error: 'contents_item_unpriced',
        itemLabel: item.label,
      );
    }
    if (!pricing.isFlat) {
      return ContentsPricing(
        ok: false,
        error: 'contents_item_weighed',
        itemLabel: item.label,
      );
    }
    flatCents += (pricing.flatPrice * 100).round() * item.quantity;
    includedKg += pricing.includedKg * item.quantity;
  }
  final weighedCents = contents.otherGoodsKg > 0
      ? (contents.otherGoodsKg * ratePerKgCents).round()
      : 0;
  if (flatCents + weighedCents <= 0) {
    return const ContentsPricing(ok: false, error: 'contents_empty');
  }
  return ContentsPricing(
    ok: true,
    flatCents: flatCents,
    includedKg: (includedKg * 1000).round() / 1000,
    weighedKg: contents.otherGoodsKg,
    weighedCents: weighedCents,
    estimateCents: flatCents + weighedCents,
  );
}

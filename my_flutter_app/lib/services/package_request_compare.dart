/// The customer's "Send a package" flow, as pure logic (docs/
/// PACKAGE_PRICE_LIST.md §6): what the catalog of things to add is (the
/// union of what the businesses shipping to a country priced), the basket the
/// customer builds, the comparison of businesses with its sorts and filters,
/// the 2-hour windows of a day, and the pieces that go to the server.
///
/// Prices come only from `package_price_list.dart` (the mirror of the
/// server's rules), so the total shown here is the total the server makes.
/// The screens are thin glue over this file; every rule is unit-tested in
/// `test/package_request_compare_test.dart`.
library;

import 'dart:math';

import 'business_price_list.dart' show priceLbText;
import 'package_price_list.dart';
import 'package_requests.dart';

// ---------------------------------------------------------------------------
// The catalog: what a customer may add.
// ---------------------------------------------------------------------------

/// "Phone" in Electronics, as one row of the catalog.
class CatalogItem {
  const CatalogItem({
    required this.key,
    required this.label,
    required this.categoryId,
    this.includedLb = 0,
  });

  /// Label + category (the same item on every business's list).
  final String key;
  final String label;
  final String categoryId;

  /// "Up to X lb each": the smallest weight a price covers, when every
  /// business listing the item covers one; 0 = any weight. In the catalog's
  /// [RequestCatalog.weightUnit] (a route in the other unit is converted).
  final num includedLb;
}

/// The key one item has on every list: its name (any case) and category.
String catalogItemKey(String label, String categoryId) =>
    '${label.trim().toLowerCase()}|$categoryId';

class RequestCatalog {
  const RequestCatalog({
    this.items = const [],
    this.perLbCategoryIds = const [],
    this.barrel = false,
    this.weightUnit = 'lb',
  });

  /// The unit the weight questions are asked in ([catalogWeightUnit]).
  final String weightUnit;

  /// By name.
  final List<CatalogItem> items;

  /// Categories at least one business prices by the pound, in the shared
  /// order.
  final List<String> perLbCategoryIds;

  /// Some business has a barrel price (Sea only).
  final bool barrel;

  CatalogItem? item(String key) {
    for (final i in items) {
      if (i.key == key) return i;
    }
    return null;
  }
}

/// The businesses offered for [mode]: all of them by Sea, those that ship by
/// air for Air.
List<RequestOption> offeredForMode(
  Iterable<RequestOption> options,
  String mode,
) => [
  for (final o in options)
    if (mode != 'air' || o.shipsByAir) o,
];

/// Whether [mode] is on offer for any of [options] (Air needs a business that
/// ships by air).
bool anyOfferedForMode(Iterable<RequestOption> options, String mode) =>
    options.any((o) => mode != 'air' || o.shipsByAir);

/// The unit the weight questions are asked in (docs/SHIPPING_SIMPLE_HOME.md
/// K2): the business's own on its own link ([onlyBusinessId]), pounds when
/// several businesses are compared (each prices the customer's weight in its
/// own unit). Mirrors `catalogWeightUnit` in the console.
String catalogWeightUnit(
  Iterable<RequestOption> options, {
  String onlyBusinessId = '',
}) {
  if (onlyBusinessId.isEmpty) return 'lb';
  for (final option in options) {
    if (option.businessId != onlyBusinessId) continue;
    for (final mode in priceModes) {
      if (unitOf(option.routeFor(mode)) == 'kg') return 'kg';
    }
  }
  return 'lb';
}

/// The union of what the [options] priced for [mode]: items by name and
/// category, categories priced by the weight, and barrels (Sea, when some
/// business has a barrel price). [options] are those offered for the mode.
/// Included weights are shown in [unit] (a route in the other unit is
/// converted).
RequestCatalog buildRequestCatalog(
  Iterable<RequestOption> options,
  String mode, {
  String unit = 'lb',
}) {
  final labels = <String, String>{};
  final categories = <String, String>{};
  final covered = <String, List<num>>{};
  final listed = <String, int>{};
  final rates = <String>{};
  var barrel = false;
  for (final option in options) {
    final route = option.routeFor(mode);
    for (final raw in route?['items'] as List? ?? const []) {
      if (raw is! Map) continue;
      final label = (raw['label'] ?? '').toString().trim();
      final categoryId = (raw['categoryId'] ?? '').toString();
      if (label.isEmpty || priceCategoryOf(categoryId) == null) continue;
      final key = catalogItemKey(label, categoryId);
      labels.putIfAbsent(key, () => label);
      categories[key] = categoryId;
      listed[key] = (listed[key] ?? 0) + 1;
      final lb = raw['includedLb'];
      if (lb is num && lb > 0) {
        final inRoute = unitOf(route);
        (covered[key] ??= []).add(
          inRoute == unit ? lb : convertWeight(lb, inRoute, unit),
        );
      }
    }
    final perLb = route?['perLbCents'];
    if (perLb is Map) {
      for (final e in perLb.entries) {
        final cents = e.value;
        if (cents is num && cents > 0) rates.add(e.key.toString());
      }
    }
    final price = option.barrelPriceCents;
    if (mode != 'air' && price != null && price > 0) barrel = true;
  }
  final items = [
    for (final key in labels.keys)
      CatalogItem(
        key: key,
        label: labels[key]!,
        categoryId: categories[key]!,
        includedLb: (covered[key]?.length ?? 0) == listed[key]
            ? covered[key]!.reduce(min)
            : 0,
      ),
  ]..sort((a, b) => foldAccents(a.label).compareTo(foldAccents(b.label)));
  return RequestCatalog(
    items: items,
    perLbCategoryIds: [
      for (final c in priceCategories)
        if (rates.contains(c.id)) c.id,
    ],
    barrel: barrel,
    weightUnit: unit,
  );
}

// ---------------------------------------------------------------------------
// The basket.
// ---------------------------------------------------------------------------

/// One category priced by the weight: "Clothes · 50 lb" / "· 23 kg".
class BasketWeight {
  const BasketWeight({
    required this.categoryId,
    this.weightLb,
    this.weightUnit = 'lb',
    this.sizePreset = '',
  });

  final String categoryId;

  /// The number typed, in [weightUnit] (the name is legacy); null while the
  /// field is empty or not a number.
  final double? weightLb;

  /// The unit the number was typed in: "lb" or "kg".
  final String weightUnit;
  final String sizePreset;

  bool get valid =>
      priceCategoryOf(categoryId) != null &&
      weightLb != null &&
      weightLb! >= 0.1 &&
      weightLb! <=
          (weightUnit == 'kg' ? PriceLimit.weightKg : PriceLimit.weightLb);
}

/// "Something else": described in words, priced by staff.
class BasketOther {
  const BasketOther({this.description = '', this.photoPaths = const []});

  final String description;
  final List<String> photoPaths;

  bool get valid => description.trim().isNotEmpty;
}

/// A line of boxes: [quantity] of one size, picked from the size pictures or
/// decided by the inches typed (the inches win, as on the server), with up to
/// 3 photos (docs/PACKAGE_BOX_SIZES_PAY_NOW.md §1-§2). Sea only.
class BasketBox {
  const BasketBox({
    this.boxSize = '',
    this.dimsIn,
    this.quantity = 1,
    this.photoPaths = const [],
  });

  /// `small` / `medium` / `large` / `xl`; '' until one is chosen. Followed
  /// from [dimsIn] when those are given.
  final String boxSize;
  final RequestSize? dimsIn;
  final int quantity;
  final List<String> photoPaths;

  bool get valid =>
      quantity >= 1 &&
      quantity <= requestMaxQuantity &&
      (dimsIn != null || boxSizeIds.contains(boxSize));

  /// The piece as `priceBasket` takes it.
  Map<String, Object?> toPricingPiece() => {
    'kind': requestPieceBox,
    if (boxSize.isNotEmpty) 'boxSize': boxSize,
    if (dimsIn != null) 'dimsIn': dimsIn!.toMap(),
    'quantity': quantity,
  };

  RequestPieceDraft toDraft() => RequestPieceDraft.box(
    boxSize: boxSize,
    dimsIn: dimsIn,
    quantity: quantity,
    photoPaths: photoPaths,
  );
}

/// What the customer is sending.
class RequestBasket {
  const RequestBasket({
    this.items = const {},
    this.weights = const [],
    this.barrels = 0,
    this.others = const [],
    this.boxes = const [],
  });

  /// Quantity by catalog key (only those above 0).
  final Map<String, int> items;
  final List<BasketWeight> weights;
  final int barrels;
  final List<BasketOther> others;

  /// Box lines (Sea only).
  final List<BasketBox> boxes;

  /// The pieces the server will count: an item row is one piece whatever
  /// its quantity, a box line likewise, a barrel is one each.
  int get pieceCount =>
      items.length + weights.length + barrels + others.length + boxes.length;

  bool get isEmpty => pieceCount == 0;

  /// Whether there is anything complete enough to price.
  bool get hasPriceable =>
      items.isNotEmpty ||
      barrels > 0 ||
      weights.any((w) => w.valid) ||
      boxes.any((b) => b.valid) ||
      others.any((o) => o.valid);
}

/// The row of [route] that is [item], or null.
Map<String, dynamic>? routeItemFor(
  Map<String, dynamic>? route,
  CatalogItem item,
) {
  for (final raw in route?['items'] as List? ?? const []) {
    if (raw is! Map) continue;
    final label = (raw['label'] ?? '').toString();
    final categoryId = (raw['categoryId'] ?? '').toString();
    if (catalogItemKey(label, categoryId) == item.key) {
      return {for (final e in raw.entries) e.key.toString(): e.value};
    }
  }
  return null;
}

/// "2 × Phone", cut to the length a piece's description may have.
String _quantityLabel(int quantity, String label) {
  final text = quantity > 1 ? '$quantity × $label' : label;
  return text.length > requestMaxDescription
      ? text.substring(0, requestMaxDescription)
      : text;
}

/// The pieces of [basket] as `priceBasket` takes them for one business: an
/// item that business does not list is a piece it must quote ("ask me").
/// Only complete pieces are priced.
List<Map<String, Object?>> basketPricingPieces(
  RequestBasket basket,
  RequestCatalog catalog,
  RequestOption option,
  String mode,
) {
  final route = option.routeFor(mode);
  final out = <Map<String, Object?>>[];
  for (final entry in basket.items.entries) {
    final item = catalog.item(entry.key);
    if (item == null || entry.value < 1) continue;
    final found = routeItemFor(route, item);
    out.add({
      'priceItemId': found == null ? 'i__unlisted' : found['id'],
      'quantity': entry.value,
      'label': item.label,
    });
  }
  for (final w in basket.weights) {
    if (!w.valid) continue;
    // The unit travels with the number: each business prices it in its own.
    out.add({
      'categoryId': w.categoryId,
      'weightLb': w.weightLb,
      'weightUnit': w.weightUnit,
    });
  }
  for (var i = 0; i < basket.barrels; i++) {
    out.add({'kind': 'barrel'});
  }
  for (final b in basket.boxes) {
    if (b.valid) out.add(b.toPricingPiece());
  }
  for (final o in basket.others) {
    if (o.valid) out.add({'kind': 'other', 'description': o.description});
  }
  return out;
}

/// The pieces [basket] sends to [option]: items it lists by their id, items it
/// does not list as described pieces to quote, weights, barrels and the free
/// text ones with their photos. Incomplete ones are kept (empty weight,
/// empty text) so the form's own check flags them.
List<RequestPieceDraft> basketDrafts(
  RequestBasket basket,
  RequestCatalog catalog,
  RequestOption option,
  String mode,
) {
  final route = option.routeFor(mode);
  final out = <RequestPieceDraft>[];
  for (final entry in basket.items.entries) {
    final item = catalog.item(entry.key);
    if (item == null || entry.value < 1) continue;
    final found = routeItemFor(route, item);
    if (found == null) {
      out.add(
        RequestPieceDraft(
          kind: requestPieceOther,
          description: _quantityLabel(entry.value, item.label),
        ),
      );
    } else {
      out.add(
        RequestPieceDraft.item(
          itemId: found['id'].toString(),
          itemLabel: item.label,
          quantity: entry.value,
        ),
      );
    }
  }
  for (final w in basket.weights) {
    final weight = w.weightLb;
    out.add(
      weight == null
          ? RequestPieceDraft(
              kind: requestPieceOther,
              categoryId: w.categoryId,
              // Kept with the unit, so the form names the right limit.
              weightUnit: w.weightUnit,
            )
          : RequestPieceDraft.byWeight(
              categoryId: w.categoryId,
              weightLb: weight,
              weightUnit: w.weightUnit,
              sizePreset: w.sizePreset,
            ),
    );
  }
  for (var i = 0; i < basket.barrels; i++) {
    out.add(const RequestPieceDraft(kind: requestPieceBarrel));
  }
  for (final b in basket.boxes) {
    out.add(b.toDraft());
  }
  for (final o in basket.others) {
    out.add(
      RequestPieceDraft(
        kind: requestPieceOther,
        description: o.description,
        photoPaths: o.photoPaths,
      ),
    );
  }
  return out;
}

/// The weight typed in a weight field: a number from 0.1 to 2,000 lb (0.1 to
/// 900 kg for [unit] "kg") rounded to a tenth ("12,5" and "12.5" both read),
/// else null.
double? parseWeight(String text, [String unit = 'lb']) {
  final n = double.tryParse(text.trim().replaceAll(',', '.'));
  if (n == null || !n.isFinite) return null;
  final tenth = (n * 10).round() / 10;
  final limit = unit == 'kg' ? PriceLimit.weightKg : PriceLimit.weightLb;
  return tenth >= 0.1 && tenth <= limit ? tenth : null;
}

/// [parseWeight] in pounds.
double? parseWeightLb(String text) => parseWeight(text, 'lb');

/// The lb / kg choice on a weight line: a size button keeps its meaning (its
/// weight in the new unit); a number typed by hand is converted, to a tenth,
/// as the server would before pricing; one that does not read stays as typed.
/// Returns the new field text. Mirrors `setWeightUnit` in the console.
String weightFieldInUnit(
  String typed, {
  required String from,
  required String to,
  String presetId = '',
}) {
  if (from == to) return typed;
  for (final preset in sizePresets) {
    if (preset.id == presetId) return '${preset.inUnit(to)}';
  }
  final read = parseWeight(typed, from);
  return read == null ? typed : priceLbText(convertWeight(read, from, to));
}


// ---------------------------------------------------------------------------
// The comparison.
// ---------------------------------------------------------------------------

/// How a row's total reads.
enum RowPriceKind {
  /// Every piece priced and nothing weighed later: "$212.00".
  total,

  /// Every piece priced but some are weighed at the counter: "about $212.00".
  about,

  /// Some pieces priced, others to quote: "$120.00 + 2 to quote".
  partial,

  /// Nothing priced yet: the business sends a price.
  toQuote,
}

class CompareFilters {
  const CompareFilters({
    this.picksUp = false,
    this.paysBack = false,
    this.rated = false,
  });

  final bool picksUp;
  final bool paysBack;
  final bool rated;

  bool get any => picksUp || paysBack || rated;

  CompareFilters copyWith({bool? picksUp, bool? paysBack, bool? rated}) =>
      CompareFilters(
        picksUp: picksUp ?? this.picksUp,
        paysBack: paysBack ?? this.paysBack,
        rated: rated ?? this.rated,
      );

  bool allows(RequestOption option) =>
      (!picksUp || option.collectAvailable) &&
      (!paysBack || option.coversLoss) &&
      (!rated || option.hasRating);
}

/// One business in the comparison: its total for the basket and what the
/// customer weighs it by.
class ComparisonRow {
  const ComparisonRow({
    required this.option,
    required this.basket,
    required this.mode,
    this.quote,
    this.unavailableReason = '',
  });

  final RequestOption option;
  final BasketResult basket;
  final String mode;

  /// The pickup quote, when picking up.
  final PickupQuote? quote;

  /// Why the customer cannot choose it: `bring_in_unavailable`, or a pickup
  /// reason (`collect_unavailable`, `pickup_out_of_area`, ...); '' when it can.
  final String unavailableReason;

  bool get available => unavailableReason.isEmpty;

  /// It picks up but its staff set the fee: the total leaves it out.
  bool get feePending =>
      available && quote != null && quote!.available && !quote!.priced;

  int? get pickupFeeCents => quote?.shownFeeCents;

  DepartureResult get departure => option.departureFor(mode);

  RowPriceKind get priceKind {
    if (basket.allPriced) {
      return basket.weighsAtCounter ? RowPriceKind.about : RowPriceKind.total;
    }
    return basket.pricedCents > 0 ? RowPriceKind.partial : RowPriceKind.toQuote;
  }

  RankKey get rankKey => RankKey(
    businessId: option.businessId,
    businessName: option.businessName,
    allPriced: basket.allPriced,
    unpricedCount: basket.unpricedCount,
    totalCents: basket.totalCents,
    pricedCents: basket.pricedCents,
    rating: option.rating,
    reviewCount: option.reviewCount,
    departureKey: departure.dateKey,
  );
}

/// A row per business in [options] (those offered for [mode]) with the basket
/// priced at its list. [handoff] decides what a business must offer; for a
/// pickup, [quotes] (by business id) gives each fee or its refusal - a
/// business with no answer counts as picking up with the fee still to set.
List<ComparisonRow> comparisonRows({
  required Iterable<RequestOption> options,
  required String mode,
  required RequestBasket basket,
  required RequestCatalog catalog,
  required String handoff,
  Map<String, PickupQuote> quotes = const {},
}) {
  final collect = handoff == requestHandoffCollect;
  final rows = <ComparisonRow>[];
  for (final option in options) {
    PickupQuote? quote;
    var reason = '';
    if (collect) {
      quote = quotes[option.businessId];
      if (!option.collectAvailable) {
        reason = 'collect_unavailable';
      } else if (quote != null && !quote.available) {
        reason = quote.reason.isEmpty ? 'collect_unavailable' : quote.reason;
      }
    } else if (handoff == requestHandoffBringIn && !option.bringInAvailable) {
      reason = 'bring_in_unavailable';
    }
    rows.add(
      ComparisonRow(
        option: option,
        mode: mode,
        quote: quote,
        unavailableReason: reason,
        basket: priceBasket(
          option.routeFor(mode),
          basketPricingPieces(basket, catalog, option, mode),
          barrelPriceCents: option.barrelPriceCents,
          pickupFeeCents: reason.isEmpty ? quote?.shownFeeCents : null,
        ),
      ),
    );
  }
  return rows;
}

/// The rows the customer sees: filtered, those that can be chosen sorted by
/// [sort] (`best | price | rating | soonest`), then those that cannot.
List<ComparisonRow> arrangeRows(
  Iterable<ComparisonRow> rows, {
  String sort = 'best',
  CompareFilters filters = const CompareFilters(),
}) {
  final kept = [
    for (final r in rows)
      if (filters.allows(r.option)) r,
  ];
  final choosable = rankBy<ComparisonRow>(
    kept.where((r) => r.available),
    (r) => r.rankKey,
    sort: sort,
  );
  final others = rankBy<ComparisonRow>(
    kept.where((r) => !r.available),
    (r) => r.rankKey,
    sort: 'rating',
  );
  return [...choosable, ...others];
}

// ---------------------------------------------------------------------------
// Time windows (docs/PACKAGE_PRICE_LIST.md decision 6).
// ---------------------------------------------------------------------------

/// "HH:MM-HH:MM": a window as `pickup.window` carries it.
String requestWindowKey(RequestTimeWindow window) =>
    '${window.from}-${window.to}';

/// The 2-hour windows a customer may bring a package in on a day with
/// [hours]: hourly starts inside the opening hours. A day open for 2 hours or
/// less is one window, the whole day (30 minutes at least). A window that has
/// already started is left out when [afterMinutes] (now, in minutes after
/// midnight, for today) is given.
List<RequestTimeWindow> dropOffWindows(
  RequestDayHours hours, {
  int? afterMinutes,
}) {
  final open = requestMinutesOf(hours.from);
  final close = requestMinutesOf(hours.to);
  if (!hours.open ||
      open == null ||
      close == null ||
      close - open < requestWindowMinMinutes) {
    return const [];
  }
  return _windowsBetween(open, close, afterMinutes);
}

/// The windows of a pickup day: back-to-back 2-hour windows from 07:00 to
/// 21:00 (seven of them).
List<RequestTimeWindow> pickupWindowSlots({int? afterMinutes}) =>
    _windowsBetween(
      requestMinutesOf(requestPickupFrom)!,
      requestMinutesOf(requestPickupTo)!,
      afterMinutes,
      step: 120,
    );

List<RequestTimeWindow> _windowsBetween(
  int open,
  int close,
  int? after, {
  int step = 60,
}) {
  final spans = <(int, int)>[];
  if (close - open <= requestWindowMaxMinutes) {
    spans.add((open, close));
  } else {
    // Starts on the hour, never before the day opens.
    for (
      var start = ((open + 59) ~/ 60) * 60;
      start + 120 <= close;
      start += step
    ) {
      spans.add((start, start + 120));
    }
    // Opens at 9:30 and closes at 11:31: no on-the-hour start fits.
    if (spans.isEmpty) spans.add((open, open + 120));
  }
  return [
    for (final (from, to) in spans)
      if (after == null || from > after)
        RequestTimeWindow(from: requestHhmm(from), to: requestHhmm(to)),
  ];
}

/// The first day from [from] to [last] that [selectable] accepts, else null.
DateTime? firstSelectableDay(
  DateTime from,
  DateTime last,
  bool Function(DateTime day) selectable,
) {
  var day = DateTime(from.year, from.month, from.day);
  final end = DateTime(last.year, last.month, last.day);
  while (!day.isAfter(end)) {
    if (selectable(day)) return day;
    day = DateTime(day.year, day.month, day.day + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Words about a window, for any screen.
// ---------------------------------------------------------------------------

/// "2–4 PM" / "11 AM–1 PM" / "14 h–16 h" for a window; the full times when an
/// end is not on the hour ("9:30 AM–11:30 AM"). Null when an end is not a
/// time.
String? requestWindowShortText(String from, String to, String languageCode) {
  final a = requestMinutesOf(from), b = requestMinutesOf(to);
  if (a == null || b == null) return null;
  final french = languageCode.toLowerCase().startsWith('fr');
  if (a % 60 != 0 || b % 60 != 0) return _clockRange(a, b, french);
  if (french) return '${a ~/ 60} h–${b ~/ 60} h';
  String hour(int minutes) =>
      '${minutes ~/ 60 % 12 == 0 ? 12 : minutes ~/ 60 % 12}';
  final aPm = (a ~/ 60) % 24 >= 12, bPm = (b ~/ 60) % 24 >= 12;
  return aPm == bPm
      ? '${hour(a)}–${hour(b)} ${bPm ? 'PM' : 'AM'}'
      : '${hour(a)} ${aPm ? 'PM' : 'AM'}–${hour(b)} ${bPm ? 'PM' : 'AM'}';
}

String _clockRange(int a, int b, bool french) {
  String clock(int minutes) {
    final h = minutes ~/ 60 % 24, m = minutes % 60;
    if (french) return m == 0 ? '$h h' : '$h h ${m.toString().padLeft(2, '0')}';
    final h12 = h % 12 == 0 ? 12 : h % 12;
    return '$h12:${m.toString().padLeft(2, '0')} ${h < 12 ? 'AM' : 'PM'}';
  }

  return '${clock(a)}–${clock(b)}';
}

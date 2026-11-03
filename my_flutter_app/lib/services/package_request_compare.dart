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
  /// business listing the item covers one; 0 = any weight.
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
  });

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

/// The union of what the [options] priced for [mode]: items by name and
/// category, categories priced by the pound, and barrels (Sea, when some
/// business has a barrel price). [options] are those offered for the mode.
RequestCatalog buildRequestCatalog(
  Iterable<RequestOption> options,
  String mode,
) {
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
      if (lb is num && lb > 0) (covered[key] ??= []).add(lb);
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
  );
}

// ---------------------------------------------------------------------------
// The basket.
// ---------------------------------------------------------------------------

/// One category priced by the pound: "Clothes · 50 lb".
class BasketWeight {
  const BasketWeight({
    required this.categoryId,
    this.weightLb,
    this.sizePreset = '',
  });

  final String categoryId;

  /// Null while the field is empty or not a number.
  final double? weightLb;
  final String sizePreset;

  bool get valid =>
      priceCategoryOf(categoryId) != null &&
      weightLb != null &&
      weightLb! >= 0.1 &&
      weightLb! <= PriceLimit.weightLb;
}

/// "Something else": described in words, priced by staff.
class BasketOther {
  const BasketOther({this.description = '', this.photoPaths = const []});

  final String description;
  final List<String> photoPaths;

  bool get valid => description.trim().isNotEmpty;
}

/// What the customer is sending.
class RequestBasket {
  const RequestBasket({
    this.items = const {},
    this.weights = const [],
    this.barrels = 0,
    this.others = const [],
  });

  /// Quantity by catalog key (only those above 0).
  final Map<String, int> items;
  final List<BasketWeight> weights;
  final int barrels;
  final List<BasketOther> others;

  /// The pieces the server will count: an item row is one piece whatever
  /// its quantity, a barrel is one each.
  int get pieceCount => items.length + weights.length + barrels + others.length;

  bool get isEmpty => pieceCount == 0;

  /// Whether there is anything complete enough to price.
  bool get hasPriceable =>
      items.isNotEmpty ||
      barrels > 0 ||
      weights.any((w) => w.valid) ||
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
    out.add({'categoryId': w.categoryId, 'weightLb': w.weightLb});
  }
  for (var i = 0; i < basket.barrels; i++) {
    out.add({'kind': 'barrel'});
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
          ? RequestPieceDraft(kind: requestPieceOther, categoryId: w.categoryId)
          : RequestPieceDraft.byWeight(
              categoryId: w.categoryId,
              weightLb: weight,
              sizePreset: w.sizePreset,
            ),
    );
  }
  for (var i = 0; i < basket.barrels; i++) {
    out.add(const RequestPieceDraft(kind: requestPieceBarrel));
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

/// The weight typed in a pound field: a number from 0.1 to 2,000 rounded to a
/// tenth ("12,5" and "12.5" both read), else null.
double? parseWeightLb(String text) {
  final n = double.tryParse(text.trim().replaceAll(',', '.'));
  if (n == null || !n.isFinite) return null;
  final tenth = (n * 10).round() / 10;
  return tenth >= 0.1 && tenth <= PriceLimit.weightLb ? tenth : null;
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

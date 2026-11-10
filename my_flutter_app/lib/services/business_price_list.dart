/// The business's own price list (docs/PACKAGE_PRICE_LIST.md): what the
/// Shipping > Price list screen reads from `packagePriceLists/{businessId}`,
/// what its editor holds while the owner types, and the whole-routes payload
/// `setPackageRequestSettings {action: "price_list"}` takes.
///
/// Pure. The rules (what is a valid route, limits, item ids) are written once
/// in `package_price_list.dart`, the mirror of the server's; the editor runs
/// its payload through [validateRoute] before a round trip, and the server
/// still has the last word.
library;

import '../utils/money_input.dart';
import 'package_price_list.dart';

String _text(Object? value) => value == null ? '' : value.toString().trim();

int? _intOrNull(Object? value) {
  if (value is int) return value;
  if (value is num && value.isFinite) return value.toInt();
  return int.tryParse(_text(value));
}

Map<String, dynamic> _map(Object? value) => value is Map
    ? {for (final e in value.entries) e.key.toString(): e.value}
    : const <String, dynamic>{};

List<Object?> _list(Object? value) =>
    value is Iterable ? value.toList() : const <Object?>[];

/// A weight as typed or shown: no trailing ".0".
String priceLbText(num lb) =>
    lb == lb.roundToDouble() ? lb.toInt().toString() : lb.toStringAsFixed(1);

/// Whole dollars without cents ("40"), else "12.50": what a price field
/// opens on.
String priceCentsInput(int cents) =>
    cents % 100 == 0 ? '${cents ~/ 100}' : (cents / 100).toStringAsFixed(2);

// ---------------------------------------------------------------------------
// What is stored.
// ---------------------------------------------------------------------------

class PriceItem {
  const PriceItem({
    required this.id,
    required this.categoryId,
    required this.label,
    required this.priceCents,
    this.includedLb = 0,
  });

  factory PriceItem.fromMap(Object? value) {
    final m = _map(value);
    final included = m['includedLb'];
    return PriceItem(
      id: _text(m['id']),
      categoryId: _text(m['categoryId']),
      label: _text(m['label']),
      priceCents: _intOrNull(m['priceCents']) ?? 0,
      includedLb: included is num && included.isFinite && included > 0
          ? included.toDouble()
          : 0,
    );
  }

  final String id;
  final String categoryId;
  final String label;
  final int priceCents;

  /// The weight each item's fixed price covers, in the list's unit (pounds
  /// unless the list is in kilos; the name is legacy); 0 = any weight.
  final double includedLb;
}

/// One country by one mode.
class PriceRoute {
  const PriceRoute({
    this.items = const [],
    this.perLbCents = const {},
    this.boxPricesCents = const {},
    this.weekdays = const [],
    this.everyWeeks = 1,
    this.anchorDate = '',
    this.raw = const {},
    this.unit = 'lb',
  });

  factory PriceRoute.fromMap(Object? value) {
    final m = _map(value);
    final rates = <String, int>{};
    for (final e in _map(m['perLbCents']).entries) {
      final cents = _intOrNull(e.value);
      if (cents != null && cents > 0) rates[e.key] = cents;
    }
    final boxes = <String, int>{};
    for (final e in _map(m['boxPricesCents']).entries) {
      final cents = _intOrNull(e.value);
      if (cents != null && cents > 0) boxes[e.key] = cents;
    }
    final departure = _map(m['departure']);
    final days = {for (final d in _list(departure['weekdays'])) _text(d)};
    return PriceRoute(
      items: [for (final i in _list(m['items'])) PriceItem.fromMap(i)],
      perLbCents: rates,
      boxPricesCents: boxes,
      weekdays: [
        for (final d in priceWeekDays)
          if (days.contains(d)) d,
      ],
      everyWeeks: (_intOrNull(departure['everyWeeks']) ?? 1).clamp(
        1,
        PriceLimit.everyWeeks,
      ),
      anchorDate: _text(departure['anchorDate']),
      raw: m,
      unit: unitOf(m),
    );
  }

  final List<PriceItem> items;

  /// Rates by category id, per pound (per kilo on a kilo route: [unit]).
  final Map<String, int> perLbCents;

  /// The route as stored: what `pricePiece` reads (the counter's price fill
  /// prices through it, so the counter and the customer's estimate can never
  /// disagree on the arithmetic).
  final Map<String, dynamic> raw;

  /// "kg" on a kilo route, else "lb" (`unitOf`).
  final String unit;

  /// A price per box size (small / medium / large), Sea only; Extra large
  /// is always quoted (docs/PACKAGE_BOX_SIZES_PAY_NOW.md).
  final Map<String, int> boxPricesCents;
  final List<String> weekdays;
  final int everyWeeks;
  final String anchorDate;
}

class PriceListHistoryEntry {
  const PriceListHistoryEntry({
    required this.atMs,
    required this.action,
    this.byName = '',
    this.byLaawol = false,
    this.countries = const [],
  });

  factory PriceListHistoryEntry.fromMap(Object? value) {
    final m = _map(value);
    return PriceListHistoryEntry(
      atMs: _intOrNull(m['atMs']) ?? 0,
      action: _text(m['action']),
      byName: _text(m['byName']),
      byLaawol: m['byLaawol'] == true,
      countries: [
        for (final c in _list(m['countries']))
          if (_text(c).isNotEmpty) _text(c),
      ],
    );
  }

  final int atMs;

  /// `saved` or `checked`.
  final String action;
  final String byName;
  final bool byLaawol;
  final List<String> countries;

  bool get isChecked => action == 'checked';
}

/// `packagePriceLists/{businessId}` (or the callable's `priceList`).
class PackagePriceList {
  const PackagePriceList({
    this.routes = const {},
    this.weightUnit = 'lb',
    this.needsCheck = false,
    this.updatedAtMs = 0,
    this.updatedByName = '',
    this.updatedByLaawol = false,
    this.checkedAtMs = 0,
    this.checkedByName = '',
    this.history = const [],
  });

  /// A business that has never saved one.
  static const empty = PackagePriceList();

  factory PackagePriceList.fromMap(Object? value) {
    final m = _map(value);
    final routes = <String, Map<String, PriceRoute>>{};
    for (final country in _map(m['routes']).entries) {
      final pair = _map(country.value);
      final byMode = <String, PriceRoute>{};
      for (final mode in priceModes) {
        if (pair[mode] is Map) byMode[mode] = PriceRoute.fromMap(pair[mode]);
      }
      if (byMode.isNotEmpty) routes[country.key] = byMode;
    }
    return PackagePriceList(
      routes: routes,
      weightUnit: m['weightUnit'] == 'kg' ? 'kg' : 'lb',
      needsCheck: m['needsCheck'] == true,
      updatedAtMs: _intOrNull(m['updatedAtMs']) ?? 0,
      updatedByName: _text(m['updatedByName']),
      updatedByLaawol: m['updatedByLaawol'] == true,
      checkedAtMs: _intOrNull(m['checkedAtMs']) ?? 0,
      checkedByName: _text(m['checkedByName']),
      history: [
        for (final h in _list(m['history'])) PriceListHistoryEntry.fromMap(h),
      ],
    );
  }

  final Map<String, Map<String, PriceRoute>> routes;

  /// The list's one unit, "lb" or "kg" (absent on the document means lb):
  /// every rate, included weight and weight on its routes is in it.
  final String weightUnit;
  final bool needsCheck;
  final int updatedAtMs;
  final String updatedByName;
  final bool updatedByLaawol;
  final int checkedAtMs;
  final String checkedByName;

  /// Oldest first, as stored.
  final List<PriceListHistoryEntry> history;

  PriceRoute? route(String countryId, String mode) => routes[countryId]?[mode];

  /// Newest first, for the History list.
  List<PriceListHistoryEntry> get historyNewestFirst =>
      history.reversed.toList();
}

// ---------------------------------------------------------------------------
// What the owner is typing.
// ---------------------------------------------------------------------------

/// One item as typed: money and pounds stay text until they are sent.
class PriceItemDraft {
  const PriceItemDraft({
    this.id = '',
    this.label = '',
    this.categoryId = 'general',
    this.price = '',
    this.includedLb = '',
  });

  factory PriceItemDraft.of(PriceItem item) => PriceItemDraft(
    id: item.id,
    label: item.label,
    categoryId: item.categoryId,
    price: priceCentsInput(item.priceCents),
    includedLb: item.includedLb > 0 ? priceLbText(item.includedLb) : '',
  );

  /// The stored id, kept when the name changes (open requests still find
  /// the item); '' for a new item (the server makes `i_<slug>`).
  final String id;
  final String label;
  final String categoryId;
  final String price;
  final String includedLb;

  PriceItemDraft copyWith({
    String? label,
    String? categoryId,
    String? price,
    String? includedLb,
  }) => PriceItemDraft(
    id: id,
    label: label ?? this.label,
    categoryId: categoryId ?? this.categoryId,
    price: price ?? this.price,
    includedLb: includedLb ?? this.includedLb,
  );

  /// The item as `validateRoute` takes it. A price that is not money is sent
  /// as null (refused as `price_invalid`), never guessed.
  Map<String, Object?> toPayload() {
    final cents = readMoneyInput(price).cents;
    final covers = includedLb.trim().replaceAll(',', '.');
    return {
      if (id.isNotEmpty) 'id': id,
      'label': label.trim(),
      'categoryId': categoryId,
      'priceCents': cents,
      'includedLb': covers.isEmpty ? null : (double.tryParse(covers) ?? covers),
    };
  }
}

/// One route as typed.
class PriceRouteDraft {
  const PriceRouteDraft({
    this.items = const [],
    this.rates = const {},
    this.boxPrices = const {},
    this.weekdays = const {},
    this.everyWeeks = 1,
    this.anchorDate = '',
  });

  factory PriceRouteDraft.of(PriceRoute? route) => route == null
      ? const PriceRouteDraft()
      : PriceRouteDraft(
          items: [for (final i in route.items) PriceItemDraft.of(i)],
          rates: {
            for (final e in route.perLbCents.entries)
              e.key: priceCentsInput(e.value),
          },
          boxPrices: {
            for (final e in route.boxPricesCents.entries)
              e.key: priceCentsInput(e.value),
          },
          weekdays: route.weekdays.toSet(),
          everyWeeks: route.everyWeeks,
          anchorDate: route.anchorDate,
        );

  final List<PriceItemDraft> items;

  /// Price per pound by category id, as typed ('' = none).
  final Map<String, String> rates;

  /// Price per box size id, as typed ('' = none); Sea only.
  final Map<String, String> boxPrices;
  final Set<String> weekdays;
  final int everyWeeks;
  final String anchorDate;

  bool get isEmpty =>
      items.isEmpty &&
      rates.values.every((v) => v.trim().isEmpty) &&
      boxPrices.values.every((v) => v.trim().isEmpty) &&
      weekdays.isEmpty;

  PriceRouteDraft copyWith({
    List<PriceItemDraft>? items,
    Map<String, String>? rates,
    Map<String, String>? boxPrices,
    Set<String>? weekdays,
    int? everyWeeks,
    String? anchorDate,
  }) => PriceRouteDraft(
    items: items ?? this.items,
    rates: rates ?? this.rates,
    boxPrices: boxPrices ?? this.boxPrices,
    weekdays: weekdays ?? this.weekdays,
    everyWeeks: everyWeeks ?? this.everyWeeks,
    anchorDate: anchorDate ?? this.anchorDate,
  );

  /// The route as the server takes it: null when there is nothing in it.
  /// Box prices ride only a [sea] route (the server refuses them on Air).
  Map<String, Object?>? toPayload({bool sea = true}) {
    if (isEmpty) return null;
    final perLb = <String, Object?>{};
    for (final e in rates.entries) {
      final text = e.value.trim();
      if (text.isEmpty) continue;
      perLb[e.key] = readMoneyInput(text).cents ?? text;
    }
    final boxes = <String, Object?>{};
    if (sea) {
      for (final e in boxPrices.entries) {
        final text = e.value.trim();
        if (text.isEmpty) continue;
        boxes[e.key] = readMoneyInput(text).cents ?? text;
      }
    }
    return {
      'items': [for (final i in items) i.toPayload()],
      'perLbCents': perLb,
      if (boxes.isNotEmpty) 'boxPricesCents': boxes,
      'departure': weekdays.isEmpty
          ? null
          : {
              'weekdays': [
                for (final d in priceWeekDays)
                  if (weekdays.contains(d)) d,
              ],
              'everyWeeks': everyWeeks,
              'anchorDate': everyWeeks > 1 ? anchorDate : '',
            },
    };
  }
}

/// Every country's routes as typed: `{countryId: {sea, air}}`.
typedef PriceListDraft = Map<String, Map<String, PriceRouteDraft>>;

/// The editor's starting point: what is stored, for each of [countryIds].
PriceListDraft priceListDraftOf(
  PackagePriceList list,
  Iterable<String> countryIds,
) => {
  for (final id in countryIds)
    id: {
      for (final mode in priceModes)
        mode: PriceRouteDraft.of(list.route(id, mode)),
    },
};

/// The `routes` map `setPackageRequestSettings` takes: the whole list, only
/// for [countryIds] (a country the business no longer ships to would be
/// refused as `country_unknown`), only the modes that hold something.
Map<String, Object?> priceListRoutesPayload(
  PriceListDraft draft,
  Iterable<String> countryIds,
) {
  final routes = <String, Object?>{};
  for (final id in countryIds) {
    final pair = <String, Object?>{};
    for (final mode in priceModes) {
      final payload = draft[id]?[mode]?.toPayload(sea: mode == 'sea');
      if (payload != null) pair[mode] = payload;
    }
    if (pair.isNotEmpty) routes[id] = pair;
  }
  return routes;
}

/// Where a problem is: the country and mode whose route has [code].
class PriceListProblem {
  const PriceListProblem({
    required this.countryId,
    required this.mode,
    required this.code,
  });

  final String countryId;
  final String mode;
  final String code;
}

/// What the server would refuse, found before the round trip: the first
/// problem of each route, in the order the screen shows them.
List<PriceListProblem> priceListProblems(
  PriceListDraft draft,
  Iterable<String> countryIds, {
  String unit = 'lb',
}) {
  final out = <PriceListProblem>[];
  for (final id in countryIds) {
    for (final mode in priceModes) {
      final payload = draft[id]?[mode]?.toPayload(sea: mode == 'sea');
      if (payload == null) continue;
      final errors = validateRoute(payload, mode: mode, unit: unit).errors;
      if (errors.isNotEmpty) {
        out.add(PriceListProblem(countryId: id, mode: mode, code: errors[0]));
      }
    }
  }
  return out;
}

/// The routes that differ between what is stored and what is typed (what
/// "Unsaved changes" means): compares the payloads.
bool priceListChanged(
  PackagePriceList saved,
  PriceListDraft draft,
  Iterable<String> countryIds,
) {
  final now = priceListRoutesPayload(draft, countryIds);
  final before = priceListRoutesPayload(
    priceListDraftOf(saved, countryIds),
    countryIds,
  );
  return _canonical(now) != _canonical(before);
}

String _canonical(Object? value) {
  if (value is Map) {
    final keys = value.keys.map((k) => k.toString()).toList()..sort();
    return '{${keys.map((k) => '$k:${_canonical(value[k])}').join(',')}}';
  }
  if (value is Iterable) return '[${value.map(_canonical).join(',')}]';
  return '$value';
}

/// Items that cover a weight, or any piece priced by the pound, are
/// weighed at the counter (mirrors `weighsAtCounter` in `priceBasket`).
bool priceSnapshotWeighs(Map<String, dynamic>? price) {
  if (price == null) return false;
  final source = price['source'];
  if (source == 'per_lb') return true;
  final included = price['includedLb'];
  return source == 'item' && included is num && included > 0;
}

/// The words of a refusal code (`PRICE_LIST_MESSAGES` key) are the screen's:
/// this lists the codes the screen has words for.
const priceListReasonCodes = <String>[
  'price_list_invalid',
  'country_unknown',
  'mode_invalid',
  'too_many_routes',
  'too_many_items',
  'label_required',
  'label_too_long',
  'label_duplicate',
  'category_invalid',
  'price_invalid',
  'included_invalid',
  'per_lb_invalid',
  'departure_invalid',
  'item_unknown',
  'quantity_invalid',
  'weight_invalid',
  'weight_kg_invalid',
  'unit_invalid',
  'box_size_invalid',
  'dims_invalid',
  'box_sizes_sea_only',
  'box_price_invalid',
];

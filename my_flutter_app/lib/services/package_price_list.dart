/// Business price lists for "Send a package" (docs/PACKAGE_PRICE_LIST.md).
///
/// An exact Dart mirror of `functions/package_price_list.js` (and
/// `admin_web/src/lib/package-price-list.ts`): the server, the console and
/// the app all run the shared fixture
/// `functions/test/fixtures/package-price-list-cases.json`
/// (`test/package_price_list_test.dart`), so a rule changed in one place and
/// not the others fails there.
///
/// A business prices what it carries per destination country, separately by
/// Sea and by Air. A route holds:
/// - `items`: a fixed price per item ("Phone $40"), optionally covering only
///   up to `includedLb` pounds each (above that, the extra pounds are charged
///   at the item's category rate, once weighed at the counter);
/// - `perLbCents`: a price per pound for a whole category ("Clothes $6/lb");
/// - `boxPricesCents` (Sea only): a price per box size (small / medium /
///   large; docs/PACKAGE_BOX_SIZES_PAY_NOW.md), the size picked from typed
///   inches or the customer's choice;
/// - `departure`: the weekly schedule shown as "Next flight / container".
/// Anything not on the list is "ask me": the piece waits for a staff estimate.
///
/// Pure: no Firestore, no clock except what callers pass. Routes, items,
/// pieces and price snapshots stay JSON-shaped maps (they are what the server
/// stores and answers); every result has a `toMap()` that is exactly the
/// server's JSON, which is what the shared fixture compares.
///
/// Two deliberate differences from the JS, both invisible to the fixture:
/// whole numbers are kept as `int` (JSON has no 2.0), and `repricePieces`
/// compares price snapshots without regard to key order.
library;

// ---------------------------------------------------------------------------
// Vocabulary.
// ---------------------------------------------------------------------------

/// One shared category, so totals compare across businesses.
class PriceCategory {
  const PriceCategory(this.id, this.en, this.fr);

  final String id;
  final String en;
  final String fr;

  /// The label in [languageCode] (`fr`, else English).
  String label(String languageCode) => languageCode == 'fr' ? fr : en;
}

const priceCategories = <PriceCategory>[
  PriceCategory('general', 'General goods', 'Marchandises générales'),
  PriceCategory('clothing', 'Clothes and fabric', 'Vêtements et tissus'),
  PriceCategory('food', 'Food', 'Nourriture'),
  PriceCategory('documents', 'Documents', 'Documents'),
  PriceCategory(
    'cosmetics',
    'Cosmetics and liquids',
    'Cosmétiques et liquides',
  ),
  PriceCategory('electronics', 'Electronics', 'Électronique'),
  PriceCategory('fragile', 'Fragile items', 'Objets fragiles'),
];

final priceCategoryIds = <String>[for (final c in priceCategories) c.id];

/// The category with [id], or null.
PriceCategory? priceCategoryOf(String id) {
  for (final c in priceCategories) {
    if (c.id == id) return c;
  }
  return null;
}

const priceModes = <String>['sea', 'air'];
const priceWeekDays = <String>['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/// One-tap weights for things priced by the pound (owner decision 9).
class SizePreset {
  const SizePreset(this.id, this.lb, this.en, this.fr);

  final String id;
  final int lb;
  final String en;
  final String fr;

  String label(String languageCode) => languageCode == 'fr' ? fr : en;
}

const sizePresets = <SizePreset>[
  SizePreset('small_bag', 10, 'Small bag', 'Petit sac'),
  SizePreset('suitcase', 50, 'Suitcase', 'Valise'),
  SizePreset('big_box', 70, 'Big box', 'Grand carton'),
];

/// One box size (docs/PACKAGE_BOX_SIZES_PAY_NOW.md section 1). Laawol sets
/// them for every business; a business only prices them. [maxIn] is what the
/// size fits inside, longest side first; `xl` has none: anything bigger, always
/// quoted.
class BoxSize {
  const BoxSize(
    this.id,
    this.maxIn,
    this.en,
    this.fr,
    this.exampleEn,
    this.exampleFr,
  );

  final String id;
  final List<int>? maxIn;
  final String en;
  final String fr;
  final String exampleEn;
  final String exampleFr;

  String label(String languageCode) => languageCode == 'fr' ? fr : en;
  String example(String languageCode) =>
      languageCode == 'fr' ? exampleFr : exampleEn;
}

const boxSizes = <BoxSize>[
  BoxSize(
    'small',
    [18, 18, 18],
    'Small',
    'Petite',
    'About a shoebox',
    'Environ une boîte à chaussures',
  ),
  BoxSize(
    'medium',
    [24, 18, 18],
    'Medium',
    'Moyenne',
    'About a microwave box',
    'Environ un carton de micro-ondes',
  ),
  BoxSize(
    'large',
    [30, 24, 24],
    'Large',
    'Grande',
    'About a TV box',
    'Environ un carton de télé',
  ),
  BoxSize(
    'xl',
    null,
    'Extra large',
    'Très grande',
    'Bigger than Large',
    'Plus grande que Grande',
  ),
];

final boxSizeIds = <String>[for (final b in boxSizes) b.id];

/// The sizes a business can price (`xl` is always quoted).
const boxPricedIds = <String>['small', 'medium', 'large'];

/// A box may be this many inches over a size's limit, per dimension.
const boxSlackIn = 1;

/// A typed dimension is 1..120 inches, rounded to a tenth.
const boxDimMaxIn = 120;

/// What a box line says (the stored description), by size and language.
const _boxLabels = <String, Map<String, String>>{
  'small': {'en': 'Small box', 'fr': 'Petite boîte'},
  'medium': {'en': 'Medium box', 'fr': 'Boîte moyenne'},
  'large': {'en': 'Large box', 'fr': 'Grande boîte'},
  'xl': {'en': 'Extra large box', 'fr': 'Très grande boîte'},
};

/// The server's limits (`LIMIT` in the JS).
class PriceLimit {
  const PriceLimit._();

  static const routes = 80;
  static const itemsPerRoute = 60;
  static const label = 60;
  static const priceCents = 1000000; // $10,000
  static const perLbCents = 100000; // $1,000 a pound
  static const includedLb = 500;
  static const weightLb = 2000;
  static const quantity = 50;
  static const everyWeeks = 8;
}

const priceSorts = <String>['best', 'price', 'rating', 'soonest'];

final _itemId = RegExp(r'^i_[a-z0-9_]{1,40}$');
final _dateKey = RegExp(r'^\d{4}-\d{2}-\d{2}$');
const _dayMs = 24 * 60 * 60 * 1000;

/// The refusal codes of a price list, as the server names them.
const priceListMessages = <String, String>{
  'price_list_invalid': 'The price list could not be read.',
  'country_unknown': 'That country is not one you ship to.',
  'mode_invalid': 'Choose Sea or Air.',
  'too_many_routes': 'Too many countries in one price list.',
  'too_many_items': 'A route can hold at most 60 items.',
  'label_required': 'Give every item a name.',
  'label_too_long': 'An item name is too long (60 characters).',
  'label_duplicate': 'Two items have the same name.',
  'category_invalid': 'Choose a category for every item.',
  'price_invalid': 'Enter a price between \$0.01 and \$10,000.',
  'included_invalid': 'The weight a price covers must be 0 to 500 lb.',
  'per_lb_invalid': 'Enter a price per pound between \$0.01 and \$1,000.',
  'departure_invalid': 'Pick the days it leaves, and how many weeks apart.',
  'item_unknown': 'That item is no longer on the price list.',
  'quantity_invalid': 'Enter how many (1 to 50).',
  'weight_invalid': 'Enter the weight in pounds (0.1 to 2,000).',
  'box_sizes_sea_only': 'Box sizes are priced for Sea only.',
  'box_price_invalid': 'Enter a box price between \$0.01 and \$10,000.',
  'box_size_invalid': 'Choose a box size.',
  'dims_invalid': 'Box inches must be 1 to 120 in each direction.',
};

// ---------------------------------------------------------------------------
// JS-flavoured helpers (the rules are written once, in JS).
// ---------------------------------------------------------------------------

/// `String(value ?? "").trim().slice(0, max)`.
String _text(Object? value, [int max = 200]) {
  final s = (value == null ? '' : value.toString()).trim();
  return s.length > max ? s.substring(0, max) : s;
}

Map<String, dynamic>? _asMap(Object? value) {
  if (value is Map) {
    return {for (final e in value.entries) e.key.toString(): e.value};
  }
  return null;
}

List<Object?> _asList(Object? value) =>
    value is List ? List<Object?>.from(value) : const <Object?>[];

/// JavaScript's `Number(value)`: NaN when it is not a number.
double _jsNumber(Object? value) {
  if (value == null) return 0;
  if (value is num) return value.toDouble();
  if (value is bool) return value ? 1 : 0;
  if (value is String) {
    final s = value.trim();
    if (s.isEmpty) return 0;
    return double.tryParse(s) ?? double.nan;
  }
  return double.nan;
}

/// `Number.isInteger(value)`.
bool _isInteger(Object? value) =>
    value is num && value.isFinite && value == value.truncateToDouble();

/// `Math.round`: halves go up.
int _jsRound(double value) => (value + 0.5).floor();

/// A whole number as `int`, else the double (JSON has no 2.0).
num _clean(num value) =>
    value is double && value.isFinite && value == value.truncateToDouble()
    ? value.toInt()
    : value;

String _numText(num value) => _clean(value).toString();

bool _truthy(Object? value) =>
    value != null &&
    value != false &&
    value != 0 &&
    value != '' &&
    !(value is double && value.isNaN);

/// Whole cents from a client value; null when not a whole positive number in
/// range.
int? _centsIn(Object? value, int max) {
  final n = _jsNumber(value);
  return _isInteger(n) && n > 0 && n <= max ? n.toInt() : null;
}

/// Pounds rounded to a tenth; NaN when not a finite number.
double _tenth(Object? value) {
  final n = _jsNumber(value);
  return n.isFinite ? _jsRound(n * 10) / 10 : double.nan;
}

int? _intOf(Object? value) => _isInteger(value) ? (value as num).toInt() : null;

// Letters that decompose canonically (NFD) into a base letter and a combining
// mark. Dart has no normalizer, so the Latin ones are written out; letters
// with no decomposition (ø, đ, ł, æ, ß) are kept, as NFD keeps them, and then
// become "_" like any other non a-z character.
const _accentFolds = <String, String>{
  'a': 'àáâãäåāăąǎǟǡǻȁȃȧḁạảấầẩẫậắằẳẵặ',
  'c': 'çćĉċč',
  'd': 'ďḋḍḏḑḓ',
  'e': 'èéêëēĕėęěȅȇȩḕḗḙḛḝẹẻẽếềểễệ',
  'g': 'ĝğġģǧǵḡ',
  'h': 'ĥȟḣḥḧḩḫẖ',
  'i': 'ìíîïĩīĭįǐȉȋḭḯỉị',
  'j': 'ĵǰ',
  'k': 'ķǩḱḳḵ',
  'l': 'ĺļľḷḹḻḽ',
  'm': 'ḿṁṃ',
  'n': 'ñńņňǹṅṇṉṋ',
  'o': 'òóôõöōŏőơǒǫǭȍȏȫȭȯȱṍṏṑṓọỏốồổỗộớờởỡợ',
  'p': 'ṕṗ',
  'r': 'ŕŗřȑȓṙṛṝṟ',
  's': 'śŝşšșṡṣṥṧṩ',
  't': 'ţťțṫṭṯṱẗ',
  'u': 'ùúûüũūŭůűųưǔǖǘǚǜȕȗṳṵṷṹṻụủứừửữự',
  'v': 'ṽṿ',
  'w': 'ŵẁẃẅẇẉẘ',
  'x': 'ẋẍ',
  'y': 'ýÿŷȳẏẙỳỵỷỹ',
  'z': 'źżžẑẓẕ',
};

final Map<int, String> _foldTable = () {
  final table = <int, String>{};
  for (final entry in _accentFolds.entries) {
    for (final rune in entry.value.runes) {
      table[rune] = entry.key;
    }
  }
  return table;
}();

/// Lower-case [text] with Latin accents removed (NFD, then drop U+0300-036F).
String foldAccents(String text) {
  final out = StringBuffer();
  for (final rune in text.toLowerCase().runes) {
    if (rune >= 0x300 && rune <= 0x36f) continue;
    out.write(_foldTable[rune] ?? String.fromCharCode(rune));
  }
  return out.toString();
}

/// Approximates `String.prototype.localeCompare`: letters compare without
/// regard to case or accent first, the exact text breaks a tie.
int _localeCompare(String a, String b) {
  final c = foldAccents(a).compareTo(foldAccents(b));
  return c != 0 ? c : a.compareTo(b);
}

/// `{l, w, h}` in inches, each 1..120 rounded to a tenth; null when any side
/// is missing or out of range.
Map<String, num>? cleanDims(Object? raw) {
  final data = _asMap(raw);
  if (data == null) return null;
  final sides = [data['l'], data['w'], data['h']].map(_tenth).toList();
  if (!sides.every((n) => n >= 1 && n <= boxDimMaxIn)) return null;
  return {'l': _clean(sides[0]), 'w': _clean(sides[1]), 'h': _clean(sides[2])};
}

/// The smallest size a box fits in, turned any way, with 1 inch of slack per
/// dimension (both triples sorted longest first): `small`, `medium`, `large`
/// or `xl`; null when the inches are invalid.
String? boxSizeFor(Object? dims) {
  final clean = cleanDims(dims);
  if (clean == null) return null;
  final box = [clean['l']!, clean['w']!, clean['h']!]
    ..sort((a, b) => b.compareTo(a));
  for (final size in boxSizes) {
    final max = size.maxIn;
    if (max == null) continue;
    var fits = true;
    for (var i = 0; i < 3; i++) {
      if (!(box[i] <= max[i] + boxSlackIn)) fits = false;
    }
    if (fits) return size.id;
  }
  return 'xl';
}

/// What a box piece says it is.
class BoxOfPiece {
  const BoxOfPiece(this.boxSize, this.dimsIn, this.error);

  /// `''` when the piece names neither a size nor inches.
  final String boxSize;
  final Map<String, num>? dimsIn;
  final String error;
}

/// What a box piece says it is. Typed inches win over the size the client
/// chose.
BoxOfPiece boxOfPiece(Object? piece) {
  final p = _asMap(piece) ?? const <String, dynamic>{};
  bool blank(Object? v) => v == null || v == '';
  final dims = _asMap(p['dimsIn']);
  final typed = dims != null
      ? ['l', 'w', 'h'].any((k) => !blank(dims[k]))
      : !blank(p['dimsIn']);
  if (typed) {
    final dimsIn = cleanDims(p['dimsIn']);
    return dimsIn != null
        ? BoxOfPiece(boxSizeFor(dimsIn)!, dimsIn, '')
        : const BoxOfPiece('', null, 'dims_invalid');
  }
  final id = _text(p['boxSize'], 10);
  if (id.isEmpty) return const BoxOfPiece('', null, '');
  return boxSizeIds.contains(id)
      ? BoxOfPiece(id, null, '')
      : const BoxOfPiece('', null, 'box_size_invalid');
}

/// A stable id for an item name ("Phone (any)" -> "i_phone_any").
String itemIdFor(String label) {
  var slug = foldAccents(
    _text(label, PriceLimit.label),
  ).replaceAll(RegExp(r'[^a-z0-9]+'), '_').replaceAll(RegExp(r'^_+|_+$'), '');
  if (slug.length > 36) slug = slug.substring(0, 36);
  return 'i_${slug.isEmpty ? 'item' : slug}';
}

// ---------------------------------------------------------------------------
// Validation (the business's side, mirrored for the editor).
// ---------------------------------------------------------------------------

class DepartureCleaned {
  const DepartureCleaned(this.departure, this.ok);

  final Map<String, Object?>? departure;
  final bool ok;
}

/// A departure schedule a client sent, in its stored shape; null when none is
/// set.
DepartureCleaned cleanDeparture(Object? raw) {
  if (raw == null) return const DepartureCleaned(null, true);
  final data = _asMap(raw);
  if (data == null) return const DepartureCleaned(null, false);
  final days = _asList(data['weekdays']);
  final weekdays = [
    for (final d in priceWeekDays)
      if (days.contains(d)) d,
  ];
  if (weekdays.isEmpty) {
    // An empty schedule is "not set"; anything unknown in it is an error.
    return DepartureCleaned(null, days.isEmpty);
  }
  if (weekdays.length != days.toSet().length) {
    return const DepartureCleaned(null, false);
  }
  final everyRaw = data['everyWeeks'];
  final everyWeeks = everyRaw == null ? 1.0 : _jsNumber(everyRaw);
  if (!_isInteger(everyWeeks) ||
      everyWeeks < 1 ||
      everyWeeks > PriceLimit.everyWeeks) {
    return const DepartureCleaned(null, false);
  }
  final anchor = _text(data['anchorDate'], 10);
  if (everyWeeks > 1 && !dateKeyValid(anchor)) {
    return const DepartureCleaned(null, false);
  }
  return DepartureCleaned({
    'weekdays': weekdays,
    'everyWeeks': everyWeeks.toInt(),
    'anchorDate': everyWeeks > 1 ? anchor : '',
  }, true);
}

class RouteValidation {
  const RouteValidation(this.route, this.errors);

  /// The stored shape `{items, perLbCents, boxPricesCents?, departure}`; null
  /// when empty or invalid.
  final Map<String, Object?>? route;
  final List<String> errors;

  Map<String, Object?> toMap() => {'route': route, 'errors': errors};
}

/// Validates one route (a country by Sea or by Air; box sizes are Sea only,
/// [mode] defaults to sea).
RouteValidation validateRoute(Object? raw, {String mode = 'sea'}) {
  final errors = <String>[];
  void add(String code) {
    if (!errors.contains(code)) errors.add(code);
  }

  if (raw == null) return RouteValidation(null, errors);
  final data = _asMap(raw);
  if (data == null) return const RouteValidation(null, ['price_list_invalid']);
  final list = _asList(data['items']);
  if (list.length > PriceLimit.itemsPerRoute) add('too_many_items');
  final items = <Map<String, Object?>>[];
  final seenLabels = <String>{};
  final seenIds = <String>{};
  for (final entry in list.take(PriceLimit.itemsPerRoute)) {
    final item = _asMap(entry) ?? const <String, dynamic>{};
    final rawLabel = (item['label'] == null ? '' : item['label'].toString())
        .trim();
    if (rawLabel.isEmpty) add('label_required');
    if (rawLabel.length > PriceLimit.label) add('label_too_long');
    final label = rawLabel.length > PriceLimit.label
        ? rawLabel.substring(0, PriceLimit.label)
        : rawLabel;
    final key = label.toLowerCase();
    if (label.isNotEmpty && seenLabels.contains(key)) add('label_duplicate');
    seenLabels.add(key);
    final categoryId = _text(item['categoryId'], 40);
    if (!priceCategoryIds.contains(categoryId)) add('category_invalid');
    final priceCents = _centsIn(item['priceCents'], PriceLimit.priceCents);
    if (priceCents == null) add('price_invalid');
    final includedRaw = item['includedLb'];
    final included = includedRaw == null || includedRaw == ''
        ? 0.0
        : _tenth(includedRaw);
    if (!(included >= 0 && included <= PriceLimit.includedLb)) {
      add('included_invalid');
    }
    var id = _itemId.hasMatch(_text(item['id'], 44))
        ? _text(item['id'], 44)
        : itemIdFor(label);
    for (var n = 2; seenIds.contains(id); n++) {
      id = '${itemIdFor(label)}_$n';
    }
    seenIds.add(id);
    items.add({
      'id': id,
      'categoryId': categoryId,
      'label': label,
      'priceCents': priceCents ?? 0,
      'includedLb': included >= 0 ? _clean(included) : 0,
    });
  }
  final perLbCents = <String, int>{};
  final rates = _asMap(data['perLbCents']) ?? const <String, dynamic>{};
  for (final entry in rates.entries) {
    final value = entry.value;
    if (value == null || value == '') continue;
    if (!priceCategoryIds.contains(entry.key)) {
      add('category_invalid');
      continue;
    }
    final cents = _centsIn(value, PriceLimit.perLbCents);
    if (cents == null) {
      add('per_lb_invalid');
    } else {
      perLbCents[entry.key] = cents;
    }
  }
  final boxPricesCents = <String, int>{};
  final boxRaw = data['boxPricesCents'];
  if (boxRaw != null) {
    final boxMap = _asMap(boxRaw);
    if (boxMap == null) {
      add('box_price_invalid');
    } else {
      for (final entry in boxMap.entries) {
        final value = entry.value;
        if (value == null || value == '') continue;
        if (mode == 'air') {
          add('box_sizes_sea_only');
          continue;
        }
        final cents = boxPricedIds.contains(entry.key)
            ? _centsIn(value, PriceLimit.priceCents)
            : null;
        if (cents == null) {
          add('box_price_invalid');
        } else {
          boxPricesCents[entry.key] = cents;
        }
      }
    }
  }
  final cleaned = cleanDeparture(data['departure']);
  if (!cleaned.ok) add('departure_invalid');
  if (errors.isNotEmpty) return RouteValidation(null, errors);
  final empty =
      items.isEmpty &&
      perLbCents.isEmpty &&
      boxPricesCents.isEmpty &&
      cleaned.departure == null;
  return RouteValidation(
    empty
        ? null
        : {
            'items': items,
            'perLbCents': perLbCents,
            if (boxPricesCents.isNotEmpty) 'boxPricesCents': boxPricesCents,
            'departure': cleaned.departure,
          },
    errors,
  );
}

class PriceListValidation {
  const PriceListValidation(this.routes, this.errors);

  final Map<String, Map<String, Map<String, Object?>>>? routes;
  final List<String> errors;
}

/// Validates a whole price list `{routes: {[countryId]: {sea?, air?}}}`.
/// [countryIds] are the countries this business ships to.
PriceListValidation validatePriceList(
  Object? raw,
  Iterable<String> countryIds,
) {
  final data = _asMap(raw) ?? const <String, dynamic>{};
  final input = _asMap(data['routes']);
  if (input == null) {
    return const PriceListValidation(null, ['price_list_invalid']);
  }
  final known = countryIds.toSet();
  final errors = <String>[];
  void add(String code) {
    if (!errors.contains(code)) errors.add(code);
  }

  final entries = input.entries.toList();
  if (entries.length > PriceLimit.routes) add('too_many_routes');
  final routes = <String, Map<String, Map<String, Object?>>>{};
  for (final entry in entries.take(PriceLimit.routes)) {
    if (!known.contains(entry.key)) {
      add('country_unknown');
      continue;
    }
    final value = _asMap(entry.value);
    if (value == null) {
      add('price_list_invalid');
      continue;
    }
    for (final key in value.keys) {
      if (!priceModes.contains(key)) add('mode_invalid');
    }
    final pair = <String, Map<String, Object?>>{};
    for (final mode in priceModes) {
      final result = validateRoute(value[mode], mode: mode);
      result.errors.forEach(add);
      if (result.route != null) pair[mode] = result.route!;
    }
    if (pair.isNotEmpty) routes[entry.key] = pair;
  }
  return errors.isNotEmpty
      ? PriceListValidation(null, errors)
      : PriceListValidation(routes, errors);
}

/// The route a business priced for [countryId] by [mode] (`"air"`, else sea),
/// from a stored price list (or its `routes`); null when it priced nothing.
/// What `listPackageRequestOptions` sends as `routes[mode]` is a public route
/// `{items, perLbCents}` and works with [pricePiece] as it is.
Map<String, dynamic>? routeOf(Object? list, String countryId, String mode) {
  final top = _asMap(list);
  final routes = _asMap(top?['routes']) ?? top ?? const <String, dynamic>{};
  final pair = _asMap(routes[countryId]) ?? const <String, dynamic>{};
  return _asMap(pair[mode == 'air' ? 'air' : 'sea']);
}

/// The rate charged per pound above an item's included weight: its own
/// category's rate, else the route's general rate; null means staff decide.
int? excessRateCents(Map<String, dynamic>? route, String categoryId) {
  final rates = _asMap(route?['perLbCents']) ?? const <String, dynamic>{};
  final own = rates[categoryId];
  if (_isInteger(own) && (own as num) > 0) return own.toInt();
  final general = rates['general'];
  return _isInteger(general) && (general as num) > 0 ? general.toInt() : null;
}

// ---------------------------------------------------------------------------
// Pricing.
// ---------------------------------------------------------------------------

/// One priced piece: [price] is the snapshot stored on the piece.
class PricedPiece {
  const PricedPiece({
    this.price,
    this.estimateCents,
    this.description = '',
    this.error = '',
  });

  final Map<String, Object?>? price;
  final int? estimateCents;
  final String description;
  final String error;

  Map<String, Object?> toMap() => {
    'price': price,
    'estimateCents': estimateCents,
    'description': description,
    'error': error,
  };
}

/// Prices one piece a customer added, at today's prices.
///
/// A piece is one of:
/// - `{priceItemId, quantity}`: an item from the list;
/// - `{categoryId, weightLb}`: a category priced by the pound;
/// - `{kind: "box", boxSize | dimsIn, quantity}`: a Sea box priced by size
///   (typed inches win); `xl` or a size the business did not price is "ask
///   me";
/// - `{kind: "barrel"}`: priced by the destination's barrel price;
/// - anything else ("ask me"): no price, staff estimate it.
///
/// [lang] (`fr`, else English) is the language of the description a piece
/// stores; a price's label is always English.
PricedPiece pricePiece(
  Map<String, dynamic>? route,
  Object? piece, {
  int? barrelPriceCents,
  String? lang,
}) {
  final p = _asMap(piece) ?? const <String, dynamic>{};
  final itemId = _text(p['priceItemId'], 44);
  final categoryId = _text(p['categoryId'], 40);
  if (itemId.isNotEmpty) {
    final quantityRaw = _jsNumber(p['quantity'] ?? 1);
    if (!_isInteger(quantityRaw) ||
        quantityRaw < 1 ||
        quantityRaw > PriceLimit.quantity) {
      return const PricedPiece(error: 'quantity_invalid');
    }
    final quantity = quantityRaw.toInt();
    Map<String, dynamic>? item;
    for (final row in _asList(route?['items'])) {
      final m = _asMap(row);
      if (m != null && m['id'] == itemId) {
        item = m;
        break;
      }
    }
    if (item == null) {
      // Taken off the list since the customer looked: it becomes "ask me"
      // (today's prices rule) rather than refusing the request.
      final label = _text(p['label'], PriceLimit.label);
      return PricedPiece(
        description: label.isNotEmpty ? '$quantity × $label' : '',
      );
    }
    final unit = _intOf(item['priceCents']) ?? 0;
    final included = _jsNumber(item['includedLb']);
    final includedLb = included.isNaN ? 0 : _clean(included);
    final itemCategory = _text(item['categoryId'], 40);
    final label = _text(item['label'], 200);
    return PricedPiece(
      price: {
        'source': 'item',
        'itemId': item['id'],
        'label': item['label'],
        'categoryId': item['categoryId'],
        'quantity': quantity,
        'unitCents': unit,
        'includedLb': includedLb,
        'excessPerLbCents': includedLb > 0
            ? excessRateCents(route, itemCategory)
            : null,
        'perLbCents': null,
        'weightLb': null,
      },
      estimateCents: unit * quantity,
      description: quantity > 1 ? '$quantity × $label' : label,
    );
  }
  final weightRaw = p['weightLb'];
  if (categoryId.isNotEmpty && weightRaw != null && weightRaw != '') {
    final category = priceCategoryOf(categoryId);
    if (category == null) return const PricedPiece(error: 'category_invalid');
    final weightLb = _tenth(weightRaw);
    if (!(weightLb >= 0.1 && weightLb <= PriceLimit.weightLb)) {
      return const PricedPiece(error: 'weight_invalid');
    }
    final rates = _asMap(route?['perLbCents']) ?? const <String, dynamic>{};
    final rate = rates[categoryId];
    final label = category.en;
    final description =
        '${lang == 'fr' ? category.fr : label} · ${_numText(weightLb)} lb';
    if (!_isInteger(rate) || (rate as num) <= 0) {
      return PricedPiece(description: description);
    }
    return PricedPiece(
      price: {
        'source': 'per_lb',
        'itemId': '',
        'label': label,
        'categoryId': categoryId,
        'quantity': 1,
        'unitCents': null,
        'includedLb': 0,
        'excessPerLbCents': null,
        'perLbCents': rate.toInt(),
        'weightLb': _clean(weightLb),
      },
      estimateCents: _jsRound(rate * weightLb),
      description: description,
    );
  }
  if (_text(p['kind'], 20) == 'box') {
    final box = boxOfPiece(p);
    if (box.error.isNotEmpty) return PricedPiece(error: box.error);
    if (box.boxSize.isNotEmpty) {
      final quantityRaw = _jsNumber(p['quantity'] ?? 1);
      if (!_isInteger(quantityRaw) ||
          quantityRaw < 1 ||
          quantityRaw > PriceLimit.quantity) {
        return const PricedPiece(error: 'quantity_invalid');
      }
      final quantity = quantityRaw.toInt();
      // The description is in the customer's language; the price's label
      // stays English so re-pricing compares like with like.
      final name = _boxLabels[box.boxSize]![lang == 'fr' ? 'fr' : 'en']!;
      final description = quantity > 1 ? '$quantity × $name' : name;
      final unit = _intOf(_asMap(route?['boxPricesCents'])?[box.boxSize]);
      if (box.boxSize == 'xl' || unit == null || unit <= 0) {
        return PricedPiece(description: description);
      }
      return PricedPiece(
        price: {
          'source': 'box_size',
          'boxSize': box.boxSize,
          'itemId': '',
          'label': _boxLabels[box.boxSize]!['en'],
          'categoryId': '',
          'quantity': quantity,
          'unitCents': unit,
          'includedLb': 0,
          'excessPerLbCents': null,
          'perLbCents': null,
          'weightLb': null,
        },
        estimateCents: unit * quantity,
        description: description,
      );
    }
  }
  if (_text(p['kind'], 20) == 'barrel') {
    final cents = barrelPriceCents != null && barrelPriceCents > 0
        ? barrelPriceCents
        : null;
    return PricedPiece(
      price: cents == null
          ? null
          : {
              'source': 'barrel',
              'itemId': '',
              'label': 'Barrel',
              'categoryId': '',
              'quantity': 1,
              'unitCents': cents,
              'includedLb': 0,
              'excessPerLbCents': null,
              'perLbCents': null,
              'weightLb': null,
            },
      estimateCents: cents,
    );
  }
  return const PricedPiece();
}

/// The price once the counter scale has spoken. Fixed items without an
/// included weight never change; "up to X lb" items add the extra pounds at
/// the excess rate; by-the-pound pieces are rate x weight. Null when the extra
/// weight has no rate (staff type the price).
int? counterPriceCents(Map<String, dynamic>? price, Object? weighedLb) {
  if (price == null) return null;
  final weight = _tenth(weighedLb);
  final source = price['source'];
  if (source == 'per_lb') {
    if (!(weight > 0)) return null;
    final rate = _jsNumber(price['perLbCents']);
    return rate.isFinite ? _jsRound(rate * weight) : null;
  }
  if (source == 'barrel') return _intOf(price['unitCents']);
  if (source == 'box_size') {
    final unit = _intOf(price['unitCents']);
    final quantity = _jsNumber(price['quantity']);
    if (unit == null || !quantity.isFinite) return null;
    return unit * quantity.toInt();
  }
  if (source != 'item') return null;
  final unit = _intOf(price['unitCents']);
  final quantity = _jsNumber(price['quantity']);
  if (unit == null || !quantity.isFinite) return null;
  final base = unit * quantity.toInt();
  final includedLb = _jsNumber(price['includedLb']);
  if (!(includedLb > 0)) return base;
  if (!(weight >= 0)) return null;
  final extra = _jsRound((weight - includedLb * quantity) * 10) / 10;
  if (extra <= 0) return base;
  final excess = _intOf(price['excessPerLbCents']);
  if (excess == null) return null;
  return base + _jsRound(extra * excess);
}

class BasketResult {
  const BasketResult({
    required this.pieces,
    required this.pricedCents,
    required this.unpricedCount,
    required this.allPriced,
    required this.totalCents,
    required this.weighsAtCounter,
    required this.errors,
  });

  final List<PricedPiece> pieces;

  /// What is priced so far (plus the pickup fee).
  final int pricedCents;
  final int unpricedCount;
  final bool allPriced;

  /// Null unless every piece is priced.
  final int? totalCents;

  /// Some piece's final price waits for the counter scale.
  final bool weighsAtCounter;
  final List<String> errors;

  Map<String, Object?> toMap() => {
    'pieces': [for (final p in pieces) p.toMap()],
    'pricedCents': pricedCents,
    'unpricedCount': unpricedCount,
    'allPriced': allPriced,
    'totalCents': totalCents,
    'weighsAtCounter': weighsAtCounter,
    'errors': errors,
  };
}

/// Prices a customer's whole basket against one business's route.
BasketResult priceBasket(
  Map<String, dynamic>? route,
  Object? pieces, {
  int? barrelPriceCents,
  int? pickupFeeCents,
  String? lang,
}) {
  final list = _asList(pieces);
  final errors = <String>[];
  final rows = [
    for (final piece in list)
      pricePiece(route, piece, barrelPriceCents: barrelPriceCents, lang: lang),
  ];
  for (final row in rows) {
    if (row.error.isNotEmpty && !errors.contains(row.error)) {
      errors.add(row.error);
    }
  }
  final priced = rows.where((r) => r.estimateCents != null).toList();
  final pricedCents = priced.fold<int>(0, (sum, r) => sum + r.estimateCents!);
  final fee = pickupFeeCents != null && pickupFeeCents > 0 ? pickupFeeCents : 0;
  final unpricedCount = rows.length - priced.length;
  final allPriced = rows.isNotEmpty && unpricedCount == 0;
  return BasketResult(
    pieces: rows,
    pricedCents: pricedCents + fee,
    unpricedCount: unpricedCount,
    allPriced: allPriced,
    totalCents: allPriced ? pricedCents + fee : null,
    weighsAtCounter: rows.any((r) {
      final price = r.price;
      if (price == null) return false;
      return price['source'] == 'per_lb' ||
          (price['source'] == 'item' && _jsNumber(price['includedLb']) > 0);
    }),
    errors: errors,
  );
}

class RepriceResult {
  const RepriceResult({
    required this.pieces,
    required this.changed,
    required this.wentUp,
    required this.cents,
  });

  final List<Map<String, dynamic>> pieces;
  final bool changed;
  final bool wentUp;

  /// The new estimate per piece id.
  final Map<String, int> cents;
}

bool _deepEqual(Object? a, Object? b) {
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final key in a.keys) {
      if (!b.containsKey(key) || !_deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!_deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}

/// Re-prices the stored pieces of an open request at today's list (owner
/// decision 10). Only pieces priced from the list (item / per pound / box
/// size) move; a
/// piece whose item left the list keeps its price (staff decide at the
/// counter); barrels and "ask me" pieces are left alone.
RepriceResult repricePieces(Object? pieces, Map<String, dynamic>? route) {
  var changed = false;
  var wentUp = false;
  final cents = <String, int>{};
  final next = <Map<String, dynamic>>[];
  for (final raw in _asList(pieces)) {
    final piece = _asMap(raw) ?? <String, dynamic>{};
    final price = _asMap(piece['price']);
    final source = price?['source'];
    if (price == null ||
        (source != 'item' && source != 'per_lb' && source != 'box_size')) {
      next.add(piece);
      continue;
    }
    final again = pricePiece(
      route,
      source == 'item'
          ? {'priceItemId': price['itemId'], 'quantity': price['quantity']}
          : source == 'box_size'
          ? {
              'kind': 'box',
              'boxSize': price['boxSize'],
              'quantity': price['quantity'],
            }
          : {'categoryId': price['categoryId'], 'weightLb': price['weightLb']},
    );
    if (again.price == null || again.estimateCents == null) {
      next.add(piece);
      continue;
    }
    final before = _intOf(piece['estimateCents']);
    if (before == again.estimateCents && _deepEqual(price, again.price)) {
      next.add(piece);
      continue;
    }
    changed = true;
    if (before == null || again.estimateCents! > before) wentUp = true;
    cents[_text(piece['id'], 40)] = again.estimateCents!;
    next.add({
      ...piece,
      'price': again.price,
      'estimateCents': again.estimateCents,
    });
  }
  return RepriceResult(
    pieces: next,
    changed: changed,
    wentUp: wentUp,
    cents: cents,
  );
}

// ---------------------------------------------------------------------------
// Next departure (owner decision 5).
// ---------------------------------------------------------------------------

/// Whether [key] ("YYYY-MM-DD") is a real calendar day.
bool dateKeyValid(String key) {
  if (!_dateKey.hasMatch(key)) return false;
  final y = int.parse(key.substring(0, 4));
  final m = int.parse(key.substring(5, 7));
  final d = int.parse(key.substring(8, 10));
  final date = DateTime.utc(y, m, d);
  return date.year == y && date.month == m && date.day == d;
}

DateTime _utcOf(String key) => DateTime.utc(
  int.parse(key.substring(0, 4)),
  int.parse(key.substring(5, 7)),
  int.parse(key.substring(8, 10)),
);

String _keyOf(DateTime utc) =>
    '${utc.year.toString().padLeft(4, '0')}-'
    '${utc.month.toString().padLeft(2, '0')}-'
    '${utc.day.toString().padLeft(2, '0')}';

/// [key] plus [days] days.
String addDays(String key, int days) => _keyOf(
  DateTime.fromMillisecondsSinceEpoch(
    _utcOf(key).millisecondsSinceEpoch + days * _dayMs,
    isUtc: true,
  ),
);

/// `mon`..`sun` for [key].
String weekdayOf(String key) => priceWeekDays[_utcOf(key).weekday - 1];

/// The next day the schedule leaves, from [todayKey] (inclusive); "" when no
/// schedule.
String nextScheduledDate(Object? departure, String todayKey) {
  final schedule = _asMap(departure);
  if (schedule == null || !dateKeyValid(todayKey)) return '';
  final days = _asList(schedule['weekdays']);
  if (days.isEmpty) return '';
  final every = _jsNumber(schedule['everyWeeks'] ?? 1);
  final everyN = every == 0 ? 1.0 : every;
  final anchorRaw = _text(schedule['anchorDate'], 10);
  final anchor = everyN > 1 && dateKeyValid(anchorRaw) ? anchorRaw : '';
  // Monday of the anchor week; a week counts when it is a multiple of
  // `every` weeks from it.
  String mondayOf(String key) =>
      addDays(key, -priceWeekDays.indexOf(weekdayOf(key)));
  final anchorMonday = anchor.isEmpty ? '' : mondayOf(anchor);
  final span = 7 * (everyN > 1 ? everyN : 1) + 7;
  for (var i = 0; i < span; i++) {
    final key = addDays(todayKey, i);
    if (!days.contains(weekdayOf(key))) continue;
    if (anchorMonday.isNotEmpty) {
      final weeks =
          ((_utcOf(mondayOf(key)).millisecondsSinceEpoch -
                      _utcOf(anchorMonday).millisecondsSinceEpoch) /
                  (7 * _dayMs))
              .round();
      final step = everyN.toInt();
      if (((weeks % step) + step) % step != 0) continue;
    }
    return key;
  }
  return '';
}

class DepartureResult {
  const DepartureResult({
    this.dateKey = '',
    this.source = 'none',
    this.approximate = false,
  });

  /// "YYYY-MM-DD", or "" when none.
  final String dateKey;

  /// `planned` | `schedule` | `unconfirmed` | `none`.
  final String source;
  final bool approximate;

  /// From the server's `departures[mode]` map.
  factory DepartureResult.fromMap(Object? value) {
    final m = _asMap(value) ?? const <String, dynamic>{};
    return DepartureResult(
      dateKey: _text(m['dateKey'], 10),
      source: _text(m['source'], 20).isEmpty ? 'none' : _text(m['source'], 20),
      approximate: m['approximate'] == true,
    );
  }

  Map<String, Object?> toMap() => {
    'dateKey': dateKey,
    'source': source,
    'approximate': approximate,
  };
}

/// What the comparison row says about the next departure.
///
/// A container/flight with a planned departure date wins over the schedule.
/// A planned date that has passed with the shipment still not gone makes the
/// row say "Departure date not confirmed", whatever the schedule says.
///
/// [planned] is `[{dateKey, departed}]`.
DepartureResult nextDeparture({
  Object? departure,
  Object? planned,
  required String todayKey,
}) {
  final list = [
    for (final raw in _asList(planned))
      if (_asMap(raw) case final Map<String, dynamic> p
          when dateKeyValid(_text(p['dateKey'], 10)) && !_truthy(p['departed']))
        _text(p['dateKey'], 10),
  ];
  final upcoming = list.where((k) => k.compareTo(todayKey) >= 0).toList()
    ..sort();
  if (upcoming.isNotEmpty) {
    return DepartureResult(dateKey: upcoming.first, source: 'planned');
  }
  if (list.any((k) => k.compareTo(todayKey) < 0)) {
    return const DepartureResult(source: 'unconfirmed');
  }
  final key = nextScheduledDate(departure, todayKey);
  if (key.isNotEmpty) {
    final every = _jsNumber(_asMap(departure)?['everyWeeks'] ?? 1);
    return DepartureResult(
      dateKey: key,
      source: 'schedule',
      approximate: (every == 0 ? 1 : every) > 1,
    );
  }
  return const DepartureResult();
}

// ---------------------------------------------------------------------------
// The comparison list (owner decisions 1 and 3).
// ---------------------------------------------------------------------------

/// What [rankBy] orders a business by.
class RankKey {
  const RankKey({
    required this.businessId,
    this.businessName = '',
    this.allPriced = false,
    this.unpricedCount,
    this.totalCents,
    this.pricedCents,
    this.rating,
    this.reviewCount = 0,
    this.departureKey = '',
  });

  factory RankKey.fromMap(Map<String, dynamic> m) => RankKey(
    businessId: _text(m['businessId'], 200),
    businessName: _text(m['businessName'], 200),
    allPriced: _truthy(m['allPriced']),
    unpricedCount: _intOf(m['unpricedCount']),
    totalCents: _intOf(m['totalCents']),
    pricedCents: _intOf(m['pricedCents']),
    rating: m['rating'] is num ? (m['rating'] as num).toDouble() : null,
    reviewCount: _jsNumber(m['reviewCount']).isNaN
        ? 0
        : _jsNumber(m['reviewCount']).toInt(),
    departureKey: _text(m['departureKey'], 10),
  );

  final String businessId;
  final String businessName;
  final bool allPriced;
  final int? unpricedCount;
  final int? totalCents;
  final int? pricedCents;

  /// 0..5, or null.
  final double? rating;
  final int reviewCount;

  /// "" when there is no departure.
  final String departureKey;
}

const _maxSafe = 9007199254740991;

/// Orders the businesses a customer compares.
///
/// - best (default): every piece priced first, then the fewest pieces left to
///   quote, then lowest total (known total, else what is priced so far), then
///   rating, then name;
/// - price: the same without the rating;
/// - rating: highest rating first, unrated last;
/// - soonest: earliest next departure first, none last.
///
/// Returns a new list.
List<T> rankBy<T>(
  Iterable<T> items,
  RankKey Function(T item) keyOf, {
  String sort = 'best',
}) {
  int total(RankKey o) => o.totalCents ?? _maxSafe;
  int partial(RankKey o) => o.pricedCents ?? _maxSafe;
  double rating(RankKey o) =>
      o.rating != null && o.rating!.isFinite && o.reviewCount > 0
      ? o.rating!
      : -1;
  String departure(RankKey o) =>
      o.departureKey.isEmpty ? '9999-99-99' : o.departureKey;
  int left(RankKey o) => o.unpricedCount ?? _maxSafe;
  int name(RankKey a, RankKey b) {
    final c = _localeCompare(a.businessName, b.businessName);
    return c != 0 ? c : _localeCompare(a.businessId, b.businessId);
  }

  int money(RankKey a, RankKey b) =>
      a.allPriced ? total(a) - total(b) : partial(a) - partial(b);
  int priced(RankKey a, RankKey b) =>
      (b.allPriced ? 1 : 0) - (a.allPriced ? 1 : 0);

  int Function(RankKey, RankKey) compare;
  switch (priceSorts.contains(sort) ? sort : 'best') {
    case 'price':
      compare = (a, b) {
        var c = priced(a, b);
        if (c != 0) return c;
        c = left(a) - left(b);
        if (c != 0) return c;
        c = money(a, b);
        return c != 0 ? c : name(a, b);
      };
    case 'rating':
      compare = (a, b) {
        var c = rating(b).compareTo(rating(a));
        if (c != 0) return c;
        c = b.reviewCount - a.reviewCount;
        return c != 0 ? c : name(a, b);
      };
    case 'soonest':
      compare = (a, b) {
        var c = departure(a).compareTo(departure(b));
        if (c != 0) return c;
        c = total(a) - total(b);
        return c != 0 ? c : name(a, b);
      };
    default:
      compare = (a, b) {
        var c = priced(a, b);
        if (c != 0) return c;
        c = left(a) - left(b);
        if (c != 0) return c;
        c = money(a, b);
        if (c != 0) return c;
        c = rating(b).compareTo(rating(a));
        return c != 0 ? c : name(a, b);
      };
  }
  // Dart's sort is not stable: the index settles exact ties.
  final indexed = [
    for (final (i, item) in items.indexed) (i, item, keyOf(item)),
  ];
  indexed.sort((a, b) {
    final c = compare(a.$3, b.$3);
    return c != 0 ? c : a.$1 - b.$1;
  });
  return [for (final e in indexed) e.$2];
}

/// [rankBy] over the fixture's JSON maps `{businessId, businessName,
/// allPriced, unpricedCount, totalCents, pricedCents, rating, reviewCount,
/// departureKey}`.
List<Map<String, dynamic>> rankOptions(
  Iterable<Object?> options, [
  String sort = 'best',
]) => rankBy<Map<String, dynamic>>(
  [
    for (final o in options)
      if (_asMap(o) case final Map<String, dynamic> m) m,
  ],
  RankKey.fromMap,
  sort: sort,
);

/// Where a request came from (owner decision 4): "laawol" when the customer
/// found the business on Laawol (the comparison list), "business" when they
/// came through the business's own link, QR or WhatsApp QR.
String foundVia(Object? value) =>
    _text(value, 20) == 'business' ? 'business' : 'laawol';

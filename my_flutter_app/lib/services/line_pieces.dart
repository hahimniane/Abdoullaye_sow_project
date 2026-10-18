/// Pieces on a line, app side (docs/PACKAGE_REQUESTS.md section 1 and 7
/// "Line fields"; docs/WAITING_PACKAGES.md "Pieces").
///
/// A line (`containerLines`) is one customer's load: one sender, one
/// receiver, one destination, one tracking code. It holds pieces - each
/// physical thing handed over: a barrel, a box, a loose TV. Several things
/// packed in one box are ONE piece. A car stays a line of its own kind with
/// one implicit piece.
///
/// Every reader goes through [linePieces], which also reads the lines written
/// before pieces existed: `{kind: "barrels", quantity: 4}` is four barrel
/// pieces, `{kind: "other", quantity: 2, description}` two `other` pieces
/// with that description, a car one car piece.
///
/// A line can be split across containers: the pieces that go stay on the
/// line, the rest become a linked part (`CL-K7M4P2-2`, then -3...) with the
/// same people and destination. A group is the root line and its parts
/// (`rootLineId`, `partIndex`); payments stay on the root, and what is paid
/// and owed is read for the whole group.
///
/// A faithful mirror of `functions/line_pieces.js`, function for function
/// and with the same names: `test/line_pieces_test.dart` runs every case of
/// `functions/test/fixtures/line-pieces-cases.json` - the cases the server
/// and the console run too - and checks that every export has a mirror here.
/// The functions take what Firestore or a request holds (maps, numbers or
/// text where a person typed), the way the JavaScript does, and the typed
/// results ([LinePiece], [LineGroupSummary]...) turn back into the same JSON
/// with `toMap`. Pure Dart: no Firebase, no clock.
library;

import 'dart:math' as math;

/// The most cents a price can be (the invoice ledger's `MAX_CENTS`).
const _maxCents = 100000000;

/// The piece kinds a counter registers. `PIECE_KIND` on the server.
const pieceKind = (barrel: 'barrel', box: 'box', other: 'other');

/// What a counter can register. "car" is read (a car line's implicit piece)
/// but never written as a piece.
const pieceKinds = <String>['barrel', 'box', 'other'];
const carPieceKind = 'car';

/// The most pieces one line takes at the counter (and in an edit).
const maxPieces = 60;

/// A legacy quantity is capped where the old form capped it.
const maxLegacyPieces = 999;
const maxPieceDescription = 120;

/// Inches; the same cap as a line's own size.
const maxPieceInches = 600;
final RegExp _pieceId = RegExp(r'^[A-Za-z0-9_-]{1,40}$');

const lineSources = <String>['counter', 'request', 'card_order'];

// ---------------------------------------------------------------------------
// JavaScript's coercions, so the rules read values the way the server does.
// ---------------------------------------------------------------------------

/// Anything that turns back into the JSON the server would hold.
abstract interface class _Mappable {
  Map<String, Object?> toMap();
}

/// `Number(value)`.
double _number(Object? value) {
  if (value == null) return 0;
  if (value is num) return value.toDouble();
  if (value is bool) return value ? 1 : 0;
  if (value is String) {
    final t = value.trim();
    if (t.isEmpty) return 0;
    if (RegExp(r'^0[xX][0-9a-fA-F]+$').hasMatch(t)) {
      return int.parse(t.substring(2), radix: 16).toDouble();
    }
    if (!RegExp(
      r'^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$|^[+-]?Infinity$',
    ).hasMatch(t)) {
      return double.nan;
    }
    return double.tryParse(t) ?? double.nan;
  }
  return double.nan;
}

bool _isInteger(double n) => n.isFinite && n == n.truncateToDouble();

/// A number written the way JavaScript prints it: 10 for 10.0, 20.56.
String _numberText(num n) {
  if (n is int) return '$n';
  final d = n.toDouble();
  if (d.isNaN) return 'NaN';
  if (d.isInfinite) return d > 0 ? 'Infinity' : '-Infinity';
  if (_isInteger(d) && d.abs() < 1e21) return d.toInt().toString();
  return d.toString();
}

/// `String(value ?? "")`.
String _string(Object? value) {
  if (value == null) return '';
  if (value is String) return value;
  if (value is num) return _numberText(value);
  if (value is bool) return value ? 'true' : 'false';
  if (value is List) return value.map(_string).join(',');
  if (value is Map || value is _Mappable) return '[object Object]';
  return value.toString();
}

String _text(Object? value, [int max = 200]) {
  final t = _string(value).trim();
  return t.length > max ? t.substring(0, max) : t;
}

int _positiveInt(Object? value) {
  final n = _number(value);
  return n.isFinite && n > 0 ? n.round() : 0;
}

bool _given(Object? value) => value != null && _string(value).trim() != '';

Map<Object?, Object?> _asRow(Object? value) {
  if (value is Map) return value;
  if (value is _Mappable) return value.toMap();
  return const {};
}

List<Object?> _list(Object? value) => value is List ? value : const [];

// ---------------------------------------------------------------------------
// The typed results.
// ---------------------------------------------------------------------------

/// A piece's size in inches: all three sides.
class PieceSize implements _Mappable {
  const PieceSize(this.l, this.w, this.h);

  final double l;
  final double w;
  final double h;

  @override
  Map<String, Object?> toMap() => {'l': l, 'w': w, 'h': h};
}

/// One piece as stored: `{id, kind, description, sizeIn, priceCents}`.
class LinePiece implements _Mappable {
  const LinePiece({
    required this.id,
    required this.kind,
    this.description = '',
    this.sizeIn,
    this.priceCents,
  });

  final String id;

  /// barrel, box, other - or car for a car line's implicit piece.
  final String kind;
  final String description;
  final PieceSize? sizeIn;

  /// Whole cents, zero allowed; null while not priced.
  final int? priceCents;

  bool get isBarrel => kind == pieceKind.barrel;
  bool get isBox => kind == pieceKind.box;
  bool get isCar => kind == carPieceKind;

  @override
  Map<String, Object?> toMap() => {
    'id': id,
    'kind': kind,
    'description': description,
    'sizeIn': sizeIn?.toMap(),
    'priceCents': priceCents,
  };
}

/// The denormalized counts every line carries.
class PieceCounts implements _Mappable {
  const PieceCounts({
    this.pieceCount = 0,
    this.barrelPieces = 0,
    this.packagePieces = 0,
    this.carPieces = 0,
  });

  final int pieceCount;
  final int barrelPieces;

  /// Boxes and other pieces.
  final int packagePieces;
  final int carPieces;

  @override
  Map<String, Object?> toMap() => {
    'pieceCount': pieceCount,
    'barrelPieces': barrelPieces,
    'packagePieces': packagePieces,
    'carPieces': carPieces,
  };
}

/// What older app versions read: `{kind, quantity, description}`.
class PiecesSummary implements _Mappable {
  const PiecesSummary({
    required this.kind,
    required this.quantity,
    required this.description,
  });

  final String kind;
  final int quantity;
  final String description;

  @override
  Map<String, Object?> toMap() => {
    'kind': kind,
    'quantity': quantity,
    'description': description,
  };
}

/// One line of a group, as [lineGroupSummary] lists it.
class LineGroupPart implements _Mappable {
  const LineGroupPart({
    required this.id,
    required this.trackingCode,
    required this.partIndex,
    required this.pieceCount,
    required this.priceCents,
    required this.containerId,
    required this.containerStatus,
  });

  final String id;
  final String trackingCode;
  final int partIndex;
  final int pieceCount;
  final int? priceCents;
  final String containerId;
  final String containerStatus;

  @override
  Map<String, Object?> toMap() => {
    'id': id,
    'trackingCode': trackingCode,
    'partIndex': partIndex,
    'pieceCount': pieceCount,
    'priceCents': priceCents,
    'containerId': containerId,
    'containerStatus': containerStatus,
  };
}

/// What a group adds up to. Payments live on the root.
class LineGroupSummary implements _Mappable {
  const LineGroupSummary({
    required this.rootLineId,
    required this.partCount,
    required this.pieceCount,
    required this.priceCents,
    required this.paidCents,
    required this.balanceCents,
    required this.payOnArrival,
    required this.parts,
  });

  final String rootLineId;
  final int partCount;
  final int pieceCount;
  final int? priceCents;
  final int paidCents;
  final int balanceCents;
  final bool payOnArrival;
  final List<LineGroupPart> parts;

  /// More than one line: the package was split across containers.
  bool get isSplit => partCount > 1;

  @override
  Map<String, Object?> toMap() => {
    'rootLineId': rootLineId,
    'partCount': partCount,
    'pieceCount': pieceCount,
    'priceCents': priceCents,
    'paidCents': paidCents,
    'balanceCents': balanceCents,
    'payOnArrival': payOnArrival,
    'parts': [for (final p in parts) p.toMap()],
  };
}

/// One entry for [lineGroupSummary]: a line and its document id.
class LineGroupEntry implements _Mappable {
  const LineGroupEntry(this.id, this.line);

  final String id;
  final Object? line;

  @override
  Map<String, Object?> toMap() => {'id': id, 'line': line};
}

/// How a line splits ([splitPieces]).
class PieceSplit implements _Mappable {
  const PieceSplit({
    required this.error,
    required this.split,
    required this.going,
    required this.staying,
  });

  /// "piece_count_invalid", or null.
  final String? error;
  final bool split;
  final List<LinePiece> going;
  final List<LinePiece> staying;

  @override
  Map<String, Object?> toMap() => {
    'error': error,
    'split': split,
    'going': [for (final p in going) p.toMap()],
    'staying': [for (final p in staying) p.toMap()],
  };
}

// ---------------------------------------------------------------------------
// One piece.
// ---------------------------------------------------------------------------

/// One side in inches: two decimals, or null when blank or unusable.
double? _sideOf(Object? value) {
  if (!_given(value)) return null;
  final n = _number(value);
  if (!n.isFinite || n <= 0 || n > maxPieceInches) return null;
  return (n * 100).round() / 100;
}

/// Whether any side was typed.
bool pieceSizeGiven(Object? raw) {
  final size = _asRow(raw);
  return [size['l'], size['w'], size['h']].any(_given);
}

/// `{l, w, h}` in inches, or null unless all three are usable.
PieceSize? pieceSizeOf(Object? raw) {
  final size = _asRow(raw);
  final sides = [size['l'], size['w'], size['h']].map(_sideOf).toList();
  if (sides.any((side) => side == null)) return null;
  return PieceSize(sides[0]!, sides[1]!, sides[2]!);
}

/// Whole cents (zero allowed), or null when blank or not a price.
int? piecePriceOf(Object? value) {
  if (!_given(value)) return null;
  final n = _number(value);
  return _isInteger(n) && n >= 0 && n <= _maxCents ? n.toInt() : null;
}

/// A piece kind; anything unknown reads as "other".
String pieceKindOf(Object? value) {
  final kind = _text(value, 20).toLowerCase();
  if (kind == carPieceKind) return carPieceKind;
  return pieceKinds.contains(kind) ? kind : pieceKind.other;
}

/// Every problem with the pieces a request sends, each code once.
List<String> pieceErrors(Object? raw, [int max = maxPieces]) {
  if (raw is! List || raw.isEmpty) return const ['pieces_required'];
  final errors = <String>{};
  if (raw.length > max) errors.add('pieces_too_many');
  for (final item in raw) {
    final piece = _asRow(item);
    final kind = _text(piece['kind'], 20).toLowerCase();
    if (!pieceKinds.contains(kind)) errors.add('piece_kind_invalid');
    final description = _string(piece['description']).trim();
    if (description.length > maxPieceDescription) {
      errors.add('piece_description_too_long');
    }
    // A barrel is a barrel; a box or an item has to say what it is.
    if (kind != pieceKind.barrel &&
        pieceKinds.contains(kind) &&
        description.isEmpty) {
      errors.add('piece_description_required');
    }
    if (pieceSizeGiven(piece['sizeIn']) &&
        pieceSizeOf(piece['sizeIn']) == null) {
      errors.add('piece_size_invalid');
    }
    if (_given(piece['priceCents']) &&
        piecePriceOf(piece['priceCents']) == null) {
      errors.add('piece_price_invalid');
    }
  }
  return errors.toList();
}

/// The pieces as stored: kind, description, size and price cleaned, and an
/// id each. A usable id that is not a repeat is kept (an edit keeps its
/// pieces); any other gets the first free `p<n>`.
List<LinePiece> normalizePieces(Object? raw) {
  final list = _list(raw);
  final used = <String>{};
  final kept = [
    for (final item in list)
      () {
        final id = _text(_asRow(item)['id'], 40);
        if (_pieceId.hasMatch(id) && !used.contains(id)) {
          used.add(id);
          return id;
        }
        return '';
      }(),
  ];
  var next = 1;
  String freshId() {
    while (used.contains('p$next')) {
      next += 1;
    }
    final id = 'p$next';
    used.add(id);
    return id;
  }

  return [
    for (var i = 0; i < list.length; i++)
      () {
        final piece = _asRow(list[i]);
        return LinePiece(
          id: kept[i].isNotEmpty ? kept[i] : freshId(),
          kind: pieceKindOf(piece['kind']),
          description: _text(piece['description'], maxPieceDescription),
          sizeIn: pieceSizeOf(piece['sizeIn']),
          priceCents: piecePriceOf(piece['priceCents']),
        );
      }(),
  ];
}

/// A total spread over [count] pieces as evenly as cents allow, the odd
/// cents on the first ones: $100 over 3 is 33.34, 33.33, 33.33.
List<int?> distributeCents(int? total, int count) {
  final n = math.max(0, count);
  if (total == null) return List<int?>.filled(n, null);
  if (n == 0) return const [];
  final base = (total / n).floor();
  final rest = total - base * n;
  return [for (var i = 0; i < n; i++) base + (i < rest ? 1 : 0)];
}

PieceSize? _lineSize(Map<Object?, Object?> line) => pieceSizeOf({
  'l': line['lengthIn'],
  'w': line['widthIn'],
  'h': line['heightIn'],
});

/// A line's price as stored: whole cents above zero, else null.
int? linePriceOf(Object? value) {
  if (!_given(value)) return null;
  final n = _number(value);
  return _isInteger(n) && n > 0 && n <= _maxCents ? n.toInt() : null;
}

/// Whether a line carries its own pieces (not a car, not a legacy line).
bool lineHasPieces(Object? line) {
  final row = _asRow(line);
  final pieces = row['pieces'];
  return _text(row['kind'], 20) != 'car' && pieces is List && pieces.isNotEmpty;
}

/// The pieces of any line, old or new. A car is one car piece carrying the
/// line's price; a legacy line expands its quantity, its price spread over
/// the pieces so the total still reads the same.
List<LinePiece> linePieces(Object? line) {
  final row = _asRow(line);
  final kind = _text(row['kind'], 20);
  if (kind == 'car') {
    return [
      LinePiece(
        id: 'car',
        kind: carPieceKind,
        sizeIn: _lineSize(row),
        priceCents: linePriceOf(row['priceCents']),
      ),
    ];
  }
  if (lineHasPieces(row)) return normalizePieces(row['pieces']);
  final quantity = _positiveInt(row['quantity']);
  final count = math.min(maxLegacyPieces, quantity > 0 ? quantity : 1);
  final kindOfPiece = kind == 'barrels' ? pieceKind.barrel : pieceKind.other;
  final description = kindOfPiece == pieceKind.other
      ? _text(row['description'], maxPieceDescription)
      : '';
  final size = _lineSize(row);
  final prices = distributeCents(linePriceOf(row['priceCents']), count);
  return [
    for (var i = 0; i < prices.length; i++)
      LinePiece(
        id: 'p${i + 1}',
        kind: kindOfPiece,
        description: description,
        sizeIn: size,
        priceCents: prices[i],
      ),
  ];
}

/// The counts every line carries, so volume can be counted without reading
/// pieces: all pieces, barrels, packages (box + other), cars.
PieceCounts pieceCounts(Object? pieces) {
  var pieceCount = 0, barrels = 0, packages = 0, cars = 0;
  for (final piece in _list(pieces)) {
    final kind = _text(_asRow(piece)['kind'], 20);
    pieceCount += 1;
    if (kind == carPieceKind) {
      cars += 1;
    } else if (kind == pieceKind.barrel) {
      barrels += 1;
    } else {
      packages += 1;
    }
  }
  return PieceCounts(
    pieceCount: pieceCount,
    barrelPieces: barrels,
    packagePieces: packages,
    carPieces: cars,
  );
}

/// A line's counts ([pieceCounts]), legacy lines included.
PieceCounts lineCounts(Object? line) => pieceCounts(linePieces(line));

/// The line total: the sum of the priced pieces, or null while none has a
/// price (or they add up to nothing).
int? piecesTotalCents(Object? pieces) {
  var total = 0;
  var priced = false;
  for (final piece in _list(pieces)) {
    final cents = piecePriceOf(_asRow(piece)['priceCents']);
    if (cents == null) continue;
    priced = true;
    total += cents;
  }
  return priced && total > 0 ? math.min(total, _maxCents) : null;
}

const _kindNames = {
  'barrel': 'Barrel',
  'box': 'Box',
  'other': 'Item',
  'car': 'Car',
};

/// The summary fields older app versions read: `kind` "barrels" when every
/// piece is a barrel, else "other"; `quantity` the piece count; and a
/// description naming what is there ("Barrel, Clothes, TV").
PiecesSummary piecesSummaryFields(Object? pieces) {
  final list = _list(pieces);
  final allBarrels =
      list.isNotEmpty &&
      list.every((p) => _asRow(p)['kind'] == pieceKind.barrel);
  final names = <String>[];
  for (final piece in list) {
    final row = _asRow(piece);
    final described = _text(row['description'], maxPieceDescription);
    final name = described.isNotEmpty
        ? described
        : (_kindNames[_string(row['kind'])] ?? _kindNames['other']!);
    if (!names.contains(name)) names.add(name);
  }
  return PiecesSummary(
    kind: allBarrels ? 'barrels' : 'other',
    quantity: list.length,
    description: allBarrels ? '' : _text(names.join(', '), 120),
  );
}

/// Everything a line stores about its pieces, from validated pieces: the
/// pieces, the counts, the summary for old apps, the total, and - for a
/// single piece - its size as the line's size.
Map<String, Object?> piecesLineFields(Object? raw) {
  final pieces = normalizePieces(raw);
  final single = pieces.length == 1 ? pieces[0].sizeIn : null;
  return {
    'pieces': [for (final p in pieces) p.toMap()],
    ...pieceCounts(pieces).toMap(),
    ...piecesSummaryFields(pieces).toMap(),
    'priceCents': piecesTotalCents(pieces),
    'lengthIn': single?.l,
    'widthIn': single?.w,
    'heightIn': single?.h,
  };
}

// ---------------------------------------------------------------------------
// Saying what is there.
// ---------------------------------------------------------------------------

String _plural(int n, String one, String many) => '$n ${n == 1 ? one : many}';

/// "2 barrels, 1 box" / "2 fûts, 1 colis". Items that all say the same
/// thing are named ("2 × TV"); a mix of items is counted. The server's
/// words, for WhatsApp and the History; the app's own screens say it in its
/// catalog (containers_screen.dart `containerPiecesSummary`).
String pieceSummaryText(Object? pieces, [String language = 'en']) {
  final fr = language == 'fr';
  final list = [for (final p in _list(pieces)) _asRow(p)];
  List<Map<Object?, Object?>> of(String kind) => [
    for (final p in list)
      if (p['kind'] == kind) p,
  ];
  final parts = <String>[];
  final cars = of(carPieceKind).length;
  if (cars > 0) {
    parts.add(
      fr
          ? _plural(cars, 'véhicule', 'véhicules')
          : _plural(cars, 'car', 'cars'),
    );
  }
  final barrels = of(pieceKind.barrel).length;
  if (barrels > 0) {
    parts.add(
      fr
          ? _plural(barrels, 'fût', 'fûts')
          : _plural(barrels, 'barrel', 'barrels'),
    );
  }
  final boxes = of(pieceKind.box).length;
  if (boxes > 0) {
    parts.add(fr ? '$boxes colis' : _plural(boxes, 'box', 'boxes'));
  }
  final items = of(pieceKind.other);
  if (items.isNotEmpty) {
    final names = {
      for (final p in items) _text(p['description'], maxPieceDescription),
    }.toList();
    if (names.length == 1 && names[0].isNotEmpty) {
      parts.add(items.length == 1 ? names[0] : '${items.length} × ${names[0]}');
    } else {
      parts.add(
        fr
            ? _plural(items.length, 'article', 'articles')
            : _plural(items.length, 'item', 'items'),
      );
    }
  }
  return parts.join(', ');
}

/// The "what" of a message about a line with pieces: when its group has more
/// than one part, which share of the whole this part is ("2 of your 4
/// pieces" / "2 de vos 4 colis"); otherwise the piece summary.
String linePiecesWhat(Object? line, [String language = 'en', Object? group]) {
  final pieces = linePieces(line);
  final g = _asRow(group);
  final total = _positiveInt(g['pieceCount']);
  if (_positiveInt(g['partCount']) > 1 && total > pieces.length) {
    return language == 'fr'
        ? '${pieces.length} de vos $total colis'
        : '${pieces.length} of your $total pieces';
  }
  return pieceSummaryText(pieces, language);
}

/// A piece as its label names it: "Barrel", "Box", or what it is.
String pieceLabelName(Object? piece) {
  final row = _asRow(piece);
  final description = _text(row['description'], 80);
  if (row['kind'] == pieceKind.barrel) {
    return description.isNotEmpty ? 'Barrel · $description' : 'Barrel';
  }
  if (row['kind'] == pieceKind.box) {
    return description.isNotEmpty ? description : 'Box';
  }
  return description.isNotEmpty ? description : 'Package';
}

/// "40 × 30 × 20 in", or "" without a full size.
String pieceSizeText(Object? piece) {
  final size = pieceSizeOf(_asRow(piece)['sizeIn']);
  return size == null
      ? ''
      : '${_numberText(size.l)} × ${_numberText(size.w)} × '
            '${_numberText(size.h)} in';
}

// ---------------------------------------------------------------------------
// Groups: a line and the parts split from it.
// ---------------------------------------------------------------------------

/// The root of a line's group: its own id when it is the root or was never
/// split.
String groupRootId(Object? line, Object? id) {
  final root = _text(_asRow(line)['rootLineId'], 200);
  return root.isNotEmpty ? root : _text(id, 200);
}

/// A line's place in its group: 1 for the root.
int partIndexOf(Object? line) {
  final index = _positiveInt(_asRow(line)['partIndex']);
  return index > 0 ? index : 1;
}

/// What a group adds up to: every part's pieces and price, and what the root
/// has been paid (payments live on the root). Parts in part order.
/// [entries] are `{id, line}` maps or [LineGroupEntry]s.
LineGroupSummary lineGroupSummary(Object? entries, Object? rootId) {
  final root = _text(rootId, 200);
  final rows = [
    for (final entry in _list(entries))
      (
        id: _text(_asRow(entry)['id'], 200),
        line: _asRow(_asRow(entry)['line']),
      ),
  ].where((e) => e.id.isNotEmpty && groupRootId(e.line, e.id) == root);
  final seen = <String>{};
  final parts = <LineGroupPart>[];
  var total = 0;
  var priced = false;
  var paid = 0;
  var payOnArrival = false;
  for (final (:id, :line) in rows) {
    if (seen.contains(id)) continue;
    seen.add(id);
    final price = linePriceOf(line['priceCents']);
    if (price != null) {
      priced = true;
      total += price;
    }
    if (id == root) {
      final raw = _number(
        line.containsKey('paidCents') ? line['paidCents'] : double.nan,
      );
      final p = raw.isFinite ? raw.round() : 0;
      paid = p > 0 ? math.min(p, _maxCents) : 0;
      payOnArrival = line['payOnArrival'] == true;
    }
    parts.add(
      LineGroupPart(
        id: id,
        trackingCode: _text(line['trackingCode'], 40),
        partIndex: id == root ? 1 : partIndexOf(line),
        pieceCount: lineCounts(line).pieceCount,
        priceCents: price,
        containerId: _text(line['containerId'], 200),
        containerStatus: _text(line['containerStatus'], 20),
      ),
    );
  }
  parts.sort((a, b) {
    final byIndex = a.partIndex.compareTo(b.partIndex);
    return byIndex != 0 ? byIndex : a.trackingCode.compareTo(b.trackingCode);
  });
  final priceCents = priced && total > 0 ? math.min(total, _maxCents) : null;
  return LineGroupSummary(
    rootLineId: root,
    partCount: parts.length,
    pieceCount: parts.fold(0, (sum, part) => sum + part.pieceCount),
    priceCents: priceCents,
    paidCents: paid,
    balanceCents: priceCents == null ? 0 : math.max(0, priceCents - paid),
    payOnArrival: payOnArrival,
    parts: parts,
  );
}

/// What a price check on one line of a group compares against: the root's
/// payments, less what the other parts already cover. A line alone (or a
/// part of an unpaid group) has its own paid amount.
int paidFloorForLine(Object? group, Object? lineId) {
  final g = _asRow(group);
  var others = 0.0;
  for (final part in _list(g['parts'])) {
    final row = _asRow(part);
    if (row['id'] == lineId) continue;
    final price = row['priceCents'];
    if (price is num && price.isFinite) others += price;
  }
  final paid = _number(g['paidCents']);
  return math.max(0, (paid.isFinite ? paid : 0) - others).round();
}

/// How a waiting line splits when only [count] of its pieces go: the first
/// [count] stay on the line (and ride), the rest become a new part. A null
/// (or blank) count is all of them.
PieceSplit splitPieces(Object? line, Object? count) {
  final pieces = linePieces(line);
  if (count == null || count == '') {
    return PieceSplit(
      error: null,
      split: false,
      going: pieces,
      staying: const [],
    );
  }
  final n = _number(count);
  if (!_isInteger(n) || n < 1 || n > pieces.length) {
    return PieceSplit(
      error: 'piece_count_invalid',
      split: false,
      going: pieces,
      staying: const [],
    );
  }
  if (n == pieces.length) {
    return PieceSplit(
      error: null,
      split: false,
      going: pieces,
      staying: const [],
    );
  }
  final cut = n.toInt();
  return PieceSplit(
    error: null,
    split: true,
    going: pieces.sublist(0, cut),
    staying: pieces.sublist(cut),
  );
}

/// The next part's number: one past every part the group has had (the root
/// remembers the highest, so a cancelled part's code is never reused).
int nextPartIndex(Object? root, Object? groupLines) {
  var highest = math.max(1, _positiveInt(_asRow(root)['lastPartIndex']));
  for (final line in _list(groupLines)) {
    highest = math.max(highest, partIndexOf(line));
  }
  return highest + 1;
}

/// CL-K7M4P2 and 2: CL-K7M4P2-2.
String partTrackingCode(Object? rootCode, Object? index) =>
    '${_text(rootCode, 40).toUpperCase()}-${_positiveInt(index)}';

/// counter, request or card_order (counter by default).
String lineSourceOf(Object? value) {
  final source = _text(value, 20);
  return lineSources.contains(source) ? source : 'counter';
}

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/line_pieces.dart';

/// The app's mirror of `functions/line_pieces.js`. The server, the console
/// and the app each run every case of the shared fixture
/// (`functions/test/fixtures/line-pieces-cases.json`) and must produce exactly
/// its `expected` - so a rule changed in one place and not the others fails
/// here, not at a counter.

/// The fixture's JSON has no "undefined", and whole numbers have no ".0":
/// what the Dart side returns is turned into the same JSON before comparing.
Object? _plain(Object? value) {
  if (value == null) return null;
  if (value is double) {
    return value.isFinite && value == value.truncateToDouble()
        ? value.toInt()
        : value;
  }
  if (value is List) return [for (final v in value) _plain(v)];
  if (value is Map) {
    return {for (final e in value.entries) e.key.toString(): _plain(e.value)};
  }
  if (value is LinePiece) return _plain(value.toMap());
  if (value is PieceCounts) return _plain(value.toMap());
  if (value is PiecesSummary) return _plain(value.toMap());
  if (value is LineGroupSummary) return _plain(value.toMap());
  if (value is PieceSplit) return _plain(value.toMap());
  if (value is PieceSize) return _plain(value.toMap());
  return value;
}

int _int(Object? v) => (v as num).toInt();

/// Each shared rule, called the way the JavaScript is called with the
/// fixture's arguments.
final Map<String, Object? Function(List<Object?>)> _rules = {
  'pieceSizeOf': (a) => pieceSizeOf(a[0]),
  'pieceSizeGiven': (a) => pieceSizeGiven(a[0]),
  'piecePriceOf': (a) => piecePriceOf(a[0]),
  'pieceKindOf': (a) => pieceKindOf(a[0]),
  'pieceErrors': (a) =>
      a.length > 1 ? pieceErrors(a[0], _int(a[1])) : pieceErrors(a[0]),
  'normalizePieces': (a) => normalizePieces(a[0]),
  'distributeCents': (a) =>
      distributeCents(a[0] == null ? null : _int(a[0]), _int(a[1])),
  'linePriceOf': (a) => linePriceOf(a[0]),
  'lineHasPieces': (a) => lineHasPieces(a[0]),
  'linePieces': (a) => linePieces(a[0]),
  'pieceCounts': (a) => pieceCounts(a[0]),
  'lineCounts': (a) => lineCounts(a[0]),
  'piecesTotalCents': (a) => piecesTotalCents(a[0]),
  'piecesSummaryFields': (a) => piecesSummaryFields(a[0]),
  'piecesLineFields': (a) =>
      a.length > 1 ? piecesLineFields(a[0], a[1]) : piecesLineFields(a[0]),
  'pickupFeeOf': (a) => pickupFeeOf(a[0]),
  'pickupFeeErrors': (a) => pickupFeeErrors(a[0]),
  'linePickupFeeCents': (a) => linePickupFeeCents(a[0]),
  'lineHasPickupFee': (a) => lineHasPickupFee(a[0]),
  'lineTotalCents': (a) =>
      a.length > 1 ? lineTotalCents(a[0], a[1]) : lineTotalCents(a[0]),
  'pieceSummaryText': (a) => a.length > 1
      ? pieceSummaryText(a[0], a[1] as String)
      : pieceSummaryText(a[0]),
  'linePiecesWhat': (a) => linePiecesWhat(
        a[0],
        a.length > 1 ? a[1] as String : 'en',
        a.length > 2 ? a[2] : null,
      ),
  'pieceLabelName': (a) => pieceLabelName(a[0]),
  'pieceSizeText': (a) => pieceSizeText(a[0]),
  'groupRootId': (a) => groupRootId(a[0], a.length > 1 ? a[1] : null),
  'partIndexOf': (a) => partIndexOf(a[0]),
  'lineGroupSummary': (a) => lineGroupSummary(a[0], a[1]),
  'paidFloorForLine': (a) => paidFloorForLine(a[0], a[1]),
  'splitPieces': (a) => splitPieces(a[0], a.length > 1 ? a[1] : null),
  'nextPartIndex': (a) => nextPartIndex(a[0], a[1]),
  'partTrackingCode': (a) => partTrackingCode(a[0], a[1]),
  'lineSourceOf': (a) => lineSourceOf(a[0]),
};

void main() {
  final fixture = jsonDecode(
    File('functions/test/fixtures/line-pieces-cases.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  final cases = (fixture['cases'] as List).cast<Map<String, dynamic>>();

  group('the shared line-pieces cases', () {
    test('there are cases, and every rule they name has a mirror', () {
      expect(cases.length, greaterThan(50));
      for (final c in cases) {
        expect(_rules.containsKey(c['fn']), isTrue,
            reason: '${c['fn']} has no Dart mirror');
      }
    });

    for (final c in cases) {
      test('${c['fn']}: ${c['note']}', () {
        final rule = _rules[c['fn']]!;
        final args = (c['args'] as List).cast<Object?>();
        expect(_plain(rule(args)), equals(_plain(c['expected'])));
      });
    }
  });

  test('every export of line_pieces.js has a Dart mirror of the same name', () {
    final js = File('functions/line_pieces.js').readAsStringSync();
    final dart = File('lib/services/line_pieces.dart').readAsStringSync();
    final exports = js.substring(js.indexOf('module.exports = {'));
    final names = RegExp(r'^\s+([A-Za-z_]+),$', multiLine: true)
        .allMatches(exports.substring(0, exports.indexOf('};')))
        .map((m) => m.group(1)!)
        .toList();
    expect(names, contains('lineGroupSummary'));
    expect(names.length, greaterThan(30));
    // PIECE_KIND -> pieceKind, MAX_PIECES -> maxPieces: constants are
    // lowerCamel in Dart; functions keep their names.
    String dartName(String name) {
      if (name != name.toUpperCase()) return name;
      final words = name.toLowerCase().split('_');
      return words.first +
          words.skip(1).map((w) => w[0].toUpperCase() + w.substring(1)).join();
    }

    for (final name in names) {
      final mirror = dartName(name);
      final declared = RegExp('(^|\\s)${RegExp.escape(mirror)}(\\s*=|\\()',
              multiLine: true)
          .hasMatch(dart);
      expect(declared, isTrue, reason: '$name has no Dart mirror ($mirror)');
      expect(_rules.containsKey(mirror) || name == name.toUpperCase(), isTrue,
          reason: '$mirror is not exercised by this test');
    }
    // The same limits, not merely the same names.
    expect(js, contains('const MAX_PIECES = $maxPieces;'));
    expect(js, contains('const MAX_LEGACY_PIECES = $maxLegacyPieces;'));
    expect(js, contains('const MAX_PIECE_DESCRIPTION = $maxPieceDescription;'));
    expect(js, contains('const MAX_PIECE_INCHES = $maxPieceInches;'));
    expect(js, contains(r'const PIECE_ID = /^[A-Za-z0-9_-]{1,40}$/;'));
    expect(dart, contains(r"RegExp(r'^[A-Za-z0-9_-]{1,40}$')"));
    for (final source in lineSources) {
      expect(js, contains('"$source"'));
    }
  });

  group('beyond the fixture', () {
    test('a typed size reads like the server reads it', () {
      expect(pieceSizeOf({'l': '20.555', 'w': '10', 'h': 10})!.toMap(),
          {'l': 20.56, 'w': 10.0, 'h': 10.0});
      expect(pieceSizeOf({'l': '20,5', 'w': 1, 'h': 1}), isNull,
          reason: 'a comma is not a number to the server');
      expect(pieceSizeText({'sizeIn': {'l': 40, 'w': 30.5, 'h': 20}}),
          '40 × 30.5 × 20 in');
    });

    test('typed pieces and stored pieces count the same', () {
      final pieces = normalizePieces([
        const LinePiece(id: 'a', kind: 'barrel', priceCents: 9000),
        {'kind': 'box', 'description': 'Clothes', 'priceCents': 6000},
      ]);
      expect(pieces.map((p) => p.id), ['a', 'p1']);
      expect(piecesTotalCents(pieces), 15000);
      expect(pieceCounts(pieces).toMap(), {
        'pieceCount': 2,
        'barrelPieces': 1,
        'packagePieces': 1,
        'carPieces': 0,
      });
    });

    test('a group summary reads typed entries too', () {
      final summary = lineGroupSummary([
        const LineGroupEntry('root', {
          'trackingCode': 'CL-K7M4P2',
          'priceCents': 10000,
          'paidCents': 4000,
          'kind': 'barrels',
          'quantity': 2,
        }),
        const LineGroupEntry('part', {
          'rootLineId': 'root',
          'partIndex': 2,
          'trackingCode': 'CL-K7M4P2-2',
          'priceCents': 5000,
          'paidCents': 999,
          'kind': 'barrels',
          'quantity': 1,
        }),
      ], 'root');
      expect(summary.partCount, 2);
      expect(summary.priceCents, 15000);
      expect(summary.paidCents, 4000, reason: 'only the root holds payments');
      expect(summary.balanceCents, 11000);
      expect(summary.parts.map((p) => p.trackingCode),
          ['CL-K7M4P2', 'CL-K7M4P2-2']);
    });
  });
}

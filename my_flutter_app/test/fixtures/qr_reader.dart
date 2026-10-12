/// A small, independent QR reader for tests: reads a version 6 code (41 x 41
/// modules, which every product tag link is) straight from its modules, the
/// way a scanner does after it has found the grid - format information,
/// unmasking, the zig-zag data walk, block de-interleaving, a Reed-Solomon
/// syndrome check on every block, then the byte-mode payload.
///
/// It shares no code with the encoder (`package:qr`), so a matrix that reads
/// back to the product link here is a QR a phone camera can read.
library;

import 'dart:convert';

class QrRead {
  const QrRead(this.text, this.errorLevel, this.mask);

  final String text;

  /// 'L', 'M', 'Q' or 'H'.
  final String errorLevel;
  final int mask;
}

/// Reads [dark] (row-major, [n] x [n]). Throws [FormatException] when the
/// code is not a clean, error-free version 6 QR.
QrRead readQr(int n, bool Function(int row, int col) dark) {
  if (n != 41) throw FormatException('only version 6 (41 modules), got $n');

  // Format information, first copy, most significant bit first.
  const formatCells = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], //
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  var raw = 0;
  for (final cell in formatCells) {
    raw = (raw << 1) | (dark(cell[0], cell[1]) ? 1 : 0);
  }
  final format = raw ^ 0x5412;
  if (_bchRemainder(format >> 10) != (format & 0x3FF)) {
    throw const FormatException('format information fails its BCH check');
  }
  final level = const ['M', 'L', 'H', 'Q'][format >> 13];
  final mask = (format >> 10) & 0x7;

  bool reserved(int r, int c) {
    if (r <= 8 && c <= 8) return true; // top-left finder + format
    if (r <= 8 && c >= n - 8) return true; // top-right finder + format
    if (r >= n - 8 && c <= 8) return true; // bottom-left + dark module
    if (r == 6 || c == 6) return true; // timing
    if (r >= 32 && r <= 36 && c >= 32 && c <= 36) return true; // alignment
    return false;
  }

  bool masked(int i, int j) => switch (mask) {
    0 => (i + j) % 2 == 0,
    1 => i % 2 == 0,
    2 => j % 3 == 0,
    3 => (i + j) % 3 == 0,
    4 => ((i ~/ 2) + (j ~/ 3)) % 2 == 0,
    5 => (i * j) % 2 + (i * j) % 3 == 0,
    6 => ((i * j) % 2 + (i * j) % 3) % 2 == 0,
    _ => ((i + j) % 2 + (i * j) % 3) % 2 == 0,
  };

  final bits = <int>[];
  var upward = true;
  for (var col = n - 1; col > 0; col -= 2) {
    if (col == 6) col = 5;
    for (var k = 0; k < n; k++) {
      final r = upward ? n - 1 - k : k;
      for (final c in [col, col - 1]) {
        if (reserved(r, c)) continue;
        bits.add((dark(r, c) ^ masked(r, c)) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  final codewords = <int>[
    for (var i = 0; i + 8 <= bits.length; i += 8)
      bits.sublist(i, i + 8).fold<int>(0, (a, b) => (a << 1) | b),
  ];

  // Version 6 block structure per level: (blocks, data per block, ec per block).
  final (blocks, dataLen, ecLen) = switch (level) {
    'L' => (2, 68, 18),
    'M' => (4, 27, 16),
    'Q' => (4, 19, 24),
    _ => (4, 15, 28),
  };
  if (codewords.length < blocks * (dataLen + ecLen)) {
    throw const FormatException('too few codewords');
  }
  final blockData = List.generate(blocks, (_) => <int>[]);
  final blockEc = List.generate(blocks, (_) => <int>[]);
  var p = 0;
  for (var i = 0; i < dataLen; i++) {
    for (var b = 0; b < blocks; b++) {
      blockData[b].add(codewords[p++]);
    }
  }
  for (var i = 0; i < ecLen; i++) {
    for (var b = 0; b < blocks; b++) {
      blockEc[b].add(codewords[p++]);
    }
  }
  for (var b = 0; b < blocks; b++) {
    if (!_syndromesZero([...blockData[b], ...blockEc[b]], ecLen)) {
      throw FormatException('block $b fails its Reed-Solomon check');
    }
  }

  final data = blockData.expand((d) => d).toList();
  final stream = <int>[
    for (final byte in data)
      for (var k = 7; k >= 0; k--) (byte >> k) & 1,
  ];
  var q = 0;
  int take(int count) {
    var v = 0;
    for (var i = 0; i < count; i++) {
      v = (v << 1) | stream[q++];
    }
    return v;
  }

  final modeBits = take(4);
  if (modeBits != 0x4) throw FormatException('not byte mode: $modeBits');
  final length = take(8);
  final bytes = [for (var i = 0; i < length; i++) take(8)];
  return QrRead(utf8.decode(bytes), level, mask);
}

int _bchRemainder(int data) {
  var v = data << 10;
  const g = 0x537;
  for (var i = 14; i >= 10; i--) {
    if ((v >> i) & 1 == 1) v ^= g << (i - 10);
  }
  return v;
}

final List<int> _exp = () {
  final t = List<int>.filled(512, 0);
  var x = 1;
  for (var i = 0; i < 255; i++) {
    t[i] = x;
    x <<= 1;
    if (x & 0x100 != 0) x ^= 0x11D;
  }
  for (var i = 255; i < 512; i++) {
    t[i] = t[i - 255];
  }
  return t;
}();

final List<int> _log = () {
  final t = List<int>.filled(256, 0);
  for (var i = 0; i < 255; i++) {
    t[_exp[i]] = i;
  }
  return t;
}();

int _mul(int a, int b) => a == 0 || b == 0 ? 0 : _exp[_log[a] + _log[b]];

/// Every syndrome S_j = c(alpha^j), j = 0..ecLen-1, is zero for a codeword
/// with no errors (generator roots alpha^0..alpha^(ecLen-1)).
bool _syndromesZero(List<int> block, int ecLen) {
  for (var j = 0; j < ecLen; j++) {
    var s = 0;
    final alphaJ = _exp[j];
    for (final c in block) {
      s = _mul(s, alphaJ) ^ c;
    }
    if (s != 0) return false;
  }
  return true;
}

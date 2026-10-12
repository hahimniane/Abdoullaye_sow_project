import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/tag_labels.dart';

import 'fixtures/qr_reader.dart';

/// `test/fixtures/m221_pack_fixture.json` was produced by the developer's
/// reference tool (`laawol-deploy-logs/m221/m221.py`, its pure `render_tag`
/// and `pack` - no Bluetooth) with the script in the fixture's `source`
/// field. Regenerate it only from that tool, never from this code.
Map<String, Object?> _fixture() =>
    jsonDecode(File('test/fixtures/m221_pack_fixture.json').readAsStringSync())
        as Map<String, Object?>;

QrMatrix _segnoMatrix(Map<String, Object?> fixture, String link) {
  final matrices = fixture['matrices'] as Map<String, Object?>;
  final entry = matrices[link] as Map<String, Object?>;
  return QrMatrix.fromRows((entry['rows'] as List).cast<String>());
}

void main() {
  final fixture = _fixture();
  const link = 'https://customer.laawoldigital.com/i/IT-GHQMSJ';

  group('raster packing matches the reference tool byte for byte', () {
    final qr = _segnoMatrix(fixture, link);
    final label = TagLabelSize.twoByOne;

    test('the reference QR is the fixed 41 x 41 module code', () {
      expect(qr.size, 41);
      expect(label.widthDots, 406);
      expect(label.heightDots, 203);
      expect(tagModuleDots(qr.size, 406, 203), 4);
    });

    for (final raw in fixture['cases'] as List) {
      final c = raw as Map<String, Object?>;
      final x = c['x'] as int;
      final y = c['y'] as int;
      test('x $x, y $y', () {
        final image = renderTagBitmap(qr, label.widthDots, label.heightDots);
        final packed = packRaster(image, x, y);
        expect(packed.widthBytes, c['widthBytes']);
        expect(packed.rows, c['rows']);
        final expected = base64Decode(c['data'] as String);
        expect(packed.data.length, expected.length);
        expect(packed.data, orderedEquals(expected));
      });
    }
  });

  group('the QR', () {
    test('the test reader reads codes from an independent encoder (segno)', () {
      final matrices = fixture['matrices'] as Map<String, Object?>;
      expect(matrices.length, greaterThanOrEqualTo(4));
      for (final link in matrices.keys) {
        final theirs = _segnoMatrix(fixture, link);
        final read = readQr(theirs.size, theirs.dark);
        expect(read.text, link);
        expect(read.errorLevel, 'H');
      }
    });

    test('our QR reads back to the exact product link at level H', () {
      for (final code in ['IT-GHQMSJ', 'IT-K7M4P2', 'IT-CCCCCC', 'IT-ZZZZZZ']) {
        final link = inventoryTagLink(code);
        final qr = tagQrMatrix(link);
        final read = readQr(qr.size, qr.dark);
        expect(read.text, link);
        expect(read.errorLevel, 'H');
      }
    });

    test('the printed raster reads back to the link', () {
      final link = inventoryTagLink('IT-K7M4P2');
      final qr = tagQrMatrix(link);
      for (final size in TagLabelSize.presets) {
        final w = size.widthDots, h = size.heightDots;
        final image = renderTagBitmap(qr, w, h);
        // Sample each module's centre on the head raster, the way a scanner
        // samples the grid it found.
        final packed = packRaster(image, 7, 3);
        final mod = tagModuleDots(qr.size, w, h);
        final x0 = packed.x + (w - qr.size * mod) ~/ 2;
        final y0 = 3 + (h - qr.size * mod) ~/ 2;
        bool dark(int r, int c) {
          final x = x0 + c * mod + mod ~/ 2;
          final y = y0 + r * mod + mod ~/ 2;
          return packed.data[y * 72 + (x >> 3)] & (0x80 >> (x & 7)) != 0;
        }

        expect(readQr(qr.size, dark).text, link, reason: size.id);
      }
    });

    test('holds the product link with error correction H', () {
      final qr = tagQrMatrix(inventoryTagLink('it-ghqmsj'));
      expect(inventoryTagLink('it-ghqmsj'), link);
      // Version 6 (41 modules) at H holds 58 bytes; the 46-byte link fits.
      expect(qr.size, 41);
      // Format information (row 8, columns 0-5 and 7-8) carries the error
      // correction level: H is 10 in the two top bits once the mask
      // 101010000010010 is removed.
      final bits = <bool>[
        for (final c in [0, 1, 2, 3, 4, 5, 7, 8]) qr.dark(8, c),
        for (final r in [7, 5, 4, 3, 2, 1, 0]) qr.dark(r, 8),
      ];
      var format = 0;
      for (final b in bits) {
        format = (format << 1) | (b ? 1 : 0);
      }
      format ^= 0x5412;
      expect(format >> 13, 0x2, reason: 'error correction level H');
    });
  });

  group('commands', () {
    test('density follows round(5 + d * 1.25) as Python rounds', () {
      expect(
        [for (var d = 1; d <= 8; d++) m221DensityByte(d)],
        [
          6, 8, 9, 10, 11, 12, 14, 15, //
        ],
      );
      expect(m221DensityByte(0), 6);
      expect(m221DensityByte(99), 15);
    });

    test(
      'the label sequence is speed, density, media, header, data, footer',
      () {
        final raster = packRaster(LabelBitmap(406, 203), 0, 0);
        final steps = m221LabelSteps(raster, density: 6, speed: 5);
        expect(steps.map((s) => s.name), [
          'speed', 'density', 'media', 'header', 'raster', 'footer', //
        ]);
        expect(steps[0].bytes, [0x1B, 0x4E, 0x0D, 5]);
        expect(steps[1].bytes, [0x1B, 0x4E, 0x04, 12]);
        expect(steps[2].bytes, [0x1F, 0x11, 0x0A]);
        expect(steps[3].bytes, [0x1D, 0x76, 0x30, 0x00, 72, 0x00, 203, 0]);
        expect(steps[4].bytes.length, 72 * 203);
        expect(steps[5].bytes, [
          0x1F,
          0xF0,
          0x05,
          0x00,
          0x1F,
          0xF0,
          0x03,
          0x00,
        ]);
      },
    );

    test('a tall raster carries its row count in two bytes', () {
      expect(m221RasterHeader(72, 300), [0x1D, 0x76, 0x30, 0, 72, 0, 44, 1]);
    });

    test('chunks are at most the size asked for and keep every byte', () {
      final bytes = List<int>.generate(300, (i) => i & 0xFF);
      final chunks = m221Chunks(bytes, 128);
      expect(chunks.map((c) => c.length), [128, 128, 44]);
      expect(chunks.expand((c) => c).toList(), bytes);
      expect(m221Chunks(bytes, 0).length, 300);
    });
  });

  group('pictures', () {
    test('a negative Y offset trims rows off the top', () {
      final qr = _segnoMatrix(fixture, link);
      final image = renderTagBitmap(qr, 406, 203);
      final flat = packRaster(image, 0, 0);
      final up = packRaster(image, 0, -10);
      expect(up.rows, 193);
      expect(up.data, orderedEquals(flat.data.sublist(10 * 72)));
    });

    test('the X offset moves the label and stops at the head edges', () {
      final image = LabelBitmap(406, 203);
      expect(packRaster(image, 0, 0).x, 85);
      expect(packRaster(image, 10, 0).x, 95);
      expect(packRaster(image, -500, 0).x, 0);
      expect(packRaster(image, 500, 0).x, 170);
    });

    test('the test frame has a 3-dot border and a corner-to-corner line', () {
      final frame = renderTestFrame(406, 203);
      for (final y in [0, 1, 2, 200, 201, 202]) {
        expect(frame.black(200, y), isTrue, reason: 'row $y');
      }
      for (final x in [0, 1, 2, 403, 404, 405]) {
        expect(frame.black(x, 100), isTrue, reason: 'col $x');
      }
      expect(frame.black(3, 100), isFalse);
      expect(frame.black(405, 202), isTrue);
      expect(frame.black(203, 101), isTrue, reason: 'diagonal midpoint');
      expect(frame.black(203, 150), isFalse);
    });

    test('a 40 x 30 mm tag is centred on its label', () {
      final qr = tagQrMatrix(link);
      final size = TagLabelSize.fortyByThirty;
      expect(size.widthDots, 320);
      expect(size.heightDots, 240);
      final image = renderTagBitmap(qr, 320, 240);
      final mod = tagModuleDots(qr.size, 320, 240);
      expect(mod, 5);
      final x0 = (320 - 41 * mod) ~/ 2;
      final y0 = (240 - 41 * mod) ~/ 2;
      // Finder pattern corner is dark; just outside it is white.
      expect(image.black(x0, y0), isTrue);
      expect(image.black(x0 - 1, y0), isFalse);
      expect(image.black(x0, y0 - 1), isFalse);
    });
  });

  group('replies', () {
    test('the done frame is 1A 0F', () {
      expect(m221IsDoneFrame([0x1A, 0x0F, 0x0C]), isTrue);
      expect(m221IsDoneFrame([0x1A, 0x04, 0x5A]), isFalse);
      expect(m221IsDoneFrame([0x1A]), isFalse);
    });

    test('battery and paper hints', () {
      expect(m221BatteryPercent([0x1A, 0x04, 90]), 90);
      expect(m221BatteryPercent([0x1A, 0x04, 200]), isNull);
      expect(m221BatteryPercent([0x1A, 0x0F, 1]), isNull);
      expect(m221SaysOutOfPaper([0x1A, 0x06, 0x88]), isTrue);
      expect(m221SaysOutOfPaper([0x1A, 0x06, 0x89]), isFalse);
      expect(m221Hex([0x1A, 0x0F, 0x0C]), '1a 0f 0c');
    });
  });
}

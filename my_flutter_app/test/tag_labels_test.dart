import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/tag_labels.dart';

import 'fixtures/qr_reader.dart';

void main() {
  group('label sizes', () {
    test('the presets in millimetres, points and printer dots', () {
      expect(TagLabelSize.twoByOne.widthPt, closeTo(144, 1e-9));
      expect(TagLabelSize.twoByOne.heightPt, closeTo(72, 1e-9));
      expect(
        [for (final s in TagLabelSize.presets) (s.widthDots, s.heightDots)],
        [(406, 203), (320, 240), (400, 240)],
      );
    });

    test('a custom size is clamped to what the printer can do', () {
      final s = TagLabelSize.resolve(
        tagSizeCustom,
        customWidthMm: 200,
        customHeightMm: 3,
      );
      expect(s.widthMm, tagMaxWidthMm);
      expect(s.heightMm, tagMinMm);
      expect(TagLabelSize.resolve('nonsense'), TagLabelSize.twoByOne);
    });

    test('typed millimetres', () {
      expect(readTagMm('40', min: 15, max: 72), 40);
      expect(readTagMm('50,8', min: 15, max: 72), 50.8);
      expect(readTagMm(' 25.4 ', min: 15, max: 100), 25.4);
      expect(readTagMm('14', min: 15, max: 72), isNull);
      expect(readTagMm('73', min: 15, max: 72), isNull);
      expect(readTagMm('4O', min: 15, max: 72), isNull);
      expect(readTagMm('', min: 15, max: 72), isNull);
    });

    test('file names say the code and the size', () {
      expect(
        tagPdfFileName('it-k7m4p2', TagLabelSize.twoByOne),
        'tag-IT-K7M4P2-2x1in.pdf',
      );
      expect(
        tagPdfFileName(
          'IT-K7M4P2',
          TagLabelSize.resolve(
            tagSizeCustom,
            customWidthMm: 45.5,
            customHeightMm: 28,
          ),
        ),
        'tag-IT-K7M4P2-45_5x28mm.pdf',
      );
    });
  });

  group('the tag link', () {
    test('is the one the app reads back when a tag is scanned', () {
      final link = inventoryTagLink('it-k7m4p2');
      expect(link, 'https://customer.laawoldigital.com/i/IT-K7M4P2');
      expect(inventoryCodeFromScan(link), 'IT-K7M4P2');
    });

    test('reprinting never changes the code: same link, same QR', () {
      final a = tagQrMatrix(inventoryTagLink('IT-K7M4P2'));
      final b = tagQrMatrix(inventoryTagLink('IT-K7M4P2'));
      expect(a.toRows(), b.toRows());
      expect(readQr(a.size, a.dark).text, inventoryTagLink('IT-K7M4P2'));
    });

    test('the reader refuses a damaged code (so a pass means something)', () {
      final qr = tagQrMatrix(inventoryTagLink('IT-K7M4P2'));
      final rows = qr.toRows();
      // Flip a data module well away from the function patterns.
      final row = rows[20].split('');
      row[20] = row[20] == '1' ? '0' : '1';
      rows[20] = row.join();
      final broken = QrMatrix.fromRows(rows);
      expect(() => readQr(broken.size, broken.dark), throwsFormatException);
    });
  });

  group('the exact-size PDF', () {
    for (final size in TagLabelSize.presets) {
      test('${size.id}: the page is the label, one page per copy', () async {
        final bytes = await buildTagPdf(
          link: inventoryTagLink('IT-K7M4P2'),
          size: size,
          copies: 3,
          compress: false,
        );
        final text = latin1.decode(bytes);
        expect(text.startsWith('%PDF-1.4'), isTrue);
        expect(text, contains('/Count 3'));
        final boxes = RegExp(
          r'/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]',
        ).allMatches(text).toList();
        expect(boxes, hasLength(3));
        for (final box in boxes) {
          expect(double.parse(box.group(1)!), closeTo(size.widthPt, 0.01));
          expect(double.parse(box.group(2)!), closeTo(size.heightPt, 0.01));
        }
        // Vector rectangles ("re"), no embedded picture.
        expect(text, contains(' re'));
        expect(text, isNot(contains('/Subtype /Image')));
        expect(text, isNot(contains('/Subtype/Image')));
      });
    }

    test('the QR fills the short side with a quiet zone, centred', () {
      final layout = TagPdfLayout.of(TagLabelSize.twoByOne, 41);
      // 72 pt high, 3.6 pt clear of each edge, 45 modules incl. quiet zone.
      expect(layout.module, closeTo((72 - 7.2) / 45, 1e-9));
      final side = layout.module * 41;
      expect(layout.x0 + side / 2, closeTo(72, 1e-9));
      expect(layout.y0 + side / 2, closeTo(36, 1e-9));
    });

    test('dark runs cover exactly the dark modules', () {
      final qr = tagQrMatrix(inventoryTagLink('IT-K7M4P2'));
      final runs = qrRuns(qr);
      final covered = <int>{};
      for (final run in runs) {
        for (var c = run[1]; c < run[2]; c++) {
          covered.add(run[0] * qr.size + c);
        }
      }
      final dark = <int>{
        for (var i = 0; i < qr.modules.length; i++)
          if (qr.modules[i]) i,
      };
      expect(covered, dark);
    });
  });
}

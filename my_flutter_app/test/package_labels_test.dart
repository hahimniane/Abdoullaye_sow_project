import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/services/package_codes.dart';
import 'package:my_flutter_app/services/package_labels.dart';
import 'package:my_flutter_app/services/tag_labels.dart';

/// Package labels printed from the phone: the `getPackageLabels` request and
/// answer, the sizes, and the one layout both printers draw - which must fit
/// every size and never drop the code or a phone number.

PackageLabel _label({
  String code = 'CL-K7M4P2',
  String what = 'Barrel',
  String vin = '',
  int number = 1,
  int count = 1,
  String receiver = 'Mariama Bah',
  String receiverPhone = '+224621234567',
  String sender = 'Fatou Diallo',
  String senderPhone = '+19175551234',
  String place = 'Guinea · 40 × 30 × 20 in',
}) =>
    PackageLabel.fromMap({
      'code': code,
      'link': 'https://customer.laawoldigital.com/t/$code',
      'what': what,
      'vin': vin,
      'packageNumber': number,
      'packageCount': count,
      'receiver': receiver,
      'receiverPhone': receiverPhone,
      'sender': sender,
      'senderPhone': senderPhone,
      'place': place,
    });

const _longName =
    'Mamadou Aliou Diallo-Barry de la Grande Famille Sow de Conakry Kaloum';

const _sizes = [
  PackageLabelSizes.seventyByEighty,
  PackageLabelSizes.fiftyByEighty,
  PackageLabelSizes.sixtyTwoByHundred,
  PackageLabelSizes.fourBySix,
  TagLabelSize(tagSizeCustom, 72, 100),
  TagLabelSize(tagSizeCustom, 40, 60),
  TagLabelSize(tagSizeCustom, 15, 15),
];

void main() {
  group('the getPackageLabels request', () {
    test('a whole container', () {
      expect(
        packageLabelsRequest(businessId: ' b1 ', containerId: ' c1 '),
        {'businessId': 'b1', 'containerId': 'c1', 'copies': 2},
      );
    });

    test('one line on a container', () {
      expect(
        packageLabelsRequest(
          businessId: 'b1',
          containerId: 'c1',
          lineId: ' l7 ',
          copies: 1,
        ),
        {'businessId': 'b1', 'containerId': 'c1', 'copies': 1, 'lineId': 'l7'},
      );
    });

    test('waiting packages by line id: deduplicated, at most 100', () {
      final one = packageLabelsRequest(
        businessId: 'b1',
        containerId: '',
        lineId: 'l7',
      );
      expect(one['containerId'], '');
      expect(one['lineIds'], ['l7']);
      expect(one.containsKey('lineId'), isFalse);

      final many = packageLabelsRequest(
        businessId: 'b1',
        containerId: '',
        lineIds: [for (var i = 0; i < 130; i++) 'l${i % 120}'],
      );
      expect((many['lineIds'] as List).length, packageLabelsMaxLines);
      expect((many['lineIds'] as List).toSet().length, packageLabelsMaxLines);
    });

    test('copies are one or two, nothing else', () {
      for (final (asked, sent) in [(1, 1), (2, 2), (0, 2), (5, 2), (-1, 2)]) {
        expect(
          packageLabelsRequest(businessId: 'b', containerId: 'c', copies: asked)
              ['copies'],
          sent,
        );
      }
    });

    test('the sheet target builds the same request', () {
      const target = PackageLabelsTarget(businessId: 'b1', lineId: 'w1');
      expect(target.request(1), {
        'businessId': 'b1',
        'containerId': '',
        'copies': 1,
        'lineIds': ['w1'],
      });
    });
  });

  group('the answer', () {
    test('reads nested Object? maps, as iOS hands them over', () {
      final Map<Object?, Object?> answer = {
        'labels': <Object?>[
          <Object?, Object?>{
            'code': 'cl-k7m4p2',
            'link': 'https://customer.laawoldigital.com/t/CL-K7M4P2',
            'what': 'Barrel',
            'packageNumber': 2,
            'packageCount': 3,
            'receiver': 'Mariama Bah',
            'receiverPhone': '+224621234567',
            'destination': 'Guinea',
            'size': '40 × 30 × 20 in',
          },
          <Object?, Object?>{'what': 'no code, not a label'},
          'junk',
        ],
        'reference': 'MSKU1234567',
        'hasContainer': true,
        'businessName': 'Conakry Express',
        'businessPhone': '+19175550000',
      };
      final set = PackageLabelSet.fromResponse(answer);
      expect(set.labels, hasLength(1));
      final l = set.labels.single;
      expect(l.code, 'CL-K7M4P2');
      expect(l.packageNumber, 2);
      expect(l.packageCount, 3);
      expect(l.place, 'Guinea · 40 × 30 × 20 in',
          reason: 'built from destination and size when not sent');
      expect(set.reference, 'MSKU1234567');
      expect(set.hasContainer, isTrue);
      expect(set.businessName, 'Conakry Express');
    });

    test('a missing link is the tracking link the app reads back', () {
      final l = PackageLabel.fromMap({'code': 'CL-K7M4P2'});
      expect(l.link, 'https://customer.laawoldigital.com/t/CL-K7M4P2');
      expect(packageCodeFromScan(l.link), 'CL-K7M4P2');
    });

    test('nonsense answers are an empty set, never a crash', () {
      expect(PackageLabelSet.fromResponse(null).isEmpty, isTrue);
      expect(PackageLabelSet.fromResponse('x').isEmpty, isTrue);
      expect(PackageLabelSet.fromResponse({'labels': 'x'}).isEmpty, isTrue);
      final odd = PackageLabel.fromMap({
        'code': 'CL-K7M4P2',
        'packageNumber': 9,
        'packageCount': -2,
      });
      expect(odd.packageCount, 1);
      expect(odd.packageNumber, 1);
    });

    test('copies of one package print as one picture, repeated', () {
      final runs = packageLabelRuns([
        _label(number: 1, count: 2),
        _label(number: 1, count: 2),
        _label(number: 2, count: 2),
        _label(number: 2, count: 2),
        _label(code: 'CL-BBBBBB'),
        _label(number: 1, count: 2),
      ]);
      expect([for (final r in runs) r.copies], [2, 2, 1, 1]);
      expect(runs[1].label.packageNumber, 2);
      expect(runs[2].label.code, 'CL-BBBBBB');
    });
  });

  group('sizes', () {
    test('the label printer offers 70 x 80, 50 x 80, 62 x 100 and custom', () {
      expect([for (final s in PackageLabelSizes.presets) s.mmText],
          ['70 × 80 mm', '50 × 80 mm', '62 × 100 mm']);
      for (final s in PackageLabelSizes.presets) {
        expect(s.widthMm, lessThanOrEqualTo(tagMaxWidthMm),
            reason: 'the M221 head is 72 mm');
      }
      expect(PackageLabelSizes.resolve('nonsense'),
          PackageLabelSizes.seventyByEighty);
    });

    test('custom takes the tag clamps', () {
      final big = PackageLabelSizes.resolve(
        tagSizeCustom,
        customWidthMm: 90,
        customHeightMm: 300,
      );
      expect(big.widthMm, tagMaxWidthMm);
      expect(big.heightMm, tagMaxHeightMm);
      final small = PackageLabelSizes.resolve(
        tagSizeCustom,
        customWidthMm: 3,
        customHeightMm: 4,
      );
      expect(small.widthMm, tagMinMm);
      expect(small.heightMm, tagMinMm);
    });

    test('the package size is saved apart from the tag size', () {
      const settings = LabelPrinterSettings();
      expect(settings.packageSize, PackageLabelSizes.seventyByEighty,
          reason: 'default 70 x 80 mm');
      expect(settings.size.id, tagSize2x1in, reason: 'the tag size is untouched');

      final changed = settings.copyWith(
        packageSizeId: tagSizeCustom,
        packageWidthMm: 95,
        packageHeightMm: 60,
      );
      expect(changed.packageSize.widthMm, tagMaxWidthMm);
      expect(changed.packageSize.heightMm, 60);
      expect(changed.sizeId, tagSize2x1in);
      final back = LabelPrinterSettings.fromJson(
        jsonDecode(jsonEncode(changed.toJson())) as Map<String, Object?>,
      );
      expect(back, changed);

      // An older saved file (no package size) and a bad id fall back.
      expect(LabelPrinterSettings.fromJson({'sizeId': tagSize40x30mm})
          .packageSize, PackageLabelSizes.seventyByEighty);
      expect(LabelPrinterSettings.fromJson({'packageSizeId': 'A4'}).packageSize,
          PackageLabelSizes.seventyByEighty);
      expect(
        LabelPrinterSettings.fromJson({'packageSizeId': packageSize62x100mm})
            .packageSize,
        PackageLabelSizes.sixtyTwoByHundred,
      );
    });
  });

  group('the layout', () {
    final labels = {
      'a barrel': _label(),
      'a car': _label(
        what: '2015 Toyota Camry',
        vin: '4T1BF1FK5FU123456',
        place: 'Guinea',
      ),
      'three of a line': _label(number: 2, count: 3),
      'long names': _label(
        receiver: _longName,
        sender: _longName,
        place: 'Guinea-Bissau · 120 × 120 × 120 in, upper deck, fragile, keep dry',
      ),
      'no sender': _label(sender: '', senderPhone: ''),
      'nothing but the code': PackageLabel.fromMap({'code': 'CL-K7M4P2'}),
    };

    for (final size in _sizes) {
      for (final entry in labels.entries) {
        test('${entry.key} fits ${size.mmText}', () {
          final layout = layoutPackageLabel(
            entry.value,
            size: size,
            businessName: 'Conakry Express Shipping and Logistics International',
            businessPhone: '+19175550000',
            reference: 'MSKU1234567',
          );
          const eps = 1e-6;
          // The QR is inside the label.
          expect(layout.qrLeft, greaterThanOrEqualTo(-eps));
          expect(layout.qrTop, greaterThanOrEqualTo(-eps));
          expect(layout.qrLeft + layout.qrSide,
              lessThanOrEqualTo(size.widthMm + eps));
          // Every line is inside the label, under the QR, and none overlaps
          // the next.
          final body = [
            for (final t in layout.texts)
              if (t.part != PackageLabelPart.footer &&
                  t.part != PackageLabelPart.reference)
                t,
          ];
          var previousBottom = layout.qrTop + layout.qrSide;
          for (final t in body) {
            expect(t.left, greaterThanOrEqualTo(-eps));
            expect(t.right, lessThanOrEqualTo(size.widthMm + eps));
            expect(t.top, greaterThanOrEqualTo(previousBottom - eps),
                reason: '${t.part} overlaps what is above it');
            previousBottom = t.bottom;
          }
          final rule = layout.ruleTop!;
          expect(previousBottom, lessThanOrEqualTo(rule + eps),
              reason: 'the text runs into the footer');
          final footer = layout.part(PackageLabelPart.footer)!;
          expect(footer.top, greaterThanOrEqualTo(rule + packageLabelRuleMm - eps));
          expect(footer.bottom, lessThanOrEqualTo(size.heightMm + eps));
          final reference = layout.part(PackageLabelPart.reference)!;
          expect(reference.left, greaterThanOrEqualTo(footer.right - eps),
              reason: 'the footer halves do not overlap');
          expect(reference.right, lessThanOrEqualTo(size.widthMm + eps));

          // Never cut: the code, the VIN, both phones, the reference - their
          // full text, at a size the estimate says fits.
          for (final t in layout.texts.where((t) => t.whole)) {
            expect(
              estimatePackageTextWidth(t.text, t.fontMm, mono: t.mono),
              lessThanOrEqualTo(t.width + eps),
              reason: '${t.part} is wider than its box',
            );
          }
          final label = entry.value;
          // The code, with "· 2 of 3" when the line is several pieces.
          expect(layout.part(PackageLabelPart.code)!.text,
              label.packageCount > 1 ? 'CL-K7M4P2 · 2 of 3' : 'CL-K7M4P2');
          if (label.receiverPhone.isNotEmpty) {
            expect(layout.part(PackageLabelPart.receiverPhone)!.text,
                label.receiverPhone);
          }
          if (label.senderPhone.isNotEmpty) {
            expect(layout.part(PackageLabelPart.senderPhone)!.text,
                label.senderPhone);
          }
          expect(reference.text, 'MSKU1234567');
          // A cut line is cut to fit, with "…".
          for (final t in layout.texts.where((t) => !t.whole)) {
            expect(
              estimatePackageTextWidth(t.text, t.fontMm, mono: t.mono),
              lessThanOrEqualTo(t.width + eps),
              reason: '${t.part} "${t.text}" overflows',
            );
          }
          expect(layout.link, label.link);
        });
      }
    }

    test('on 70 x 80 the QR is on top and at least 30 mm', () {
      final layout = layoutPackageLabel(
        _label(receiver: _longName),
        size: PackageLabelSizes.seventyByEighty,
      );
      expect(layout.qrSide, greaterThanOrEqualTo(30));
      expect(layout.qrTop, lessThan(layout.part(PackageLabelPart.code)!.top));
      expect(layout.part(PackageLabelPart.code)!.mono, isTrue);
      // The code is the largest text on the label.
      final code = layout.part(PackageLabelPart.code)!.fontMm;
      for (final t in layout.texts) {
        expect(t.fontMm, lessThanOrEqualTo(code + 1e-9));
      }
      // Readable: no line under ~4 pt.
      for (final t in layout.texts) {
        expect(t.fontPt, greaterThan(4), reason: '${t.part} is unreadable');
      }
    });

    test('the 4 x 6 carries the console thermal label: 2.6 in QR', () {
      final layout = layoutPackageLabel(
        _label(),
        size: PackageLabelSizes.fourBySix,
      );
      expect(layout.qrSide, closeTo(66.04, 0.01));
      expect(layout.part(PackageLabelPart.code)!.fontPt, greaterThan(20));
    });

    test('a long name is cut with an ellipsis; the phone below it is whole', () {
      final layout = layoutPackageLabel(
        _label(receiver: _longName),
        size: PackageLabelSizes.fiftyByEighty,
      );
      final receiver = layout.part(PackageLabelPart.receiver)!;
      expect(receiver.text, endsWith('…'));
      expect(receiver.text.length, lessThan(_longName.length));
      expect(_longName, startsWith(receiver.text.replaceAll('…', '')));
      expect(layout.part(PackageLabelPart.receiverPhone)!.text,
          '+224621234567');
    });

    test('what the piece is: VIN for a car; "CODE · i of N" for several', () {
      final car = layoutPackageLabel(
        _label(what: '2015 Toyota Camry', vin: '4T1BF1FK5FU123456'),
        size: PackageLabelSizes.seventyByEighty,
      );
      expect(car.part(PackageLabelPart.vin)!.text, 'VIN 4T1BF1FK5FU123456');
      expect(car.part(PackageLabelPart.code)!.text, 'CL-K7M4P2');
      // One label per piece, numbered with the code as the server's label
      // prints it (container_labels.js "CL-K7M4P2 · 1 of 3"); the piece's
      // own name below.
      final barrels = layoutPackageLabel(
        _label(number: 2, count: 3),
        size: PackageLabelSizes.seventyByEighty,
      );
      expect(barrels.part(PackageLabelPart.code)!.text, 'CL-K7M4P2 · 2 of 3');
      expect(barrels.part(PackageLabelPart.what)!.text, 'Barrel');
      expect(barrels.part(PackageLabelPart.vin), isNull);
      final server = File('functions/container_labels.js').readAsStringSync();
      // The page prints the same words, "1 of 3" under the code.
      expect(server, contains('</i>\${escape(label.packageNumber)} of \${'));
      // Whole on every size: shrunk, never cut.
      for (final size in _sizes) {
        final layout = layoutPackageLabel(
          _label(code: 'CL-K7M4P2-12', number: 12, count: 60),
          size: size,
        );
        final code = layout.part(PackageLabelPart.code)!;
        expect(code.text, 'CL-K7M4P2-12 · 12 of 60');
        expect(code.whole, isTrue);
        expect(estimatePackageTextWidth(code.text, code.fontMm, mono: true),
            lessThanOrEqualTo(code.width + 1e-6),
            reason: '${size.id}: the code line is wider than its box');
      }
    });

    test('TO / POUR and FROM / DE; no sender, no FROM', () {
      final both = layoutPackageLabel(
        _label(),
        size: PackageLabelSizes.seventyByEighty,
      );
      expect(both.part(PackageLabelPart.toCaption)!.text, 'TO / POUR');
      expect(both.part(PackageLabelPart.fromCaption)!.text, 'FROM / DE');
      final none = layoutPackageLabel(
        _label(sender: '', senderPhone: ''),
        size: PackageLabelSizes.seventyByEighty,
      );
      expect(none.part(PackageLabelPart.fromCaption), isNull);
      expect(none.part(PackageLabelPart.sender), isNull);
      expect(none.part(PackageLabelPart.senderPhone), isNull);
    });

    test('the footer names the business and its phone, then the container', () {
      final layout = layoutPackageLabel(
        _label(),
        size: PackageLabelSizes.fourBySix,
        businessName: 'Conakry Express',
        businessPhone: '+19175550000',
        reference: 'MSKU1234567',
      );
      expect(layout.part(PackageLabelPart.footer)!.text,
          'Conakry Express · +19175550000');
      expect(layout.part(PackageLabelPart.reference)!.text, 'MSKU1234567');
      // A waiting package has no container: no reference.
      final waiting = layoutPackageLabel(
        _label(),
        size: PackageLabelSizes.fourBySix,
      );
      expect(waiting.part(PackageLabelPart.reference), isNull);
      expect(waiting.part(PackageLabelPart.footer)!.text, 'Laawol Digital');
    });

    test('never the price', () {
      final layout = layoutPackageLabel(
        _label(),
        size: PackageLabelSizes.fourBySix,
      );
      expect(layout.texts.any((t) => t.text.contains(r'$')), isFalse);
    });
  });

  group('the 4 x 6 PDF', () {
    test('one page per label, each page the 4 x 6 label', () async {
      final set = PackageLabelSet(
        labels: [_label(), _label(), _label(code: 'CL-BBBBBB')],
        reference: 'MSKU1234567',
        hasContainer: true,
        businessName: 'Conakry Express',
        businessPhone: '+19175550000',
      );
      final bytes = await buildPackageLabelsPdf(set, compress: false);
      final text = latin1.decode(bytes);
      expect(text, startsWith('%PDF'));
      expect(RegExp(r'/Type\s*/Page\b').allMatches(text).length, 3);
      // 4 x 6 in = 288 x 432 points.
      expect(text, matches(RegExp(r'/MediaBox\s*\[\s*0\s+0\s+288\s+432\s*\]')));
      expect(packageLabelsPdfName(set), 'labels-MSKU1234567.pdf');
      expect(
        packageLabelsPdfName(PackageLabelSet(labels: [_label()])),
        'labels-CL-K7M4P2.pdf',
      );
    });

    test('a name outside Latin-1 still prints, never a blank', () async {
      final bytes = await buildPackageLabelsPdf(
        PackageLabelSet(labels: [
          _label(receiver: 'محمد ديالو', sender: 'Aïssatou N’Diaye — Bah'),
        ]),
      );
      expect(bytes, isNotEmpty);
      expect(pdfSafeText('Aïssatou N’Diaye — Bah…'),
          "Aïssatou N'Diaye - Bah...");
      expect(pdfSafeText('محمد'), '????');
      expect(pdfSafeText('Guinée · 40 × 30'), 'Guinée · 40 × 30');
    });
  });
}

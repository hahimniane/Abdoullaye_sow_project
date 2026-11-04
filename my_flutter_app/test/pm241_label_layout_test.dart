import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/package_label_bitmap.dart';
import 'package:my_flutter_app/services/package_labels.dart';
import 'package:my_flutter_app/services/pm241_protocol.dart';
import 'package:my_flutter_app/services/tag_labels.dart';

/// The package label at the PM-241's 4 x 6 in size: the same layout and the
/// same content rules as every other size, drawn in 800 x 1180 dots.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final size = PackageLabelSizes.pm241FourBySix;
  final label = PackageLabel.fromMap({
    'code': 'CL-K7M4P2',
    'what': 'Barrel',
    'packageNumber': 1,
    'packageCount': 3,
    'receiver': 'Mariama Bah',
    'receiverPhone': '+224621234567',
    'sender': 'Fatou Diallo',
    'senderPhone': '+19175551234',
    'destination': 'Guinea',
    'size': 'Sea',
    'price': '\$250.00',
  });

  test('the size is 800 x 1180 dots, the picture the printer takes', () {
    expect(size.widthDots, pm241LabelWidthDots);
    expect(size.heightDots, pm241LabelHeightDots);
    expect(
      PackageLabelSizes.isKnown(size.id),
      isFalse,
      reason: 'not a size the M221 picker offers',
    );
  });

  test('the layout is the 4 x 6 one: big QR, big code, every part on it', () {
    final layout = layoutPackageLabel(
      label,
      size: size,
      businessName: 'Nensona Shipping',
      businessPhone: '+19175550100',
      reference: 'NEN-12',
    );
    expect(layout.qrSide, greaterThanOrEqualTo(60));
    final code = layout.part(PackageLabelPart.code)!;
    expect(code.text, 'CL-K7M4P2 · 1 of 3');
    expect(code.fontMm, greaterThan(6), reason: 'large enough to read across');
    expect(layout.part(PackageLabelPart.toCaption)!.text, 'TO / POUR');
    expect(layout.part(PackageLabelPart.receiverPhone)!.text, '+224621234567');
    expect(layout.part(PackageLabelPart.fromCaption)!.text, 'FROM / DE');
    expect(layout.part(PackageLabelPart.senderPhone)!.text, '+19175551234');
    expect(layout.part(PackageLabelPart.place)!.text, 'Guinea · Sea');
    expect(
      layout.part(PackageLabelPart.footer)!.text,
      'Nensona Shipping · +19175550100',
    );
    expect(layout.part(PackageLabelPart.reference)!.text, 'NEN-12');
    // Never the price.
    expect(layout.texts.any((t) => t.text.contains('250')), isFalse);
    // Everything inside the label.
    for (final t in layout.texts) {
      expect(t.left, greaterThanOrEqualTo(0));
      expect(t.right, lessThanOrEqualTo(size.widthMm + 0.001));
      expect(t.bottom, lessThanOrEqualTo(size.heightMm + 0.001));
    }
  });

  test('a long name is cut with an ellipsis, the phone and code never', () {
    final long = PackageLabel.fromMap({
      'code': 'CL-K7M4P2',
      'receiver': 'Mamadou Alpha Oumar Diallo Bah Sow Barry Camara Keita Kone',
      'receiverPhone': '+224621234567',
    });
    final layout = layoutPackageLabel(long, size: size);
    expect(layout.part(PackageLabelPart.receiver)!.text, endsWith('…'));
    expect(layout.part(PackageLabelPart.receiverPhone)!.text, '+224621234567');
    expect(layout.part(PackageLabelPart.code)!.text, 'CL-K7M4P2');
  });

  test(
    'drawn in dots: a scannable QR and ink for the code, white margins',
    () async {
      final layout = layoutPackageLabel(
        label,
        size: size,
        businessName: 'Nensona Shipping',
        reference: 'NEN-12',
      );
      final image = await renderPackageLabelBitmap(layout);
      expect(image.width, 800);
      expect(image.height, 1180);
      expect(pm241Fits(image), isTrue);
      final qr = tagQrMatrix(label.link);
      final at = packageQrPlacement(layout, qr.size);
      expect(
        at.module,
        greaterThanOrEqualTo(8),
        reason: 'a big QR: 8+ dots a module',
      );
      for (var r = 0; r < qr.size; r++) {
        for (var c = 0; c < qr.size; c++) {
          final x = at.x0 + c * at.module + at.module ~/ 2;
          final y = at.y0 + r * at.module + at.module ~/ 2;
          expect(image.black(x, y), qr.dark(r, c), reason: 'module $r,$c');
        }
      }
      final code = layout.part(PackageLabelPart.code)!;
      var ink = 0;
      for (var y = (code.top * 8).floor(); y < (code.bottom * 8).ceil(); y++) {
        for (var x = 0; x < image.width; x++) {
          if (image.black(x, y)) ink++;
        }
      }
      expect(ink, greaterThan(0));
      for (var y = 0; y < image.height; y++) {
        expect(image.black(0, y), isFalse);
        expect(image.black(image.width - 1, y), isFalse);
      }
      // The job for it is the 100-byte-wide TSPL bitmap.
      final job = pm241LabelJob(image);
      expect(job.bitmap.length, 100 * 1180);
    },
  );
}

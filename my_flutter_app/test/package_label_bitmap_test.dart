import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/package_label_bitmap.dart';
import 'package:my_flutter_app/services/package_labels.dart';
import 'package:my_flutter_app/services/tag_labels.dart';

/// The package label in printer dots, as the M221 gets it: the label's own
/// size at 8 dots per millimetre, the QR at whole dots per module (each
/// module's centre is exactly the matrix), text on the white below it.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final label = PackageLabel.fromMap({
    'code': 'CL-K7M4P2',
    'what': 'Barrel',
    'receiver': 'Mariama Bah',
    'receiverPhone': '+224621234567',
    'sender': 'Fatou Diallo',
    'senderPhone': '+19175551234',
    'place': 'Guinea',
  });

  for (final size in [
    PackageLabelSizes.seventyByEighty,
    PackageLabelSizes.fiftyByEighty,
    PackageLabelSizes.sixtyTwoByHundred,
  ]) {
    test('draws ${size.mmText} with a scannable QR and the text', () async {
      final layout = layoutPackageLabel(
        label,
        size: size,
        businessName: 'Conakry Express',
        reference: 'MSKU1234567',
      );
      final image = await renderPackageLabelBitmap(layout);
      expect(image.width, size.widthDots);
      expect(image.height, size.heightDots);
      expect(image.width, lessThanOrEqualTo(m221HeadDots));

      final qr = tagQrMatrix(label.link);
      final at = packageQrPlacement(layout, qr.size);
      expect(at.module, greaterThanOrEqualTo(3),
          reason: 'modules big enough to scan off a barrel');
      for (var r = 0; r < qr.size; r++) {
        for (var c = 0; c < qr.size; c++) {
          final x = at.x0 + c * at.module + at.module ~/ 2;
          final y = at.y0 + r * at.module + at.module ~/ 2;
          expect(image.black(x, y), qr.dark(r, c), reason: 'module $r,$c');
        }
      }
      // The QR stays inside its square.
      final side = qr.size * at.module;
      expect(at.x0 + side, lessThanOrEqualTo(image.width));
      expect(at.y0 + side,
          lessThanOrEqualTo(((layout.qrTop + layout.qrSide) * 8).ceil()));

      // Ink under the QR: the code and the rest of the text.
      final code = layout.part(PackageLabelPart.code)!;
      var ink = 0;
      for (var y = (code.top * 8).floor(); y < (code.bottom * 8).ceil(); y++) {
        for (var x = 0; x < image.width; x++) {
          if (image.black(x, y)) ink++;
        }
      }
      expect(ink, greaterThan(0), reason: 'the code is printed');
      // And the margins stay white.
      for (var y = 0; y < image.height; y++) {
        expect(image.black(0, y), isFalse);
        expect(image.black(image.width - 1, y), isFalse);
      }
    });
  }
}

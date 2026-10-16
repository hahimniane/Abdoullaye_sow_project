/// A package label in printer dots for the Phomemo M221: the layout from
/// `package_labels.dart`, with the text drawn by the phone's own fonts (any
/// script a name is written in) and the QR placed at whole dots per module,
/// exactly as a shop tag's is (`renderTagBitmap`), so it prints crisp.
///
/// The output is the same 1-bit [LabelBitmap] the tag path hands to
/// `LabelPrinterController.printLabels`.
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'm221_protocol.dart' show LabelBitmap;
import 'package_labels.dart';
import 'tag_labels.dart';

/// Draws [layout] at 8 dots per millimetre.
typedef PackageLabelBitmapRenderer = Future<LabelBitmap> Function(
  PackageLabelLayout layout,
);

const _dotsPerMm = tagDotsPerMm * 1.0;

/// Where the QR's modules land in dots: whole dots per module, centred in the
/// layout's square with its quiet zone. Shared by the renderer and its tests.
({int x0, int y0, int module}) packageQrPlacement(
  PackageLabelLayout layout,
  int qrSize,
) {
  final side = (layout.qrSide * _dotsPerMm).floor();
  final n = qrSize + 2 * packageLabelQuietModules;
  final module = math.max(2, side ~/ n);
  final drawn = qrSize * module;
  final left = (layout.qrLeft * _dotsPerMm).floor();
  final top = (layout.qrTop * _dotsPerMm).floor();
  return (
    x0: left + (side - drawn) ~/ 2,
    y0: top + (side - drawn) ~/ 2,
    module: module,
  );
}

Future<LabelBitmap> renderPackageLabelBitmap(PackageLabelLayout layout) async {
  final size = layout.size;
  final w = size.widthDots;
  final h = size.heightDots;
  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(
    recorder,
    ui.Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()),
  );
  canvas.drawRect(
    ui.Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()),
    ui.Paint()..color = const ui.Color(0xFFFFFFFF),
  );
  final ink = ui.Paint()..color = const ui.Color(0xFF000000);

  for (final t in layout.texts) {
    if (t.fontMm <= 0 || t.text.isEmpty) continue;
    final boxW = t.width * _dotsPerMm;
    final boxH = t.height * _dotsPerMm;
    final builder = ui.ParagraphBuilder(
      ui.ParagraphStyle(
        maxLines: 1,
        // A name too long for the label is cut; the code and the phones are
        // shrunk instead (below), never cut.
        ellipsis: t.whole ? null : '…',
        textAlign: ui.TextAlign.left,
      ),
    )
      ..pushStyle(ui.TextStyle(
        color: const ui.Color(0xFF000000),
        fontSize: t.fontMm * _dotsPerMm,
        fontWeight: t.bold ? ui.FontWeight.w700 : ui.FontWeight.w400,
        fontFamily: t.mono ? 'monospace' : null,
        // iOS has no "monospace" family: Menlo is its fixed-width font.
        fontFamilyFallback: t.mono ? const ['Menlo', 'Courier'] : null,
      ))
      ..addText(t.text);
    final paragraph = builder.build();
    if (t.whole) {
      paragraph.layout(const ui.ParagraphConstraints(width: double.infinity));
    } else {
      paragraph.layout(ui.ParagraphConstraints(width: boxW));
    }
    final natural = t.whole
        ? paragraph.maxIntrinsicWidth
        : math.min(paragraph.maxIntrinsicWidth, boxW);
    final scale = natural > boxW && natural > 0 ? boxW / natural : 1.0;
    final drawnW = natural * scale;
    final drawnH = paragraph.height * scale;
    final dx = switch (t.align) {
      PackageLabelAlign.left => 0.0,
      PackageLabelAlign.center => (boxW - drawnW) / 2,
      PackageLabelAlign.right => boxW - drawnW,
    };
    final dy = (boxH - drawnH) / 2;
    canvas.save();
    canvas.translate(t.left * _dotsPerMm + dx, t.top * _dotsPerMm + dy);
    canvas.scale(scale);
    canvas.drawParagraph(paragraph, ui.Offset.zero);
    canvas.restore();
  }

  final ruleTop = layout.ruleTop;
  if (ruleTop != null) {
    canvas.drawRect(
      ui.Rect.fromLTWH(
        layout.margin * _dotsPerMm,
        ruleTop * _dotsPerMm,
        (size.widthMm - 2 * layout.margin) * _dotsPerMm,
        math.max(2, packageLabelRuleMm * _dotsPerMm),
      ),
      ink,
    );
  }

  final picture = recorder.endRecording();
  final image = await picture.toImage(w, h);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
  image.dispose();
  picture.dispose();

  final bitmap = LabelBitmap(w, h);
  if (bytes != null) {
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        final i = (y * w + x) * 4;
        final r = bytes.getUint8(i);
        final g = bytes.getUint8(i + 1);
        final b = bytes.getUint8(i + 2);
        final a = bytes.getUint8(i + 3);
        // Luminance over white: anything darker than mid-grey is a dot.
        final lum = (0.299 * r + 0.587 * g + 0.114 * b) * a / 255 +
            255 * (1 - a / 255);
        if (lum < 128) bitmap.pixels[y * w + x] = 1;
      }
    }
  }

  // The QR straight into the dots, a whole number per module.
  if (layout.qrSide > 0) {
    final qr = tagQrMatrix(layout.link);
    final at = packageQrPlacement(layout, qr.size);
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (!qr.dark(r, c)) continue;
        bitmap.fill(
          at.x0 + c * at.module,
          at.y0 + r * at.module,
          at.x0 + (c + 1) * at.module - 1,
          at.y0 + (r + 1) * at.module - 1,
        );
      }
    }
  }
  return bitmap;
}

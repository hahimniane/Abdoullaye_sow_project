/// Product tags printed on the phone: the label sizes a shop can print on,
/// the QR every tag carries, and the exact-size PDF (page == label) that a
/// printer app such as Print Master prints at 100 % instead of shrinking a
/// whole letter page onto the label.
///
/// Rules (`docs/INVENTORY.md`): a tag is the QR and nothing else; it holds
/// `https://customer.laawoldigital.com/i/<CODE>`; every copy of one product
/// carries the SAME code (reprinting never changes it); error correction H.
///
/// Pure Dart: no Flutter, no plugins, so every byte of it is unit-tested.
library;

import 'dart:math' as math;
import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:qr/qr.dart';

import 'inventory.dart' show inventoryLinkSegment;
import 'package_codes.dart' show packageLinkHost;

/// The link a product tag's QR holds.
String inventoryTagLink(String code) =>
    'https://$packageLinkHost/$inventoryLinkSegment/${code.trim().toUpperCase()}';

// ---------------------------------------------------------------------------
// Label sizes.
// ---------------------------------------------------------------------------

const tagSize2x1in = '2x1in';
const tagSize40x30mm = '40x30mm';
const tagSize50x30mm = '50x30mm';
const tagSizeCustom = 'custom';

/// Limits for a custom size. The width stops at the M221 print head (72 mm);
/// below 15 mm a QR of a link this long cannot be scanned.
const tagMinMm = 15.0;
const tagMaxWidthMm = 72.0;
const tagMaxHeightMm = 100.0;

/// Printer resolution: 203 dpi is 8 dots per millimetre.
const tagDotsPerMm = 8;

/// A label: its width and height in millimetres (width = across the roll).
class TagLabelSize {
  const TagLabelSize(this.id, this.widthMm, this.heightMm);

  final String id;
  final double widthMm;
  final double heightMm;

  static const twoByOne = TagLabelSize(tagSize2x1in, 50.8, 25.4);
  static const fortyByThirty = TagLabelSize(tagSize40x30mm, 40, 30);
  static const fiftyByThirty = TagLabelSize(tagSize50x30mm, 50, 30);

  /// The fixed sizes a shop picks from, in the order they are offered.
  static const presets = [twoByOne, fortyByThirty, fiftyByThirty];

  /// The size [id] names; a custom id takes [customWidthMm] x
  /// [customHeightMm] (clamped to what the printer can do). An unknown id is
  /// the 2 x 1 inch tag.
  static TagLabelSize resolve(
    String id, {
    double customWidthMm = 50.8,
    double customHeightMm = 25.4,
  }) {
    if (id == tagSizeCustom) {
      return TagLabelSize(
        tagSizeCustom,
        clampTagWidthMm(customWidthMm),
        clampTagHeightMm(customHeightMm),
      );
    }
    return presets.firstWhere((s) => s.id == id, orElse: () => twoByOne);
  }

  /// PDF points (1/72 inch).
  double get widthPt => widthMm / 25.4 * 72;
  double get heightPt => heightMm / 25.4 * 72;

  /// Printer dots at 203 dpi: 2 x 1 in is 406 x 203.
  int get widthDots => (widthMm * tagDotsPerMm).floor();
  int get heightDots => (heightMm * tagDotsPerMm).floor();

  /// "50.8 x 25.4 mm" style text with no trailing zeros (sizes are not
  /// user-facing copy; the unit is the same in English and French).
  String get mmText => '${_mm(widthMm)} × ${_mm(heightMm)} mm';

  @override
  bool operator ==(Object other) =>
      other is TagLabelSize &&
      other.id == id &&
      other.widthMm == widthMm &&
      other.heightMm == heightMm;

  @override
  int get hashCode => Object.hash(id, widthMm, heightMm);
}

String _mm(double v) {
  final rounded = (v * 10).round() / 10;
  return rounded == rounded.roundToDouble()
      ? rounded.toInt().toString()
      : rounded.toStringAsFixed(1);
}

double clampTagWidthMm(double mm) =>
    mm.isFinite ? mm.clamp(tagMinMm, tagMaxWidthMm).toDouble() : 50.8;
double clampTagHeightMm(double mm) =>
    mm.isFinite ? mm.clamp(tagMinMm, tagMaxHeightMm).toDouble() : 25.4;

/// A typed millimetre value ("40", "50.8", "50,8"), or null when it is not
/// a number inside [min]..[max].
double? readTagMm(String raw, {required double min, required double max}) {
  final text = raw.trim().replaceAll(',', '.');
  if (!RegExp(r'^\d{1,3}(\.\d{1,2})?$').hasMatch(text)) return null;
  final value = double.parse(text);
  if (value < min || value > max) return null;
  return value;
}

// ---------------------------------------------------------------------------
// The QR.
// ---------------------------------------------------------------------------

/// A QR as a square of modules (true = dark), row 0 at the top.
class QrMatrix {
  QrMatrix(this.size, List<bool> modules)
    : modules = List.unmodifiable(modules) {
    if (modules.length != size * size) {
      throw ArgumentError('expected ${size * size} modules');
    }
  }

  final int size;
  final List<bool> modules;

  bool dark(int row, int col) => modules[row * size + col];

  /// One string of '0'/'1' per row (the fixture format).
  List<String> toRows() => [
    for (var r = 0; r < size; r++)
      [for (var c = 0; c < size; c++) dark(r, c) ? '1' : '0'].join(),
  ];

  factory QrMatrix.fromRows(List<String> rows) => QrMatrix(rows.length, [
    for (final row in rows)
      for (final ch in row.split('')) ch == '1',
  ]);
}

/// The tag QR for [link], error correction H (a third of the code can be
/// scuffed and it still scans).
QrMatrix tagQrMatrix(String link) {
  final code = QrCode.fromData(
    data: link,
    errorCorrectLevel: QrErrorCorrectLevel.H,
  );
  final image = QrImage(code);
  final n = image.moduleCount;
  return QrMatrix(n, [
    for (var r = 0; r < n; r++)
      for (var c = 0; c < n; c++) image.isDark(r, c),
  ]);
}

// ---------------------------------------------------------------------------
// The exact-size PDF.
// ---------------------------------------------------------------------------

/// Where the QR sits on a PDF page: two modules of white around the code
/// (the quiet zone) and 0.05 in clear of the label edge, centred, filling
/// the label's short side. Mirrors the reference layout that printed right
/// in Print Master.
class TagPdfLayout {
  TagPdfLayout._(this.module, this.x0, this.y0, this.n);

  factory TagPdfLayout.of(TagLabelSize size, int n) {
    const quiet = 2;
    const pad = 0.05 * 72;
    final side = math.min(size.widthPt, size.heightPt) - 2 * pad;
    final m = side / (n + 2 * quiet);
    final total = m * (n + 2 * quiet);
    return TagPdfLayout._(
      m,
      (size.widthPt - total) / 2 + quiet * m,
      (size.heightPt - total) / 2 + quiet * m,
      n,
    );
  }

  /// One module, in points.
  final double module;

  /// Bottom-left corner of the code (PDF origin is bottom-left).
  final double x0;
  final double y0;
  final int n;
}

/// The dark runs of each row as [row, startCol, endColExclusive]: one
/// rectangle per run keeps the PDF small and leaves no hairline seams.
List<List<int>> qrRuns(QrMatrix qr) {
  final runs = <List<int>>[];
  for (var r = 0; r < qr.size; r++) {
    var c = 0;
    while (c < qr.size) {
      if (!qr.dark(r, c)) {
        c++;
        continue;
      }
      var e = c;
      while (e < qr.size && qr.dark(r, e)) {
        e++;
      }
      runs.add([r, c, e]);
      c = e;
    }
  }
  return runs;
}

/// The tags as a PDF whose page IS the label: [copies] pages, each the same
/// QR (one code for every copy), drawn as vector rectangles.
Future<Uint8List> buildTagPdf({
  required String link,
  required TagLabelSize size,
  int copies = 1,
}) async {
  final qr = tagQrMatrix(link);
  final layout = TagPdfLayout.of(size, qr.size);
  final runs = qrRuns(qr);
  final format = PdfPageFormat(size.widthPt, size.heightPt, marginAll: 0);
  final doc = pw.Document(
    title: link,
    creator: 'Laawol',
    compress: true,
  );
  final pages = copies < 1 ? 1 : copies;
  for (var i = 0; i < pages; i++) {
    doc.addPage(
      pw.Page(
        pageFormat: format,
        build: (_) => pw.SizedBox(
          width: size.widthPt,
          height: size.heightPt,
          child: pw.CustomPaint(
            size: PdfPoint(size.widthPt, size.heightPt),
            painter: (canvas, _) {
              canvas.setFillColor(PdfColors.black);
              final m = layout.module;
              for (final run in runs) {
                final r = run[0], c = run[1], e = run[2];
                // A hair of overlap so neighbouring runs never show a seam.
                canvas.drawRect(
                  layout.x0 + c * m,
                  layout.y0 + (qr.size - 1 - r) * m,
                  (e - c) * m + 0.02,
                  m + 0.02,
                );
              }
              canvas.fillPath();
            },
          ),
        ),
      ),
    );
  }
  return doc.save();
}

/// A file name for the shared PDF: `tag-IT-K7M4P2-2x1in.pdf`.
String tagPdfFileName(String code, TagLabelSize size) {
  final safe = code.trim().toUpperCase().replaceAll(RegExp('[^A-Z0-9-]'), '');
  final sizePart = size.id == tagSizeCustom
      ? '${_mm(size.widthMm)}x${_mm(size.heightMm)}mm'.replaceAll('.', '_')
      : size.id;
  return 'tag-$safe-$sizePart.pdf';
}

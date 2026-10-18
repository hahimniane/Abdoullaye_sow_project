/// Package labels printed from the phone: the barrel, box and car labels the
/// console prints today (`functions/container_labels.js`, thermal 4 x 6), built
/// here so a counter with no computer can print them - straight to the shop's
/// Phomemo M221 over Bluetooth, or through the system print dialog onto a
/// 4 x 6 in label (iPhone AirPrint, Android print service).
///
/// One description of the label, whatever its size ([layoutPackageLabel]):
/// the QR of the public tracking link (error correction H) on top, the code
/// large in monospace with which piece this is ("CL-K7M4P2 · 1 of 3" when a
/// line is several pieces, as the server's label prints it), what the piece
/// is (VIN for a car), TO / POUR the receiver with their phone, FROM / DE the
/// sender with theirs, where it is going and its size, and a footer with the
/// business and the container reference. It never carries the price.
///
/// On a small label the text shrinks to fit; a long name is cut with "…", but
/// the code and the phone numbers are always printed whole (a smaller font,
/// never fewer digits): whoever holds the package has to be able to call.
///
/// The data comes from the `getPackageLabels` callable ([packageLabelsRequest],
/// [PackageLabelSet.fromResponse]). The PDF here is what the system dialog
/// prints; `package_label_bitmap.dart` draws the same layout in printer dots
/// for the M221. Pure Dart, unit-tested without Firebase or a printer.
library;

import 'dart:math' as math;
import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'package_codes.dart' show packageLinkHost;
import 'tag_labels.dart';

// ---------------------------------------------------------------------------
// Sizes.
// ---------------------------------------------------------------------------

const packageSize70x80mm = '70x80mm';
const packageSize50x80mm = '50x80mm';
const packageSize62x100mm = '62x100mm';
const packageSize4x6in = '4x6in';

/// The sizes a package label prints at. The M221 sizes stop at its 72 mm head
/// and a custom one takes the same clamps as a shop tag; the 4 x 6 in label is
/// the system dialog's page.
abstract final class PackageLabelSizes {
  static const seventyByEighty = TagLabelSize(packageSize70x80mm, 70, 80);
  static const fiftyByEighty = TagLabelSize(packageSize50x80mm, 50, 80);
  static const sixtyTwoByHundred = TagLabelSize(packageSize62x100mm, 62, 100);
  static const fourBySix = TagLabelSize(packageSize4x6in, 101.6, 152.4);

  /// What the label printer offers, in order; custom follows.
  static const presets = [seventyByEighty, fiftyByEighty, sixtyTwoByHundred];

  /// A size id the label printer can be set to.
  static bool isKnown(String id) =>
      id == tagSizeCustom || presets.any((p) => p.id == id);

  /// The size [id] names; custom takes [customWidthMm] x [customHeightMm]
  /// clamped like a tag. Anything else is 70 x 80 mm.
  static TagLabelSize resolve(
    String id, {
    double customWidthMm = 70,
    double customHeightMm = 80,
  }) {
    if (id == tagSizeCustom) {
      return TagLabelSize(
        tagSizeCustom,
        clampTagWidthMm(customWidthMm),
        clampTagHeightMm(customHeightMm),
      );
    }
    return presets.firstWhere((s) => s.id == id, orElse: () => seventyByEighty);
  }
}

/// Labels per package: two on the 4 x 6 (two sides of a barrel, as the
/// console prints), one on the label printer (a pickup, a torn label).
const packageLabelCopiesSheet = 2;
const packageLabelCopiesPrinter = 1;

/// One request names at most this many lines (the server's limit).
const packageLabelsMaxLines = 100;

// ---------------------------------------------------------------------------
// The callable.
// ---------------------------------------------------------------------------

/// The `getPackageLabels` payload: a whole container, one line on it
/// ([lineId]), or - with no [containerId], for packages still waiting for one
/// - the lines by id ([lineIds], else the one [lineId]; at most 100).
/// [copies] is one or two labels per package.
Map<String, Object> packageLabelsRequest({
  required String businessId,
  required String containerId,
  String lineId = '',
  List<String> lineIds = const [],
  int copies = packageLabelCopiesSheet,
}) {
  final container = containerId.trim();
  final ids = {
    for (final id in [...lineIds, lineId])
      if (id.trim().isNotEmpty) id.trim(),
  }.take(packageLabelsMaxLines).toList();
  return {
    'businessId': businessId.trim(),
    'containerId': container,
    'copies': copies == 1 ? 1 : 2,
    if (container.isEmpty && ids.isNotEmpty) 'lineIds': ids,
    if (container.isNotEmpty && lineId.trim().isNotEmpty)
      'lineId': lineId.trim(),
  };
}

/// Which labels a print sheet prints: a whole container, one line on it, or
/// waiting packages by line id. [request] is the payload for [copies].
class PackageLabelsTarget {
  const PackageLabelsTarget({
    required this.businessId,
    this.containerId = '',
    this.lineId = '',
    this.lineIds = const [],
  });

  final String businessId;
  final String containerId;
  final String lineId;
  final List<String> lineIds;

  Map<String, Object> request(int copies) => packageLabelsRequest(
        businessId: businessId,
        containerId: containerId,
        lineId: lineId,
        lineIds: lineIds,
        copies: copies,
      );
}

String _text(Object? value, int max) {
  final t = (value ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

int _positive(Object? value, int fallback) {
  if (value is num && value.isFinite && value >= 1) return value.round();
  return fallback;
}

/// One printed label, as the server describes it.
class PackageLabel {
  const PackageLabel({
    required this.code,
    required this.link,
    this.what = '',
    this.vin = '',
    this.packageNumber = 1,
    this.packageCount = 1,
    this.receiver = '',
    this.receiverPhone = '',
    this.sender = '',
    this.senderPhone = '',
    this.destination = '',
    this.size = '',
    this.place = '',
  });

  final String code;

  /// The public tracking link the QR holds.
  final String link;
  final String what;
  final String vin;
  final int packageNumber;
  final int packageCount;
  final String receiver;
  final String receiverPhone;
  final String sender;
  final String senderPhone;
  final String destination;
  final String size;

  /// Destination and size together ("Guinea · 40 × 30 × 20 in").
  final String place;

  /// Tolerant: a missing link is the label link the code would have; a
  /// missing place is built from the destination and size.
  factory PackageLabel.fromMap(Map<Object?, Object?> map) {
    final code = _text(map['code'], 40).toUpperCase();
    final link = _text(map['link'], 300);
    final destination = _text(map['destination'], 120);
    final size = _text(map['size'], 80);
    final place = _text(map['place'], 200);
    final count = _positive(map['packageCount'], 1);
    final number = _positive(map['packageNumber'], 1);
    return PackageLabel(
      code: code,
      link: link.isNotEmpty ? link : packageTrackingLink(code),
      what: _text(map['what'], 120),
      vin: _text(map['vin'], 17),
      packageNumber: number > count ? count : number,
      packageCount: count,
      receiver: _text(map['receiver'], 120),
      receiverPhone: _text(map['receiverPhone'], 40),
      sender: _text(map['sender'], 120),
      senderPhone: _text(map['senderPhone'], 40),
      destination: destination,
      size: size,
      place: place.isNotEmpty
          ? place
          : [destination, size].where((s) => s.isNotEmpty).join(' · '),
    );
  }

  /// The same package (one code, one package of the line): copies of it are
  /// identical labels.
  bool samePackage(PackageLabel other) =>
      other.code == code &&
      other.packageNumber == packageNumber &&
      other.packageCount == packageCount;
}

/// The link a package label's QR holds when the server sent none: the same
/// `/t/<code>` the app reads back ([packageCodeFromScan]).
String packageTrackingLink(String code) =>
    'https://$packageLinkHost/t/${code.trim().toUpperCase()}';

/// What `getPackageLabels` answers: every label in print order (copies
/// already counted), and what the footer says.
class PackageLabelSet {
  const PackageLabelSet({
    required this.labels,
    this.reference = '',
    this.hasContainer = false,
    this.businessName = '',
    this.businessPhone = '',
  });

  final List<PackageLabel> labels;

  /// The container's number (or name); empty for waiting packages.
  final String reference;
  final bool hasContainer;
  final String businessName;
  final String businessPhone;

  bool get isEmpty => labels.isEmpty;

  /// Reads the callable's answer (iOS hands nested maps over as
  /// `Map<Object?, Object?>`). A label without a code is left out.
  factory PackageLabelSet.fromResponse(Object? data) {
    final map = data is Map ? data : const <Object?, Object?>{};
    final raw = map['labels'];
    final labels = <PackageLabel>[
      if (raw is List)
        for (final row in raw)
          if (row is Map) PackageLabel.fromMap(row),
    ]..removeWhere((l) => l.code.isEmpty);
    return PackageLabelSet(
      labels: labels,
      reference: _text(map['reference'], 120),
      hasContainer: map['hasContainer'] == true,
      businessName: _text(map['businessName'], 160),
      businessPhone: _text(map['businessPhone'], 40),
    );
  }
}

/// Labels in a row that are the same package, as one picture to print
/// [copies] times - the label printer sends one picture and repeats it.
class PackageLabelRun {
  const PackageLabelRun(this.label, this.copies);

  final PackageLabel label;
  final int copies;
}

List<PackageLabelRun> packageLabelRuns(List<PackageLabel> labels) {
  final runs = <PackageLabelRun>[];
  for (final label in labels) {
    final last = runs.isEmpty ? null : runs.last;
    if (last != null && last.label.samePackage(label)) {
      runs[runs.length - 1] = PackageLabelRun(last.label, last.copies + 1);
    } else {
      runs.add(PackageLabelRun(label, 1));
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// The layout.
// ---------------------------------------------------------------------------

/// The parts of a label, top to bottom.
enum PackageLabelPart {
  code,
  what,
  vin,
  toCaption,
  receiver,
  receiverPhone,
  fromCaption,
  sender,
  senderPhone,
  place,
  footer,
  reference,
}

enum PackageLabelAlign { left, center, right }

/// The two captions are printed in both languages at once, as the console's
/// label does: the people reading it may read either.
const packageLabelToCaption = 'TO / POUR';
const packageLabelFromCaption = 'FROM / DE';

/// The footer's name when the business has none on file.
const packageLabelDefaultBusiness = 'Laawol Digital';

/// The parts that are never cut: shrunk to fit instead.
const packageLabelWholeParts = {
  PackageLabelPart.code,
  PackageLabelPart.vin,
  PackageLabelPart.receiverPhone,
  PackageLabelPart.senderPhone,
  PackageLabelPart.reference,
};

/// One line of text on the label: its box (millimetres from the label's
/// top-left corner) and its font size (millimetres, the em size).
class PackageLabelText {
  const PackageLabelText({
    required this.part,
    required this.text,
    required this.left,
    required this.top,
    required this.width,
    required this.height,
    required this.fontMm,
    this.bold = true,
    this.mono = false,
    this.align = PackageLabelAlign.center,
  });

  final PackageLabelPart part;
  final String text;
  final double left;
  final double top;
  final double width;
  final double height;
  final double fontMm;
  final bool bold;
  final bool mono;
  final PackageLabelAlign align;

  /// Printed whole, never cut ([packageLabelWholeParts]).
  bool get whole => packageLabelWholeParts.contains(part);

  double get right => left + width;
  double get bottom => top + height;

  /// The font size in PDF points.
  double get fontPt => fontMm / 25.4 * 72;
}

/// Where everything sits on one label of [size].
class PackageLabelLayout {
  const PackageLabelLayout({
    required this.size,
    required this.margin,
    required this.qrLeft,
    required this.qrTop,
    required this.qrSide,
    required this.link,
    required this.texts,
    this.ruleTop,
  });

  final TagLabelSize size;
  final double margin;

  /// The QR's square, quiet zone included (millimetres).
  final double qrLeft;
  final double qrTop;
  final double qrSide;
  final String link;
  final List<PackageLabelText> texts;

  /// The thin line above the footer; null when there is no footer.
  final double? ruleTop;

  PackageLabelText? part(PackageLabelPart part) {
    for (final t in texts) {
      if (t.part == part) return t;
    }
    return null;
  }
}

/// Glyph advance as a share of the font size: Courier is exactly 0.6; for
/// bold sans the estimate sits a little above Helvetica Bold's average, so a
/// line judged to fit does. The renderers still shrink anything wider.
const _monoAdvance = 0.6;
const _sansAdvance = 0.64;
const _lineHeight = 1.18;

/// The width [text] takes at [fontMm], estimated (millimetres).
double estimatePackageTextWidth(String text, double fontMm, {bool mono = false}) =>
    text.runes.length * fontMm * (mono ? _monoAdvance : _sansAdvance);

/// [text] cut to [maxChars] characters with "…" when longer.
String ellipsizePackageText(String text, int maxChars) {
  final runes = text.runes.toList();
  if (runes.length <= maxChars) return text;
  if (maxChars <= 1) return '…';
  return '${String.fromCharCodes(runes.take(maxChars - 1)).trimRight()}…';
}

class _Line {
  const _Line(this.part, this.text, this.scale,
      {this.mono = false, this.bold = true, this.gapBefore = false});

  final PackageLabelPart part;
  final String text;
  final double scale;
  final bool mono;
  final bool bold;
  final bool gapBefore;
}

/// The code line of a label: the code, and which piece of the line this is
/// when the line has several - "CL-K7M4P2 · 1 of 3".
String packageLabelCodeLine(PackageLabel label) => label.packageCount > 1
    ? '${label.code} · ${label.packageNumber} of ${label.packageCount}'
    : label.code;

/// The footer's left half: the business and its phone.
String packageLabelFooter(String businessName, String businessPhone) {
  final name = businessName.trim().isEmpty
      ? packageLabelDefaultBusiness
      : businessName.trim();
  final phone = businessPhone.trim();
  return phone.isEmpty ? name : '$name · $phone';
}

/// Lays out one [label] on [size]. The QR goes on top, as large as the label
/// allows while the text keeps a readable size (at least 30 mm on 70 x 80);
/// the text block follows, every line sized from one unit so the parts keep
/// their proportions; the footer sits on the bottom edge.
PackageLabelLayout layoutPackageLabel(
  PackageLabel label, {
  required TagLabelSize size,
  String businessName = '',
  String businessPhone = '',
  String reference = '',
}) {
  final w = size.widthMm;
  final h = size.heightMm;
  final big = w >= 90;
  final margin =
      big ? 6.35 : (math.min(w, h) * 0.04).clamp(1.2, 3.0).toDouble();
  final innerW = w - 2 * margin;
  final innerH = h - 2 * margin;
  final gap = math.max(0.5, innerH * 0.012);

  // One label per piece: "CL-K7M4P2 · 1 of 3", the server's words
  // (container_labels.js), printed whole with the code.
  final code = packageLabelCodeLine(label);
  final what = label.what;
  final hasTo = label.receiver.isNotEmpty || label.receiverPhone.isNotEmpty;
  final hasFrom = label.sender.isNotEmpty || label.senderPhone.isNotEmpty;
  final lines = <_Line>[
    _Line(PackageLabelPart.code, code, 2.0, mono: true),
    if (what.isNotEmpty) _Line(PackageLabelPart.what, what, 1.1),
    if (label.vin.isNotEmpty)
      _Line(PackageLabelPart.vin, 'VIN ${label.vin}', 0.8,
          mono: true, bold: false),
    if (hasTo)
      const _Line(PackageLabelPart.toCaption, packageLabelToCaption, 0.55,
          gapBefore: true),
    if (label.receiver.isNotEmpty)
      _Line(PackageLabelPart.receiver, label.receiver, 1.3),
    if (label.receiverPhone.isNotEmpty)
      _Line(PackageLabelPart.receiverPhone, label.receiverPhone, 1.0),
    if (hasFrom)
      const _Line(PackageLabelPart.fromCaption, packageLabelFromCaption, 0.55,
          gapBefore: true),
    if (label.sender.isNotEmpty)
      _Line(PackageLabelPart.sender, label.sender, 1.0),
    if (label.senderPhone.isNotEmpty)
      _Line(PackageLabelPart.senderPhone, label.senderPhone, 0.95),
    if (label.place.isNotEmpty)
      _Line(PackageLabelPart.place, label.place, 0.85,
          bold: false, gapBefore: true),
  ];
  const footerScale = 0.6;
  const rule = 0.25;

  // Height in "units" (one unit = the font size of a 1.0 line) and in mm.
  final units = lines.fold<double>(0, (s, l) => s + l.scale * _lineHeight) +
      footerScale * _lineHeight;
  final gaps = gap * (lines.where((l) => l.gapBefore).length + 2) + rule;
  final uMax = big ? 4.6 : 4.2;
  final uMin = big ? 2.2 : 1.5;

  // The QR: 2.6 in on a 4 x 6 (the console's), else 45 % of the height; it
  // gives way to keep the text readable, but not below 30 mm (or the width),
  // and never past half of what is left after the gaps.
  final qrFloor = math.min(innerW, big ? 50.0 : 30.0);
  var qr = big ? math.min(innerW, 66.04) : math.min(innerW, innerH * 0.45);
  final roomForText = innerH - uMin * units - gaps;
  if (qr > roomForText) qr = math.max(math.min(qrFloor, qr), roomForText);
  qr = math.min(qr, (innerH - gaps) * 0.6);
  if (qr < 0) qr = 0;
  var u = (innerH - qr - gaps) / units;
  if (u > uMax) u = uMax;
  if (u < 0) u = 0;

  final texts = <PackageLabelText>[];
  var y = margin + qr + gap;
  for (final line in lines) {
    if (line.gapBefore) y += gap;
    final nominal = line.scale * u;
    final whole = packageLabelWholeParts.contains(line.part);
    final advance = line.mono ? _monoAdvance : _sansAdvance;
    var font = nominal;
    var text = line.text;
    if (whole) {
      final fit = innerW / (math.max(1, text.runes.length) * advance);
      if (font > fit) font = fit;
    } else if (font > 0) {
      text = ellipsizePackageText(text, (innerW / (font * advance)).floor());
    }
    final height = nominal * _lineHeight;
    texts.add(PackageLabelText(
      part: line.part,
      text: text,
      left: margin,
      top: y,
      width: innerW,
      height: height,
      fontMm: font,
      bold: line.bold,
      mono: line.mono,
    ));
    y += height;
  }

  // The footer on the bottom edge: the business on the left, the container
  // on the right, whole.
  final footFont = footerScale * u;
  final footH = footFont * _lineHeight;
  final footTop = margin + innerH - footH;
  final ref = reference.trim();
  var refW = 0.0;
  var refFont = footFont;
  if (ref.isNotEmpty) {
    refW = math.min(estimatePackageTextWidth(ref, footFont), innerW * 0.45);
    final fit = refW / (math.max(1, ref.runes.length) * _sansAdvance);
    if (refFont > fit) refFont = fit;
    texts.add(PackageLabelText(
      part: PackageLabelPart.reference,
      text: ref,
      left: margin + innerW - refW,
      top: footTop,
      width: refW,
      height: footH,
      fontMm: refFont,
      align: PackageLabelAlign.right,
    ));
  }
  final footW = innerW - (ref.isEmpty ? 0 : refW + 1.5);
  final footer = packageLabelFooter(businessName, businessPhone);
  texts.add(PackageLabelText(
    part: PackageLabelPart.footer,
    text: footFont > 0
        ? ellipsizePackageText(
            footer, (footW / (footFont * _sansAdvance)).floor())
        : footer,
    left: margin,
    top: footTop,
    width: footW,
    height: footH,
    fontMm: footFont,
    align: PackageLabelAlign.left,
  ));

  return PackageLabelLayout(
    size: size,
    margin: margin,
    qrLeft: (w - qr) / 2,
    qrTop: margin,
    qrSide: qr,
    link: label.link,
    texts: texts,
    ruleTop: footTop - gap / 2 - rule,
  );
}

/// The thickness of the footer rule (millimetres).
const packageLabelRuleMm = 0.25;

/// Modules of white kept around the QR inside its square.
const packageLabelQuietModules = 2;

// ---------------------------------------------------------------------------
// The PDF the system print dialog prints.
// ---------------------------------------------------------------------------

/// [text] as the PDF's built-in fonts can draw it (Latin-1): typographic
/// marks become their plain forms and anything else a "?", rather than a
/// blank the printer would silently leave.
String pdfSafeText(String text) {
  final out = StringBuffer();
  for (final rune in text.runes) {
    switch (rune) {
      case 0x2026:
        out.write('...');
      case 0x2018 || 0x2019:
        out.write("'");
      case 0x201C || 0x201D:
        out.write('"');
      case 0x2013 || 0x2014 || 0x2212:
        out.write('-');
      default:
        out.write(rune >= 0x20 && rune <= 0xFF && (rune < 0x7F || rune >= 0xA0)
            ? String.fromCharCode(rune)
            : '?');
    }
  }
  return out.toString();
}

/// The page format of a label: the label itself, no margins.
PdfPageFormat packageLabelPageFormat(TagLabelSize size) =>
    PdfPageFormat(size.widthPt, size.heightPt, marginAll: 0);

/// Every label of [set] as a PDF, one page per label, each page the label
/// itself ([size], 4 x 6 in by default) with no margins.
Future<Uint8List> buildPackageLabelsPdf(
  PackageLabelSet set, {
  TagLabelSize size = PackageLabelSizes.fourBySix,
  bool compress = true,
}) async {
  final doc = pw.Document(
    title: set.reference.isEmpty ? 'Package labels' : 'Labels ${set.reference}',
    creator: 'Laawol',
    compress: compress,
  );
  final format = packageLabelPageFormat(size);
  final qrs = <String, QrMatrix>{};
  final sans = pw.Font.helvetica();
  final sansBold = pw.Font.helveticaBold();
  final mono = pw.Font.courier();
  final monoBold = pw.Font.courierBold();
  const mmToPt = 72 / 25.4;
  for (final label in set.labels) {
    final layout = layoutPackageLabel(
      label,
      size: size,
      businessName: set.businessName,
      businessPhone: set.businessPhone,
      reference: set.reference,
    );
    final qr = qrs.putIfAbsent(layout.link, () => tagQrMatrix(layout.link));
    final runs = qrRuns(qr);
    doc.addPage(
      pw.Page(
        pageFormat: format,
        build: (_) => pw.Stack(
          children: [
            pw.SizedBox(
              width: size.widthPt,
              height: size.heightPt,
              child: pw.CustomPaint(
                size: PdfPoint(size.widthPt, size.heightPt),
                painter: (canvas, _) {
                  canvas.setFillColor(PdfColors.black);
                  final n = qr.size + 2 * packageLabelQuietModules;
                  final m = layout.qrSide * mmToPt / n;
                  final x0 = layout.qrLeft * mmToPt +
                      packageLabelQuietModules * m;
                  // PDF y runs up from the bottom of the page.
                  final top = size.heightPt -
                      (layout.qrTop * mmToPt + packageLabelQuietModules * m);
                  for (final run in runs) {
                    final r = run[0], c = run[1], e = run[2];
                    canvas.drawRect(
                      x0 + c * m,
                      top - (r + 1) * m,
                      (e - c) * m + 0.02,
                      m + 0.02,
                    );
                  }
                  final ruleTop = layout.ruleTop;
                  if (ruleTop != null) {
                    canvas.drawRect(
                      layout.margin * mmToPt,
                      size.heightPt - (ruleTop + packageLabelRuleMm) * mmToPt,
                      (size.widthMm - 2 * layout.margin) * mmToPt,
                      packageLabelRuleMm * mmToPt,
                    );
                  }
                  canvas.fillPath();
                },
              ),
            ),
            for (final t in layout.texts)
              if (t.fontMm > 0)
                pw.Positioned(
                  left: t.left * mmToPt,
                  top: t.top * mmToPt,
                  child: pw.SizedBox(
                    width: t.width * mmToPt,
                    height: t.height * mmToPt,
                    // Never wider than its box: shrunk, never cut.
                    child: pw.FittedBox(
                      fit: pw.BoxFit.scaleDown,
                      alignment: switch (t.align) {
                        PackageLabelAlign.left => pw.Alignment.centerLeft,
                        PackageLabelAlign.center => pw.Alignment.center,
                        PackageLabelAlign.right => pw.Alignment.centerRight,
                      },
                      child: pw.Text(
                        pdfSafeText(t.text),
                        maxLines: 1,
                        softWrap: false,
                        style: pw.TextStyle(
                          font: t.mono
                              ? (t.bold ? monoBold : mono)
                              : (t.bold ? sansBold : sans),
                          fontSize: t.fontPt,
                          color: PdfColors.black,
                        ),
                      ),
                    ),
                  ),
                ),
          ],
        ),
      ),
    );
  }
  return doc.save();
}

/// The PDF's name in the print dialog: `labels-MSKU1234567.pdf`,
/// `labels-CL-K7M4P2.pdf` for one waiting package.
String packageLabelsPdfName(PackageLabelSet set) {
  final base = set.reference.isNotEmpty
      ? set.reference
      : (set.labels.isEmpty ? 'packages' : set.labels.first.code);
  final safe = base.toUpperCase().replaceAll(RegExp('[^A-Z0-9-]'), '');
  return 'labels-${safe.isEmpty ? 'PACKAGES' : safe}.pdf';
}

/// The Phomemo M221 label printer's Bluetooth LE protocol, as pure functions:
/// what to draw for a tag (or a calibration frame) in printer dots, how the
/// picture is packed into the bytes the print head takes, the commands
/// around it, and how the printer's replies read.
///
/// The sequence is the M110 one, proven on an M221 by
/// github.com/mochery/spoolabel (`printers/phomemo_ble.py`); the developer's
/// Python port is `laawol-deploy-logs/m221/m221.py`. `test/m221_protocol_test`
/// checks the packed bytes against that tool's `pack()` output, byte for
/// byte.
///
/// No Bluetooth here: `label_printer.dart` sends these bytes through a
/// transport that a test can fake.
library;

import 'dart:typed_data';

import 'tag_labels.dart' show QrMatrix;

/// GATT: the printer advertises service ff00 (its name is a serial such as
/// "Q2...", never "M221"), takes writes on ff02 and answers on ff03.
const m221ServiceUuid = '0000ff00-0000-1000-8000-00805f9b34fb';
const m221WriteUuid = '0000ff02-0000-1000-8000-00805f9b34fb';
const m221NotifyUuid = '0000ff03-0000-1000-8000-00805f9b34fb';

/// Print head: 576 dots (72 mm at 203 dpi), 72 bytes per raster row.
const m221HeadDots = 576;
const m221HeadBytes = m221HeadDots ~/ 8;

/// Writes go in chunks of at most 128 bytes, 20 ms apart.
const m221ChunkBytes = 128;
const m221ChunkGap = Duration(milliseconds: 20);

/// Pauses the reference tool leaves after each part of a label.
const m221CommandGap = Duration(milliseconds: 30);
const m221AfterRasterGap = Duration(milliseconds: 300);
const m221AfterSubscribeGap = Duration(milliseconds: 200);

/// How long to wait for the "label done" reply after the footer.
const m221DoneTimeout = Duration(seconds: 10);

const m221DefaultDensity = 6;
const m221MinDensity = 1;
const m221MaxDensity = 8;
const m221DefaultSpeed = 5;
const m221MinSpeed = 1;
const m221MaxSpeed = 5;

/// Status queries (the replies arrive on ff03).
const m221QueryBattery = [0x1F, 0x11, 0x08];
const m221QueryPaper = [0x1F, 0x11, 0x11];
const m221QueryCover = [0x1F, 0x11, 0x12];

// ---------------------------------------------------------------------------
// Pictures in printer dots.
// ---------------------------------------------------------------------------

/// A 1-bit picture: [width] x [height] dots, row-major, 1 = black.
class LabelBitmap {
  LabelBitmap(this.width, this.height) : pixels = Uint8List(width * height);

  final int width;
  final int height;
  final Uint8List pixels;

  bool black(int x, int y) => pixels[y * width + x] != 0;

  void set(int x, int y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    pixels[y * width + x] = 1;
  }

  /// Fills x0..x1, y0..y1 inclusive (clipped to the picture).
  void fill(int x0, int y0, int x1, int y1) {
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        set(x, y);
      }
    }
  }

  int get blackCount => pixels.where((p) => p != 0).length;
}

/// The tag in dots: the QR at whole dots per module (crisp edges), as large
/// as the label's short side allows with at least 4 dots of white around
/// it, centred. Same arithmetic as the reference tool's `render_tag`.
LabelBitmap renderTagBitmap(QrMatrix qr, int widthDots, int heightDots) {
  final image = LabelBitmap(widthDots, heightDots);
  final short = widthDots < heightDots ? widthDots : heightDots;
  final n = qr.size;
  var mod = (short - 8) ~/ n;
  if (mod < 2) mod = 2;
  final side = n * mod;
  final x0 = (widthDots - side) ~/ 2;
  final y0 = (heightDots - side) ~/ 2;
  for (var r = 0; r < n; r++) {
    for (var c = 0; c < n; c++) {
      if (!qr.dark(r, c)) continue;
      image.fill(
        x0 + c * mod,
        y0 + r * mod,
        x0 + (c + 1) * mod - 1,
        y0 + (r + 1) * mod - 1,
      );
    }
  }
  return image;
}

/// Dots per QR module for a label (what [renderTagBitmap] uses).
int tagModuleDots(int qrSize, int widthDots, int heightDots) {
  final short = widthDots < heightDots ? widthDots : heightDots;
  final mod = (short - 8) ~/ qrSize;
  return mod < 2 ? 2 : mod;
}

/// The calibration frame: a 3-dot border on the label's edges and one
/// diagonal from the top-left to the bottom-right corner. Printed on a real
/// label it shows at a glance which way (and how far) the picture is off.
LabelBitmap renderTestFrame(int widthDots, int heightDots) {
  final image = LabelBitmap(widthDots, heightDots);
  const border = 3;
  image.fill(0, 0, widthDots - 1, border - 1);
  image.fill(0, heightDots - border, widthDots - 1, heightDots - 1);
  image.fill(0, 0, border - 1, heightDots - 1);
  image.fill(widthDots - border, 0, widthDots - 1, heightDots - 1);
  // Bresenham from (0,0) to (w-1,h-1).
  var x0 = 0, y0 = 0;
  final x1 = widthDots - 1, y1 = heightDots - 1;
  final dx = x1 - x0, dy = -(y1 - y0);
  var err = dx + dy;
  while (true) {
    image.set(x0, y0);
    if (x0 == x1 && y0 == y1) break;
    final e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0++;
    }
    if (e2 <= dx) {
      err += dx;
      y0++;
    }
  }
  return image;
}

// ---------------------------------------------------------------------------
// Packing for the head.
// ---------------------------------------------------------------------------

/// What the head prints: [data] is [rows] rows of [widthBytes] bytes.
class PackedRaster {
  const PackedRaster(this.data, this.widthBytes, this.rows, this.x);

  final Uint8List data;
  final int widthBytes;
  final int rows;

  /// Where the label's left edge landed on the head, in dots.
  final int x;
}

/// Places [image] on the 576-dot head - centred, moved [xOffset] dots to
/// the right (clamped so it stays on the head) - after [yOffset] blank rows,
/// and packs it 1 bit per dot, most significant bit first, 1 = black.
///
/// Same as the reference `pack()` for every [yOffset] >= 0. The reference
/// ignores a negative [yOffset]; here it trims that many rows off the top
/// instead, so a tag that prints too low can be moved up.
PackedRaster packRaster(LabelBitmap image, int xOffset, int yOffset) {
  final w = image.width;
  final centred = ((m221HeadDots - w) / 2).floor();
  var x = centred + xOffset;
  if (x > m221HeadDots - w) x = m221HeadDots - w;
  if (x < 0) x = 0;
  final top = yOffset > 0 ? yOffset : 0;
  final skip = yOffset < 0
      ? (-yOffset > image.height ? image.height : -yOffset)
      : 0;
  final rows = top + image.height - skip;
  final data = Uint8List(rows * m221HeadBytes);
  for (var y = skip; y < image.height; y++) {
    final row = top + y - skip;
    for (var ix = 0; ix < w; ix++) {
      if (!image.black(ix, y)) continue;
      final hx = x + ix;
      if (hx < 0 || hx >= m221HeadDots) continue;
      data[row * m221HeadBytes + (hx >> 3)] |= 0x80 >> (hx & 7);
    }
  }
  return PackedRaster(data, m221HeadBytes, rows, x);
}

// ---------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------

/// The density byte the printer takes for our 1..8: `round(5 + d * 1.25)`
/// with Python's rounding (a half goes to the even number: 6 -> 12), so the
/// app sends exactly what the reference tool sent.
int m221DensityByte(int density) {
  final d = density.clamp(m221MinDensity, m221MaxDensity);
  final value = 5 + d * 1.25;
  final floor = value.floor();
  final frac = value - floor;
  if (frac > 0.5) return floor + 1;
  if (frac < 0.5) return floor;
  return floor.isEven ? floor : floor + 1;
}

List<int> m221SpeedCommand(int speed) => [
  0x1B,
  0x4E,
  0x0D,
  speed.clamp(m221MinSpeed, m221MaxSpeed),
];

List<int> m221DensityCommand(int density) => [
  0x1B,
  0x4E,
  0x04,
  m221DensityByte(density),
];

/// Media: labels with gaps between them (die-cut).
const m221GapMediaCommand = [0x1F, 0x11, 0x0A];

List<int> m221RasterHeader(int widthBytes, int rows) => [
  0x1D,
  0x76,
  0x30,
  0x00,
  widthBytes,
  0x00,
  rows & 0xFF,
  (rows >> 8) & 0xFF,
];

const m221Footer = [0x1F, 0xF0, 0x05, 0x00, 0x1F, 0xF0, 0x03, 0x00];

/// One part of a label job: bytes to send, then a pause.
class M221Step {
  const M221Step(this.name, this.bytes, {this.pauseAfter = Duration.zero});

  final String name;
  final List<int> bytes;
  final Duration pauseAfter;
}

/// Everything one label takes, in order: speed, density, gap media, the
/// raster header and data, then the footer (after which the printer feeds
/// and answers `1A 0F ..`).
List<M221Step> m221LabelSteps(
  PackedRaster raster, {
  int density = m221DefaultDensity,
  int speed = m221DefaultSpeed,
}) => [
  M221Step('speed', m221SpeedCommand(speed), pauseAfter: m221CommandGap),
  M221Step('density', m221DensityCommand(density), pauseAfter: m221CommandGap),
  const M221Step('media', m221GapMediaCommand, pauseAfter: m221CommandGap),
  M221Step('header', m221RasterHeader(raster.widthBytes, raster.rows)),
  M221Step('raster', raster.data, pauseAfter: m221AfterRasterGap),
  const M221Step('footer', m221Footer),
];

/// [bytes] cut into writes of at most [size] bytes.
List<List<int>> m221Chunks(List<int> bytes, int size) {
  final limit = size < 1 ? 1 : size;
  return [
    for (var i = 0; i < bytes.length; i += limit)
      bytes.sublist(i, i + limit > bytes.length ? bytes.length : i + limit),
  ];
}

// ---------------------------------------------------------------------------
// Replies on ff03.
// ---------------------------------------------------------------------------

/// The "label printed" frame: `1A 0F xx`.
bool m221IsDoneFrame(List<int> frame) =>
    frame.length >= 2 && frame[0] == 0x1A && frame[1] == 0x0F;

/// Battery percent from a `1A 04 nn` reply, else null. The reply format is
/// community knowledge, not a documented protocol: it is shown as a hint
/// and every raw reply goes into the print log.
int? m221BatteryPercent(List<int> frame) {
  if (frame.length >= 3 && frame[0] == 0x1A && frame[1] == 0x04) {
    final v = frame[2];
    return v <= 100 ? v : null;
  }
  return null;
}

/// True when a `1A 06 88` reply says the printer has no labels loaded
/// (`1A 06 89` = loaded). Community knowledge, unverified on an M221: used
/// only to explain a label that did not print, never to refuse a job.
bool m221SaysOutOfPaper(List<int> frame) =>
    frame.length >= 3 &&
    frame[0] == 0x1A &&
    frame[1] == 0x06 &&
    frame[2] == 0x88;

/// "1a 0f 0c" for the print log.
String m221Hex(List<int> bytes, {int max = 24}) {
  final shown = bytes.length > max ? bytes.sublist(0, max) : bytes;
  final text = shown
      .map((b) => (b & 0xFF).toRadixString(16).padLeft(2, '0'))
      .join(' ');
  return bytes.length > max ? '$text … (${bytes.length} bytes)' : text;
}

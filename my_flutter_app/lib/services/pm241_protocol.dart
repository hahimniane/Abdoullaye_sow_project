/// The Phomemo PM-241Z-BT 4 x 6 in label printer, as pure functions: the TSPL
/// job for one label, how a picture is packed into it, the flow control the
/// printer imposes on Bluetooth writes, and how its text replies read.
///
/// Proven on a real PM-241Z-BT (2026-11-04, `laawol-deploy-logs/
/// pm241_print_test.py`): a clean, sharp 4 x 6 label printed with exactly
/// this. The printer is NOT an M221: it advertises the same GATT service
/// (ff00, write ff02, notify ff03) but ignores the M221 byte protocol and
/// speaks a subset of TSPL instead.
///
/// - Commands are ASCII lines ending CRLF. `END` is NOT sent (the printer
///   answers "Cmd error:END"). `DIRECTION 1` is NEVER used: it scrambles
///   every 8-dot column group (a firmware bug); a label that must be
///   rotated is rotated in our own bitmap.
/// - The picture is 800 x 1180 dots (203 dpi), rows MSB-first (leftmost dot
///   = bit 7), 0 = BLACK and 1 = white: the opposite of [LabelBitmap].
/// - Flow control on ff03: `01 n` = n more packets may be written (7 at the
///   start, then `01 01` after every packet); `02 lo hi` = the largest packet
///   in bytes (244 seen). One packet per credit, never more than the link
///   allows.
/// - Text replies on ff03: `SSSGETPRINTING:DOING` then `SSSGETPRINTING:DONE`
///   mean the label is printed; `Cmd error:<token>` is a command the printer
///   rejected (a print can still succeed).
///
/// No Bluetooth here: `label_printer.dart` sends these bytes through a
/// transport that a test can fake.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'm221_protocol.dart' show LabelBitmap, renderTagBitmap;
import 'tag_labels.dart' show QrMatrix;

/// What fills the 4 x 6 in label: 800 x 1180 dots at 203 dpi.
const pm241LabelWidthDots = 800;
const pm241LabelHeightDots = 1180;

/// Where the picture's top-left dot lands on the label (the printer's own
/// margin, as proven: `BITMAP 6,10`).
const pm241BitmapX = 6;
const pm241BitmapY = 10;

/// How long to wait for `SSSGETPRINTING:DONE` after the last packet.
const pm241DoneTimeout = Duration(seconds: 20);

/// How long to wait for a flow-control credit before giving up cleanly.
const pm241CreditTimeout = Duration(seconds: 5);

/// The reference script let the printer settle for a second after
/// notifications were on (its first credits and packet size arrive then).
const pm241AfterSubscribeGap = Duration(seconds: 1);

/// The packet size used until the printer says what it takes (`02 lo hi`).
const pm241DefaultPacketBytes = 20;

/// The fixed TSPL set-up lines of every label, in order (each ends CRLF).
const pm241SetupLines = [
  'SIZE 100 mm, 150 mm',
  'GAP 3 mm, 0 mm',
  'DENSITY 10',
  'SPEED 4',
  'DIRECTION 0',
  'CLS',
];

List<int> _ascii(String text) => ascii.encode(text);

// ---------------------------------------------------------------------------
// The picture.
// ---------------------------------------------------------------------------

/// [image] packed for `BITMAP`: [widthBytes] bytes a row, [rows] rows, each
/// row MSB-first with 0 = black and 1 = white (padding dots on the right of
/// a row whose width is not a multiple of 8 are white).
class Pm241Bitmap {
  const Pm241Bitmap(this.data, this.widthBytes, this.rows);

  final Uint8List data;
  final int widthBytes;
  final int rows;
}

Pm241Bitmap pm241PackBitmap(LabelBitmap image) {
  final widthBytes = (image.width + 7) >> 3;
  final data = Uint8List(widthBytes * image.height);
  for (var y = 0; y < image.height; y++) {
    for (var xb = 0; xb < widthBytes; xb++) {
      var byte = 0;
      for (var k = 0; k < 8; k++) {
        final x = xb * 8 + k;
        final black = x < image.width && image.black(x, y);
        byte = (byte << 1) | (black ? 0 : 1);
      }
      data[y * widthBytes + xb] = byte;
    }
  }
  return Pm241Bitmap(data, widthBytes, image.height);
}

/// Whether [image] fits on the 4 x 6 in label.
bool pm241Fits(LabelBitmap image) =>
    image.width > 0 &&
    image.height > 0 &&
    image.width <= pm241LabelWidthDots &&
    image.height <= pm241LabelHeightDots;

// ---------------------------------------------------------------------------
// The job.
// ---------------------------------------------------------------------------

/// The bytes of one label job, in the three parts they are built from.
class Pm241Job {
  const Pm241Job(this.header, this.bitmap, this.footer);

  /// Set-up lines and the `BITMAP ...,` command, up to the first data byte.
  final List<int> header;

  /// The raw packed rows.
  final List<int> bitmap;

  /// CRLF after the data, then `PRINT 1`.
  final List<int> footer;

  /// Everything, in the order it is sent.
  List<int> get bytes => [...header, ...bitmap, ...footer];

  int get length => header.length + bitmap.length + footer.length;
}

/// The job that prints [image] once (the printer is sent one `PRINT 1` per
/// label; a second copy is a second job).
Pm241Job pm241LabelJob(LabelBitmap image) {
  final packed = pm241PackBitmap(image);
  final header = [
    for (final line in pm241SetupLines) ..._ascii('$line\r\n'),
    ..._ascii(
      'BITMAP $pm241BitmapX,$pm241BitmapY,'
      '${packed.widthBytes},${packed.rows},0,',
    ),
  ];
  return Pm241Job(header, packed.data, _ascii('\r\nPRINT 1\r\n'));
}

/// A test label: a 6-dot border and the QR of [qr] as large as the label
/// allows (whole dots per module), so alignment and sharpness show at a
/// glance. Pure; the app prints it from the settings screen.
LabelBitmap pm241TestLabel(QrMatrix qr) {
  final image = renderTagBitmap(qr, pm241LabelWidthDots, pm241LabelHeightDots);
  const border = 6;
  image.fill(0, 0, pm241LabelWidthDots - 1, border - 1);
  image.fill(
    0,
    pm241LabelHeightDots - border,
    pm241LabelWidthDots - 1,
    pm241LabelHeightDots - 1,
  );
  image.fill(0, 0, border - 1, pm241LabelHeightDots - 1);
  image.fill(
    pm241LabelWidthDots - border,
    0,
    pm241LabelWidthDots - 1,
    pm241LabelHeightDots - 1,
  );
  return image;
}

// ---------------------------------------------------------------------------
// Replies and flow control on ff03.
// ---------------------------------------------------------------------------

enum Pm241EventType {
  /// `01 n`: [Pm241Event.value] more packets may be written.
  credit,

  /// `02 lo hi`: the largest packet, [Pm241Event.value] bytes.
  maxPacket,

  /// `SSSGETPRINTING:DOING`: the label is printing.
  printing,

  /// `SSSGETPRINTING:DONE`: the label is printed.
  done,

  /// `Cmd error:<token>`: [Pm241Event.text] is the token.
  cmdError,

  /// Any other line of text.
  text,
}

class Pm241Event {
  const Pm241Event(this.type, {this.value = 0, this.text = ''});

  final Pm241EventType type;
  final int value;
  final String text;

  /// A line for the print log ("reply: SSSGETPRINTING:DONE").
  String get logLine => switch (type) {
    Pm241EventType.credit => 'flow: +$value credit(s)',
    Pm241EventType.maxPacket => 'flow: max packet $value bytes',
    Pm241EventType.printing => 'reply: SSSGETPRINTING:DOING',
    Pm241EventType.done => 'reply: SSSGETPRINTING:DONE',
    Pm241EventType.cmdError => 'reply: Cmd error:$text',
    Pm241EventType.text => 'reply: $text',
  };

  @override
  String toString() => 'Pm241Event(${type.name}, $value, "$text")';
}

/// Reads one text line the printer sent (without its CRLF).
Pm241Event pm241ParseLine(String line) {
  final text = line.trim();
  if (text.startsWith('SSSGETPRINTING:')) {
    final state = text.substring('SSSGETPRINTING:'.length).toUpperCase();
    if (state == 'DONE') return const Pm241Event(Pm241EventType.done);
    if (state == 'DOING') return const Pm241Event(Pm241EventType.printing);
  }
  if (text.toLowerCase().startsWith('cmd error:')) {
    return Pm241Event(
      Pm241EventType.cmdError,
      text: text.substring('cmd error:'.length).trim(),
    );
  }
  return Pm241Event(Pm241EventType.text, text: text);
}

/// The flow-control state of one connection: how many packets may still be
/// written, the largest packet, and the text the printer has sent.
///
/// Feed it every notification from ff03 ([feed]); it answers what each one
/// meant. Credits and packet size are updated before [feed] returns.
class Pm241Flow {
  int _credits = 0;
  int? _maxPacket;
  final List<int> _partial = [];

  /// Packets that may be written now.
  int get credits => _credits;

  /// The printer's largest packet, null until it says.
  int? get maxPacket => _maxPacket;

  /// The packet size to write: what the printer takes and the link carries
  /// ([linkPayload] = MTU - 3), never less than 1 byte. Until the printer
  /// has said its size, the conservative 20 bytes.
  int packetSize(int linkPayload) {
    var size = _maxPacket ?? pm241DefaultPacketBytes;
    if (linkPayload > 0 && linkPayload < size) size = linkPayload;
    return size < 1 ? 1 : size;
  }

  /// Uses one credit; false (and nothing changes) when there is none.
  bool takeCredit() {
    if (_credits <= 0) return false;
    _credits--;
    return true;
  }

  /// Reads one notification: binary flow-control frames (`01 n`,
  /// `02 lo hi`) and CRLF-ended text lines, in any mix; a line cut across
  /// two notifications is completed by the next.
  List<Pm241Event> feed(List<int> frame) {
    final events = <Pm241Event>[];
    var i = 0;
    while (i < frame.length) {
      // Mid-line: the rest is text.
      if (_partial.isEmpty) {
        final b = frame[i];
        if (b == 0x01 && i + 1 < frame.length) {
          final n = frame[i + 1];
          _credits += n;
          events.add(Pm241Event(Pm241EventType.credit, value: n));
          i += 2;
          continue;
        }
        if (b == 0x02 && i + 2 < frame.length) {
          final size = frame[i + 1] | (frame[i + 2] << 8);
          if (size > 0) _maxPacket = size;
          events.add(Pm241Event(Pm241EventType.maxPacket, value: size));
          i += 3;
          continue;
        }
      }
      final b = frame[i];
      i++;
      if (b == 0x0A) {
        final line = utf8.decode(_partial, allowMalformed: true);
        _partial.clear();
        if (line.trim().isNotEmpty) events.add(pm241ParseLine(line));
      } else {
        _partial.add(b);
        // A runaway with no newline is not a reply: drop it.
        if (_partial.length > 512) _partial.clear();
      }
    }
    return events;
  }
}

/// Hands out a job's bytes one packet per credit.
class Pm241Sender {
  Pm241Sender(this.bytes, this.flow);

  final List<int> bytes;
  final Pm241Flow flow;
  int _offset = 0;
  int _packets = 0;

  bool get finished => _offset >= bytes.length;
  int get sent => _offset;
  int get packets => _packets;

  /// The next packet - at most the packet size for a link that carries
  /// [linkPayload] bytes - and one credit spent on it; null when the job is
  /// finished or there is no credit (wait for the next `01 n`).
  List<int>? next(int linkPayload) {
    if (finished || !flow.takeCredit()) return null;
    final size = flow.packetSize(linkPayload);
    final end = _offset + size > bytes.length ? bytes.length : _offset + size;
    final packet = bytes.sublist(_offset, end);
    _offset = end;
    _packets++;
    return packet;
  }
}

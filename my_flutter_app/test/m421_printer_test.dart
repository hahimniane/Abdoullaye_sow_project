import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/package_labels.dart';
import 'package:my_flutter_app/services/pm241_protocol.dart';

import 'fixtures/fake_printer.dart';

// The Phomemo M421, as measured on a real one on 2026-11-14: it advertises
// as "M421", takes the M221's commands on a head about 896 dots wide (the
// label's left edge is about 43 dots in), grants packet credits like a
// PM-241, and feeds to the next label after EVERY raster.

const _m421Settings = LabelPrinterSettings(
  deviceId: 'AA:BB:CC:DD:EE:03',
  deviceName: 'M421',
);

const _m421Device = PrinterDevice(
  id: 'AA:BB:CC:DD:EE:03',
  name: 'M421',
  rssi: -48,
);

FakePrinterTransport _m421({
  bool answerDone = true,
  bool grantCredits = true,
}) => FakePrinterTransport(
  m421: true,
  devices: const [_m421Device],
  maxWrite: 197,
  maxPacketReply: 182,
  answerDone: answerDone,
  grantCredits: grantCredits,
);

LabelPrinterController _controller(FakePrinterTransport t) =>
    fakeController(t, settings: _m421Settings);

LabelBitmap _label() => LabelBitmap(800, 1180)
  ..fill(0, 0, 799, 2)
  ..fill(40, 40, 400, 400)
  ..fill(500, 900, 799, 1179);

/// How many times [needle] starts in [bytes].
int _count(List<int> bytes, List<int> needle) {
  var n = 0;
  for (var i = 0; i + needle.length <= bytes.length; i++) {
    var hit = true;
    for (var j = 0; j < needle.length; j++) {
      if (bytes[i + j] != needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) n++;
  }
  return n;
}

void main() {
  group('telling an M421 apart', () {
    test('it is told by its name, whatever the shop said before', () {
      for (final name in ['M421', 'm421', 'Phomemo M421', 'M-421']) {
        expect(printerModelForName(name), PrinterModel.m421, reason: name);
        expect(printerNameRecognized(name), isTrue, reason: name);
      }
      // The M221 and the PM-241 keep their own.
      expect(printerModelForName('Q2A1'), PrinterModel.m221);
      expect(printerModelForName('M221'), PrinterModel.m221);
      expect(printerModelForName('PM-241Z-BT-0470'), PrinterModel.pm241);
      // Before the app knew the M421 it was treated as an M221 (a small
      // label in the corner of the 4 x 6): a stored choice does not keep
      // it that way.
      const stale = LabelPrinterSettings(
        deviceId: 'AA:BB:CC:DD:EE:03',
        deviceName: 'M421',
        deviceModels: {'AA:BB:CC:DD:EE:03': PrinterModel.m221},
      );
      expect(stale.model, PrinterModel.m421);
    });

    test('it is listed as a likely printer and prints 4 x 6 by itself', () {
      expect(_m421Device.looksLikePrinter, isTrue);
      expect(_m421Settings.model.isFourBySix, isTrue);
      final size = _m421Settings.packageSize;
      expect(size, PackageLabelSizes.pm241FourBySix);
      expect(size.widthDots, 800);
      expect(size.heightDots, 1180);
    });
  });

  group('the picture over the label', () {
    test('an 800-dot label starts at dot 48 of 864-dot rows', () {
      // Centred on 832 dots it printed 4 mm too far left on the real
      // printer, its left edge off the label (2026-11-14).
      final raster = m421Raster(_label());
      expect(raster.widthBytes, 108);
      expect(raster.rows, 1180);
      expect(raster.x, 48);
      expect(raster.data.length, 108 * 1180);
      // Row 0 is black from dot 48 to dot 847, white outside.
      for (final byte in [0, 5]) {
        expect(raster.data[byte], 0x00, reason: 'byte $byte');
      }
      expect(raster.data[6], 0xFF);
      expect(raster.data[105], 0xFF);
      expect(raster.data[106], 0x00);
      expect(raster.data[107], 0x00);
    });

    test('the M221 packing is unchanged', () {
      final tag = LabelBitmap(406, 203)..fill(0, 0, 405, 0);
      final raster = packRaster(tag, 0, 0);
      expect(raster.widthBytes, m221HeadBytes);
      expect(raster.x, (m221HeadDots - 406) ~/ 2);
    });
  });

  group('an M421 print job', () {
    test('one label is ONE raster, paced by the printer credits', () async {
      final t = _m421();
      final c = _controller(t);
      final image = _label();
      final outcome = await c.printLabels(image: image, what: 'test');
      expect(outcome.ok, isTrue);
      final raster = m421Raster(image);
      final expected = [
        for (final step in m221LabelSteps(raster)) ...step.bytes,
      ];
      expect(t.allBytes, expected);
      // The printer feeds to the next label after every raster: a label
      // sent in bands would waste one label per band.
      expect(_count(t.allBytes, [0x1D, 0x76, 0x30, 0x00, 108, 0x00]), 1);
      expect(t.creditViolations, 0);
      // Packet size = min(182 from the printer, 197 from the link).
      expect(t.writes.every((w) => w.length <= 182), isTrue);
      // No TSPL went out.
      expect(String.fromCharCodes(t.allBytes), isNot(contains('SIZE 100')));
      expect(
        t.events.indexOf('subscribe'),
        lessThan(t.events.indexWhere((e) => e.startsWith('write'))),
      );
    });

    test('waits for "done" and sends the next copy only after it', () async {
      final t = _m421();
      final c = _controller(t);
      final outcome = await c.printLabels(image: _label(), copies: 2);
      expect(outcome.ok, isTrue);
      expect(outcome.printed, 2);
      expect(_count(t.allBytes, m221Footer), 2);
      expect(_count(t.allBytes, [0x1D, 0x76, 0x30, 0x00, 108, 0x00]), 2);
      expect(t.connects, 1);
      expect(t.creditViolations, 0);
    });

    test('no "done" reply fails as not finished, after one label', () async {
      final t = _m421(answerDone: false);
      final c = _controller(t);
      final outcome = await c.printLabels(image: _label(), copies: 2);
      expect(outcome.ok, isFalse);
      expect(outcome.printed, 0);
      expect(outcome.failure, PrintFailure.noCompletion);
      expect(_count(t.allBytes, m221Footer), 1);
    });

    test('a printer that stops granting credits is not flooded', () async {
      final t = _m421(grantCredits: false);
      final c = _controller(t);
      final outcome = await c.printLabels(image: _label());
      expect(outcome.ok, isFalse);
      expect(outcome.failure, PrintFailure.writeFailed);
      expect(t.creditViolations, 0);
      expect(t.writes.length, 7, reason: 'only the 7 packets it granted');
    });

    test('a picture bigger than the label is refused, nothing sent', () async {
      final t = _m421();
      final c = _controller(t);
      final outcome = await c.printLabels(image: LabelBitmap(801, 1180));
      expect(outcome.ok, isFalse);
      expect(t.writes, isEmpty);
    });

    test('the log names the model and the one raster', () async {
      final t = _m421();
      final c = _controller(t);
      await c.printLabels(image: _label(), what: 'package label');
      final text = c.log.entries.map((e) => e.message).join('\n');
      expect(text, contains('Phomemo M421'));
      expect(text, contains('at dot 48 of 864, one raster per label'));
      expect(text, contains('sent: raster 864x1180 dots'));
      expect(text, contains('done: printer finished the label'));
    });
  });

  group('credits and replies in one stream', () {
    test('a reply after a credit does not swallow the next credits', () {
      final flow = Pm241Flow();
      final events = <Pm241Event>[];
      // 01 07, 02 b6 00, then the M421's own binary reply.
      final first = [0x01, 0x07, 0x02, 0xB6, 0x00, 0x1A, 0x3B, 0x04];
      expect(flow.feedFlowOnly(first, events), 5);
      expect(flow.credits, 7);
      expect(flow.maxPacket, 182);
      // A reply alone reads nothing; the credit after it still counts.
      expect(flow.feedFlowOnly([0x1A, 0x0F, 0x0C], events), 0);
      expect(flow.feedFlowOnly([0x01, 0x01], events), 2);
      expect(flow.credits, 8);
    });
  });
}

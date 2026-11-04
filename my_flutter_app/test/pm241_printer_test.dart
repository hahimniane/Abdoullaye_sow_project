import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/package_labels.dart';
import 'package:my_flutter_app/services/pm241_protocol.dart';

import 'fixtures/fake_printer.dart';

const _pmSettings = LabelPrinterSettings(
  deviceId: 'AA:BB:CC:DD:EE:02',
  deviceName: 'PM-241Z-BT-0470',
);

const _pmDevice = PrinterDevice(
  id: 'AA:BB:CC:DD:EE:02',
  name: 'PM-241Z-BT-0470',
  rssi: -50,
);

FakePrinterTransport _pm({
  int maxWrite = 182,
  bool answerDone = true,
  bool grantCredits = true,
  int initialCredits = 7,
  String? extraReply,
}) => FakePrinterTransport(
  pm241: true,
  devices: const [_pmDevice],
  maxWrite: maxWrite,
  answerDone: answerDone,
  grantCredits: grantCredits,
  initialCredits: initialCredits,
  extraReply: extraReply,
);

LabelPrinterController _controller(FakePrinterTransport t) =>
    fakeController(t, settings: _pmSettings);

LabelBitmap _label() => LabelBitmap(800, 1180)
  ..fill(40, 40, 400, 400)
  ..fill(500, 900, 700, 1000);

void main() {
  group('telling the printers apart', () {
    test('the PM-241 is told by its name, the M221 is the rest', () {
      for (final name in [
        'PM-241Z-BT-0470',
        'pm-241z-bt',
        'PM241Z',
        'Phomemo PM-241',
      ]) {
        expect(printerModelForName(name), PrinterModel.pm241, reason: name);
      }
      for (final name in ['Q2A1', 'M221', 'Phomemo M221', '', 'iPhone']) {
        expect(printerModelForName(name), PrinterModel.m221, reason: name);
      }
    });

    test('a PM-241 in a scan is listed as a likely printer', () {
      expect(_pmDevice.looksLikePrinter, isTrue);
    });

    test('a PM-241 prints the 4 x 6 package size by itself', () {
      expect(_pmSettings.model, PrinterModel.pm241);
      final size = _pmSettings.packageSize;
      expect(size, PackageLabelSizes.pm241FourBySix);
      expect(size.widthDots, 800);
      expect(size.heightDots, 1180);
      // The M221 keeps its own, saved, size.
      const m221 = LabelPrinterSettings(deviceName: 'Q2A1');
      expect(m221.model, PrinterModel.m221);
      expect(m221.packageSize, PackageLabelSizes.seventyByEighty);
      expect(
        m221.copyWith(packageSizeId: packageSize50x80mm).packageSize,
        PackageLabelSizes.fiftyByEighty,
      );
      // The size is not saved over the M221's choice.
      expect(_pmSettings.packageSizeId, packageSize70x80mm);
    });
  });

  group('a PM-241 print job', () {
    test(
      'sends exactly the TSPL job, in packets that obey the credits',
      () async {
        final t = _pm();
        final c = _controller(t);
        final image = _label();
        final outcome = await c.printLabels(image: image, what: 'test');
        expect(outcome.ok, isTrue);
        expect(t.allBytes, pm241LabelJob(image).bytes);
        expect(t.creditViolations, 0);
        // Packet size = min(244 from the printer, 182 from the link).
        expect(t.writes.every((w) => w.length <= 182), isTrue);
        expect(t.writes.first.length, 182);
        final text = utf8.decode(t.allBytes, allowMalformed: true);
        expect(text, startsWith('SIZE 100 mm, 150 mm\r\n'));
        expect(text, endsWith('\r\nPRINT 1\r\n'));
        expect(text, isNot(contains('END')));
        // Nothing of the M221 protocol went out.
        expect(t.writes.any((w) => w.length == 3 && w[0] == 0x1F), isFalse);
        expect(
          t.events.indexOf('subscribe'),
          lessThan(t.events.indexWhere((e) => e.startsWith('write'))),
        );
      },
    );

    test('uses the printer packet size when the link is wider', () async {
      final t = _pm(maxWrite: 512);
      final c = _controller(t);
      await c.printLabels(image: _label());
      expect(t.writes.first.length, 244);
      expect(t.writes.every((w) => w.length <= 244), isTrue);
    });

    test('keeps to 20 bytes while the printer has not said its size', () async {
      final t = _pm();
      t.maxPacketReply = 0; // announces nothing useful
      final c = _controller(t);
      await c.printLabels(image: LabelBitmap(8, 8));
      expect(t.writes.first.length, 20);
      expect(t.writes.every((w) => w.length <= 20), isTrue);
    });

    test('waits for DONE and prints the next copy only after it', () async {
      final t = _pm();
      final c = _controller(t);
      final image = LabelBitmap(64, 16)..fill(0, 0, 10, 10);
      final outcome = await c.printLabels(image: image, copies: 3);
      expect(outcome.ok, isTrue);
      expect(outcome.printed, 3);
      final job = pm241LabelJob(image).bytes;
      expect(t.allBytes, [...job, ...job, ...job]);
      expect(t.connects, 1);
    });

    test('no DONE reply fails as not finished, after one job', () async {
      final t = _pm(answerDone: false);
      final c = _controller(t);
      final outcome = await c.printLabels(
        image: LabelBitmap(64, 16),
        copies: 4,
      );
      expect(outcome.failure, PrintFailure.noCompletion);
      expect(outcome.printed, 0);
      expect(
        t.writes
            .where(
              (w) =>
                  utf8.decode(w, allowMalformed: true).endsWith('PRINT 1\r\n'),
            )
            .length,
        1,
      );
      expect(c.log.text(), contains('done: no reply'));
      expect(c.status, isNot(PrinterStatus.printing));
    });

    test(
      'a printer that grants no credit fails cleanly, not forever',
      () async {
        final t = _pm(grantCredits: false, initialCredits: 2);
        final c = _controller(t);
        final outcome = await c.printLabels(image: _label());
        expect(outcome.failure, PrintFailure.writeFailed);
        // Exactly the two credits it had were used.
        expect(t.writes.length, 2);
        expect(t.creditViolations, 0);
        expect(c.log.text(), contains('flow: no credit'));
        expect(c.busy, isFalse);
      },
    );

    test('a Cmd error reply is logged and the print still succeeds', () async {
      final t = _pm(extraReply: 'Cmd error:END');
      final c = _controller(t);
      final outcome = await c.printLabels(image: LabelBitmap(64, 16));
      expect(outcome.ok, isTrue);
      expect(c.log.text(), contains('reply: Cmd error:END'));
    });

    test('a picture bigger than the label is refused, nothing sent', () async {
      final t = _pm();
      final c = _controller(t);
      final outcome = await c.printLabels(image: LabelBitmap(900, 1180));
      expect(outcome.failure, PrintFailure.writeFailed);
      expect(t.writes, isEmpty);
    });

    test('the log names the model, the TSPL job and the replies', () async {
      final t = _pm(extraReply: 'Cmd error:END');
      final c = _controller(t);
      await c.printLabels(image: _label(), what: 'package CL-K7M4P2');
      final log = c.log.text();
      expect(log, contains('model: Phomemo PM-241 (TSPL)'));
      expect(log, contains('connected: Phomemo PM-241 (TSPL)'));
      expect(log, contains('print: 1 x package CL-K7M4P2 800x1180 dots'));
      expect(log, contains('flow: max packet 244 bytes'));
      expect(log, contains('sent: TSPL job'));
      expect(log, contains('reply: SSSGETPRINTING:DOING'));
      expect(log, contains('reply: SSSGETPRINTING:DONE'));
      // One line per packet would bury the rest: credits of 1 are not logged.
      expect(log, isNot(contains('+1 credit')));
      final report = c.logReport(app: 'test');
      expect(report, contains('model: Phomemo PM-241 (TSPL)'));
      expect(report, contains('package label: 4x6pm241'));
      expect(report, contains('= 800x1180 dots'));
    });

    test('the status check does not send M221 bytes to a PM-241', () async {
      final t = _pm();
      final c = _controller(t);
      expect(await c.checkStatus(), isNull);
      expect(t.writes, isEmpty);
    });

    test('reconnects once when the connection drops during a label', () async {
      final t = _pm();
      t.dropOnWrite = 3;
      final c = _controller(t);
      final outcome = await c.printLabels(image: _label());
      expect(outcome.ok, isTrue);
      expect(t.connects, 2);
      expect(c.log.text(), contains('reconnecting once'));
    });
  });

  group('the M221 is untouched', () {
    test('an M221 still gets the same bytes and no TSPL', () async {
      final t = FakePrinterTransport();
      final c = fakeController(t);
      final image = renderTestFrame(406, 203);
      final outcome = await c.printLabels(image: image);
      expect(outcome.ok, isTrue);
      final expected = m221LabelSteps(
        packRaster(image, 0, 0),
        density: c.settings.density,
        speed: c.settings.speed,
      ).expand((s) => s.bytes).toList();
      expect(t.allBytes, expected);
      expect(c.log.text(), contains('model: Phomemo M221'));
      expect(c.log.text(), contains('reply: 1a 0f 0c'));
    });
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/tag_labels.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures/fake_printer.dart';

LabelBitmap _tag() => renderTagBitmap(
  tagQrMatrix(inventoryTagLink('IT-K7M4P2')),
  TagLabelSize.twoByOne.widthDots,
  TagLabelSize.twoByOne.heightDots,
);

/// The bytes of one label exactly as the protocol lays them out.
List<int> _oneLabel(LabelPrinterSettings s, LabelBitmap image) =>
    m221LabelSteps(
      packRaster(image, s.xOffset, s.yOffset),
      density: s.density,
      speed: s.speed,
    ).expand((step) => step.bytes).toList();

void main() {
  group('a print job over a fake printer', () {
    test('subscribes to replies before it sends a single byte', () async {
      final printer = FakePrinterTransport();
      final c = fakeController(printer);
      final outcome = await c.printLabels(image: _tag());
      expect(outcome.ok, isTrue);
      final firstWrite = printer.events.indexWhere(
        (e) => e.startsWith('write'),
      );
      final subscribe = printer.events.indexOf('subscribe');
      expect(subscribe, greaterThanOrEqualTo(0));
      expect(subscribe, lessThan(firstWrite));
      expect(printer.events.first, 'connect AA:BB:CC:DD:EE:01');
    });

    test(
      'sends speed, density, media, header, raster, footer in order',
      () async {
        final printer = FakePrinterTransport();
        final c = fakeController(
          printer,
          settings: const LabelPrinterSettings(
            deviceId: 'AA:BB:CC:DD:EE:01',
            density: 3,
            speed: 4,
            xOffset: 9,
            yOffset: 4,
          ),
        );
        final image = _tag();
        await c.printLabels(image: image);
        expect(printer.writes[0], [0x1B, 0x4E, 0x0D, 4]);
        expect(printer.writes[1], [0x1B, 0x4E, 0x04, 9]);
        expect(printer.writes[2], [0x1F, 0x11, 0x0A]);
        expect(printer.writes[3], [0x1D, 0x76, 0x30, 0x00, 72, 0x00, 207, 0]);
        expect(printer.writes.last, m221Footer);
        expect(printer.allBytes, _oneLabel(c.settings, image));
      },
    );

    test(
      'never writes more than 128 bytes, nor more than the link allows',
      () async {
        for (final max in [182, 100, 20]) {
          final printer = FakePrinterTransport(maxWrite: max);
          final c = fakeController(printer);
          await c.printLabels(image: _tag());
          final limit = max < 128 ? max : 128;
          expect(
            printer.writes.every((w) => w.length <= limit),
            isTrue,
            reason: 'max $max',
          );
          expect(printer.writes.map((w) => w.length), contains(limit));
        }
      },
    );

    test('prints each copy in turn, the same label every time', () async {
      final printer = FakePrinterTransport();
      final c = fakeController(printer);
      final progress = <int>[];
      c.addListener(() => progress.add(c.progressDone));
      final image = _tag();
      final outcome = await c.printLabels(image: image, copies: 3);
      expect(outcome.ok, isTrue);
      expect(outcome.printed, 3);
      final one = _oneLabel(c.settings, image);
      expect(printer.allBytes, [...one, ...one, ...one]);
      expect(printer.writes.where((w) => _eq(w, m221Footer)).length, 3);
      expect(progress.toSet(), containsAll([1, 2, 3]));
      // One connection for the whole run.
      expect(printer.connects, 1);
    });

    test('waits for the done reply between copies', () async {
      final printer = FakePrinterTransport(answerDone: false);
      final c = fakeController(printer);
      final outcome = await c.printLabels(image: _tag(), copies: 5);
      expect(outcome.failure, PrintFailure.noCompletion);
      expect(outcome.printed, 0);
      // It stopped after the first footer instead of sending the rest.
      expect(printer.writes.where((w) => _eq(w, m221Footer)).length, 1);
      expect(c.log.text(), contains('done: no reply'));
      expect(c.status, isNot(PrinterStatus.printing));
    });

    test(
      'a printer that says it has no labels reads as out of paper',
      () async {
        final printer = FakePrinterTransport(
          answerDone: false,
          paperReply: [0x1A, 0x06, 0x88],
        );
        final c = fakeController(printer);
        final outcome = await c.printLabels(image: _tag());
        expect(outcome.failure, PrintFailure.outOfPaper);
      },
    );

    test('stops after the current label when cancelled', () async {
      final printer = FakePrinterTransport();
      final c = fakeController(printer);
      var asked = false;
      c.addListener(() {
        if (c.progressDone == 1 && !asked) {
          asked = true;
          c.requestCancel();
        }
      });
      final outcome = await c.printLabels(image: _tag(), copies: 10);
      expect(outcome.cancelled, isTrue);
      expect(outcome.printed, 1);
      expect(printer.writes.where((w) => _eq(w, m221Footer)).length, 1);
      expect(c.busy, isFalse);
    });

    test('reconnects once when the connection drops during a label', () async {
      final printer = FakePrinterTransport()..dropOnWrite = 10;
      final c = fakeController(printer);
      final outcome = await c.printLabels(image: _tag(), copies: 2);
      expect(outcome.ok, isTrue);
      expect(printer.connects, 2);
      // Subscribed again on the new connection before writing to it.
      final second = printer.events.lastIndexOf('connect AA:BB:CC:DD:EE:01');
      expect(printer.events[second + 1], 'subscribe');
    });

    test('a connection that keeps dropping fails as connection lost', () async {
      final printer = FakePrinterTransport()..dropOnWrite = 10;
      final c = fakeController(printer);
      final first = await c.printLabels(image: _tag());
      expect(first.ok, isTrue);
      // One retry per run: a second drop in the same run is the end.
      final outcome = await _printWithTwoDrops(c, printer);
      expect(outcome.failure, PrintFailure.connectionLost);
    });
  });

  group('friendly failures', () {
    test('Bluetooth off', () async {
      final printer = FakePrinterTransport(adapter: PrinterAdapterState.off);
      final c = fakeController(printer);
      expect(
        (await c.printLabels(image: _tag())).failure,
        PrintFailure.bluetoothOff,
      );
      expect(await c.scan(), PrintFailure.bluetoothOff);
      expect(printer.writes, isEmpty);
    });

    test('permission denied', () async {
      final printer = FakePrinterTransport(
        adapter: PrinterAdapterState.unauthorized,
      );
      final c = fakeController(printer);
      expect(await c.scan(), PrintFailure.permissionDenied);
      printer.adapter = PrinterAdapterState.on;
      printer.scanError = const PrinterException(
        PrintFailure.permissionDenied,
        'Permission android.permission.BLUETOOTH_SCAN required',
      );
      expect(await c.scan(), PrintFailure.permissionDenied);
    });

    test('no printer chosen yet', () async {
      final printer = FakePrinterTransport();
      final c = fakeController(printer, settings: const LabelPrinterSettings());
      final outcome = await c.printLabels(image: _tag());
      expect(outcome.failure, PrintFailure.noPrinterChosen);
      expect(printer.events, isEmpty);
    });

    test('printer not found: tries a scan, then says so', () async {
      final printer = FakePrinterTransport(devices: const [])
        ..connectError = const PrinterException(PrintFailure.notFound);
      final c = fakeController(printer);
      final outcome = await c.printLabels(image: _tag());
      expect(outcome.failure, PrintFailure.notFound);
      expect(printer.events, ['connect AA:BB:CC:DD:EE:01', 'scan']);
    });

    test('found on a second look: connects and prints', () async {
      final printer = FakePrinterTransport()
        ..connectError = const PrinterException(PrintFailure.connectFailed);
      final c = fakeController(printer);
      final outcome = await c.printLabels(image: _tag());
      expect(outcome.ok, isTrue);
      expect(printer.events.take(4), [
        'connect AA:BB:CC:DD:EE:01',
        'scan',
        'connect AA:BB:CC:DD:EE:01',
        'subscribe',
      ]);
    });

    test('a second job while one runs is refused, not queued', () async {
      final printer = FakePrinterTransport();
      final c = fakeController(printer);
      final first = c.printLabels(image: _tag(), copies: 2);
      final second = await c.printLabels(image: _tag());
      expect(second.failure, PrintFailure.busy);
      expect((await first).ok, isTrue);
    });
  });

  group('scanning and choosing', () {
    test('lists printers by signal and remembers the chosen one', () async {
      final printer = FakePrinterTransport(
        devices: const [
          PrinterDevice(id: 'far', name: 'Q2FAR', rssi: -90),
          PrinterDevice(id: 'near', name: 'Q2NEAR', rssi: -40),
        ],
      );
      final c = fakeController(printer, settings: const LabelPrinterSettings());
      expect(await c.scan(), isNull);
      expect(c.found.map((d) => d.id), ['near', 'far']);
      await c.choose(c.found.first);
      expect(c.settings.deviceId, 'near');
      expect(c.settings.deviceName, 'Q2NEAR');
      expect(c.log.text(), contains('scan: found "Q2NEAR"'));
    });

    // Regression: the first real scan on an iPhone found nothing because the
    // app asked only for devices advertising service ff00, and iOS does not
    // always report that id. Every named device is offered now; likely
    // printers come first and the service id only ranks them.
    test(
      'an open scan lists every named device, likely printers first',
      () async {
        final printer = FakePrinterTransport(
          devices: const [
            PrinterDevice(id: 'tv', name: 'Living room TV', rssi: -30),
            PrinterDevice(id: 'q2', name: 'Q2A1B2C3', rssi: -70),
            PrinterDevice(
              id: 'svc',
              name: 'LabelThing',
              rssi: -80,
              advertisesPrinterService: true,
            ),
            PrinterDevice(id: 'blank', name: '', rssi: -20),
          ],
        );
        final c = fakeController(
          printer,
          settings: const LabelPrinterSettings(),
        );
        expect(await c.scan(), isNull);
        // Likely printers (serial-style name, or the service) before the rest,
        // each group by signal; the nameless advertisement is not offered.
        expect(c.found.map((d) => d.id), ['q2', 'svc', 'tv']);
        final log = c.log.text();
        expect(log, contains('scan: start (8 s, any device)'));
        expect(
          log,
          contains('scan: found "LabelThing" svc rssi -80 service ff00'),
        );
        expect(
          log,
          contains('3 named device(s), 2 likely printer(s), 1 unnamed skipped'),
        );
      },
    );

    test('a status check logs the raw replies and reads the battery', () async {
      final printer = FakePrinterTransport(paperReply: [0x1A, 0x06, 0x89]);
      final c = fakeController(printer);
      expect(await c.checkStatus(), isNull);
      expect(c.batteryPercent, 87);
      expect(c.log.text(), contains('status battery: 1a 04 57'));
      expect(c.log.text(), contains('status paper: 1a 06 89'));
      expect(c.log.text(), contains('status cover: no reply'));
    });
  });

  group('settings and log', () {
    test('settings survive a round trip and clamp bad values', () {
      const s = LabelPrinterSettings(
        deviceId: 'x',
        deviceName: 'Q2',
        sizeId: tagSizeCustom,
        customWidthMm: 45,
        customHeightMm: 28,
        density: 7,
        speed: 3,
        xOffset: -12,
        yOffset: 8,
      );
      expect(LabelPrinterSettings.fromJson(s.toJson()), s);
      final bad = LabelPrinterSettings.fromJson({
        'sizeId': 'huge',
        'density': 40,
        'speed': -2,
        'xOffset': 9999,
        'yOffset': 'nope',
        'customWidthMm': 500,
      });
      expect(bad.sizeId, tagSize2x1in);
      expect(bad.density, 8);
      expect(bad.speed, 1);
      expect(bad.xOffset, labelPrinterMaxXOffset);
      expect(bad.yOffset, 0);
      expect(bad.customWidthMm, tagMaxWidthMm);
    });

    test('settings are kept on the phone', () async {
      SharedPreferences.setMockInitialValues({});
      const store = LabelPrinterStore();
      expect(await store.load(), const LabelPrinterSettings());
      const s = LabelPrinterSettings(deviceId: 'id1', density: 4, xOffset: 16);
      await store.save(s);
      expect(await store.load(), s);
    });

    test(
      'the log keeps the last 60 events and its report names the setup',
      () async {
        final printer = FakePrinterTransport();
        final c = fakeController(printer);
        for (var i = 0; i < 80; i++) {
          c.log.add('event $i');
        }
        expect(c.log.entries.length, 60);
        expect(c.log.entries.first.message, 'event 20');
        final report = c.logReport(app: '1.0.12');
        expect(report, contains('label: 2x1in 50.8 × 25.4 mm = 406x203 dots'));
        expect(report, contains('density 6, speed 5, x 0, y 0'));
        expect(report, contains('event 79'));
      },
    );
  });
}

Future<PrintOutcome> _printWithTwoDrops(
  LabelPrinterController c,
  FakePrinterTransport printer,
) async {
  // Drop on the 3rd write of the first attempt and again on the 3rd write
  // of the reconnected attempt.
  var drops = 0;
  late void Function() arm;
  arm = () {
    printer.dropOnWrite = printer.writes.length + 3;
    drops++;
  };
  arm();
  c.log.addListener(() {
    if (drops == 1 && c.log.entries.last.message.startsWith('subscribe')) {
      arm();
    }
  });
  return c.printLabels(image: _tag());
}

bool _eq(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

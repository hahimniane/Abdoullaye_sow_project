import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/generic_label_printer.dart';
import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/pm241_protocol.dart';

import 'fixtures/fake_printer.dart';

/// Printing and printer details on an "other" 4 x 6 in printer (beta), over
/// a fake Bluetooth printer with a made-up name.

const _id = 'AA:BB:CC:DD:EE:09';

const _device = PrinterDevice(
  id: _id,
  name: 'Test Printer X1',
  rssi: -50,
  serviceUuids: ['0000ff00-0000-1000-8000-00805f9b34fb'],
);

final _settings = const LabelPrinterSettings(
  deviceId: _id,
  deviceName: 'Test Printer X1',
).copyWith(deviceModels: {_id: PrinterModel.generic4x6});

const _gatt = PrinterGattInfo(
  mtu: 185,
  writeServiceUuid: '0000ff00-0000-1000-8000-00805f9b34fb',
  writeCharUuid: '0000ff02-0000-1000-8000-00805f9b34fb',
  notifyCharUuid: '0000ff03-0000-1000-8000-00805f9b34fb',
  writeWithoutResponse: true,
  services: [
    GattServiceInfo('0000ff00-0000-1000-8000-00805f9b34fb', [
      GattCharacteristicInfo(
        '0000ff02-0000-1000-8000-00805f9b34fb',
        GattProps(writeWithoutResponse: true),
      ),
      GattCharacteristicInfo(
        '0000ff03-0000-1000-8000-00805f9b34fb',
        GattProps(notify: true),
      ),
    ]),
  ],
);

FakePrinterTransport _transport({
  int maxWrite = 182,
  List<List<int>> subscribeReplies = const [],
}) => FakePrinterTransport(
  devices: const [_device],
  maxWrite: maxWrite,
  gatt: _gatt,
  subscribeReplies: subscribeReplies,
);

LabelBitmap _label() => LabelBitmap(800, 1180)
  ..fill(40, 40, 400, 400)
  ..fill(500, 900, 700, 1000);

void main() {
  group('a print job on an other 4 x 6 printer', () {
    test(
      'sends exactly the PM-241 TSPL job, asking for a generic link',
      () async {
        final t = _transport();
        final c = fakeController(t, settings: _settings);
        final image = _label();
        final outcome = await c.printLabels(image: image, what: 'test');
        expect(outcome.ok, isTrue);
        expect(t.lastConnectGeneric, isTrue);
        expect(t.allBytes, pm241LabelJob(image).bytes);
        final text = utf8.decode(t.allBytes, allowMalformed: true);
        expect(text, startsWith('SIZE 100 mm, 150 mm\r\nGAP 3 mm, 0 mm\r\n'));
        expect(text, contains('DIRECTION 0\r\n'));
        expect(text, isNot(contains('DIRECTION 1')));
        expect(text, endsWith('\r\nPRINT 1\r\n'));
        expect(c.log.text(), contains('model: Other 4x6 Bluetooth printer'));
        expect(c.log.text(), contains('done: job sent'));
      },
    );

    test('writes in chunks of the link size, not more', () async {
      for (final max in [182, 100, 20]) {
        final t = _transport(maxWrite: max);
        final c = fakeController(t, settings: _settings);
        await c.printLabels(image: _label());
        expect(t.writes.every((w) => w.length <= max), isTrue, reason: '$max');
        expect(t.writes.first.length, max);
      }
    });

    test('never waits for flow-control credits', () async {
      // A PM-241 granting no credits would stall; this model has none.
      final t = _transport();
      final c = fakeController(t, settings: _settings);
      final outcome = await c.printLabels(image: _label());
      expect(outcome.ok, isTrue);
      expect(c.log.text(), isNot(contains('flow:')));
    });

    test('prints each copy as its own job, on one connection', () async {
      final t = _transport();
      final c = fakeController(t, settings: _settings);
      final image = LabelBitmap(64, 16)..fill(0, 0, 10, 10);
      final outcome = await c.printLabels(image: image, copies: 3);
      expect(outcome.ok, isTrue);
      expect(outcome.printed, 3);
      final job = pm241LabelJob(image).bytes;
      expect(t.allBytes, [...job, ...job, ...job]);
      expect(t.connects, 1);
    });

    test('pauses between chunks and after the job', () async {
      final pauses = <Duration>[];
      final t = _transport();
      final c = LabelPrinterController(
        transport: t,
        store: MemoryPrinterStore(_settings),
        pause: (d) async => pauses.add(d),
        idleDisconnect: Duration.zero,
      );
      await c.updateSettings(_settings);
      await c.printLabels(image: LabelBitmap(64, 16));
      expect(pauses, contains(genericAfterConnectGap));
      expect(pauses.where((d) => d == genericChunkGap), isNotEmpty);
      expect(pauses.last, genericAfterJobGap);
    });

    test(
      'a connection lost mid-label reconnects once and resends it',
      () async {
        final t = _transport()..dropOnWrite = 2;
        final c = fakeController(t, settings: _settings);
        final image = _label();
        final outcome = await c.printLabels(image: image);
        expect(outcome.ok, isTrue);
        expect(t.connects, 2);
        expect(c.log.text(), contains('reconnecting once'));
        // The whole job went out again after the second connection.
        final job = pm241LabelJob(image).bytes;
        expect(t.allBytes.length, greaterThanOrEqualTo(job.length));
        expect(t.allBytes.sublist(t.allBytes.length - job.length), job);
      },
    );

    test('a printer with nothing to write to fails and says why', () async {
      final t = _transport()
        ..connectError = const PrinterException(
          PrintFailure.notAPrinter,
          'no writable characteristic',
          _gatt,
        );
      final c = fakeController(t, settings: _settings);
      final outcome = await c.printLabels(image: _label());
      expect(outcome.failure, PrintFailure.notAPrinter);
      expect(t.writes, isEmpty);
      expect(c.log.text(), contains('print: failed notAPrinter'));
    });

    test('a picture that does not fit is refused, nothing sent', () async {
      final t = _transport();
      final c = fakeController(t, settings: _settings);
      final outcome = await c.printLabels(image: LabelBitmap(900, 1180));
      expect(outcome.failure, PrintFailure.writeFailed);
      expect(t.writes, isEmpty);
    });

    test('the PM-241 and M221 do not ask for a generic link', () async {
      final pm = FakePrinterTransport(pm241: true);
      await fakeController(
        pm,
        settings: const LabelPrinterSettings(
          deviceId: 'AA:BB:CC:DD:EE:01',
          deviceName: 'PM-241Z-BT-0470',
        ),
      ).printLabels(image: LabelBitmap(64, 16));
      expect(pm.lastConnectGeneric, isFalse);
      final m = FakePrinterTransport();
      await fakeController(m).printLabels(image: LabelBitmap(64, 16));
      expect(m.lastConnectGeneric, isFalse);
    });
  });

  group('choosing the kind of printer', () {
    test('is remembered per device and saved', () async {
      final store = MemoryPrinterStore(
        const LabelPrinterSettings(
          deviceId: _id,
          deviceName: 'Test Printer X1',
        ),
      );
      final c = fakeController(
        _transport(),
        settings: const LabelPrinterSettings(
          deviceId: _id,
          deviceName: 'Test Printer X1',
        ),
        store: store,
      );
      expect(c.model, PrinterModel.m221);
      await c.setDeviceModel(PrinterModel.generic4x6);
      expect(c.model, PrinterModel.generic4x6);
      expect(store.value.deviceModels, {_id: PrinterModel.generic4x6});
      // Forgetting the printer keeps the answer for when it is chosen again.
      await c.forget();
      expect(store.value.deviceModels, {_id: PrinterModel.generic4x6});
      await c.choose(_device);
      expect(c.model, PrinterModel.generic4x6);
      await c.setDeviceModel(null);
      expect(c.model, PrinterModel.m221);
      expect(store.value.deviceModels, isEmpty);
    });

    test('lets go of a connection made the other way', () async {
      final t = _transport();
      final c = fakeController(
        t,
        settings: const LabelPrinterSettings(
          deviceId: _id,
          deviceName: 'Test Printer X1',
        ),
      );
      await c.printLabels(image: LabelBitmap(64, 16));
      expect(t.lastConnectGeneric, isFalse);
      expect(c.isConnected, isTrue);
      await c.setDeviceModel(PrinterModel.generic4x6);
      expect(c.isConnected, isFalse);
      await c.printLabels(image: LabelBitmap(64, 16));
      expect(t.lastConnectGeneric, isTrue);
      expect(t.connects, 2);
    });
  });

  group('printer details', () {
    test(
      'connects, reads the layout and keeps the first notifications',
      () async {
        final t = _transport(
          subscribeReplies: const [
            [0x01, 0x07],
            [0xAA],
          ],
        );
        final c = fakeController(t, settings: _settings);
        await c.scan();
        final d = await c.collectDiagnostics(
          platform: 'android',
          appVersion: '1.0.25+60',
        );
        expect(t.lastConnectGeneric, isTrue);
        expect(d.deviceName, 'Test Printer X1');
        expect(d.gatt, same(_gatt));
        expect(d.advertisedServiceUuids, [
          '0000ff00-0000-1000-8000-00805f9b34fb',
        ]);
        expect(d.notifyFrames, [
          [0x01, 0x07],
          [0xAA],
        ]);
        expect(d.error, isEmpty);
        // Nothing was printed for it.
        expect(t.writes, isEmpty);
        final text = formatPrinterDiagnostics(d);
        expect(text, contains('01 07'));
        expect(text, contains('used: service 0000ff00'));
      },
    );

    test('a failed connection still answers, with the reason', () async {
      final t = _transport()
        ..connectError = const PrinterException(
          PrintFailure.notAPrinter,
          'no writable characteristic',
          _gatt,
        );
      final c = fakeController(t, settings: _settings);
      final d = await c.collectDiagnostics(platform: 'ios', appVersion: '1');
      expect(d.error, contains('notAPrinter'));
      expect(d.error, contains('no writable characteristic'));
      expect(d.gatt, same(_gatt));
      expect(c.busy, isFalse);
    });

    test('a failed print is remembered for the details', () async {
      final t = _transport()
        ..connectError = const PrinterException(
          PrintFailure.notAPrinter,
          'no writable characteristic',
          _gatt,
        );
      final c = fakeController(t, settings: _settings);
      await c.printLabels(image: _label());
      // The printer answers now; the details still carry what went wrong.
      final d = await c.collectDiagnostics(platform: 'ios', appVersion: '1');
      expect(d.error, contains('notAPrinter'));
      expect(d.gatt, isNotNull);
    });

    test('with no printer chosen it says so and connects to nothing', () async {
      final t = _transport();
      final c = fakeController(t, settings: const LabelPrinterSettings());
      final d = await c.collectDiagnostics(platform: 'ios', appVersion: '1');
      expect(d.error, PrintFailure.noPrinterChosen.name);
      expect(t.connects, 0);
    });

    test(
      'what was learned about one printer is not kept for the next',
      () async {
        final t = _transport();
        final c = fakeController(t, settings: _settings);
        await c.collectDiagnostics(platform: 'ios', appVersion: '1');
        await c.choose(
          const PrinterDevice(id: 'AA:BB:CC:DD:EE:0B', name: 'Test Printer Y2'),
        );
        t.gatt = null;
        final d = await c.collectDiagnostics(platform: 'ios', appVersion: '1');
        expect(d.gatt, isNull);
        expect(d.notifyFrames, isEmpty);
      },
    );
  });

  group('the PM-241 is untouched', () {
    test('its job and flow control are what they were', () async {
      final t = FakePrinterTransport(pm241: true);
      final c = fakeController(
        t,
        settings: const LabelPrinterSettings(
          deviceId: 'AA:BB:CC:DD:EE:01',
          deviceName: 'PM-241Z-BT-0470',
        ),
      );
      final image = _label();
      await c.printLabels(image: image);
      expect(t.allBytes, pm241LabelJob(image).bytes);
      expect(t.creditViolations, 0);
      expect(c.model, PrinterModel.pm241);
    });
  });
}

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/generic_label_printer.dart';
import 'package:my_flutter_app/services/label_printer.dart';

/// "Other" 4 x 6 in printers (beta): picking the characteristic to write
/// to, chunk sizes, the printer details text, and the per-device choice.

const _w = GattProps(write: true);
const _wnr = GattProps(writeWithoutResponse: true);
const _n = GattProps(notify: true);
const _r = GattProps(read: true);

GattServiceInfo _svc(String uuid, List<GattCharacteristicInfo> cs) =>
    GattServiceInfo(uuid, cs);
GattCharacteristicInfo _chr(String uuid, GattProps p) =>
    GattCharacteristicInfo(uuid, p);

const _base = '-0000-1000-8000-00805f9b34fb';

void main() {
  group('uuids', () {
    test('short forms read as the Bluetooth-base form', () {
      expect(normalizeUuid('ff00'), '0000ff00$_base');
      expect(normalizeUuid('0000FF00'), '0000ff00$_base');
      expect(normalizeUuid('0000ff00$_base'), '0000ff00$_base');
      expect(normalizeUuid('{0000FF00$_base}'), '0000ff00$_base');
    });

    test('a 32-digit id gets its dashes, others are only lower-cased', () {
      expect(
        normalizeUuid('49535343FE7D4AE58FA99FAFD205E455'),
        '49535343-fe7d-4ae5-8fa9-9fafd205e455',
      );
      expect(normalizeUuid(' Hello '), 'hello');
    });
  });

  group('where to write', () {
    test('the table is in the order of the brief', () {
      expect(genericUartServices.map((e) => (e.service, e.write)).toList(), [
        ('0000ff00', '0000ff02'),
        ('000018f0', '00002af1'),
        (
          '49535343-fe7d-4ae5-8fa9-9fafd205e455',
          '49535343-8841-43f4-a8d4-ecbe34729bb3',
        ),
        (
          'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
          'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
        ),
        ('0000ae30', '0000ae01'),
      ]);
    });

    test('each known service is found with its own write characteristic', () {
      for (final known in genericUartServices) {
        final target = pickGenericWriteTarget([
          _svc('1800', [_chr('2a00', _r)]),
          _svc(known.service, [_chr(known.write, _wnr)]),
        ]);
        expect(target, isNotNull, reason: known.service);
        expect(
          normalizeUuid(target!.serviceUuid),
          normalizeUuid(known.service),
        );
        expect(
          normalizeUuid(target.characteristicUuid),
          normalizeUuid(known.write),
        );
        expect(target.fromTable, isTrue);
        expect(target.writeWithoutResponse, isTrue);
      }
    });

    test('an earlier table entry beats a later one, whatever the order', () {
      final target = pickGenericWriteTarget([
        _svc('0000ae30', [_chr('0000ae01', _w)]),
        _svc('000018f0', [_chr('00002af1', _w), _chr('00002af0', _n)]),
        _svc('0000ff00', [_chr('0000ff02', _w), _chr('0000ff03', _n)]),
      ]);
      expect(normalizeUuid(target!.serviceUuid), '0000ff00$_base');
      expect(normalizeUuid(target.notifyUuid), '0000ff03$_base');
    });

    test('write with response is used when that is all it has', () {
      final target = pickGenericWriteTarget([
        _svc('ff00', [_chr('ff02', _w)]),
      ]);
      expect(target!.writeWithoutResponse, isFalse);
    });

    test('a table service whose characteristic is not writable is skipped', () {
      final target = pickGenericWriteTarget([
        _svc('ff00', [_chr('ff02', _r)]),
        _svc('ae30', [_chr('ae01', _w)]),
      ]);
      expect(normalizeUuid(target!.serviceUuid), '0000ae30$_base');
    });

    test('with no known service, any writable characteristic is used', () {
      final target = pickGenericWriteTarget([
        _svc('1800', [_chr('2a00', _w)]), // never a print channel
        _svc('180a', [_chr('2a29', _w)]),
        _svc('aaaa0000-0000-1000-8000-00805f9b34fb', [
          _chr('aaaa0001-0000-1000-8000-00805f9b34fb', _r),
          _chr('aaaa0002-0000-1000-8000-00805f9b34fb', _wnr),
          _chr('aaaa0003-0000-1000-8000-00805f9b34fb', _w),
        ]),
      ]);
      expect(target!.fromTable, isFalse);
      expect(target.characteristicUuid, 'aaaa0002-0000-1000-8000-00805f9b34fb');
      expect(target.notifyUuid, isEmpty);
    });

    test('no writable characteristic at all is no target', () {
      expect(pickGenericWriteTarget(const []), isNull);
      expect(
        pickGenericWriteTarget([
          _svc('1800', [_chr('2a00', _w)]),
          _svc('ff00', [_chr('ff03', _n)]),
        ]),
        isNull,
      );
    });

    test(
      'a service with no notify characteristic gets none, not another\'s',
      () {
        final target = pickGenericWriteTarget([
          _svc('ae30', [_chr('ae10', _n)]),
          _svc('49535343-fe7d-4ae5-8fa9-9fafd205e455', [
            _chr('49535343-8841-43f4-a8d4-ecbe34729bb3', _w),
          ]),
        ]);
        // The ISSC service is first in the table; ae10 belongs to another.
        expect(target!.notifyUuid, isEmpty);
      },
    );
  });

  group('chunk sizes', () {
    test('MTU - 3, never under 20 nor over 244', () {
      expect(genericChunkBytes(185), 182);
      expect(genericChunkBytes(247), 244);
      expect(genericChunkBytes(517), 244);
      expect(genericChunkBytes(23), 20);
      expect(genericChunkBytes(10), 20);
    });

    test('an unknown MTU caps at 180', () {
      expect(genericChunkBytes(0), 180);
      expect(genericChunkBytes(-1), 180);
    });
  });

  group('printer details', () {
    const gatt = PrinterGattInfo(
      mtu: 247,
      writeServiceUuid: '0000ff00$_base',
      writeCharUuid: '0000ff02$_base',
      notifyCharUuid: '0000ff03$_base',
      writeWithoutResponse: true,
      services: [
        GattServiceInfo('0000ff00$_base', [
          GattCharacteristicInfo('0000ff02$_base', GattProps(write: true)),
          GattCharacteristicInfo(
            '0000ff03$_base',
            GattProps(notify: true, read: true),
          ),
        ]),
        GattServiceInfo('00001800$_base', []),
      ],
    );

    test('lists the name, services, characteristics, mtu and choice', () {
      final text = formatPrinterDiagnostics(
        const PrinterDiagnostics(
          deviceName: 'Test Printer X1',
          platform: 'android',
          appVersion: '1.0.25+60',
          advertisedServiceUuids: ['0000ff00$_base'],
          gatt: gatt,
          notifyFrames: [
            [0x01, 0x07],
            [0xAA, 0x0B],
          ],
        ),
      );
      expect(text, contains('Laawol printer details'));
      expect(text, contains('app: 1.0.25+60'));
      expect(text, contains('platform: android'));
      expect(text, contains('printer name: "Test Printer X1"'));
      expect(text, contains('advertised services: 0000ff00$_base'));
      expect(text, contains('mtu: 247 (chunk 244 bytes)'));
      expect(
        text,
        contains(
          'used: service 0000ff00$_base characteristic 0000ff02$_base, '
          'write without response',
        ),
      );
      expect(text, contains('notify: 0000ff03$_base'));
      expect(text, contains('services (2):'));
      expect(text, contains('    0000ff02$_base [write]'));
      expect(text, contains('    0000ff03$_base [read, notify]'));
      expect(text, contains('(no characteristics)'));
      expect(text, contains('01 07'));
      expect(text, contains('aa 0b'));
      expect(text, isNot(contains('failure:')));
    });

    test('says so when nothing was read or nothing came back', () {
      final text = formatPrinterDiagnostics(
        const PrinterDiagnostics(
          deviceName: 'Test Printer X1',
          platform: '',
          appVersion: '',
          error: 'connectFailed: timeout',
        ),
      );
      expect(text, contains('failure: connectFailed: timeout'));
      expect(text, contains('services: not read (never connected)'));
      expect(text, contains('advertised services: none reported'));
      expect(text, contains('first 3 s: none'));
      expect(text, contains('app: unknown'));
      expect(text, contains('platform: unknown'));
    });

    test('a printer with nothing to write to says that', () {
      final text = formatPrinterDiagnostics(
        const PrinterDiagnostics(
          deviceName: 'Test Printer X1',
          platform: 'ios',
          appVersion: '1',
          gatt: PrinterGattInfo(services: []),
        ),
      );
      expect(text, contains('used: none (no writable characteristic found)'));
      expect(text, contains('mtu: unknown (chunk 180 bytes)'));
    });

    test('notification bytes are capped in frames and in bytes', () {
      final many = [
        for (var i = 0; i < 40; i++) [i, i],
      ];
      final lines = diagnosticsNotifyLines(many);
      expect(lines.length, diagnosticsMaxFrames + 1);
      expect(lines.last, '(more not shown)');

      final big = diagnosticsNotifyLines([
        List.filled(100, 0xAB),
        List.filled(100, 0xCD),
      ]);
      final shown = big
          .where((l) => !l.startsWith('('))
          .expand((l) => l.split(' '))
          .length;
      expect(shown, diagnosticsMaxNotifyBytes);
      expect(big.last, '(more not shown)');

      expect(diagnosticsNotifyLines(const []), isEmpty);
    });

    test('holds nothing but the printer and phone facts', () {
      final text = formatPrinterDiagnostics(
        const PrinterDiagnostics(
          deviceName: 'Test Printer X1',
          platform: 'android',
          appVersion: '1.0.25',
          gatt: gatt,
        ),
      );
      // The Bluetooth address of the printer is not part of it.
      expect(text, isNot(contains('AA:BB')));
      expect(text.length, lessThan(2000));
    });
  });

  group('which printer a device is', () {
    test('names the app knows need no question', () {
      for (final name in [
        'PM-241Z-BT-0470',
        'Q2A1',
        'q2z9',
        'Phomemo M221',
        'M221',
      ]) {
        expect(printerNameRecognized(name), isTrue, reason: name);
      }
      for (final name in ['JADENS-C10', 'Test Printer X1', '', 'iPhone']) {
        expect(printerNameRecognized(name), isFalse, reason: name);
      }
    });

    test('the shop\'s answer wins for that device, only', () {
      const base = LabelPrinterSettings(
        deviceId: 'AA:BB:CC:DD:EE:09',
        deviceName: 'Test Printer X1',
      );
      expect(base.model, PrinterModel.m221);
      final generic = base.copyWith(
        deviceModels: {'AA:BB:CC:DD:EE:09': PrinterModel.generic4x6},
      );
      expect(generic.model, PrinterModel.generic4x6);
      expect(generic.model.isFourBySix, isTrue);
      // Another device is not affected.
      expect(
        generic.copyWith(deviceId: 'AA:BB:CC:DD:EE:0A').model,
        PrinterModel.m221,
      );
      // A PM-241 by name is always a PM-241.
      expect(
        generic.copyWith(deviceName: 'PM-241Z-BT-1').model,
        PrinterModel.pm241,
      );
    });

    test('a 4 x 6 choice prints the 4 x 6 label size', () {
      final s = const LabelPrinterSettings(
        deviceId: 'AA:BB:CC:DD:EE:09',
        deviceName: 'Test Printer X1',
      ).copyWith(deviceModels: {'AA:BB:CC:DD:EE:09': PrinterModel.generic4x6});
      expect(s.packageSize.widthDots, 800);
      expect(s.packageSize.heightDots, 1180);
    });

    test('the choice survives the saved JSON, and old JSON still loads', () {
      final saved = const LabelPrinterSettings(
        deviceId: 'AA:BB:CC:DD:EE:09',
        deviceName: 'Test Printer X1',
      ).copyWith(deviceModels: {'AA:BB:CC:DD:EE:09': PrinterModel.generic4x6});
      final back = LabelPrinterSettings.fromJson(
        jsonDecode(jsonEncode(saved.toJson())) as Map<String, Object?>,
      );
      expect(back.deviceModels, {'AA:BB:CC:DD:EE:09': PrinterModel.generic4x6});
      expect(back, saved);

      // Settings saved before this existed have no such key.
      final oldJson = const LabelPrinterSettings().toJson();
      expect(oldJson.containsKey('deviceModels'), isFalse);
      expect(LabelPrinterSettings.fromJson(oldJson).deviceModels, isEmpty);
    });

    test('junk in the saved choices is dropped, not trusted', () {
      final back = LabelPrinterSettings.fromJson({
        'deviceModels': {
          'a': 'generic4x6',
          'b': 'm221',
          'c': 'pm241', // never an answer the shop can give
          'd': 42,
          '': 'generic4x6',
        },
      });
      expect(back.deviceModels, {
        'a': PrinterModel.generic4x6,
        'b': PrinterModel.m221,
      });
      expect(
        LabelPrinterSettings.fromJson({'deviceModels': 'nope'}).deviceModels,
        isEmpty,
      );
    });
  });
}

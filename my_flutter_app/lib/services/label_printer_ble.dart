/// The real Bluetooth LE side of the label printer, on flutter_blue_plus.
///
/// Kept thin on purpose: everything that can be decided without a radio
/// (bytes, order, chunking, waiting, error wording) lives in
/// `label_printer.dart` / `m221_protocol.dart` and is unit-tested there.
/// This file cannot be tested without a printer.
///
/// flutter_blue_plus is pinned to 1.36.8, the last BSD-3 release: 2.x is
/// under a commercial licence for for-profit use and pings a licence server
/// at build time.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';

import 'label_printer.dart';
import 'm221_protocol.dart';

bool _same(Guid guid, String uuid) => guid.str128.toLowerCase() == uuid;

LabelPrinterController? _shared;

/// The app's one label printer: one connection, one log, shared by the
/// print sheet and the settings screen.
LabelPrinterController sharedLabelPrinter() =>
    _shared ??= LabelPrinterController(transport: const BlePrinterTransport());

/// Maps a plugin error to what the shop can act on.
PrinterException _mapError(Object error, PrintFailure fallback) {
  final text = '$error';
  final lower = text.toLowerCase();
  if (lower.contains('permission')) {
    return PrinterException(PrintFailure.permissionDenied, text);
  }
  if (lower.contains('location services')) {
    return PrinterException(PrintFailure.locationOff, text);
  }
  if (lower.contains('bluetooth must be turned on') ||
      lower.contains('adapter is off') ||
      lower.contains('bluetooth is off')) {
    return PrinterException(PrintFailure.bluetoothOff, text);
  }
  if (lower.contains('not supported') || lower.contains('unsupported')) {
    return PrinterException(PrintFailure.bluetoothUnsupported, text);
  }
  return PrinterException(fallback, text);
}

class BlePrinterTransport implements PrinterTransport {
  const BlePrinterTransport();

  @override
  Future<PrinterAdapterState> adapterState() async {
    if (kIsWeb) return PrinterAdapterState.unsupported;
    try {
      if (!await FlutterBluePlus.isSupported) {
        return PrinterAdapterState.unsupported;
      }
      // iOS reports "unknown" until its Bluetooth stack is up (and while
      // the permission prompt is on screen).
      final state = await FlutterBluePlus.adapterState
          .where((s) => s != BluetoothAdapterState.unknown)
          .first
          .timeout(
            const Duration(seconds: 6),
            onTimeout: () => BluetoothAdapterState.unknown,
          );
      return switch (state) {
        BluetoothAdapterState.on => PrinterAdapterState.on,
        BluetoothAdapterState.off ||
        BluetoothAdapterState.turningOff ||
        BluetoothAdapterState.turningOn => PrinterAdapterState.off,
        BluetoothAdapterState.unauthorized => PrinterAdapterState.unauthorized,
        BluetoothAdapterState.unavailable => PrinterAdapterState.unsupported,
        _ => PrinterAdapterState.unknown,
      };
    } catch (_) {
      return PrinterAdapterState.unknown;
    }
  }

  @override
  Stream<PrinterDevice> scan(Duration timeout) {
    final controller = StreamController<PrinterDevice>();
    StreamSubscription<List<ScanResult>>? results;
    StreamSubscription<bool>? scanning;
    Future<void> finish([Object? error]) async {
      await results?.cancel();
      await scanning?.cancel();
      if (error != null && !controller.isClosed) controller.addError(error);
      if (!controller.isClosed) await controller.close();
    }

    controller.onListen = () async {
      results = FlutterBluePlus.onScanResults.listen((list) {
        for (final r in list) {
          final ad = r.advertisementData;
          // No service filter: iOS often omits service ids from what it
          // reports, and a filtered scan then never shows the printer at
          // all. Every device is offered; the service id, when present, only
          // ranks it. The printer is confirmed on connect (ff02/ff03).
          final advertisesPrinter = ad.serviceUuids.any(
            (g) => _same(g, m221ServiceUuid),
          );
          final name = ad.advName.isNotEmpty
              ? ad.advName
              : r.device.platformName;
          if (!controller.isClosed) {
            controller.add(
              PrinterDevice(
                id: r.device.remoteId.str,
                name: name,
                rssi: r.rssi,
                advertisesPrinterService: advertisesPrinter,
              ),
            );
          }
        }
      });
      try {
        await FlutterBluePlus.startScan(timeout: timeout);
        // startScan returns once scanning has begun; wait for its end.
        scanning = FlutterBluePlus.isScanning.listen((on) {
          if (!on) unawaited(finish());
        });
      } catch (e) {
        await finish(_mapError(e, PrintFailure.notFound));
      }
    };
    controller.onCancel = () async {
      try {
        await FlutterBluePlus.stopScan();
      } catch (_) {}
      await finish();
    };
    return controller.stream;
  }

  @override
  Future<void> stopScan() async {
    try {
      await FlutterBluePlus.stopScan();
    } catch (_) {}
  }

  @override
  Future<PrinterLink> connect(
    String deviceId, {
    required Duration timeout,
  }) async {
    final device = BluetoothDevice.fromId(deviceId);
    try {
      await device.connect(timeout: timeout);
    } catch (e) {
      try {
        await device.disconnect();
      } catch (_) {}
      throw _mapError(e, PrintFailure.connectFailed);
    }
    try {
      final services = await device.discoverServices();
      BluetoothCharacteristic? write;
      BluetoothCharacteristic? notify;
      for (final service in services) {
        if (!_same(service.uuid, m221ServiceUuid)) continue;
        for (final c in service.characteristics) {
          if (_same(c.uuid, m221WriteUuid)) write = c;
          if (_same(c.uuid, m221NotifyUuid)) notify = c;
        }
      }
      if (write == null || notify == null) {
        await device.disconnect();
        throw const PrinterException(
          PrintFailure.notAPrinter,
          'no ff02/ff03 on service ff00',
        );
      }
      return _BlePrinterLink(device, write, notify);
    } on PrinterException {
      rethrow;
    } catch (e) {
      try {
        await device.disconnect();
      } catch (_) {}
      throw _mapError(e, PrintFailure.connectFailed);
    }
  }
}

class _BlePrinterLink implements PrinterLink {
  _BlePrinterLink(this._device, this._write, this._notify) {
    _state = _device.connectionState.listen((s) {
      if (s == BluetoothConnectionState.disconnected && !_lost.isCompleted) {
        _lost.complete();
      }
    });
  }

  final BluetoothDevice _device;
  final BluetoothCharacteristic _write;
  final BluetoothCharacteristic _notify;
  final Completer<void> _lost = Completer<void>();
  late final StreamSubscription<BluetoothConnectionState> _state;

  @override
  String get deviceId => _device.remoteId.str;

  @override
  int get maxWriteLength {
    final mtu = _device.mtuNow;
    return mtu > 3 ? mtu - 3 : 20;
  }

  @override
  bool get writeWithoutResponse => _write.properties.writeWithoutResponse;

  @override
  bool get isConnected => _device.isConnected && !_lost.isCompleted;

  @override
  Future<void> get disconnected => _lost.future;

  @override
  Future<void> subscribe() async {
    await _notify.setNotifyValue(true);
  }

  @override
  Stream<List<int>> get notifications => _notify.onValueReceived;

  @override
  Future<void> write(List<int> bytes) =>
      _write.write(bytes, withoutResponse: writeWithoutResponse);

  @override
  Future<void> disconnect() async {
    await _state.cancel();
    if (!_lost.isCompleted) _lost.complete();
    await _device.disconnect();
  }
}

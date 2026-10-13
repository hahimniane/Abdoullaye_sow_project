/// Printing product tags straight to the shop's Phomemo M221 over
/// Bluetooth LE, with no printer app in between.
///
/// Three parts, all testable without a radio:
/// - [LabelPrinterSettings]: the chosen printer, label size, density, speed
///   and the X/Y calibration, kept on the phone ([LabelPrinterStore]).
/// - [PrinterTransport] / [PrinterLink]: the Bluetooth seam. The app uses
///   `label_printer_ble.dart`; tests use a fake that records every write.
/// - [LabelPrinterController]: scans, connects (and reconnects), subscribes
///   to the printer's replies BEFORE sending anything (the printer silently
///   drops a job otherwise), sends each label in small chunks, waits for the
///   printer's "done" reply between copies, and keeps a print log the shop
///   owner can copy and send to the developer when something fails.
///
/// The bytes come from `m221_protocol.dart`.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'm221_protocol.dart';
import 'tag_labels.dart';

// ---------------------------------------------------------------------------
// Settings.
// ---------------------------------------------------------------------------

/// Calibration limits, in printer dots (8 dots = 1 mm).
const labelPrinterMinXOffset = -120;
const labelPrinterMaxXOffset = 120;
const labelPrinterMinYOffset = -60;
const labelPrinterMaxYOffset = 120;

/// Where the settings live on the phone.
const labelPrinterSettingsKey = 'labelPrinterSettings.v1';

@immutable
class LabelPrinterSettings {
  const LabelPrinterSettings({
    this.deviceId = '',
    this.deviceName = '',
    this.sizeId = tagSize2x1in,
    this.customWidthMm = 50.8,
    this.customHeightMm = 25.4,
    this.density = m221DefaultDensity,
    this.speed = m221DefaultSpeed,
    this.xOffset = 0,
    this.yOffset = 0,
  });

  /// The printer's Bluetooth id ("" = none chosen yet) and the name it
  /// advertised (a serial such as "Q2...").
  final String deviceId;
  final String deviceName;
  final String sizeId;
  final double customWidthMm;
  final double customHeightMm;
  final int density;
  final int speed;
  final int xOffset;
  final int yOffset;

  bool get hasPrinter => deviceId.isNotEmpty;

  TagLabelSize get size => TagLabelSize.resolve(
    sizeId,
    customWidthMm: customWidthMm,
    customHeightMm: customHeightMm,
  );

  LabelPrinterSettings copyWith({
    String? deviceId,
    String? deviceName,
    String? sizeId,
    double? customWidthMm,
    double? customHeightMm,
    int? density,
    int? speed,
    int? xOffset,
    int? yOffset,
  }) => LabelPrinterSettings(
    deviceId: deviceId ?? this.deviceId,
    deviceName: deviceName ?? this.deviceName,
    sizeId: sizeId ?? this.sizeId,
    customWidthMm: clampTagWidthMm(customWidthMm ?? this.customWidthMm),
    customHeightMm: clampTagHeightMm(customHeightMm ?? this.customHeightMm),
    density: (density ?? this.density).clamp(m221MinDensity, m221MaxDensity),
    speed: (speed ?? this.speed).clamp(m221MinSpeed, m221MaxSpeed),
    xOffset: (xOffset ?? this.xOffset).clamp(
      labelPrinterMinXOffset,
      labelPrinterMaxXOffset,
    ),
    yOffset: (yOffset ?? this.yOffset).clamp(
      labelPrinterMinYOffset,
      labelPrinterMaxYOffset,
    ),
  );

  Map<String, Object?> toJson() => {
    'deviceId': deviceId,
    'deviceName': deviceName,
    'sizeId': sizeId,
    'customWidthMm': customWidthMm,
    'customHeightMm': customHeightMm,
    'density': density,
    'speed': speed,
    'xOffset': xOffset,
    'yOffset': yOffset,
  };

  /// Tolerant: anything missing or out of range falls back or is clamped,
  /// so a bad saved value never stops a print.
  factory LabelPrinterSettings.fromJson(Map<String, Object?> json) {
    String text(String key) {
      final v = json[key];
      return v is String ? v : '';
    }

    num? number(String key) {
      final v = json[key];
      return v is num ? v : null;
    }

    const d = LabelPrinterSettings();
    final size = text('sizeId');
    return d.copyWith(
      deviceId: text('deviceId'),
      deviceName: text('deviceName'),
      sizeId:
          size == tagSizeCustom || TagLabelSize.presets.any((p) => p.id == size)
          ? size
          : tagSize2x1in,
      customWidthMm: number('customWidthMm')?.toDouble(),
      customHeightMm: number('customHeightMm')?.toDouble(),
      density: number('density')?.round(),
      speed: number('speed')?.round(),
      xOffset: number('xOffset')?.round(),
      yOffset: number('yOffset')?.round(),
    );
  }

  @override
  bool operator ==(Object other) =>
      other is LabelPrinterSettings &&
      jsonEncode(other.toJson()) == jsonEncode(toJson());

  @override
  int get hashCode => jsonEncode(toJson()).hashCode;
}

/// Reads and writes the settings on the phone. A convenience, never a
/// record: no storage just means the defaults.
class LabelPrinterStore {
  const LabelPrinterStore();

  Future<LabelPrinterSettings> load() async {
    try {
      // Never let a stuck storage read keep a screen on its spinner.
      final prefs = await SharedPreferences.getInstance().timeout(
        const Duration(seconds: 3),
      );
      final raw = prefs.getString(labelPrinterSettingsKey);
      if (raw == null || raw.isEmpty) return const LabelPrinterSettings();
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, Object?>) {
        return LabelPrinterSettings.fromJson(decoded);
      }
    } catch (_) {}
    return const LabelPrinterSettings();
  }

  Future<void> save(LabelPrinterSettings settings) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        labelPrinterSettingsKey,
        jsonEncode(settings.toJson()),
      );
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Failures and the print log.
// ---------------------------------------------------------------------------

/// Why a scan, a connection or a print did not work. Each has its own
/// friendly message on screen; the technical detail goes to the log.
enum PrintFailure {
  bluetoothOff,
  bluetoothUnsupported,
  permissionDenied,
  locationOff,
  noPrinterChosen,
  notFound,
  connectFailed,
  notAPrinter,
  connectionLost,
  noCompletion,
  outOfPaper,
  writeFailed,
  busy,
}

class PrinterException implements Exception {
  const PrinterException(this.failure, [this.detail = '']);

  final PrintFailure failure;
  final String detail;

  @override
  String toString() =>
      'PrinterException(${failure.name}${detail.isEmpty ? '' : ': $detail'})';
}

class PrintLogEntry {
  const PrintLogEntry(this.at, this.message);

  final DateTime at;
  final String message;

  String get line {
    String two(int v) => v.toString().padLeft(2, '0');
    final ms = at.millisecond.toString().padLeft(3, '0');
    return '${two(at.hour)}:${two(at.minute)}:${two(at.second)}.$ms $message';
  }
}

/// The last [capacity] events of scanning, connecting and printing. It is
/// the remote debugging channel: the owner copies it and pastes it to the
/// developer. It holds technical events only (ids, byte counts, replies in
/// hex) - never tokens, links with secrets, or personal data.
class PrintLog extends ChangeNotifier {
  PrintLog({this.capacity = 60, DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final int capacity;
  final DateTime Function() _clock;
  final List<PrintLogEntry> _entries = [];

  List<PrintLogEntry> get entries => List.unmodifiable(_entries);

  void add(String message) {
    _entries.add(PrintLogEntry(_clock(), message));
    if (_entries.length > capacity) {
      _entries.removeRange(0, _entries.length - capacity);
    }
    notifyListeners();
  }

  void clear() {
    _entries.clear();
    notifyListeners();
  }

  String text() => _entries.map((e) => e.line).join('\n');
}

// ---------------------------------------------------------------------------
// The Bluetooth seam.
// ---------------------------------------------------------------------------

enum PrinterAdapterState { on, off, unauthorized, unsupported, unknown }

/// A printer seen while scanning.
@immutable
class PrinterDevice {
  const PrinterDevice({
    required this.id,
    required this.name,
    this.rssi = 0,
    this.advertisesPrinterService = false,
  });

  final String id;
  final String name;

  /// Signal strength in dBm (closer to 0 is stronger).
  final int rssi;

  /// The advertisement named the printer service (ff00). iPhones often leave
  /// service ids out of what they report, so a printer can be real without
  /// this; it only decides the order of the list, never whether to show it.
  final bool advertisesPrinterService;

  /// Looks like a Phomemo: the serial-style name ("Q2…") or the service.
  bool get looksLikePrinter =>
      advertisesPrinterService ||
      name.toUpperCase().startsWith('Q2') ||
      name.toUpperCase().contains('M221') ||
      name.toUpperCase().contains('PHOMEMO');
}

abstract class PrinterTransport {
  Future<PrinterAdapterState> adapterState();

  /// Devices advertising the printer service, each as it is seen, until
  /// [timeout]. Throws [PrinterException] (Bluetooth off, permission...).
  Stream<PrinterDevice> scan(Duration timeout);

  Future<void> stopScan();

  /// Connects to [deviceId] and finds the write and notify characteristics.
  /// Throws [PrinterException]: `notFound`, `connectFailed`, `notAPrinter`.
  Future<PrinterLink> connect(String deviceId, {required Duration timeout});
}

abstract class PrinterLink {
  String get deviceId;

  /// The most bytes one write may carry on this connection.
  int get maxWriteLength;

  /// Whether ff02 takes writes without response (faster).
  bool get writeWithoutResponse;

  bool get isConnected;

  /// Fires once when the connection drops.
  Future<void> get disconnected;

  /// Turns on notifications from ff03.
  Future<void> subscribe();

  Stream<List<int>> get notifications;

  Future<void> write(List<int> bytes);

  Future<void> disconnect();
}

// ---------------------------------------------------------------------------
// The controller.
// ---------------------------------------------------------------------------

enum PrinterStatus { idle, scanning, connecting, connected, printing }

/// What a print run ended with.
@immutable
class PrintOutcome {
  const PrintOutcome({
    required this.printed,
    required this.requested,
    this.failure,
    this.cancelled = false,
  });

  final int printed;
  final int requested;
  final PrintFailure? failure;
  final bool cancelled;

  bool get ok => failure == null && !cancelled && printed == requested;
}

typedef PrintPause = Future<void> Function(Duration duration);

Future<void> _realPause(Duration d) =>
    d == Duration.zero ? Future<void>.value() : Future<void>.delayed(d);

class LabelPrinterController extends ChangeNotifier {
  LabelPrinterController({
    required this.transport,
    this.store = const LabelPrinterStore(),
    PrintLog? log,
    this.pause = _realPause,
    this.doneTimeout = m221DoneTimeout,
    this.scanTimeout = const Duration(seconds: 8),
    this.connectTimeout = const Duration(seconds: 15),
    this.writeTimeout = const Duration(seconds: 10),
    this.idleDisconnect = const Duration(seconds: 90),
  }) : log = log ?? PrintLog();

  final PrinterTransport transport;
  final LabelPrinterStore store;
  final PrintLog log;
  final PrintPause pause;
  final Duration doneTimeout;
  final Duration scanTimeout;
  final Duration connectTimeout;
  final Duration writeTimeout;

  /// The connection is let go this long after the last job, so the owner
  /// can still open Print Master (the printer takes one connection).
  final Duration idleDisconnect;

  LabelPrinterSettings _settings = const LabelPrinterSettings();
  bool _loaded = false;
  PrinterStatus _status = PrinterStatus.idle;
  final Map<String, PrinterDevice> _found = {};
  PrinterLink? _link;
  StreamSubscription<List<int>>? _notifySub;
  final List<List<int>> _frames = [];
  final StreamController<List<int>> _frameEvents =
      StreamController<List<int>>.broadcast();
  bool _cancel = false;
  int _progressDone = 0;
  int _progressTotal = 0;
  Timer? _idleTimer;
  int? _battery;
  bool _disposed = false;

  LabelPrinterSettings get settings => _settings;
  bool get loaded => _loaded;
  PrinterStatus get status => _status;
  bool get busy =>
      _status != PrinterStatus.idle && _status != PrinterStatus.connected;
  bool get isConnected => _link?.isConnected ?? false;
  bool get cancelRequested => _cancel;
  int get progressDone => _progressDone;
  int get progressTotal => _progressTotal;
  int? get batteryPercent => _battery;

  /// Devices seen in the last scan: likely printers first, then by signal.
  /// Every named device is listed, because the phone may not report the
  /// printer's service id; the printer is confirmed on connect (ff02/ff03).
  List<PrinterDevice> get found {
    final list = _found.values.toList()
      ..sort((a, b) {
        if (a.looksLikePrinter != b.looksLikePrinter) {
          return a.looksLikePrinter ? -1 : 1;
        }
        return b.rssi.compareTo(a.rssi);
      });
    return list;
  }

  void _set(PrinterStatus status) {
    _status = status;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> load() async {
    if (_loaded) return;
    _settings = await store.load();
    _loaded = true;
    _notify();
  }

  Future<void> updateSettings(LabelPrinterSettings next) async {
    _settings = next;
    _notify();
    await store.save(next);
  }

  // -- scanning ------------------------------------------------------------

  Future<PrintFailure?> _checkAdapter() async {
    final state = await transport.adapterState();
    switch (state) {
      case PrinterAdapterState.on:
      case PrinterAdapterState.unknown:
        return null;
      case PrinterAdapterState.off:
        log.add('bluetooth: off');
        return PrintFailure.bluetoothOff;
      case PrinterAdapterState.unauthorized:
        log.add('bluetooth: not allowed for this app');
        return PrintFailure.permissionDenied;
      case PrinterAdapterState.unsupported:
        log.add('bluetooth: not available on this device');
        return PrintFailure.bluetoothUnsupported;
    }
  }

  /// Looks for printers for [scanTimeout]. Answers null when the scan ran
  /// (see [found]; it may be empty), else why it could not.
  Future<PrintFailure?> scan() async {
    if (busy) return PrintFailure.busy;
    final adapter = await _checkAdapter();
    if (adapter != null) return adapter;
    _found.clear();
    _set(PrinterStatus.scanning);
    log.add('scan: start (${scanTimeout.inSeconds} s, any device)');
    var unnamed = 0;
    try {
      await for (final device in transport.scan(scanTimeout)) {
        // Nameless advertisements are not offered: nothing to pick by.
        if (device.name.trim().isEmpty) {
          unnamed++;
          continue;
        }
        final known = _found.containsKey(device.id);
        _found[device.id] = device;
        if (!known) {
          log.add(
            'scan: found "${device.name}" ${_shortId(device.id)} '
            'rssi ${device.rssi}'
            '${device.advertisesPrinterService ? ' service ff00' : ''}',
          );
        }
        _notify();
      }
      final likely = _found.values.where((d) => d.looksLikePrinter).length;
      log.add(
        'scan: done, ${_found.length} named device(s), $likely likely '
        'printer(s), $unnamed unnamed skipped',
      );
      return null;
    } on PrinterException catch (e) {
      log.add('scan: failed ${e.failure.name} ${e.detail}');
      return e.failure;
    } catch (e) {
      log.add('scan: failed $e');
      return PrintFailure.notFound;
    } finally {
      _set(isConnected ? PrinterStatus.connected : PrinterStatus.idle);
    }
  }

  /// Remembers [device] as the shop's printer.
  Future<void> choose(PrinterDevice device) async {
    if (_link != null && _link!.deviceId != device.id) {
      await _drop('switching printer');
    }
    log.add('chosen: "${device.name}" ${_shortId(device.id)}');
    await updateSettings(
      _settings.copyWith(deviceId: device.id, deviceName: device.name),
    );
  }

  Future<void> forget() async {
    await _drop('printer forgotten');
    await updateSettings(_settings.copyWith(deviceId: '', deviceName: ''));
    log.add('chosen: none');
  }

  // -- connection ----------------------------------------------------------

  Future<PrinterLink> _ensureLink() async {
    final current = _link;
    if (current != null &&
        current.isConnected &&
        current.deviceId == _settings.deviceId) {
      return current;
    }
    if (!_settings.hasPrinter) {
      throw const PrinterException(PrintFailure.noPrinterChosen);
    }
    final adapter = await _checkAdapter();
    if (adapter != null) throw PrinterException(adapter);
    await _drop('reconnecting');
    _set(PrinterStatus.connecting);
    final id = _settings.deviceId;
    log.add('connect: ${_shortId(id)}');
    PrinterLink link;
    try {
      link = await transport.connect(id, timeout: connectTimeout);
    } on PrinterException catch (e) {
      log.add('connect: failed ${e.failure.name} ${e.detail}');
      if (e.failure != PrintFailure.notFound &&
          e.failure != PrintFailure.connectFailed) {
        rethrow;
      }
      // The phone may not know the printer yet this session (iOS): look for
      // it, then try once more.
      log.add('connect: scanning for the printer, then retrying');
      var seen = false;
      try {
        await for (final d in transport.scan(scanTimeout)) {
          if (d.id == id) {
            seen = true;
            break;
          }
        }
      } on PrinterException catch (s) {
        log.add('scan: failed ${s.failure.name} ${s.detail}');
        throw PrinterException(s.failure, s.detail);
      } finally {
        await transport.stopScan();
      }
      if (!seen) {
        log.add('connect: printer not seen');
        throw const PrinterException(PrintFailure.notFound);
      }
      link = await transport.connect(id, timeout: connectTimeout);
    }
    _frames.clear();
    _notifySub = link.notifications.listen((frame) {
      _frames.add(frame);
      _frameEvents.add(frame);
      log.add('reply: ${m221Hex(frame)}');
    });
    // The printer ignores everything until notifications are on.
    log.add('subscribe: ff03');
    try {
      await link.subscribe().timeout(writeTimeout);
    } catch (e) {
      log.add('subscribe: failed $e');
      await _notifySub?.cancel();
      _notifySub = null;
      try {
        await link.disconnect();
      } catch (_) {}
      throw PrinterException(PrintFailure.connectFailed, 'subscribe: $e');
    }
    await pause(m221AfterSubscribeGap);
    _link = link;
    log.add(
      'connected: write ${link.writeWithoutResponse ? 'without' : 'with'} '
      'response, ${_chunkSize(link)} bytes per write',
    );
    unawaited(
      link.disconnected.then((_) {
        if (identical(_link, link)) {
          log.add('connection: lost');
          _notifySub?.cancel();
          _notifySub = null;
          _link = null;
          if (_status == PrinterStatus.connected) _set(PrinterStatus.idle);
        }
      }),
    );
    _set(PrinterStatus.connected);
    return link;
  }

  Future<void> _drop(String why) async {
    _idleTimer?.cancel();
    final link = _link;
    _link = null;
    await _notifySub?.cancel();
    _notifySub = null;
    if (link != null) {
      log.add('disconnect: $why');
      try {
        await link.disconnect();
      } catch (_) {}
    }
    if (_status == PrinterStatus.connected) _set(PrinterStatus.idle);
  }

  /// Lets go of the printer now (so Print Master can connect).
  Future<void> disconnect() => _drop('asked');

  void _scheduleIdleDisconnect() {
    _idleTimer?.cancel();
    if (idleDisconnect == Duration.zero) return;
    _idleTimer = Timer(idleDisconnect, () {
      if (!busy) unawaited(_drop('idle'));
    });
  }

  int _chunkSize(PrinterLink link) {
    final max = link.maxWriteLength;
    if (max <= 0) return 20;
    return max < m221ChunkBytes ? max : m221ChunkBytes;
  }

  Future<void> _send(PrinterLink link, List<int> bytes) async {
    final size = _chunkSize(link);
    for (final chunk in m221Chunks(bytes, size)) {
      if (!link.isConnected) {
        throw const PrinterException(PrintFailure.connectionLost);
      }
      try {
        await link.write(chunk).timeout(writeTimeout);
      } on PrinterException {
        rethrow;
      } catch (e) {
        if (!link.isConnected) {
          throw PrinterException(PrintFailure.connectionLost, '$e');
        }
        throw PrinterException(PrintFailure.writeFailed, '$e');
      }
      await pause(m221ChunkGap);
    }
  }

  /// Sends one label and waits for the printer's done reply.
  Future<void> _printOne(PrinterLink link, PackedRaster raster) async {
    final steps = m221LabelSteps(
      raster,
      density: _settings.density,
      speed: _settings.speed,
    );
    for (final step in steps) {
      if (step.name == 'footer') {
        _frames.clear();
        // Listen before the footer goes out: the reply can be quick.
        final done = _frameEvents.stream
            .firstWhere(m221IsDoneFrame)
            .then((_) => true, onError: (Object _) => false);
        final lost = link.disconnected.then(
          (_) => false,
          onError: (Object _) => false,
        );
        await _send(link, step.bytes);
        log.add('sent: footer, waiting for the printer');
        final bool finished;
        try {
          finished = await Future.any([done, lost]).timeout(doneTimeout);
        } on TimeoutException {
          log.add('done: no reply in ${doneTimeout.inSeconds} s');
          throw const PrinterException(PrintFailure.noCompletion);
        }
        if (!finished) {
          throw const PrinterException(PrintFailure.connectionLost);
        }
        log.add('done: printer finished the label');
        return;
      }
      await _send(link, step.bytes);
      if (step.name == 'raster') {
        log.add('sent: raster ${raster.rows} rows, ${step.bytes.length} bytes');
      } else {
        log.add('sent: ${step.name} ${m221Hex(step.bytes)}');
      }
      await pause(step.pauseAfter);
    }
  }

  /// Asks the printer whether it has labels after a label did not finish.
  /// The reply format is unverified on an M221, so this only refines the
  /// message; it never refuses a job.
  Future<PrintFailure> _explainNoCompletion(PrinterLink link) async {
    try {
      _frames.clear();
      await _send(link, m221QueryPaper);
      await pause(const Duration(milliseconds: 700));
      if (_frames.any(m221SaysOutOfPaper)) {
        log.add('status: printer says no labels loaded');
        return PrintFailure.outOfPaper;
      }
    } catch (_) {}
    return PrintFailure.noCompletion;
  }

  /// Battery, paper and cover replies, raw, into the log (for the
  /// developer); answers the battery percent when it can be read.
  Future<PrintFailure?> checkStatus() async {
    if (busy) return PrintFailure.busy;
    try {
      final link = await _ensureLink();
      for (final (name, query) in [
        ('battery', m221QueryBattery),
        ('paper', m221QueryPaper),
        ('cover', m221QueryCover),
      ]) {
        _frames.clear();
        await _send(link, query);
        await pause(const Duration(milliseconds: 700));
        log.add(
          'status $name: '
          '${_frames.isEmpty ? 'no reply' : _frames.map(m221Hex).join(' | ')}',
        );
        if (name == 'battery') {
          for (final f in _frames) {
            final pct = m221BatteryPercent(f);
            if (pct != null) _battery = pct;
          }
        }
      }
      _notify();
      _scheduleIdleDisconnect();
      return null;
    } on PrinterException catch (e) {
      log.add('status: failed ${e.failure.name} ${e.detail}');
      return e.failure;
    } finally {
      if (_status == PrinterStatus.connecting) {
        _set(isConnected ? PrinterStatus.connected : PrinterStatus.idle);
      }
    }
  }

  /// Stops a print run after the label being printed now (a label cut off
  /// half-way would leave the printer waiting for the rest).
  void requestCancel() {
    if (_status != PrinterStatus.printing &&
        _status != PrinterStatus.connecting) {
      return;
    }
    _cancel = true;
    log.add('cancel: asked, stopping after this label');
    _notify();
  }

  /// Prints [copies] of [image] (one label's picture in printer dots), one
  /// at a time, waiting for the printer between copies. [onProgress] gets
  /// (printed, total) after each label. Reconnects once if the connection
  /// drops between labels.
  Future<PrintOutcome> printLabels({
    required LabelBitmap image,
    int copies = 1,
    String what = 'label',
  }) async {
    if (busy) {
      return PrintOutcome(
        printed: 0,
        requested: copies,
        failure: PrintFailure.busy,
      );
    }
    _idleTimer?.cancel();
    _cancel = false;
    _progressDone = 0;
    _progressTotal = copies;
    final raster = packRaster(image, _settings.xOffset, _settings.yOffset);
    log.add(
      'print: $copies x $what ${image.width}x${image.height} dots, '
      'x ${_settings.xOffset} y ${_settings.yOffset}, '
      'density ${_settings.density} (byte ${m221DensityByte(_settings.density)}), '
      'speed ${_settings.speed}',
    );
    _set(PrinterStatus.printing);
    var printed = 0;
    var retried = false;
    try {
      while (printed < copies) {
        if (_cancel) {
          log.add('print: cancelled after $printed of $copies');
          return PrintOutcome(
            printed: printed,
            requested: copies,
            cancelled: true,
          );
        }
        _set(PrinterStatus.connecting);
        final link = await _ensureLink();
        _set(PrinterStatus.printing);
        try {
          log.add('print: label ${printed + 1} of $copies');
          await _printOne(link, raster);
        } on PrinterException catch (e) {
          if (e.failure == PrintFailure.noCompletion) {
            throw PrinterException(await _explainNoCompletion(link));
          }
          if (e.failure == PrintFailure.connectionLost && !retried) {
            retried = true;
            log.add('print: connection lost, reconnecting once');
            await _drop('lost during a label');
            continue;
          }
          rethrow;
        }
        printed++;
        _progressDone = printed;
        _notify();
      }
      log.add('print: finished $printed of $copies');
      return PrintOutcome(printed: printed, requested: copies);
    } on PrinterException catch (e) {
      log.add('print: failed ${e.failure.name} ${e.detail}');
      return PrintOutcome(
        printed: printed,
        requested: copies,
        failure: e.failure,
      );
    } catch (e) {
      log.add('print: failed $e');
      return PrintOutcome(
        printed: printed,
        requested: copies,
        failure: PrintFailure.writeFailed,
      );
    } finally {
      _cancel = false;
      _set(isConnected ? PrinterStatus.connected : PrinterStatus.idle);
      if (isConnected) _scheduleIdleDisconnect();
    }
  }

  /// The log with a short header (the settings that shaped the job), ready
  /// to paste to the developer.
  String logReport({String app = ''}) {
    final s = _settings;
    final size = s.size;
    return [
      'Laawol label printer log${app.isEmpty ? '' : ' ($app)'}',
      'printer: ${s.hasPrinter ? '"${s.deviceName}" ${_shortId(s.deviceId)}' : 'none'}',
      'label: ${size.id} ${size.mmText} = ${size.widthDots}x${size.heightDots} dots',
      'density ${s.density}, speed ${s.speed}, x ${s.xOffset}, y ${s.yOffset}',
      if (_battery != null) 'battery: $_battery%',
      '---',
      log.text(),
    ].join('\n');
  }

  @override
  void dispose() {
    _disposed = true;
    _idleTimer?.cancel();
    unawaited(_notifySub?.cancel());
    final link = _link;
    _link = null;
    if (link != null) unawaited(link.disconnect().catchError((_) {}));
    unawaited(_frameEvents.close());
    super.dispose();
  }
}

/// A Bluetooth id shortened for the log (enough to tell two apart).
String _shortId(String id) =>
    id.length <= 8 ? id : '…${id.substring(id.length - 8)}';

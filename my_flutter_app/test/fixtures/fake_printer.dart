/// A stand-in for the Bluetooth printer: records everything the app sends
/// and answers like an M221 would (a `1A 0F 0C` "done" frame after each
/// label's footer), with knobs to make it misbehave.
library;

import 'dart:async';

import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';

class FakePrinterTransport implements PrinterTransport {
  FakePrinterTransport({
    this.adapter = PrinterAdapterState.on,
    List<PrinterDevice>? devices,
    this.maxWrite = 182,
    this.answerDone = true,
    this.paperReply,
    this.scanError,
    this.connectError,
  }) : devices =
           devices ??
           const [
             PrinterDevice(id: 'AA:BB:CC:DD:EE:01', name: 'Q2A1', rssi: -55),
           ];

  PrinterAdapterState adapter;
  List<PrinterDevice> devices;
  int maxWrite;
  bool answerDone;
  List<int>? paperReply;
  PrinterException? scanError;
  PrinterException? connectError;

  /// Drop the connection on the Nth write (1-based), once.
  int? dropOnWrite;

  /// Everything that happened, in order: `scan`, `connect ID`,
  /// `subscribe`, `write N` (N bytes), `disconnect`.
  final List<String> events = [];

  /// Every write, as sent.
  final List<List<int>> writes = [];

  int connects = 0;
  FakePrinterLink? link;

  @override
  Future<PrinterAdapterState> adapterState() async => adapter;

  @override
  Stream<PrinterDevice> scan(Duration timeout) async* {
    events.add('scan');
    final error = scanError;
    if (error != null) throw error;
    for (final d in devices) {
      yield d;
    }
  }

  @override
  Future<void> stopScan() async {}

  @override
  Future<PrinterLink> connect(
    String deviceId, {
    required Duration timeout,
  }) async {
    events.add('connect $deviceId');
    connects++;
    final error = connectError;
    if (error != null) {
      connectError = null;
      throw error;
    }
    final next = FakePrinterLink(this, deviceId);
    link = next;
    return next;
  }

  /// All bytes written, joined.
  List<int> get allBytes => writes.expand((w) => w).toList();
}

class FakePrinterLink implements PrinterLink {
  FakePrinterLink(this._printer, this.deviceId);

  final FakePrinterTransport _printer;
  @override
  final String deviceId;
  final _replies = StreamController<List<int>>.broadcast();
  final _lost = Completer<void>();
  bool subscribed = false;
  final List<int> _pending = [];

  @override
  int get maxWriteLength => _printer.maxWrite;

  @override
  bool get writeWithoutResponse => true;

  @override
  bool get isConnected => !_lost.isCompleted;

  @override
  Future<void> get disconnected => _lost.future;

  @override
  Stream<List<int>> get notifications => _replies.stream;

  @override
  Future<void> subscribe() async {
    _printer.events.add('subscribe');
    subscribed = true;
  }

  void reply(List<int> frame) {
    if (subscribed && !_replies.isClosed) {
      scheduleMicrotask(() => _replies.add(frame));
    }
  }

  void drop() {
    if (!_lost.isCompleted) _lost.complete();
  }

  @override
  Future<void> write(List<int> bytes) async {
    if (!isConnected) throw StateError('device is not connected');
    _printer.events.add('write ${bytes.length}');
    _printer.writes.add(List<int>.of(bytes));
    final drop = _printer.dropOnWrite;
    if (drop != null && _printer.writes.length == drop) {
      _printer.dropOnWrite = null;
      this.drop();
      throw StateError('device is disconnected');
    }
    // An M221 only acts when notifications are on; a job sent before that
    // is dropped silently (no reply).
    _pending.addAll(bytes);
    if (_endsWith(_pending, m221Footer)) {
      _pending.clear();
      if (_printer.answerDone) reply([0x1A, 0x0F, 0x0C]);
    } else if (_endsWith(_pending, m221QueryPaper)) {
      _pending.clear();
      final paper = _printer.paperReply;
      if (paper != null) reply(paper);
    } else if (_endsWith(_pending, m221QueryBattery)) {
      _pending.clear();
      reply([0x1A, 0x04, 87]);
    }
  }

  @override
  Future<void> disconnect() async {
    _printer.events.add('disconnect');
    drop();
  }
}

bool _endsWith(List<int> bytes, List<int> tail) {
  if (bytes.length < tail.length) return false;
  for (var i = 0; i < tail.length; i++) {
    if (bytes[bytes.length - tail.length + i] != tail[i]) return false;
  }
  return true;
}

/// A controller on [transport] that never sleeps (pauses are skipped) and
/// waits [doneTimeout] for the printer's reply.
LabelPrinterController fakeController(
  FakePrinterTransport transport, {
  Duration doneTimeout = const Duration(milliseconds: 200),
  LabelPrinterSettings settings = const LabelPrinterSettings(
    deviceId: 'AA:BB:CC:DD:EE:01',
    deviceName: 'Q2A1',
  ),
  LabelPrinterStore? store,
}) {
  final c = LabelPrinterController(
    transport: transport,
    store: store ?? MemoryPrinterStore(settings),
    pause: (_) async {},
    doneTimeout: doneTimeout,
    idleDisconnect: Duration.zero,
  );
  c.updateSettings(settings);
  return c;
}

/// Settings kept in memory only.
class MemoryPrinterStore extends LabelPrinterStore {
  MemoryPrinterStore([this.value = const LabelPrinterSettings()]);

  LabelPrinterSettings value;

  @override
  Future<LabelPrinterSettings> load() async => value;

  @override
  Future<void> save(LabelPrinterSettings settings) async => value = settings;
}

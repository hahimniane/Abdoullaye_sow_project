/// BETA: "other" 4 x 6 in Bluetooth LE label printers (the first target is a
/// JADENS C10), as pure functions: how to find the one characteristic to write
/// to on a printer whose Bluetooth layout is not documented, how big a chunk
/// to write, and the "printer details" a shop can send us when a label does
/// not come out.
///
/// There is no public SDK or protocol for these printers. The bet is that
/// they are TSPL printers behind a common "transparent UART" Bluetooth
/// service, so the job is exactly the PM-241's ([pm241LabelJob]) and only the
/// route to the printer differs. Nothing here has been seen on a real
/// printer: the details the app collects are how the next step is learned.
///
/// No Bluetooth here: `label_printer_ble.dart` reads the real services into
/// [GattServiceInfo]s and writes where [pickGenericWriteTarget] says.
library;

import 'dart:convert' show jsonEncode;

// ---------------------------------------------------------------------------
// UUIDs.
// ---------------------------------------------------------------------------

const _baseUuidTail = '-0000-1000-8000-00805f9b34fb';

/// [uuid] as the 36-character lower-case form: "ff00", "0000ff00" and the
/// full Bluetooth-base form all read as "0000ff00-0000-1000-8000-00805f9b34fb";
/// a 32-digit id without dashes gets its dashes. Anything else is returned
/// lower-cased and trimmed (unknown shapes still compare equal to themselves).
String normalizeUuid(String uuid) {
  final u = uuid.trim().toLowerCase().replaceAll(RegExp(r'[{}]'), '');
  final hex = RegExp(r'^[0-9a-f]+$');
  if (u.length == 4 && hex.hasMatch(u)) return '0000$u$_baseUuidTail';
  if (u.length == 8 && hex.hasMatch(u)) return '$u$_baseUuidTail';
  if (u.length == 32 && hex.hasMatch(u)) {
    return '${u.substring(0, 8)}-${u.substring(8, 12)}-'
        '${u.substring(12, 16)}-${u.substring(16, 20)}-${u.substring(20)}';
  }
  return u;
}

// ---------------------------------------------------------------------------
// What the printer's Bluetooth layout looks like.
// ---------------------------------------------------------------------------

/// The properties of one characteristic that matter here.
class GattProps {
  const GattProps({
    this.read = false,
    this.write = false,
    this.writeWithoutResponse = false,
    this.notify = false,
    this.indicate = false,
  });

  final bool read;
  final bool write;
  final bool writeWithoutResponse;
  final bool notify;
  final bool indicate;

  bool get canWrite => write || writeWithoutResponse;
  bool get canNotify => notify || indicate;

  /// "read, write, notify" (empty: "none").
  String get text {
    final names = [
      if (read) 'read',
      if (write) 'write',
      if (writeWithoutResponse) 'writeWithoutResponse',
      if (notify) 'notify',
      if (indicate) 'indicate',
    ];
    return names.isEmpty ? 'none' : names.join(', ');
  }
}

class GattCharacteristicInfo {
  const GattCharacteristicInfo(this.uuid, this.props);

  final String uuid;
  final GattProps props;
}

class GattServiceInfo {
  const GattServiceInfo(this.uuid, this.characteristics);

  final String uuid;
  final List<GattCharacteristicInfo> characteristics;
}

/// Everything read from a printer after connecting (or failing to find
/// where to write), plus the choice made.
class PrinterGattInfo {
  const PrinterGattInfo({
    required this.services,
    this.mtu = 0,
    this.writeServiceUuid = '',
    this.writeCharUuid = '',
    this.notifyCharUuid = '',
    this.writeWithoutResponse = false,
  });

  final List<GattServiceInfo> services;

  /// The negotiated MTU (0 = could not be read).
  final int mtu;

  /// The characteristic the app writes to ('' = none was found).
  final String writeServiceUuid;
  final String writeCharUuid;

  /// The characteristic the app listens on ('' = none).
  final String notifyCharUuid;
  final bool writeWithoutResponse;

  bool get hasWriteTarget => writeCharUuid.isNotEmpty;
}

// ---------------------------------------------------------------------------
// Where to write.
// ---------------------------------------------------------------------------

/// A "transparent UART" printer service and the characteristic that takes
/// the print data.
class GenericUartService {
  const GenericUartService(this.service, this.write);

  final String service;
  final String write;
}

/// The common transparent-UART services, in the order they are tried. The
/// first one the printer has (with a writable characteristic of the listed
/// id) wins.
const genericUartServices = [
  // The Phomemo / many Chinese printers.
  GenericUartService('0000ff00', '0000ff02'),
  // Common ESC/POS & label printers (service 18f0).
  GenericUartService('000018f0', '00002af1'),
  // Microchip ISSC transparent UART.
  GenericUartService(
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '49535343-8841-43f4-a8d4-ecbe34729bb3',
  ),
  // Another widespread printer UART.
  GenericUartService(
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  ),
  // Some thermal printers (ae30 / ae01).
  GenericUartService('0000ae30', '0000ae01'),
];

/// Services that are never a print channel (the fallback skips them):
/// Generic Access, Generic Attribute, Device Information, Battery.
const _neverAPrintChannel = {'1800', '1801', '180a', '180f'};

bool _isNeverAPrintChannel(String uuid) {
  final n = normalizeUuid(uuid);
  return _neverAPrintChannel.any((s) => n == normalizeUuid(s));
}

/// What the app writes to.
class GenericWriteTarget {
  const GenericWriteTarget({
    required this.serviceUuid,
    required this.characteristicUuid,
    required this.writeWithoutResponse,
    required this.fromTable,
    this.notifyUuid = '',
  });

  final String serviceUuid;
  final String characteristicUuid;

  /// Write without response when the characteristic allows it (faster, and
  /// what these printers expect), else with response.
  final bool writeWithoutResponse;

  /// True when it came from [genericUartServices], false for the fallback
  /// (any writable characteristic).
  final bool fromTable;

  /// A characteristic of the same service to listen on ('' = none).
  final String notifyUuid;
}

GattCharacteristicInfo? _notifyIn(
  GattServiceInfo service,
  GattCharacteristicInfo write,
) {
  GattCharacteristicInfo? first;
  for (final c in service.characteristics) {
    if (!c.props.canNotify) continue;
    if (normalizeUuid(c.uuid) != normalizeUuid(write.uuid)) return c;
    first ??= c;
  }
  return first;
}

GenericWriteTarget _target(
  GattServiceInfo service,
  GattCharacteristicInfo write, {
  required bool fromTable,
}) => GenericWriteTarget(
  serviceUuid: service.uuid,
  characteristicUuid: write.uuid,
  writeWithoutResponse: write.props.writeWithoutResponse,
  fromTable: fromTable,
  notifyUuid: _notifyIn(service, write)?.uuid ?? '',
);

/// The characteristic to send print data to, or null when the printer has
/// no writable characteristic at all.
///
/// Each [genericUartServices] entry is tried in order (the printer must have
/// the service and, in it, the listed characteristic with write or
/// write-without-response); then the first writable characteristic of ANY
/// service that is not Generic Access / Attribute / Device Information /
/// Battery.
GenericWriteTarget? pickGenericWriteTarget(List<GattServiceInfo> services) {
  for (final known in genericUartServices) {
    final serviceId = normalizeUuid(known.service);
    final writeId = normalizeUuid(known.write);
    for (final service in services) {
      if (normalizeUuid(service.uuid) != serviceId) continue;
      for (final c in service.characteristics) {
        if (normalizeUuid(c.uuid) == writeId && c.props.canWrite) {
          return _target(service, c, fromTable: true);
        }
      }
    }
  }
  for (final service in services) {
    if (_isNeverAPrintChannel(service.uuid)) continue;
    for (final c in service.characteristics) {
      if (c.props.canWrite) return _target(service, c, fromTable: false);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// How much to write at once, and how fast.
// ---------------------------------------------------------------------------

/// The chunk used when the MTU could not be read.
const genericUnknownMtuChunk = 180;

/// The largest chunk ever: ATT MTU 247 minus 3, the biggest packet seen to
/// work on the PM-241.
const genericMaxChunk = 244;

/// The smallest chunk: a default-MTU (23) link carries 20 bytes.
const genericMinChunk = 20;

/// The pause between two chunks, so a printer with a small buffer keeps up.
const genericChunkGap = Duration(milliseconds: 15);

/// The pause after connecting, before the first byte.
const genericAfterConnectGap = Duration(milliseconds: 500);

/// The pause after the last byte of a label, so the printer has the whole
/// job before the next one (or the disconnect) comes. These printers give
/// no known "done" signal.
const genericAfterJobGap = Duration(seconds: 3);

/// How long the printer's first notifications are kept for the details.
const genericNotifyWindow = Duration(seconds: 3);

/// The bytes per write for a link whose MTU is [mtu] (0 or less = unknown):
/// MTU - 3, at least 20 and at most [genericMaxChunk]; [genericUnknownMtuChunk]
/// when the MTU is unknown.
int genericChunkBytes(int mtu) {
  if (mtu <= 0) return genericUnknownMtuChunk;
  final payload = mtu - 3;
  if (payload < genericMinChunk) return genericMinChunk;
  if (payload > genericMaxChunk) return genericMaxChunk;
  return payload;
}

// ---------------------------------------------------------------------------
// Printer details for the developer.
// ---------------------------------------------------------------------------

/// What the shop sends us. No customer data: only what the printer and the
/// phone say about themselves.
class PrinterDiagnostics {
  const PrinterDiagnostics({
    required this.deviceName,
    required this.platform,
    required this.appVersion,
    this.advertisedServiceUuids = const [],
    this.gatt,
    this.notifyFrames = const [],
    this.error = '',
  });

  final String deviceName;
  final String platform;
  final String appVersion;

  /// The service ids the printer advertised while scanning (empty when it
  /// was not seen this session, or the phone does not report them).
  final List<String> advertisedServiceUuids;

  /// What the printer's Bluetooth layout looked like (null: never connected).
  final PrinterGattInfo? gatt;

  /// Every notification received in the first [genericNotifyWindow] after
  /// connecting.
  final List<List<int>> notifyFrames;

  /// Why connecting or printing failed ('' = it did not).
  final String error;
}

/// At most this many notification frames, and this many bytes in all, go in
/// the details.
const diagnosticsMaxFrames = 16;
const diagnosticsMaxNotifyBytes = 128;

String _hex(List<int> bytes) =>
    bytes.map((b) => (b & 0xFF).toRadixString(16).padLeft(2, '0')).join(' ');

/// The notification frames as hex lines, capped at [diagnosticsMaxFrames]
/// frames and [diagnosticsMaxNotifyBytes] bytes; the last line says when
/// something was left out.
List<String> diagnosticsNotifyLines(List<List<int>> frames) {
  final lines = <String>[];
  var bytes = 0;
  var cut = false;
  for (final frame in frames) {
    if (lines.length >= diagnosticsMaxFrames ||
        bytes >= diagnosticsMaxNotifyBytes) {
      cut = true;
      break;
    }
    final room = diagnosticsMaxNotifyBytes - bytes;
    if (frame.length > room) {
      lines.add(_hex(frame.sublist(0, room)));
      bytes += room;
      cut = true;
      break;
    }
    lines.add(_hex(frame));
    bytes += frame.length;
  }
  if (cut) lines.add('(more not shown)');
  return lines;
}

/// The details as plain text, ready to share.
String formatPrinterDiagnostics(PrinterDiagnostics d) {
  final gatt = d.gatt;
  final out = StringBuffer()
    ..writeln('Laawol printer details (4 x 6 beta)')
    ..writeln('app: ${d.appVersion.isEmpty ? 'unknown' : d.appVersion}')
    ..writeln('platform: ${d.platform.isEmpty ? 'unknown' : d.platform}')
    ..writeln('printer name: "${d.deviceName}"')
    ..writeln(
      'advertised services: '
      '${d.advertisedServiceUuids.isEmpty ? 'none reported' : d.advertisedServiceUuids.join(', ')}',
    );
  if (d.error.isNotEmpty) out.writeln('failure: ${d.error}');
  if (gatt == null) {
    out.writeln('services: not read (never connected)');
  } else {
    out
      ..writeln(
        'mtu: ${gatt.mtu > 0 ? gatt.mtu : 'unknown'} '
        '(chunk ${genericChunkBytes(gatt.mtu)} bytes)',
      )
      ..writeln(
        gatt.hasWriteTarget
            ? 'used: service ${gatt.writeServiceUuid} characteristic '
                  '${gatt.writeCharUuid}, write '
                  '${gatt.writeWithoutResponse ? 'without' : 'with'} response'
            : 'used: none (no writable characteristic found)',
      )
      ..writeln(
        'notify: ${gatt.notifyCharUuid.isEmpty ? 'none' : gatt.notifyCharUuid}',
      )
      ..writeln('services (${gatt.services.length}):');
    for (final s in gatt.services) {
      out.writeln('  ${s.uuid}');
      if (s.characteristics.isEmpty) out.writeln('    (no characteristics)');
      for (final c in s.characteristics) {
        out.writeln('    ${c.uuid} [${c.props.text}]');
      }
    }
  }
  final notify = diagnosticsNotifyLines(d.notifyFrames);
  if (notify.isEmpty) {
    out.writeln(
      'notify bytes in the first ${genericNotifyWindow.inSeconds} s: none',
    );
  } else {
    out.writeln(
      'notify bytes in the first ${genericNotifyWindow.inSeconds} s:',
    );
    for (final line in notify) {
      out.writeln('  $line');
    }
  }
  return out.toString().trimRight();
}

/// A one-line JSON of the choice made, for the print log.
String genericTargetLogLine(PrinterGattInfo gatt) => jsonEncode({
  'services': gatt.services.length,
  'service': gatt.writeServiceUuid,
  'write': gatt.writeCharUuid,
  'notify': gatt.notifyCharUuid,
  'mtu': gatt.mtu,
  'withoutResponse': gatt.writeWithoutResponse,
});

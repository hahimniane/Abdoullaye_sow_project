import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Every pay button holds its busy state from the first tap - before the
/// confirmation sheet opens - so a second tap cannot start a second charge.
///
/// These flows await a confirmation (and sometimes an account check or an
/// office lookup) before the network call. The busy flag used to rise only
/// after those, leaving a window in which a second tap ran the whole flow
/// again.
void main() {
  String read(String path) => File(path).readAsStringSync();

  /// The source of [from] up to the next top-level member.
  String body(String source, String from) {
    final start = source.indexOf(from);
    expect(start, isNonNegative, reason: from);
    final end = source.indexOf('\n  Future<', start + from.length);
    return source.substring(start, end < 0 ? source.length : end);
  }

  void guardsBefore(String code, String guard, String firstAwait) {
    final guardAt = code.indexOf(guard);
    final awaitAt = code.indexOf(firstAwait);
    expect(guardAt, isNonNegative, reason: guard);
    expect(awaitAt, isNonNegative, reason: firstAwait);
    expect(guardAt, lessThan(awaitAt), reason: '$guard before $firstAwait');
  }

  test('shared barrel: Pay balance is busy before the confirmation', () {
    final code = body(
      read('lib/screens/open_barrels_screen.dart'),
      'Future<void> _handlePoolAction(',
    );
    guardsBefore(
      code,
      'if (_busyPoolIds.contains(pool.id)) return;',
      'await confirmMarketplaceTransaction(',
    );
    guardsBefore(
      code,
      'setState(() => _busyPoolIds.add(pool.id));',
      'await confirmMarketplaceTransaction(',
    );
    expect(code, contains('_busyPoolIds.remove(pool.id)'));
  });

  test('freight tracking: Pay balance is busy before the confirmation', () {
    final code = body(
      read('lib/screens/tracking_screen.dart'),
      'Future<void> _payFreightBalance(',
    );
    guardsBefore(
      code,
      'if (_balancePayments.contains(shipment.id)) return;',
      'await confirmMarketplaceTransaction(',
    );
  });

  test('car hold: Pay extension and Request extension are async buttons', () {
    final source = read('lib/screens/my_purchases_screen.dart');
    expect(source, contains('final Future<void> Function()? onPayExtension;'));
    expect(
      source,
      contains('final Future<void> Function()? onRequestExtension;'),
    );
    expect(source, contains('AsyncActionButton.filled(\n'));
    expect(source, contains('onPressed: onPayExtension,'));
    expect(
      source,
      isNot(
        contains(
          'FilledButton.icon(\n'
          '                      onPressed: onPayExtension',
        ),
      ),
    );
  });

  test('freight and barrel booking hold the flow from the first tap', () {
    for (final path in const [
      'lib/screens/send_freight_screen.dart',
      'lib/screens/send_barrel_screen.dart',
    ]) {
      final code = body(read(path), 'Future<void> _submit() async {');
      expect(code, contains('if (_submitInFlight'), reason: path);
      expect(code, contains('_submitInFlight = true;'), reason: path);
      expect(code, contains('_submitInFlight = false;'), reason: path);
    }
  });
}

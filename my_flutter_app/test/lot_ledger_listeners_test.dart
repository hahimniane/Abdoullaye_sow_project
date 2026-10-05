import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('every ledger listener handles its errors', () {
    // The regression: the users, activity types, expense lines/entries and
    // business listeners had no onError, so a rules refusal or a dropped
    // connection surfaced as an unhandled - fatal - stream error.
    final source = File(
      'lib/screens/lot_ledger_screen.dart',
    ).readAsStringSync();
    final start = source.indexOf('void _listen() {');
    final end = source.indexOf('Future<void> _loadCustomers()', start);
    expect(start, isNonNegative);
    expect(end, greaterThan(start));
    final listeners = source.substring(start, end);
    final listens = '.listen('.allMatches(listeners).length;
    final handled = 'onError:'.allMatches(listeners).length;
    expect(listens, greaterThan(0));
    expect(handled, listens);
    for (final what in const [
      'lotActivityTypes',
      'lotExpenseLines',
      'lotExpenseEntries',
      'users',
      'businesses',
    ]) {
      expect(listeners, contains("_keepWhatIsShown('$what')"), reason: what);
    }
  });
}

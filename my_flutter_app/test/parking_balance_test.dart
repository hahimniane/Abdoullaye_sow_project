import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/parking_balance.dart';

/// The server's `parkingBalanceNow` (functions/parking_month_statement.js) is
/// the rule; the shared fixture pins the server, the console and the app to
/// the same answers (docs/PARKING_WHATSAPP.md §2).
void main() {
  final fixture =
      jsonDecode(
            File(
              'functions/test/fixtures/parking-balance-cases.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;

  test('every shared parking-balance case gives the server answer', () {
    final cases = (fixture['cases'] as List).cast<Map<String, dynamic>>();
    expect(cases.length, greaterThanOrEqualTo(10));
    for (final c in cases) {
      final now = DateTime.parse('${c['now'] ?? fixture['now']}');
      final got = parkingBalanceNow(
        Map<String, dynamic>.from(c['car'] as Map),
        now,
      );
      expect(got?.toJson(), c['expected'], reason: '${c['name']}');
    }
  });
}

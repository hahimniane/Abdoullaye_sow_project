import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final source = File(
    'lib/screens/platform_admin_dashboard_screen.dart',
  ).readAsStringSync();

  test('recent operations are the newest records, not arbitrary ones', () {
    // The regression: .limit(5) with no order showed whichever five
    // documents Firestore reached first under "Recent operations".
    final query = source.substring(
      source.indexOf('Query<Map<String, dynamic>> recentOperationsQuery('),
    );
    final orderAt = query.indexOf(".orderBy('createdAt', descending: true)");
    final limitAt = query.indexOf('.limit(5)');
    expect(orderAt, isNonNegative);
    expect(limitAt, greaterThan(orderAt));
    expect(source, isNot(contains('.limit(5)\n          .snapshots()')));
  });

  test('the fallback business label is localized', () {
    expect(source, isNot(contains("'Unassigned business'")));
    expect(source, contains('l10n.unassignedBusiness'));
  });

  test('metrics and recent rows are not re-queried on every build', () {
    expect(source, contains('future: _metricsFor(access),'));
    expect(source, isNot(contains('future: _metrics(access),')));
    expect(source, contains('stream: _rows,'));
  });
}

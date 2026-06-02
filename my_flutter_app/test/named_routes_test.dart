import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Navigator named routes are registered in MaterialApp routes', () {
    final mainSource = File('lib/main.dart').readAsStringSync();
    final screenSources = Directory('lib/screens')
        .listSync(recursive: true)
        .whereType<File>()
        .where((file) => file.path.endsWith('.dart'));

    final registeredRoutes = RegExp(
      r"'(/[^']*)'\s*:",
    ).allMatches(mainSource).map((match) => match.group(1)!).toSet();

    final usedRoutes = <String>{};
    final navigatorRoutePattern = RegExp(
      r"Navigator\.(?:pushNamed|pushReplacementNamed|pushNamedAndRemoveUntil)\s*\([^,]+,\s*'(/[^']*)'",
      multiLine: true,
      dotAll: true,
    );

    for (final file in screenSources) {
      final source = file.readAsStringSync();
      for (final match in navigatorRoutePattern.allMatches(source)) {
        usedRoutes.add(match.group(1)!);
      }
    }

    final missingRoutes = usedRoutes.difference(registeredRoutes);
    expect(
      missingRoutes,
      isEmpty,
      reason: 'Every Navigator named route should be registered in main.dart.',
    );
  });
}

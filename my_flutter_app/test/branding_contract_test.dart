import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('release-facing platform metadata uses the Laawol brand', () {
    final files = <String>[
      'ios/Runner/Info.plist',
      'ios/Runner/en.lproj/InfoPlist.strings',
      'ios/Runner/fr.lproj/InfoPlist.strings',
      'web/manifest.json',
      'windows/runner/main.cpp',
      'windows/runner/Runner.rc',
    ];

    for (final path in files) {
      final contents = File(path).readAsStringSync();
      expect(
        contents.toLowerCase(),
        isNot(contains('veyra')),
        reason: '$path still exposes the previous product name',
      );
      expect(
        contents,
        contains('Laawol'),
        reason: '$path should identify the current product',
      );
    }
  });
}

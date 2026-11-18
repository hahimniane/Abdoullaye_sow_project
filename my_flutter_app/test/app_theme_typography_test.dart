import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The app sets one face, the website's: Plus Jakarta Sans
/// (docs/APP_NEW_LOOK.md). A second face creeping back in - the old serif
/// display, or the mono that made a sentence read as code - is what this
/// guards.
void main() {
  final theme = File('lib/theme/app_theme.dart').readAsStringSync();
  final typography = File('lib/theme/app_typography.dart').readAsStringSync();

  test('one typeface, the website\'s', () {
    final faces = RegExp(r'GoogleFonts\.(\w+)\(')
        .allMatches('$typography\n$theme')
        .map((m) => m.group(1)!)
        .toSet();
    expect(faces, isNotEmpty);
    expect(
      faces.where((face) => !face.startsWith('plusJakartaSans')),
      isEmpty,
      reason: 'every text style is Plus Jakarta Sans',
    );
  });

  test('a field explains itself in the reading style', () {
    // Flutter falls back to textTheme.bodySmall for both of these, the style
    // of short meta labels; a helper line and a validation error are
    // sentences, so they are set from bodyMedium.
    for (final name in const ['helperStyle', 'errorStyle']) {
      final match = RegExp('$name: ([^;]+?)copyWith', dotAll: true)
          .firstMatch(theme);
      expect(match, isNotNull, reason: '$name is set in the theme');
      expect(
        match!.group(1),
        contains('bodyMedium'),
        reason: '$name should come from the reading style',
      );
    }
  });
}

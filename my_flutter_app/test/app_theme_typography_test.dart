import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The app sets three faces: a serif for display, a grotesk for reading, and
/// JetBrains Mono for short meta labels. Mono is the one that goes wrong when
/// it escapes its lane — set even and wide, a sentence in it reads as code.
void main() {
  final theme = File('lib/theme/app_theme.dart').readAsStringSync();
  final typography = File('lib/theme/app_typography.dart').readAsStringSync();

  test('the mono face is reserved for short meta labels', () {
    final monoStyles = RegExp(r'(\w+): GoogleFonts\.jetBrainsMono')
        .allMatches(typography)
        .map((m) => m.group(1)!)
        .toSet();
    expect(monoStyles, {'bodySmall', 'labelMedium'},
        reason: 'mono is for meta labels, never for body or display copy');
  });

  test('a field explains itself in the reading face, not the code face', () {
    // Flutter falls back to textTheme.bodySmall for both of these, which is
    // the mono — so every helper line and every validation error under every
    // field in the app came out monospaced until these were set.
    expect(theme, contains('helperStyle:'));
    expect(theme, contains('errorStyle:'));
    for (final match in RegExp(r'(helperStyle|errorStyle): ([^\n]+)')
        .allMatches(theme)) {
      expect(match.group(2), contains('bodyMedium'),
          reason: '${match.group(1)} should come from the reading face');
    }
  });
}

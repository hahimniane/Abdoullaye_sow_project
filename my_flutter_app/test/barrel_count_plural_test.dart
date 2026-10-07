import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations_en.dart';
import 'package:my_flutter_app/l10n/app_localizations_fr.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/services/container_manifest.dart';

/// Regression: a container line of one barrel read "1 barrels" (and the
/// barrel order summary "1 barrels • 1 destinations • 1 businesses") because
/// the strings interpolated the count instead of using an ICU plural.
void main() {
  ContainerLine barrels(int quantity) => ContainerLine.fromMap('l1', {
        'kind': containerLineKindBarrels,
        'quantity': quantity,
        'description': '',
      });

  test('a barrel line counts in the singular and the plural', () {
    final en = AppLocalizationsEn();
    final fr = AppLocalizationsFr();
    expect(containerLineTitle(en, barrels(1)), '1 barrel');
    expect(containerLineTitle(en, barrels(3)), '3 barrels');
    expect(containerLineTitle(fr, barrels(1)), '1 baril');
    expect(containerLineTitle(fr, barrels(3)), '3 barils');
  });

  test('the barrel order summary agrees with each count', () {
    expect(AppLocalizationsEn().barrelOrderSummary(1, 1, 1),
        '1 barrel • 1 destination • 1 business');
    expect(AppLocalizationsEn().barrelOrderSummary(4, 2, 3),
        '4 barrels • 2 destinations • 3 businesses');
    expect(AppLocalizationsFr().barrelOrderSummary(1, 1, 1),
        '1 baril • 1 destination • 1 entreprise');
    expect(AppLocalizationsFr().barrelOrderSummary(4, 2, 3),
        '4 barils • 2 destinations • 3 entreprises');
  });

  test('no ARB message puts a bare count in front of "barrels"', () {
    for (final file in ['lib/l10n/app_en.arb', 'lib/l10n/app_fr.arb']) {
      final arb = jsonDecode(File(file).readAsStringSync())
          as Map<String, dynamic>;
      for (final entry in arb.entries) {
        if (entry.key.startsWith('@') || entry.value is! String) continue;
        // "{count} barrels" outside a plural branch is the bug.
        final unpluralized = RegExp(r'(^|[^{])\{\w+\} (barrels|barils)\b');
        expect(unpluralized.hasMatch(entry.value as String), isFalse,
            reason: '$file ${entry.key}: ${entry.value}');
      }
    }
  });
}

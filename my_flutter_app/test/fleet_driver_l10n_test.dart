import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The driver account's words (docs/FLEET.md section 11): every `fdr` key
/// exists in English and French with the same placeholders, and no French
/// text was left in English.
void main() {
  Map<String, dynamic> arb(String lang) =>
      jsonDecode(File('lib/l10n/app_$lang.arb').readAsStringSync())
          as Map<String, dynamic>;
  final en = arb('en');
  final fr = arb('fr');
  final keys = [
    for (final k in en.keys)
      if (k.startsWith('fdr')) k,
  ];

  test('English and French carry the same driver keys and metadata', () {
    expect(keys.length, greaterThan(50));
    expect([
      for (final k in fr.keys)
        if (k.startsWith('fdr')) k,
    ], keys);
    for (final k in en.keys.where((k) => k.startsWith('@fdr'))) {
      expect(fr[k], en[k], reason: k);
    }
  });

  test('every placeholder is declared, in both files', () {
    final holder = RegExp(r'\{(\w+)(?:,|\})');
    for (final k in keys) {
      for (final file in [en, fr]) {
        final names = {
          for (final m in holder.allMatches(file[k] as String)) m[1]!,
        }..removeWhere((n) => n == 'plural' || n == 'other');
        if (names.isEmpty) continue;
        final meta = file['@$k'] as Map<String, dynamic>?;
        expect(meta, isNotNull, reason: '@$k');
        expect((meta!['placeholders'] as Map).keys.toSet(), names, reason: k);
      }
    }
  });

  test('French is French: no key reads the same as English, bar the few '
      'words both languages share', () {
    const same = {'fdrBillTicket'};
    for (final k in keys) {
      if (same.contains(k)) continue;
      expect(fr[k], isNot(en[k]), reason: k);
    }
  });
}

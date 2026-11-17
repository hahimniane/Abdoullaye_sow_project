import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/fleet.dart';
import 'package:my_flutter_app/widgets/fleet_widgets.dart';

/// Fleet's words (docs/FLEET.md): every `flt` key exists in English and French
/// with the same placeholders, sits in ONE block after `pcsErrPiecesRequired`,
/// and every refusal the server can name has its own sentence in both
/// languages.
void main() {
  Map<String, dynamic> arb(String lang) =>
      jsonDecode(File('lib/l10n/app_$lang.arb').readAsStringSync())
          as Map<String, dynamic>;
  final en = arb('en');
  final fr = arb('fr');
  final keys = [
    for (final k in en.keys)
      if (k.startsWith('flt')) k,
  ];
  final frKeys = [
    for (final k in fr.keys)
      if (k.startsWith('flt')) k,
  ];

  test('English and French carry the same Fleet keys, metadata included', () {
    expect(keys, isNotEmpty);
    expect(frKeys, keys);
    for (final k in en.keys.where((k) => k.startsWith('@flt'))) {
      expect(fr[k], en[k], reason: k);
    }
  });

  test('every key with a placeholder has its metadata, in both files', () {
    final holder = RegExp(r'\{(\w+)(?:,|\})');
    for (final k in keys) {
      final text = en[k] as String;
      final names = {
        for (final m in holder.allMatches(text))
          if (m[1] != 'plural') m[1]!,
      };
      if (names.isEmpty) continue;
      for (final file in [en, fr]) {
        final meta = file['@$k'] as Map<String, dynamic>?;
        expect(meta, isNotNull, reason: '@$k');
        expect((meta!['placeholders'] as Map).keys.toSet(), names, reason: k);
      }
    }
  });

  test('the Fleet keys are one block right after pcsErrPiecesRequired', () {
    for (final file in [en, fr]) {
      final all = file.keys.toList();
      final anchor = all.indexOf('pcsErrPiecesRequired');
      final inBlock = [
        for (var i = anchor + 1; i < all.length; i++)
          if (all[i].startsWith('flt') || all[i].startsWith('@flt'))
            all[i]
          else
            null,
      ];
      final run = inBlock.takeWhile((k) => k != null).length;
      final total = all
          .where((k) => k.startsWith('flt') || k.startsWith('@flt'))
          .length;
      expect(run, total);
    }
  });

  test('no key uses a reserved freight word', () {
    for (final k in keys) {
      expect(k.toLowerCase(), isNot(contains('payback')));
      expect(k.toLowerCase(), isNot(contains('coverage')));
    }
  });

  test('French is real French, not the English copied over', () {
    const same = {
      'fltMethodZelle',
      'fltFieldVin',
      'fltExpiryOk',
      'fltFieldNote',
      'fltFieldNotes',
    };
    for (final k in keys) {
      if (same.contains(k)) continue;
      expect(fr[k], isNot(en[k]), reason: k);
    }
  });

  test(
    'every refusal the server names has its own words in both languages',
    () {
      final l10nEn = lookupAppLocalizations(const Locale('en'));
      final l10nFr = lookupAppLocalizations(const Locale('fr'));
      final seen = <String>{};
      for (final reason in fleetRefusalReasons) {
        final failure = FleetFailure(
          code: 'failed-precondition',
          reason: reason,
        );
        final textEn = fleetRefusalText(l10nEn, failure);
        final textFr = fleetRefusalText(l10nFr, failure);
        expect(textEn, isNot(l10nEn.fltErrUnknown), reason: reason);
        expect(textFr, isNot(l10nFr.fltErrUnknown), reason: reason);
        expect(seen.add(textEn), isTrue, reason: '$reason repeats a sentence');
      }
      expect(
        fleetRefusalText(l10nEn, const FleetFailure(code: 'unavailable')),
        l10nEn.fltErrOffline,
      );
      expect(
        fleetRefusalText(l10nFr, const FleetFailure(code: 'unknown')),
        l10nFr.fltErrUnknown,
      );
    },
  );

  test('every bank-deposit reason has words', () {
    final l10n = lookupAppLocalizations(const Locale('en'));
    final seen = <String>{};
    for (final reason in fleetWaitingReasons) {
      expect(
        seen.add(fleetWaitingReasonText(l10n, reason)),
        isTrue,
        reason: reason,
      );
    }
  });

  test('the Fleet screens hold no English literals of their own', () {
    for (final f in Directory(
      'lib/screens',
    ).listSync().whereType<File>().where((f) => f.path.contains('/fleet_'))) {
      final src = f.readAsStringSync();
      expect(RegExp(r"Text\('[A-Za-z]").hasMatch(src), isFalse, reason: f.path);
      expect(src, isNot(contains('copy(')), reason: f.path);
    }
  });
}

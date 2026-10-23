import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/lot_vin_duplicates.dart';

void main() {
  group('the VIN duplicate rule, as the app reads it', () {
    test('reads the groups out of a callable answer (nested Object maps)', () {
      // iOS hands callable payloads back as Map<Object?, Object?>.
      final Map<Object?, Object?> answer = {
        'duplicates': <Object?>[
          <Object?, Object?>{
            'key': 'VIN1|dispatch',
            'vinKey': '1HGCM82633A004352',
            'jobKey': 'dispatch',
            'jobLabel': 'Dispatch',
            'sameCustomer': true,
            'activities': <Object?>[
              <Object?, Object?>{
                'id': 'a',
                'trackingCode': 'LA-A',
                'activityDate': 1760529600000,
                'activityTypeId': 'dispatch',
                'activityTypeLabel': 'Dispatch',
                'customerName': 'Alimou',
                'feeCents': 5000,
                'paymentStatus': 'succeeded',
              },
              <Object?, Object?>{
                'id': 'b',
                'trackingCode': 'LA-B',
                'activityDate': null,
                'feeCents': 2500,
              },
            ],
          },
          // One record is not a group; nonsense is dropped.
          <Object?, Object?>{
            'vinKey': 'X',
            'activities': <Object?>[
              <Object?, Object?>{'id': 'solo'},
            ],
          },
          'nonsense',
        ],
      };
      final groups = lotDuplicateGroupsFrom(answer);
      expect(groups, hasLength(1));
      final group = groups.single;
      expect(group.sameCustomer, isTrue);
      expect(group.jobLabel, 'Dispatch');
      expect(group.activities.map((a) => a.id), ['a', 'b']);
      expect(group.activities.first.paid, isTrue);
      expect(group.activities.first.activityDate,
          DateTime.fromMillisecondsSinceEpoch(1760529600000));
      expect(group.activities.last.activityDate, isNull);
      expect(group.activities.last.feeCents, 2500);
      expect(lotDuplicateGroupsFrom(null), isEmpty);
      expect(lotDuplicateGroupsFrom({'duplicates': 'no'}), isEmpty);
    });

    test('recognises the two refusals by reason, nothing else', () {
      final duplicate = lotVinJobRefusalFrom(<Object?, Object?>{
        'reason': 'vin_job_duplicate',
        'existingActivityId': 'a1',
        'existingTrackingCode': 'LA-A1',
        'existingActivityDate': '2026-10-01T12:00:00.000Z',
        'existingCustomerName': 'Alimou',
      });
      expect(duplicate?.kind, LotVinJobRefusalKind.duplicate);
      final first = duplicate!.existing.single;
      expect(first.activityId, 'a1');
      expect(first.trackingCode, 'LA-A1');
      expect(first.customerName, 'Alimou');
      expect(first.activityDate, DateTime.utc(2026, 10, 1, 12));

      final repeat = lotVinJobRefusalFrom(<Object?, Object?>{
        'reason': 'vin_job_repeat_confirm',
        'existing': <Object?>[
          <Object?, Object?>{
            'activityId': 'a1',
            'trackingCode': 'LA-A1',
            'activityDate': '',
            'customerName': 'Fatou',
          },
        ],
      });
      expect(repeat?.kind, LotVinJobRefusalKind.repeat);
      expect(repeat!.existing.single.customerName, 'Fatou');
      expect(repeat.existing.single.activityDate, isNull);

      expect(lotVinJobRefusalFrom({'reason': 'paid_amount_locked'}), isNull);
      expect(lotVinJobRefusalFrom(null), isNull);
      expect(lotVinJobRefusalFrom('boom'), isNull);
    });

    test('shows a VIN by its last 8 and picks the English article', () {
      expect(lotVinTail('1hgcm82633a 004352'), '…3A004352');
      expect(lotVinTail(''), '');
      expect(lotJobArticle('Auction purchase'), 'an');
      expect(lotJobArticle('Dispatch'), 'other');
    });

    testWidgets('words the notice and the question in English and French',
        (tester) async {
      Future<AppLocalizations> load(Locale locale) async {
        late AppLocalizations l10n;
        await tester.pumpWidget(Localizations(
          locale: locale,
          delegates: AppLocalizations.localizationsDelegates,
          child: Builder(builder: (context) {
            l10n = AppLocalizations.of(context)!;
            return const SizedBox();
          }),
        ));
        return l10n;
      }

      final en = await load(const Locale('en'));
      expect(
        en.lotVinDuplicateNotice(
            lotJobArticle('Dispatch'), 'Dispatch', 'LA-A1', 'Oct 1, 2026'),
        'This car already has a Dispatch for this customer: LA-A1 '
        '(Oct 1, 2026)',
      );
      expect(
        en.lotVinDuplicateNotice(lotJobArticle('Auction purchase'),
            'Auction purchase', 'LA-A1', 'Oct 1, 2026'),
        startsWith('This car already has an Auction purchase'),
      );
      expect(
        en.lotRepeatConfirmBody('other', 'Dispatch',
            en.lotRepeatConfirmItem('Oct 1, 2026', 'Fatou', 'LA-A1')),
        'This car already had a Dispatch on Oct 1, 2026 for Fatou (LA-A1). '
        'Record another for this customer?',
      );
      final fr = await load(const Locale('fr'));
      expect(
        fr.lotVinDuplicateNotice('other', 'Dispatch', 'LA-A1', '1 oct. 2026'),
        'Cette voiture a déjà « Dispatch » pour ce client : LA-A1 '
        '(1 oct. 2026)',
      );
      expect(
        fr.lotRepeatConfirmBody('other', 'Dispatch',
            fr.lotRepeatConfirmItem('1 oct. 2026', 'Fatou', 'LA-A1')),
        'Cette voiture a déjà eu « Dispatch » le 1 oct. 2026 pour Fatou '
        '(LA-A1). En enregistrer un autre pour ce client ?',
      );
      expect(fr.lotDuplicateDifferentCustomers,
          startsWith('Clients différents'));
    });

    test('the screen wires the rule: list, banner, void, confirm, open', () {
      final screen =
          File('lib/screens/lot_ledger_screen.dart').readAsStringSync();
      // The list is the server's, over every activity.
      expect(screen, contains("'action': 'vinDuplicates'"));
      expect(screen, contains("httpsCallable('getLotLedgerTotals')"));
      expect(screen, contains('_DuplicatesBanner('));
      expect(screen, contains('_DuplicatesSheet('));
      // Refusals are read by reason; a repeat is resent with confirmRepeat.
      expect(screen, contains('lotVinJobRefusalFrom(error.details)'));
      expect(screen, contains("if (confirmRepeat) 'confirmRepeat': true"));
      expect(screen, contains('l10n.lotOpenIt'));
      // The list's Void is the ledger's own void sheet.
      expect(
          RegExp(r"_DuplicateGroupCard[\s\S]*_VoidSheet\(\s*callable: 'voidLotActivity'")
              .hasMatch(screen),
          isTrue);
    });
  });
}

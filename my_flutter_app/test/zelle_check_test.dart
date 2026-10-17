import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_credit.dart';
import 'package:my_flutter_app/services/waiting_packages.dart';
import 'package:my_flutter_app/services/zelle_check.dart';
import 'package:my_flutter_app/services/zelle_check_service.dart';
import 'package:my_flutter_app/widgets/zelle_check_widgets.dart';

/// Zelle checks against the owner's bank: the requests sent to the bank
/// callables, how their answers and the records' `bankCheck` are read, the
/// failure codes, the 20 s / 3 min re-check schedule and the confirmation
/// line. Pure: no Firebase, no widgets.

/// 2:43 PM in New York on Oct 17, 2026 (daylight time, UTC-4).
final _atMs = DateTime.utc(2026, 10, 17, 18, 43).millisecondsSinceEpoch;

String _plain(String s) => s.replaceAll(RegExp('[  ]'), ' ');

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  group('requests', () {
    test('each callable gets exactly the contract fields', () {
      expect(createBankLinkTokenRequest('b1', platform: 'ios'), {
        'businessId': 'b1',
        'platform': 'ios',
      });
      expect(connectBusinessBankRequest('b1', publicToken: 'public-x'), {
        'businessId': 'b1',
        'publicToken': 'public-x',
      });
      expect(
        connectBusinessBankRequest('b1', publicToken: 'p', accountId: ' a1 '),
        {'businessId': 'b1', 'publicToken': 'p', 'accountId': 'a1'},
      );
      expect(businessBankRequest('b1'), {'businessId': 'b1'});
      expect(setBankCheckWindowRequest('b1', 30), {
        'businessId': 'b1',
        'minutes': 30,
      });
      expect(
        checkZellePaymentRequest('b1', ZelleCheckKind.inventorySale, 's1'),
        {'businessId': 'b1', 'kind': 'inventory_sale', 'id': 's1'},
      );
      expect(
        confirmZelleCandidateRequest(
          'b1',
          ZelleCheckKind.containerLinePayment,
          'p1',
          'cr-2',
        ),
        {
          'businessId': 'b1',
          'kind': 'container_line_payment',
          'id': 'p1',
          'creditId': 'cr-2',
        },
      );
      expect(
        ZelleCheckKind.inventoryCreditPayment.wire,
        'inventory_credit_payment',
      );
      expect(bankLinkPlatform(isIOS: true), 'ios');
      expect(bankLinkPlatform(isIOS: false), 'android');
    });

    test('the window choices are the owner-approved ones, inside 2..60', () {
      expect(bankCheckWindowChoices, [2, 5, 10, 15, 30, 60]);
      expect(defaultBankCheckWindowMinutes, 15);
      expect(bankCheckWindowChoices.every(bankCheckWindowValid), isTrue);
      expect(bankCheckWindowValid(1), isFalse);
      expect(bankCheckWindowValid(61), isFalse);
    });

    test('the service sends every call through the one caller', () async {
      final log = <(String, Map<String, Object?>)>[];
      final service = ZelleCheckService(
        caller: (name, payload) async {
          log.add((name, payload));
          return switch (name) {
            'checkZellePayment' => {'result': 'not_found'},
            'createBankLinkToken' => {'linkToken': 'link-1'},
            _ => <String, Object?>{},
          };
        },
      );
      final result = await service.check(
        'b1',
        ZelleCheckKind.inventoryCreditPayment,
        'p9',
      );
      expect(result!.outcome, ZelleCheckOutcome.notFound);
      final token = await service.createLinkToken('b1', platform: 'android');
      expect(token!.linkToken, 'link-1');
      await service.setWindow('b1', 5);
      await service.disconnect('b1');
      expect(
        [for (final c in log) c.$1],
        [
          'checkZellePayment',
          'createBankLinkToken',
          'setBankCheckWindow',
          'disconnectBusinessBank',
        ],
      );
      expect(log.first.$2['kind'], 'inventory_credit_payment');
    });
  });

  group('checkZellePayment answers', () {
    test('confirmed carries what landed', () {
      final r = ZelleCheckResult.fromCallable({
        'result': 'confirmed',
        'confirmation': {
          'amountCents': 6000,
          'atMs': _atMs,
          'senderName': 'FATOU D.',
          'institutionName': 'Chase',
        },
      })!;
      expect(r.outcome, ZelleCheckOutcome.confirmed);
      expect(r.isConfirmed, isTrue);
      expect(r.confirmation!.amountCents, 6000);
      expect(r.confirmation!.senderName, 'FATOU D.');
      expect(r.confirmation!.at, DateTime.utc(2026, 10, 17, 18, 43));
    });

    test('already confirmed reads as confirmed', () {
      final r = ZelleCheckResult.fromCallable(<Object?, Object?>{
        'result': 'already_confirmed',
        'confirmation': <Object?, Object?>{'amountCents': 6000},
      })!;
      expect(r.outcome, ZelleCheckOutcome.alreadyConfirmed);
      expect(r.isConfirmed, isTrue);
    });

    test('"confirmed" without an amount is not a confirmation', () {
      expect(ZelleCheckResult.fromCallable({'result': 'confirmed'}), isNull);
      expect(
        ZelleCheckResult.fromCallable({
          'result': 'confirmed',
          'confirmation': {'amountCents': 0},
        }),
        isNull,
      );
    });

    test('not found', () {
      final r = ZelleCheckResult.fromCallable({'result': 'not_found'})!;
      expect(r.outcome, ZelleCheckOutcome.notFound);
      expect(r.isConfirmed, isFalse);
    });

    test('choose lists each deposit once; an empty choice is unread', () {
      final r = ZelleCheckResult.fromCallable({
        'result': 'choose',
        'candidates': [
          {'creditId': 'c1', 'atMs': _atMs, 'senderName': 'FATOU D.'},
          {'creditId': 'c2', 'senderName': ''},
          {'creditId': 'c1', 'senderName': 'again'},
          {'creditId': ''},
          'junk',
        ],
      })!;
      expect(r.outcome, ZelleCheckOutcome.choose);
      expect([for (final c in r.candidates) c.creditId], ['c1', 'c2']);
      expect(r.candidates.first.senderName, 'FATOU D.');
      expect(
        ZelleCheckResult.fromCallable({'result': 'choose', 'candidates': []}),
        isNull,
      );
    });

    test('confirmZelleCandidate answers with the confirmation alone', () {
      final r = ZelleCheckResult.fromCallable({
        'confirmation': {'amountCents': 6000, 'senderName': 'AWA B.'},
      })!;
      expect(r.outcome, ZelleCheckOutcome.confirmed);
      expect(r.confirmation!.senderName, 'AWA B.');
    });

    test('an answer the phone cannot read is null, never "found"', () {
      expect(ZelleCheckResult.fromCallable(null), isNull);
      expect(ZelleCheckResult.fromCallable({'result': 'maybe'}), isNull);
      expect(ZelleCheckResult.fromCallable(<String, Object?>{}), isNull);
    });
  });

  group('bankCheck on the records', () {
    final stored = {
      'status': 'confirmed',
      'creditId': 'c1',
      'amountCents': 6000,
      'atMs': _atMs,
      'senderName': 'FATOU D.',
      'institutionName': 'Chase',
      'checkedByUid': 'u-kofi',
      'checkedAt': DateTime(2026, 10, 17, 14, 44),
    };

    test('read on a sale, a credit payment and a package payment', () {
      final sale = InventorySale.fromMap('s1', {
        'paymentMethod': 'zelle',
        'totalCents': 6000,
        'bankCheck': stored,
      });
      expect(sale.bankCheck!.confirmed, isTrue);
      expect(sale.bankCheck!.checkedByUid, 'u-kofi');
      expect(sale.bankCheck!.checkedAt, DateTime(2026, 10, 17, 14, 44));

      final credit = InventoryCreditPayment.fromMap('p1', {
        'amountCents': 6000,
        'method': 'zelle',
        'bankCheck': stored,
      });
      expect(credit.bankCheck!.creditId, 'c1');

      final pkg = ContainerLinePayment.fromMap('p2', {
        'amountCents': 6000,
        'method': 'zelle',
        'bankCheck': {'status': 'not_found', 'checkedByUid': 'u1'},
      });
      expect(pkg.bankCheck!.confirmed, isFalse);
      expect(showsBankConfirmedChip(pkg.bankCheck), isFalse);
    });

    test('missing or unknown status is no bank check', () {
      expect(InventorySale.fromMap('s1', {'totalCents': 1}).bankCheck, isNull);
      expect(BankCheck.fromMap({'status': 'pending'}), isNull);
      expect(BankCheck.fromMap('confirmed'), isNull);
      expect(showsBankConfirmedChip(null), isFalse);
    });

    test('Check Zelle is offered only where it can mean something', () {
      final ok = BankCheck.fromMap(stored);
      expect(offersZelleCheck(method: 'zelle', amountCents: 6000), isTrue);
      expect(offersZelleCheck(method: 'Zelle ', amountCents: 6000), isTrue);
      expect(offersZelleCheck(method: 'cash', amountCents: 6000), isFalse);
      expect(offersZelleCheck(method: 'zelle', amountCents: 0), isFalse);
      expect(
        offersZelleCheck(method: 'zelle', amountCents: 6000, reverted: true),
        isFalse,
      );
      expect(
        offersZelleCheck(method: 'zelle', amountCents: 6000, bankCheck: ok),
        isFalse,
      );
      // A "not found yet" check can be run again.
      expect(
        offersZelleCheck(
          method: 'zelle',
          amountCents: 6000,
          bankCheck: BankCheck.fromMap({'status': 'not_found'}),
        ),
        isTrue,
      );
    });
  });

  group('bank status', () {
    test('owner: bank, mask (digits only), window, last sync', () {
      final s = BusinessBankStatus.fromCallable({
        'connected': true,
        'status': 'active',
        'institutionName': 'Chase',
        'accountMask': '1234',
        'windowMinutes': 30,
        'lastSyncAt': _atMs,
      });
      expect(s.active, isTrue);
      expect(s.institutionName, 'Chase');
      expect(bankAccountMaskLabel(s.accountMask), '•••• 1234');
      expect(s.windowMinutes, 30);
      expect(s.lastSyncAt, DateTime.utc(2026, 10, 17, 18, 43));
      expect(
        BusinessBankStatus.fromCallable({
          'connected': true,
          'accountMask': 'x9<8>7',
        }).accountMask,
        '987',
      );
      expect(bankAccountMaskLabel(''), '');
    });

    test('staff: connected and status only', () {
      final s = BusinessBankStatus.fromCallable({
        'connected': true,
        'status': 'needs_reauth',
        'windowMinutes': 15,
      });
      expect(s.needsReauth, isTrue);
      expect(s.institutionName, '');
    });

    test('not connected wins over any status; bad windows fall back', () {
      final s = BusinessBankStatus.fromCallable({
        'connected': false,
        'status': 'active',
        'windowMinutes': 999,
      });
      expect(s.connected, isFalse);
      expect(s.status, BankLinkStatus.disconnected);
      expect(s.windowMinutes, defaultBankCheckWindowMinutes);
      expect(
        BusinessBankStatus.fromCallable({'connected': true}).status,
        BankLinkStatus.active,
      );
      expect(BankLinkToken.fromCallable({'expiration': 'x'}), isNull);
    });
  });

  group('failures', () {
    test('every server code has its own failure', () {
      const codes = {
        'bank_not_connected': ZelleCheckFailure.bankNotConnected,
        'bank_needs_reauth': ZelleCheckFailure.bankNeedsReauth,
        'not_zelle': ZelleCheckFailure.notZelle,
        'record_not_found': ZelleCheckFailure.recordNotFound,
        'record_voided': ZelleCheckFailure.recordVoided,
        'bank_owner_required': ZelleCheckFailure.bankOwnerRequired,
        'window_invalid': ZelleCheckFailure.windowInvalid,
        'bank_access_denied': ZelleCheckFailure.bankAccessDenied,
        'kind_invalid': ZelleCheckFailure.kindInvalid,
        'platform_invalid': ZelleCheckFailure.platformInvalid,
        'public_token_required': ZelleCheckFailure.publicTokenRequired,
        'no_depository_account': ZelleCheckFailure.noDepositoryAccount,
        'candidate_invalid': ZelleCheckFailure.candidateInvalid,
        'candidate_taken': ZelleCheckFailure.candidateTaken,
        'bank_error': ZelleCheckFailure.bankError,
      };
      for (final e in codes.entries) {
        expect(
          zelleCheckFailureOf(
            code: 'failed-precondition',
            details: {'reason': e.key},
          ),
          e.value,
          reason: e.key,
        );
      }
      expect(
        zelleCheckFailureOf(
          details: {
            'reasons': ['x', 'record_voided'],
          },
        ),
        ZelleCheckFailure.recordVoided,
      );
      expect(
        zelleCheckFailureOf(details: {'code': 'not_zelle'}),
        ZelleCheckFailure.notZelle,
      );
    });

    test('without a code: network, permission, device, unknown', () {
      expect(
        zelleCheckFailureOf(code: 'unavailable'),
        ZelleCheckFailure.network,
      );
      expect(
        zelleCheckFailureOf(code: 'deadline-exceeded'),
        ZelleCheckFailure.network,
      );
      expect(
        zelleCheckFailureOf(code: 'permission-denied'),
        ZelleCheckFailure.noPermission,
      );
      expect(
        zelleCheckFailureOf(code: 'unauthenticated'),
        ZelleCheckFailure.deviceNotVerified,
      );
      expect(zelleCheckFailureOf(code: 'internal'), ZelleCheckFailure.unknown);
    });

    test('each failure reads in English and French, never blank', () {
      final en = lookupAppLocalizations(const Locale('en'));
      final fr = lookupAppLocalizations(const Locale('fr'));
      for (final f in ZelleCheckFailure.values) {
        expect(zelleFailureText(en, f), isNotEmpty);
        expect(zelleFailureText(fr, f), isNotEmpty);
      }
      expect(
        zelleFailureText(fr, ZelleCheckFailure.bankOwnerRequired),
        "Seul le propriétaire de l'entreprise peut connecter ou modifier la banque.",
      );
    });
  });

  group('re-check schedule', () {
    test('every 20 s for 3 minutes: 9 re-checks, then it stops', () {
      final c = ZelleRetryCountdown();
      expect(c.maxAutoChecks, 9);
      var fired = 0;
      var seconds = 0;
      c.scheduleNext();
      while (c.running) {
        seconds++;
        if (c.tick()) {
          fired++;
          // The check answered "not found" again.
          c.scheduleNext();
        }
      }
      expect(fired, 9);
      expect(seconds, 180);
      expect(c.exhausted, isTrue);
      expect(c.stopped, isFalse);
    });

    test('the countdown shows the seconds left', () {
      final c = ZelleRetryCountdown()..scheduleNext();
      expect(c.secondsLeft, 20);
      c.tick();
      expect(c.secondsLeft, 19);
      for (var i = 0; i < 18; i++) {
        expect(c.tick(), isFalse);
      }
      expect(c.secondsLeft, 1);
      expect(c.tick(), isTrue);
      expect(c.running, isFalse);
      expect(c.secondsLeft, 0);
    });

    test('Stop holds until Check again starts a fresh window', () {
      final c = ZelleRetryCountdown()..scheduleNext();
      c.tick();
      c.stop();
      expect(c.running, isFalse);
      expect(c.stopped, isTrue);
      expect(c.tick(), isFalse);
      c.scheduleNext();
      expect(c.running, isFalse, reason: 'stopped stays stopped');
      c.reset();
      c.scheduleNext();
      expect(c.running, isTrue);
      expect(c.autoChecksDone, 0);
    });
  });

  group('server details (agent/plaid-server)', () {
    /// Noon UTC on Oct 17, 2026: what a date-only deposit carries.
    final noonMs = DateTime.utc(2026, 10, 17, 12).millisecondsSinceEpoch;

    test('Plaid Link gets the app language; others are not sent', () {
      expect(
        createBankLinkTokenRequest('b1', platform: 'ios', language: 'fr'),
        {'businessId': 'b1', 'platform': 'ios', 'language': 'fr'},
      );
      expect(
        createBankLinkTokenRequest('b1', platform: 'ios', language: 'en-US'),
        {'businessId': 'b1', 'platform': 'ios', 'language': 'en'},
      );
      expect(
        createBankLinkTokenRequest('b1', platform: 'ios', language: 'es'),
        {'businessId': 'b1', 'platform': 'ios'},
      );
    });

    test(
      'timeKnown: false is read on confirmations, candidates, bankCheck',
      () {
        final c = ZelleConfirmation.fromMap({
          'amountCents': 6000,
          'atMs': noonMs,
          'timeKnown': false,
        })!;
        expect(c.timeKnown, isFalse);
        expect(
          ZelleConfirmation.fromMap({'amountCents': 1})!.timeKnown,
          isTrue,
        );
        final r = ZelleCheckResult.fromCallable({
          'result': 'choose',
          'candidates': [
            {'creditId': 'c1', 'atMs': noonMs, 'timeKnown': false},
          ],
        })!;
        // A date-only deposit comes back as a choice even when it is alone.
        expect(r.outcome, ZelleCheckOutcome.choose);
        expect(r.candidates.single.timeKnown, isFalse);
        expect(
          BankCheck.fromMap({
            'status': 'confirmed',
            'timeKnown': false,
          })!.timeKnown,
          isFalse,
        );
      },
    );

    test('a date-only deposit shows its date, never a made-up time', () {
      final at = DateTime.fromMillisecondsSinceEpoch(noonMs, isUtc: true);
      expect(zelleTimeLabel(at, 'en', timeKnown: false), 'Oct 17, 2026');
      expect(zelleTimeLabel(at, 'fr', timeKnown: false), '17 oct. 2026');
      final en = lookupAppLocalizations(const Locale('en'));
      expect(
        zelleConfirmationLine(
          en,
          ZelleConfirmation(
            amountCents: 6000,
            at: at,
            timeKnown: false,
            senderName: 'FATOU D.',
          ),
          'en',
        ),
        r'Received ✓ $60.00 · Oct 17, 2026 · FATOU D.',
      );
      expect(zelleDepositDay(at), DateTime(2026, 10, 17));
    });

    test('token mode, connect and status extras', () {
      expect(
        BankLinkToken.fromCallable({
          'linkToken': 't',
          'mode': 'update',
        })!.isUpdate,
        isTrue,
      );
      expect(BankLinkToken.fromCallable({'linkToken': 't'})!.mode, 'connect');
      final connected = BankConnectResult.fromCallable({
        'status': 'active',
        'accountName': 'Business Checking',
        'accountMask': '1234',
        'synced': true,
      });
      expect(connected.accountName, 'Business Checking');
      expect(connected.synced, isTrue);
      final status = BusinessBankStatus.fromCallable({
        'connected': true,
        'status': 'needs_reauth',
        'accountName': 'Business Checking',
        'accountMask': '1234',
        'lastErrorCode': 'ITEM_LOGIN_REQUIRED',
      });
      expect(status.accountName, 'Business Checking');
      expect(status.lastErrorCode, 'ITEM_LOGIN_REQUIRED');
      expect(
        status.copyWith(windowMinutes: 5).accountName,
        'Business Checking',
      );
      expect(
        bankAccountLabel('Business Checking', '1234'),
        'Business Checking \u2022\u2022\u2022\u2022 1234',
      );
      expect(bankAccountLabel('', '1234'), '\u2022\u2022\u2022\u2022 1234');
      expect(bankAccountLabel(' ', ''), '');
    });

    test('checkedAt is a Firestore Timestamp on the record', () {
      final sale = InventorySale.fromMap('s1', {
        'totalCents': 6000,
        'bankCheck': {
          'status': 'confirmed',
          'atMs': noonMs,
          'checkedAt': _FakeTimestamp(DateTime(2026, 10, 17, 14, 44)),
        },
      });
      expect(sale.bankCheck!.checkedAt, DateTime(2026, 10, 17, 14, 44));
      expect(sale.bankCheck!.at, DateTime.utc(2026, 10, 17, 12));
    });
  });

  group('source contracts', () {
    String read(String path) => File(path).readAsStringSync();

    test('only the owner gets the bank settings row', () {
      final settings = read('lib/screens/settings_screen.dart');
      final row = settings.indexOf("Key('settings-bank-zelle')");
      expect(row, greaterThan(0));
      final gate = settings.lastIndexOf('authProvider.isBusinessOwner', row);
      expect(gate, greaterThan(0));
      expect(row - gate, lessThan(300), reason: 'the row sits under the gate');
      expect(settings, contains('BankZelleSettingsScreen('));
    });

    test('every bank callable goes through the one caller', () {
      final service = read('lib/services/zelle_check_service.dart');
      for (final name in [
        'createBankLinkToken',
        'connectBusinessBank',
        'getBusinessBankStatus',
        'setBankCheckWindow',
        'disconnectBusinessBank',
        'checkZellePayment',
        'confirmZelleCandidate',
      ]) {
        expect(service, contains("'$name'"), reason: name);
      }
      expect(service, isNot(contains('httpsCallable')));
      expect(service, contains('callContainerCallable'));
    });

    test('every Zelle payment surface offers the check', () {
      for (final (path, kind) in [
        ('lib/screens/inventory_sales_screen.dart', 'inventorySale'),
        ('lib/screens/inventory_sell_screen.dart', 'inventorySale'),
        ('lib/screens/inventory_credit_sheet.dart', 'inventoryCreditPayment'),
        ('lib/screens/package_payment_sheet.dart', 'containerLinePayment'),
      ]) {
        final source = read(path);
        expect(source, contains('showZelleCheckSheet('), reason: path);
        expect(source, contains('ZelleCheckKind.$kind'), reason: path);
      }
    });
  });

  group('the confirmation line', () {
    const c = ZelleConfirmation(
      amountCents: 6000,
      senderName: 'FATOU D.',
      institutionName: 'Chase',
    );

    test('amount, New York time, sender', () {
      final en = lookupAppLocalizations(const Locale('en'));
      final at = ZelleConfirmation(
        amountCents: c.amountCents,
        at: DateTime.utc(2026, 10, 17, 18, 43),
        senderName: c.senderName,
      );
      expect(
        _plain(zelleConfirmationLine(en, at, 'en')),
        r'Received ✓ $60.00 · 2:43 PM · FATOU D.',
      );
      final fr = lookupAppLocalizations(const Locale('fr'));
      expect(
        _plain(zelleConfirmationLine(fr, at, 'fr')),
        r'Reçu ✓ $60.00 · 14:43 · FATOU D.',
      );
    });

    test('only the parts the bank gave', () {
      final en = lookupAppLocalizations(const Locale('en'));
      expect(
        zelleConfirmationLine(
          en,
          const ZelleConfirmation(amountCents: 6000),
          'en',
        ),
        r'Received ✓ $60.00',
      );
      expect(en.zelleChipConfirmed, 'Bank ✓');
      expect(
        lookupAppLocalizations(const Locale('fr')).zelleChipConfirmed,
        'Banque ✓',
      );
    });
  });
}

/// Stands in for a Firestore Timestamp: anything with `toDate()`.
class _FakeTimestamp {
  _FakeTimestamp(this.date);

  final DateTime date;

  DateTime toDate() => date;
}

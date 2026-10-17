import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/bank_zelle_settings_screen.dart';
import 'package:my_flutter_app/screens/inventory_credit_sheet.dart';
import 'package:my_flutter_app/screens/inventory_sales_screen.dart';
import 'package:my_flutter_app/screens/inventory_sell_screen.dart';
import 'package:my_flutter_app/screens/package_payment_sheet.dart';
import 'package:my_flutter_app/screens/zelle_check_sheet.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/inventory.dart';
import 'package:my_flutter_app/services/inventory_credit.dart';
import 'package:my_flutter_app/services/inventory_service.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/services/waiting_package_service.dart';
import 'package:my_flutter_app/services/waiting_packages.dart';
import 'package:my_flutter_app/services/zelle_check.dart';
import 'package:my_flutter_app/services/zelle_check_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

/// Check Zelle on screen: the sheet's states (confirmed, not found with the
/// 20 s countdown and Stop, several deposits to pick from, no bank for
/// staff and for the owner, a bank asking to sign in again, refusals), the
/// owner's bank settings (connect through a fake Plaid Link, reconnect,
/// window, disconnect), the button and "Bank ✓" chip on every Zelle payment
/// (sale card, done card, credit payment, package payment), and French on a
/// 320-wide phone. Callables are answered by a recorder; Plaid by a fake.

/// 2:43 PM in New York on Oct 17, 2026.
final _atMs = DateTime.utc(2026, 10, 17, 18, 43).millisecondsSinceEpoch;

String _plain(String s) => s.replaceAll(RegExp('[  ]'), ' ');

Map<String, Object?> _confirmed({String sender = 'FATOU D.'}) => {
  'result': 'confirmed',
  'confirmation': {
    'amountCents': 6000,
    'atMs': _atMs,
    'senderName': sender,
    'institutionName': 'Chase',
  },
};

FirebaseFunctionsException _refusal(String reason) =>
    FirebaseFunctionsException(
      message: reason,
      code: 'failed-precondition',
      details: {'reason': reason},
    );

/// Answers each callable by name, and keeps what was sent.
class _Bank {
  _Bank([Map<String, Object? Function(Map<String, Object?>)>? answers])
    : answers = answers ?? {};

  final Map<String, Object? Function(Map<String, Object?>)> answers;
  final List<({String name, Map<String, Object?> payload})> log = [];

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add((name: name, payload: payload));
    final answer = answers[name];
    return answer == null ? <String, Object?>{} : answer(payload);
  }

  ZelleCheckService get service => ZelleCheckService(caller: call);

  List<Map<String, Object?>> named(String name) => [
    for (final c in log)
      if (c.name == name) c.payload,
  ];
}

class _FakeLink implements BankLinkLauncher {
  _FakeLink(this.outcome);

  BankLinkOutcome outcome;
  final List<String> tokens = [];

  @override
  Future<BankLinkOutcome> open(String linkToken) async {
    tokens.add(linkToken);
    return outcome;
  }
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(400, 1400),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: child,
    ),
  );
  await tester.pump();
}

/// A screen with one button that opens the Check Zelle sheet.
Future<List<BankCheck>> _openCheck(
  WidgetTester tester,
  _Bank bank, {
  bool isOwner = false,
  _FakeLink? link,
  Locale locale = const Locale('en'),
  Size size = const Size(400, 1400),
}) async {
  final confirmed = <BankCheck>[];
  await _pump(
    tester,
    Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: TextButton(
            key: const Key('open'),
            onPressed: () => showZelleCheckSheet(
              context,
              businessId: 'b1',
              kind: ZelleCheckKind.inventorySale,
              id: 's1',
              amountCents: 6000,
              isOwner: isOwner,
              service: bank.service,
              launcher: link ?? _FakeLink(const BankLinkOutcome.exit()),
              onConfirmed: confirmed.add,
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ),
    locale: locale,
    size: size,
  );
  await tester.tap(find.byKey(const Key('open')));
  await tester.pump();
  // The sheet slides up; the fake answers at once.
  await tester.pump(const Duration(milliseconds: 300));
  return confirmed;
}

Finder _textPlain(String text) => find.byWidgetPredicate(
  (w) => w is Text && w.data != null && _plain(w.data!) == text,
);

String _retryStatus(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('zelle-retry-status'))).data!;

void main() {
  group('Check Zelle sheet', () {
    testWidgets('confirmed: amount, New York time, sender, bank', (
      tester,
    ) async {
      final bank = _Bank({'checkZellePayment': (_) => _confirmed()});
      final confirmed = await _openCheck(tester, bank);
      expect(bank.named('checkZellePayment').single, {
        'businessId': 'b1',
        'kind': 'inventory_sale',
        'id': 's1',
      });
      expect(find.byKey(const Key('zelle-confirmed')), findsOneWidget);
      expect(
        _textPlain(r'Received ✓ $60.00 · 2:43 PM · FATOU D.'),
        findsOneWidget,
      );
      expect(find.text('Deposited in Chase'), findsOneWidget);
      // Staff never see a balance or any other deposit.
      expect(find.textContaining('balance'), findsNothing);
      expect(confirmed.single.confirmed, isTrue);
      expect(confirmed.single.senderName, 'FATOU D.');
      await tester.tap(find.byKey(const Key('zelle-done')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('zelle-confirmed')), findsNothing);
    });

    testWidgets('already confirmed says so', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {
          ..._confirmed(),
          'result': 'already_confirmed',
        },
      });
      await _openCheck(tester, bank);
      expect(find.byKey(const Key('zelle-already')), findsOneWidget);
    });

    testWidgets('not found: counts down from 20 s and checks again itself', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': 'not_found'},
      });
      await _openCheck(tester, bank);
      expect(find.text('Not in the bank yet'), findsOneWidget);
      expect(_retryStatus(tester), 'Checking again in 20 s');
      await tester.pump(const Duration(seconds: 1));
      expect(_retryStatus(tester), 'Checking again in 19 s');
      await tester.pump(const Duration(seconds: 19));
      expect(bank.named('checkZellePayment'), hasLength(2));
      expect(_retryStatus(tester), 'Checking again in 20 s');
    });

    testWidgets('not found: stops after 3 minutes; Check again restarts', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': 'not_found'},
      });
      await _openCheck(tester, bank);
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(seconds: 20));
      }
      // The first check plus nine by itself, over three minutes.
      expect(bank.named('checkZellePayment'), hasLength(10));
      expect(
        _retryStatus(tester),
        'Still not there after 3 minutes. Ask the customer to confirm it '
        'was sent, then check again.',
      );
      await tester.tap(find.byKey(const Key('zelle-check-again')));
      await tester.pump();
      expect(bank.named('checkZellePayment'), hasLength(11));
      expect(_retryStatus(tester), 'Checking again in 20 s');
    });

    testWidgets('not found: Stop holds the re-checks', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': 'not_found'},
      });
      await _openCheck(tester, bank);
      await tester.tap(find.byKey(const Key('zelle-retry-stop')));
      await tester.pump();
      expect(_retryStatus(tester), 'Automatic checks stopped.');
      await tester.pump(const Duration(minutes: 2));
      expect(bank.named('checkZellePayment'), hasLength(1));
    });

    testWidgets('a deposit that lands on a re-check confirms', (tester) async {
      var calls = 0;
      final bank = _Bank({
        'checkZellePayment': (_) =>
            ++calls < 3 ? {'result': 'not_found'} : _confirmed(),
      });
      final confirmed = await _openCheck(tester, bank);
      await tester.pump(const Duration(seconds: 20));
      await tester.pump(const Duration(seconds: 20));
      expect(find.byKey(const Key('zelle-confirmed')), findsOneWidget);
      expect(confirmed, hasLength(1));
      // Confirmed: nothing more runs.
      await tester.pump(const Duration(minutes: 1));
      expect(bank.named('checkZellePayment'), hasLength(3));
    });

    testWidgets('several deposits: pick by sender name', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {
          'result': 'choose',
          'candidates': [
            {'creditId': 'c1', 'atMs': _atMs, 'senderName': 'FATOU D.'},
            {'creditId': 'c2', 'atMs': _atMs, 'senderName': ''},
          ],
        },
        'confirmZelleCandidate': (_) => {
          'confirmation': {
            'amountCents': 6000,
            'atMs': _atMs,
            'senderName': 'FATOU D.',
          },
        },
      });
      final confirmed = await _openCheck(tester, bank);
      expect(find.text(r'Several deposits of $60.00'), findsOneWidget);
      expect(find.text('FATOU D.'), findsOneWidget);
      expect(find.text('Sender not shown'), findsOneWidget);
      await tester.tap(find.byKey(const Key('zelle-candidate-c1')));
      await tester.pump();
      expect(bank.named('confirmZelleCandidate').single, {
        'businessId': 'b1',
        'kind': 'inventory_sale',
        'id': 's1',
        'creditId': 'c1',
      });
      expect(find.byKey(const Key('zelle-confirmed')), findsOneWidget);
      expect(confirmed, hasLength(1));
    });

    testWidgets('no bank, staff: ask the owner, no Connect', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => throw _refusal('bank_not_connected'),
      });
      await _openCheck(tester, bank);
      expect(find.text('Bank not connected'), findsOneWidget);
      expect(
        find.text(
          'Ask the owner to connect the business bank, then check again.',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('zelle-connect')), findsNothing);
      expect(find.byKey(const Key('zelle-check-again')), findsOneWidget);
    });

    testWidgets('no bank, owner: Connect opens the bank settings', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => throw _refusal('bank_not_connected'),
        'getBusinessBankStatus': (_) => {'connected': false},
      });
      await _openCheck(tester, bank, isOwner: true);
      expect(find.byKey(const Key('zelle-not-connected')), findsOneWidget);
      await tester.tap(find.byKey(const Key('zelle-connect')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('bank-settings')), findsOneWidget);
      expect(bank.named('getBusinessBankStatus').single, {'businessId': 'b1'});
      // Back from the settings: the check runs again by itself.
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(bank.named('checkZellePayment'), hasLength(2));
    });

    testWidgets('bank asks to sign in again: owner Reconnect, staff told', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => throw _refusal('bank_needs_reauth'),
      });
      await _openCheck(tester, bank, isOwner: true);
      expect(find.text('Bank sign-in needed'), findsOneWidget);
      expect(find.text('Reconnect'), findsOneWidget);
    });

    testWidgets('bank asks to sign in again: staff', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => throw _refusal('bank_needs_reauth'),
      });
      await _openCheck(tester, bank);
      expect(find.byKey(const Key('zelle-needs-reauth')), findsOneWidget);
      expect(find.byKey(const Key('zelle-connect')), findsNothing);
    });

    testWidgets('refusals read as their own message', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => throw _refusal('record_voided'),
      });
      await _openCheck(tester, bank);
      expect(
        find.text(
          'This payment was voided or reverted, so there is nothing to check.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('an unreadable answer is never "found"', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': '??'},
      });
      final confirmed = await _openCheck(tester, bank);
      expect(find.byKey(const Key('zelle-failed')), findsOneWidget);
      expect(confirmed, isEmpty);
    });

    for (final (name, answer) in [
      (
        'confirmed',
        (Map<String, Object?> _) =>
            _confirmed(sender: 'MAMADOU-ALPHA DIALLO-BARRY'),
      ),
      ('not found', (Map<String, Object?> _) => {'result': 'not_found'}),
      (
        'choose',
        (Map<String, Object?> _) => {
          'result': 'choose',
          'candidates': [
            {'creditId': 'c1', 'atMs': _atMs, 'senderName': 'FATOU D.'},
            {'creditId': 'c2', 'atMs': _atMs, 'senderName': 'AWA B.'},
          ],
        },
      ),
    ]) {
      testWidgets('French, 320 wide: $name fits', (tester) async {
        final bank = _Bank({'checkZellePayment': answer});
        await _openCheck(
          tester,
          bank,
          locale: const Locale('fr'),
          size: const Size(320, 700),
        );
        expect(tester.takeException(), isNull);
        expect(find.text('Vérification Zelle'), findsOneWidget);
      });
    }

    testWidgets('French, 320 wide: the countdown reads in French', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': 'not_found'},
      });
      await _openCheck(
        tester,
        bank,
        locale: const Locale('fr'),
        size: const Size(320, 700),
      );
      expect(_retryStatus(tester), 'Nouvelle vérification dans 20 s');
      expect(find.text('Arrêter'), findsOneWidget);
      expect(find.text('Vérifier à nouveau'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('French, 320 wide: no bank for staff and owner', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => throw _refusal('bank_not_connected'),
      });
      await _openCheck(
        tester,
        bank,
        isOwner: true,
        locale: const Locale('fr'),
        size: const Size(320, 700),
      );
      expect(find.text('Banque non connectée'), findsOneWidget);
      expect(find.text('Connecter la banque'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('Bank for Zelle checks (owner)', () {
    Future<void> openSettings(
      WidgetTester tester,
      _Bank bank,
      _FakeLink link, {
      Locale locale = const Locale('en'),
      Size size = const Size(400, 1400),
    }) async {
      await _pump(
        tester,
        BankZelleSettingsScreen(
          businessId: 'b1',
          service: bank.service,
          launcher: link,
          isIOS: true,
        ),
        locale: locale,
        size: size,
      );
      await tester.pumpAndSettle();
    }

    final active = {
      'connected': true,
      'status': 'active',
      'institutionName': 'Chase',
      'accountMask': '1234',
      'windowMinutes': 15,
      'lastSyncAt': _atMs,
    };

    testWidgets('not connected: Connect runs Link and stores the bank', (
      tester,
    ) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => {'connected': false},
        'createBankLinkToken': (_) => {
          'linkToken': 'link-sandbox-1',
          'expiration': '2026-10-17T19:00:00Z',
        },
        'connectBusinessBank': (_) => {
          'status': 'active',
          'institutionName': 'Chase',
          'accountMask': '1234',
        },
      });
      final link = _FakeLink(
        const BankLinkOutcome.success(
          publicToken: 'public-sandbox-1',
          accountId: 'acc-1',
        ),
      );
      await openSettings(tester, bank, link);
      expect(find.text('Not connected'), findsOneWidget);
      expect(find.byKey(const Key('bank-window')), findsNothing);
      await tester.tap(find.byKey(const Key('bank-connect')));
      await tester.pumpAndSettle();
      expect(bank.named('createBankLinkToken').single, {
        'businessId': 'b1',
        'platform': 'ios',
      });
      expect(link.tokens, ['link-sandbox-1']);
      expect(bank.named('connectBusinessBank').single, {
        'businessId': 'b1',
        'publicToken': 'public-sandbox-1',
        'accountId': 'acc-1',
      });
      expect(find.text('Chase'), findsOneWidget);
      expect(find.text('•••• 1234'), findsOneWidget);
      expect(find.text('Connected'), findsOneWidget);
      expect(find.text('Bank connected'), findsOneWidget);
      expect(find.byKey(const Key('bank-window')), findsOneWidget);
    });

    testWidgets('closing Link changes nothing; a Link error says so', (
      tester,
    ) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => {'connected': false},
        'createBankLinkToken': (_) => {'linkToken': 'link-1'},
      });
      final link = _FakeLink(const BankLinkOutcome.exit());
      await openSettings(tester, bank, link);
      await tester.tap(find.byKey(const Key('bank-connect')));
      await tester.pumpAndSettle();
      expect(bank.named('connectBusinessBank'), isEmpty);
      expect(find.byKey(const Key('bank-note')), findsNothing);
      link.outcome = const BankLinkOutcome.exit(errorCode: 'INSTITUTION_DOWN');
      await tester.tap(find.byKey(const Key('bank-connect')));
      await tester.pumpAndSettle();
      expect(
        find.text('The bank connection did not finish. Try again.'),
        findsOneWidget,
      );
    });

    testWidgets('staff who reach it are refused by the server', (tester) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => {'connected': false},
        'createBankLinkToken': (_) => throw _refusal('bank_owner_required'),
      });
      final link = _FakeLink(const BankLinkOutcome.exit());
      await openSettings(tester, bank, link);
      await tester.tap(find.byKey(const Key('bank-connect')));
      await tester.pumpAndSettle();
      expect(link.tokens, isEmpty);
      expect(
        find.text('Only the business owner can connect or change the bank.'),
        findsOneWidget,
      );
    });

    testWidgets('connected: bank, mask, last sync, window, disconnect', (
      tester,
    ) async {
      final bank = _Bank({'getBusinessBankStatus': (_) => active});
      await openSettings(tester, bank, _FakeLink(const BankLinkOutcome.exit()));
      expect(find.text('Chase'), findsOneWidget);
      expect(find.text('•••• 1234'), findsOneWidget);
      final sync = tester.widget<Text>(find.byKey(const Key('bank-last-sync')));
      expect(_plain(sync.data!), 'Last synced Oct 17, 2026 2:43 PM');
      expect(find.byKey(const Key('bank-connect')), findsNothing);
      expect(find.text('15 min'), findsOneWidget);

      await tester.tap(find.byKey(const Key('bank-window')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('30 min').last);
      await tester.pumpAndSettle();
      expect(bank.named('setBankCheckWindow').single, {
        'businessId': 'b1',
        'minutes': 30,
      });
      expect(find.text('30 min'), findsOneWidget);

      await tester.tap(find.byKey(const Key('bank-disconnect')));
      await tester.pumpAndSettle();
      expect(find.text('Disconnect the bank?'), findsOneWidget);
      await tester.tap(find.text('Disconnect bank').last);
      await tester.pumpAndSettle();
      expect(bank.named('disconnectBusinessBank').single, {'businessId': 'b1'});
      expect(find.text('Not connected'), findsOneWidget);
      expect(find.byKey(const Key('bank-connect')), findsOneWidget);
    });

    testWidgets('a cancelled disconnect calls nothing', (tester) async {
      final bank = _Bank({'getBusinessBankStatus': (_) => active});
      await openSettings(tester, bank, _FakeLink(const BankLinkOutcome.exit()));
      await tester.tap(find.byKey(const Key('bank-disconnect')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel').last);
      await tester.pumpAndSettle();
      expect(bank.named('disconnectBusinessBank'), isEmpty);
      expect(find.text('Connected'), findsOneWidget);
    });

    testWidgets('needs sign-in: the note and Reconnect (update mode)', (
      tester,
    ) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => {...active, 'status': 'needs_reauth'},
        'createBankLinkToken': (_) => {'linkToken': 'link-update-1'},
        'connectBusinessBank': (_) => {
          'status': 'active',
          'institutionName': 'Chase',
          'accountMask': '1234',
        },
      });
      final link = _FakeLink(
        const BankLinkOutcome.success(publicToken: 'public-2'),
      );
      await openSettings(tester, bank, link);
      expect(find.text('Sign-in needed'), findsOneWidget);
      expect(
        find.text(
          'Your bank needs you to sign in again. Until then, Zelle checks '
          'will not work.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Reconnect'));
      await tester.pumpAndSettle();
      expect(link.tokens, ['link-update-1']);
      expect(bank.named('connectBusinessBank').single, {
        'businessId': 'b1',
        'publicToken': 'public-2',
      });
      expect(find.text('Connected'), findsOneWidget);
      expect(find.text('Reconnect'), findsNothing);
    });

    testWidgets('a status that fails to load offers Retry', (tester) async {
      var fail = true;
      final bank = _Bank({
        'getBusinessBankStatus': (_) {
          if (fail) {
            throw FirebaseFunctionsException(
              message: 'down',
              code: 'unavailable',
            );
          }
          return active;
        },
      });
      await openSettings(tester, bank, _FakeLink(const BankLinkOutcome.exit()));
      expect(find.byKey(const Key('bank-load-failed')), findsOneWidget);
      fail = false;
      await tester.tap(find.byKey(const Key('bank-retry')));
      await tester.pumpAndSettle();
      expect(find.text('Chase'), findsOneWidget);
    });

    testWidgets('French, 320 wide: connected and not connected fit', (
      tester,
    ) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => {
          ...active,
          'status': 'needs_reauth',
          'institutionName': 'Banque Populaire du Nord-Est Atlantique',
        },
      });
      await openSettings(
        tester,
        bank,
        _FakeLink(const BankLinkOutcome.exit()),
        locale: const Locale('fr'),
        size: const Size(320, 900),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Banque pour vérifier les Zelle'), findsOneWidget);
      expect(find.text('Reconnexion requise'), findsOneWidget);
      expect(find.text('Reconnecter'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('Déconnecter la banque'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Déconnecter la banque'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('French, 320 wide: not connected', (tester) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => {'connected': false},
      });
      await openSettings(
        tester,
        bank,
        _FakeLink(const BankLinkOutcome.exit()),
        locale: const Locale('fr'),
        size: const Size(320, 900),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Non connectée'), findsOneWidget);
      expect(find.text('Connecter la banque'), findsOneWidget);
    });
  });

  group('Check Zelle on the payments', () {
    testWidgets('package payment: button on Zelle, chip once confirmed', (
      tester,
    ) async {
      final bank = _Bank({'checkZellePayment': (_) => _confirmed()});
      final line = ContainerLine.fromMap('w1', {
        'businessId': 'b1',
        'containerId': '',
        'containerStatus': containerLineStatusWaiting,
        'kind': containerLineKindBarrels,
        'quantity': 1,
        'ownerKind': containerOwnerCustomer,
        'customerName': 'Fatou Diallo',
        'priceCents': 10000,
        'paidCents': 7000,
        'trackingCode': 'CL-K7M4P2',
        'createdAt': DateTime(2026, 10, 1, 9, 30),
      });
      await _pump(
        tester,
        Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              key: const Key('open'),
              onPressed: () => showPackagePaymentSheet(
                context,
                businessId: 'b1',
                line: line,
                caller: bank.call,
                isOwner: false,
                payments: _Payments([
                  ContainerLinePayment.fromMap('p1', {
                    'amountCents': 6000,
                    'method': 'zelle',
                    'createdAt': DateTime(2026, 10, 17, 14, 40),
                  }),
                  ContainerLinePayment.fromMap('p2', {
                    'amountCents': 500,
                    'method': 'cash',
                  }),
                  ContainerLinePayment.fromMap('p3', {
                    'amountCents': 500,
                    'method': 'zelle',
                    'bankCheck': {'status': 'confirmed', 'amountCents': 500},
                  }),
                ]),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pay-check-zelle:p1')), findsOneWidget);
      expect(find.byKey(const Key('pay-check-zelle:p2')), findsNothing);
      expect(find.byKey(const Key('pay-check-zelle:p3')), findsNothing);
      expect(find.byKey(const Key('pay-bank-ok:p3')), findsOneWidget);

      await tester.ensureVisible(find.byKey(const Key('pay-check-zelle:p1')));
      await tester.tap(find.byKey(const Key('pay-check-zelle:p1')));
      await tester.pumpAndSettle();
      expect(bank.named('checkZellePayment').single, {
        'businessId': 'b1',
        'kind': 'container_line_payment',
        'id': 'p1',
      });
      await tester.tap(find.byKey(const Key('zelle-done')));
      await tester.pumpAndSettle();
      // Confirmed now, before the record's stream says so.
      expect(find.byKey(const Key('pay-bank-ok:p1')), findsOneWidget);
      expect(find.byKey(const Key('pay-check-zelle:p1')), findsNothing);
    });

    testWidgets('credit payment: button on Zelle, kind is the credit payment', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': 'not_found'},
      });
      final sale = InventorySale.fromMap('s1', {
        'businessId': 'b1',
        'totalCents': 6000,
        'paymentMethod': 'cash',
        'soldByStaffId': 'u-me',
        'paidNowCents': 2000,
        'creditCents': 4000,
        'creditPaidCents': 1500,
        'creditStatus': 'open',
        'credit': {'customerName': 'Fatou Diallo', 'collectorStaffId': 'u-me'},
      });
      await _pump(
        tester,
        Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              key: const Key('open'),
              onPressed: () => showInventoryCreditSheet(
                context,
                businessId: 'b1',
                sale: sale,
                staff: const [LotStaff(id: 'u-me', name: 'Ama')],
                service: InventoryService(caller: bank.call),
                creditSource: _Credits([
                  InventoryCreditPayment(
                    id: 'cp1',
                    saleId: 's1',
                    amountCents: 1500,
                    method: 'zelle',
                    createdAt: DateTime(2026, 10, 17, 14, 40),
                  ),
                ]),
                currentUserId: 'u-me',
                isOwner: false,
              ),
              child: const Text('open'),
            ),
          ),
        ),
        size: const Size(400, 2000),
      );
      await tester.tap(find.byKey(const Key('open')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('pay-check-zelle:cp1')));
      await tester.tap(find.byKey(const Key('pay-check-zelle:cp1')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(bank.named('checkZellePayment').single, {
        'businessId': 'b1',
        'kind': 'inventory_credit_payment',
        'id': 'cp1',
      });
      expect(find.text('Not in the bank yet'), findsOneWidget);
    });

    testWidgets('sale card: button for Zelle paid now, chip once confirmed', (
      tester,
    ) async {
      InventorySale sale(String id, String method, {Map? bankCheck}) =>
          InventorySale.fromMap(id, {
            'businessId': 'b1',
            'totalCents': 6000,
            'paymentMethod': method,
            'soldByStaffId': 'u-me',
            'createdAt': DateTime(2026, 10, 17, 14, 40),
            'bankCheck': bankCheck,
          });
      var tapped = 0;
      Widget card(InventorySale s, {VoidCallback? onCheck}) =>
          InventorySaleCard(
            sale: s,
            locale: 'en',
            staff: const [],
            onVoid: () {},
            onCheckZelle: onCheck,
          );
      await _pump(
        tester,
        Scaffold(
          body: ListView(
            children: [
              card(sale('a', 'zelle'), onCheck: () => tapped++),
              card(sale('b', 'zelle', bankCheck: {'status': 'confirmed'})),
              card(sale('c', 'cash')),
            ],
          ),
        ),
      );
      expect(find.byKey(const Key('inv-check-zelle-a')), findsOneWidget);
      expect(find.byKey(const Key('inv-bank-ok-b')), findsOneWidget);
      expect(find.text('Bank ✓'), findsOneWidget);
      expect(find.byKey(const Key('inv-check-zelle-c')), findsNothing);
      await tester.tap(find.byKey(const Key('inv-check-zelle-a')));
      expect(tapped, 1);
    });

    testWidgets('sales list offers Check Zelle only where it applies', (
      tester,
    ) async {
      final bank = _Bank({'checkZellePayment': (_) => _confirmed()});
      InventorySale sale(String id, String method, {bool voided = false}) =>
          InventorySale.fromMap(id, {
            'businessId': 'b1',
            'totalCents': 6000,
            'paymentMethod': method,
            'soldByStaffId': 'u-me',
            'voided': voided,
            'createdAt': DateTime(2026, 10, 17, 14, 40),
          });
      await _pump(
        tester,
        InventorySalesScreen(
          businessId: 'b1',
          source: _Source(
            sales: [
              sale('z', 'zelle'),
              sale('v', 'zelle', voided: true),
              sale('k', 'cash'),
            ],
          ),
          service: InventoryService(caller: bank.call),
          creditSource: _Credits(const []),
          currentUserId: 'u-me',
        ),
        size: const Size(400, 2000),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-check-zelle-z')), findsOneWidget);
      expect(find.byKey(const Key('inv-check-zelle-v')), findsNothing);
      expect(find.byKey(const Key('inv-check-zelle-k')), findsNothing);
      await tester.tap(find.byKey(const Key('inv-check-zelle-z')));
      await tester.pumpAndSettle();
      expect(bank.named('checkZellePayment').single['kind'], 'inventory_sale');
      await tester.tap(find.byKey(const Key('zelle-done')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-bank-ok-z')), findsOneWidget);
      expect(find.byKey(const Key('inv-check-zelle-z')), findsNothing);
    });

    testWidgets('done card after a Zelle sale offers Check Zelle', (
      tester,
    ) async {
      final bank = _Bank({
        'recordInventorySale': (_) => {'saleId': 's9', 'totalCents': 6000},
        'checkZellePayment': (_) => _confirmed(),
      });
      await _pump(
        tester,
        InventorySellScreen(
          businessId: 'b1',
          source: _Source(),
          creditSource: _Credits(const []),
          service: InventoryService(caller: bank.call),
          newRequestId: () => 'req-1',
          cameraEnabled: false,
          initialCode: _soap.code,
          currentUserId: 'u-me',
        ),
        size: const Size(400, 2600),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('inv-payment')));
      await tester.tap(find.byKey(const Key('inv-payment')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Zelle').last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('inv-sold')));
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(
        bank.named('recordInventorySale').single['paymentMethod'],
        'zelle',
      );
      final check = find.byKey(const Key('inv-sale-done-check-zelle'));
      expect(check, findsOneWidget);
      await tester.ensureVisible(check);
      await tester.tap(check);
      await tester.pumpAndSettle();
      expect(bank.named('checkZellePayment').single, {
        'businessId': 'b1',
        'kind': 'inventory_sale',
        'id': 's9',
      });
      await tester.tap(find.byKey(const Key('zelle-done')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-sale-done-bank-ok')), findsOneWidget);
    });

    testWidgets('a cash sale has no Check Zelle on the done card', (
      tester,
    ) async {
      final bank = _Bank({
        'recordInventorySale': (_) => {'saleId': 's9', 'totalCents': 6000},
      });
      await _pump(
        tester,
        InventorySellScreen(
          businessId: 'b1',
          source: _Source(),
          creditSource: _Credits(const []),
          service: InventoryService(caller: bank.call),
          newRequestId: () => 'req-1',
          cameraEnabled: false,
          initialCode: _soap.code,
          currentUserId: 'u-me',
        ),
        size: const Size(400, 2600),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('inv-sold')));
      await tester.tap(find.byKey(const Key('inv-sold')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('inv-sale-done')), findsOneWidget);
      expect(find.byKey(const Key('inv-sale-done-check-zelle')), findsNothing);
    });
  });
}

// ---------------------------------------------------------------------------
// Fakes for the inventory screens.
// ---------------------------------------------------------------------------

const _soap = InventoryItem(
  id: 'i1',
  businessId: 'b1',
  name: 'Soap',
  code: 'IT-K7M4P2',
  priceCents: 6000,
  quantity: 10,
);

class _Payments implements LinePaymentsSource {
  _Payments(this.list);

  final List<ContainerLinePayment> list;

  @override
  Stream<List<ContainerLinePayment>> watch(String businessId, String lineId) =>
      Stream.value(list);
}

class _Credits implements InventoryCreditSource {
  _Credits(this.payments);

  final List<InventoryCreditPayment> payments;

  @override
  Stream<List<InventorySale>> watchOpenCredits(
    String businessId, {
    String storeId = '',
  }) => Stream.value(const []);

  @override
  Stream<List<InventoryCreditPayment>> watchCreditPayments(
    String businessId,
    String saleId, {
    String storeId = '',
  }) => Stream.value(payments);

  @override
  Stream<InventoryBusinessOwner> watchBusinessOwner(String businessId) =>
      Stream.value((uid: 'u-owner', name: 'Mariama', email: ''));
}

class _Source implements InventorySource {
  _Source({this.sales = const []});

  final List<InventorySale> sales;

  @override
  Stream<List<InventoryItem>> watchItems(String businessId) =>
      Stream.value(const [_soap]);

  @override
  Future<InventoryItem?> findItemByCode(String businessId, String code) async =>
      code == _soap.code ? _soap : null;

  @override
  Stream<List<InventorySale>> watchSales(
    String businessId, {
    required int limit,
    String storeId = '',
  }) => Stream.value(sales);

  @override
  Stream<InventorySale?> watchSale(String businessId, String saleId) =>
      Stream.value(sales.where((s) => s.id == saleId).firstOrNull);

  @override
  Stream<List<InventoryMovement>> watchMovements(
    String businessId,
    String itemId, {
    String storeId = '',
  }) => Stream.value(const []);

  @override
  Stream<List<InventoryCategory>> watchCategories(String businessId) =>
      Stream.value(const []);

  @override
  Stream<List<InventoryBrand>> watchBrands(String businessId) =>
      Stream.value(const []);

  @override
  Stream<List<InventoryStore>> watchStores(String businessId) =>
      Stream.value(const []);

  @override
  Stream<List<InventoryStockRow>> watchStock(
    String businessId, {
    String storeId = '',
  }) => Stream.value(const []);

  @override
  Stream<List<LotStaff>> watchStaff(String businessId) =>
      Stream.value(const [LotStaff(id: 'u-me', name: 'Ama')]);
}

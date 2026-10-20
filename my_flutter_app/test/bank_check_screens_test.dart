import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/bank_check_sheet.dart';
import 'package:my_flutter_app/screens/bank_zelle_settings_screen.dart';
import 'package:my_flutter_app/services/bank_check.dart';
import 'package:my_flutter_app/services/zelle_check_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

/// "Check bank" any time (docs/ZELLE_BANK_CHECK.md) on screen: the entry on
/// a home (shown only with an active bank; the owner's hint otherwise;
/// nothing for staff), the check sheet (amount, when it was sent, received,
/// several deposits, not yet with the 20 s / 3 min re-checks sent as
/// `auto`, refusals), "Use for a sale", and the owner's month of usage and
/// limit of paid refreshes - in English and in French on a 320-wide phone.
/// Callables are answered by a recorder; Plaid by a fake.

/// 2:43 PM in New York on Oct 17, 2026.
final _atMs = DateTime.utc(2026, 10, 17, 18, 43).millisecondsSinceEpoch;

String _plain(String s) => s.replaceAll(RegExp('[\u00A0\u202F]'), ' ');

Finder _textPlain(String text) => find.byWidgetPredicate(
  (w) => w is Text && w.data != null && _plain(w.data!) == text,
);

FirebaseFunctionsException _refusal(String reason) =>
    FirebaseFunctionsException(
      message: reason,
      code: 'failed-precondition',
      details: {'reason': reason},
    );

Map<String, Object?> _deposit(
  String id, {
  int cents = 6000,
  String sender = 'FATOU D.',
  bool pending = false,
  bool timeKnown = true,
}) => {
  'creditId': id,
  'amountCents': cents,
  'atMs': _atMs,
  'timeKnown': timeKnown,
  'senderName': sender,
  'pending': pending,
};

Map<String, Object?> _received({
  int cents = 6000,
  bool pending = false,
  bool limitReached = false,
}) => {
  'result': 'received',
  'deposits': [_deposit('c1', cents: cents, pending: pending)],
  'since': '15m',
  'fromMs': _atMs - 15 * 60 * 1000,
  'limitReached': limitReached,
};

Map<String, Object?> _several() => {
  'result': 'several',
  'deposits': [
    _deposit('c1'),
    _deposit('c2', sender: '', pending: true),
    _deposit('c3', sender: 'MAMADOU-ALPHA DIALLO-BARRY', timeKnown: false),
  ],
};

final _records = <String, Object?>{
  'records': [
    {
      'kind': 'inventory_sale',
      'id': 's1',
      'amountCents': 6000,
      'atMs': _atMs,
      'who': 'Aminata Sow',
      'what': 'Shea butter × 2, Black soap',
    },
    {
      'kind': 'container_line_payment',
      'id': 'p9',
      'amountCents': 6000,
      'atMs': _atMs,
      'who': '',
      'what': 'LW-4K8Q2A',
    },
  ],
  'searched': false,
};

Map<String, Object?> _confirmation() => {
  'result': 'confirmed',
  'confirmation': {
    'amountCents': 6000,
    'atMs': _atMs,
    'senderName': 'FATOU D.',
    'institutionName': 'Chase',
  },
};

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

  /// `confirmZelleCandidate` by mode.
  List<Map<String, Object?>> confirmMode(String mode) => [
    for (final p in named('confirmZelleCandidate'))
      if (p['mode'] == mode) p,
  ];
}

class _FakeLink implements BankLinkLauncher {
  const _FakeLink();

  @override
  Future<BankLinkOutcome> open(String linkToken) async =>
      const BankLinkOutcome.exit();
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

/// A screen with one button that opens "Check bank".
Future<void> _openSheet(
  WidgetTester tester,
  _Bank bank, {
  bool isOwner = false,
  Locale locale = const Locale('en'),
  Size size = const Size(400, 1400),
}) async {
  await _pump(
    tester,
    Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: TextButton(
            key: const Key('open'),
            onPressed: () => showBankCheckSheet(
              context,
              businessId: 'b1',
              isOwner: isOwner,
              service: bank.service,
              launcher: const _FakeLink(),
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
  await tester.pump(const Duration(milliseconds: 300));
}

/// Types [amount] and presses Check (the fake answers at once).
Future<void> _check(WidgetTester tester, String amount) async {
  await tester.enterText(find.byKey(const Key('bank-check-amount')), amount);
  await tester.pump();
  await tester.tap(find.byKey(const Key('bank-check-submit')));
  await tester.pump();
  await tester.pump();
}

String _retryStatus(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('bank-check-retry-status'))).data!;

/// Opens "Use for a sale" on deposit [creditId] and lets the list load.
Future<void> _openUse(WidgetTester tester, String creditId) async {
  final use = find.byKey(Key('bank-check-use-$creditId'));
  await tester.ensureVisible(use);
  await tester.tap(use);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pump();
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  group('Check bank sheet', () {
    testWidgets('an amount that cannot be checked is refused before asking', (
      tester,
    ) async {
      final bank = _Bank({'checkZellePayment': (_) => _received()});
      await _openSheet(tester, bank);
      expect(find.byKey(const Key('bank-check-phase-idle')), findsOneWidget);
      expect(find.text('Check'), findsOneWidget);
      // Nothing is checked on opening.
      expect(bank.log, isEmpty);

      await tester.tap(find.byKey(const Key('bank-check-submit')));
      await tester.pump();
      expect(find.text('Type the amount, like 60 or 60.50.'), findsOneWidget);
      await _check(tester, 'sixty');
      expect(find.text('Type the amount, like 60 or 60.50.'), findsOneWidget);
      await _check(tester, '0');
      expect(find.text('Type the amount, like 60 or 60.50.'), findsOneWidget);
      await _check(tester, '2000000');
      expect(find.text('That amount is too large to check.'), findsOneWidget);
      expect(bank.log, isEmpty);
    });

    testWidgets('received: amount, New York time, sender, Use for a sale', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => _received(cents: 6050, pending: true),
      });
      await _openSheet(tester, bank);
      await _check(tester, '60.50');
      // A press of Check sends no `auto`.
      expect(bank.named('checkZellePayment').single, {
        'businessId': 'b1',
        'mode': 'standalone',
        'amountCents': 6050,
        'since': '15m',
      });
      expect(find.byKey(const Key('bank-check-received')), findsOneWidget);
      expect(
        _textPlain(r'Received ✓ $60.50 · 2:43 PM · FATOU D.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('bank-check-pending')), findsOneWidget);
      expect(find.byKey(const Key('bank-check-use-c1')), findsOneWidget);
      expect(find.text('Check again'), findsOneWidget);
      // Staff never see a balance.
      expect(find.textContaining('balance'), findsNothing);
      // Found: nothing more runs by itself.
      await tester.pump(const Duration(minutes: 1));
      expect(bank.named('checkZellePayment'), hasLength(1));
    });

    testWidgets('when it was sent goes with the check', (tester) async {
      final bank = _Bank({'checkZellePayment': (_) => _received()});
      await _openSheet(tester, bank);
      await tester.tap(find.byKey(const Key('bank-check-since-today')));
      await tester.pump();
      await _check(tester, '60');
      expect(bank.named('checkZellePayment').single['since'], 'today');
      // A new window clears the answer on screen.
      await tester.tap(find.byKey(const Key('bank-check-since-1h')));
      await tester.pump();
      expect(find.byKey(const Key('bank-check-phase-idle')), findsOneWidget);
      expect(find.byKey(const Key('bank-check-received')), findsNothing);
    });

    testWidgets('the month\'s refresh limit reached says deposits can lag', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => _received(limitReached: true),
      });
      await _openSheet(tester, bank);
      await _check(tester, '60');
      expect(find.byKey(const Key('bank-check-limit')), findsOneWidget);
    });

    testWidgets('several deposits: each with sender, time and its own Use', (
      tester,
    ) async {
      final bank = _Bank({'checkZellePayment': (_) => _several()});
      await _openSheet(tester, bank);
      await _check(tester, '60');
      expect(find.text(r'Several deposits of $60.00'), findsOneWidget);
      expect(find.text("Find the customer's by the sender's name."), findsOne);
      expect(find.text('FATOU D.'), findsOneWidget);
      expect(find.text('Sender not shown'), findsOneWidget);
      expect(find.text('MAMADOU-ALPHA DIALLO-BARRY'), findsOneWidget);
      expect(_textPlain(r'$60.00 · 2:43 PM'), findsNWidgets(2));
      // A deposit the bank gave no time for shows its date only.
      expect(_textPlain(r'$60.00 · Oct 17, 2026'), findsOneWidget);
      expect(find.text('Pending'), findsOneWidget);
      for (final id in ['c1', 'c2', 'c3']) {
        expect(find.byKey(Key('bank-check-use-$id')), findsOneWidget);
      }
    });

    testWidgets('not yet: counts down 20 s and asks again itself, as auto', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': 'not_found'},
      });
      await _openSheet(tester, bank);
      await _check(tester, '60');
      expect(find.text('Not in the bank yet'), findsOneWidget);
      expect(_retryStatus(tester), 'Checking again in 20 s');
      await tester.pump(const Duration(seconds: 1));
      expect(_retryStatus(tester), 'Checking again in 19 s');
      await tester.pump(const Duration(seconds: 19));
      final calls = bank.named('checkZellePayment');
      expect(calls, hasLength(2));
      expect(calls.first.containsKey('auto'), isFalse);
      // The re-check asks the same amount and window, marked auto.
      expect(calls.last, {
        'businessId': 'b1',
        'mode': 'standalone',
        'amountCents': 6000,
        'since': '15m',
        'auto': true,
      });
      expect(_retryStatus(tester), 'Checking again in 20 s');
    });

    testWidgets('not yet: stops after 3 minutes; Check again is by hand', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': 'not_found'},
      });
      await _openSheet(tester, bank);
      await _check(tester, '60');
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(seconds: 20));
      }
      // The first check plus nine by itself, over three minutes.
      final calls = bank.named('checkZellePayment');
      expect(calls, hasLength(10));
      expect(calls.where((c) => c['auto'] == true), hasLength(9));
      expect(
        _retryStatus(tester),
        'Still not there after 3 minutes. Ask the customer to confirm it '
        'was sent, then check again.',
      );
      await tester.tap(find.byKey(const Key('bank-check-submit')));
      await tester.pump();
      await tester.pump();
      expect(bank.named('checkZellePayment'), hasLength(11));
      expect(bank.named('checkZellePayment').last.containsKey('auto'), isFalse);
      expect(_retryStatus(tester), 'Checking again in 20 s');
    });

    testWidgets('not yet: Stop holds the re-checks; a new amount too', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': 'not_found'},
      });
      await _openSheet(tester, bank);
      await _check(tester, '60');
      await tester.tap(find.byKey(const Key('bank-check-retry-stop')));
      await tester.pump();
      expect(_retryStatus(tester), 'Automatic checks stopped.');
      await tester.pump(const Duration(minutes: 2));
      expect(bank.named('checkZellePayment'), hasLength(1));

      // Typing another amount drops the answer and its countdown.
      await _check(tester, '60');
      expect(bank.named('checkZellePayment'), hasLength(2));
      await tester.enterText(find.byKey(const Key('bank-check-amount')), '75');
      await tester.pump();
      expect(find.byKey(const Key('bank-check-phase-idle')), findsOneWidget);
      await tester.pump(const Duration(minutes: 1));
      expect(bank.named('checkZellePayment'), hasLength(2));
    });

    testWidgets('a deposit that lands on a re-check shows as received', (
      tester,
    ) async {
      var calls = 0;
      final bank = _Bank({
        'checkZellePayment': (_) =>
            ++calls < 3 ? {'result': 'not_found'} : _received(),
      });
      await _openSheet(tester, bank);
      await _check(tester, '60');
      await tester.pump(const Duration(seconds: 20));
      await tester.pump(const Duration(seconds: 20));
      expect(find.byKey(const Key('bank-check-received')), findsOneWidget);
      await tester.pump(const Duration(minutes: 1));
      expect(bank.named('checkZellePayment'), hasLength(3));
    });

    testWidgets('no bank, staff: ask the owner, no Connect', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => throw _refusal('bank_not_connected'),
      });
      await _openSheet(tester, bank);
      await _check(tester, '60');
      expect(find.text('Bank not connected'), findsOneWidget);
      expect(find.byKey(const Key('bank-check-not-connected')), findsOneWidget);
      expect(find.byKey(const Key('bank-check-connect')), findsNothing);
      expect(find.byKey(const Key('bank-check-submit')), findsOneWidget);
    });

    testWidgets('no bank, owner: Connect opens the bank settings', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => throw _refusal('bank_not_connected'),
        'getBusinessBankStatus': (_) => {'connected': false},
      });
      await _openSheet(tester, bank, isOwner: true);
      await _check(tester, '60');
      await tester.tap(find.byKey(const Key('bank-check-connect')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('bank-settings')), findsOneWidget);
      // Back from the settings: the same amount is asked again.
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(bank.named('checkZellePayment'), hasLength(2));
      expect(bank.named('checkZellePayment').last['amountCents'], 6000);
    });

    testWidgets('bank asks to sign in again: owner Reconnect, staff told', (
      tester,
    ) async {
      final bank = _Bank({
        'checkZellePayment': (_) => throw _refusal('bank_needs_reauth'),
      });
      await _openSheet(tester, bank, isOwner: true);
      await _check(tester, '60');
      expect(find.text('Bank sign-in needed'), findsOneWidget);
      expect(find.byKey(const Key('bank-check-needs-reauth')), findsOneWidget);
      expect(find.text('Reconnect'), findsOneWidget);
    });

    testWidgets('a refusal reads as its own message', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => throw _refusal('check_amount_invalid'),
      });
      await _openSheet(tester, bank);
      await _check(tester, '60');
      expect(
        find.text('Type an amount above zero, with at most two decimals.'),
        findsOneWidget,
      );
    });

    testWidgets('an unreadable answer is never "received"', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': 'received', 'deposits': []},
      });
      await _openSheet(tester, bank);
      await _check(tester, '60');
      expect(find.byKey(const Key('bank-check-received')), findsNothing);
      expect(
        find.text('The bank check did not answer clearly. Try again.'),
        findsOneWidget,
      );
    });
  });

  group('Use for a sale', () {
    _Bank bankWith({
      Object? Function(Map<String, Object?>)? records,
      Object? Function(Map<String, Object?>)? use,
    }) => _Bank({
      'checkZellePayment': (_) => _several(),
      'confirmZelleCandidate': (p) => p['mode'] == 'records'
          ? (records ?? (_) => _records)(p)
          : (use ?? (_) => _confirmation())(p),
    });

    testWidgets('pick the payment, confirm, and the deposit reads as used', (
      tester,
    ) async {
      final bank = bankWith();
      await _openSheet(tester, bank);
      await _check(tester, '60');
      await _openUse(tester, 'c1');
      expect(bank.confirmMode('records').single, {
        'businessId': 'b1',
        'mode': 'records',
        'creditId': 'c1',
      });
      expect(
        find.text(r'Pick the Zelle payment of $60.00 this deposit pays.'),
        findsOneWidget,
      );
      expect(find.text('Recent Zelle payments of this amount'), findsOne);
      expect(find.text('Aminata Sow'), findsOneWidget);
      expect(find.text('Shea butter × 2, Black soap'), findsOneWidget);
      expect(find.text('Sale'), findsOneWidget);
      expect(find.text('Package payment'), findsOneWidget);
      // No name: said so, never left blank.
      expect(find.text('No customer name'), findsOneWidget);
      expect(_textPlain('Oct 17, 2026 2:43 PM'), findsNWidgets(2));

      // Nothing picked: Use is not available and calls nothing.
      await tester.tap(find.byKey(const Key('bank-use-confirm')));
      await tester.pump();
      expect(bank.confirmMode('use'), isEmpty);

      await tester.tap(
        find.byKey(const Key('bank-use-record-inventory_sale-s1')),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('bank-use-confirm')));
      await tester.pump();
      await tester.pump();
      expect(bank.confirmMode('use').single, {
        'businessId': 'b1',
        'mode': 'use',
        'creditId': 'c1',
        'kind': 'inventory_sale',
        'id': 's1',
      });
      expect(find.byKey(const Key('bank-use-confirmed')), findsOneWidget);
      expect(find.text('Confirmed for this sale'), findsOneWidget);
      expect(find.text('Deposited in Chase'), findsOneWidget);

      await tester.tap(find.byKey(const Key('bank-use-done')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('bank-use-confirmed')), findsNothing);
      // Back on the check: that deposit is used, the others still offer Use.
      expect(find.byKey(const Key('bank-check-used-c1')), findsOneWidget);
      expect(find.byKey(const Key('bank-check-use-c1')), findsNothing);
      expect(find.byKey(const Key('bank-check-use-c2')), findsOneWidget);
    });

    testWidgets('search sends the words; nothing found says so', (
      tester,
    ) async {
      final bank = bankWith(
        records: (p) => p['query'] == null
            ? _records
            : {'records': <Object?>[], 'searched': true},
      );
      await _openSheet(tester, bank);
      await _check(tester, '60');
      await _openUse(tester, 'c1');
      await tester.enterText(
        find.byKey(const Key('bank-use-search')),
        '  Fatou   Diallo ',
      );
      await tester.tap(find.byKey(const Key('bank-use-search-button')));
      await tester.pump();
      await tester.pump();
      expect(bank.confirmMode('records').last, {
        'businessId': 'b1',
        'mode': 'records',
        'creditId': 'c1',
        'query': 'Fatou Diallo',
      });
      expect(find.text('Payments that match'), findsOneWidget);
      expect(find.text('Nothing matches “Fatou   Diallo”.'), findsOneWidget);
      expect(find.byKey(const Key('bank-use-empty')), findsOneWidget);
    });

    testWidgets('no recent payment: say so and point at the search', (
      tester,
    ) async {
      final bank = bankWith(records: (_) => {'records': <Object?>[]});
      await _openSheet(tester, bank);
      await _check(tester, '60');
      await _openUse(tester, 'c1');
      expect(
        find.text(
          r'No recent Zelle payment of $60.00 is waiting for the bank. '
          'Search older ones above.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('a list that fails offers Retry', (tester) async {
      var fail = true;
      final bank = bankWith(
        records: (_) {
          if (fail) throw StateError('offline');
          return _records;
        },
      );
      await _openSheet(tester, bank);
      await _check(tester, '60');
      await _openUse(tester, 'c1');
      expect(find.byKey(const Key('bank-use-load-failed')), findsOneWidget);
      expect(
        find.text(
          "Couldn't load the payments. Check the connection and try again.",
        ),
        findsOneWidget,
      );
      fail = false;
      await tester.tap(find.byKey(const Key('bank-use-retry')));
      await tester.pump();
      await tester.pump();
      expect(find.text('Aminata Sow'), findsOneWidget);
    });

    testWidgets('a refused use says why and keeps the pick', (tester) async {
      final bank = bankWith(use: (_) => throw _refusal('amount_mismatch'));
      await _openSheet(tester, bank);
      await _check(tester, '60');
      await _openUse(tester, 'c1');
      await tester.tap(
        find.byKey(const Key('bank-use-record-inventory_sale-s1')),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('bank-use-confirm')));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('bank-use-note')), findsOneWidget);
      expect(
        find.text('That payment is not for the same amount as the deposit.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('bank-use-confirmed')), findsNothing);
    });
  });

  group('Check bank entry on a home', () {
    final active = <String, Object?>{
      'connected': true,
      'status': 'active',
      'institutionName': 'Chase',
      'accountMask': '1234',
    };

    Future<void> pumpEntry(
      WidgetTester tester,
      _Bank bank, {
      required bool isOwner,
      bool canCheck = true,
      BankStatusCache? cache,
      Locale locale = const Locale('en'),
      Size size = const Size(400, 900),
    }) async {
      await _pump(
        tester,
        Scaffold(
          body: Column(
            children: [
              BankCheckEntry(
                businessId: 'b1',
                isOwner: isOwner,
                canCheck: canCheck,
                service: bank.service,
                launcher: const _FakeLink(),
                cache: cache ?? BankStatusCache(),
              ),
              const Text('below', key: Key('below')),
            ],
          ),
        ),
        locale: locale,
        size: size,
      );
      await tester.pump();
    }

    testWidgets('an active bank: Check bank opens the check', (tester) async {
      final bank = _Bank({'getBusinessBankStatus': (_) => active});
      await pumpEntry(tester, bank, isOwner: false);
      expect(bank.named('getBusinessBankStatus').single, {'businessId': 'b1'});
      expect(find.byKey(const Key('bank-check-entry')), findsOneWidget);
      expect(find.text('Check bank'), findsOneWidget);
      expect(find.text('Did a Zelle arrive? Check the amount.'), findsOne);
      await tester.tap(find.byKey(const Key('bank-check-entry')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('bank-check-amount')), findsOneWidget);
      // Opening the check asks nothing.
      expect(bank.named('checkZellePayment'), isEmpty);
    });

    testWidgets('no bank link: staff see nothing at all', (tester) async {
      for (final status in [
        <String, Object?>{'connected': false},
        <String, Object?>{'connected': true, 'status': 'needs_reauth'},
      ]) {
        final bank = _Bank({'getBusinessBankStatus': (_) => status});
        // A fresh State for each status.
        await tester.pumpWidget(const SizedBox());
        await pumpEntry(tester, bank, isOwner: false);
        expect(bank.log, hasLength(1));
        expect(find.byKey(const Key('bank-check-entry')), findsNothing);
        expect(find.byKey(const Key('bank-check-connect-hint')), findsNothing);
        expect(
          find.byKey(const Key('bank-check-reconnect-hint')),
          findsNothing,
        );
        // Takes no room either.
        expect(tester.getTopLeft(find.byKey(const Key('below'))).dy, 0);
      }
    });

    testWidgets('an active bank but no right to check: nothing', (
      tester,
    ) async {
      final bank = _Bank({'getBusinessBankStatus': (_) => active});
      await pumpEntry(tester, bank, isOwner: false, canCheck: false);
      expect(find.byKey(const Key('bank-check-entry')), findsNothing);
    });

    testWidgets('a status that cannot be read shows nothing', (tester) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => throw StateError('offline'),
      });
      await pumpEntry(tester, bank, isOwner: true);
      expect(find.byKey(const Key('bank-check-entry')), findsNothing);
      expect(find.byKey(const Key('bank-check-connect-hint')), findsNothing);
    });

    testWidgets('no bank, owner: a hint that opens the bank settings', (
      tester,
    ) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => {'connected': false},
      });
      await pumpEntry(tester, bank, isOwner: true);
      expect(find.byKey(const Key('bank-check-entry')), findsNothing);
      expect(find.byKey(const Key('bank-check-connect-hint')), findsOneWidget);
      expect(
        find.text('Connect your bank to check Zelle payments from here.'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('bank-check-connect-hint')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('bank-settings')), findsOneWidget);
      // Back from the settings: the status is read again.
      final before = bank.named('getBusinessBankStatus').length;
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(bank.named('getBusinessBankStatus').length, before + 1);
    });

    testWidgets('the bank asks to sign in again, owner: the Reconnect hint', (
      tester,
    ) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => {
          'connected': true,
          'status': 'needs_reauth',
        },
      });
      await pumpEntry(tester, bank, isOwner: true);
      expect(
        find.byKey(const Key('bank-check-reconnect-hint')),
        findsOneWidget,
      );
    });

    testWidgets('a status read moments ago is not asked again', (tester) async {
      final cache = BankStatusCache();
      final bank = _Bank({'getBusinessBankStatus': (_) => active});
      await pumpEntry(tester, bank, isOwner: false, cache: cache);
      await tester.pumpWidget(const SizedBox());
      await pumpEntry(tester, bank, isOwner: false, cache: cache);
      expect(bank.named('getBusinessBankStatus'), hasLength(1));
      expect(find.byKey(const Key('bank-check-entry')), findsOneWidget);
    });
  });

  group('the owner\'s usage and limit', () {
    Map<String, Object?> status({
      int refreshes = 12,
      bool limitReached = false,
      List<Object?>? byStaff,
    }) => {
      'connected': true,
      'status': 'active',
      'institutionName': 'Chase',
      'accountMask': '1234',
      'windowMinutes': 15,
      'lastSyncAt': _atMs,
      'refreshLimit': 100,
      'usage': {
        'month': '2026-10',
        'checks': 41,
        'refreshes': refreshes,
        'refreshesFailed': 1,
        'estimatedCostCents': 144,
        'refreshLimit': 100,
        'limitReached': limitReached,
        'byStaff':
            byStaff ??
            [
              {'uid': 'u1', 'name': 'Aminata', 'checks': 30, 'refreshes': 9},
              {'uid': 'u2', 'name': '', 'checks': 11, 'refreshes': 3},
            ],
      },
    };

    Future<void> openSettings(
      WidgetTester tester,
      _Bank bank, {
      Locale locale = const Locale('en'),
      Size size = const Size(400, 1600),
    }) async {
      await _pump(
        tester,
        BankZelleSettingsScreen(
          businessId: 'b1',
          service: bank.service,
          launcher: const _FakeLink(),
          isIOS: true,
        ),
        locale: locale,
        size: size,
      );
      await tester.pumpAndSettle();
    }

    testWidgets('this month: checks, refreshes of the limit, cost, by whom', (
      tester,
    ) async {
      final bank = _Bank({'getBusinessBankStatus': (_) => status()});
      await openSettings(tester, bank);
      expect(find.text('This month · October 2026'), findsOneWidget);
      expect(find.text('41'), findsOneWidget);
      expect(find.text('12 of 100'), findsOneWidget);
      expect(find.text(r'$1.44'), findsOneWidget);
      expect(find.text('Aminata'), findsOneWidget);
      expect(find.text('Checks: 30 · Refreshes: 9'), findsOneWidget);
      // A profile without a name: never the uid.
      expect(find.text('Team member'), findsOneWidget);
      expect(find.textContaining('u2'), findsNothing);
      expect(find.byKey(const Key('bank-usage-limit-reached')), findsNothing);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('bank-limit')))
            .controller!
            .text,
        '100',
      );
    });

    testWidgets('no checks yet, and the limit reached, say so', (tester) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) =>
            status(refreshes: 100, limitReached: true, byStaff: []),
      });
      await openSettings(tester, bank);
      expect(find.byKey(const Key('bank-usage-none')), findsOneWidget);
      expect(find.byKey(const Key('bank-usage-limit-reached')), findsOneWidget);
    });

    testWidgets('the limit: 0..1000 only, saved, and the usage follows', (
      tester,
    ) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => status(),
        'setBankCheckWindow': (p) => {'refreshLimit': p['refreshLimit']},
      });
      await openSettings(tester, bank);
      final field = find.byKey(const Key('bank-limit'));
      await tester.ensureVisible(field);
      await tester.enterText(field, '1001');
      await tester.tap(find.byKey(const Key('bank-limit-save')));
      await tester.pump();
      expect(find.text('Type a whole number from 0 to 1000.'), findsOneWidget);
      expect(bank.named('setBankCheckWindow'), isEmpty);
      // Only digits get in.
      await tester.enterText(field, '-5.5');
      await tester.pump();
      expect(tester.widget<TextField>(field).controller!.text, '55');

      await tester.enterText(field, '10');
      await tester.tap(find.byKey(const Key('bank-limit-save')));
      await tester.pumpAndSettle();
      expect(bank.named('setBankCheckWindow').single, {
        'businessId': 'b1',
        'refreshLimit': 10,
      });
      expect(find.text('Limit saved'), findsOneWidget);
      expect(find.text('12 of 10'), findsOneWidget);
      // Under the new limit the month is over it.
      expect(find.byKey(const Key('bank-usage-limit-reached')), findsOneWidget);
    });

    testWidgets('a refused limit says why', (tester) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => status(),
        'setBankCheckWindow': (_) => throw _refusal('limit_invalid'),
      });
      await openSettings(tester, bank);
      final field = find.byKey(const Key('bank-limit'));
      await tester.ensureVisible(field);
      await tester.enterText(field, '50');
      await tester.tap(find.byKey(const Key('bank-limit-save')));
      await tester.pumpAndSettle();
      expect(find.text('Pick a limit from 0 to 1000.'), findsOneWidget);
      expect(find.text('12 of 100'), findsOneWidget);
    });
  });

  group('French, 320 wide', () {
    const fr = Locale('fr');
    const phone = Size(320, 700);

    for (final (name, answer) in [
      ('received', (Map<String, Object?> _) => _received(pending: true)),
      ('several', (Map<String, Object?> _) => _several()),
      (
        'limit reached',
        (Map<String, Object?> _) => _received(limitReached: true),
      ),
      (
        'no bank',
        (Map<String, Object?> _) => throw _refusal('bank_not_connected'),
      ),
      (
        'needs sign-in',
        (Map<String, Object?> _) => throw _refusal('bank_needs_reauth'),
      ),
    ]) {
      testWidgets('the check: $name fits', (tester) async {
        final bank = _Bank({'checkZellePayment': answer});
        await _openSheet(tester, bank, isOwner: true, locale: fr, size: phone);
        expect(find.text('Vérifier la banque'), findsOneWidget);
        expect(find.text('Quand a-t-il été envoyé ?'), findsOneWidget);
        expect(find.text('15 dernières minutes'), findsOneWidget);
        await _check(tester, '60,00');
        expect(tester.takeException(), isNull);
        expect(bank.named('checkZellePayment').single['amountCents'], 6000);
      });
    }

    testWidgets('the check: idle and a refused amount fit', (tester) async {
      final bank = _Bank();
      await _openSheet(tester, bank, locale: fr, size: phone);
      expect(find.text('Vérifier'), findsOneWidget);
      await _check(tester, 'soixante');
      expect(
        find.text('Saisissez le montant, par exemple 60 ou 60,50.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('the check: not yet counts down in French', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => {'result': 'not_found'},
      });
      await _openSheet(tester, bank, locale: fr, size: phone);
      await _check(tester, '60');
      expect(find.text('Pas encore arrivé sur le compte'), findsOneWidget);
      expect(_retryStatus(tester), 'Nouvelle vérification dans 20 s');
      expect(find.text('Arrêter'), findsOneWidget);
      expect(find.text('Vérifier à nouveau'), findsOneWidget);
      await tester.pump(const Duration(seconds: 20));
      expect(bank.named('checkZellePayment').last['auto'], isTrue);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Use for a sale: list and confirmation fit', (tester) async {
      final bank = _Bank({
        'checkZellePayment': (_) => _several(),
        'confirmZelleCandidate': (p) =>
            p['mode'] == 'records' ? _records : _confirmation(),
      });
      await _openSheet(tester, bank, locale: fr, size: phone);
      await _check(tester, '60');
      await _openUse(tester, 'c1');
      expect(tester.takeException(), isNull);
      expect(find.text('Utiliser pour une vente'), findsWidgets);
      expect(find.text('Paiements Zelle récents de ce montant'), findsOne);
      expect(find.text('Vente'), findsOneWidget);
      expect(find.text('Paiement de colis'), findsOneWidget);
      expect(find.text('Client sans nom'), findsOneWidget);
      await tester.tap(
        find.byKey(const Key('bank-use-record-inventory_sale-s1')),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('bank-use-confirm')));
      await tester.pump();
      await tester.pump();
      expect(find.text('Confirmé pour cette vente'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const Key('bank-use-done')));
      await tester.pumpAndSettle();
      expect(find.text('Confirmé pour une vente'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the entry and the owner\'s hints fit', (tester) async {
      for (final (isOwner, status, text) in [
        (
          false,
          <String, Object?>{'connected': true, 'status': 'active'},
          'Vérifier la banque',
        ),
        (true, <String, Object?>{'connected': false}, 'Connecter la banque'),
        (
          true,
          <String, Object?>{'connected': true, 'status': 'needs_reauth'},
          'Reconnecter',
        ),
      ]) {
        final bank = _Bank({'getBusinessBankStatus': (_) => status});
        await _pump(
          tester,
          Scaffold(
            body: BankCheckEntry(
              key: ValueKey(text),
              businessId: 'b1',
              isOwner: isOwner,
              canCheck: true,
              service: bank.service,
              launcher: const _FakeLink(),
              cache: BankStatusCache(),
            ),
          ),
          locale: fr,
          size: phone,
        );
        await tester.pump();
        expect(find.text(text), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
    });

    testWidgets('the owner\'s usage and limit fit', (tester) async {
      final bank = _Bank({
        'getBusinessBankStatus': (_) => {
          'connected': true,
          'status': 'active',
          'institutionName': 'Chase',
          'accountMask': '1234',
          'lastSyncAt': _atMs,
          'refreshLimit': 100,
          'usage': {
            'month': '2026-10',
            'checks': 41,
            'refreshes': 100,
            'estimatedCostCents': 1200,
            'refreshLimit': 100,
            'limitReached': true,
            'byStaff': [
              {
                'uid': 'u1',
                'name': 'Mamadou-Alpha Diallo-Barry',
                'checks': 30,
                'refreshes': 90,
              },
            ],
          },
        },
      });
      await _pump(
        tester,
        BankZelleSettingsScreen(
          businessId: 'b1',
          service: bank.service,
          launcher: const _FakeLink(),
          isIOS: true,
        ),
        locale: fr,
        size: const Size(320, 900),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Ce mois-ci · octobre 2026'), findsOneWidget);
      expect(find.text('100 sur 100'), findsOneWidget);
      expect(find.text('Vérifications : 30 · Actualisations : 90'), findsOne);
      expect(find.byKey(const Key('bank-usage-limit-reached')), findsOneWidget);
      // The limit row (field + Save) and its hint, further down.
      await tester.scrollUntilVisible(
        find.byKey(const Key('bank-limit-hint')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.byKey(const Key('bank-limit-save')), findsOneWidget);
      expect(find.text('Enregistrer'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

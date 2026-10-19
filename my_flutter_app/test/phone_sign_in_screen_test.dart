import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/screens/phone_sign_in_screen.dart';
import 'package:my_flutter_app/screens/phone_verification_screen.dart';
import 'package:my_flutter_app/services/phone_accounts.dart';

import 'fixtures/fake_phone_sign_in.dart';

PhoneAccountFailure _refusal(String reason, {int? attemptsLeft}) =>
    PhoneAccountFailure(
      PhoneAccountRefusal(
        code: 'failed-precondition',
        reason: reason,
        attemptsLeft: attemptsLeft,
      ),
    );

const _delegates = [
  AppLocalizations.delegate,
  GlobalMaterialLocalizations.delegate,
  GlobalWidgetsLocalizations.delegate,
  GlobalCupertinoLocalizations.delegate,
];

/// Opens the screen from a home button so its pop result can be read.
Future<List<PhoneSignInOutcome?>> _open(
  WidgetTester tester,
  FakePhoneSignIn client, {
  PhoneCodeRequest? request,
  Locale locale = const Locale('en'),
}) async {
  final results = <PhoneSignInOutcome?>[];
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      supportedLocales: const [Locale('en'), Locale('fr')],
      localizationsDelegates: _delegates,
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () async {
              results.add(
                await Navigator.of(context).push<PhoneSignInOutcome>(
                  MaterialPageRoute(
                    builder: (_) =>
                        PhoneSignInScreen(request: request, client: client),
                  ),
                ),
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return results;
}

Future<void> _enterNumber(
  WidgetTester tester, [
  String national = '7185550100',
]) async {
  await tester.enterText(
    find.byKey(const Key('phone-sign-in-number')),
    national,
  );
  await tester.pump();
}

Future<void> _tapPrimary(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('phone-sign-in-primary')));
  await tester.pump();
}

void main() {
  testWidgets('a typed number gets a WhatsApp code and signs in', (
    tester,
  ) async {
    final client = FakePhoneSignIn();
    final results = await _open(tester, client);

    expect(find.text('Send the code on WhatsApp'), findsOneWidget);
    expect(find.text('Send it by text instead'), findsOneWidget);
    await _enterNumber(tester);
    await _tapPrimary(tester);
    await tester.pump();

    final request = client.requests.single as TypedPhoneCodeRequest;
    expect(request.phone, '+17185550100');
    expect(find.textContaining('ending in ••00'), findsOneWidget);
    // The resend waits: a counter, not a spinner.
    expect(find.text('Resend code in 30s'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);

    await tester.enterText(
      find.byKey(const Key('phone-sign-in-code')),
      '123456',
    );
    await _tapPrimary(tester);
    await tester.pumpAndSettle();

    expect(client.verified, ['c1:123456']);
    expect(results.single?.signedIn, isTrue);
    expect(find.byType(PhoneSignInScreen), findsNothing);
  });

  testWidgets('resend opens after 30 s and sends again', (tester) async {
    final client = FakePhoneSignIn();
    await _open(tester, client);
    await _enterNumber(tester);
    await _tapPrimary(tester);
    await tester.pump();

    final resend = find.byKey(const Key('phone-sign-in-resend'));
    expect(tester.widget<TextButton>(resend).onPressed, isNull);
    await tester.pump(const Duration(seconds: 12));
    expect(find.text('Resend code in 18s'), findsOneWidget);
    await tester.pump(const Duration(seconds: 18));
    expect(find.text('Resend code'), findsOneWidget);
    expect(tester.widget<TextButton>(resend).onPressed, isNotNull);

    await tester.tap(resend);
    await tester.pump();
    expect(client.requests, hasLength(2));
    expect(find.text('Resend code in 30s'), findsOneWidget);
  });

  testWidgets('a wrong code says how many tries are left; double taps send '
      'once', (tester) async {
    final client = FakePhoneSignIn()..requestGate = Completer<void>();
    await _open(tester, client);
    await _enterNumber(tester);
    await _tapPrimary(tester);
    await _tapPrimary(tester);
    expect(client.requests, hasLength(1));
    expect(find.text('Sending code...'), findsOneWidget);
    client.requestGate!.complete();
    await tester.pump();
    await tester.pump();

    client.verifyError = _refusal(
      PhoneRefusalReason.codeWrong,
      attemptsLeft: 4,
    );
    await tester.enterText(
      find.byKey(const Key('phone-sign-in-code')),
      '000000',
    );
    await _tapPrimary(tester);
    await tester.pump();
    expect(find.text("That code isn't right. 4 tries left."), findsOneWidget);
    expect(find.byType(PhoneSignInScreen), findsOneWidget);

    client.verifyError = _refusal(PhoneRefusalReason.codeExpired);
    await _tapPrimary(tester);
    await tester.pump();
    expect(
      find.text('That code has expired. Ask for a new one.'),
      findsOneWidget,
    );
    // A dead code: resend at once.
    expect(
      tester
          .widget<TextButton>(find.byKey(const Key('phone-sign-in-resend')))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('WhatsApp unavailable texts the typed number instead', (
    tester,
  ) async {
    final client = FakePhoneSignIn()
      ..requestError = _refusal(PhoneRefusalReason.whatsappUnavailable);
    final results = await _open(tester, client);
    await _enterNumber(tester);
    await _tapPrimary(tester);
    await tester.pump();

    expect(client.smsStarts, 1);
    expect(client.smsPhone, '+17185550100');
    expect(find.byKey(const Key('phone-sign-in-note')), findsOneWidget);

    client.smsCodeSent!(const PhoneVerificationSession(verificationId: 'v1'));
    await tester.pump();
    expect(find.textContaining('+17185550100'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('phone-sign-in-code')),
      '654321',
    );
    await _tapPrimary(tester);
    await tester.pumpAndSettle();
    expect(client.smsCodes, ['v1:654321']);
    expect(results.single?.signedIn, isTrue);
  });

  testWidgets('"Send it by text instead" texts the typed number', (
    tester,
  ) async {
    final client = FakePhoneSignIn();
    await _open(tester, client);
    await _enterNumber(tester);
    await tester.tap(find.byKey(const Key('phone-sign-in-text-instead')));
    await tester.pump();
    expect(client.requests, isEmpty);
    expect(client.smsStarts, 1);
    expect(client.smsPhone, '+17185550100');
  });

  testWidgets('a refused number stays on its field with our words', (
    tester,
  ) async {
    final client = FakePhoneSignIn()
      ..requestError = _refusal(PhoneRefusalReason.needsCountryCode);
    await _open(tester, client);
    await _enterNumber(tester);
    await _tapPrimary(tester);
    await tester.pump();
    expect(find.byKey(const Key('phone-sign-in-number')), findsOneWidget);
    expect(find.textContaining('country code'), findsWidgets);
    expect(find.textContaining('Add your country code'), findsOneWidget);
  });

  testWidgets('from a tracking link: the code goes to the record\'s number, '
      'and text asks for the full number', (tester) async {
    final client = FakePhoneSignIn()
      ..challenge = const PhoneLoginChallenge(challengeId: 'c2', lastTwo: '35');
    await _open(
      tester,
      client,
      request: const TrackingPhoneCodeRequest(
        trackingCode: 'CL-K7M4P2',
        role: 'receiver',
        lastTwo: '35',
      ),
    );

    final request = client.requests.single as TrackingPhoneCodeRequest;
    expect(request.role, 'receiver');
    expect(find.textContaining('ending in ••35'), findsOneWidget);
    expect(find.byKey(const Key('phone-sign-in-number')), findsNothing);

    await tester.tap(find.byKey(const Key('phone-sign-in-text-instead')));
    await tester.pump();
    expect(find.byKey(const Key('phone-sign-in-number')), findsOneWidget);
    expect(find.textContaining('enter your full phone number'), findsOneWidget);
    expect(find.text('Send the code by text'), findsOneWidget);
    expect(client.smsStarts, 0);

    await _enterNumber(tester, '7185550123');
    await _tapPrimary(tester);
    expect(client.smsStarts, 1);
    expect(client.smsPhone, '+17185550123');
  });

  testWidgets('French copy', (tester) async {
    final client = FakePhoneSignIn();
    await _open(tester, client, locale: const Locale('fr'));
    expect(find.text('Envoyer le code sur WhatsApp'), findsOneWidget);
    expect(find.text('Recevoir le code par SMS'), findsOneWidget);
  });

  testWidgets('phone verification offers WhatsApp and syncs after the link', (
    tester,
  ) async {
    final signIn = FakePhoneSignIn()
      ..verifyAnswer = const PhoneCodeVerified(linked: true, merged: true);
    final verification = _LinkingVerificationClient();
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        supportedLocales: const [Locale('en'), Locale('fr')],
        localizationsDelegates: _delegates,
        home: PhoneVerificationScreen(
          client: verification,
          whatsAppClient: signIn,
        ),
      ),
    );
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('phone-verification-number')),
      '7185550100',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('phone-verification-whatsapp')));
    await tester.pumpAndSettle();

    final request = signIn.requests.single as LinkPhoneCodeRequest;
    expect(request.phone, '+17185550100');
    // Link mode: WhatsApp only (the screen underneath is the text path).
    expect(find.byKey(const Key('phone-sign-in-text-instead')), findsNothing);

    await tester.enterText(
      find.byKey(const Key('phone-sign-in-code')),
      '112233',
    );
    await tester.tap(find.byKey(const Key('phone-sign-in-primary')));
    await tester.pumpAndSettle();

    expect(verification.syncCalls, 1);
    expect(verification.smsStarts, 0);
    expect(find.byKey(const Key('phone-verification-done')), findsOneWidget);
  });

  testWidgets('without a WhatsApp client a test fake shows no alternative', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        supportedLocales: const [Locale('en'), Locale('fr')],
        localizationsDelegates: _delegates,
        home: PhoneVerificationScreen(client: _LinkingVerificationClient()),
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('phone-verification-whatsapp')), findsNothing);
  });
}

/// A verification client whose profile sync succeeds once the number is
/// linked (by the WhatsApp code, here).
class _LinkingVerificationClient implements PhoneVerificationClient {
  @override
  String? customerPhone = '+17185550100';

  @override
  String? linkedPhoneNumber;

  @override
  bool phoneVerified = false;

  int syncCalls = 0;
  int smsStarts = 0;

  @override
  Future<void> startPhoneVerification({
    required String phoneNumber,
    required String languageCode,
    required ValueChanged<PhoneVerificationSession> onCodeSent,
    required Future<void> Function() onVerificationCompleted,
    required ValueChanged<Object> onVerificationFailed,
    required bool Function() shouldCompleteAutomaticVerification,
    int? resendToken,
  }) async {
    smsStarts += 1;
  }

  @override
  Future<void> completePhoneVerification({
    required String verificationId,
    required String smsCode,
  }) async {}

  @override
  Future<void> syncLinkedPhoneVerification() async {
    syncCalls += 1;
    linkedPhoneNumber = customerPhone;
    phoneVerified = true;
  }
}

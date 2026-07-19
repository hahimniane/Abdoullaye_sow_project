import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/screens/phone_verification_screen.dart';

class FakePhoneVerificationClient implements PhoneVerificationClient {
  FakePhoneVerificationClient({
    this.customerPhone = '+17185550100',
    this.linkedPhoneNumber,
    this.phoneVerified = false,
  });

  @override
  String? customerPhone;

  @override
  String? linkedPhoneNumber;

  @override
  bool phoneVerified;

  int startCalls = 0;
  int completeCalls = 0;
  int syncCalls = 0;
  String? lastPhone;
  String? lastLanguage;
  String? lastVerificationId;
  String? lastCode;
  int? lastResendToken;
  bool failStart = false;
  bool failSync = false;
  ValueChanged<PhoneVerificationSession>? codeSent;
  Future<void> Function()? verificationCompleted;
  ValueChanged<Object>? verificationFailed;
  bool Function()? shouldCompleteAutomaticVerification;

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
    startCalls += 1;
    lastPhone = phoneNumber;
    lastLanguage = languageCode;
    lastResendToken = resendToken;
    codeSent = onCodeSent;
    verificationCompleted = onVerificationCompleted;
    verificationFailed = onVerificationFailed;
    this.shouldCompleteAutomaticVerification =
        shouldCompleteAutomaticVerification;
    if (failStart) {
      throw FirebaseAuthException(code: 'network-request-failed');
    }
  }

  @override
  Future<void> completePhoneVerification({
    required String verificationId,
    required String smsCode,
  }) async {
    completeCalls += 1;
    lastVerificationId = verificationId;
    lastCode = smsCode;
    linkedPhoneNumber = customerPhone;
    phoneVerified = true;
  }

  @override
  Future<void> syncLinkedPhoneVerification() async {
    syncCalls += 1;
    if (failSync) throw FirebaseAuthException(code: 'network-request-failed');
    phoneVerified = true;
  }
}

Future<void> pumpVerification(
  WidgetTester tester, {
  required FakePhoneVerificationClient client,
  Locale locale = const Locale('en'),
  bool returnToSharedBarrels = false,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      supportedLocales: const [Locale('en'), Locale('fr')],
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: PhoneVerificationScreen(
        client: client,
        returnToSharedBarrels: returnToSharedBarrels,
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('invalid phone sends no SMS request', (tester) async {
    final client = FakePhoneVerificationClient(customerPhone: '7185550100');
    await pumpVerification(tester, client: client);

    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pump();

    expect(client.startCalls, 0);
    expect(find.textContaining('international phone number'), findsOneWidget);
  });

  testWidgets('send remains guarded until an asynchronous callback arrives', (
    tester,
  ) async {
    final client = FakePhoneVerificationClient();
    await pumpVerification(tester, client: client);

    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pump();

    expect(client.startCalls, 1);
    expect(client.lastPhone, '+17185550100');
    expect(client.lastLanguage, 'en');
    expect(find.text('Sending code...'), findsOneWidget);

    client.codeSent!(
      const PhoneVerificationSession(
        verificationId: 'verification-1',
        resendToken: 42,
      ),
    );
    await tester.pump();

    expect(find.text('Code sent'), findsOneWidget);
    expect(find.byKey(const Key('phone-verification-code')), findsOneWidget);
  });

  testWidgets('six digit code reaches a visible success state', (tester) async {
    final client = FakePhoneVerificationClient();
    await pumpVerification(tester, client: client, returnToSharedBarrels: true);

    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pump();
    client.codeSent!(
      const PhoneVerificationSession(verificationId: 'verification-2'),
    );
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('phone-verification-code')),
      '123456',
    );
    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pumpAndSettle();

    expect(client.completeCalls, 1);
    expect(client.lastVerificationId, 'verification-2');
    expect(client.lastCode, '123456');
    expect(find.text('Phone verified'), findsOneWidget);
    expect(find.text('Return to shared barrels'), findsOneWidget);
  });

  testWidgets('short code does not call verification', (tester) async {
    final client = FakePhoneVerificationClient();
    await pumpVerification(tester, client: client);
    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pump();
    client.codeSent!(
      const PhoneVerificationSession(verificationId: 'verification-3'),
    );
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('phone-verification-code')),
      '123',
    );
    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pump();

    expect(client.completeCalls, 0);
    expect(find.text('Enter the 6-digit code.'), findsOneWidget);
  });

  testWidgets('failed resend restores the code state and permits change', (
    tester,
  ) async {
    final client = FakePhoneVerificationClient();
    await pumpVerification(tester, client: client);
    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pump();
    client.codeSent!(
      const PhoneVerificationSession(
        verificationId: 'verification-4',
        resendToken: 77,
      ),
    );
    await tester.pump(const Duration(seconds: 31));
    client.failStart = true;

    await tester.tap(find.byKey(const Key('phone-verification-resend')));
    await tester.pump();

    expect(client.startCalls, 2);
    expect(client.lastResendToken, 77);
    expect(find.text('Check your connection and try again.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('phone-verification-change-number')));
    await tester.pump();
    expect(find.byKey(const Key('phone-verification-number')), findsOneWidget);
  });

  testWidgets('linked phone retries profile sync without sending another SMS', (
    tester,
  ) async {
    final client = FakePhoneVerificationClient(
      linkedPhoneNumber: '+17185550100',
    );
    client.failSync = true;
    await pumpVerification(tester, client: client);

    expect(find.text('Finish verification'), findsOneWidget);
    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pump();

    expect(client.startCalls, 0);
    expect(client.syncCalls, 1);
    expect(find.textContaining('another SMS is not required'), findsOneWidget);

    client.failSync = false;
    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pumpAndSettle();
    expect(client.syncCalls, 2);
    expect(find.text('Phone verified'), findsOneWidget);
  });

  testWidgets('French code state fits a narrow phone', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = FakePhoneVerificationClient();
    await pumpVerification(tester, client: client, locale: const Locale('fr'));

    await tester.tap(find.byKey(const Key('phone-verification-primary')));
    await tester.pump();
    client.codeSent!(
      const PhoneVerificationSession(verificationId: 'verification-fr'),
    );
    await tester.pump();

    expect(find.text('Code envoyé'), findsOneWidget);
    expect(find.text('Vérifier le téléphone'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('error classifier never depends on raw server messages', () {
    expect(
      classifyPhoneVerificationError(
        FirebaseAuthException(
          code: 'invalid-verification-code',
          message: '[firebase_auth] raw stack',
        ),
      ),
      PhoneVerificationErrorType.invalidCode,
    );
    expect(
      classifyPhoneVerificationError(StateError('sensitive raw failure')),
      PhoneVerificationErrorType.generic,
    );
  });
}

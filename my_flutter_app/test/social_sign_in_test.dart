import 'dart:math';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/firebase_environment_options.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_failure.dart';
import 'package:my_flutter_app/services/social_sign_in.dart';
import 'package:my_flutter_app/widgets/social_sign_in_buttons.dart';

/// Google/Apple handing back a credential, or null when the person closes
/// the sheet.
class _FakeSource implements SocialCredentialSource {
  _FakeSource({this.cancel = false});

  final bool cancel;
  final List<SocialProvider> asked = [];

  @override
  Future<SocialCredential?> obtain(SocialProvider provider) async {
    asked.add(provider);
    if (cancel) return null;
    return SocialCredential(
      provider: provider,
      credential: GoogleAuthProvider.credential(idToken: 'id-token'),
      email: 'ada@example.com',
    );
  }
}

/// Firebase + the `completeSocialSignIn` callable, in memory: profiles by
/// uid, created once and only for a uid that has none (as the server does).
class _FakeBackend {
  _FakeBackend({Map<String, String>? roles, this.invitationPending = false})
    : roles = {...?roles};

  final Map<String, String> roles;
  final bool invitationPending;
  String uid = 'u1';
  int completeCalls = 0;
  int signOuts = 0;
  bool failComplete = false;
  Object? signInError;

  Future<String> signIn(SocialCredential _) async {
    final error = signInError;
    if (error != null) throw error;
    return uid;
  }

  Future<bool> loadProfile(String forUid) async => roles.containsKey(forUid);

  Future<SocialProfileAnswer> complete() async {
    completeCalls++;
    if (failComplete) throw Exception('unavailable');
    if (roles.containsKey(uid) || invitationPending) {
      return SocialProfileAnswer(
        profileCreated: false,
        invitationPending: invitationPending,
      );
    }
    roles[uid] = 'customer';
    return const SocialProfileAnswer(
      profileCreated: true,
      invitationPending: false,
    );
  }

  Future<void> signOut() async => signOuts++;

  SocialSignInFlow flow(SocialCredentialSource source) => SocialSignInFlow(
    source: source,
    signIn: signIn,
    loadProfile: loadProfile,
    completeProfile: complete,
    signOut: signOut,
  );
}

void main() {
  group('socialProvidersFor', () {
    test('iOS offers Google and Apple', () {
      expect(
        socialProvidersFor(
          platform: TargetPlatform.iOS,
          isWeb: false,
          googleConfigured: true,
        ),
        [SocialProvider.google, SocialProvider.apple],
      );
    });

    test('Android offers Google only - never Apple', () {
      expect(
        socialProvidersFor(
          platform: TargetPlatform.android,
          isWeb: false,
          googleConfigured: true,
        ),
        [SocialProvider.google],
      );
    });

    test('the web build and desktops offer neither', () {
      for (final platform in TargetPlatform.values) {
        expect(
          socialProvidersFor(
            platform: platform,
            isWeb: true,
            googleConfigured: true,
          ),
          isEmpty,
          reason: '$platform web',
        );
      }
      expect(
        socialProvidersFor(
          platform: TargetPlatform.macOS,
          isWeb: false,
          googleConfigured: true,
        ),
        isEmpty,
      );
    });

    test('no Google button where the project has no Google clients', () {
      expect(
        socialProvidersFor(
          platform: TargetPlatform.android,
          isWeb: false,
          googleConfigured: false,
        ),
        isEmpty,
      );
      expect(
        socialProvidersFor(
          platform: TargetPlatform.iOS,
          isWeb: false,
          googleConfigured: false,
        ),
        [SocialProvider.apple],
      );
    });

    test('only the new project carries Google client ids', () {
      final ids = FirebaseEnvironmentOptions.googleSignInClientIdsFor('new');
      expect(ids, isNotNull);
      expect(ids!.serverClientId, endsWith('.apps.googleusercontent.com'));
      expect(ids.iosClientId, endsWith('.apps.googleusercontent.com'));
      expect(ids.iosClientId, isNot(ids.serverClientId));
      expect(
        FirebaseEnvironmentOptions.googleSignInClientIdsFor('production'),
        isNull,
      );
      expect(
        FirebaseEnvironmentOptions.googleSignInClientIdsFor('staging'),
        isNull,
      );
    });
  });

  group('Apple nonce', () {
    test('is random, 32 characters from the URL-safe set', () {
      final a = generateNonce();
      final b = generateNonce();
      expect(a.length, 32);
      expect(a, isNot(b));
      expect(RegExp(r'^[0-9A-Za-z\-._]+$').hasMatch(a), isTrue);
      expect(generateNonce(16, Random(1)), generateNonce(16, Random(1)));
    });

    test('Apple gets the SHA-256 hex of it', () {
      expect(
        sha256OfString('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    test('Apple name parts become one display name', () {
      expect(appleDisplayName(' Ada ', 'Lovelace'), 'Ada Lovelace');
      expect(appleDisplayName(null, 'Lovelace'), 'Lovelace');
      expect(appleDisplayName('', null), isNull);
    });
  });

  group('socialAuthErrorCodeFor', () {
    test('an email with another sign-in method reads as such', () {
      expect(
        socialAuthErrorCodeFor('account-exists-with-different-credential'),
        AuthErrorCode.accountExistsWithOtherSignIn,
      );
    });

    test('a bad Google/Apple token is not "wrong email or password"', () {
      expect(
        socialAuthErrorCodeFor('invalid-credential'),
        AuthErrorCode.socialSignInFailed,
      );
      expect(
        socialAuthErrorCodeFor('network-request-failed'),
        AuthErrorCode.network,
      );
      expect(
        socialAuthErrorCodeFor('user-disabled'),
        AuthErrorCode.userDisabled,
      );
    });

    test('a pending Google credential links only to the same email', () {
      expect(
        shouldLinkPendingSocialCredential(
          pendingEmail: 'Ada@Example.com',
          signedInEmail: 'ada@example.com',
        ),
        isTrue,
      );
      expect(
        shouldLinkPendingSocialCredential(
          pendingEmail: 'ada@example.com',
          signedInEmail: 'bob@example.com',
        ),
        isFalse,
      );
      expect(
        shouldLinkPendingSocialCredential(
          pendingEmail: null,
          signedInEmail: 'ada@example.com',
        ),
        isFalse,
      );
    });
  });

  group('SocialSignInFlow', () {
    test('a new social user gets a customer profile, created once', () async {
      final backend = _FakeBackend();
      final source = _FakeSource();
      final outcome = await backend.flow(source).run(SocialProvider.google);
      expect(outcome, SocialSignInOutcome.signedIn);
      expect(backend.completeCalls, 1);
      expect(backend.roles, {'u1': 'customer'});
      expect(backend.signOuts, 0);

      // Signing in again finds the profile: nothing is created twice.
      final again = await backend.flow(source).run(SocialProvider.google);
      expect(again, SocialSignInOutcome.signedIn);
      expect(backend.completeCalls, 1);
    });

    test('an existing account keeps its role - nothing is written', () async {
      for (final role in ['staff', 'businessOwner', 'admin', 'customer']) {
        final backend = _FakeBackend(roles: {'u1': role});
        final outcome = await backend
            .flow(_FakeSource())
            .run(SocialProvider.google);
        expect(outcome, SocialSignInOutcome.signedIn, reason: role);
        expect(backend.completeCalls, 0, reason: role);
        expect(backend.roles, {'u1': role}, reason: role);
      }
    });

    test('closing the Google/Apple sheet is silent', () async {
      final backend = _FakeBackend();
      final source = _FakeSource(cancel: true);
      final outcome = await backend.flow(source).run(SocialProvider.apple);
      expect(outcome, SocialSignInOutcome.cancelled);
      expect(source.asked, [SocialProvider.apple]);
      expect(backend.completeCalls, 0);
      expect(backend.signOuts, 0);
      expect(backend.roles, isEmpty);
    });

    test('a refused sign-in surfaces its code and writes nothing', () async {
      final backend = _FakeBackend()
        ..signInError = const AuthFailure(
          AuthErrorCode.accountExistsWithOtherSignIn,
        );
      await expectLater(
        backend.flow(_FakeSource()).run(SocialProvider.google),
        throwsA(
          isA<AuthFailure>().having(
            (failure) => failure.code,
            'code',
            AuthErrorCode.accountExistsWithOtherSignIn,
          ),
        ),
      );
      expect(backend.completeCalls, 0);
    });

    test('a profile that cannot be made signs out with a message', () async {
      final backend = _FakeBackend()..failComplete = true;
      await expectLater(
        backend.flow(_FakeSource()).run(SocialProvider.google),
        throwsA(
          isA<AuthFailure>().having(
            (failure) => failure.code,
            'code',
            AuthErrorCode.socialSignInFailed,
          ),
        ),
      );
      expect(backend.signOuts, 1);
      expect(backend.roles, isEmpty);
    });

    test('a waiting invitation is never turned into a customer', () async {
      final backend = _FakeBackend(invitationPending: true);
      await expectLater(
        backend.flow(_FakeSource()).run(SocialProvider.google),
        throwsA(
          isA<AuthFailure>().having(
            (failure) => failure.code,
            'code',
            AuthErrorCode.invitationWaiting,
          ),
        ),
      );
      expect(backend.roles, isEmpty);
      expect(backend.signOuts, 1);
    });
  });

  group('SocialSignInButtons', () {
    Widget host(Widget child, {Locale locale = const Locale('en')}) =>
        MaterialApp(
          locale: locale,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Padding(padding: const EdgeInsets.all(16), child: child),
          ),
        );

    testWidgets('iOS shows Google and Apple; Apple is the black button', (
      tester,
    ) async {
      await tester.pumpWidget(
        host(
          SocialSignInButtons(
            providers: socialProvidersFor(
              platform: TargetPlatform.iOS,
              isWeb: false,
              googleConfigured: true,
            ),
            onPressed: (_) {},
          ),
        ),
      );
      expect(find.text('Continue with Google'), findsOneWidget);
      expect(find.text('Continue with Apple'), findsOneWidget);
      expect(find.byType(GoogleGLogo), findsOneWidget);
      expect(find.byIcon(Icons.apple), findsOneWidget);
      final apple = tester.widget<OutlinedButton>(
        find.byKey(const Key('social-sign-in-apple')),
      );
      expect(
        apple.style!.backgroundColor!.resolve(const <WidgetState>{}),
        Colors.black,
      );
      final google = tester.widget<OutlinedButton>(
        find.byKey(const Key('social-sign-in-google')),
      );
      expect(
        google.style!.backgroundColor!.resolve(const <WidgetState>{}),
        Colors.white,
      );
    });

    testWidgets('Android shows Google only', (tester) async {
      await tester.pumpWidget(
        host(
          SocialSignInButtons(
            providers: socialProvidersFor(
              platform: TargetPlatform.android,
              isWeb: false,
              googleConfigured: true,
            ),
            onPressed: (_) {},
          ),
        ),
      );
      expect(find.text('Continue with Google'), findsOneWidget);
      expect(find.text('Continue with Apple'), findsNothing);
      expect(find.byKey(const Key('social-sign-in-apple')), findsNothing);
    });

    testWidgets('nothing at all when no provider is offered', (tester) async {
      await tester.pumpWidget(
        host(SocialSignInButtons(providers: const [], onPressed: (_) {})),
      );
      expect(find.byType(OutlinedButton), findsNothing);
      expect(find.text('or'), findsNothing);
    });

    testWidgets('a tap names its provider', (tester) async {
      final tapped = <SocialProvider>[];
      await tester.pumpWidget(
        host(
          SocialSignInButtons(
            providers: const [SocialProvider.google, SocialProvider.apple],
            onPressed: tapped.add,
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('social-sign-in-apple')));
      await tester.tap(find.byKey(const Key('social-sign-in-google')));
      expect(tapped, [SocialProvider.apple, SocialProvider.google]);
    });

    testWidgets('while one runs: its spinner, and no button takes a tap', (
      tester,
    ) async {
      final tapped = <SocialProvider>[];
      await tester.pumpWidget(
        host(
          SocialSignInButtons(
            providers: const [SocialProvider.google, SocialProvider.apple],
            busyProvider: SocialProvider.google,
            onPressed: tapped.add,
          ),
        ),
      );
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byType(GoogleGLogo), findsNothing);
      for (final key in ['google', 'apple']) {
        final button = tester.widget<OutlinedButton>(
          find.byKey(Key('social-sign-in-$key')),
        );
        expect(button.onPressed, isNull, reason: key);
      }
      await tester.tap(find.byKey(const Key('social-sign-in-apple')));
      expect(tapped, isEmpty);
    });

    testWidgets('disabled while another sign-in runs', (tester) async {
      await tester.pumpWidget(
        host(
          SocialSignInButtons(
            providers: const [SocialProvider.google],
            enabled: false,
            onPressed: (_) {},
          ),
        ),
      );
      final button = tester.widget<OutlinedButton>(
        find.byKey(const Key('social-sign-in-google')),
      );
      expect(button.onPressed, isNull);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('French labels, fitting a 320 px phone', (tester) async {
      tester.view.physicalSize = const Size(640, 1200);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        host(
          SocialSignInButtons(
            providers: const [SocialProvider.google, SocialProvider.apple],
            onPressed: (_) {},
          ),
          locale: const Locale('fr'),
        ),
      );
      expect(find.text('Continuer avec Google'), findsOneWidget);
      expect(find.text('Continuer avec Apple'), findsOneWidget);
      expect(find.text('ou'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

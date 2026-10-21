import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../firebase_environment_options.dart';
import '../providers/auth_failure.dart';

/// Sign in with Google / Apple.
///
/// Firebase Auth signs the person in with the Google or Apple credential.
/// One email is one account in this project, so a Google account whose
/// email already has a Laawol account lands on THAT account - same uid,
/// profile, role and history. A brand-new account gets a plain customer
/// profile from `createMissingUserProfile({self: true})` (functions
/// social_sign_in.js), never business or platform access; an access
/// invitation waiting for that person is left to the invitation flow.
///
/// The steps live in [SocialSignInFlow] behind small ports so they are
/// unit-tested with fakes; [PlatformSocialCredentialSource] is the only part
/// that talks to the Google and Apple SDKs.
enum SocialProvider { google, apple }

/// The callable that finishes a social sign-in: the profile-repair callable,
/// for the caller's OWN missing profile (functions index.js). Not a function
/// of its own - every deployed function reserves Cloud Run CPU.
const completeSocialSignInCallable = 'createMissingUserProfile';
const completeSocialSignInPayload = <String, Object>{'self': true};

/// The social buttons a sign-in screen offers on [platform]. Google needs
/// this build's project to have Google OAuth clients ([googleConfigured]).
/// Apple is offered on iOS only: App Store guideline 4.8 asks for it there
/// whenever another social sign-in is offered, and Android and the web
/// consoles do not show it.
List<SocialProvider> socialProvidersFor({
  required TargetPlatform platform,
  required bool isWeb,
  required bool googleConfigured,
}) {
  if (isWeb) return const [];
  return switch (platform) {
    TargetPlatform.android => [if (googleConfigured) SocialProvider.google],
    TargetPlatform.iOS => [
      if (googleConfigured) SocialProvider.google,
      SocialProvider.apple,
    ],
    _ => const [],
  };
}

/// The providers this build offers on this device.
List<SocialProvider> get socialProvidersForThisDevice => socialProvidersFor(
  platform: defaultTargetPlatform,
  isWeb: kIsWeb,
  googleConfigured: FirebaseEnvironmentOptions.googleSignInClientIds != null,
);

const _nonceCharset =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';

/// A random nonce for Sign in with Apple: Apple receives its SHA-256
/// ([sha256OfString]); Firebase receives the raw value and checks the two
/// match, so a captured Apple token cannot be replayed.
String generateNonce([int length = 32, Random? random]) {
  final source = random ?? Random.secure();
  return List.generate(
    length,
    (_) => _nonceCharset[source.nextInt(_nonceCharset.length)],
  ).join();
}

/// Lowercase hex SHA-256 of [input] (what Apple expects as the nonce).
String sha256OfString(String input) =>
    sha256.convert(utf8.encode(input)).toString();

/// "Ada Lovelace" from Apple's name parts; null when Apple shared none
/// (it shares them on the first sign-in only).
String? appleDisplayName(String? givenName, String? familyName) {
  final name = [
    givenName?.trim() ?? '',
    familyName?.trim() ?? '',
  ].where((part) => part.isNotEmpty).join(' ');
  return name.isEmpty ? null : name;
}

/// The AuthErrorCode for a FirebaseAuthException raised by a Google or
/// Apple sign-in. "invalid-credential" here is a bad Google/Apple token, not
/// a wrong password, so it does not read as "wrong email or password".
AuthErrorCode socialAuthErrorCodeFor(String firebaseCode) {
  return switch (firebaseCode.trim().toLowerCase()) {
    'account-exists-with-different-credential' ||
    'credential-already-in-use' ||
    'email-already-in-use' => AuthErrorCode.accountExistsWithOtherSignIn,
    'user-disabled' => AuthErrorCode.userDisabled,
    'too-many-requests' => AuthErrorCode.tooManyRequests,
    'network-request-failed' => AuthErrorCode.network,
    'operation-not-allowed' => AuthErrorCode.signInUnavailable,
    _ => AuthErrorCode.socialSignInFailed,
  };
}

/// Link the Google/Apple credential that bumped into an existing account
/// once the person signs into that account with its password - only when it
/// is the same email, so a shared phone never ties one person's Google
/// account to someone else's Laawol account.
bool shouldLinkPendingSocialCredential({
  required String? pendingEmail,
  required String? signedInEmail,
}) {
  final pending = pendingEmail?.trim().toLowerCase() ?? '';
  final signedIn = signedInEmail?.trim().toLowerCase() ?? '';
  return pending.isNotEmpty && pending == signedIn;
}

/// A credential from Google or Apple, ready for Firebase.
class SocialCredential {
  const SocialCredential({
    required this.provider,
    required this.credential,
    this.email,
    this.displayName,
  });

  final SocialProvider provider;
  final AuthCredential credential;

  /// The Google/Apple account's email, when it gave one.
  final String? email;

  /// The person's name, when the provider gave one.
  final String? displayName;
}

/// Gets a credential from Google or Apple. Null means the person closed the
/// Google/Apple sheet: that is not an error and shows nothing.
abstract class SocialCredentialSource {
  Future<SocialCredential?> obtain(SocialProvider provider);
}

/// What the server did for a social sign-in ([completeSocialSignInCallable]).
class SocialProfileAnswer {
  const SocialProfileAnswer({
    required this.profileCreated,
    required this.invitationPending,
  });

  factory SocialProfileAnswer.fromMap(Map<Object?, Object?> data) =>
      SocialProfileAnswer(
        profileCreated: data['profileCreated'] == true,
        invitationPending: data['invitationPending'] == true,
      );

  final bool profileCreated;
  final bool invitationPending;
}

enum SocialSignInOutcome {
  /// The person closed the Google/Apple sheet. Nothing to show.
  cancelled,

  /// Signed in, with a loaded profile: route by its role.
  signedIn,
}

/// The steps of a Google/Apple sign-in, with Firebase behind small ports.
class SocialSignInFlow {
  const SocialSignInFlow({
    required this.source,
    required this.signIn,
    required this.loadProfile,
    required this.completeProfile,
    required this.signOut,
  });

  final SocialCredentialSource source;

  /// Signs Firebase in with the credential and returns the uid; throws an
  /// [AuthFailure] when Firebase refuses.
  final Future<String> Function(SocialCredential credential) signIn;

  /// Loads the signed-in account's profile; true when [uid]'s profile is
  /// loaded (an existing account, or an invitation accepted on the way).
  final Future<bool> Function(String uid) loadProfile;

  /// [completeSocialSignInCallable] with [completeSocialSignInPayload].
  final Future<SocialProfileAnswer> Function() completeProfile;
  final Future<void> Function() signOut;

  Future<SocialSignInOutcome> run(SocialProvider provider) async {
    final credential = await source.obtain(provider);
    if (credential == null) return SocialSignInOutcome.cancelled;
    final uid = await signIn(credential);
    // An existing account keeps its profile and role - nothing is written.
    if (await loadProfile(uid)) return SocialSignInOutcome.signedIn;

    SocialProfileAnswer answer;
    try {
      answer = await completeProfile();
    } catch (error) {
      debugPrint('completeSocialSignIn failed: $error');
      // An account with no profile cannot be used: sign out so the person
      // can simply try again (as a phone sign-in does).
      await signOut();
      throw const AuthFailure(AuthErrorCode.socialSignInFailed);
    }
    if (await loadProfile(uid)) return SocialSignInOutcome.signedIn;
    await signOut();
    throw AuthFailure(
      answer.invitationPending
          ? AuthErrorCode.invitationWaiting
          : AuthErrorCode.socialSignInFailed,
    );
  }
}

/// The Google and Apple SDKs.
class PlatformSocialCredentialSource implements SocialCredentialSource {
  PlatformSocialCredentialSource._();

  static final PlatformSocialCredentialSource instance =
      PlatformSocialCredentialSource._();

  Future<void>? _googleReady;

  Future<void> _initializeGoogle() {
    return _googleReady ??= () async {
      final ids = FirebaseEnvironmentOptions.googleSignInClientIds;
      if (ids == null) {
        throw const AuthFailure(AuthErrorCode.signInUnavailable);
      }
      await GoogleSignIn.instance.initialize(
        clientId: defaultTargetPlatform == TargetPlatform.iOS
            ? ids.iosClientId
            : null,
        serverClientId: ids.serverClientId,
      );
    }();
  }

  @override
  Future<SocialCredential?> obtain(SocialProvider provider) =>
      switch (provider) {
        SocialProvider.google => _google(),
        SocialProvider.apple => _apple(),
      };

  Future<SocialCredential?> _google() async {
    try {
      await _initializeGoogle();
    } catch (error) {
      // A failed initialize is retried on the next tap.
      _googleReady = null;
      if (error is AuthFailure) rethrow;
      debugPrint('Google sign-in initialize failed: $error');
      throw const AuthFailure(AuthErrorCode.socialSignInFailed);
    }
    final GoogleSignInAccount account;
    try {
      account = await GoogleSignIn.instance.authenticate();
    } on GoogleSignInException catch (error) {
      if (error.code == GoogleSignInExceptionCode.canceled) return null;
      debugPrint('Google sign-in failed: ${error.code.name}');
      throw const AuthFailure(AuthErrorCode.socialSignInFailed);
    }
    final idToken = account.authentication.idToken;
    if (idToken == null || idToken.isEmpty) {
      throw const AuthFailure(AuthErrorCode.socialSignInFailed);
    }
    return SocialCredential(
      provider: SocialProvider.google,
      credential: GoogleAuthProvider.credential(idToken: idToken),
      email: account.email,
      displayName: account.displayName,
    );
  }

  Future<SocialCredential?> _apple() async {
    final rawNonce = generateNonce();
    final AuthorizationCredentialAppleID apple;
    try {
      apple = await SignInWithApple.getAppleIDCredential(
        scopes: const [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.fullName,
        ],
        nonce: sha256OfString(rawNonce),
      );
    } on SignInWithAppleAuthorizationException catch (error) {
      if (error.code == AuthorizationErrorCode.canceled) return null;
      debugPrint('Apple sign-in failed: ${error.code.name}');
      throw const AuthFailure(AuthErrorCode.socialSignInFailed);
    } on SignInWithAppleException catch (error) {
      debugPrint('Apple sign-in unavailable: $error');
      throw const AuthFailure(AuthErrorCode.socialSignInFailed);
    }
    final idToken = apple.identityToken;
    if (idToken == null || idToken.isEmpty) {
      throw const AuthFailure(AuthErrorCode.socialSignInFailed);
    }
    return SocialCredential(
      provider: SocialProvider.apple,
      credential: AppleAuthProvider.credentialWithIDToken(
        idToken,
        rawNonce,
        AppleFullPersonName(
          givenName: apple.givenName,
          familyName: apple.familyName,
        ),
      ),
      email: apple.email,
      displayName: appleDisplayName(apple.givenName, apple.familyName),
    );
  }

  /// Forget the Google account chosen on this phone, so the next "Continue
  /// with Google" asks which account again (after signing out).
  Future<void> signOutGoogle() async {
    if (_googleReady == null) return;
    try {
      await GoogleSignIn.instance.signOut();
    } catch (error) {
      debugPrint('Google sign-out skipped: $error');
    }
  }
}

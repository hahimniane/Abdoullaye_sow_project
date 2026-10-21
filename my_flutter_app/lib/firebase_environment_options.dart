import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;

import 'firebase_options.dart';
import 'firebase_options_new.dart';
import 'firebase_options_staging.dart';

/// Chooses the Firebase project the app talks to. This is the ONE place the
/// project is selected:
///   production - the project that is live today (default)
///   staging    - the isolated staging project
///   new        - the project production moves to (firebase_options_new.dart;
///                fails closed until its placeholders are filled in)
/// Cutover is changing [defaultEnvironment] (or building with
/// `--dart-define=FIREBASE_ENV=new`).
///
/// Cutover: the server and web moved to the new project on 2026-10-20; the
/// apps follow from 1.0.20 (this default, google-services.json, the
/// Info.plist URL scheme and `apps` in deploy/project-config.json all name
/// the new project). Older installs keep talking to the old project until
/// the force-update gate moves them - see docs/PROJECT_MIGRATION.md.
abstract final class FirebaseEnvironmentOptions {
  static const String defaultEnvironment = 'new';

  static const String environment = String.fromEnvironment(
    'FIREBASE_ENV',
    defaultValue: defaultEnvironment,
  );

  static FirebaseOptions get currentPlatform => forEnvironment(
    environment,
    isWeb: kIsWeb,
    platform: defaultTargetPlatform,
  );

  /// Sign in with Google's client ids for [requestedEnvironment], or null
  /// where the project has no Google OAuth clients (the old production
  /// project and staging): the app then offers no Google button there.
  static GoogleSignInClientIds? googleSignInClientIdsFor(
    String requestedEnvironment,
  ) {
    if (requestedEnvironment.trim().toLowerCase() != 'new') return null;
    return const GoogleSignInClientIds(
      iosClientId: NewProjectFirebaseOptions.googleIosClientId,
      serverClientId: NewProjectFirebaseOptions.googleServerClientId,
    );
  }

  static GoogleSignInClientIds? get googleSignInClientIds =>
      googleSignInClientIdsFor(environment);

  static FirebaseOptions forEnvironment(
    String requestedEnvironment, {
    required bool isWeb,
    required TargetPlatform platform,
  }) {
    final normalized = requestedEnvironment.trim().toLowerCase();
    if (normalized != 'production' &&
        normalized != 'staging' &&
        normalized != 'new') {
      throw StateError(
        'Unsupported FIREBASE_ENV "$requestedEnvironment". '
        'Use "production", "staging" or "new".',
      );
    }

    final options = _select(normalized, isWeb: isWeb, platform: platform);
    if (normalized == 'new' && !NewProjectFirebaseOptions.isConfigured(options)) {
      throw StateError(
        'FIREBASE_ENV=new is not configured yet: fill the apiKey/appId '
        'placeholders in lib/firebase_options_new.dart '
        '(see docs/PROJECT_MIGRATION.md).',
      );
    }
    return options;
  }

  static FirebaseOptions _select(
    String normalized, {
    required bool isWeb,
    required TargetPlatform platform,
  }) {
    if (isWeb) {
      switch (normalized) {
        case 'staging':
          return StagingFirebaseOptions.web;
        case 'new':
          return NewProjectFirebaseOptions.web;
        default:
          return DefaultFirebaseOptions.web;
      }
    }

    switch (platform) {
      case TargetPlatform.android:
        switch (normalized) {
          case 'staging':
            return StagingFirebaseOptions.android;
          case 'new':
            return NewProjectFirebaseOptions.android;
          default:
            return DefaultFirebaseOptions.android;
        }
      case TargetPlatform.iOS:
        switch (normalized) {
          case 'staging':
            return StagingFirebaseOptions.ios;
          case 'new':
            return NewProjectFirebaseOptions.ios;
          default:
            return DefaultFirebaseOptions.ios;
        }
      case TargetPlatform.macOS:
        if (normalized == 'staging') {
          throw UnsupportedError(
            'Staging Firebase is not configured for macOS.',
          );
        }
        if (normalized == 'new') {
          throw UnsupportedError(
            'The new Firebase project is not configured for macOS.',
          );
        }
        return DefaultFirebaseOptions.macos;
      case TargetPlatform.windows:
      case TargetPlatform.linux:
      case TargetPlatform.fuchsia:
        throw UnsupportedError(
          'Firebase is not configured for ${platform.name}.',
        );
    }
  }
}

/// The OAuth clients Sign in with Google needs on the phone.
class GoogleSignInClientIds {
  const GoogleSignInClientIds({
    required this.iosClientId,
    required this.serverClientId,
  });

  final String iosClientId;
  final String serverClientId;
}

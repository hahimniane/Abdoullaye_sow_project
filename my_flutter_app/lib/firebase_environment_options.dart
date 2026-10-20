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
/// TODO(cutover-apps): the server and web moved to the new project on
/// 2026-10-20, but the mobile apps deliberately STAY on 'production' (the old
/// project, which keeps serving their callables) until a new app build is
/// approved. That build flips this to 'new', swaps the native files
/// (google-services.json, Info.plist URL scheme) and moves `apps` in
/// deploy/project-config.json to "new" - see docs/PROJECT_MIGRATION.md.
abstract final class FirebaseEnvironmentOptions {
  static const String defaultEnvironment = 'production';

  static const String environment = String.fromEnvironment(
    'FIREBASE_ENV',
    defaultValue: defaultEnvironment,
  );

  static FirebaseOptions get currentPlatform => forEnvironment(
    environment,
    isWeb: kIsWeb,
    platform: defaultTargetPlatform,
  );

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

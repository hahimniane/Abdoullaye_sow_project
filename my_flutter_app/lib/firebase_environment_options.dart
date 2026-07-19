import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;

import 'firebase_options.dart';
import 'firebase_options_staging.dart';

abstract final class FirebaseEnvironmentOptions {
  static const String environment = String.fromEnvironment(
    'FIREBASE_ENV',
    defaultValue: 'production',
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
    if (normalized != 'production' && normalized != 'staging') {
      throw StateError(
        'Unsupported FIREBASE_ENV "$requestedEnvironment". '
        'Use "production" or "staging".',
      );
    }

    if (isWeb) {
      return normalized == 'staging'
          ? StagingFirebaseOptions.web
          : DefaultFirebaseOptions.web;
    }

    switch (platform) {
      case TargetPlatform.android:
        return normalized == 'staging'
            ? StagingFirebaseOptions.android
            : DefaultFirebaseOptions.android;
      case TargetPlatform.iOS:
        return normalized == 'staging'
            ? StagingFirebaseOptions.ios
            : DefaultFirebaseOptions.ios;
      case TargetPlatform.macOS:
        if (normalized == 'staging') {
          throw UnsupportedError(
            'Staging Firebase is not configured for macOS.',
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

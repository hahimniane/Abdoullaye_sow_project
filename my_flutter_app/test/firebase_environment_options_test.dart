import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/firebase_environment_options.dart';
import 'package:my_flutter_app/firebase_options.dart';
import 'package:my_flutter_app/firebase_options_new.dart';

void main() {
  test('builds default to production while staging remains opt-in', () {
    expect(FirebaseEnvironmentOptions.environment, 'production');
  });

  test('staging selects the isolated project on every supported client', () {
    for (final platform in <TargetPlatform>[
      TargetPlatform.android,
      TargetPlatform.iOS,
    ]) {
      final options = FirebaseEnvironmentOptions.forEnvironment(
        'staging',
        isWeb: false,
        platform: platform,
      );
      expect(options.projectId, 'laawol-digital-staging');
    }

    final webOptions = FirebaseEnvironmentOptions.forEnvironment(
      'staging',
      isWeb: true,
      platform: TargetPlatform.linux,
    );
    expect(webOptions.projectId, 'laawol-digital-staging');
  });

  test('production remains the default project', () {
    final options = FirebaseEnvironmentOptions.forEnvironment(
      'production',
      isWeb: true,
      platform: TargetPlatform.linux,
    );
    expect(options.projectId, 'car-selling-flutter-app');
  });

  test('the new project is registered but fails closed until configured', () {
    expect(NewProjectFirebaseOptions.projectId, 'laawol-a855a');
    expect(NewProjectFirebaseOptions.projectNumber, '127318353394');
    for (final options in <FirebaseOptions>[
      NewProjectFirebaseOptions.web,
      NewProjectFirebaseOptions.android,
      NewProjectFirebaseOptions.ios,
    ]) {
      expect(options.projectId, 'laawol-a855a');
      expect(options.messagingSenderId, '127318353394');
    }

    final configured = NewProjectFirebaseOptions.isConfigured(
      NewProjectFirebaseOptions.ios,
    );
    if (!configured) {
      expect(
        () => FirebaseEnvironmentOptions.forEnvironment(
          'new',
          isWeb: false,
          platform: TargetPlatform.iOS,
        ),
        throwsStateError,
      );
    }
    // The new project never reuses the current project's keys or app ids.
    expect(
      NewProjectFirebaseOptions.ios.apiKey,
      isNot(DefaultFirebaseOptions.ios.apiKey),
    );
    expect(
      NewProjectFirebaseOptions.ios.appId,
      isNot(DefaultFirebaseOptions.ios.appId),
    );
  });

  test('FIREBASE_ENV=new is never the default', () {
    expect(FirebaseEnvironmentOptions.defaultEnvironment, 'production');
  });

  test('unknown environments fail closed', () {
    expect(
      () => FirebaseEnvironmentOptions.forEnvironment(
        'prodution',
        isWeb: true,
        platform: TargetPlatform.linux,
      ),
      throwsStateError,
    );
  });
}

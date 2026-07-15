import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/firebase_environment_options.dart';

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

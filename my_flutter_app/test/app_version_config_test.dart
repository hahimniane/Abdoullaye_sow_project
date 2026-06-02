import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/app_version_config.dart';

void main() {
  test('uses build numbers for update decisions', () {
    final config = AppVersionConfig.fromMap({
      'latestBuild': {'android': 5},
      'minSupportedBuild': {'android': 2},
      'updateUrl': {'android': 'https://example.com/update'},
      'latestVersionName': '1.0.5',
    });

    final decision = config.evaluate(platformKey: 'android', currentBuild: 3);

    expect(decision.requirement, AppUpdateRequirement.updateAvailable);
    expect(decision.latestBuild, 5);
    expect(decision.minSupportedBuild, 2);
    expect(decision.updateUrl, 'https://example.com/update');
    expect(decision.latestVersionName, '1.0.5');
  });

  test('forces update below minimum supported build', () {
    final config = AppVersionConfig.fromMap({
      'latestBuild': {'android': 5},
      'minSupportedBuild': {'android': 4},
    });

    final decision = config.evaluate(platformKey: 'android', currentBuild: 3);

    expect(decision.requirement, AppUpdateRequirement.forceUpdate);
  });

  test('allows current app when build meets latest build', () {
    final config = AppVersionConfig.fromMap({
      'latestBuild': {'android': 5},
      'minSupportedBuild': {'android': 4},
    });

    final decision = config.evaluate(platformKey: 'android', currentBuild: 5);

    expect(decision.requirement, AppUpdateRequirement.current);
  });

  test('falls back to all platform config', () {
    final config = AppVersionConfig.fromMap({
      'latestBuild': {'all': '8'},
      'minSupportedBuild': {'all': '2'},
      'updateUrl': {'all': 'https://example.com/all'},
    });

    final decision = config.evaluate(platformKey: 'linux', currentBuild: 4);

    expect(decision.requirement, AppUpdateRequirement.updateAvailable);
    expect(decision.updateUrl, 'https://example.com/all');
  });

  test('disabled config never prompts for update', () {
    final config = AppVersionConfig.fromMap({
      'enabled': false,
      'latestBuild': {'android': 99},
      'minSupportedBuild': {'android': 99},
    });

    final decision = config.evaluate(platformKey: 'android', currentBuild: 1);

    expect(decision.requirement, AppUpdateRequirement.current);
  });
}

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('release UI is locked to the light theme', () {
    final mainSource = File('lib/main.dart').readAsStringSync();
    final settingsSource = File(
      'lib/screens/settings_screen.dart',
    ).readAsStringSync();
    final paymentSources = [
      'lib/services/barrel_pool_service.dart',
      'lib/services/barrel_shipment_service.dart',
      'lib/services/car_purchase_service.dart',
      'lib/services/freight_shipment_service.dart',
      'lib/services/parking_service.dart',
    ].map((path) => File(path).readAsStringSync()).join('\n');
    final iosInfo = File('ios/Runner/Info.plist').readAsStringSync();
    final androidNightStyles = [
      'android/app/src/main/res/values-night/styles.xml',
      'android/app/src/main/res/values-night-v31/styles.xml',
    ].map((path) => File(path).readAsStringSync()).join('\n');

    expect(mainSource, contains('themeMode: ThemeMode.light'));
    expect(mainSource, isNot(contains('darkTheme:')));
    expect(settingsSource, isNot(contains('ThemeToggle')));
    expect(settingsSource, isNot(contains('dark_mode_outlined')));
    expect(paymentSources, isNot(contains('ThemeMode.system')));
    expect(paymentSources, contains('style: ThemeMode.light'));
    expect(
      iosInfo,
      contains('<key>UIUserInterfaceStyle</key>\n\t<string>Light</string>'),
    );
    expect(androidNightStyles, isNot(contains('Theme.Black.NoTitleBar')));
    expect(androidNightStyles, contains('Theme.Light.NoTitleBar'));

    final activeSources = Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((file) => file.path.endsWith('.dart'))
        .map((file) => file.readAsStringSync())
        .join('\n');
    expect(activeSources, isNot(contains("'theme_mode'")));
  });
}

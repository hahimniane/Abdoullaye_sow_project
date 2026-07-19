import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/main.dart';

void main() {
  test('Crashlytics is enabled only on supported native platforms', () {
    expect(supportsFirebaseCrashlytics(false, TargetPlatform.android), isTrue);
    expect(supportsFirebaseCrashlytics(false, TargetPlatform.iOS), isTrue);
    expect(supportsFirebaseCrashlytics(false, TargetPlatform.macOS), isTrue);

    expect(supportsFirebaseCrashlytics(true, TargetPlatform.android), isFalse);
    expect(supportsFirebaseCrashlytics(false, TargetPlatform.linux), isFalse);
    expect(supportsFirebaseCrashlytics(false, TargetPlatform.windows), isFalse);
  });
}

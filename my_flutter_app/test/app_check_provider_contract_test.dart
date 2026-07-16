import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final source = File('lib/main.dart').readAsStringSync();

  test('release web App Check uses reCAPTCHA Enterprise only', () {
    expect(
      source,
      matches(
        RegExp(
          r'providerWeb:\s*kDebugMode[\s\S]*?:\s*ReCaptchaEnterpriseProvider\(webSiteKey\.trim\(\)\)',
        ),
      ),
    );
    expect(source, isNot(contains('ReCaptchaV3Provider')));
    expect(
      source,
      contains(
        "'FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY is required for release web builds.'",
      ),
    );
  });

  test('debug builds retain explicit App Check debug providers', () {
    expect(
      source,
      matches(
        RegExp(
          r'providerWeb:\s*kDebugMode\s*\?\s*WebDebugProvider\([\s\S]*?debugToken:\s*debugToken\.trim\(\)\.isEmpty\s*\?\s*null\s*:\s*debugToken\.trim\(\)',
        ),
      ),
    );
    expect(source, contains('? AndroidDebugProvider('));
    expect(source, contains('? AppleDebugProvider('));
    expect(
      source,
      matches(
        RegExp(
          r'if \(!kDebugMode && debugToken\.trim\(\)\.isNotEmpty\)[\s\S]*?must not be set outside debug builds',
        ),
      ),
    );
  });

  test('native release attestation and token refresh remain enabled', () {
    expect(source, contains(': const AndroidPlayIntegrityProvider()'));
    expect(
      source,
      contains(': const AppleAppAttestWithDeviceCheckFallbackProvider()'),
    );
    expect(
      source,
      contains('FirebaseAppCheck.instance.setTokenAutoRefreshEnabled(true)'),
    );
  });
}

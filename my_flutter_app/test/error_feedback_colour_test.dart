import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/theme/app_colors.dart';

/// A failure has to LOOK like a failure.
///
/// `AppColors.brandRed` is an alias for cobalt — it is teal, not red. Error
/// snackbars used it, so every failure rendered in the same colour as a
/// success, and testers reasonably reported "no error appeared" when one had.
void main() {
  test('brandRed is not actually red, so error surfaces must not use it', () {
    // Pin the trap itself: if brandRed ever becomes red this test should be
    // revisited rather than silently passing for the wrong reason.
    expect(AppColors.brandRed, AppColors.cobalt);
    expect(AppColors.errorRed, isNot(AppColors.brandRed));
  });

  test('showErrorSnackBar paints with errorRed', () {
    final source = File('lib/widgets/app_snackbars.dart').readAsStringSync();
    final errorFn = source.substring(source.indexOf('void showErrorSnackBar'));
    expect(errorFn, contains('AppColors.errorRed'));
    expect(errorFn, isNot(contains('AppColors.brandRed')));
  });

  test('success and error snackbars are visually distinguishable', () {
    final source = File('lib/widgets/app_snackbars.dart').readAsStringSync();
    final successFn =
        source.substring(source.indexOf('void showSuccessSnackBar'),
            source.indexOf('void showErrorSnackBar'));
    final errorFn = source.substring(source.indexOf('void showErrorSnackBar'));
    final successColour = RegExp(r'backgroundColor: ([^,]+),')
        .firstMatch(successFn)
        ?.group(1);
    final errorColour =
        RegExp(r'backgroundColor: ([^,]+),').firstMatch(errorFn)?.group(1);
    expect(successColour, isNotNull);
    expect(errorColour, isNotNull);
    expect(successColour, isNot(errorColour));
  });
}

import 'package:cloud_functions/cloud_functions.dart';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/shared_barrel_error.dart';

FirebaseFunctionsException functionsError({
  required String code,
  required String message,
  Object? details,
}) {
  // ignore: invalid_use_of_protected_member
  return FirebaseFunctionsException(
    code: code,
    message: message,
    details: details,
  );
}

void main() {
  group('shared barrel phone verification error classification', () {
    test('recognizes the stable structured reason', () {
      expect(
        isPhoneVerificationRequired(
          functionsError(
            code: 'failed-precondition',
            message: 'Server copy may change',
            details: const {'reason': phoneVerificationRequiredReason},
          ),
        ),
        isTrue,
      );
    });

    test('supports the previous server message without exposing it', () {
      expect(
        isPhoneVerificationRequired(
          functionsError(
            code: 'failed-precondition',
            message: 'Verify your phone number before using shared barrels',
          ),
        ),
        isTrue,
      );
    });

    test('does not misclassify unrelated failures', () {
      expect(
        isPhoneVerificationRequired(
          functionsError(
            code: 'permission-denied',
            message: 'Verify your phone number before using shared barrels',
          ),
        ),
        isFalse,
      );
      expect(isPhoneVerificationRequired(StateError('raw stack')), isFalse);
    });
  });

  test('the shared-barrel screen never renders raw exception text', () {
    final source = File(
      'lib/screens/open_barrels_screen.dart',
    ).readAsStringSync();
    expect(source, isNot(contains('Text(error.toString())')));
    expect(source, isNot(contains('body: snapshot.error.toString()')));
    expect(source, isNot(contains('+ error.toString()')));
  });
}

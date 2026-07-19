import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/phone_verification_status.dart';

void main() {
  group('phone draft verification state', () {
    test('keeps equivalent formatting verified', () {
      expect(
        phoneDraftVerificationState(
          savedPhone: '+1 (718) 555-0100',
          draftPhone: '+17185550100',
          savedPhoneVerified: true,
        ),
        PhoneDraftVerificationState.verified,
      );
    });

    test('marks the saved number unverified when verification is absent', () {
      expect(
        phoneDraftVerificationState(
          savedPhone: '+17185550100',
          draftPhone: '+1 718 555 0100',
          savedPhoneVerified: false,
        ),
        PhoneDraftVerificationState.unverified,
      );
    });

    test('never shows an edited number as verified', () {
      expect(
        phoneDraftVerificationState(
          savedPhone: '+17185550100',
          draftPhone: '+17185550101',
          savedPhoneVerified: true,
        ),
        PhoneDraftVerificationState.edited,
      );
    });
  });
}

import 'phone_number_validator.dart';

enum PhoneDraftVerificationState { verified, unverified, edited }

PhoneDraftVerificationState phoneDraftVerificationState({
  required String? savedPhone,
  required String draftPhone,
  required bool savedPhoneVerified,
}) {
  final saved = PhoneNumberValidator.normalized(savedPhone ?? '');
  final draft = PhoneNumberValidator.normalized(draftPhone);
  if (saved != draft) return PhoneDraftVerificationState.edited;
  return savedPhoneVerified
      ? PhoneDraftVerificationState.verified
      : PhoneDraftVerificationState.unverified;
}

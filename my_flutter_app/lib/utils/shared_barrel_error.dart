import 'package:cloud_functions/cloud_functions.dart';

const phoneVerificationRequiredReason = 'phone-verification-required';

bool isPhoneVerificationRequired(Object error) {
  if (error is! FirebaseFunctionsException ||
      error.code != 'failed-precondition') {
    return false;
  }

  final details = error.details;
  if (details is Map &&
      details['reason']?.toString() == phoneVerificationRequiredReason) {
    return true;
  }

  // Keep a narrow fallback for functions deployed before structured details
  // were added. This is classification only; the server message is never shown.
  return (error.message ?? '').toLowerCase().contains(
    'verify your phone number',
  );
}

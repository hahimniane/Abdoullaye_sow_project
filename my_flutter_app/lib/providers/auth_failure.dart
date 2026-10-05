/// Why a sign-in, password reset or account/profile action was refused.
///
/// AuthProvider throws [AuthFailure] with one of these codes and the screens
/// turn it into localized copy (`authFailureMessage` in
/// `utils/auth_error_text.dart`). The provider used to throw English
/// sentences - and Firebase's own English message for anything it did not
/// list - straight into French snackbars.
enum AuthErrorCode {
  /// Wrong email or password, or no such account at sign-in. One message for
  /// all of them so the form does not reveal which emails have accounts.
  invalidCredentials,
  invalidEmail,
  userDisabled,
  tooManyRequests,
  network,
  weakPassword,
  emailInUse,

  /// Password reset for an email with no account.
  noAccountForEmail,

  /// Email/password sign-in is switched off for the project.
  signInUnavailable,
  signInRequired,
  invalidPhone,
  invalidOwnerPhone,
  invalidBusinessPhone,
  unknown,
}

class AuthFailure implements Exception {
  const AuthFailure(this.code);

  final AuthErrorCode code;

  @override
  String toString() => 'AuthFailure(${code.name})';
}

/// The code for a FirebaseAuthException `code`. Pure, so it is unit-tested.
///
/// `invalid-credential` / `invalid-login-credentials` are what current
/// Firebase returns for a wrong password or unknown email when email
/// enumeration protection is on; they used to fall through to the raw
/// English message.
AuthErrorCode authErrorCodeFor(String firebaseCode) {
  return switch (firebaseCode.trim().toLowerCase()) {
    'user-not-found' ||
    'wrong-password' ||
    'invalid-credential' ||
    'invalid-login-credentials' ||
    'invalid-password' => AuthErrorCode.invalidCredentials,
    'invalid-email' || 'missing-email' => AuthErrorCode.invalidEmail,
    'user-disabled' => AuthErrorCode.userDisabled,
    'too-many-requests' => AuthErrorCode.tooManyRequests,
    'network-request-failed' => AuthErrorCode.network,
    'weak-password' => AuthErrorCode.weakPassword,
    'email-already-in-use' => AuthErrorCode.emailInUse,
    'operation-not-allowed' => AuthErrorCode.signInUnavailable,
    _ => AuthErrorCode.unknown,
  };
}

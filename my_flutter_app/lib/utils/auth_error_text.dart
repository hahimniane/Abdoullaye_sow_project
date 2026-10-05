import 'package:cloud_functions/cloud_functions.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';

/// Localized copy for an [AuthErrorCode].
String authErrorText(AppLocalizations l10n, AuthErrorCode code) {
  return switch (code) {
    AuthErrorCode.invalidCredentials => l10n.invalidCredentials,
    AuthErrorCode.invalidEmail => l10n.pleaseEnterValidEmail,
    AuthErrorCode.userDisabled => l10n.authErrorUserDisabled,
    AuthErrorCode.tooManyRequests => l10n.authErrorTooManyRequests,
    AuthErrorCode.network => l10n.authErrorNetwork,
    AuthErrorCode.weakPassword => l10n.authErrorWeakPassword,
    AuthErrorCode.emailInUse => l10n.authErrorEmailInUse,
    AuthErrorCode.noAccountForEmail => l10n.authErrorNoAccountForEmail,
    AuthErrorCode.signInUnavailable => l10n.authErrorSignInUnavailable,
    AuthErrorCode.signInRequired => l10n.authErrorSignInRequired,
    AuthErrorCode.invalidPhone => l10n.invalidPhoneWithCountryCode,
    AuthErrorCode.invalidOwnerPhone => l10n.authErrorInvalidOwnerPhone,
    AuthErrorCode.invalidBusinessPhone => l10n.authErrorInvalidBusinessPhone,
    AuthErrorCode.unknown => l10n.authErrorUnknown,
  };
}

/// Localized copy for a [SignUpFailureKind].
String signUpFailureText(AppLocalizations l10n, SignUpFailureKind kind) {
  return switch (kind) {
    SignUpFailureKind.phoneAlreadyInUse => l10n.phoneVerificationPhoneInUse,
    SignUpFailureKind.emailAlreadyInUse => l10n.authErrorEmailInUse,
    SignUpFailureKind.rateLimited => l10n.authErrorTooManyRequests,
    _ => l10n.signUpFailedTryAgain,
  };
}

/// What to show for an error thrown by a sign-in, password reset or
/// account/profile action. Codes are localized; anything else reads as the
/// generic message - never as the raw exception text, which is English and
/// sometimes a stack of internals. A callable's own message is kept: it is
/// the server's validation copy, not an exception dump.
String authFailureMessage(AppLocalizations l10n, Object error) {
  if (error is AuthFailure) return authErrorText(l10n, error.code);
  if (error is SignUpFailure) return signUpFailureText(l10n, error.kind);
  if (error is FirebaseFunctionsException) {
    final message = error.message?.trim() ?? '';
    if (message.isNotEmpty) return message;
  }
  return l10n.authErrorUnknown;
}

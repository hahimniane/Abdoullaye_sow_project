import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_failure.dart';
import '../services/phone_accounts.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/auth_error_text.dart' show authErrorText;

/// A phone-account refusal in our words, in the app's language. The one
/// place every `details.reason` of docs/PHONE_ACCOUNTS.md gets its copy.
String phoneAccountRefusalText(
  AppLocalizations l10n,
  PhoneAccountRefusal refusal,
) {
  switch (refusal.reason) {
    case PhoneRefusalReason.phoneInvalid:
      return l10n.phaErrPhoneInvalid;
    case PhoneRefusalReason.needsCountryCode:
      return l10n.phaErrNeedsCountryCode;
    case PhoneRefusalReason.trackingNotFound:
      return l10n.phaErrTrackingNotFound;
    case PhoneRefusalReason.noPhoneOnRecord:
      return l10n.phaErrNoPhoneOnRecord;
    case PhoneRefusalReason.rateLimited:
      return phoneRateLimitText(l10n, refusal.retryAfterSeconds);
    case PhoneRefusalReason.whatsappUnavailable:
      return l10n.phaErrWhatsAppUnavailable;
    case PhoneRefusalReason.signInRequired:
      return l10n.phaErrSignInRequired;
    case PhoneRefusalReason.codeWrong:
      final left = refusal.attemptsLeft;
      return left == null || left <= 0
          ? l10n.phaErrCodeWrong
          : l10n.phaErrCodeWrongTries(left);
    case PhoneRefusalReason.codeExpired:
      return l10n.phaErrCodeExpired;
    case PhoneRefusalReason.tooManyAttempts:
      return l10n.phaErrTooManyAttempts;
    case PhoneRefusalReason.challengeNotFound:
      return l10n.phaErrChallengeNotFound;
    case PhoneRefusalReason.phoneInUse:
      return l10n.phaErrPhoneInUse;
    case PhoneRefusalReason.wrongAccount:
      return l10n.phaErrWrongAccount;
    case PhoneRefusalReason.proofInvalid:
      return l10n.phaErrProofInvalid;
    case PhoneRefusalReason.noVerifiedPhone:
      return l10n.phaErrNoVerifiedPhone;
    case PhoneRefusalReason.recordInvalid:
      return l10n.phaErrRecordInvalid;
  }
  if (refusal.offline) return l10n.phaErrOffline;
  return switch (refusal.code) {
    'unauthenticated' => l10n.phaErrAppCheck,
    'resource-exhausted' => l10n.phaErrRateLimited,
    _ => l10n.phaErrGeneric,
  };
}

/// "Try again in 45 s" / "in 2 minutes"; the plain line when no wait came.
String phoneRateLimitText(AppLocalizations l10n, int seconds) {
  if (seconds <= 0) return l10n.phaErrRateLimited;
  if (seconds < 90) return l10n.phaErrRateLimitedSeconds(seconds);
  return l10n.phaErrRateLimitedMinutes((seconds + 59) ~/ 60);
}

/// Any error a phone-account call threw, in our words.
String phoneAccountErrorText(AppLocalizations l10n, Object error) {
  if (error is PhoneAccountFailure) {
    return phoneAccountRefusalText(l10n, error.refusal);
  }
  if (error is AuthFailure) return authErrorText(l10n, error.code);
  return l10n.phaErrGeneric;
}

/// The words of one tracking-page sign-in button.
String trackingSignInHintLabel(
  AppLocalizations l10n,
  TrackingSignInHint hint, {
  required bool nameTheRole,
}) {
  if (!nameTheRole) return l10n.phaHintSignInAs(hint.lastTwo);
  return hint.role == PhoneRole.receiver
      ? l10n.phaHintSignInAsReceiver(hint.lastTwo)
      : l10n.phaHintSignInAsSender(hint.lastTwo);
}

/// The compact staff warnings beside one of a record's phones: "Add the
/// country code" (the server could not read it as an international
/// number) and "The person says this number isn't theirs" (someone signed
/// in with it pressed "This isn't mine"). Nothing when neither applies.
class RecordPhoneFlagNotes extends StatelessWidget {
  const RecordPhoneFlagNotes({
    super.key,
    required this.flags,
    this.field = '',
    this.dense = false,
    this.who = '',
  });

  final RecordPhoneFlags flags;

  /// "Customer" / "Receiver" when the notes sit away from the number itself
  /// (a list tile showing both people): "Receiver: Add the country code".
  final String who;

  /// Names the keys (`customerPhone` / `receiverPhone`) for tests.
  final String field;

  /// Smaller type for list tiles.
  final bool dense;

  String _withWho(String text) => who.isEmpty ? text : '$who: $text';

  @override
  Widget build(BuildContext context) {
    if (!flags.any) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (flags.needsCountryCode)
          _FlagNote(
            key: ValueKey('phone-flag-country-code:$field'),
            icon: Icons.public_off_outlined,
            text: _withWho(l10n.phaFlagAddCountryCode),
            color: AppColors.warn,
            dense: dense,
          ),
        if (flags.reportedNotMine)
          _FlagNote(
            key: ValueKey('phone-flag-not-mine:$field'),
            icon: Icons.report_gmailerrorred_outlined,
            text: _withWho(l10n.phaFlagReportedNotMine),
            color: AppColors.errorRed,
            dense: dense,
          ),
      ],
    );
  }
}

class _FlagNote extends StatelessWidget {
  const _FlagNote({
    super.key,
    required this.icon,
    required this.text,
    required this.color,
    required this.dense,
  });

  final IconData icon;
  final String text;
  final Color color;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: dense ? 14 : 16, color: color),
          const SizedBox(width: AppSpacing.xs),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: dense ? 12 : 13,
                height: 1.3,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

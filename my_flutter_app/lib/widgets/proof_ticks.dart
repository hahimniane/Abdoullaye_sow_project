import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/container_manifest.dart' show ContainerLine;
import '../services/package_proof.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

/// The three ticks a package shows (docs/AIR_PACKAGES.md §1.11): drop-off
/// photo · sender OK · delivered (a sea package shows only the delivered
/// tick, §7). Compact, with a tooltip each; pure
/// rendering over [ProofTicks], so it is tested without Firebase.
///
/// Colours: grey for "none", amber for "asked", green for done, red for a
/// sender who said something is wrong. A delivery without the pickup code
/// shows amber with its own words.
class PackageProofTicks extends StatelessWidget {
  const PackageProofTicks({
    super.key,
    required this.ticks,
    this.indent = 0,
    this.size = 16,
  });

  /// The line's ticks ([ContainerLine.proofTicks]).
  final ProofTicks ticks;
  final double indent;
  final double size;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final labels = proofTickLabels(l10n, ticks);
    return Padding(
      key: const Key('proof-ticks'),
      padding: EdgeInsets.only(top: 4, left: indent),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (ticks.air) ...[
            _Tick(
              key: const Key('proof-tick-photo'),
              icon: ticks.photo
                  ? Icons.photo_camera
                  : Icons.photo_camera_outlined,
              color: ticks.photo ? AppColors.sage : AppColors.muted,
              label: labels.photo,
              size: size,
            ),
            SizedBox(width: size * 0.6),
            _Tick(
              key: const Key('proof-tick-sender'),
              icon: switch (ticks.senderOk) {
                senderConfirmationConfirmed => Icons.check_circle,
                senderConfirmationProblem => Icons.error,
                senderConfirmationAsked => Icons.schedule,
                _ => Icons.check_circle_outline,
              },
              color: proofSenderTickColor(ticks.senderOk),
              label: labels.sender,
              size: size,
            ),
            SizedBox(width: size * 0.6),
          ],
          _Tick(
            key: const Key('proof-tick-delivered'),
            icon: ticks.delivered
                ? Icons.how_to_reg
                : Icons.how_to_reg_outlined,
            color: !ticks.delivered
                ? AppColors.muted
                : (ticks.deliveredWithoutCode ? AppColors.warn : AppColors.sage),
            label: labels.delivered,
            size: size,
          ),
        ],
      ),
    );
  }
}

/// The colour of the sender tick for a confirmation status.
Color proofSenderTickColor(String status) => switch (status) {
      senderConfirmationConfirmed => AppColors.sage,
      senderConfirmationProblem => AppColors.errorRed,
      senderConfirmationAsked => AppColors.warn,
      _ => AppColors.muted,
    };

/// The words behind each tick (tooltips and semantics).
({String photo, String sender, String delivered}) proofTickLabels(
  AppLocalizations l10n,
  ProofTicks ticks,
) =>
    (
      photo: ticks.photo ? l10n.proofTickPhoto : l10n.proofTickPhotoNone,
      sender: switch (ticks.senderOk) {
        senderConfirmationConfirmed => l10n.proofTickSenderConfirmed,
        senderConfirmationProblem => l10n.proofTickSenderProblem,
        senderConfirmationAsked => l10n.proofTickSenderAsked,
        _ => l10n.proofTickSenderNone,
      },
      delivered: !ticks.delivered
          ? l10n.proofTickNotDelivered
          : (ticks.deliveredWithoutCode
              ? l10n.proofTickDeliveredWithoutCode
              : l10n.proofTickDelivered),
    );

class _Tick extends StatelessWidget {
  const _Tick({
    super.key,
    required this.icon,
    required this.color,
    required this.label,
    required this.size,
  });

  final IconData icon;
  final Color color;
  final String label;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: label,
      triggerMode: TooltipTriggerMode.tap,
      child: Semantics(
        label: label,
        child: Icon(icon, size: size, color: color),
      ),
    );
  }
}

/// The red flag on a package whose sender tapped "Something's wrong" (§1.4):
/// what they said, if anything, and the way to the WhatsApp conversation the
/// server opened with them. Shown on the line's card and on its page;
/// nothing else about the package changes.
class SenderProblemBanner extends StatelessWidget {
  const SenderProblemBanner({
    super.key,
    required this.line,
    this.onOpenConversation,
    this.dense = false,
  });

  final ContainerLine line;

  /// Opens the conversation (`openWhatsAppForLine`); null hides the action.
  final VoidCallback? onOpenConversation;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    if (!line.senderReportedProblem) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final note = line.senderConfirmation.note;
    return Container(
      key: const Key('proof-problem-banner'),
      margin: EdgeInsets.only(top: dense ? 6 : AppSpacing.sm),
      padding: EdgeInsets.all(dense ? AppSpacing.sm : AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.errorRed.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: AppColors.errorRed.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 1),
            child: Icon(Icons.error, size: 16, color: AppColors.errorRed),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.proofProblemBanner,
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.3,
                    fontWeight: FontWeight.w700,
                    color: AppColors.errorRed,
                  ),
                ),
                if (note.isNotEmpty)
                  Text(
                    note,
                    key: const Key('proof-problem-note'),
                    style: const TextStyle(
                      fontSize: 12.5,
                      height: 1.35,
                      color: AppColors.ink,
                    ),
                  ),
                if (onOpenConversation != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      key: const Key('proof-open-conversation'),
                      onPressed: onOpenConversation,
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        minimumSize: const Size(0, 32),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        foregroundColor: AppColors.errorRed,
                      ),
                      icon: const Icon(Icons.chat_outlined, size: 16),
                      label: Text(
                        l10n.proofOpenConversation,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

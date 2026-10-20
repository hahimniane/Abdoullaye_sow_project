import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/staff_invite_service.dart';
import '../services/staff_invites.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import 'app_snackbars.dart';

/// A staff-invitation refusal in our words, in the app's language: the one
/// place every `details.reason` of docs/STAFF_PHONE_INVITES.md gets its copy.
/// Never the server's English message.
String staffInviteRefusalText(
  AppLocalizations l10n,
  StaffInviteFailure failure,
) {
  switch (failure.reason) {
    case StaffInviteReason.fullNameRequired:
      return l10n.stiErrFullName;
    case StaffInviteReason.validPhoneRequired:
      return l10n.stiErrPhone;
    case StaffInviteReason.phoneCountryCodeRequired:
      return l10n.stiErrCountryCode;
    case StaffInviteReason.validEmailRequired:
      return l10n.stiErrEmail;
    case StaffInviteReason.storeAccessInvalid:
      return l10n.stiErrStoreAccess;
    case StaffInviteReason.storeNotFound:
      return l10n.stiErrStoreNotFound;
    case StaffInviteReason.existingAuthorityConflict:
      return l10n.stiErrExistingAuthority;
    case StaffInviteReason.invitationAlreadyPending:
      return l10n.stiErrAlreadyPending;
    case StaffInviteReason.businessOwnerRequired:
      return l10n.stiErrOwnerRequired;
    case StaffInviteReason.businessRequired:
    case StaffInviteReason.businessNotFound:
      return l10n.stiErrBusiness;
    case StaffInviteReason.activeInvitationNotFound:
    case StaffInviteReason.inviteNotFound:
      return l10n.stiErrNotActive;
    case StaffInviteReason.invitationSelectionRequired:
      return l10n.stiErrSelection;
    case StaffInviteReason.invitationExpired:
      return l10n.stiErrExpired;
    case StaffInviteReason.invitationNotPending:
      return l10n.stiErrNotPending;
    case StaffInviteReason.invitationIdentityMismatch:
      return l10n.stiErrIdentity;
    case StaffInviteReason.verifiedEmailRequired:
      return l10n.stiErrVerifiedContact;
  }
  if (failure.offline) return l10n.phaErrOffline;
  return switch (failure.code) {
    'unauthenticated' => l10n.phaErrAppCheck,
    'permission-denied' => l10n.stiErrNotAllowed,
    _ => l10n.phaErrGeneric,
  };
}

/// Any error an invitation call threw, in our words.
String staffInviteErrorText(AppLocalizations l10n, Object error) =>
    error is StaffInviteFailure
    ? staffInviteRefusalText(l10n, error)
    : l10n.phaErrGeneric;

String staffInviteStatusLabel(AppLocalizations l10n, String status) =>
    switch (status) {
      StaffInviteStatus.expired => l10n.stiStatusExpired,
      StaffInviteStatus.cancelled => l10n.stiStatusCancelled,
      StaffInviteStatus.accepted => l10n.stiStatusAccepted,
      _ => l10n.stiStatusPending,
    };

Future<void> copyStaffInviteLink(BuildContext context, String link) async {
  final l10n = AppLocalizations.of(context)!;
  await Clipboard.setData(ClipboardData(text: link));
  if (context.mounted) showSuccessSnackBar(context, l10n.stiLinkCopied);
}

/// "WhatsApp message not sent yet - share this link": the link and a Copy
/// button. Shown after a phone invitation (or a resend) the message did not
/// reach, and on such a row of the invitations list.
class StaffInviteShareNote extends StatelessWidget {
  const StaffInviteShareNote({
    super.key,
    required this.link,
    this.showHelp = true,
  });

  final String link;
  final bool showHelp;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('staff-invite-share'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.warn.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.warn.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.info_outline, size: 18, color: AppColors.warn),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  l10n.stiNotSentTitle,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                    height: 1.3,
                  ),
                ),
              ),
            ],
          ),
          if (showHelp) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              l10n.stiNotSentHelp,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.muted,
                height: 1.35,
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          SelectableText(
            link,
            key: const Key('staff-invite-link'),
            style: const TextStyle(fontSize: 12, color: AppColors.cobaltDeep),
          ),
          const SizedBox(height: AppSpacing.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const Key('staff-invite-copy'),
              onPressed: () => copyStaffInviteLink(context, link),
              icon: const Icon(Icons.copy_rounded, size: 18),
              label: Text(l10n.stiCopyLink),
            ),
          ),
        ],
      ),
    );
  }
}

/// After a resend from a list: the share note in a dialog when WhatsApp did
/// not carry it, a plain confirmation otherwise.
Future<void> showStaffInviteResult(
  BuildContext context,
  StaffInviteResult result, {
  required String sentMessage,
}) async {
  final l10n = AppLocalizations.of(context)!;
  if (!result.needsShare) {
    showSuccessSnackBar(context, sentMessage);
    return;
  }
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      content: SingleChildScrollView(
        child: StaffInviteShareNote(link: result.inviteLink),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: Text(l10n.done),
        ),
      ],
    ),
  );
}

/// The business's outstanding invitations, for the owner's Team panel:
/// name, email or masked number, status, Resend, Cancel, and - for a phone
/// invitation - Copy link, with the not-sent note when WhatsApp did not
/// deliver it.
class BusinessInvitationsSection extends StatefulWidget {
  const BusinessInvitationsSection({
    super.key,
    required this.businessId,
    this.service = const StaffInviteService(),
    this.reloadSignal,
  });

  final String businessId;
  final StaffInviteService service;

  /// Bumped by the parent after an invitation is sent, to read the list again.
  final ValueListenable<int>? reloadSignal;

  @override
  State<BusinessInvitationsSection> createState() =>
      _BusinessInvitationsSectionState();
}

class _BusinessInvitationsSectionState
    extends State<BusinessInvitationsSection> {
  List<BusinessInvitation>? _rows;
  bool _failed = false;
  bool _loading = false;
  final Set<String> _busy = {};
  int _load = 0;

  @override
  void initState() {
    super.initState();
    widget.reloadSignal?.addListener(_reload);
    unawaited(_reload());
  }

  @override
  void didUpdateWidget(BusinessInvitationsSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.reloadSignal != widget.reloadSignal) {
      oldWidget.reloadSignal?.removeListener(_reload);
      widget.reloadSignal?.addListener(_reload);
    }
    if (oldWidget.businessId != widget.businessId) unawaited(_reload());
  }

  @override
  void dispose() {
    widget.reloadSignal?.removeListener(_reload);
    _load++;
    super.dispose();
  }

  Future<void> _reload() async {
    final load = ++_load;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final rows = await widget.service
          .list(widget.businessId)
          .timeout(const Duration(seconds: 20));
      if (!mounted || load != _load) return;
      setState(() {
        _rows = rows;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || load != _load) return;
      setState(() {
        _failed = true;
        _loading = false;
      });
    }
  }

  Future<void> _run(
    BusinessInvitation row,
    Future<void> Function() action,
  ) async {
    if (_busy.contains(row.invitationId)) return;
    setState(() => _busy.add(row.invitationId));
    try {
      await action();
    } catch (error) {
      if (mounted) {
        showErrorSnackBar(
          context,
          staffInviteErrorText(AppLocalizations.of(context)!, error),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(row.invitationId));
    }
  }

  Future<void> _resend(BusinessInvitation row) => _run(row, () async {
    final l10n = AppLocalizations.of(context)!;
    final result = await widget.service.resend(row.invitationId);
    if (!mounted) return;
    setState(() => _busy.remove(row.invitationId));
    await showStaffInviteResult(
      context,
      result,
      sentMessage: result.isPhone && result.whatsappSent
          ? l10n.stiSentOnWhatsApp
          : l10n.invitationResent,
    );
    if (mounted) await _reload();
  });

  Future<void> _cancel(BusinessInvitation row) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.cancelInvitation),
        content: Text(l10n.cancelInvitationConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(backgroundColor: AppColors.errorRed),
            child: Text(l10n.cancelInvitation),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _run(row, () async {
      await widget.service.cancel(row.invitationId);
      if (!mounted) return;
      showSuccessSnackBar(context, l10n.invitationCancelled);
      await _reload();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final rows = (_rows ?? const <BusinessInvitation>[])
        .where((row) => row.status != StaffInviteStatus.accepted)
        .toList();
    return Column(
      key: const Key('business-invitations'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: AppSpacing.md),
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.pendingInvitations,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            if (_loading)
              const SizedBox.square(
                dimension: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.xs),
        if (_failed)
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.stiInvitationsFailed,
                  style: const TextStyle(color: AppColors.muted),
                ),
              ),
              TextButton(
                key: const Key('business-invitations-retry'),
                onPressed: _loading ? null : _reload,
                child: Text(l10n.retry),
              ),
            ],
          )
        else if (_rows != null && rows.isEmpty)
          Text(
            l10n.stiInvitationsEmpty,
            style: const TextStyle(color: AppColors.muted),
          )
        else
          for (final row in rows)
            _InvitationRow(
              key: ValueKey('invitation-${row.invitationId}'),
              row: row,
              busy: _busy.contains(row.invitationId),
              onResend: () => _resend(row),
              onCancel: () => _cancel(row),
            ),
      ],
    );
  }
}

class _InvitationRow extends StatelessWidget {
  const _InvitationRow({
    super.key,
    required this.row,
    required this.busy,
    required this.onResend,
    required this.onCancel,
  });

  final BusinessInvitation row;
  final bool busy;
  final VoidCallback onResend;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final expires = row.expiresAt;
    final details = [
      row.contact,
      staffInviteStatusLabel(l10n, row.status),
      if (expires != null && row.isPending)
        l10n.stiExpiresOn(displayDate(expires, dateLocaleOf(context))),
    ].where((part) => part.trim().isNotEmpty).join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(
                row.isPhone ? Icons.chat_outlined : Icons.mail_outline,
                size: 20,
                color: AppColors.cobalt,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      row.fullName.isEmpty ? row.contact : row.fullName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    Text(
                      details,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (row.whatsappNotSent && row.isPending) ...[
            const SizedBox(height: AppSpacing.sm),
            StaffInviteShareNote(link: row.inviteLink, showHelp: false),
          ],
          Wrap(
            spacing: AppSpacing.xs,
            children: [
              if (row.canResend)
                TextButton.icon(
                  key: Key('invitation-resend-${row.invitationId}'),
                  onPressed: busy ? null : onResend,
                  icon: busy
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh, size: 18),
                  label: Text(l10n.resendInvitation),
                ),
              if (row.isPending)
                TextButton.icon(
                  key: Key('invitation-cancel-${row.invitationId}'),
                  onPressed: busy ? null : onCancel,
                  icon: const Icon(Icons.close, size: 18),
                  label: Text(l10n.cancelInvitation),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.errorRed,
                  ),
                ),
              if (row.isPhone &&
                  row.inviteLink.isNotEmpty &&
                  row.isPending &&
                  !row.whatsappNotSent)
                TextButton.icon(
                  key: Key('invitation-copy-${row.invitationId}'),
                  onPressed: () => copyStaffInviteLink(context, row.inviteLink),
                  icon: const Icon(Icons.copy_rounded, size: 18),
                  label: Text(l10n.stiCopyLink),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// The "Join {business}" prompt after a normal sign-in (§4.1).
// ---------------------------------------------------------------------------

/// The business named by an invitation; a platform invitation is Laawol
/// Digital administration.
String pendingInvitationPlace(AppLocalizations l10n, PendingInvitation invite) {
  if (invite.isPlatform) return l10n.stiPlatformName;
  return invite.businessName.isEmpty ? '—' : invite.businessName;
}

/// Asks, once per sign-in, whether the signed-in person has invitations
/// waiting (`acceptAccessInvitation({action: "pending"})`) and offers each:
/// "Join {business}" or "Not now" (hidden until the next sign-in). Wraps the
/// customer home; does nothing for a session that already has business or
/// platform access, a guest, or while signed out.
class PendingInvitationsHost extends StatefulWidget {
  const PendingInvitationsHost({
    super.key,
    required this.uid,
    required this.eligible,
    required this.child,
    required this.onJoined,
    this.service = const StaffInviteService(),
    this.memory,
  });

  /// The signed-in account; null while signed out.
  final String? uid;

  /// Signed in for real, profile loaded, and no business or platform access.
  final bool eligible;
  final Widget child;

  /// After a Join was accepted: fresh claims, the profile, the staff home.
  final Future<void> Function(PendingInvitation invite) onJoined;
  final StaffInviteService service;
  final PendingInvitationsMemory? memory;

  @override
  State<PendingInvitationsHost> createState() => _PendingInvitationsHostState();
}

class _PendingInvitationsHostState extends State<PendingInvitationsHost> {
  String? _checkedUid;
  bool _showing = false;

  PendingInvitationsMemory get _memory =>
      widget.memory ?? PendingInvitationsMemory.instance;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  @override
  void didUpdateWidget(PendingInvitationsHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.uid == null && oldWidget.uid != null) _memory.forget();
    if (widget.uid != oldWidget.uid || widget.eligible != oldWidget.eligible) {
      _schedule();
    }
  }

  void _schedule() {
    final uid = widget.uid;
    if (uid == null) _checkedUid = null;
    if (uid == null || !widget.eligible || _checkedUid == uid) return;
    _checkedUid = uid;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_offer(uid));
    });
  }

  Future<void> _offer(String uid) async {
    if (_showing) return;
    final all = await _memory.pendingFor(uid, widget.service.pending);
    _showing = true;
    try {
      for (final invite in all) {
        if (!mounted || widget.uid != uid || !widget.eligible) return;
        if (_memory.dismissed.contains(invite.invitationId)) continue;
        final joined = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (_) =>
              PendingInvitationDialog(invite: invite, service: widget.service),
        );
        if (!mounted) return;
        if (joined == true) {
          await widget.onJoined(invite);
          return;
        }
        _memory.dismiss(invite.invitationId);
      }
    } finally {
      _showing = false;
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// One waiting invitation: "{inviter} invited you to join {business} as
/// staff." with "Join {business}" and "Not now". Pops true once accepted.
class PendingInvitationDialog extends StatefulWidget {
  const PendingInvitationDialog({
    super.key,
    required this.invite,
    this.service = const StaffInviteService(),
  });

  final PendingInvitation invite;
  final StaffInviteService service;

  @override
  State<PendingInvitationDialog> createState() =>
      _PendingInvitationDialogState();
}

class _PendingInvitationDialogState extends State<PendingInvitationDialog> {
  bool _joining = false;
  String? _error;

  Future<void> _join() async {
    if (_joining) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _joining = true;
      _error = null;
    });
    try {
      await widget.service.acceptById(widget.invite.invitationId);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _joining = false;
        _error = staffInviteErrorText(l10n, error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final invite = widget.invite;
    final place = pendingInvitationPlace(l10n, invite);
    final onPrimary = Theme.of(context).colorScheme.onPrimary;
    return PopScope(
      canPop: !_joining,
      child: AlertDialog(
        key: const Key('pending-invitation'),
        icon: const Icon(Icons.groups_2_outlined, color: AppColors.cobalt),
        title: Text(l10n.stiPendingTitle),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                invite.invitedByName.isEmpty
                    ? l10n.stiPendingInvitedNoInviter(place)
                    : l10n.stiPendingInvited(invite.invitedByName, place),
                textAlign: TextAlign.center,
                style: const TextStyle(height: 1.4),
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.md),
                Text(
                  _error!,
                  key: const Key('pending-invitation-error'),
                  style: const TextStyle(
                    color: AppColors.errorRed,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              const SizedBox(height: AppSpacing.lg),
              FilledButton(
                key: const Key('pending-invitation-join'),
                onPressed: _joining ? null : _join,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_joining) ...[
                      SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: onPrimary,
                        ),
                      ),
                      const SizedBox(width: 10),
                    ],
                    Flexible(
                      child: Text(
                        _joining ? l10n.stiAccepting : l10n.stiJoin(place),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              TextButton(
                key: const Key('pending-invitation-not-now'),
                onPressed: _joining
                    ? null
                    : () => Navigator.of(context).pop(false),
                child: Text(l10n.stiNotNow),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/phone_accounts.dart';
import '../services/staff_invite_service.dart';
import '../services/staff_invites.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/auth_navigation.dart';
import '../utils/date_display.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/staff_invite_widgets.dart';
import 'phone_sign_in_screen.dart';

/// What the invitation screen asks of the account, behind one interface so
/// it is widget-tested with a fake (the real one is [AuthStaffInviteClient]).
abstract interface class StaffInviteClient {
  /// `phoneAccount {action: "staffInvite", token}`; no sign-in needed.
  Future<StaffInvitePreview> preview(String token);

  /// Who is signed in now.
  StaffInviteViewer get viewer;

  /// `acceptAccessInvitation({inviteToken})`, then fresh claims and the
  /// profile again, so the staff screens open.
  Future<void> accept(String token);

  Future<void> signOut();

  bool get hasBusinessDashboardAccess;
}

class AuthStaffInviteClient implements StaffInviteClient {
  const AuthStaffInviteClient(
    this.auth, {
    this.service = const StaffInviteService(),
  });

  final AuthProvider auth;
  final StaffInviteService service;

  @override
  Future<StaffInvitePreview> preview(String token) => service.preview(token);

  @override
  StaffInviteViewer get viewer {
    final user = auth.user;
    if (user == null) return StaffInviteViewer.signedOut;
    return StaffInviteViewer(
      signedIn: true,
      anonymous: user.isAnonymous,
      phoneNumber: auth.linkedPhoneNumber ?? user.phoneNumber ?? '',
    );
  }

  @override
  Future<void> accept(String token) async {
    await service.accept(token);
    await auth.reloadAfterInvitationAccepted();
  }

  @override
  Future<void> signOut() => auth.logout();

  @override
  bool get hasBusinessDashboardAccess => auth.hasBusinessDashboardAccess;
}

/// A staff invitation link (`https://customer.laawoldigital.com/j/<token>`,
/// docs/STAFF_PHONE_INVITES.md §6): "{inviter} invited you to join
/// {business} on Laawol as staff." Signed out: "Accept with the number
/// ending in ••35" (the masked WhatsApp code; text asks for the full
/// number), then the invitation is accepted. Signed in with that number:
/// "Accept invitation". Another account: "Sign out to continue". Expired,
/// cancelled, accepted or unknown: ask the business for a new invitation.
class StaffInviteScreen extends StatefulWidget {
  const StaffInviteScreen({
    super.key,
    required this.token,
    this.client,
    this.phoneSignInClient,
    this.onAccepted,
  });

  final String token;
  final StaffInviteClient? client;
  final PhoneSignInClient? phoneSignInClient;

  /// Where an accepted invitation lands; by default the staff home (by role,
  /// as after any sign-in).
  final void Function(BuildContext context, StaffInvitePreview preview)?
  onAccepted;

  @override
  State<StaffInviteScreen> createState() => _StaffInviteScreenState();
}

enum _Load { loading, ready, notFound, failed }

class _StaffInviteScreenState extends State<StaffInviteScreen> {
  StaffInviteClient? _providerClient;
  _Load _load = _Load.loading;
  StaffInvitePreview? _preview;
  bool _accepting = false;
  bool _signingIn = false;
  bool _signingOut = false;
  String? _error;
  int _loadAttempt = 0;

  StaffInviteClient get _client =>
      widget.client ??
      (_providerClient ??= AuthStaffInviteClient(context.read<AuthProvider>()));

  bool get _busy => _accepting || _signingIn || _signingOut;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_loadPreview());
    });
  }

  @override
  void dispose() {
    _loadAttempt++;
    super.dispose();
  }

  Future<void> _loadPreview() async {
    final attempt = ++_loadAttempt;
    setState(() {
      _load = _Load.loading;
      _error = null;
    });
    try {
      final preview = await _client
          .preview(widget.token)
          .timeout(const Duration(seconds: 20));
      if (!mounted || attempt != _loadAttempt) return;
      setState(() {
        _preview = preview;
        _load = _Load.ready;
      });
    } on StaffInviteFailure catch (failure) {
      if (!mounted || attempt != _loadAttempt) return;
      setState(
        () => _load = failure.reason == StaffInviteReason.inviteNotFound
            ? _Load.notFound
            : _Load.failed,
      );
    } catch (_) {
      if (!mounted || attempt != _loadAttempt) return;
      setState(() => _load = _Load.failed);
    }
  }

  /// "Accept with the number ending in ••35": the phone sign-in in its
  /// masked mode, then the acceptance.
  Future<void> _signInAndAccept(StaffInvitePreview preview) async {
    if (_busy) return;
    setState(() {
      _signingIn = true;
      _error = null;
    });
    PhoneSignInOutcome? outcome;
    try {
      outcome = await Navigator.of(context).push<PhoneSignInOutcome>(
        MaterialPageRoute(
          builder: (_) => PhoneSignInScreen(
            request: InvitePhoneCodeRequest(
              inviteToken: widget.token,
              lastTwo: preview.phoneLastTwo,
            ),
            client: widget.phoneSignInClient,
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _signingIn = false);
    }
    if (!mounted || outcome == null || !outcome.signedIn) return;
    await _accept(preview);
  }

  Future<void> _accept(StaffInvitePreview preview) async {
    if (_accepting || _signingOut) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _accepting = true;
      _error = null;
    });
    try {
      await _client.accept(widget.token);
      if (!mounted) return;
      setState(() => _accepting = false);
      final onAccepted = widget.onAccepted;
      if (onAccepted != null) {
        onAccepted(context, preview);
        return;
      }
      if (preview.businessName.isNotEmpty) {
        showSuccessSnackBar(context, l10n.stiWelcome(preview.businessName));
      }
      unawaited(
        navigateAfterLogin<void>(
          context,
          hasBusinessDashboardAccess: _client.hasBusinessDashboardAccess,
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _accepting = false;
        _error = staffInviteErrorText(l10n, error);
      });
      // The invitation itself changed (expired, cancelled, used): show it.
      if (error is StaffInviteFailure &&
          const {
            StaffInviteReason.activeInvitationNotFound,
            StaffInviteReason.invitationExpired,
            StaffInviteReason.invitationNotPending,
          }.contains(error.reason)) {
        final message = _error;
        await _loadPreview();
        if (mounted) setState(() => _error = message);
      }
    }
  }

  Future<void> _signOut() async {
    if (_busy) return;
    setState(() {
      _signingOut = true;
      _error = null;
    });
    try {
      await _client.signOut();
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = staffInviteErrorText(
            AppLocalizations.of(context)!,
            error,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _signingOut = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return PopScope(
      canPop: !_accepting,
      child: Scaffold(
        backgroundColor: AppColors.lightBg,
        appBar: AppBar(
          leading: _accepting
              ? const IconButton(
                  onPressed: null,
                  icon: Icon(Icons.arrow_back_ios_new, size: 22),
                )
              : const AppBackButton(),
          title: Text(l10n.stiScreenTitle),
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 480),
                  child: _body(l10n),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(AppLocalizations l10n) {
    switch (_load) {
      case _Load.loading:
        return const Padding(
          padding: EdgeInsets.only(top: 48),
          child: Center(
            child: CircularProgressIndicator(key: Key('staff-invite-loading')),
          ),
        );
      case _Load.notFound:
        return _message(
          key: const Key('staff-invite-closed'),
          icon: Icons.link_off,
          text: l10n.stiErrNotActive,
        );
      case _Load.failed:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _message(
              key: const Key('staff-invite-failed'),
              icon: Icons.cloud_off_outlined,
              text: l10n.stiLoadFailed,
            ),
            const SizedBox(height: AppSpacing.lg),
            OutlinedButton(
              key: const Key('staff-invite-retry'),
              onPressed: _loadPreview,
              child: Text(l10n.retry),
            ),
          ],
        );
      case _Load.ready:
        return _invitation(l10n, _preview!);
    }
  }

  Widget _message({
    required Key key,
    required IconData icon,
    required String text,
  }) {
    return Column(
      key: key,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: AppSpacing.xl),
        Icon(icon, size: 44, color: AppColors.muted),
        const SizedBox(height: AppSpacing.md),
        Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 16, height: 1.4),
        ),
      ],
    );
  }

  String _closedText(AppLocalizations l10n, String status) => switch (status) {
    StaffInviteStatus.cancelled => l10n.stiClosedCancelled,
    StaffInviteStatus.accepted => l10n.stiClosedAccepted,
    _ => l10n.stiClosedExpired,
  };

  Widget _progressLabel(String label, {required bool loading, Color? color}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (loading) ...[
          SizedBox.square(
            dimension: 18,
            child: CircularProgressIndicator(strokeWidth: 2, color: color),
          ),
          const SizedBox(width: 10),
        ],
        Flexible(child: Text(label, textAlign: TextAlign.center)),
      ],
    );
  }

  Widget _invitation(AppLocalizations l10n, StaffInvitePreview preview) {
    final view = staffInviteView(preview, _client.viewer);
    final onPrimary = Theme.of(context).colorScheme.onPrimary;
    final business = preview.businessName.isEmpty ? '—' : preview.businessName;
    final headline = preview.invitedByName.isEmpty
        ? l10n.stiInvitedYouNoInviter(business)
        : l10n.stiInvitedYou(preview.invitedByName, business);
    final expires = preview.expiresAtMs > 0
        ? DateTime.fromMillisecondsSinceEpoch(preview.expiresAtMs)
        : null;
    return Column(
      key: Key('staff-invite-${view.name}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.groups_2_outlined, size: 48, color: AppColors.cobalt),
        const SizedBox(height: AppSpacing.md),
        Text(
          headline,
          key: const Key('staff-invite-headline'),
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w800,
            height: 1.35,
          ),
        ),
        if (view != StaffInviteView.closed && expires != null) ...[
          const SizedBox(height: AppSpacing.sm),
          Text(
            l10n.stiExpiresOn(displayDate(expires, dateLocaleOf(context))),
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted),
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        if (view == StaffInviteView.closed)
          Text(
            _closedText(l10n, preview.status),
            key: const Key('staff-invite-closed'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, height: 1.4),
          ),
        if (view == StaffInviteView.otherAccount)
          Text(
            l10n.stiOtherAccount(preview.phoneLastTwo),
            key: const Key('staff-invite-other-account'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, height: 1.4),
          ),
        if (_error != null) ...[
          const SizedBox(height: AppSpacing.md),
          Semantics(
            liveRegion: true,
            child: Container(
              key: const Key('staff-invite-error'),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.errorRed.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              ),
              child: Text(
                _error!,
                style: const TextStyle(
                  color: AppColors.errorRed,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        if (view == StaffInviteView.signInToAccept) ...[
          SizedBox(
            height: 52,
            child: FilledButton(
              key: const Key('staff-invite-primary'),
              onPressed: _busy ? null : () => _signInAndAccept(preview),
              child: _progressLabel(
                _accepting
                    ? l10n.stiAccepting
                    : l10n.stiAcceptWithNumber(preview.phoneLastTwo),
                loading: _busy,
                color: onPrimary,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            l10n.stiAcceptWithNumberHelp,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted, fontSize: 13),
          ),
        ],
        if (view == StaffInviteView.acceptAsSignedIn)
          SizedBox(
            height: 52,
            child: FilledButton(
              key: const Key('staff-invite-primary'),
              onPressed: _busy ? null : () => _accept(preview),
              child: _progressLabel(
                _accepting ? l10n.stiAccepting : l10n.stiAccept,
                loading: _accepting,
                color: onPrimary,
              ),
            ),
          ),
        if (view == StaffInviteView.otherAccount)
          SizedBox(
            height: 52,
            child: FilledButton(
              key: const Key('staff-invite-primary'),
              onPressed: _busy ? null : _signOut,
              child: _progressLabel(
                _signingOut ? l10n.stiSigningOut : l10n.stiSignOutToContinue,
                loading: _signingOut,
                color: onPrimary,
              ),
            ),
          ),
      ],
    );
  }
}

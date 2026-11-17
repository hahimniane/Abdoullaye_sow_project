import 'dart:async';

import 'package:file_selector/file_selector.dart' show XTypeGroup, openFile;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/getting_paid.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/async_action_button.dart';
import '../widgets/inventory_widgets.dart';

/// Opens [uri] outside the app. False when nothing opened.
typedef GettingPaidOpener = Future<bool> Function(Uri uri);

/// Lets the person choose a document; null when they cancel.
typedef VerificationPicker = Future<ChosenFile?> Function();

Future<bool> _openExternally(Uri uri) =>
    launchUrl(uri, mode: LaunchMode.externalApplication);

Future<ChosenFile?> _pickDocument() async {
  final file = await openFile(
    acceptedTypeGroups: [
      XTypeGroup(label: 'documents', extensions: verificationExtensions),
    ],
  );
  if (file == null) return null;
  return ChosenFile(
    name: file.name,
    mimeType: file.mimeType,
    read: file.readAsBytes,
  );
}

/// The Stripe-requirements and document words.
String verificationLabel(AppLocalizations l10n, String id) => switch (id) {
  'shippingAuthority' => l10n.ownDocShippingAuthority,
  'dealerLicense' => l10n.ownDocDealerLicense,
  'parkingFacilityProof' => l10n.ownDocParkingProof,
  'transportInsurance' => l10n.ownDocTransportInsurance,
  _ => id,
};

String verificationDescription(AppLocalizations l10n, String id) =>
    switch (id) {
      'shippingAuthority' => l10n.ownDocShippingAuthorityNote,
      'dealerLicense' => l10n.ownDocDealerLicenseNote,
      'parkingFacilityProof' => l10n.ownDocParkingProofNote,
      'transportInsurance' => l10n.ownDocTransportInsuranceNote,
      _ => '',
    };

String verificationStatusLabel(AppLocalizations l10n, VerificationStatus s) =>
    switch (s) {
      VerificationStatus.missing => l10n.ownDocStatusMissing,
      VerificationStatus.submitted => l10n.ownDocStatusSubmitted,
      VerificationStatus.verified => l10n.ownDocStatusVerified,
      VerificationStatus.needsChanges => l10n.ownDocStatusNeedsChanges,
      VerificationStatus.notApplicable => l10n.ownDocStatusNotNeeded,
    };

Color _statusColor(VerificationStatus s) => switch (s) {
  VerificationStatus.verified ||
  VerificationStatus.notApplicable => AppColors.sage,
  VerificationStatus.submitted => AppColors.cobalt,
  VerificationStatus.missing ||
  VerificationStatus.needsChanges => AppColors.warn,
};

/// The entry on the business profile. Stripe setup belongs to the business's
/// real owner only: a full-access staff member never sees it.
class GettingPaidEntryRow extends StatelessWidget {
  const GettingPaidEntryRow({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final businessId = (auth.businessId ?? '').trim();
    if (businessId.isEmpty || !auth.isRealBusinessOwner) {
      return const SizedBox.shrink();
    }
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Card(
        margin: EdgeInsets.zero,
        child: ListTile(
          key: const Key('open-getting-paid'),
          leading: const Icon(Icons.account_balance_outlined),
          title: Text(l10n.ownPayTitle),
          subtitle: Text(l10n.ownPayEntrySubtitle),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) =>
                  GettingPaidScreen(businessId: businessId, isRealOwner: true),
            ),
          ),
        ),
      ),
    );
  }
}

/// "Getting paid": the Stripe payout status with "Start / Continue in Stripe"
/// and "Refresh status", the fees as read-only facts, and the verification
/// documents with their status and the reviewer's note (the website's
/// Payouts panel and Verification documents). Only the business's real owner
/// sets up Stripe: [isRealOwner] false shows a plain note and no action.
class GettingPaidScreen extends StatefulWidget {
  const GettingPaidScreen({
    super.key,
    required this.businessId,
    required this.isRealOwner,
    this.service,
    this.source = const FirestoreBusinessDocSource(),
    this.opener = _openExternally,
    this.picker = _pickDocument,
  });

  final String businessId;
  final bool isRealOwner;
  final GettingPaidService? service;
  final BusinessDocSource source;
  final GettingPaidOpener opener;
  final VerificationPicker picker;

  @override
  State<GettingPaidScreen> createState() => _GettingPaidScreenState();
}

class _GettingPaidScreenState extends State<GettingPaidScreen>
    with WidgetsBindingObserver {
  late final GettingPaidService _service =
      widget.service ?? GettingPaidService();
  StreamSubscription<Map<String, Object?>?>? _sub;
  Timer? _safety;
  Map<String, Object?>? _business;
  bool _loaded = false;
  bool _failed = false;
  bool _missing = false;

  BusinessFeeSettings? _fees;
  bool _feesFailed = false;

  /// '' / 'link' / 'refresh' / 'auto': what is running with Stripe now.
  String _busy = '';
  bool _autoCheckFailed = false;
  String _autoCheckedFor = '';
  DateTime? _lastAuto;

  final Map<String, PickedDocument> _picked = {};
  String _uploading = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _watch();
    unawaited(_loadFees());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sub?.cancel();
    _safety?.cancel();
    super.dispose();
  }

  /// Loading always resolves: the first answer, an error, or silence past 15 s.
  void _watch() {
    _safety?.cancel();
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_loaded) setState(() => _failed = true);
    });
    _sub?.cancel();
    setState(() {
      _failed = false;
      _loaded = false;
    });
    _sub = widget.source
        .watch(widget.businessId)
        .listen(
          (data) {
            if (!mounted) return;
            _safety?.cancel();
            setState(() {
              _loaded = true;
              _failed = false;
              _missing = data == null;
              _business = data;
            });
            _maybeAutoCheck();
          },
          onError: (_) {
            if (!mounted) return;
            _safety?.cancel();
            setState(() => _failed = true);
          },
        );
  }

  Future<void> _loadFees() async {
    if (!widget.isRealOwner) return;
    try {
      final fees = await _service.feeSettings(widget.businessId);
      if (mounted) setState(() => _fees = fees);
    } catch (_) {
      if (mounted) setState(() => _feesFailed = true);
    }
  }

  PayoutStatus get _status => resolvePayoutStatus(_business ?? const {});

  /// Stripe is finished on Stripe's own site, so the answer arrives while the
  /// app is in the background: check once per account when it is pending...
  void _maybeAutoCheck() {
    if (!widget.isRealOwner) return;
    final status = _status;
    if (status.state != PayoutState.pending ||
        _autoCheckedFor == status.stripeAccountId) {
      return;
    }
    _autoCheckedFor = status.stripeAccountId;
    unawaited(_refresh(silent: true));
  }

  /// ...and again whenever the person comes back to the app.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed ||
        !widget.isRealOwner ||
        !_loaded ||
        _status.ready) {
      return;
    }
    final now = DateTime.now();
    if (_lastAuto != null &&
        now.difference(_lastAuto!) < const Duration(seconds: 10)) {
      return;
    }
    unawaited(_refresh(silent: true));
  }

  Future<void> _refresh({bool silent = false}) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    _lastAuto = DateTime.now();
    setState(() {
      _busy = silent ? 'auto' : 'refresh';
      if (!silent) _autoCheckFailed = false;
    });
    try {
      await _service.refreshStatus(widget.businessId);
      if (!mounted) return;
      setState(() => _autoCheckFailed = false);
      if (!silent) showSuccessSnackBar(context, l10n.ownPayRefreshed);
    } on GettingPaidFailure catch (failure) {
      if (!mounted) return;
      if (silent) {
        // A swallowed failure looks like "Stripe still says no".
        setState(() => _autoCheckFailed = true);
      } else {
        AppHaptics.refuse();
        showErrorSnackBar(
          context,
          failure.offline ? l10n.myCardOffline : l10n.ownPayRefreshFailed,
        );
      }
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _openStripe() async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = 'link');
    try {
      final uri = await _service.setupLink(widget.businessId);
      final opened = await widget.opener(uri);
      if (!opened && mounted) {
        showErrorSnackBar(context, l10n.ownPayOpenFailed);
      }
    } on GettingPaidFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(
        context,
        failure.offline ? l10n.myCardOffline : l10n.ownPayLinkFailed,
      );
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.ownPayOpenFailed);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _openDocument(String url) async {
    final l10n = AppLocalizations.of(context)!;
    final uri = Uri.tryParse(url);
    if (uri == null || uri.scheme != 'https') return;
    try {
      final opened = await widget.opener(uri);
      if (!opened && mounted) {
        showErrorSnackBar(context, l10n.ownPayOpenFailed);
      }
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.ownPayOpenFailed);
    }
  }

  Future<void> _choose(String id) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      final file = await widget.picker();
      if (file == null || !mounted) return;
      final bytes = await file.read();
      final problem = verificationFileProblem(
        file.name,
        file.mimeType,
        bytes.length,
      );
      if (!mounted) return;
      if (problem.isNotEmpty) {
        AppHaptics.refuse();
        showErrorSnackBar(context, switch (problem) {
          'type' => l10n.ownDocBadType,
          'empty' => l10n.ownDocEmpty,
          _ => l10n.ownDocTooBig,
        });
        return;
      }
      setState(
        () => _picked[id] = PickedDocument(
          name: file.name,
          bytes: bytes,
          contentType: verificationContentType(file.name, file.mimeType)!,
        ),
      );
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.ownDocPickFailed);
    }
  }

  Future<void> _upload(String id) async {
    final file = _picked[id];
    if (file == null || _uploading.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _uploading = id);
    try {
      await _service.uploadDocument(
        businessId: widget.businessId,
        documentId: id,
        file: file,
      );
      if (!mounted) return;
      AppHaptics.commit();
      setState(() => _picked.remove(id));
      showSuccessSnackBar(context, l10n.ownDocDone);
    } on GettingPaidFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(
        context,
        failure.offline
            ? l10n.myCardOffline
            : failure.permission
            ? l10n.ownDocNotAllowed
            : l10n.ownDocFailed,
      );
    } finally {
      if (mounted) setState(() => _uploading = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      key: const Key('getting-paid-page'),
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.ownPayTitle),
          Expanded(child: _body(l10n)),
        ],
      ),
    );
  }

  Widget _body(AppLocalizations l10n) {
    final padding = const EdgeInsets.fromLTRB(
      AppSpacing.lg,
      AppSpacing.lg,
      AppSpacing.lg,
      AppSpacing.xl,
    );
    if (!widget.isRealOwner) {
      return ListView(
        padding: padding,
        children: [
          InventoryNote(
            key: const Key('getting-paid-owner-only'),
            text: l10n.ownPayOwnerOnly,
            error: false,
          ),
        ],
      );
    }
    if (!_loaded) {
      return ListView(
        padding: padding,
        children: [
          if (_failed)
            InventoryNote(
              key: const Key('getting-paid-error'),
              text: l10n.ownPayLoadFailed,
              trailing: TextButton(
                key: const Key('getting-paid-retry'),
                onPressed: _watch,
                child: Text(l10n.retry),
              ),
            )
          else
            const Padding(
              key: Key('getting-paid-loading'),
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(child: CircularProgressIndicator()),
            ),
        ],
      );
    }
    if (_missing) {
      return ListView(
        padding: padding,
        children: [InventoryNote(text: l10n.businessProfileNotFound)],
      );
    }
    final business = _business ?? const <String, Object?>{};
    final items = buildVerificationChecklist(business);
    return ListView(
      padding: padding,
      children: [
        _payoutCard(l10n),
        const SizedBox(height: AppSpacing.lg),
        _feesCard(l10n),
        const SizedBox(height: AppSpacing.lg),
        _documentsCard(l10n, business, items),
      ],
    );
  }

  Widget _card({required Key key, required List<Widget> children}) => Container(
    key: key,
    width: double.infinity,
    padding: const EdgeInsets.all(AppSpacing.lg),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
      border: Border.all(color: AppColors.rule),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );

  Widget _title(String text) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
      ),
    ),
  );

  Widget _pill(String text, Color color, {Key? key}) => Container(
    key: key,
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      border: Border.all(color: color.withValues(alpha: 0.35)),
    ),
    child: Text(
      text,
      style: TextStyle(
        fontSize: 12.5,
        fontWeight: FontWeight.w600,
        color: color,
      ),
    ),
  );

  Widget _muted(String text, {Key? key}) => Text(
    text,
    key: key,
    style: const TextStyle(fontSize: 12.5, height: 1.4, color: AppColors.muted),
  );

  Widget _payoutCard(AppLocalizations l10n) {
    final s = _status;
    final working = _busy.isNotEmpty;
    final statusText = switch (s.state) {
      PayoutState.ready => l10n.ownPayStatusReady,
      PayoutState.pending => l10n.ownPayStatusPending,
      PayoutState.notConnected => l10n.ownPayStatusNone,
    };
    return _card(
      key: const Key('getting-paid-payouts'),
      children: [
        _title(l10n.ownPayPayoutsTitle),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            _pill(
              statusText,
              s.ready ? AppColors.sage : AppColors.warn,
              key: const Key('getting-paid-status'),
            ),
            _pill(
              s.chargesEnabled ? l10n.ownPayChargesOn : l10n.ownPayChargesOff,
              s.chargesEnabled ? AppColors.sage : AppColors.warn,
            ),
          ],
        ),
        if (s.hasAccount) ...[
          const SizedBox(height: AppSpacing.sm),
          _muted(
            l10n.ownPayAccount(s.stripeAccountId),
            key: const Key('getting-paid-account'),
          ),
        ],
        if (s.currentlyDue > 0 || s.pendingVerification > 0) ...[
          const SizedBox(height: 4),
          if (s.currentlyDue > 0)
            _muted(
              l10n.ownPayDue(s.currentlyDue),
              key: const Key('getting-paid-due'),
            ),
          if (s.pendingVerification > 0)
            _muted(l10n.ownPayPendingStripe(s.pendingVerification)),
        ],
        if (!s.ready) ...[
          const SizedBox(height: AppSpacing.sm),
          _muted(
            s.state == PayoutState.pending
                ? l10n.ownPayHelpPending
                : l10n.ownPayHelpNone,
          ),
        ],
        if (_autoCheckFailed && !s.ready) ...[
          const SizedBox(height: AppSpacing.sm),
          InventoryNote(
            key: const Key('getting-paid-auto-failed'),
            text: l10n.ownPayAutoFailed,
            error: false,
          ),
        ],
        const SizedBox(height: AppSpacing.md),
        if (!s.ready)
          AsyncActionButton.filled(
            key: const Key('getting-paid-stripe'),
            icon: Icons.open_in_new,
            label: s.state == PayoutState.pending
                ? l10n.ownPayContinue
                : l10n.ownPayStart,
            loadingLabel: l10n.ownPayOpening,
            onPressed: working ? null : _openStripe,
          ),
        if (!s.ready) const SizedBox(height: AppSpacing.sm),
        AsyncActionButton.outlined(
          key: const Key('getting-paid-refresh'),
          icon: Icons.refresh,
          label: l10n.ownPayRefresh,
          loadingLabel: l10n.ownPayChecking,
          onPressed: working ? null : () => _refresh(),
        ),
        if (s.state == PayoutState.pending) ...[
          const SizedBox(height: AppSpacing.md),
          _muted(l10n.ownPayNoUpload),
        ],
      ],
    );
  }

  Widget _feesCard(AppLocalizations l10n) {
    final fees = _fees;
    return _card(
      key: const Key('getting-paid-fees'),
      children: [
        _title(l10n.ownPayFeesTitle),
        if (fees == null && !_feesFailed)
          const Padding(
            padding: EdgeInsets.all(AppSpacing.sm),
            child: Center(
              child: SizedBox.square(
                dimension: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          )
        else if (fees == null)
          Text(
            l10n.ownPayFeesFailed,
            key: const Key('getting-paid-fees-failed'),
            style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
          )
        else ...[
          _factRow(l10n.ownPayPlatformFee, fees.platformFeeText),
          const SizedBox(height: 4),
          fees.hasBusinessOverride
              ? Align(
                  alignment: Alignment.centerLeft,
                  child: _pill(l10n.ownPayCustomRate, AppColors.cobalt),
                )
              : _muted(l10n.ownPayDefaultRate),
          const SizedBox(height: AppSpacing.sm),
          _factRow(
            l10n.ownPayProcessingWho,
            fees.businessPaysProcessing ? l10n.ownPayYou : l10n.ownPayLaawol,
          ),
          if (fees.processingNotYetActive) ...[
            const SizedBox(height: AppSpacing.sm),
            InventoryNote(
              key: const Key('getting-paid-fee-note'),
              text: l10n.ownPayProcessingPending,
              error: false,
            ),
          ],
        ],
      ],
    );
  }

  Widget _factRow(String label, String value) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(
        child: Text(
          label,
          style: const TextStyle(fontSize: 13.5, color: AppColors.ink),
        ),
      ),
      const SizedBox(width: AppSpacing.sm),
      Text(
        value,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w700,
          color: AppColors.ink,
        ),
      ),
    ],
  );

  Widget _documentsCard(
    AppLocalizations l10n,
    Map<String, Object?> business,
    List<VerificationItem> items,
  ) {
    final summary = summarizeVerification(items);
    final note = verificationReviewNote(business);
    return _card(
      key: const Key('getting-paid-documents'),
      children: [
        Row(
          children: [
            Expanded(child: _title(l10n.ownDocTitle)),
            _pill(
              l10n.ownDocComplete(summary.complete, summary.total),
              summary.approvalReady ? AppColors.sage : AppColors.warn,
              key: const Key('getting-paid-doc-count'),
            ),
          ],
        ),
        _muted(summary.approvalReady ? l10n.ownDocReady : l10n.ownDocIntro),
        if (note.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.sm),
          InventoryNote(
            key: const Key('getting-paid-review-note'),
            text: l10n.ownDocAdminNote(note),
            error: false,
          ),
        ],
        const SizedBox(height: AppSpacing.md),
        if (items.isEmpty)
          Text(
            l10n.ownDocNone,
            key: const Key('getting-paid-no-docs'),
            style: const TextStyle(fontSize: 13.5, color: AppColors.muted),
          ),
        for (final item in items) _documentRow(l10n, item),
      ],
    );
  }

  Widget _documentRow(AppLocalizations l10n, VerificationItem item) {
    final picked = _picked[item.id];
    final uploading = _uploading == item.id;
    final color = _statusColor(item.status);
    final waived = item.status == VerificationStatus.notApplicable;
    return Container(
      key: Key('doc-${item.id}'),
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.parchment,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  verificationLabel(l10n, item.id),
                  style: const TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              _pill(
                verificationStatusLabel(l10n, item.status),
                color,
                key: Key('doc-status-${item.id}'),
              ),
            ],
          ),
          const SizedBox(height: 4),
          _muted(verificationDescription(l10n, item.id)),
          if (waived)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: _muted(l10n.ownDocWaived),
            ),
          if (item.reviewNote.isNotEmpty && !waived)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              child: InventoryNote(
                key: Key('doc-note-${item.id}'),
                text: l10n.ownDocAdminRequest(item.reviewNote),
                error: item.status == VerificationStatus.needsChanges,
              ),
            ),
          if (!waived) ...[
            const SizedBox(height: AppSpacing.sm),
            if (item.evidence.present)
              item.evidence.url.isNotEmpty
                  ? Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        key: Key('doc-open-${item.id}'),
                        onPressed: () => _openDocument(item.evidence.url),
                        icon: const Icon(Icons.open_in_new, size: 18),
                        label: Text(l10n.ownDocOpen),
                      ),
                    )
                  : _muted(l10n.ownDocUploaded(item.evidence.label))
            else
              _muted(l10n.ownDocNoFile, key: Key('doc-nofile-${item.id}')),
            const SizedBox(height: AppSpacing.sm),
            OutlinedButton.icon(
              key: Key('doc-choose-${item.id}'),
              onPressed: uploading ? null : () => _choose(item.id),
              icon: const Icon(Icons.attach_file, size: 18),
              label: Text(l10n.ownDocChoose),
            ),
            if (picked != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  l10n.ownDocSelected(picked.name, (picked.size / 1024).ceil()),
                  key: Key('doc-selected-${item.id}'),
                  style: const TextStyle(fontSize: 12.5, color: AppColors.ink),
                ),
              ),
            const SizedBox(height: AppSpacing.sm),
            FilledButton.icon(
              key: Key('doc-upload-${item.id}'),
              onPressed: picked == null || uploading
                  ? null
                  : () => _upload(item.id),
              icon: uploading
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.upload_file, size: 18),
              label: Text(uploading ? l10n.ownDocUploading : l10n.ownDocUpload),
            ),
          ],
        ],
      ),
    );
  }
}

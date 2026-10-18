import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/package_request_feed.dart';
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_request_widgets.dart';
import 'package_estimate_screen.dart';
import 'package_request_settings_screen.dart';

/// What `/business-requests` carries: the request a notification is about.
class BusinessRequestsArguments {
  const BusinessRequestsArguments({this.requestId = ''});

  final String requestId;
}

/// The way into Requests from the containers screen, beside the Waiting
/// list: how many requests wait on the business or on their customer.
class RequestsEntryRow extends StatelessWidget {
  const RequestsEntryRow({super.key, required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return PressableScale(
      key: const Key('containers-open-requests'),
      scale: 0.985,
      onTap: () {
        AppHaptics.selection();
        onTap();
      },
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
        decoration: BoxDecoration(
          color: AppColors.parchment,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.mark_email_unread_outlined,
              size: 20,
              color: AppColors.cobaltDeep,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.prqRequestsTitle,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  Text(
                    count == 0 ? l10n.prqEntryHint : l10n.prqEntryCount(count),
                    key: const Key('containers-requests-count'),
                    style: const TextStyle(
                      fontSize: 12.5,
                      height: 1.3,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, size: 18, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}

/// Requests, business-side (§2): what customers asked for, in two piles -
/// "Needs estimate" and "Waiting for customer". A card opens the estimate
/// screen; a request waiting for its customer can be confirmed for them
/// ("Customer agreed by phone").
class BusinessRequestsScreen extends StatefulWidget {
  const BusinessRequestsScreen({
    super.key,
    required this.businessId,
    this.feed,
    this.service,
    this.focusRequestId = '',
    this.canManageSettings,
    this.myUid,
  });

  final String businessId;

  /// The containers screen's feed; one of its own when null.
  final PackageRequestFeed? feed;
  final PackageRequestService? service;

  /// A request to open at once (a notification tap).
  final String focusRequestId;

  /// Whether the settings are the viewer's to change; the profile's owner
  /// or admin flag when null.
  final bool? canManageSettings;
  final String? myUid;

  @override
  State<BusinessRequestsScreen> createState() => _BusinessRequestsScreenState();
}

class _BusinessRequestsScreenState extends State<BusinessRequestsScreen> {
  late final PackageRequestService _service =
      widget.service ?? widget.feed?.service ?? FirebasePackageRequestService();
  PackageRequestFeed? _ownFeed;
  late final PackageRequestFeed _feed =
      widget.feed ??
      (_ownFeed = PackageRequestFeed(widget.businessId, service: _service));

  BusinessRequestStage _stage = BusinessRequestStage.needsEstimate;
  bool _focused = false;
  String _busy = '';

  @override
  void initState() {
    super.initState();
    _feed.addListener(_onFeed);
    WidgetsBinding.instance.addPostFrameCallback((_) => _focus());
  }

  @override
  void dispose() {
    _feed.removeListener(_onFeed);
    _ownFeed?.dispose();
    super.dispose();
  }

  void _onFeed() {
    if (!mounted) return;
    setState(() {});
    _focus();
  }

  /// Opens the notified request once the list knows it (or at once when it
  /// is no longer open: the estimate screen reads it by id).
  void _focus() {
    final id = widget.focusRequestId;
    if (_focused || id.isEmpty || !mounted || !_feed.loaded) return;
    _focused = true;
    final request = _feed.byId(id);
    if (request != null) {
      final stage = businessStageOf(request);
      if (stage == BusinessRequestStage.waitingForCustomer ||
          stage == BusinessRequestStage.needsEstimate) {
        setState(() => _stage = stage);
      }
    }
    unawaited(_open(id, request));
  }

  bool get _canManage {
    final given = widget.canManageSettings;
    if (given != null) return given;
    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      return auth.isBusinessOwner || auth.isAdmin;
    } catch (_) {
      return false;
    }
  }

  Future<void> _open(String id, PackageRequest? request) =>
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PackageEstimateScreen(
            businessId: widget.businessId,
            requestId: id,
            initial: request,
            service: _service,
            myUid: widget.myUid,
          ),
        ),
      );

  Future<void> _agreedByPhone(PackageRequest request) async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy.isNotEmpty) return;
    final ok = await confirmMajorAction(
      context,
      title: l10n.prqAgreedByPhoneTitle,
      message: l10n.prqAgreedByPhoneMessage(
        request.version,
        formatRequestCents(request.totalCents ?? 0),
      ),
      confirmLabel: l10n.prqAgreedByPhone,
      icon: Icons.phone_in_talk_outlined,
    );
    if (!ok || !mounted) return;
    setState(() => _busy = request.id);
    try {
      await _service.confirmByPhone(
        businessId: widget.businessId,
        requestId: request.id,
        version: request.version,
      );
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(context, l10n.prqAgreedDone);
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, requestRefusalText(l10n, failure.refusal));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  void _openSettings() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PackageRequestSettingsScreen(
          businessId: widget.businessId,
          service: _service,
          canEdit: _canManage,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final needs = _feed.inStage(BusinessRequestStage.needsEstimate);
    final waiting = _feed.inStage(BusinessRequestStage.waitingForCustomer);
    final shown = _stage == BusinessRequestStage.needsEstimate
        ? needs
        : waiting;
    Widget body;
    if (!_feed.loaded) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_feed.failed && _feed.requests.isEmpty) {
      body = Center(
        child: RequestLoadFailed(
          message: l10n.prqCouldNotLoad,
          onRetry: _feed.retry,
        ),
      );
    } else {
      body = BusinessRequestsList(
        requests: shown,
        stage: _stage,
        service: _service,
        busyId: _busy,
        onOpen: (r) => _open(r.id, r),
        onAgreedByPhone: _agreedByPhone,
      );
    }
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          RequestPageHeader(
            title: l10n.prqRequestsTitle,
            subtitle: l10n.prqEntryCount(needs.length + waiting.length),
            trailing: IconButton(
              key: const Key('requests-settings'),
              tooltip: l10n.prqSettings,
              onPressed: _openSettings,
              icon: const Icon(Icons.tune, color: AppColors.cobaltDeep),
            ),
            bottom: Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                ChoiceChip(
                  key: const Key('requests-chip-needs'),
                  label: Text(l10n.prqChipNeedsEstimate(needs.length)),
                  selected: _stage == BusinessRequestStage.needsEstimate,
                  onSelected: (_) => setState(
                    () => _stage = BusinessRequestStage.needsEstimate,
                  ),
                ),
                ChoiceChip(
                  key: const Key('requests-chip-waiting'),
                  label: Text(l10n.prqChipWaitingCustomer(waiting.length)),
                  selected: _stage == BusinessRequestStage.waitingForCustomer,
                  onSelected: (_) => setState(
                    () => _stage = BusinessRequestStage.waitingForCustomer,
                  ),
                ),
              ],
            ),
          ),
          Expanded(child: body),
        ],
      ),
    );
  }
}

/// The requests of one pile as cards: pure rendering over callbacks.
class BusinessRequestsList extends StatelessWidget {
  const BusinessRequestsList({
    super.key,
    required this.requests,
    required this.stage,
    required this.service,
    required this.onOpen,
    required this.onAgreedByPhone,
    this.busyId = '',
    this.nowMs,
  });

  final List<PackageRequest> requests;
  final BusinessRequestStage stage;
  final PackageRequestService service;
  final ValueChanged<PackageRequest> onOpen;
  final ValueChanged<PackageRequest> onAgreedByPhone;
  final String busyId;
  final int? nowMs;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (requests.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          LotEmptyState(
            key: const Key('requests-empty'),
            icon: Icons.mark_email_read_outlined,
            title: stage == BusinessRequestStage.needsEstimate
                ? l10n.prqEmptyNeedsEstimate
                : l10n.prqEmptyWaiting,
            hint: l10n.prqEmptyHint,
          ),
        ],
      );
    }
    return ListView.builder(
      key: const Key('requests-list'),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        48,
      ),
      itemCount: requests.length,
      itemBuilder: (context, i) => RiseIn(
        key: ValueKey(requests[i].id),
        index: i,
        child: BusinessRequestCard(
          request: requests[i],
          service: service,
          busy: busyId == requests[i].id,
          nowMs: nowMs,
          onTap: () => onOpen(requests[i]),
          onAgreedByPhone: () => onAgreedByPhone(requests[i]),
        ),
      ),
    );
  }
}

/// One request as staff scan it: who, how and when it arrives, what is in
/// it (with a photo), the estimate, and who is writing it.
class BusinessRequestCard extends StatelessWidget {
  const BusinessRequestCard({
    super.key,
    required this.request,
    required this.service,
    required this.onTap,
    required this.onAgreedByPhone,
    this.busy = false,
    this.nowMs,
  });

  final PackageRequest request;
  final PackageRequestService service;
  final VoidCallback onTap;
  final VoidCallback onAgreedByPhone;
  final bool busy;
  final int? nowMs;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final now = nowMs ?? DateTime.now().millisecondsSinceEpoch;
    final lock = request.lock;
    final photo = request.pieces.expand((p) => p.photoPaths).firstOrNull;
    final when = request.isCollect
        ? (request.handoffDay.isEmpty
              ? l10n.prqNoDay
              : l10n.prqCollectOn(
                  requestDayText(request.handoffDay, locale),
                  requestWindowLabel(l10n, request.handoffWindow),
                ))
        : (request.plannedDate.isEmpty
              ? l10n.prqNoDay
              : l10n.prqBringsItOn(
                  requestDayText(request.plannedDate, locale),
                ));
    final total = request.totalCents;
    return PressableScale(
      scale: 0.985,
      onTap: () {
        AppHaptics.selection();
        onTap();
      },
      child: Container(
        key: ValueKey('request-card:${request.id}'),
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(color: AppColors.rule),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  request.isCollect
                      ? Icons.local_shipping_outlined
                      : Icons.storefront_outlined,
                  size: 20,
                  color: AppColors.cobaltDeep,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        request.senderName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        [
                          request.isCollect ? l10n.prqCollect : l10n.prqBringIn,
                          when,
                        ].join(' · '),
                        key: const Key('request-card-when'),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        [
                          requestPiecesSummary(
                            l10n,
                            countRequestPieces(request),
                          ),
                          if (request.destinationCountryName.isNotEmpty)
                            request.destinationCountryName,
                          request.code,
                        ].where((s) => s.isNotEmpty).join(' · '),
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: AppColors.muted,
                        ),
                      ),
                      if (total != null)
                        Text(
                          l10n.prqEstimateTotal(formatRequestCents(total)),
                          style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: AppColors.cobaltDeep,
                          ),
                        ),
                    ],
                  ),
                ),
                if (photo != null) ...[
                  const SizedBox(width: AppSpacing.sm),
                  RequestPhotoThumb(path: photo, service: service, size: 48),
                ],
              ],
            ),
            if ((lock != null && lock.isLive(now)) ||
                request.whatsappUnreachable)
              Padding(
                padding: const EdgeInsets.only(top: AppSpacing.sm),
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if (lock != null && lock.isLive(now))
                      RequestBadge(
                        key: const Key('request-card-lock'),
                        icon: Icons.lock_outline,
                        label: l10n.prqLockedBy(lock.name),
                        color: AppColors.warn,
                      ),
                    if (request.whatsappUnreachable)
                      RequestBadge(
                        key: const Key('request-card-unreachable'),
                        icon: Icons.phone_disabled_outlined,
                        label: l10n.prqNotReachable,
                        color: AppColors.errorRed,
                      ),
                  ],
                ),
              ),
            if (request.status == requestStatusEstimateSent &&
                request.estimate != null &&
                !request.isCardOrder)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: ValueKey('request-agreed-by-phone:${request.id}'),
                  onPressed: busy ? null : onAgreedByPhone,
                  icon: busy
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.phone_in_talk_outlined, size: 16),
                  label: Text(l10n.prqAgreedByPhone),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

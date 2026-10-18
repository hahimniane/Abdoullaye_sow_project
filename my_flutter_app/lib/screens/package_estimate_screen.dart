import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/day_picker.dart';
import '../widgets/package_request_widgets.dart';

/// Staff write the estimate for one request (§2 Estimates): a price per
/// piece (a barrel starts at the business's price), photos full screen, a
/// note, the History - and send it on WhatsApp, confirm on the customer's
/// behalf, or decline.
///
/// One person writes at a time: opening the screen takes the lock
/// (`startPackageEstimate`) and renews it every five minutes while it is
/// open; someone else's live lock leaves the screen read only, with a Take
/// over once it lapses. A version that moves under the editor (another
/// person sent one, the customer confirmed) asks for a refresh before
/// anything is sent.
class PackageEstimateScreen extends StatefulWidget {
  const PackageEstimateScreen({
    super.key,
    required this.businessId,
    required this.requestId,
    this.initial,
    this.service,
    this.myUid,
    this.nowMs,
    this.heartbeat = requestLockHeartbeat,
    this.onCall,
  });

  final String businessId;
  final String requestId;

  /// What the list already shows, so the screen draws at once.
  final PackageRequest? initial;
  final PackageRequestService? service;

  /// The signed-in person; read from the profile when null.
  final String? myUid;
  final int Function()? nowMs;
  final Duration heartbeat;
  final Future<void> Function(String phone)? onCall;

  @override
  State<PackageEstimateScreen> createState() => _PackageEstimateScreenState();
}

enum _LockState { starting, mine, other, closed, failed }

class _PackageEstimateScreenState extends State<PackageEstimateScreen> {
  late final PackageRequestService _service =
      widget.service ?? FirebasePackageRequestService();
  StreamSubscription<PackageRequest?>? _sub;
  Timer? _heartbeat;
  Timer? _ticker;

  PackageRequest? _request;
  Object? _loadError;
  _LockState _lock = _LockState.starting;
  RequestLock? _otherLock;
  bool _lockLost = false;
  bool _sent = false;

  /// The version the inputs were written against.
  int _baseVersion = 0;
  bool _stale = false;
  bool _started = false;

  final Map<String, TextEditingController> _prices = {};
  final _pickupFee = TextEditingController();
  final _note = TextEditingController();
  String _scheduleDate = '';
  String _scheduleWindow = '';
  Set<String> _missing = {};
  Set<String> _invalid = {};
  Set<String> _errors = {};
  String _busy = '';

  int get _now =>
      (widget.nowMs ?? () => DateTime.now().millisecondsSinceEpoch)();

  String get _myUid {
    final given = widget.myUid;
    if (given != null) return given;
    try {
      return Provider.of<AuthProvider>(context, listen: false).user?.uid ?? '';
    } catch (_) {
      return '';
    }
  }

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    if (initial != null) _adopt(initial, first: true);
    _sub = _service
        .watchRequest(widget.requestId)
        .listen(
          _onRequest,
          onError: (Object error) {
            if (!mounted) return;
            setState(() => _loadError = error);
          },
        );
    // Re-reads the clock now and then, so a lapsed lock offers Take over.
    _ticker = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted && _lock == _LockState.other) setState(() {});
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _heartbeat?.cancel();
    _ticker?.cancel();
    if (_lock == _LockState.mine && !_sent) {
      // Let the next person in at once rather than in fifteen minutes.
      unawaited(
        _service
            .releaseEstimate(
              businessId: widget.businessId,
              requestId: widget.requestId,
            )
            .catchError((Object _) {}),
      );
    }
    for (final c in _prices.values) {
      c.dispose();
    }
    _pickupFee.dispose();
    _note.dispose();
    super.dispose();
  }

  void _onRequest(PackageRequest? request) {
    if (!mounted || request == null) return;
    final first = _request == null;
    setState(() {
      if (first) {
        _adopt(request, first: true);
      } else {
        final moved = request.version != _baseVersion;
        _request = request;
        if (_lock == _LockState.mine && moved) _stale = true;
        final lock = request.lock;
        if (_lock == _LockState.mine &&
            lock != null &&
            lock.uid != _myUid &&
            lock.isLive(_now)) {
          _lockLost = true;
          _lock = _LockState.other;
          _otherLock = lock;
          _heartbeat?.cancel();
        }
        if (!request.isOpen || request.isCardOrder) _lock = _LockState.closed;
      }
    });
    if (!_started) unawaited(_start());
  }

  /// Fills the inputs from [request]: on open, and on Refresh.
  void _adopt(PackageRequest request, {bool first = false}) {
    _request = request;
    _baseVersion = request.version;
    _stale = false;
    final prefill = estimatePrefill(request);
    for (final piece in request.pieces) {
      (_prices[piece.id] ??= TextEditingController()).text =
          prefill[piece.id] ?? '';
    }
    final estimate = request.estimate;
    _pickupFee.text = estimate?.pickupFeeCents == null
        ? ''
        : requestCentsToInput(estimate!.pickupFeeCents!);
    _note.text = estimate?.note ?? '';
    _scheduleDate =
        estimate?.pickupSchedule?.date ?? request.pickup?.date ?? '';
    _scheduleWindow =
        estimate?.pickupSchedule?.window ?? request.pickup?.window ?? '';
    _missing = {};
    _invalid = {};
    _errors = {};
    if (!request.isOpen || request.isCardOrder) _lock = _LockState.closed;
  }

  Future<void> _start({bool takeover = false}) async {
    final request = _request;
    if (request == null) return;
    _started = true;
    if (!request.isOpen || request.isCardOrder) {
      setState(() => _lock = _LockState.closed);
      return;
    }
    try {
      final grant = await _service.startEstimate(
        businessId: widget.businessId,
        requestId: widget.requestId,
        takeover: takeover,
      );
      if (!mounted) return;
      setState(() {
        _lock = _LockState.mine;
        _lockLost = false;
        _otherLock = null;
        if (grant.version != _baseVersion) _stale = true;
      });
      _heartbeat?.cancel();
      _heartbeat = Timer.periodic(widget.heartbeat, (_) => _renew());
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      final refusal = failure.refusal;
      setState(() {
        if (refusal.has('estimate_locked')) {
          _lock = _LockState.other;
          _otherLock = RequestLock(
            uid: '',
            name: refusal.lockedByName,
            untilMs: refusal.untilMs ?? 0,
          );
        } else if (refusal.has('request_closed') || refusal.has('card_order')) {
          _lock = _LockState.closed;
        } else {
          _lock = _LockState.failed;
          _errors = {...refusal.reasons};
        }
      });
      if (_lock == _LockState.failed) {
        showErrorSnackBar(
          context,
          requestRefusalText(AppLocalizations.of(context)!, refusal),
        );
      }
    }
  }

  Future<void> _renew() async {
    if (_lock != _LockState.mine) return;
    try {
      await _service.startEstimate(
        businessId: widget.businessId,
        requestId: widget.requestId,
      );
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      if (failure.refusal.has('estimate_locked')) {
        setState(() {
          _lock = _LockState.other;
          _lockLost = true;
          _otherLock = RequestLock(
            uid: '',
            name: failure.refusal.lockedByName,
            untilMs: failure.refusal.untilMs ?? 0,
          );
        });
        _heartbeat?.cancel();
      }
    } catch (_) {
      // Offline for a moment: the next beat tries again.
    }
  }

  Future<void> _takeOver() async {
    if (_busy.isNotEmpty) return;
    setState(() => _busy = 'takeover');
    try {
      await _start(takeover: true);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  void _refresh() {
    final request = _request;
    if (request == null) return;
    setState(() => _adopt(request));
  }

  Future<void> _pickScheduleDay() async {
    final today = requestToday(DateTime.fromMillisecondsSinceEpoch(_now));
    final picked = await pickCalendarDay(
      context,
      initial: requestDayFromKey(_scheduleDate) ?? today,
      first: today,
      last: requestLastPlannedDay(today),
    );
    if (picked == null || !mounted) return;
    setState(() => _scheduleDate = requestDayKey(picked));
  }

  Future<void> _send() async {
    final l10n = AppLocalizations.of(context)!;
    final request = _request;
    if (request == null || _busy.isNotEmpty || _lock != _LockState.mine) return;
    if (_stale) return;
    final check = checkEstimate(
      request: request,
      inputs: {for (final e in _prices.entries) e.key: e.value.text},
      pickupFee: _pickupFee.text,
      note: _note.text,
      scheduleDate: _scheduleDate,
      scheduleWindow: _scheduleWindow,
      now: DateTime.fromMillisecondsSinceEpoch(_now),
    );
    if (!check.ok) {
      AppHaptics.refuse();
      setState(() {
        _missing = check.missing;
        _invalid = check.invalid;
        _errors = check.reasons.toSet();
      });
      return;
    }
    final schedule = request.isCollect && _scheduleDate.isNotEmpty
        ? RequestSchedule(date: _scheduleDate, window: _scheduleWindow)
        : null;
    setState(() {
      _busy = 'send';
      _errors = {};
      _missing = {};
      _invalid = {};
    });
    try {
      final sent = await _service.sendEstimate(
        sendEstimatePayload(
          businessId: widget.businessId,
          request: request,
          baseVersion: _baseVersion,
          check: check,
          note: _note.text,
          pickupSchedule: schedule,
        ),
      );
      if (!mounted) return;
      _sent = true;
      _lock = _LockState.starting;
      _heartbeat?.cancel();
      AppHaptics.commit();
      showSuccessSnackBar(
        context,
        sent.reconfirmRequired
            ? l10n.prqEstimateReconfirm
            : sent.priceDropped
            ? l10n.prqEstimatePriceDropped
            : l10n.prqEstimateSentDone,
      );
      Navigator.of(context).maybePop();
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      _onRefusal(failure.refusal);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  void _onRefusal(RequestRefusal refusal) {
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      if (refusal.has('estimate_stale') || refusal.has('estimate_changed')) {
        _stale = true;
      } else if (refusal.has('estimate_locked')) {
        _lock = _LockState.other;
        _lockLost = true;
        _otherLock = RequestLock(
          uid: '',
          name: refusal.lockedByName,
          untilMs: refusal.untilMs ?? 0,
        );
        _heartbeat?.cancel();
      } else if (refusal.has('request_closed') || refusal.has('card_order')) {
        _lock = _LockState.closed;
      }
      _errors = {...refusal.reasons};
    });
    showErrorSnackBar(context, requestRefusalText(l10n, refusal));
  }

  Future<void> _agreedByPhone() async {
    final l10n = AppLocalizations.of(context)!;
    final request = _request;
    if (request == null || _busy.isNotEmpty) return;
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
    setState(() => _busy = 'phone');
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
      _onRefusal(failure.refusal);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _decline() async {
    final l10n = AppLocalizations.of(context)!;
    final request = _request;
    if (request == null || _busy.isNotEmpty) return;
    final reason = await askRequestReason(
      context,
      title: l10n.prqDeclineTitle,
      message: l10n.prqDeclineMessage,
      confirmLabel: l10n.prqDecline,
    );
    if (reason == null || !mounted) return;
    setState(() => _busy = 'decline');
    try {
      await _service.decline(
        businessId: widget.businessId,
        requestId: request.id,
        reason: reason,
      );
      if (!mounted) return;
      _sent = true;
      AppHaptics.commit();
      showSuccessSnackBar(context, l10n.prqDeclined);
      Navigator.of(context).maybePop();
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      _onRefusal(failure.refusal);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _call(String phone) async {
    final call = widget.onCall;
    if (call != null) return call(phone);
    await launchUrl(Uri(scheme: 'tel', path: phone));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final request = _request;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          RequestPageHeader(
            title: request == null || request.code.isEmpty
                ? l10n.prqEstimateTitle
                : l10n.prqDetailTitle(request.code),
            subtitle: request?.senderName,
          ),
          Expanded(
            child: request == null
                ? (_loadError != null
                      ? Center(
                          child: RequestLoadFailed(
                            message: requestErrorText(l10n, _loadError!),
                            onRetry: () {
                              _sub?.cancel();
                              setState(() => _loadError = null);
                              _sub = _service
                                  .watchRequest(widget.requestId)
                                  .listen(
                                    _onRequest,
                                    onError: (Object e) {
                                      if (mounted) {
                                        setState(() => _loadError = e);
                                      }
                                    },
                                  );
                            },
                          ),
                        )
                      : const Center(child: CircularProgressIndicator()))
                : _content(l10n, request),
          ),
        ],
      ),
    );
  }

  Widget _content(AppLocalizations l10n, PackageRequest request) {
    final locale = dateLocaleOf(context);
    final editing = _lock == _LockState.mine && !_stale;
    final other = _otherLock;
    final lapsed = other != null && !other.isLive(_now);
    return ListView(
      key: const Key('estimate-screen'),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        48,
      ),
      children: [
        if (_lock == _LockState.mine)
          RequestBanner(
            key: const Key('estimate-lock-mine'),
            text: l10n.prqLockMine,
            icon: Icons.edit_note,
          ),
        if (_lock == _LockState.other && other != null)
          RequestBanner(
            key: const Key('estimate-lock-other'),
            text: lapsed
                ? l10n.prqLockLapsed(other.name)
                : [
                    if (_lockLost) l10n.prqLockLost,
                    l10n.prqLockOther(
                      other.name,
                      displayTime(
                        DateTime.fromMillisecondsSinceEpoch(other.untilMs),
                        locale,
                      ),
                    ),
                  ].join(' '),
            icon: Icons.lock_outline,
            color: AppColors.warn,
            action: lapsed
                ? FilledButton(
                    key: const Key('estimate-take-over'),
                    onPressed: _busy.isEmpty ? _takeOver : null,
                    child: Text(l10n.prqTakeOver),
                  )
                : null,
          ),
        if (_lock == _LockState.closed)
          RequestBanner(
            key: const Key('estimate-closed'),
            text: request.isCardOrder && request.isOpen
                ? l10n.prqErrCardOrder
                : l10n.prqClosed,
            icon: Icons.lock_outline,
            color: AppColors.muted,
          ),
        if (_stale && _lock == _LockState.mine)
          RequestBanner(
            key: const Key('estimate-stale'),
            text: l10n.prqStaleBanner,
            icon: Icons.update,
            color: AppColors.warn,
            action: OutlinedButton(
              key: const Key('estimate-refresh'),
              onPressed: _refresh,
              child: Text(l10n.prqRefresh),
            ),
          ),
        _CustomerFacts(request: request, locale: locale, onCall: _call),
        RequestSectionTitle(l10n.prqPieces),
        for (final piece in request.pieces)
          _PiecePriceRow(
            piece: piece,
            controller: _prices[piece.id] ??= TextEditingController(),
            enabled: editing && _busy.isEmpty,
            service: _service,
            error: _missing.contains(piece.id)
                ? l10n.prqPriceRequired
                : _invalid.contains(piece.id)
                ? l10n.prqPriceInvalid
                : null,
          ),
        if (request.isCollect) ...[
          const SizedBox(height: AppSpacing.sm),
          TextField(
            key: const Key('estimate-pickup-fee'),
            controller: _pickupFee,
            enabled: editing && _busy.isEmpty,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
            ],
            decoration: InputDecoration(
              labelText: l10n.prqPickupFeeField,
              prefixText: r'$ ',
              errorText: _errors.contains('pickup_fee_invalid')
                  ? l10n.prqErrPickupFee
                  : null,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            key: const Key('estimate-schedule-day'),
            onPressed: editing ? _pickScheduleDay : null,
            icon: const Icon(Icons.event_outlined, size: 18),
            label: Text(
              _scheduleDate.isEmpty
                  ? l10n.prqPickupScheduleDay
                  : _scheduleWindow.isEmpty
                  ? requestDayText(_scheduleDate, locale)
                  : l10n.prqDayWindow(
                      requestDayText(_scheduleDate, locale),
                      requestWindowLabel(l10n, _scheduleWindow),
                    ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: 6,
            children: [
              for (final w in requestPickupWindows)
                ChoiceChip(
                  key: Key('estimate-window:$w'),
                  label: Text(requestWindowLabel(l10n, w)),
                  selected: _scheduleWindow == w,
                  onSelected: editing
                      ? (_) => setState(() => _scheduleWindow = w)
                      : null,
                ),
            ],
          ),
          if (_errors.contains('pickup_schedule_invalid'))
            Padding(
              key: const Key('estimate-schedule-error'),
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                l10n.prqErrPickupSchedule,
                style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
              ),
            ),
        ],
        const SizedBox(height: AppSpacing.md),
        TextField(
          key: const Key('estimate-note'),
          controller: _note,
          enabled: editing && _busy.isEmpty,
          maxLength: requestMaxNote,
          minLines: 1,
          maxLines: 3,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: l10n.prqNoteToCustomer,
            counterText: '',
            errorText: _errors.contains('text_too_long')
                ? l10n.prqErrTextTooLong
                : null,
          ),
        ),
        if (_errors.contains('estimate_piece_missing'))
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              l10n.prqErrPieceMissing,
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
          ),
        const SizedBox(height: AppSpacing.lg),
        if (request.isOpen && !request.isCardOrder)
          RequestPrimaryButton(
            key: const Key('estimate-send'),
            label: l10n.prqSendEstimate,
            busyLabel: l10n.prqSending,
            busy: _busy == 'send',
            onTap: editing && _busy.isEmpty ? _send : null,
          ),
        if (request.status == requestStatusEstimateSent &&
            request.estimate != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: OutlinedButton.icon(
              key: const Key('estimate-agreed-by-phone'),
              onPressed: _busy.isEmpty ? _agreedByPhone : null,
              icon: _busy == 'phone'
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.phone_in_talk_outlined, size: 18),
              label: Text(l10n.prqAgreedByPhone),
            ),
          ),
        if ((request.status == requestStatusNew ||
                request.status == requestStatusEstimateSent) &&
            !request.isCardOrder)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: TextButton(
              key: const Key('estimate-decline'),
              style: TextButton.styleFrom(foregroundColor: AppColors.errorRed),
              onPressed: _busy.isEmpty ? _decline : null,
              child: _busy == 'decline'
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.prqDecline),
            ),
          ),
        RequestSectionTitle(l10n.lotHistory),
        _History(request: request, locale: locale),
      ],
    );
  }
}

class _CustomerFacts extends StatelessWidget {
  const _CustomerFacts({
    required this.request,
    required this.locale,
    required this.onCall,
  });

  final PackageRequest request;
  final String locale;
  final ValueChanged<String> onCall;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
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
    final where = request.isCollect
        ? request.pickup?.address ?? ''
        : request.location?.title ?? '';
    TextStyle muted() =>
        const TextStyle(fontSize: 13, height: 1.35, color: AppColors.muted);
    return RequestCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  request.senderName,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              RequestStatusPill(status: request.status),
            ],
          ),
          if (request.senderPhone.isNotEmpty)
            InkWell(
              key: const Key('estimate-call-customer'),
              onTap: () => onCall(request.senderPhone),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.phone_outlined,
                      size: 14,
                      color: AppColors.cobaltDeep,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      request.senderPhone,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.cobaltDeep,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (request.receiverName.isNotEmpty)
            Text(
              '→ ${[request.receiverName, request.receiverPhone, request.destinationCountryName].where((s) => s.isNotEmpty).join(' · ')}',
              style: muted(),
            ),
          const SizedBox(height: 4),
          Text(
            [when, if (where.isNotEmpty) where].join(' · '),
            key: const Key('estimate-when'),
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          RequestPickupNote(request: request),
          if (request.whatsappUnreachable)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: RequestBadge(
                key: const Key('estimate-unreachable'),
                icon: Icons.phone_disabled_outlined,
                label: l10n.prqNotReachable,
                color: AppColors.errorRed,
              ),
            ),
        ],
      ),
    );
  }
}

class _PiecePriceRow extends StatelessWidget {
  const _PiecePriceRow({
    required this.piece,
    required this.controller,
    required this.enabled,
    required this.service,
    this.error,
  });

  final RequestPiece piece;
  final TextEditingController controller;
  final bool enabled;
  final PackageRequestService service;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return RequestCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                requestPieceKindIcon(piece.kind),
                size: 18,
                color: AppColors.cobaltDeep,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      requestPieceKindLabel(l10n, piece.kind),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.muted,
                      ),
                    ),
                    if (piece.description.isNotEmpty)
                      Text(
                        piece.description,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                    if (piece.sizeIn != null)
                      Text(
                        piece.sizeIn!.text,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              SizedBox(
                width: 112,
                child: TextField(
                  key: Key('estimate-price:${piece.id}'),
                  controller: controller,
                  enabled: enabled,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                  ],
                  decoration: InputDecoration(
                    labelText: l10n.prqPriceField,
                    isDense: true,
                    errorText: error,
                    errorMaxLines: 3,
                  ),
                ),
              ),
            ],
          ),
          if (piece.photoPaths.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                for (var i = 0; i < piece.photoPaths.length; i++)
                  RequestPhotoThumb(
                    key: Key('estimate-photo:${piece.id}:$i'),
                    path: piece.photoPaths[i],
                    service: service,
                    onTap: () => showRequestPhotos(
                      context,
                      paths: piece.photoPaths,
                      service: service,
                      initial: i,
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _History extends StatelessWidget {
  const _History({required this.request, required this.locale});

  final PackageRequest request;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final entries = request.history.reversed.toList();
    if (entries.isEmpty) {
      return Text(
        l10n.lotNoHistory,
        style: const TextStyle(fontSize: 13, color: AppColors.muted),
      );
    }
    return Column(
      key: const Key('estimate-history'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final entry in entries)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  requestHistoryText(l10n, entry),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  [
                    if (entry.byName.isNotEmpty) entry.byName,
                    if (entry.at != null) displayDateTime(entry.at!, locale),
                  ].join(' · '),
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
                if (entry.reason.isNotEmpty)
                  Text(
                    l10n.prqReason(entry.reason),
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.ink,
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

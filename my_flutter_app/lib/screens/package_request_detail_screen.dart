import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/guest_tracking_lookup.dart';
import '../widgets/package_request_widgets.dart';

/// What `/package-request-detail` carries: the request by id (a signed-in
/// sender's own, from My requests or a notification) and/or by its link
/// token (the WhatsApp button, `/e/<token>`).
class PackageRequestDetailArguments {
  const PackageRequestDetailArguments({this.requestId = '', this.token = ''});

  final String requestId;
  final String token;
}

/// The customer's estimate page (§8.5 "Page states"): the pieces with their
/// prices and the total, where and when, the business's phone, and Confirm /
/// No thanks - or what became of the request.
///
/// The page reads the public projection by token (it carries the business's
/// phone and hours); a signed-in sender's own document, when an id is known,
/// keeps it live - a change there fetches the projection again.
class PackageRequestDetailScreen extends StatefulWidget {
  const PackageRequestDetailScreen({
    super.key,
    this.requestId = '',
    this.token = '',
    this.service,
    this.onTrack,
    this.onCall,
  });

  final String requestId;
  final String token;
  final PackageRequestService? service;

  /// Opens the tracking page for a code; the public lookup when null.
  final void Function(BuildContext context, String code)? onTrack;

  /// Dials a phone number; the phone app when null.
  final Future<void> Function(String phone)? onCall;

  @override
  State<PackageRequestDetailScreen> createState() =>
      _PackageRequestDetailScreenState();
}

class _PackageRequestDetailScreenState
    extends State<PackageRequestDetailScreen> {
  late final PackageRequestService _service =
      widget.service ?? FirebasePackageRequestService();

  StreamSubscription<PackageRequest?>? _docSub;
  Timer? _safety;
  PackageRequest? _request;
  PackageRequest? _doc;
  late String _token = widget.token;
  Object? _error;
  bool _loading = true;

  /// The estimate version the customer first saw; a different one later
  /// means it changed while the page was open.
  int? _seenVersion;
  bool _changed = false;
  String _busy = '';
  int _fetchTicket = 0;

  @override
  void initState() {
    super.initState();
    _safety = Timer(const Duration(seconds: 20), () {
      if (mounted && _loading) {
        setState(() {
          _loading = false;
          _error ??= const RequestFailure(RequestRefusal(code: 'unavailable'));
        });
      }
    });
    if (widget.requestId.isNotEmpty) {
      _docSub = _service
          .watchRequest(widget.requestId)
          .listen(
            _onDoc,
            onError: (Object error) {
              // Not the sender's own document (or offline): the token still
              // answers.
              if (_token.isEmpty && mounted) {
                setState(() {
                  _error = error;
                  _loading = false;
                });
              }
            },
          );
    }
    if (_token.isNotEmpty) unawaited(_fetch());
    if (_token.isEmpty && widget.requestId.isEmpty) {
      _loading = false;
      _error = const RequestFailure(
        RequestRefusal(code: 'not-found', reasons: ['request_not_found']),
      );
    }
  }

  @override
  void dispose() {
    _docSub?.cancel();
    _safety?.cancel();
    super.dispose();
  }

  void _onDoc(PackageRequest? doc) {
    if (!mounted) return;
    final previous = _doc;
    _doc = doc;
    if (doc == null) {
      if (_token.isEmpty) {
        setState(() {
          _loading = false;
          _error = const RequestFailure(
            RequestRefusal(code: 'not-found', reasons: ['request_not_found']),
          );
        });
      }
      return;
    }
    if (_token.isEmpty && doc.token.isNotEmpty) _token = doc.token;
    final moved =
        previous == null ||
        previous.status != doc.status ||
        previous.version != doc.version ||
        previous.updatedAt != doc.updatedAt;
    if (_token.isNotEmpty) {
      if (moved) unawaited(_fetch());
    } else {
      _show(doc);
    }
  }

  void _show(PackageRequest request) {
    final version = request.version;
    setState(() {
      if (_seenVersion == null) {
        if (request.estimate != null) _seenVersion = version;
      } else if (version != _seenVersion &&
          request.status == requestStatusEstimateSent) {
        _changed = true;
        _seenVersion = version;
      }
      _request = request;
      _error = null;
      _loading = false;
    });
    _safety?.cancel();
  }

  Future<void> _fetch() async {
    final ticket = ++_fetchTicket;
    try {
      final request = await _service.getByToken(_token);
      if (!mounted || ticket != _fetchTicket) return;
      _show(request);
    } catch (error) {
      if (!mounted || ticket != _fetchTicket) return;
      final doc = _doc;
      if (doc != null) {
        _show(doc);
      } else {
        setState(() {
          _error = error;
          _loading = false;
        });
      }
    }
  }

  Future<void> _retry() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    if (_token.isNotEmpty) {
      await _fetch();
    } else if (_doc != null) {
      _show(_doc!);
    } else {
      setState(() => _loading = false);
    }
  }

  Future<void> _confirm(PackageRequest request) async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy.isNotEmpty || _token.isEmpty) return;
    setState(() => _busy = 'confirm');
    try {
      final result = await _service.confirmEstimate(
        token: _token,
        version: request.version,
      );
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(
        context,
        result.alreadyConfirmed
            ? l10n.prqAlreadyConfirmed
            : l10n.prqConfirmedDone,
      );
      setState(() => _changed = false);
      await _fetch();
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      if (failure.refusal.has('estimate_changed')) {
        setState(() => _changed = true);
      } else {
        showErrorSnackBar(context, requestRefusalText(l10n, failure.refusal));
      }
      await _fetch();
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _decline() async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy.isNotEmpty || _token.isEmpty) return;
    final reason = await askRequestReason(
      context,
      title: l10n.prqNoThanksTitle,
      message: l10n.prqNoThanksMessage,
      confirmLabel: l10n.prqNoThanks,
      required: false,
    );
    if (reason == null || !mounted) return;
    setState(() => _busy = 'decline');
    try {
      await _service.declineEstimate(token: _token, reason: reason);
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(context, l10n.prqDeclinedDone);
      await _fetch();
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, requestRefusalText(l10n, failure.refusal));
      await _fetch();
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  void _track(String code) {
    final track = widget.onTrack;
    if (track != null) {
      track(context, code);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => GuestTrackingLookupPage(initialCode: code),
      ),
    );
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
    Widget body;
    if (_loading && request == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (request == null) {
      body = Center(
        child: RequestLoadFailed(
          message: requestErrorText(l10n, _error ?? Object()),
          onRetry: _retry,
        ),
      );
    } else {
      body = RefreshIndicator(
        onRefresh: _retry,
        child: _content(l10n, request),
      );
    }
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          RequestPageHeader(
            title: request == null || request.code.isEmpty
                ? l10n.prqMyRequests
                : l10n.prqDetailTitle(request.code),
            subtitle: request?.businessName,
          ),
          Expanded(child: body),
        ],
      ),
    );
  }

  Widget _content(AppLocalizations l10n, PackageRequest request) {
    final locale = dateLocaleOf(context);
    final state = customerStateOf(request);
    final business = request.businessName;
    final answering = customerCanAnswer(request);
    return ListView(
      key: const Key('request-detail'),
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        48,
      ),
      children: [
        if (_changed && answering)
          RequestBanner(
            key: const Key('request-changed-banner'),
            text: l10n.prqChangedBanner,
            icon: Icons.update,
            color: AppColors.warn,
          ),
        _StateCard(
          request: request,
          state: state,
          business: business,
          locale: locale,
          onTrack: _track,
        ),
        RequestSectionTitle(l10n.prqPieces),
        RequestCard(child: RequestPriceTable(request: request)),
        if ((request.estimate?.note ?? '').isNotEmpty)
          RequestCard(
            color: AppColors.parchment,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.prqBusinessNote,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
                const SizedBox(height: 2),
                Text(
                  request.estimate!.note,
                  key: const Key('request-business-note'),
                  style: const TextStyle(fontSize: 14, color: AppColors.ink),
                ),
              ],
            ),
          ),
        if (request.isOpen)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              [
                request.isCollect ? l10n.prqPayAtPickup : l10n.prqPayAtDropOff,
                l10n.prqNotBinding,
              ].join(' '),
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: AppColors.muted,
              ),
            ),
          ),
        RequestSectionTitle(l10n.prqWhereWhen),
        _WhereWhen(request: request, locale: locale),
        if (request.receiverName.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              l10n.prqToReceiver(
                request.receiverName,
                request.destinationCountryName,
              ),
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ),
        if (request.businessPhone.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            key: const Key('request-call-business'),
            onPressed: () => _call(request.businessPhone),
            icon: const Icon(Icons.phone_outlined, size: 18),
            label: Text(
              l10n.prqCallBusiness(business),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
        if (answering) ...[
          const SizedBox(height: AppSpacing.lg),
          RequestPrimaryButton(
            key: const Key('request-confirm'),
            label: l10n.prqConfirm,
            busyLabel: l10n.prqSending,
            busy: _busy == 'confirm',
            onTap: _busy.isEmpty ? () => _confirm(request) : null,
          ),
          if (!request.isCardOrder)
            TextButton(
              key: const Key('request-no-thanks'),
              onPressed: _busy.isEmpty ? _decline : null,
              child: _busy == 'decline'
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.prqNoThanks),
            ),
        ],
      ],
    );
  }
}

class _StateCard extends StatelessWidget {
  const _StateCard({
    required this.request,
    required this.state,
    required this.business,
    required this.locale,
    required this.onTrack,
  });

  final PackageRequest request;
  final CustomerRequestState state;
  final String business;
  final String locale;
  final ValueChanged<String> onTrack;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final (
      String title,
      String? hint,
      Color color,
      IconData icon,
    ) = switch (state) {
      CustomerRequestState.waitingForEstimate => (
        l10n.prqStateWaiting(business),
        l10n.prqStateWaitingHint,
        AppColors.warn,
        Icons.hourglass_top,
      ),
      CustomerRequestState.awaitingConfirmation => (
        l10n.prqStateAwaiting,
        l10n.prqStateAwaitingHint,
        AppColors.cobalt,
        Icons.receipt_long_outlined,
      ),
      CustomerRequestState.confirmed => (
        request.confirmedVia == 'staff_phone'
            ? l10n.prqStateConfirmedByPhone(business)
            : request.confirmedVia == 'card'
            ? l10n.prqPaidOnline
            : l10n.prqStateConfirmed,
        request.priceDropped ? l10n.prqPriceDropped : null,
        AppColors.sage,
        Icons.check_circle_outline,
      ),
      CustomerRequestState.received => (
        l10n.prqStateReceived(business),
        request.trackingCode.isEmpty
            ? null
            : l10n.prqTrackingCode(request.trackingCode),
        AppColors.cobaltDeep,
        Icons.inventory_2_outlined,
      ),
      CustomerRequestState.declined => (
        l10n.prqStateDeclined(business),
        request.declineReason.isEmpty
            ? null
            : l10n.prqReason(request.declineReason),
        AppColors.muted,
        Icons.block,
      ),
      CustomerRequestState.cancelled => (
        l10n.prqStateCancelled(business),
        request.declineReason.isEmpty
            ? null
            : l10n.prqReason(request.declineReason),
        AppColors.muted,
        Icons.cancel_outlined,
      ),
      CustomerRequestState.customerDeclined => (
        l10n.prqStateCustomerDeclined,
        null,
        AppColors.muted,
        Icons.do_not_disturb_on_outlined,
      ),
      CustomerRequestState.expired => (
        l10n.prqStateExpired,
        l10n.prqStateExpiredHint,
        AppColors.muted,
        Icons.timer_off_outlined,
      ),
    };
    final expires = request.expiresAt;
    return Container(
      key: Key('request-state:${state.name}'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                if (hint != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    hint,
                    key: const Key('request-state-hint'),
                    style: const TextStyle(
                      fontSize: 13.5,
                      height: 1.35,
                      color: AppColors.ink,
                    ),
                  ),
                ],
                if (state == CustomerRequestState.awaitingConfirmation &&
                    expires != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    l10n.prqAnswerBy(displayDate(expires, locale)),
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.muted,
                    ),
                  ),
                ],
                if (state == CustomerRequestState.received &&
                    request.trackingCode.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.sm),
                  OutlinedButton(
                    key: const Key('request-track'),
                    onPressed: () => onTrack(request.trackingCode),
                    child: Text(l10n.prqTrack),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _WhereWhen extends StatelessWidget {
  const _WhereWhen({required this.request, required this.locale});

  final PackageRequest request;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final lines = <String>[];
    String label;
    if (request.isCollect) {
      label = l10n.prqPickupAt;
      final pickup = request.pickup;
      if (pickup != null && pickup.address.isNotEmpty) {
        lines.add(pickup.address);
      }
      final day = request.handoffDay;
      if (day.isNotEmpty) {
        final window = request.handoffWindow;
        lines.add(
          window.isEmpty
              ? requestDayText(day, locale)
              : l10n.prqDayWindow(
                  requestDayText(day, locale),
                  requestWindowLabel(l10n, window),
                ),
        );
      }
      if (pickup != null && pickup.note.isNotEmpty) lines.add(pickup.note);
    } else {
      label = l10n.prqBringTo;
      final location = request.location;
      if (location != null) {
        lines.addAll(
          [location.label, location.address].where((s) => s.isNotEmpty),
        );
      }
      if (request.plannedDate.isNotEmpty) {
        lines.add(
          l10n.prqPlannedFor(requestDayText(request.plannedDate, locale)),
        );
        final day = requestDayFromKey(request.plannedDate);
        final hours = day == null ? null : location?.hours?.forDate(day);
        if (hours != null) {
          lines.add(
            hours.open
                ? l10n.prqHoursRange(
                    requestClockText(hours.from, locale),
                    requestClockText(hours.to, locale),
                  )
                : l10n.prqClosedThatDay,
          );
        }
      }
    }
    return RequestCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 2),
          for (final line in lines)
            Text(
              line,
              style: const TextStyle(
                fontSize: 14,
                height: 1.35,
                color: AppColors.ink,
              ),
            ),
        ],
      ),
    );
  }
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/business_price_list.dart' show priceSnapshotWeighs;
import '../services/eastern_clock.dart' show easternWall;
import '../services/package_request_compare.dart';
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/day_picker.dart';
import '../widgets/guest_tracking_lookup.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_request_compare_widgets.dart';
import '../widgets/package_request_widgets.dart';
import '../widgets/pay_now_widgets.dart';

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
    this.onOpenLink,
    this.clock = DateTime.now,
  });

  final String requestId;
  final String token;
  final PackageRequestService? service;

  /// Opens the card page of Pay now; the browser when null. Answers whether
  /// it opened.
  final Future<bool> Function(String url)? onOpenLink;

  /// Now; tests set it.
  final DateTime Function() clock;

  /// Opens the tracking page for a code; the public lookup when null.
  final void Function(BuildContext context, String code)? onTrack;

  /// Dials a phone number; the phone app when null.
  final Future<void> Function(String phone)? onCall;

  @override
  State<PackageRequestDetailScreen> createState() =>
      _PackageRequestDetailScreenState();
}

class _PackageRequestDetailScreenState extends State<PackageRequestDetailScreen>
    with WidgetsBindingObserver {
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

  /// Back from the card page: read the request again, so "Paid online" shows
  /// without a pull to refresh.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        _token.isNotEmpty &&
        _request?.payNow != null) {
      unawaited(_fetch());
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
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
    WidgetsBinding.instance.removeObserver(this);
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

  /// "Pick a new time": a new drop-off day and window for an open bring-in.
  Future<void> _reschedule(PackageRequest request) async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy.isNotEmpty || _token.isEmpty) return;
    final outcome = await showLotSheet<Object?>(
      context,
      _RescheduleSheet(
        request: request,
        service: _service,
        token: _token,
        clock: widget.clock,
      ),
    );
    if (outcome == null || !mounted) return;
    if (outcome is RequestFailure) {
      AppHaptics.refuse();
      showErrorSnackBar(context, requestRefusalText(l10n, outcome.refusal));
    } else {
      AppHaptics.commit();
      showSuccessSnackBar(context, l10n.spkRescheduleDone);
    }
    await _fetch();
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

  /// "Pay now": opens the card page. Optional - the request stands without it.
  Future<void> _pay(PackageRequest request) async {
    final l10n = AppLocalizations.of(context)!;
    final url = request.payNow?.linkUrl ?? '';
    if (_busy.isNotEmpty || url.isEmpty) return;
    setState(() => _busy = 'pay');
    var opened = false;
    try {
      final open = widget.onOpenLink;
      opened = open != null
          ? await open(url)
          : await launchUrl(
              Uri.parse(url),
              mode: LaunchMode.externalApplication,
            );
    } catch (_) {
      opened = false;
    } finally {
      if (mounted) setState(() => _busy = '');
    }
    if (!opened && mounted) showErrorSnackBar(context, l10n.payNowOpenFailed);
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
        RequestCard(child: RequestPriceTable(request: request, explain: true)),
        CustomerPayNowCard(
          request: request,
          busy: _busy == 'pay',
          onPay: () => _pay(request),
        ),
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
                // A price the customer agreed to in the form is not an
                // estimate; what is weighed at the counter still moves it.
                if (request.confirmedVia != 'form')
                  l10n.prqNotBinding
                else if (request.pieces.any(
                  (p) => priceSnapshotWeighs(p.price),
                ))
                  l10n.spkSendWeighed,
              ].join(' '),
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: AppColors.muted,
              ),
            ),
          ),
        RequestSectionTitle(l10n.prqWhereWhen),
        _WhereWhen(
          request: request,
          locale: locale,
          onReschedule:
              request.isOpen &&
                  request.isBringIn &&
                  request.location?.hours != null &&
                  _token.isNotEmpty
              ? () => _reschedule(request)
              : null,
        ),
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
            : request.confirmedVia == 'form'
            ? l10n.spkStateConfirmedForm
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
  const _WhereWhen({
    required this.request,
    required this.locale,
    this.onReschedule,
  });

  final PackageRequest request;
  final String locale;

  /// "Pick a new time"; null when the request cannot be moved.
  final VoidCallback? onReschedule;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final language = Localizations.localeOf(context).languageCode;
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
        final range = requestPickupRange(window);
        final windowText = range == null
            ? requestWindowLabel(l10n, window)
            : requestWindowShortText(range.from, range.to, language) ?? window;
        lines.add(
          window.isEmpty
              ? requestDayText(day, locale)
              : l10n.prqDayWindow(requestDayText(day, locale), windowText),
        );
      }
      final fee = pickup?.feeCents;
      if (fee != null && fee > 0) {
        lines.add(l10n.spkPickupFeeLine(formatRequestCents(fee)));
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
        final window = request.plannedWindow;
        final windowText = window == null
            ? null
            : requestWindowShortText(window.from, window.to, language);
        final dayText = requestDayText(request.plannedDate, locale);
        lines.add(
          windowText == null
              ? l10n.prqPlannedFor(dayText)
              : l10n.spkPlannedForWindow(dayText, windowText),
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
          if (request.shipMode.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              l10n.spkShippingLabel,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 2),
            Text(
              request.isAirRequest ? l10n.spkModeByAir : l10n.spkModeBySea,
              key: const Key('request-ship-mode'),
              style: const TextStyle(fontSize: 14, color: AppColors.ink),
            ),
          ],
          if (onReschedule != null) ...[
            const SizedBox(height: AppSpacing.sm),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                key: const Key('request-reschedule'),
                onPressed: onReschedule,
                icon: const Icon(Icons.event_repeat_outlined, size: 18),
                label: Text(l10n.spkReschedule),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// "Pick a new time": a day the shop is open and one of its 2-hour windows.
/// Pops the [RequestRescheduled] answer, or the [RequestFailure] of a refusal
/// that ends the request's chance of moving.
class _RescheduleSheet extends StatefulWidget {
  const _RescheduleSheet({
    required this.request,
    required this.service,
    required this.token,
    required this.clock,
  });

  final PackageRequest request;
  final PackageRequestService service;
  final String token;
  final DateTime Function() clock;

  @override
  State<_RescheduleSheet> createState() => _RescheduleSheetState();
}

class _RescheduleSheetState extends State<_RescheduleSheet> {
  String _day = '';
  String _window = '';
  String _error = '';
  bool _busy = false;

  DateTime get _today => requestToday(widget.clock());

  List<RequestTimeWindow> _windowsOn(DateTime day) {
    final hours = widget.request.location?.hours?.forDate(day);
    if (hours == null) return const [];
    final wall = easternWall(widget.clock());
    final isToday = requestDayKey(day) == requestDayKey(_today);
    return dropOffWindows(
      hours,
      afterMinutes: isToday ? wall.hour * 60 + wall.minute : null,
    );
  }

  Future<void> _chooseDay() async {
    final today = _today;
    final picked = await pickCalendarDay(
      context,
      initial: requestDayFromKey(_day) ?? today,
      first: today,
      last: requestLastPlannedDay(today),
      selectable: (day) => _windowsOn(day).isNotEmpty,
    );
    if (picked == null || !mounted) return;
    setState(() {
      _day = requestDayKey(picked);
      _window = '';
      _error = '';
    });
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final parts = _window.split('-');
    if (_busy) return;
    if (_day.isEmpty || parts.length != 2) {
      setState(
        () => _error = _day.isEmpty
            ? requestReasonText(l10n, 'planned_date_invalid') ?? ''
            : l10n.spkErrWindow,
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final result = await widget.service
          .reschedule(
            token: widget.token,
            plannedDate: _day,
            window: RequestTimeWindow(from: parts[0], to: parts[1]),
          )
          .timeout(const Duration(seconds: 25));
      if (!mounted) return;
      Navigator.of(context).pop(result);
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      // A request that closed or changed kind cannot be moved: leave.
      if (failure.refusal.has('request_closed') ||
          failure.refusal.has('handoff_invalid')) {
        Navigator.of(context).pop(failure);
        return;
      }
      setState(() => _error = requestRefusalText(l10n, failure.refusal));
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = l10n.prqErrGeneric);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final language = Localizations.localeOf(context).languageCode;
    final day = requestDayFromKey(_day);
    final windows = day == null ? null : _windowsOn(day);
    return LotSheetShell(
      title: l10n.spkReschedule,
      subtitle: l10n.spkWindowNote,
      footer: RequestPrimaryButton(
        key: const Key('request-reschedule-save'),
        label: l10n.spkRescheduleSave,
        busyLabel: l10n.prqSending,
        busy: _busy,
        onTap: _save,
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          LotPickerField(
            key: const Key('request-reschedule-day'),
            label: l10n.prqPlannedDay,
            value: _day.isEmpty ? null : requestDayText(_day, locale),
            placeholder: l10n.prqPickDay,
            onTap: _chooseDay,
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            l10n.spkWindowTitle,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 6),
          if (windows == null)
            Text(
              l10n.spkPickDayFirst,
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            )
          else if (windows.isEmpty)
            Text(
              l10n.spkNoWindowsLeft,
              style: const TextStyle(fontSize: 13, color: AppColors.errorRed),
            )
          else
            RequestWindowChips(
              keyPrefix: 'request-reschedule-window',
              windows: windows,
              selected: _window,
              languageCode: language,
              onChanged: (w) => setState(() {
                _window = requestWindowKey(w);
                _error = '';
              }),
            ),
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.md),
              child: Text(
                _error,
                key: const Key('request-reschedule-error'),
                style: const TextStyle(fontSize: 13, color: AppColors.errorRed),
              ),
            ),
        ],
      ),
    );
  }
}

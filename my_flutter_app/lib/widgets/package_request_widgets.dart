/// The words and small pieces every package-request screen shares: status
/// labels, pieces in words, days and hours, refusals in both languages, the
/// reason dialog and the photo thumbnails.
library;

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../screens/containers_screen.dart' show containerErrorText;
import '../services/container_manifest.dart' show containerRefusalCodes;
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import 'app_back_button.dart';
import 'lot_sheets.dart';

// ---------------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------------

String requestPieceKindLabel(AppLocalizations l10n, String kind) =>
    switch (kind) {
      requestPieceBarrel => l10n.prqKindBarrel,
      requestPieceBox => l10n.prqKindBox,
      _ => l10n.prqKindOther,
    };

IconData requestPieceKindIcon(String kind) => switch (kind) {
  requestPieceBarrel => Icons.propane_tank_outlined,
  requestPieceBox => Icons.inventory_2_outlined,
  _ => Icons.category_outlined,
};

/// What a piece is, in a word or the customer's own.
String requestPieceTitle(AppLocalizations l10n, RequestPiece piece) =>
    piece.description.isNotEmpty
    ? piece.description
    : requestPieceKindLabel(l10n, piece.kind);

/// "2 barrels · 1 box" - only the kinds there are.
String requestPiecesSummary(AppLocalizations l10n, PieceCounts counts) {
  final parts = [
    if (counts.barrels > 0) l10n.prqBarrelsCount(counts.barrels),
    if (counts.boxes > 0) l10n.prqBoxesCount(counts.boxes),
    if (counts.others > 0) l10n.prqOthersCount(counts.others),
  ];
  return parts.isEmpty ? l10n.prqPiecesCount(0) : parts.join(' · ');
}

String requestWindowLabel(AppLocalizations l10n, String window) =>
    switch (window) {
      requestWindowMorning => l10n.prqWindowMorning,
      requestWindowAfternoon => l10n.prqWindowAfternoon,
      requestWindowEvening => l10n.prqWindowEvening,
      _ => window,
    };

/// "Sat, Oct 24" / "sam. 24 oct." for a day key; the key itself when it is
/// not a day, so nothing vanishes.
String requestDayText(String dayKey, String locale) {
  final day = requestDayFromKey(dayKey);
  return day == null ? dayKey : displayWeekdayMonthDay(day, locale);
}

/// "9:00 AM" / "09:00" for "HH:MM".
String requestClockText(String hhmm, String locale) {
  final minutes = requestMinutesOf(hhmm);
  if (minutes == null) return hhmm;
  return displayTime(DateTime(2026, 1, 1, minutes ~/ 60, minutes % 60), locale);
}

/// The status as a customer reads it.
String requestStatusLabel(
  AppLocalizations l10n,
  String status, {
  bool forCustomer = false,
}) => switch (status) {
  requestStatusNew => l10n.prqStatusNew,
  requestStatusEstimateSent => l10n.prqStatusEstimateSent,
  requestStatusConfirmed => l10n.prqStatusConfirmed,
  requestStatusReceived => l10n.prqStatusReceived,
  requestStatusDeclined => l10n.prqStatusDeclined,
  requestStatusCustomerDeclined =>
    forCustomer ? l10n.prqStatusYouDeclined : l10n.prqStatusCustomerDeclined,
  requestStatusCancelled => l10n.prqStatusCancelled,
  requestStatusExpired => l10n.prqStatusExpired,
  _ => l10n.prqStatusNew,
};

Color requestStatusTone(String status) => switch (status) {
  requestStatusNew => AppColors.warn,
  requestStatusEstimateSent => AppColors.cobalt,
  requestStatusConfirmed => AppColors.sage,
  requestStatusReceived => AppColors.cobaltDeep,
  _ => AppColors.muted,
};

/// One History line's action in words.
String requestHistoryText(AppLocalizations l10n, RequestHistoryEntry entry) =>
    switch (entry.action) {
      'submitted' => l10n.prqActSubmitted,
      'estimate_sent' => l10n.prqActEstimateSent(
        entry.version ?? 0,
        formatRequestCents(entry.totalCents ?? 0),
      ),
      'confirmed_link' => l10n.prqActConfirmedLink,
      'confirmed_phone' => l10n.prqActConfirmedPhone,
      'confirmed_card' => l10n.prqActConfirmedCard,
      'customer_declined' => l10n.prqActCustomerDeclined,
      'declined' => l10n.prqActDeclined,
      'cancelled' => l10n.prqActCancelled,
      'expired' => l10n.prqActExpired,
      'received' => l10n.prqActReceived,
      'lock_taken_over' => l10n.prqActLockTakenOver,
      'reminder_sent' => l10n.prqActReminderSent,
      _ => l10n.prqActOther,
    };

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

/// A refusal reason in our words, or null when this app does not know it.
String? requestReasonText(AppLocalizations l10n, String reason) =>
    switch (reason) {
      'business_not_found' => l10n.prqErrBusinessNotFound,
      'business_unavailable' => l10n.prqErrBusinessUnavailable,
      'requests_off' => l10n.prqErrRequestsOff,
      'destination_unavailable' => l10n.prqErrDestinationUnavailable,
      'bring_in_unavailable' => l10n.prqErrBringInUnavailable,
      'collect_unavailable' => l10n.prqErrCollectUnavailable,
      'handoff_invalid' => l10n.prqErrHandoff,
      'location_invalid' => l10n.prqErrLocation,
      'planned_date_invalid' => l10n.prqErrPlannedDate,
      'planned_day_closed' => l10n.prqErrPlannedDayClosed,
      'pickup_address_required' => l10n.prqErrPickupAddress,
      'pickup_date_invalid' => l10n.prqErrPickupDate,
      'pickup_window_invalid' => l10n.prqErrPickupWindow,
      'sender_name_required' => l10n.prqErrSenderName,
      'sender_phone_invalid' => l10n.prqErrSenderPhone,
      'receiver_name_required' => l10n.prqErrReceiverName,
      'receiver_phone_invalid' => l10n.prqErrReceiverPhone,
      'pieces_required' => l10n.prqErrPiecesRequired,
      'too_many_pieces' => l10n.prqErrTooManyPieces,
      'piece_kind_invalid' => l10n.prqErrPieceKind,
      'piece_description_required' => l10n.prqErrPieceDescription,
      'text_too_long' => l10n.prqErrTextTooLong,
      'size_invalid' => l10n.wpkErrSizeInvalid,
      'too_many_photos' => l10n.prqErrTooManyPhotos,
      'photo_invalid' => l10n.prqErrPhotoInvalid,
      'photo_too_large' => l10n.prqPhotoTooLarge,
      'language_invalid' || 'idempotency_key_invalid' => l10n.prqErrGeneric,
      'rate_limited' => l10n.prqErrRateLimited,
      'request_not_found' => l10n.prqErrNotFound,
      'estimate_changed' => l10n.prqChangedBanner,
      'estimate_missing' => l10n.prqErrEstimateMissing,
      'request_closed' => l10n.prqClosed,
      'card_order' => l10n.prqErrCardOrder,
      'slug_invalid' => l10n.prqErrSlugInvalid,
      'slug_taken' => l10n.prqErrSlugTaken,
      'slug_locked' => l10n.prqSlugLocked,
      'slug_missing' => l10n.prqLinkNone,
      'hours_invalid' => l10n.prqErrHoursInvalid,
      'location_unknown' => l10n.prqErrLocationUnknown,
      'pickup_areas_required' => l10n.prqErrPickupAreas,
      'estimate_locked' => l10n.prqErrLocked,
      'estimate_stale' => l10n.prqStaleBanner,
      'estimate_piece_missing' => l10n.prqErrPieceMissing,
      'estimate_piece_unknown' => l10n.prqErrPieceUnknown,
      'amount_invalid' || 'price_invalid' => l10n.prqPriceInvalid,
      'pickup_fee_invalid' => l10n.prqErrPickupFee,
      'pickup_schedule_invalid' => l10n.prqErrPickupSchedule,
      'reason_required' => l10n.prqErrReasonRequired,
      'price_required' => l10n.prqPriceAllOrNone,
      // The payment taken at Received follows addWaitingPackage's rules
      // and reasons: those already have words.
      _ when containerRefusalCodes.contains(reason) => containerErrorText(
        l10n,
        reason,
      ),
      _ => null,
    };

/// A refusal in our words: its first known reason (with the lock holder's
/// name when it is the lock), else what its code means.
String requestRefusalText(AppLocalizations l10n, RequestRefusal refusal) {
  if (refusal.has('estimate_locked') && refusal.lockedByName.isNotEmpty) {
    return l10n.prqLockedBy(refusal.lockedByName);
  }
  for (final reason in refusal.reasons) {
    final text = requestReasonText(l10n, reason);
    if (text != null) return text;
  }
  return switch (requestFailureKind(refusal.code)) {
    RequestFailureKind.offline => l10n.prqErrOffline,
    RequestFailureKind.appCheck => l10n.prqErrAppCheck,
    RequestFailureKind.permission => l10n.prqErrPermission,
    RequestFailureKind.notFound => l10n.prqErrNotFound,
    RequestFailureKind.rateLimited => l10n.prqErrRateLimited,
    RequestFailureKind.generic => l10n.prqErrGeneric,
  };
}

/// Any error from a request call, in our words.
String requestErrorText(AppLocalizations l10n, Object error) =>
    error is RequestFailure
    ? requestRefusalText(l10n, error.refusal)
    : l10n.prqErrGeneric;

// ---------------------------------------------------------------------------
// Small pieces of UI.
// ---------------------------------------------------------------------------

class RequestStatusPill extends StatelessWidget {
  const RequestStatusPill({
    super.key,
    required this.status,
    this.forCustomer = false,
  });

  final String status;
  final bool forCustomer;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final color = requestStatusTone(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        requestStatusLabel(l10n, status, forCustomer: forCustomer),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.2,
          color: color,
        ),
      ),
    );
  }
}

/// A small coloured note: a lock, "Paid online", "not reachable".
class RequestBadge extends StatelessWidget {
  const RequestBadge({
    super.key,
    required this.icon,
    required this.label,
    this.color = AppColors.cobaltDeep,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11.5,
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

/// A banner across the top of a section: information, or a warning.
class RequestBanner extends StatelessWidget {
  const RequestBanner({
    super.key,
    required this.text,
    this.icon = Icons.info_outline,
    this.color = AppColors.cobaltDeep,
    this.action,
  });

  final String text;
  final IconData icon;
  final Color color;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 18, color: color),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  text,
                  style: TextStyle(
                    fontSize: 13.5,
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                    color: color,
                  ),
                ),
              ),
            ],
          ),
          if (action != null) ...[
            const SizedBox(height: AppSpacing.sm),
            Align(alignment: Alignment.centerRight, child: action!),
          ],
        ],
      ),
    );
  }
}

/// A section title inside a request screen.
class RequestSectionTitle extends StatelessWidget {
  const RequestSectionTitle(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.lg, bottom: AppSpacing.sm),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w700,
          color: AppColors.ink,
        ),
      ),
    );
  }
}

/// A white card holding one part of a request screen.
class RequestCard extends StatelessWidget {
  const RequestCard({super.key, required this.child, this.color});

  final Widget child;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    // A Material, not a coloured box: switches and list tiles inside paint
    // their ink on it.
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Material(
        color: color ?? AppColors.paper,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          side: const BorderSide(color: AppColors.rule),
        ),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: SizedBox(width: double.infinity, child: child),
        ),
      ),
    );
  }
}

/// The pieces with their prices and the total: the estimate as the customer
/// reads it, and the summary staff see.
class RequestPriceTable extends StatelessWidget {
  const RequestPriceTable({super.key, required this.request});

  final PackageRequest request;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final estimate = request.estimate;
    TextStyle style({bool strong = false}) => TextStyle(
      fontSize: strong ? 15 : 14,
      fontWeight: strong ? FontWeight.w700 : FontWeight.w500,
      color: AppColors.ink,
    );
    Widget row(String label, String value, {bool strong = false, Key? key}) =>
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(label, style: style(strong: strong)),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                value,
                key: key,
                style: style(strong: strong),
              ),
            ],
          ),
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final piece in request.pieces)
          row(
            requestPieceTitle(l10n, piece),
            switch (estimate?.pieceCents[piece.id]) {
              final int cents => formatRequestCents(cents),
              null => l10n.prqPriceToCome,
            },
          ),
        if (estimate?.pickupFeeCents case final int fee when fee > 0)
          row(l10n.prqPickupFee, formatRequestCents(fee)),
        const Divider(height: AppSpacing.lg, color: AppColors.rule),
        row(
          l10n.prqTotal,
          estimate == null
              ? l10n.prqPriceToCome
              : formatRequestCents(estimate.totalCents),
          strong: true,
          key: const Key('request-total'),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Asking for a reason.
// ---------------------------------------------------------------------------

/// Asks for a reason in a dialog. Answers the text, or null when dismissed.
/// With [required] the confirm button waits for a reason.
Future<String?> askRequestReason(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool required = true,
  bool destructive = true,
}) {
  return showDialog<String>(
    context: context,
    builder: (_) => _ReasonDialog(
      title: title,
      message: message,
      confirmLabel: confirmLabel,
      required: required,
      destructive: destructive,
    ),
  );
}

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({
    required this.title,
    required this.message,
    required this.confirmLabel,
    required this.required,
    required this.destructive,
  });

  final String title;
  final String message;
  final String confirmLabel;
  final bool required;
  final bool destructive;

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _reason = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    final l10n = AppLocalizations.of(context)!;
    final problem = reasonProblem(_reason.text, required: widget.required);
    if (problem != null) {
      setState(() => _error = requestReasonText(l10n, problem));
      return;
    }
    Navigator.of(context).pop(_reason.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.message),
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('request-reason'),
              controller: _reason,
              maxLines: 3,
              minLines: 1,
              maxLength: requestMaxReason,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
              decoration: InputDecoration(
                labelText: widget.required
                    ? l10n.prqReasonLabel
                    : l10n.prqReasonOptional,
                errorText: _error,
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: const Key('request-reason-confirm'),
          style: FilledButton.styleFrom(
            backgroundColor: widget.destructive
                ? AppColors.errorRed
                : AppColors.cobaltDeep,
            foregroundColor: Colors.white,
          ),
          onPressed: _submit,
          child: Text(widget.confirmLabel),
        ),
      ],
    );
  }
}

/// A collect request's pickup note, labelled ("Note: ring twice"), under the
/// pickup line of every staff card (Requests, Expected, the estimate and
/// Received). Nothing when there is none.
class RequestPickupNote extends StatelessWidget {
  const RequestPickupNote({super.key, required this.request});

  final PackageRequest request;

  @override
  Widget build(BuildContext context) {
    final note = request.pickupNote;
    if (note.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Text(
        AppLocalizations.of(context)!.prqPickupNoteLine(note),
        key: ValueKey('request-pickup-note:${request.id}'),
        style: const TextStyle(
          fontSize: 12.5,
          height: 1.35,
          fontStyle: FontStyle.italic,
          color: AppColors.ink,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Photos (staff and the uploader only).
// ---------------------------------------------------------------------------

/// A request photo by its Storage path, the download URL looked up once per
/// widget (never in build).
class RequestPhotoThumb extends StatefulWidget {
  const RequestPhotoThumb({
    super.key,
    required this.path,
    required this.service,
    this.size = 56,
    this.onTap,
  });

  final String path;
  final PackageRequestService service;
  final double size;
  final VoidCallback? onTap;

  @override
  State<RequestPhotoThumb> createState() => _RequestPhotoThumbState();
}

class _RequestPhotoThumbState extends State<RequestPhotoThumb> {
  late Future<String> _url = widget.service.photoUrl(widget.path);

  @override
  void didUpdateWidget(RequestPhotoThumb oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.path != widget.path) {
      _url = widget.service.photoUrl(widget.path);
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: widget.onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        child: Container(
          width: widget.size,
          height: widget.size,
          color: AppColors.parchment,
          child: FutureBuilder<String>(
            future: _url,
            builder: (context, snap) {
              final url = snap.data;
              if (url == null || url.isEmpty) {
                return Icon(
                  snap.hasError
                      ? Icons.broken_image_outlined
                      : Icons.image_outlined,
                  size: 20,
                  color: AppColors.muted,
                );
              }
              return Image.network(
                url,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => const Icon(
                  Icons.broken_image_outlined,
                  size: 20,
                  color: AppColors.muted,
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

/// The photos full screen, swiped one by one, pinch to zoom.
Future<void> showRequestPhotos(
  BuildContext context, {
  required List<String> paths,
  required PackageRequestService service,
  int initial = 0,
}) {
  return Navigator.of(context).push(
    MaterialPageRoute<void>(
      fullscreenDialog: true,
      builder: (_) =>
          _RequestPhotoViewer(paths: paths, service: service, initial: initial),
    ),
  );
}

class _RequestPhotoViewer extends StatefulWidget {
  const _RequestPhotoViewer({
    required this.paths,
    required this.service,
    required this.initial,
  });

  final List<String> paths;
  final PackageRequestService service;
  final int initial;

  @override
  State<_RequestPhotoViewer> createState() => _RequestPhotoViewerState();
}

class _RequestPhotoViewerState extends State<_RequestPhotoViewer> {
  late final PageController _pages = PageController(
    initialPage: widget.initial,
  );
  late int _index = widget.initial;
  late final List<Future<String>> _urls = [
    for (final p in widget.paths) widget.service.photoUrl(p),
  ];

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(
          l10n.prqPhotoOf(_index + 1, widget.paths.length),
          style: const TextStyle(fontSize: 16),
        ),
      ),
      body: PageView.builder(
        controller: _pages,
        itemCount: widget.paths.length,
        onPageChanged: (i) => setState(() => _index = i),
        itemBuilder: (context, i) => FutureBuilder<String>(
          future: _urls[i],
          builder: (context, snap) {
            final url = snap.data;
            if (url == null) {
              return Center(
                child: snap.hasError
                    ? const Icon(
                        Icons.broken_image_outlined,
                        color: Colors.white54,
                        size: 40,
                      )
                    : const CircularProgressIndicator(color: Colors.white),
              );
            }
            return InteractiveViewer(
              maxScale: 5,
              child: Center(child: Image.network(url, fit: BoxFit.contain)),
            );
          },
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// The page frame every request screen uses.
// ---------------------------------------------------------------------------

/// The header of a request screen: back, a title, an optional line under it
/// and an optional action - the Waiting list's own header, so the screens
/// read as one family.
class RequestPageHeader extends StatelessWidget {
  const RequestPageHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
    this.bottom,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;
  final Widget? bottom;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border(
          bottom: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            4,
            4,
            AppSpacing.md,
            AppSpacing.md,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const AppBackButton(),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w700,
                            height: 1.1,
                            letterSpacing: -0.4,
                            color: AppColors.ink,
                          ),
                        ),
                        if (subtitle != null && subtitle!.isNotEmpty)
                          Text(
                            subtitle!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12,
                              height: 1.3,
                              color: AppColors.muted,
                            ),
                          ),
                      ],
                    ),
                  ),
                  ?trailing,
                ],
              ),
              if (bottom != null)
                Padding(
                  padding: const EdgeInsets.only(
                    left: AppSpacing.md,
                    top: AppSpacing.md,
                  ),
                  child: bottom!,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A full-width primary action that refuses repeat taps and shows its busy
/// label while [busy].
class RequestPrimaryButton extends StatelessWidget {
  const RequestPrimaryButton({
    super.key,
    required this.label,
    required this.onTap,
    this.busy = false,
    this.busyLabel,
    this.destructive = false,
  });

  final String label;
  final VoidCallback? onTap;
  final bool busy;
  final String? busyLabel;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    return LotSheetButton(
      label: label,
      busy: busy,
      busyLabel: busyLabel,
      tone: destructive ? LotTone.warn : LotTone.neutral,
      onTap: busy ? null : onTap,
    );
  }
}

/// A failed load with a Retry.
class RequestLoadFailed extends StatelessWidget {
  const RequestLoadFailed({
    super.key,
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.cloud_off_outlined,
            size: 30,
            color: AppColors.muted,
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            message,
            key: const Key('request-load-failed'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14, color: AppColors.ink),
          ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton(
            key: const Key('request-retry'),
            onPressed: onRetry,
            child: Text(l10n.prqRetry),
          ),
        ],
      ),
    );
  }
}

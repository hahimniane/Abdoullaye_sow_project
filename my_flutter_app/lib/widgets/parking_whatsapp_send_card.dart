import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/parking_whatsapp.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import 'async_action_button.dart';
import 'parking_whatsapp_switch.dart' show parkingWhatsAppErrorText;

/// The words for the last-message line (docs/PARKING_LEFT_WHATSAPP.md §4):
/// "WhatsApp: sent Nov 9, 2026 2:05 PM", "WhatsApp: not delivered. Check the
/// number.", in the reader's language, with the date in the reader's style.
String parkingWhatsAppLineText(
  AppLocalizations l10n,
  ParkingWhatsAppLastStatus? last,
  String locale,
) {
  switch (parkingWhatsAppLineOf(last)) {
    case ParkingWhatsAppLine.none:
      return l10n.parkingWaLastNone;
    case ParkingWhatsAppLine.queued:
      return l10n.parkingWaLastQueued;
    case ParkingWhatsAppLine.failed:
      return l10n.parkingWaLastFailed;
    case ParkingWhatsAppLine.stopped:
      return l10n.parkingWaLastStopped;
    case ParkingWhatsAppLine.sent:
      final at = last?.at;
      // A sent message with no time still says it went.
      return at == null
          ? l10n.parkingWaStatusSent
          : l10n.parkingWaLastSent(displayDateTime(at, locale));
  }
}

/// "Sent on WhatsApp." and its failures, in the reader's language. [result]
/// whose status this app cannot read is a generic failure, never a success.
String parkingWhatsAppSendResultText(
  AppLocalizations l10n,
  ParkingWhatsAppSendResult result,
) => switch (result.status) {
  ParkingMessageStatus.sent => l10n.parkingWaSendSent,
  ParkingMessageStatus.failed => l10n.parkingWaSendFailed,
  ParkingMessageStatus.stopped => l10n.parkingWaSendStopped,
  _ => l10n.parkingWaSendError,
};

/// "Send on WhatsApp" on a parked car's details, with the line saying how the
/// car's last message went. Hidden unless [parkingWhatsAppSendOffered]: the
/// business switch is on, the viewer is parking staff, and the car is a lot's
/// own walk-up that is not a team member's and not voided.
///
/// The server is the authority: a refusal (`details.reason`) is shown in words,
/// and a failure from Meta arrives as an answer, shown with what Meta said.
/// The last-message line is best-effort - a failed read leaves it out - and the
/// button never waits on it. Bump [refresh] to read the line again (after an
/// edit that makes the server resend).
class ParkingWhatsAppSendCard extends StatefulWidget {
  const ParkingWhatsAppSendCard({
    super.key,
    required this.businessId,
    required this.carId,
    required this.switchOn,
    required this.canSend,
    required this.isBusinessEntry,
    required this.isTeamCar,
    required this.isVoided,
    this.refresh = 0,
    this.service,
    this.timeout = const Duration(seconds: 60),
  });

  final String businessId;
  final String carId;
  final bool switchOn;
  final bool canSend;
  final bool isBusinessEntry;
  final bool isTeamCar;
  final bool isVoided;

  /// A counter: each change reads the last message again.
  final int refresh;

  /// Injectable so a widget test answers without Firebase.
  final ParkingWhatsAppService? service;
  final Duration timeout;

  @override
  State<ParkingWhatsAppSendCard> createState() =>
      _ParkingWhatsAppSendCardState();
}

class _ParkingWhatsAppSendCardState extends State<ParkingWhatsAppSendCard> {
  ParkingWhatsAppLastStatus? _last;

  /// The line stays out until the first read has answered, so it never
  /// flashes "nothing sent yet" over a car that has a message.
  bool _lastKnown = false;
  int _reads = 0;

  /// What the last press did: the text, and whether it is good news.
  String _resultText = '';
  String _resultDetail = '';
  bool _resultOk = false;

  bool get _offered => parkingWhatsAppSendOffered(
    switchOn: widget.switchOn,
    canSend: widget.canSend,
    isBusinessEntry: widget.isBusinessEntry,
    isTeamCar: widget.isTeamCar,
    isVoided: widget.isVoided,
  );

  ParkingWhatsAppService get _service =>
      widget.service ?? FirebaseParkingWhatsAppService();

  @override
  void initState() {
    super.initState();
    if (_offered) unawaited(_readLast());
  }

  @override
  void didUpdateWidget(ParkingWhatsAppSendCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_offered) return;
    final wasOffered = parkingWhatsAppSendOffered(
      switchOn: oldWidget.switchOn,
      canSend: oldWidget.canSend,
      isBusinessEntry: oldWidget.isBusinessEntry,
      isTeamCar: oldWidget.isTeamCar,
      isVoided: oldWidget.isVoided,
    );
    if (!wasOffered || oldWidget.refresh != widget.refresh) {
      unawaited(_readLast());
    }
  }

  /// Reads the last message. Only the newest read may land, and a failure just
  /// keeps what the line already said.
  Future<void> _readLast() async {
    final read = ++_reads;
    try {
      final last = await _service
          .lastStatus(businessId: widget.businessId, carId: widget.carId)
          .timeout(widget.timeout);
      if (!mounted || read != _reads) return;
      setState(() {
        _last = last;
        _lastKnown = true;
      });
    } catch (error) {
      debugPrint('Parking WhatsApp status read failed: $error');
    }
  }

  Future<void> _send() async {
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _resultText = '';
      _resultDetail = '';
    });
    String text;
    String detail = '';
    bool ok = false;
    // The server answered (sent, failed or stopped): a row was written. A
    // refusal or a dropped call wrote nothing.
    bool answered = false;
    try {
      final result = await _service
          .sendOnWhatsApp(businessId: widget.businessId, carId: widget.carId)
          .timeout(widget.timeout);
      text = parkingWhatsAppSendResultText(l10n, result);
      ok = result.sent;
      answered = result.status != null;
      if (result.status == ParkingMessageStatus.failed) {
        detail = result.error;
      }
    } catch (error) {
      text = parkingWhatsAppErrorText(
        l10n,
        error,
        fallback: l10n.parkingWaSendError,
      );
    }
    if (!mounted) return;
    setState(() {
      _resultText = text;
      _resultDetail = detail;
      _resultOk = ok;
    });
    if (answered) unawaited(_readLast());
  }

  @override
  Widget build(BuildContext context) {
    if (!_offered) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context).textTheme;
    final locale = dateLocaleOf(context);
    final lineProblem =
        parkingWhatsAppLineOf(_last) == ParkingWhatsAppLine.failed;
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xl),
      child: Container(
        key: const Key('parking-whatsapp-send'),
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_lastKnown)
              Row(
                key: const Key('parking-whatsapp-last'),
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.chat_outlined,
                    size: 18,
                    color: lineProblem ? AppColors.errorRed : AppColors.sage,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      parkingWhatsAppLineText(l10n, _last, locale),
                      style: theme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: lineProblem ? AppColors.errorRed : null,
                      ),
                    ),
                  ),
                ],
              ),
            if (_lastKnown) const SizedBox(height: AppSpacing.md),
            AsyncActionButton.outlined(
              key: const Key('parking-whatsapp-send-button'),
              onPressed: _send,
              icon: Icons.send_outlined,
              label: l10n.parkingWaSendButton,
              loadingLabel: l10n.parkingWaSendSending,
            ),
            if (_resultText.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              Text(
                _resultText,
                key: const Key('parking-whatsapp-result'),
                style: theme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: _resultOk ? AppColors.sage : AppColors.errorRed,
                ),
              ),
              if (_resultDetail.isNotEmpty)
                Text(
                  _resultDetail,
                  key: const Key('parking-whatsapp-result-detail'),
                  style: theme.bodySmall?.copyWith(color: AppColors.muted),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

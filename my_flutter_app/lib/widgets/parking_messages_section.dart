import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/parking_whatsapp.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';

/// The words for a message's kind.
String parkingMessageKindText(AppLocalizations l10n, ParkingMessageKind kind) =>
    switch (kind) {
      ParkingMessageKind.parked => l10n.parkingWaKindParked,
      ParkingMessageKind.receipt => l10n.parkingWaKindReceipt,
      ParkingMessageKind.welcome => l10n.parkingWaKindWelcome,
    };

/// What to tell the lot about a message: its status, refined by what WhatsApp
/// later reported for a sent one (delivered / read / failed).
String parkingMessageStatusText(AppLocalizations l10n, ParkingMessage m) {
  if (m.status == ParkingMessageStatus.sent) {
    switch (m.deliveryStatus) {
      case 'read':
        return l10n.parkingWaStatusRead;
      case 'delivered':
        return l10n.parkingWaStatusDelivered;
      case 'failed':
        return l10n.parkingWaStatusFailed;
    }
  }
  return switch (m.status) {
    ParkingMessageStatus.queued => l10n.parkingWaStatusQueued,
    ParkingMessageStatus.sent => l10n.parkingWaStatusSent,
    ParkingMessageStatus.failed => l10n.parkingWaStatusFailed,
    ParkingMessageStatus.stopped => l10n.parkingWaStatusStopped,
    ParkingMessageStatus.skipped => l10n.parkingWaStatusSkipped,
  };
}

bool _isProblem(ParkingMessage m) =>
    m.status == ParkingMessageStatus.failed ||
    (m.status == ParkingMessageStatus.sent && m.deliveryStatus == 'failed');

/// "WhatsApp messages" on a parked car's details: what the customer was sent
/// (the welcome, each payment receipt), when, and how it went - with the
/// failure reason when there is one. Hidden while there is nothing to show,
/// still loading, or the read is refused (customers cannot read these rows).
class ParkingMessagesSection extends StatefulWidget {
  const ParkingMessagesSection({
    super.key,
    required this.parkedCarId,
    this.businessId = '',
    this.messages,
  });

  final String parkedCarId;
  final String businessId;

  /// Overrides the Firestore read; a widget test passes its own.
  final Stream<List<ParkingMessage>>? messages;

  @override
  State<ParkingMessagesSection> createState() => _ParkingMessagesSectionState();
}

class _ParkingMessagesSectionState extends State<ParkingMessagesSection> {
  StreamSubscription<List<ParkingMessage>>? _sub;
  List<ParkingMessage> _rows = const [];

  @override
  void initState() {
    super.initState();
    if (widget.parkedCarId.isEmpty) return;
    try {
      _sub =
          (widget.messages ??
                  parkingMessagesStream(
                    parkedCarId: widget.parkedCarId,
                    businessId: widget.businessId,
                  ))
              .listen(
                (rows) {
                  if (mounted) setState(() => _rows = rows);
                },
                onError: (Object error) {
                  debugPrint('Parking messages read failed: $error');
                  if (mounted) setState(() => _rows = const []);
                },
              );
    } catch (error) {
      debugPrint('Parking messages read failed: $error');
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_rows.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final locale = dateLocaleOf(context);
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xl),
      child: Container(
        key: const Key('parking-messages'),
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.chat_outlined,
                  size: 20,
                  color: AppColors.sage,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    l10n.parkingWaMessagesTitle,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
            for (final message in _rows) ...[
              const SizedBox(height: AppSpacing.md),
              _MessageRow(message: message, l10n: l10n, locale: locale),
            ],
          ],
        ),
      ),
    );
  }
}

class _MessageRow extends StatelessWidget {
  const _MessageRow({
    required this.message,
    required this.l10n,
    required this.locale,
  });

  final ParkingMessage message;
  final AppLocalizations l10n;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context).textTheme;
    final problem = _isProblem(message);
    final at = message.at == null ? '' : displayDateTime(message.at!, locale);
    return Row(
      key: Key('parking-message-${message.id}'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                parkingMessageKindText(l10n, message.kind),
                style: theme.bodyMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              if (at.isNotEmpty || message.phone.isNotEmpty)
                Text(
                  [at, message.phone].where((p) => p.isNotEmpty).join(' · '),
                  style: theme.bodySmall?.copyWith(color: AppColors.lightMuted),
                ),
              if (message.error.isNotEmpty)
                Text(
                  message.error,
                  style: theme.bodySmall?.copyWith(color: AppColors.errorRed),
                ),
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Text(
          parkingMessageStatusText(l10n, message),
          style: theme.bodySmall?.copyWith(
            fontWeight: FontWeight.w800,
            color: problem
                ? AppColors.errorRed
                : message.status == ParkingMessageStatus.sent
                ? AppColors.sage
                : AppColors.lightMuted,
          ),
        ),
      ],
    );
  }
}

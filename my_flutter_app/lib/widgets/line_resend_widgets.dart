import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/line_resend.dart';
import '../services/waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';

/// Why "Send again" could not, in words staff can act on.
String resendRefusalText(AppLocalizations l10n, ResendRefusal refusal) =>
    switch (refusal) {
      ResendRefusal.notConfigured => l10n.shpResendNotConnected,
      ResendRefusal.noUpdate => l10n.shpResendNoMessage,
      ResendRefusal.other => l10n.shpResendFailed,
    };

/// "Send again" beside a WhatsApp update that did not arrive
/// (docs/WHATSAPP_RESEND.md): the server sends the line's latest update
/// again to the people it failed to reach - never to someone it already
/// reached. Shows progress while it works, says what happened, and always
/// releases. Nothing is drawn for a line with no id.
class SendAgainButton extends StatefulWidget {
  const SendAgainButton({
    super.key,
    required this.businessId,
    required this.lineId,
    this.send = callContainerCallable,
  });

  final String businessId;
  final String lineId;

  /// How the request reaches the server; a fake in tests.
  final ContainerCallableCaller send;

  @override
  State<SendAgainButton> createState() => _SendAgainButtonState();
}

enum _Again { idle, busy, done, nothing }

class _SendAgainButtonState extends State<SendAgainButton> {
  _Again _state = _Again.idle;
  ResendRefusal? _refusal;

  Future<void> _sendAgain() async {
    if (_state == _Again.busy) return;
    final request = resendRequest(widget.businessId, widget.lineId);
    if (request == null) return;
    setState(() {
      _state = _Again.busy;
      _refusal = null;
    });
    try {
      final data = await widget.send(resendCallable, request);
      if (!mounted) return;
      final result = ResendResult.fromCallable(data);
      AppHaptics.commit();
      setState(
        () => _state = result.nothingToSend ? _Again.nothing : _Again.done,
      );
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      final details = error.details;
      final reason = details is Map ? details['reason']?.toString() : null;
      setState(() {
        _refusal = resendRefusalOf(reason);
        _state = _Again.idle;
      });
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() {
        _refusal = ResendRefusal.other;
        _state = _Again.idle;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (resendRequest(widget.businessId, widget.lineId) == null) {
      return const SizedBox.shrink();
    }
    final l10n = AppLocalizations.of(context)!;
    final refusal = _refusal;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_state == _Again.done)
          Text(
            l10n.shpResendDone,
            key: const Key('send-again-done'),
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.sage,
            ),
          )
        else if (_state == _Again.nothing)
          Text(
            l10n.shpResendNothing,
            key: const Key('send-again-nothing'),
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          )
        else
          TextButton.icon(
            key: Key('send-again:${widget.lineId}'),
            onPressed: _state == _Again.busy ? null : _sendAgain,
            icon: _state == _Again.busy
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh, size: 16),
            label: Text(
              _state == _Again.busy ? l10n.shpResending : l10n.shpSendAgain,
            ),
            style: TextButton.styleFrom(
              visualDensity: VisualDensity.compact,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(0, 36),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ),
        if (refusal != null)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              resendRefusalText(l10n, refusal),
              key: const Key('send-again-error'),
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
          ),
      ],
    );
  }
}

/// The counter warning: WhatsApp could not deliver a just-saved package's
/// message. Staff check the number with the customer and fix it on the
/// package (the corrected number is sent the message by itself), or send it
/// again as it is. [onFix] opens the package's edit; null hides "Fix the
/// number" (inside the edit itself).
class CounterAlertsBox extends StatelessWidget {
  const CounterAlertsBox({
    super.key,
    required this.alerts,
    required this.businessId,
    this.onFix,
    this.send = callContainerCallable,
  });

  final List<CounterAlert> alerts;
  final String businessId;
  final ValueChanged<String>? onFix;
  final ContainerCallableCaller send;

  @override
  Widget build(BuildContext context) {
    if (alerts.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('counter-alerts'),
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.errorRed.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.errorRed.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.shpCounterTitle,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.errorRed,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            l10n.shpCounterHint,
            style: const TextStyle(fontSize: 12, height: 1.35),
          ),
          for (final alert in alerts) ...[
            const SizedBox(height: AppSpacing.sm),
            Column(
              key: Key(
                'counter-alert:${alert.lineId}:'
                '${alert.isReceiver ? 'receiver' : 'sender'}',
              ),
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  [
                    alert.isReceiver
                        ? l10n.waPackageReceiver
                        : l10n.waPackageSender,
                    alert.phone.isEmpty ? '—' : alert.phone,
                    if (alert.trackingCode.isNotEmpty) alert.trackingCode,
                  ].join(' · '),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (alert.failure.isNotEmpty)
                  Text(
                    alert.failure,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.muted,
                    ),
                  ),
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: AppSpacing.sm,
                  children: [
                    if (onFix != null)
                      TextButton.icon(
                        key: Key('counter-fix:${alert.lineId}'),
                        onPressed: () => onFix!(alert.lineId),
                        icon: const Icon(Icons.edit_outlined, size: 16),
                        label: Text(l10n.shpFixNumber),
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          minimumSize: const Size(0, 36),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                      ),
                    SendAgainButton(
                      businessId: businessId,
                      lineId: alert.lineId,
                      send: send,
                    ),
                  ],
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

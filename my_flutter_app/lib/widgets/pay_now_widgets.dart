/// Pay now on a package request (docs/PACKAGE_BOX_SIZES_PAY_NOW.md §3): the
/// optional "Pay now $X" card the customer sees, and the chip, "Send the
/// link again" and "Refund" the business sees. Thin glue over the pure rules
/// in `package_requests.dart` (`RequestPayNow`, `payNowBalanceCents`, ...).
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/business_price_list.dart' show priceCentsInput;
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'package_request_widgets.dart';

/// What the customer sees: a "Pay now $X" button while the link is open
/// (always optional), "Paid online $X" and "Refunded $Y" after, "Balance due
/// at the counter" when the total rose past what the card paid.
class CustomerPayNowCard extends StatelessWidget {
  const CustomerPayNowCard({
    super.key,
    required this.request,
    required this.onPay,
    this.busy = false,
  });

  final PackageRequest request;
  final VoidCallback onPay;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final payNow = request.payNow;
    if (payNow == null) return const SizedBox.shrink();
    final balance = payNowBalanceCents(request.totalCents, payNow);
    if (payNow.canPay) {
      return RequestCard(
        key: const Key('pay-now-card'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            RequestPrimaryButton(
              key: const Key('pay-now-button'),
              label: l10n.payNowButton(formatRequestCents(payNow.amountCents)),
              busyLabel: l10n.payNowOpening,
              busy: busy,
              onTap: onPay,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              l10n.payNowOptional,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: AppColors.muted,
              ),
            ),
          ],
        ),
      );
    }
    if (payNow.wasPaid) {
      return RequestCard(
        key: const Key('pay-now-paid'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.check_circle_outline,
                  size: 18,
                  color: AppColors.sage,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    l10n.payNowPaid(formatRequestCents(payNow.paidCents)),
                    key: const Key('pay-now-paid-text'),
                    style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                ),
              ],
            ),
            if (payNow.refundedCents > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  l10n.payNowRefunded(formatRequestCents(payNow.refundedCents)),
                  key: const Key('pay-now-refunded-text'),
                  style: const TextStyle(fontSize: 13.5, color: AppColors.warn),
                ),
              ),
            if (balance > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  l10n.payNowBalance(formatRequestCents(balance)),
                  key: const Key('pay-now-balance'),
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ),
          ],
        ),
      );
    }
    if (payNow.isCancelled) {
      return Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Text(
          l10n.payNowCancelled,
          key: const Key('pay-now-cancelled'),
          style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
        ),
      );
    }
    return const SizedBox.shrink();
  }
}

/// What the business sees on a request: where the card link stands (Link
/// sent / Paid online / Refunded), "Send the link again", and - for people
/// who may - "Refund". When the total fell below what the card paid it asks
/// whether to refund the difference.
class BusinessPayNowSection extends StatelessWidget {
  const BusinessPayNowSection({
    super.key,
    required this.request,
    required this.canRefund,
    required this.onResend,
    required this.onRefund,
    this.busy = '',
  });

  final PackageRequest request;
  final bool canRefund;

  /// '' / 'resend' / 'refund': what is running now.
  final String busy;
  final VoidCallback onResend;

  /// Called with the amount to suggest in the refund dialog.
  final ValueChanged<int> onRefund;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final payNow = request.payNow;
    if (payNow == null) return const SizedBox.shrink();
    final over = payNowOverpaidCents(request.totalCents, payNow);
    final balance = payNowBalanceCents(request.totalCents, payNow);
    final refundable = payNowRefundableCents(payNow);
    final working = busy.isNotEmpty;
    return Column(
      key: const Key('pay-now-section'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (over > 0 && canRefund)
          RequestBanner(
            key: const Key('pay-now-over'),
            text: l10n.payNowRefundDifference(formatRequestCents(over)),
            icon: Icons.undo,
            color: AppColors.warn,
            action: FilledButton(
              key: const Key('pay-now-refund-difference'),
              onPressed: working ? null : () => onRefund(over),
              child: Text(l10n.payNowRefund),
            ),
          ),
        RequestCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  if (payNow.isOpen)
                    RequestBadge(
                      key: const Key('pay-now-chip'),
                      icon: Icons.send_outlined,
                      label: l10n.payNowChipSent,
                      color: AppColors.cobalt,
                    ),
                  if (payNow.wasPaid)
                    RequestBadge(
                      key: const Key('pay-now-chip'),
                      icon: Icons.check_circle_outline,
                      label: l10n.payNowPaid(
                        formatRequestCents(payNow.paidCents),
                      ),
                      color: AppColors.sage,
                    ),
                  if (payNow.refundedCents > 0)
                    RequestBadge(
                      key: const Key('pay-now-chip-refunded'),
                      icon: Icons.undo,
                      label: l10n.payNowRefunded(
                        formatRequestCents(payNow.refundedCents),
                      ),
                      color: AppColors.warn,
                    ),
                  if (payNow.isCancelled)
                    RequestBadge(
                      key: const Key('pay-now-chip'),
                      icon: Icons.link_off,
                      label: l10n.payNowCancelled,
                      color: AppColors.muted,
                    ),
                ],
              ),
              if (balance > 0)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.sm),
                  child: Text(
                    l10n.payNowBalance(formatRequestCents(balance)),
                    key: const Key('pay-now-balance'),
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                ),
              if (payNow.isOpen || (canRefund && refundable > 0))
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.sm),
                  child: Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      if (payNow.isOpen)
                        OutlinedButton.icon(
                          key: const Key('pay-now-resend'),
                          onPressed: working ? null : onResend,
                          icon: busy == 'resend'
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.send_outlined, size: 18),
                          label: Text(l10n.payNowResend),
                        ),
                      if (canRefund && refundable > 0)
                        OutlinedButton.icon(
                          key: const Key('pay-now-refund'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppColors.errorRed,
                          ),
                          onPressed: working
                              ? null
                              : () => onRefund(refundable),
                          icon: busy == 'refund'
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.undo, size: 18),
                          label: Text(l10n.payNowRefund),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// What the refund dialog answers.
class PayNowRefundChoice {
  const PayNowRefundChoice({required this.cents, required this.reason});

  final int cents;
  final String reason;
}

/// Asks how much to refund (up to [maxCents], [suggestedCents] filled in)
/// and why. Answers null when dismissed.
Future<PayNowRefundChoice?> showPayNowRefundDialog(
  BuildContext context, {
  required int maxCents,
  required int suggestedCents,
}) {
  return showDialog<PayNowRefundChoice>(
    context: context,
    builder: (_) =>
        _RefundDialog(maxCents: maxCents, suggestedCents: suggestedCents),
  );
}

class _RefundDialog extends StatefulWidget {
  const _RefundDialog({required this.maxCents, required this.suggestedCents});

  final int maxCents;
  final int suggestedCents;

  @override
  State<_RefundDialog> createState() => _RefundDialogState();
}

class _RefundDialogState extends State<_RefundDialog> {
  late final TextEditingController _amount = TextEditingController(
    text: priceCentsInput(widget.suggestedCents.clamp(1, widget.maxCents)),
  );
  final _reason = TextEditingController();
  String _error = '';

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  void _confirm(AppLocalizations l10n) {
    final cents = parseRefundCents(_amount.text, widget.maxCents);
    if (cents == null) {
      final typed = parseRefundCents(_amount.text, 1 << 40);
      setState(
        () => _error = typed == null
            ? l10n.payNowErrInvalid
            : l10n.payNowErrTooMuch,
      );
      return;
    }
    Navigator.of(
      context,
    ).pop(PayNowRefundChoice(cents: cents, reason: _reason.text.trim()));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AlertDialog(
      title: Text(l10n.payNowRefundTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.payNowRefundMessage(formatRequestCents(widget.maxCents)),
              style: const TextStyle(fontSize: 13.5, height: 1.35),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('pay-now-refund-amount'),
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              ],
              onChanged: (_) {
                if (_error.isNotEmpty) setState(() => _error = '');
              },
              decoration: InputDecoration(
                labelText: l10n.payNowRefundAmount,
                prefixText: r'$ ',
                errorText: _error.isEmpty ? null : _error,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              key: const Key('pay-now-refund-reason'),
              controller: _reason,
              maxLength: requestMaxReason,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                labelText: l10n.payNowRefundReason,
                counterText: '',
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
        ),
        FilledButton(
          key: const Key('pay-now-refund-confirm'),
          style: FilledButton.styleFrom(backgroundColor: AppColors.errorRed),
          onPressed: () => _confirm(l10n),
          child: Text(l10n.payNowRefund),
        ),
      ],
    );
  }
}

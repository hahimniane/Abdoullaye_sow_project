import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/waiting_packages.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

/// The chip's words for where a package stands on money.
String packagePaymentStatusLabel(
  AppLocalizations l10n,
  PackagePaymentStatus status,
) =>
    switch (status) {
      PackagePaymentStatus.noPrice => l10n.wpkPayNoPrice,
      PackagePaymentStatus.unpaid => l10n.wpkPayUnpaid,
      PackagePaymentStatus.partial => l10n.wpkPayPartial,
      PackagePaymentStatus.paid => l10n.wpkPayPaid,
      PackagePaymentStatus.payOnArrival => l10n.wpkPayOnArrival,
    };

Color _tone(PackagePaymentStatus status) => switch (status) {
      PackagePaymentStatus.noPrice => AppColors.muted,
      PackagePaymentStatus.unpaid => AppColors.warn,
      PackagePaymentStatus.partial => AppColors.cobalt,
      PackagePaymentStatus.paid => AppColors.sage,
      PackagePaymentStatus.payOnArrival => AppColors.cobaltDeep,
    };

/// Unpaid / Partial / Paid / Pay on arrival as a small coloured chip - the
/// same four words the console shows, in the same order of colours.
class PackagePaymentChip extends StatelessWidget {
  const PackagePaymentChip({super.key, required this.payment});

  final PackagePayment payment;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final color = _tone(payment.status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        packagePaymentStatusLabel(l10n, payment.status),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
          color: color,
        ),
      ),
    );
  }
}

/// The chip, what has been paid of the price, and what is still owed. Shows
/// nothing for a package nobody priced (most lines on a container predate
/// prices) unless [alwaysShow] - a waiting package can always be priced.
class PackageMoneyLine extends StatelessWidget {
  const PackageMoneyLine({
    super.key,
    required this.payment,
    this.alwaysShow = false,
  });

  final PackagePayment payment;
  final bool alwaysShow;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (payment.status == PackagePaymentStatus.noPrice && !alwaysShow) {
      return const SizedBox.shrink();
    }
    final price = payment.priceCents;
    final balance = payment.balanceCents;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 8,
        runSpacing: 2,
        children: [
          PackagePaymentChip(payment: payment),
          if (price != null)
            Text(
              l10n.wpkPaidOfPrice(
                formatLotCents(payment.paidCents),
                formatLotCents(price),
              ),
              key: const Key('package-paid-of-price'),
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
          if (balance != null && balance > 0)
            Text(
              l10n.wpkStillOwed(formatLotCents(balance)),
              key: const Key('package-still-owed'),
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
        ],
      ),
    );
  }
}

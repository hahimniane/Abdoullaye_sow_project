import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/business_parking_entry.dart';
import '../theme/app_colors.dart';

/// "Paid" or "Not paid", loud enough to read without opening the record.
///
/// The owner scanning the parked-car list could not tell a settled walk-up
/// from an unsettled one: the payment state was a line of body text that
/// looked like every other line. A filled badge in the card header fixes that.
///
/// The decision is not made here - [businessParkingPaymentTone] owns it, so
/// the console and the app agree on what "paid" means, and the rule stays
/// testable without a widget tree.
class BusinessParkingPaymentBadge extends StatelessWidget {
  const BusinessParkingPaymentBadge({super.key, required this.paymentFields});

  /// The raw parked-car document fields (`source`, `paymentStatus`, `status`).
  final Map<String, dynamic> paymentFields;

  @override
  Widget build(BuildContext context) {
    final tone = businessParkingPaymentTone(paymentFields);
    if (tone == BusinessParkingPaymentTone.none) {
      return const SizedBox.shrink();
    }

    final l10n = AppLocalizations.of(context)!;
    final isPaid = tone == BusinessParkingPaymentTone.paid;

    // AppColors.brandRed is an alias for the teal brand colour, so an unpaid
    // badge painted with it would read as a success - see
    // test/error_feedback_colour_test.dart. Amber (`warn`) carries dark ink
    // text and green (`sage`) carries white, which is what each fill can
    // legibly hold.
    final background = isPaid ? AppColors.sage : AppColors.warn;
    final foreground = isPaid ? AppColors.paper : AppColors.ink;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isPaid ? Icons.check_circle : Icons.schedule,
            size: 14,
            color: foreground,
          ),
          const SizedBox(width: 5),
          Text(
            isPaid ? l10n.paid : l10n.notPaid,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.2,
              color: foreground,
            ),
          ),
        ],
      ),
    );
  }
}

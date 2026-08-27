import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/marketplace_disclosure_acceptance.dart';
import '../theme/app_colors.dart';

Future<MarketplaceDisclosureAcceptance?> confirmMarketplaceTransaction(
  BuildContext context, {
  required String providerNames,
  required String transactionSummary,
  String? additionalBody,
  bool showHoldNotice = false,
}) async {
  return showDialog<MarketplaceDisclosureAcceptance>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _MarketplaceTransactionDisclosureDialog(
      providerNames: providerNames,
      transactionSummary: transactionSummary,
      additionalBody: additionalBody,
      showHoldNotice: showHoldNotice,
    ),
  );
}

class _MarketplaceTransactionDisclosureDialog extends StatefulWidget {
  const _MarketplaceTransactionDisclosureDialog({
    required this.providerNames,
    required this.transactionSummary,
    this.additionalBody,
    this.showHoldNotice = false,
  });

  final String providerNames;
  final String transactionSummary;
  final String? additionalBody;

  /// Booking payments hold the money instead of charging it. The customer
  /// has to hear that before they pay - on the screen, not behind an "i" -
  /// so hold flows turn this on and pay-now flows (settlement, extensions)
  /// leave it off.
  final bool showHoldNotice;

  @override
  State<_MarketplaceTransactionDisclosureDialog> createState() =>
      _MarketplaceTransactionDisclosureDialogState();
}

class _MarketplaceTransactionDisclosureDialogState
    extends State<_MarketplaceTransactionDisclosureDialog> {
  bool _accepted = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = Localizations.localeOf(context).languageCode;
    return AlertDialog(
      icon: const Icon(Icons.handshake_outlined, color: AppColors.cobaltDeep),
      title: Text(l10n.marketplaceResponsibilityTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (widget.transactionSummary.trim().isNotEmpty) ...[
              Text(
                widget.transactionSummary,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 12),
            ],
            Text(
              l10n.marketplaceProviderResponsibilityBody(
                widget.providerNames.trim().isEmpty
                    ? l10n.selectedBusiness
                    : widget.providerNames.trim(),
              ),
            ),
            const SizedBox(height: 10),
            Text(l10n.marketplacePaymentFlowBody),
            const SizedBox(height: 10),
            Text(l10n.marketplaceNoGuaranteeBody),
            if (widget.showHoldNotice) ...[
              const SizedBox(height: 10),
              Text(
                l10n.paymentHoldNotice,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ],
            if (widget.additionalBody != null &&
                widget.additionalBody!.trim().isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                widget.additionalBody!,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ],
            const SizedBox(height: 12),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _accepted,
              onChanged: (value) => setState(() => _accepted = value ?? false),
              title: Text(l10n.marketplaceResponsibilityCheckbox),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed: _accepted
              ? () => Navigator.pop(
                  context,
                  MarketplaceDisclosureAcceptance(locale: locale),
                )
              : null,
          child: Text(l10n.continueToPayment),
        ),
      ],
    );
  }
}

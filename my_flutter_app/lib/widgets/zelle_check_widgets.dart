import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/eastern_clock.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/zelle_check.dart';
import '../theme/app_colors.dart';
import '../utils/date_display.dart';
import 'inventory_widgets.dart' show InventoryChip;

/// What a refused bank call says, in the reader's language.
String zelleFailureText(AppLocalizations l10n, ZelleCheckFailure failure) =>
    switch (failure) {
      ZelleCheckFailure.bankNotConnected => l10n.zelleNotConnectedTitle,
      ZelleCheckFailure.bankNeedsReauth => l10n.zelleNeedsReauthTitle,
      ZelleCheckFailure.notZelle => l10n.zelleFailNotZelle,
      ZelleCheckFailure.recordNotFound => l10n.zelleFailRecordNotFound,
      ZelleCheckFailure.recordVoided => l10n.zelleFailRecordVoided,
      ZelleCheckFailure.bankOwnerRequired => l10n.zelleFailOwnerRequired,
      ZelleCheckFailure.windowInvalid => l10n.zelleFailWindowInvalid,
      ZelleCheckFailure.network => l10n.zelleFailNetwork,
      ZelleCheckFailure.noPermission => l10n.inventoryFailNoPermission,
      ZelleCheckFailure.deviceNotVerified =>
        l10n.inventoryFailDeviceNotVerified,
      ZelleCheckFailure.unknown => l10n.inventoryFailUnknown,
    };

/// A deposit's time on the shop's clock (New York), 12-hour.
String zelleTimeLabel(DateTime? at, String locale) =>
    at == null ? '' : displayTime(easternWallAsLocal(at), locale);

/// "Received ✓ $60.00 · 2:43 PM · FATOU D." - the parts the bank gave.
String zelleConfirmationLine(
  AppLocalizations l10n,
  ZelleConfirmation confirmation,
  String locale,
) => [
  l10n.zelleReceivedAmount(formatLotCents(confirmation.amountCents)),
  if (confirmation.at != null) zelleTimeLabel(confirmation.at, locale),
  if (confirmation.senderName.isNotEmpty) confirmation.senderName,
].join(' · ');

/// "Bank ✓": the payment was found in the owner's bank.
class ZelleConfirmedChip extends StatelessWidget {
  const ZelleConfirmedChip({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return InventoryChip(label: l10n.zelleChipConfirmed, color: AppColors.sage);
  }
}

/// "Check Zelle", compact enough to sit under a payment row.
class ZelleCheckButton extends StatelessWidget {
  const ZelleCheckButton({super.key, required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return TextButton.icon(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.symmetric(horizontal: 8),
      ),
      icon: const Icon(Icons.account_balance_outlined, size: 16),
      label: Text(l10n.zelleCheckButton),
    );
  }
}

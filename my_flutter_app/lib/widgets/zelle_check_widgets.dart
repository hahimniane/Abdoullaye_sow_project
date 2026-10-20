import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/bank_check.dart';
import '../services/eastern_clock.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/zelle_check.dart';
import '../theme/app_colors.dart';
import '../utils/date_display.dart';
import 'inventory_widgets.dart' show InventoryChip;

/// What a refused bank call says, in the reader's language.
String zelleFailureText(
  AppLocalizations l10n,
  ZelleCheckFailure failure,
) => switch (failure) {
  ZelleCheckFailure.bankNotConnected => l10n.zelleNotConnectedTitle,
  ZelleCheckFailure.bankNeedsReauth => l10n.zelleNeedsReauthTitle,
  ZelleCheckFailure.notZelle => l10n.zelleFailNotZelle,
  ZelleCheckFailure.recordNotFound => l10n.zelleFailRecordNotFound,
  ZelleCheckFailure.recordVoided => l10n.zelleFailRecordVoided,
  ZelleCheckFailure.bankOwnerRequired => l10n.zelleFailOwnerRequired,
  ZelleCheckFailure.windowInvalid => l10n.zelleFailWindowInvalid,
  ZelleCheckFailure.bankAccessDenied => l10n.zelleFailBankAccessDenied,
  ZelleCheckFailure.kindInvalid => l10n.zelleFailKindInvalid,
  ZelleCheckFailure.platformInvalid => l10n.zelleFailPlatformInvalid,
  ZelleCheckFailure.publicTokenRequired => l10n.bankLinkFailed,
  ZelleCheckFailure.noDepositoryAccount => l10n.zelleFailNoDepositoryAccount,
  ZelleCheckFailure.candidateInvalid => l10n.zelleFailCandidateInvalid,
  ZelleCheckFailure.candidateTaken => l10n.zelleFailCandidateTaken,
  ZelleCheckFailure.bankError => l10n.zelleFailBankError,
  ZelleCheckFailure.amountMismatch => l10n.zelleFailAmountMismatch,
  ZelleCheckFailure.checkAmountInvalid => l10n.zelleFailCheckAmountInvalid,
  ZelleCheckFailure.sinceInvalid => l10n.zelleFailSinceInvalid,
  ZelleCheckFailure.modeInvalid => l10n.zelleFailModeInvalid,
  ZelleCheckFailure.limitInvalid => l10n.zelleFailLimitInvalid,
  ZelleCheckFailure.storeNotAllowed => l10n.inventoryFailStoreNotAllowed,
  ZelleCheckFailure.network => l10n.zelleFailNetwork,
  ZelleCheckFailure.noPermission => l10n.inventoryFailNoPermission,
  ZelleCheckFailure.deviceNotVerified => l10n.inventoryFailDeviceNotVerified,
  ZelleCheckFailure.unknown => l10n.inventoryFailUnknown,
};

/// When a deposit landed: its time on the shop's clock (New York, 12-hour),
/// or - when the bank gave a date only ([timeKnown] false) - just that date,
/// month first. Never a made-up time.
String zelleTimeLabel(DateTime? at, String locale, {bool timeKnown = true}) {
  if (at == null) return '';
  if (!timeKnown) return displayDate(zelleDepositDay(at), locale);
  return displayTime(easternWallAsLocal(at), locale);
}

/// "Received ✓ $60.00 · 2:43 PM · FATOU D." - the parts the bank gave.
String zelleConfirmationLine(
  AppLocalizations l10n,
  ZelleConfirmation confirmation,
  String locale,
) => [
  l10n.zelleReceivedAmount(formatLotCents(confirmation.amountCents)),
  if (confirmation.at != null)
    zelleTimeLabel(confirmation.at, locale, timeKnown: confirmation.timeKnown),
  if (confirmation.senderName.isNotEmpty) confirmation.senderName,
].join(' · ');

/// "Received ✓ $60.00 · 2:43 PM · FATOU D." for a deposit Check bank found
/// (date only when the bank gave no time).
String bankDepositLine(
  AppLocalizations l10n,
  BankDeposit deposit,
  String locale,
) => zelleConfirmationLine(
  l10n,
  ZelleConfirmation(
    amountCents: deposit.amountCents,
    at: deposit.at,
    timeKnown: deposit.timeKnown,
    senderName: deposit.senderName,
  ),
  locale,
);

/// "Sale", "Credit payment", "Package payment".
String bankUseKindLabel(AppLocalizations l10n, ZelleCheckKind kind) =>
    switch (kind) {
      ZelleCheckKind.inventorySale => l10n.bankUseKindSale,
      ZelleCheckKind.inventoryCreditPayment => l10n.bankUseKindCreditPayment,
      ZelleCheckKind.containerLinePayment => l10n.bankUseKindPackagePayment,
    };

/// When a payment was recorded, on the shop's clock (New York), date and
/// time.
String bankRecordTimeLabel(DateTime? at, String locale) =>
    at == null ? '' : displayDateTime(easternWallAsLocal(at), locale);

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

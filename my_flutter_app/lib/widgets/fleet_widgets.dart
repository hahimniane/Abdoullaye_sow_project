import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'day_picker.dart';

// The small pieces every Fleet screen shares: the refusal words, a card, a
// chip, the form sheet, the day field, and the one call-and-report helper
// (busy flag that always clears, refusal sentence in the person's language).

/// The refusal in words: the server's reason, else offline / not allowed /
/// something went wrong. Never the server's English message.
String fleetRefusalText(AppLocalizations l10n, FleetFailure failure) {
  switch (failure.reason) {
    case 'fleet_off':
      return l10n.fltRefusalOff;
    case 'fleet_admin_only':
      return l10n.fltRefusalAdminOnly;
    case 'fleet_not_found':
      return l10n.fltRefusalNotFound;
    case 'fleet_car_taken':
      return l10n.fltRefusalCarTaken;
    case 'fleet_bad_input':
      return l10n.fltRefusalBadInput;
    case 'fleet_no_amount':
      return l10n.fltRefusalNoAmount;
    case 'fleet_already_undone':
      return l10n.fltRefusalAlreadyUndone;
    case 'fleet_not_open':
      return l10n.fltRefusalNotOpen;
    case 'fleet_reason_required':
      return l10n.fltRefusalReasonRequired;
    case 'fleet_import_locked':
      return l10n.fltRefusalImportLocked;
    case 'fleet_friend_overlap':
      return l10n.fltRefusalFriendOverlap;
    case 'fleet_note_empty':
      return l10n.fltRefusalNoteEmpty;
    case 'fleet_note_voided':
      return l10n.fltRefusalNoteVoided;
    case 'fleet_bad_file':
      return l10n.fltRefusalBadFile;
    case 'fleet_deposit_used':
      return l10n.fltRefusalDepositUsed;
    case 'fleet_no_bank':
      return l10n.fltRefusalNoBank;
    case 'fleet_bad_phone':
      return l10n.fltRefusalBadPhone;
    case 'fleet_whatsapp_off':
      return l10n.fltRefusalWhatsappOff;
    case 'fleet_nothing_owed':
      return l10n.fltRefusalNothingOwed;
    case 'fleet_no_phone':
      return l10n.fltRefusalNoPhone;
    case 'fleet_driver_left':
      return l10n.fltRefusalDriverLeft;
    case 'fleet_staff_only':
      return l10n.fltRefusalStaffOnly;
    case 'fleet_claim_closed':
      return l10n.fltRefusalClaimClosed;
    case 'fleet_claim_no_driver':
      return l10n.fltRefusalClaimNoDriver;
    case 'fleet_deposit_not_waiting':
      return l10n.fltRefusalDepositNotWaiting;
    case 'fleet_bad_name':
      return failure.name.isEmpty
          ? l10n.fltRefusalBadName
          : l10n.fltRefusalBadNameNamed(failure.name);
    case 'fleet_zelle_missing':
      return l10n.fltRefusalZelleMissing;
    case 'fleet_car_overlap':
      return l10n.fltRefusalCarOverlap;
    case 'fleet_already_returned':
      return l10n.fltRefusalAlreadyReturned;
    case 'fleet_driver_has_plate':
      return l10n.fltRefusalDriverHasPlate;
  }
  if (failure.offline) return l10n.fltErrOffline;
  if (failure.notAllowed) return l10n.fltRefusalStaffOnly;
  return l10n.fltErrUnknown;
}

/// Why a bank deposit waits, in the office's words.
String fleetWaitingReasonText(AppLocalizations l10n, String reason) {
  switch (reason) {
    case 'shared_payer':
      return l10n.fltWaitingSharedPayer;
    case 'undone':
      return l10n.fltWaitingUndone;
    case 'possible_duplicate':
      return l10n.fltWaitingDuplicate;
    case 'not_zelle':
      return l10n.fltWaitingNotZelle;
    case 'driver_left':
      return l10n.fltWaitingDriverLeft;
    case 'own_transfer':
      return l10n.fltWaitingOwnTransfer;
  }
  return l10n.fltWaitingUnknown;
}

/// What an open payment claim waits for, in the office's words.
String fleetClaimSentenceText(AppLocalizations l10n, FleetClaimSentence s) =>
    switch (s) {
      FleetClaimSentence.askingDriver => l10n.fltClaimAskingDriver,
      FleetClaimSentence.askingAmount => l10n.fltClaimAskingAmount,
      FleetClaimSentence.askingName => l10n.fltClaimAskingName,
      FleetClaimSentence.waitingBank => l10n.fltClaimWaitingBank,
      FleetClaimSentence.noDepositAfterTwoDays => l10n.fltClaimNoDeposit2Days,
      FleetClaimSentence.wrongRecipient => l10n.fltClaimWrongRecipient,
      FleetClaimSentence.depositTaken => l10n.fltClaimDepositTaken,
      FleetClaimSentence.tooOld => l10n.fltClaimTooOld,
      FleetClaimSentence.notADriver => l10n.fltClaimNotADriver,
      FleetClaimSentence.twoClaims => l10n.fltClaimTwoClaims,
      FleetClaimSentence.noAmount => l10n.fltClaimNoAmount,
      FleetClaimSentence.noDeposit => l10n.fltClaimNoDeposit,
      FleetClaimSentence.paymentUndone => l10n.fltClaimPaymentUndone,
      FleetClaimSentence.needsPerson => l10n.fltClaimNeedsPerson,
      FleetClaimSentence.none => '',
    };

/// The words for a payment method.
String fleetMethodText(AppLocalizations l10n, String method) {
  switch (method) {
    case 'zelle':
      return l10n.fltMethodZelle;
    case 'cash':
      return l10n.fltMethodCash;
    case 'import':
      return l10n.fltMethodImport;
  }
  return l10n.fltMethodOther;
}

/// Runs one Fleet call from a sheet or page: [busy] is true while it runs and
/// ALWAYS clears (answer, refusal, error), a refusal becomes [error] in words,
/// and a second tap while busy does nothing.
mixin FleetRun<T extends StatefulWidget> on State<T> {
  bool busy = false;
  String? error;

  Future<Map<String, dynamic>?> runFleet(
    FleetService service,
    Map<String, Object?> request,
  ) async {
    if (busy) return null;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      return await service.call(request);
    } on FleetFailure catch (failure) {
      if (mounted) {
        setState(
          () =>
              error = fleetRefusalText(AppLocalizations.of(context)!, failure),
        );
      }
      return null;
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}

/// Spinner until the first answer, a message with Retry when the read failed
/// and nothing came, else [child]. Always resolves (the controller times out).
class FleetStateGate extends StatelessWidget {
  const FleetStateGate({
    super.key,
    required this.controller,
    required this.child,
  });

  final FleetController controller;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final s = controller.state;
    final empty = s.data.drivers.isEmpty && s.data.cars.isEmpty;
    if (s.loading && empty) {
      return const Center(
        child: CircularProgressIndicator(key: Key('fleet-loading')),
      );
    }
    if (s.error && empty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.fltLoadFailed, textAlign: TextAlign.center),
              const SizedBox(height: AppSpacing.md),
              OutlinedButton(
                key: const Key('fleet-retry'),
                onPressed: controller.retry,
                child: Text(l10n.fltRetry),
              ),
            ],
          ),
        ),
      );
    }
    return child;
  }
}

/// A bordered block with 16 px inside on every side; content never touches
/// the edge.
class FleetCard extends StatelessWidget {
  const FleetCard({
    super.key,
    this.title,
    this.action,
    required this.child,
    this.onTap,
  });

  final String? title;
  final Widget? action;
  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppSpacing.radiusMd);
    // A Material, so list tiles and switches inside keep their ink.
    return Material(
      color: AppColors.paper,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: const BorderSide(color: AppColors.rule),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: SizedBox(
            width: double.infinity,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (title != null || action != null) ...[
                  // A Wrap, not a Row: a long French title and its action
                  // stack instead of running off a narrow phone.
                  Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    runSpacing: 2,
                    children: [
                      if (title != null)
                        Text(
                          title!,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                            color: AppColors.ink,
                          ),
                        ),
                      ?action,
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                child,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

enum FleetTone { ok, warn, bad, muted }

class FleetChip extends StatelessWidget {
  const FleetChip({
    super.key,
    required this.label,
    this.tone = FleetTone.muted,
  });

  final String label;
  final FleetTone tone;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      FleetTone.ok => AppColors.sage,
      FleetTone.warn => AppColors.warn,
      FleetTone.bad => AppColors.errorRed,
      FleetTone.muted => AppColors.muted,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// A label over a value, for the facts of a driver or a plate.
class FleetFact extends StatelessWidget {
  const FleetFact({super.key, required this.label, required this.value});

  final String label, value;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 120, maxWidth: 260),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 2),
          Text(
            value.isEmpty ? '—' : value,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
        ],
      ),
    );
  }
}

/// A toggle chip with an optional count.
class FleetFilterChip extends StatelessWidget {
  const FleetFilterChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onSelected,
    this.count,
  });

  final String label;
  final int? count;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    return FilterChip(
      label: Text(count == null ? label : '$label ($count)'),
      selected: selected,
      onSelected: (_) => onSelected(),
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
  }
}

class FleetSearchField extends StatelessWidget {
  const FleetSearchField({
    super.key,
    required this.hint,
    required this.onChanged,
    this.fieldKey,
  });

  final String hint;
  final ValueChanged<String> onChanged;
  final Key? fieldKey;

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: fieldKey,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: hint,
        prefixIcon: const Icon(Icons.search, size: 20),
        isDense: true,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        ),
      ),
    );
  }
}

/// A text box with a label, the way every Fleet form writes them.
class FleetField extends StatelessWidget {
  const FleetField({
    super.key,
    required this.controller,
    required this.label,
    this.keyboard,
    this.maxLength,
    this.maxLines = 1,
    this.enabled = true,
    this.hint,
  });

  final TextEditingController controller;
  final String label;
  final TextInputType? keyboard;
  final int? maxLength;
  final int maxLines;
  final bool enabled;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: TextField(
        controller: controller,
        enabled: enabled,
        keyboardType: keyboard,
        maxLength: maxLength,
        maxLines: maxLines,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          counterText: '',
          isDense: true,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
        ),
      ),
    );
  }
}

/// A day the person picks; [value] is a day key or ''.
class FleetDayField extends StatelessWidget {
  const FleetDayField({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.enabled = true,
    this.allowClear = false,
    this.first,
    this.last,
  });

  final String label, value;
  final ValueChanged<String> onChanged;
  final bool enabled, allowClear;
  final DateTime? first, last;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: InkWell(
        onTap: !enabled
            ? null
            : () async {
                final today = DateTime.now();
                final initial = value.isEmpty
                    ? today
                    : DateTime.tryParse(value) ?? today;
                final picked = await pickCalendarDay(
                  context,
                  initial: initial,
                  first: first ?? DateTime(2018),
                  last: last ?? DateTime(today.year + 3, 12, 31),
                );
                if (picked == null) return;
                onChanged(
                  '${picked.year.toString().padLeft(4, '0')}-'
                  '${picked.month.toString().padLeft(2, '0')}-'
                  '${picked.day.toString().padLeft(2, '0')}',
                );
              },
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            isDense: true,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            ),
            suffixIcon: allowClear && value.isNotEmpty && enabled
                ? IconButton(
                    tooltip: l10n.fltClear,
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => onChanged(''),
                  )
                : const Icon(Icons.calendar_today_outlined, size: 18),
          ),
          child: Text(
            value.isEmpty ? '—' : fleetDayLabel(value),
            style: const TextStyle(fontSize: 15),
          ),
        ),
      ),
    );
  }
}

/// The frame every Fleet sheet shares: a title, the fields, the refusal in
/// words, and Cancel / the action (which shows progress and cannot be tapped
/// twice).
class FleetSheetFrame extends StatelessWidget {
  const FleetSheetFrame({
    super.key,
    required this.title,
    this.subtitle,
    required this.children,
    required this.actionLabel,
    required this.onSubmit,
    required this.busy,
    this.error,
    this.destructive = false,
    this.submitKey = const Key('fleet-sheet-submit'),
  });

  final String title;
  final String? subtitle;
  final List<Widget> children;
  final String actionLabel;
  final VoidCallback? onSubmit;
  final bool busy, destructive;
  final String? error;
  final Key submitKey;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.lg,
          AppSpacing.lg,
          AppSpacing.lg + bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppColors.ink,
              ),
            ),
            if (subtitle != null && subtitle!.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(subtitle!, style: const TextStyle(color: AppColors.muted)),
            ],
            const SizedBox(height: AppSpacing.lg),
            ...children,
            if (error != null) ...[
              Container(
                key: const Key('fleet-sheet-error'),
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpacing.md),
                margin: const EdgeInsets.only(bottom: AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.errorRed.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                ),
                child: Text(
                  error!,
                  style: const TextStyle(color: AppColors.errorRed),
                ),
              ),
            ],
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: busy ? null : () => Navigator.of(context).pop(),
                    child: Text(l10n.fltCancel),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: FilledButton(
                    key: submitKey,
                    style: destructive
                        ? FilledButton.styleFrom(
                            backgroundColor: AppColors.errorRed,
                          )
                        : null,
                    onPressed: busy ? null : onSubmit,
                    child: busy
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(
                            actionLabel,
                            maxLines: 2,
                            textAlign: TextAlign.center,
                          ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Opens a Fleet sheet; the result is whatever the sheet pops (true when it
/// saved).
Future<bool> showFleetSheet(BuildContext context, WidgetBuilder builder) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: builder,
  );
  return saved == true;
}

/// A yes / no question; true on yes.
Future<bool> fleetConfirm(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool destructive = false,
}) async {
  final l10n = AppLocalizations.of(context)!;
  final yes = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(l10n.fltCancel),
        ),
        FilledButton(
          key: const Key('fleet-confirm-yes'),
          style: destructive
              ? FilledButton.styleFrom(backgroundColor: AppColors.errorRed)
              : null,
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return yes == true;
}

/// "$1,200 a month" / "a week" phrase for a rent.
String fleetRentText(AppLocalizations l10n, int cents, String period) =>
    period == 'weekly'
    ? l10n.fltRentPerWeek(fleetMoney(cents))
    : l10n.fltRentPerMonth(fleetMoney(cents));

/// The chip for a paper's state.
class FleetExpiryChip extends StatelessWidget {
  const FleetExpiryChip({super.key, required this.state});

  final FleetExpiry state;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return switch (state) {
      FleetExpiry.expired => FleetChip(
        label: l10n.fltExpiryExpired,
        tone: FleetTone.bad,
      ),
      FleetExpiry.soon => FleetChip(
        label: l10n.fltExpirySoon,
        tone: FleetTone.warn,
      ),
      FleetExpiry.missing => FleetChip(label: l10n.fltExpiryMissing),
      FleetExpiry.ok => FleetChip(label: l10n.fltExpiryOk, tone: FleetTone.ok),
    };
  }
}

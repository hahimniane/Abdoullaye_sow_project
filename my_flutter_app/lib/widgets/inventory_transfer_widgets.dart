import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../services/inventory_transfers.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import 'inventory_widgets.dart';

/// The words and small pieces the transfer screens share: a refusal, a
/// status, a line's result, a track-record entry and the transfer card.

/// What a failed transfer call says. A transfer that is no longer in transit
/// says what it became (someone already received it, or it was cancelled);
/// everything else reads like any inventory refusal.
String inventoryTransferFailureText(AppLocalizations l10n, Object error) {
  if (error is FirebaseFunctionsException) {
    switch (inventoryTransferGoneOf(error.details)) {
      case InventoryTransferGone.received:
        return l10n.invTrGoneReceived;
      case InventoryTransferGone.cancelled:
        return l10n.invTrGoneCancelled;
      case InventoryTransferGone.other:
        return l10n.inventoryFailTransferNotInTransit;
      case null:
        break;
    }
  }
  return inventoryFailureText(l10n, inventoryFailureFromError(error));
}

/// A person's name as the server saved it, or "Team member".
String inventoryTransferPerson(AppLocalizations l10n, String name) =>
    name.trim().isEmpty ? l10n.lotUnnamedPerson : name.trim();

/// Lost in transit / Damaged / Stolen / Other.
String inventoryWriteOffReasonLabel(AppLocalizations l10n, String reason) =>
    switch (reason) {
      'lost' => l10n.invTrReasonLost,
      'damaged' => l10n.invTrReasonDamaged,
      'stolen' => l10n.invTrReasonStolen,
      'other' => l10n.invTrReasonOther,
      _ => reason,
    };

/// The status chip's word and colour.
({String label, Color color}) inventoryTransferChip(
  AppLocalizations l10n,
  InventoryTransfer t,
  DateTime now,
) => switch (inventoryTransferCardState(t, now)) {
  InventoryTransferCardState.draft => (
    label: l10n.invTrStateDraft,
    color: AppColors.muted,
  ),
  InventoryTransferCardState.inTransit => (
    label: l10n.invTrStateInTransit,
    color: AppColors.cobalt,
  ),
  InventoryTransferCardState.late => (
    label: l10n.invTrStateLate(inventoryTransferTransitDays(t, now) ?? 0),
    color: AppColors.warn,
  ),
  InventoryTransferCardState.review => (
    label: l10n.invTrStateReview,
    color: AppColors.errorRed,
  ),
  InventoryTransferCardState.received => (
    label: l10n.invTrStateReceived,
    color: AppColors.sage,
  ),
  InventoryTransferCardState.settled => (
    label: l10n.invTrStateSettled,
    color: AppColors.sage,
  ),
  InventoryTransferCardState.cancelled => (
    label: l10n.invTrStateCancelled,
    color: AppColors.muted,
  ),
};

/// The card's line under From -> To.
String inventoryTransferCardDetail(
  AppLocalizations l10n,
  InventoryTransfer t,
  DateTime now,
  String locale,
) {
  String day(DateTime? at) => at == null ? '' : displayMonthDay(at, locale);
  final items = l10n.invTrItems(t.itemsCount);
  switch (inventoryTransferCardState(t, now)) {
    case InventoryTransferCardState.draft:
      return [items, l10n.invTrNotSent].join(' · ');
    case InventoryTransferCardState.inTransit:
    case InventoryTransferCardState.late:
      return [
        items,
        l10n.invTrProducts(t.productsCount),
        if (t.sentAt != null)
          l10n.invTrSentOnBy(
            displayMonthDayTime(t.sentAt!, locale),
            inventoryTransferPerson(l10n, t.sentByName),
          ),
      ].join(' · ');
    case InventoryTransferCardState.review:
      return [
        l10n.invTrReceivedOf(t.arrivedCount, t.itemsCount),
        l10n.invTrMissingN(t.openMissingCount),
      ].join(' · ');
    case InventoryTransferCardState.received:
    case InventoryTransferCardState.settled:
      return [
        l10n.invTrReceivedOf(t.arrivedCount, t.itemsCount),
        if (t.receivedAt != null)
          l10n.invTrOnBy(
            day(t.receivedAt),
            inventoryTransferPerson(l10n, t.receivedByName),
          ),
      ].join(' · ');
    case InventoryTransferCardState.cancelled:
      return [
        items,
        if (t.cancelledAt != null)
          l10n.invTrCancelledOnBy(
            day(t.cancelledAt),
            inventoryTransferPerson(l10n, t.cancelledByName),
          ),
      ].join(' · ');
  }
}

/// "Complete", "2 missing · disputed", "2 returned to Bronx store", "2
/// written off · Lost in transit"; '' before it is received.
String inventoryTransferResultText(
  AppLocalizations l10n,
  InventoryTransferLine line,
  String fromStore,
) {
  final result = inventoryTransferLineResult(line);
  return switch (result.kind) {
    InventoryTransferLineResultKind.pending => '',
    InventoryTransferLineResultKind.complete => l10n.invTrResultComplete,
    InventoryTransferLineResultKind.disputed => l10n.invTrResultDisputed(
      result.quantity,
    ),
    InventoryTransferLineResultKind.returned => l10n.invTrResultReturned(
      result.quantity,
      fromStore,
    ),
    InventoryTransferLineResultKind.writtenOff => l10n.invTrResultWrittenOff(
      result.quantity,
      inventoryWriteOffReasonLabel(l10n, result.reason),
    ),
  };
}

Color inventoryTransferResultColor(InventoryTransferLine line) =>
    switch (inventoryTransferLineResult(line).kind) {
      InventoryTransferLineResultKind.pending => AppColors.muted,
      InventoryTransferLineResultKind.complete => AppColors.sage,
      InventoryTransferLineResultKind.disputed => AppColors.errorRed,
      InventoryTransferLineResultKind.returned => AppColors.cobaltDeep,
      InventoryTransferLineResultKind.writtenOff => AppColors.warn,
    };

/// One track-record entry in words, or '' for an event this build does not
/// know.
String inventoryTransferEventText(
  AppLocalizations l10n,
  InventoryTransferEvent e,
  InventoryTransfer t,
  InventoryStoreContext stores,
) {
  final who = inventoryTransferPerson(l10n, e.byName);
  return switch (e.event) {
    'draft_created' => l10n.invTrEvDraftCreated(who),
    'sent' => l10n.invTrEvSent(who, l10n.invTrItems(e.itemsCount)),
    'cancelled' => l10n.invTrEvCancelled(
      who,
      l10n.invTrItems(e.itemsCount),
      t.fromName(stores),
    ),
    'draft_discarded' => l10n.invTrEvDiscarded(who),
    'received' =>
      e.missingCount > 0
          ? l10n.invTrEvReceivedShort(who, e.receivedCount, e.missingCount)
          : l10n.invTrEvReceivedAll(who, e.receivedCount),
    'returned' => l10n.invTrEvReturned(
      who,
      e.quantity,
      e.itemName,
      t.fromName(stores),
    ),
    'written_off' => l10n.invTrEvWrittenOff(
      who,
      e.quantity,
      e.itemName,
      inventoryWriteOffReasonLabel(l10n, e.reason),
    ),
    _ => '',
  };
}

/// The summary card's "In transit $X · Disputed $Y" (pieces when no cost is
/// known); '' when there is nothing in transit or disputed, or the server
/// sent no transfer totals.
String inventoryTransferSummaryLine(
  AppLocalizations l10n,
  InventoryTransferTotals? totals,
) {
  if (totals == null || !totals.any) return '';
  return [
    if (totals.showsInTransit)
      l10n.invTrSummaryInTransit(
        totals.inTransitValueCents > 0
            ? formatLotCents(totals.inTransitValueCents)
            : l10n.invTrItems(totals.inTransitItems),
      ),
    if (totals.showsDisputed)
      l10n.invTrSummaryDisputed(
        totals.disputedValueCents > 0
            ? formatLotCents(totals.disputedValueCents)
            : l10n.invTrItems(totals.disputedItems),
      ),
  ].join(' · ');
}

/// "Bronx store -> Harlem store", the arrow drawn.
class InventoryTransferRoute extends StatelessWidget {
  const InventoryTransferRoute({
    super.key,
    required this.from,
    required this.to,
    this.fontSize = 14,
  });

  final String from;
  final String to;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: fontSize,
      fontWeight: FontWeight.w600,
      color: AppColors.ink,
    );
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 6,
      children: [
        Text(from, style: style),
        Icon(
          Icons.arrow_forward_rounded,
          size: fontSize + 2,
          color: AppColors.cobalt,
        ),
        Text(to, style: style),
      ],
    );
  }
}

/// A transfer in a list: code and status, From -> To, and a line of detail.
/// A transfer late on its way is highlighted.
class InventoryTransferCard extends StatelessWidget {
  const InventoryTransferCard({
    super.key,
    required this.transfer,
    required this.stores,
    required this.now,
    required this.onTap,
  });

  final InventoryTransfer transfer;
  final InventoryStoreContext stores;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final t = transfer;
    final chip = inventoryTransferChip(l10n, t, now);
    final state = inventoryTransferCardState(t, now);
    final late = state == InventoryTransferCardState.late;
    final review = state == InventoryTransferCardState.review;
    return PressableScale(
      onTap: onTap,
      scale: 0.985,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: late
              ? AppColors.saffron.withValues(alpha: 0.08)
              : AppColors.paper,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: late
                ? AppColors.saffron.withValues(alpha: 0.6)
                : review
                ? AppColors.errorRed.withValues(alpha: 0.45)
                : AppColors.rule,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    t.code.isEmpty ? '—' : t.code,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                InventoryChip(
                  key: Key('inv-tr-chip-${t.id}'),
                  label: chip.label,
                  color: chip.color,
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            InventoryTransferRoute(
              from: t.fromName(stores),
              to: t.toName(stores),
            ),
            const SizedBox(height: 4),
            Text(
              inventoryTransferCardDetail(l10n, t, now, locale),
              key: Key('inv-tr-detail-${t.id}'),
              style: const TextStyle(
                fontSize: 13,
                height: 1.35,
                color: AppColors.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A − n + stepper. A side whose callback is null is disabled.
class InventoryStepper extends StatelessWidget {
  const InventoryStepper({
    super.key,
    required this.value,
    required this.onMinus,
    required this.onPlus,
    this.keyPrefix = 'inv-step',
    this.minusLabel,
    this.plusLabel,
  });

  final int value;
  final VoidCallback? onMinus;
  final VoidCallback? onPlus;
  final String keyPrefix;
  final String? minusLabel;
  final String? plusLabel;

  @override
  Widget build(BuildContext context) {
    Widget side(
      IconData icon,
      VoidCallback? onTap,
      String suffix,
      String? tip,
    ) => SizedBox(
      width: 44,
      height: 44,
      child: IconButton(
        key: Key('$keyPrefix-$suffix'),
        tooltip: tip,
        onPressed: onTap,
        icon: Icon(icon, size: 20),
        style: IconButton.styleFrom(
          backgroundColor: onTap == null
              ? AppColors.parchment
              : AppColors.mist.withValues(alpha: 0.6),
          foregroundColor: AppColors.cobaltDeep,
          disabledForegroundColor: AppColors.muted.withValues(alpha: 0.5),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        side(Icons.remove, onMinus, 'minus', minusLabel),
        SizedBox(
          width: 44,
          child: Text(
            '$value',
            key: Key('$keyPrefix-value'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
        ),
        side(Icons.add, onPlus, 'plus', plusLabel),
      ],
    );
  }
}

/// A plain section title.
class InventorySectionLabel extends StatelessWidget {
  const InventorySectionLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.2,
        color: AppColors.ink,
      ),
    ),
  );
}

/// The track record: who did what and when, oldest first.
class InventoryTransferTimeline extends StatelessWidget {
  const InventoryTransferTimeline({
    super.key,
    required this.transfer,
    required this.stores,
  });

  final InventoryTransfer transfer;
  final InventoryStoreContext stores;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final rows = [
      for (final e in transfer.timeline)
        (event: e, text: inventoryTransferEventText(l10n, e, transfer, stores)),
    ].where((r) => r.text.isNotEmpty).toList();
    if (rows.isEmpty) {
      return Text(
        l10n.invTrNoTimeline,
        style: const TextStyle(fontSize: 13, color: AppColors.muted),
      );
    }
    return Column(
      key: const Key('inv-tr-timeline'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final row in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 6),
                  child: Icon(Icons.circle, size: 8, color: AppColors.cobalt),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        [
                          if (row.event.at != null)
                            displayMonthDayTime(row.event.at!, locale),
                          row.text,
                        ].join(' · '),
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.35,
                          color: AppColors.ink,
                        ),
                      ),
                      if (row.event.note.isNotEmpty)
                        Text(
                          '“${row.event.note}”',
                          style: const TextStyle(
                            fontSize: 12.5,
                            height: 1.35,
                            color: AppColors.muted,
                          ),
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

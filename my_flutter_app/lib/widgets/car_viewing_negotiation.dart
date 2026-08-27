import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/car_purchase.dart';
import '../services/car_viewing_service.dart';
import '../theme/app_colors.dart';
import '../utils/action_confirmation.dart';
import 'app_snackbars.dart';
import 'async_action_button.dart';

/// The viewing negotiation, as one panel both sides of it can read.
///
/// A viewing is an appointment for two parties, so the customer's card and the
/// business's card are the same card with a different [ViewingParty] - what
/// each may do comes from [availableViewingActions], which mirrors the server's
/// `decideViewingAction`. Two hand-written screens would have drifted apart the
/// first time a rule moved.
///
/// Refusals from `actOnCarViewing` arrive already written for the person
/// reading them ("Choose one of the times that was offered"), so they are shown
/// as sent rather than translated into wording of our own that could contradict
/// them.

/// How a viewing status reads to a human.
String viewingStatusLabel(AppLocalizations l10n, String status) =>
    switch (status) {
      viewingRequested => l10n.viewingStatusRequested,
      viewingCountered => l10n.viewingStatusCountered,
      viewingScheduled => l10n.viewingScheduled,
      viewingDeclined => l10n.viewingStatusDeclined,
      viewingExpired => l10n.viewingStatusExpired,
      viewingCancelled => l10n.viewingStatusCancelled,
      _ => status,
    };

/// The words on a slot: what was offered, or a formatted instant when the
/// record carries no label.
String viewingSlotLabel(ViewingSlot slot) => slot.label.isNotEmpty
    ? slot.label
    : DateFormat.yMMMEd().add_jm().format(slot.startAt);

/// The times a picker offers, with the words the other party will read.
///
/// The label travels with the slot because it is what the other side sees, and
/// because the two parties may be reading in different languages - the times
/// are agreed as a sentence, not only as an instant.
List<ViewingSlot> viewingSlotChoices({DateTime? now}) {
  final dateFormat = DateFormat('EEE, MMM d');
  final timeFormat = DateFormat.jm();
  return suggestedViewingStarts(now: now)
      .map(
        (start) => ViewingSlot(
          startAt: start,
          label: '${dateFormat.format(start)} - ${timeFormat.format(start)}',
        ),
      )
      .toList(growable: false);
}

/// Who is being waited on, said in the second person when it is the reader.
String? viewingAwaitingLabel(
  AppLocalizations l10n,
  ViewingState state,
  ViewingParty party,
) {
  final awaiting = state.awaiting;
  if (awaiting == null) return null;
  if (awaiting == party) return l10n.viewingYourTurn;
  return awaiting == ViewingParty.customer
      ? l10n.viewingWaitingOnBuyer
      : l10n.viewingWaitingOnSeller;
}

/// Who put the current times on the table, from the reader's point of view.
String? viewingProposedByLabel(
  AppLocalizations l10n,
  ViewingState state,
  ViewingParty party,
) {
  final proposedBy = state.proposedBy;
  if (proposedBy == null) return null;
  if (proposedBy == party) return l10n.viewingProposedByYou;
  return proposedBy == ViewingParty.customer
      ? l10n.viewingProposedByBuyer
      : l10n.viewingProposedBySeller;
}

/// One line of the audit trail.
String viewingHistoryLine(
  AppLocalizations l10n,
  ViewingHistoryEntry entry,
  ViewingParty party,
) {
  final entryActor = entry.actor;
  final actor = entryActor == null
      ? ''
      : entryActor == party
      ? l10n.viewingActorYou
      : entryActor == ViewingParty.customer
      ? l10n.viewingActorBuyer
      : l10n.viewingActorSeller;
  // Nouns rather than verbs, and separated rather than joined into a sentence:
  // "You proposed" cannot be built from a name and a verb in French without
  // agreeing the two, and an audit line reads perfectly well as a log entry.
  final action = switch (entry.action) {
    'propose' => l10n.viewingHistoryActionProposed,
    'accept' => l10n.viewingHistoryActionAccepted,
    'decline' => l10n.viewingHistoryActionDeclined,
    'cancel' => l10n.viewingHistoryActionCancelled,
    _ => entry.action,
  };
  return l10n.viewingHistoryEntryLine(
    actor,
    action,
    DateFormat.yMMMd().add_jm().format(entry.at),
  );
}

class CarViewingNegotiationPanel extends StatefulWidget {
  const CarViewingNegotiationPanel({
    super.key,
    required this.purchase,
    required this.party,
    this.service,
    this.onActed,
  });

  final CarPurchase purchase;

  /// Which side of the conversation the reader is on. Never sent to the
  /// callable - the server derives the actor from auth - it only decides what
  /// this panel offers and how it words things.
  final ViewingParty party;

  /// Injectable so a widget test can drive the panel without a network.
  final CarViewingService? service;

  /// Called after a transition the server accepted. The lists these panels sit
  /// in are Firestore streams and refresh themselves; this is for the sheets,
  /// which have to close.
  final VoidCallback? onActed;

  @override
  State<CarViewingNegotiationPanel> createState() =>
      _CarViewingNegotiationPanelState();
}

class _CarViewingNegotiationPanelState
    extends State<CarViewingNegotiationPanel> {
  /// Built lazily: constructing it eagerly would reach for
  /// `FirebaseFunctions.instance` in every widget test that renders a card.
  late final CarViewingService _service = widget.service ?? CarViewingService();

  ViewingSlot? _selectedSlot;

  /// The slot the reader is accepting, defaulting to the first one that is
  /// still far enough away to be agreed to - the common case is one offer, and
  /// asking someone to tap it before they can tap "Accept" is a step for
  /// nothing.
  ViewingSlot? _acceptableSlot(ViewingState state) {
    final now = DateTime.now();
    final agreeable = state.proposedSlots
        .where((slot) => slot.isAgreeableAt(now))
        .toList(growable: false);
    if (agreeable.isEmpty) return null;
    final selected = _selectedSlot;
    if (selected != null && agreeable.contains(selected)) return selected;
    return agreeable.first;
  }

  /// Runs a transition and reports it. A refusal carries the server's own
  /// sentence, which says something this screen's copy cannot - that the
  /// listing was sold, that the round cap is reached - so it is shown as
  /// written.
  Future<void> _run(
    Future<CarViewingActionResult> Function() action,
    String Function(CarViewingActionResult result) success,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      final result = await action();
      if (!mounted) return;
      showSuccessSnackBar(context, success(result));
      widget.onActed?.call();
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      final message = (error.message ?? '').trim();
      showErrorSnackBar(
        context,
        message.isEmpty ? l10n.viewingActionFailed : message,
      );
    } catch (_) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.viewingActionFailed);
    }
  }

  Future<void> _accept(ViewingSlot slot) async {
    final l10n = AppLocalizations.of(context)!;
    await _run(
      () => _service.accept(purchaseId: widget.purchase.id, slot: slot),
      (_) => l10n.viewingConfirmedMessage(viewingSlotLabel(slot)),
    );
  }

  Future<void> _propose() async {
    final l10n = AppLocalizations.of(context)!;
    final slots = await showViewingProposalSheet(
      context,
      party: widget.party,
      isReschedule: widget.purchase.purchaseStatus == viewingScheduled,
    );
    if (slots == null || slots.isEmpty || !mounted) return;
    await _run(
      () => _service.propose(purchaseId: widget.purchase.id, slots: slots),
      (_) => l10n.viewingTimesSent,
    );
  }

  Future<void> _decline() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.viewingDeclineQuestion,
      message: l10n.viewingDeclineConfirmMessage,
      confirmLabel: l10n.viewingDeclineRequest,
      icon: Icons.event_busy_outlined,
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    await _run(
      () => _service.decline(purchaseId: widget.purchase.id),
      (_) => l10n.viewingDeclinedMessage,
    );
  }

  Future<void> _cancel() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.cancelViewingQuestion,
      message: l10n.cancelViewingConfirmMessage,
      confirmLabel: l10n.cancelViewingReservation,
      icon: Icons.event_busy_outlined,
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    await _run(
      () => _service.cancel(purchaseId: widget.purchase.id),
      (_) => l10n.viewingReservationCancelled,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final state = widget.purchase.viewingState;
    final actions = availableViewingActions(state, widget.party);
    final awaiting = viewingAwaitingLabel(l10n, state, widget.party);
    final appointment = state.appointmentStart;
    final acceptable = _acceptableSlot(state);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.event_available_outlined,
                color: AppColors.brandRed,
                size: 20,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  viewingStatusLabel(l10n, state.purchaseStatus),
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (awaiting != null)
                Text(
                  awaiting,
                  style: TextStyle(
                    color: state.awaiting == widget.party
                        ? AppColors.brandRed
                        : AppColors.lightMuted,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
            ],
          ),
          if (state.purchaseStatus == viewingScheduled &&
              appointment != null) ...[
            const SizedBox(height: 8),
            Text(
              l10n.viewingConfirmedFor(
                state.appointmentLabel.isNotEmpty
                    ? state.appointmentLabel
                    : DateFormat.yMMMEd().add_jm().format(appointment),
              ),
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ],
          if (state.isPending && state.respondByAt != null) ...[
            const SizedBox(height: 4),
            Text(
              l10n.viewingRespondBy(
                DateFormat.yMMMd().add_jm().format(state.respondByAt!),
              ),
              style: const TextStyle(
                color: AppColors.lightMuted,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
          if (state.isPending && state.proposedSlots.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              viewingProposedByLabel(l10n, state, widget.party) ??
                  l10n.viewingTimesOnTable,
              style: const TextStyle(
                color: AppColors.lightMuted,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: state.proposedSlots.map((slot) {
                final canChoose =
                    actions.contains(ViewingAction.accept) &&
                    slot.isAgreeableAt(DateTime.now());
                return ChoiceChip(
                  selected: canChoose && slot == acceptable,
                  label: Text(viewingSlotLabel(slot)),
                  selectedColor: AppColors.brandRed,
                  labelStyle: TextStyle(
                    color: canChoose && slot == acceptable
                        ? Colors.white
                        : AppColors.lightOnSurface,
                    fontWeight: FontWeight.w700,
                  ),
                  onSelected: canChoose
                      ? (_) => setState(() => _selectedSlot = slot)
                      : null,
                );
              }).toList(),
            ),
          ],
          if (viewingProposalExpired(state)) ...[
            const SizedBox(height: 10),
            _ViewingNotice(
              icon: Icons.hourglass_disabled_outlined,
              color: AppColors.warn,
              text: l10n.viewingProposalExpiredNotice,
            ),
          ] else if (state.isPending &&
              !actions.contains(ViewingAction.propose)) ...[
            const SizedBox(height: 10),
            _ViewingNotice(
              icon: Icons.repeat_on_outlined,
              color: AppColors.warn,
              text: l10n.viewingNoMoreCounters,
            ),
          ],
          if (!state.isOpen) ...[
            const SizedBox(height: 10),
            Text(
              l10n.viewingClosedNotice,
              style: const TextStyle(
                color: AppColors.lightMuted,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (actions.contains(ViewingAction.accept) &&
                    acceptable != null)
                  AsyncActionButton.filled(
                    key: const Key('viewing-accept'),
                    onPressed: () => _accept(acceptable),
                    icon: Icons.check_circle_outline,
                    label: l10n.viewingAcceptTime,
                  ),
                if (actions.contains(ViewingAction.propose))
                  AsyncActionButton.outlined(
                    key: const Key('viewing-propose'),
                    onPressed: _propose,
                    icon: Icons.event_repeat_outlined,
                    label: widget.party == ViewingParty.business
                        ? l10n.viewingOfferOtherTimes
                        : l10n.viewingProposeAnotherTime,
                  ),
                if (actions.contains(ViewingAction.decline))
                  AsyncActionButton.outlined(
                    key: const Key('viewing-decline'),
                    onPressed: _decline,
                    icon: Icons.do_not_disturb_on_outlined,
                    label: l10n.viewingDeclineRequest,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.errorRed,
                    ),
                  ),
                if (actions.contains(ViewingAction.cancel))
                  AsyncActionButton.outlined(
                    key: const Key('viewing-cancel'),
                    onPressed: _cancel,
                    icon: Icons.event_busy_outlined,
                    label: l10n.cancelViewingReservation,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.errorRed,
                    ),
                  ),
              ],
            ),
          ],
          if (state.history.isNotEmpty) ...[
            const SizedBox(height: 4),
            Theme(
              // The default divider draws a line across a card that already has
              // a border, which reads as two panels rather than one.
              data: Theme.of(
                context,
              ).copyWith(dividerColor: Colors.transparent),
              // The panel paints its own background, and a ListTile paints its
              // ink on the nearest Material - which is above that background,
              // so the tap ripple would land under it. Flutter asserts on
              // exactly this arrangement.
              child: Material(
                type: MaterialType.transparency,
                child: ExpansionTile(
                  key: const Key('viewing-history'),
                  tilePadding: EdgeInsets.zero,
                  childrenPadding: const EdgeInsets.only(bottom: 8),
                  title: Text(
                    l10n.viewingHistoryTitle,
                    style: const TextStyle(
                      color: AppColors.lightMuted,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  children: state.history.reversed.map((entry) {
                    return Align(
                      alignment: Alignment.centerLeft,
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              viewingHistoryLine(l10n, entry, widget.party),
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            if (entry.slots.isNotEmpty)
                              Text(
                                entry.slots.map(viewingSlotLabel).join(' • '),
                                style: const TextStyle(
                                  color: AppColors.lightMuted,
                                  fontSize: 12,
                                ),
                              ),
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Asks for the times to put on the table.
///
/// One slot from a customer and up to [maxViewingCounterSlots] from a business,
/// because that is what the server accepts from each. Returns null when the
/// sheet is dismissed, so a caller can tell "changed my mind" from "sent
/// nothing".
Future<List<ViewingSlot>?> showViewingProposalSheet(
  BuildContext context, {
  required ViewingParty party,
  bool isReschedule = false,
}) {
  final l10n = AppLocalizations.of(context)!;
  final maxSlots = maxViewingSlotsFor(party);
  final choices = viewingSlotChoices();
  final chosen = <ViewingSlot>[];

  return showModalBottomSheet<List<ViewingSlot>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (sheetContext) {
      return StatefulBuilder(
        builder: (context, setModalState) {
          return Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.of(context).viewInsets.bottom,
            ),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          party == ViewingParty.business
                              ? l10n.viewingProposalSheetTitleBusiness
                              : l10n.viewingProposalSheetTitleCustomer,
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    party == ViewingParty.business
                        ? l10n.viewingProposalSheetMessageBusiness(maxSlots)
                        : l10n.viewingProposalSheetMessageCustomer,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppColors.lightMuted,
                      height: 1.35,
                    ),
                  ),
                  if (isReschedule) ...[
                    const SizedBox(height: 8),
                    Text(
                      l10n.viewingRescheduleNotice,
                      style: const TextStyle(
                        color: AppColors.warn,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                  const SizedBox(height: 18),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: choices.map((slot) {
                      final isSelected = chosen.contains(slot);
                      return ChoiceChip(
                        selected: isSelected,
                        avatar: Icon(
                          Icons.schedule,
                          size: 18,
                          color: isSelected ? Colors.white : AppColors.brandRed,
                        ),
                        label: Text(viewingSlotLabel(slot)),
                        selectedColor: AppColors.brandRed,
                        labelStyle: TextStyle(
                          color: isSelected
                              ? Colors.white
                              : AppColors.lightOnSurface,
                          fontWeight: FontWeight.w700,
                        ),
                        onSelected: (_) => setModalState(() {
                          if (isSelected) {
                            chosen.remove(slot);
                            return;
                          }
                          // One slot replaces the last rather than refusing the
                          // tap: a customer who changes their mind should not
                          // have to deselect first.
                          if (chosen.length >= maxSlots) {
                            chosen.removeAt(0);
                          }
                          chosen.add(slot);
                        }),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    chosen.isEmpty
                        ? l10n.viewingChooseTime
                        : l10n.viewingSlotsChosen(chosen.length, maxSlots),
                    style: TextStyle(
                      color: chosen.isEmpty
                          ? Theme.of(context).colorScheme.error
                          : AppColors.lightMuted,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 18),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: FilledButton.icon(
                      key: const Key('viewing-proposal-send'),
                      onPressed: chosen.isEmpty
                          ? null
                          : () => Navigator.pop(
                              context,
                              List<ViewingSlot>.unmodifiable(
                                // Earliest first, which is the order the other
                                // party reads them in and the order the
                                // response deadline is computed from.
                                chosen.toList()..sort(
                                  (a, b) => a.startAt.compareTo(b.startAt),
                                ),
                              ),
                            ),
                      icon: const Icon(Icons.send_outlined),
                      label: Text(l10n.viewingSendProposal),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      );
    },
  );
}

class _ViewingNotice extends StatelessWidget {
  const _ViewingNotice({
    required this.icon,
    required this.text,
    required this.color,
  });

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.22)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

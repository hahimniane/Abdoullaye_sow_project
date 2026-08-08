import 'package:cloud_functions/cloud_functions.dart';

import 'business_assistant_service.dart' show deepCastCallableValue;

/// Car viewings as a negotiation, app side.
///
/// A deliberate mirror of the server's pure module,
/// `functions/car_viewing.js`. The `actOnCarViewing` callable is still the
/// authority - it re-decides everything inside a transaction against a freshly
/// read record - and this exists so a party is never offered a button the
/// server is going to refuse. An "Accept" that only ever produces a red
/// snackbar is worse than no button at all.
///
/// Everything above [CarViewingService] is pure: no Firebase, no widgets, so
/// `test/car_viewing_negotiation_test.dart` drives it directly.

/// Awaiting the business: the customer proposed and has not been answered.
const String viewingRequested = 'viewing_requested';

/// Awaiting the customer: the business offered alternative slots.
const String viewingCountered = 'viewing_countered';

/// Both parties agreed on a time.
const String viewingScheduled = 'viewing_scheduled';

/// The business said no outright.
const String viewingDeclined = 'viewing_declined';

/// Nobody answered before the deadline.
const String viewingExpired = 'viewing_expired';

/// Either party pulled out. Shared with the rest of carPurchases.
const String viewingCancelled = 'cancelled';

/// Statuses where the appointment has not happened and something can still
/// change. `OPEN_VIEWING_STATUSES` in `functions/car_viewing.js`.
const List<String> openViewingStatuses = <String>[
  viewingRequested,
  viewingCountered,
  viewingScheduled,
];

/// Waiting on someone to reply. `PENDING_VIEWING_STATUSES` on the server.
const List<String> pendingViewingStatuses = <String>[
  viewingRequested,
  viewingCountered,
];

/// A business may offer up to three alternatives in one counter; a customer
/// proposes exactly one. `MAX_COUNTER_SLOTS` on the server.
const int maxViewingCounterSlots = 3;

/// Proposals allowed before the flow stops accepting counters and the parties
/// must accept, decline or cancel. `MAX_PROPOSAL_ROUNDS` on the server.
const int maxViewingProposalRounds = 3;

/// Nothing may be agreed, moved or cancelled inside this window.
/// `EDIT_FLOOR_MS` on the server.
const Duration viewingEditFloor = Duration(hours: 1);

/// Normal window to answer a proposal. `RESPONSE_WINDOW_MS` on the server.
const Duration viewingResponseWindow = Duration(hours: 24);

/// Which side of the conversation someone is on.
///
/// Never sent to the callable: the server derives the actor from auth and the
/// record, so a client that offered a role would only be offering to lie about
/// one. This exists so the screens can ask "what may *I* do here".
enum ViewingParty { customer, business }

extension ViewingPartyWire on ViewingParty {
  String get wireValue => switch (this) {
    ViewingParty.customer => 'customer',
    ViewingParty.business => 'business',
  };
}

/// Reads the party the server named, in `proposedBy` or in an `awaiting`
/// answer. Anything unrecognised - including the empty string the callable
/// returns when nobody owes a reply - is null.
ViewingParty? viewingPartyFromWire(Object? value) {
  final text = (value ?? '').toString().trim();
  if (text == 'customer') return ViewingParty.customer;
  if (text == 'business') return ViewingParty.business;
  return null;
}

/// The four things either party can do to a viewing.
enum ViewingAction { propose, accept, decline, cancel }

extension ViewingActionWire on ViewingAction {
  String get wireValue => switch (this) {
    ViewingAction.propose => 'propose',
    ViewingAction.accept => 'accept',
    ViewingAction.decline => 'decline',
    ViewingAction.cancel => 'cancel',
  };
}

/// One time on the table, with the words the other party will read.
///
/// The label is carried rather than re-derived because the two parties may be
/// on different locales: "Thu, Aug 14 - 2:00 PM" is what was offered, and the
/// agreement is about that sentence as much as about the instant.
class ViewingSlot {
  const ViewingSlot({required this.startAt, required this.label});

  /// Reads a slot as the record stores it: `{startAtMs, label}`.
  ///
  /// Returns null rather than a slot at the epoch when the instant cannot be
  /// read - a viewing "scheduled" for 1970 would be offered as an acceptable
  /// time and then refused by the server as being in the past.
  static ViewingSlot? fromStored(Object? value) {
    if (value is! Map) return null;
    final startAtMs = value['startAtMs'];
    final millis = startAtMs is num
        ? startAtMs.round()
        : int.tryParse('${startAtMs ?? ''}');
    if (millis == null) return null;
    return ViewingSlot(
      startAt: DateTime.fromMillisecondsSinceEpoch(millis),
      label: (value['label'] ?? '').toString().trim(),
    );
  }

  final DateTime startAt;
  final String label;

  /// The shape `actOnCarViewing` expects. ISO 8601 in UTC, because the server
  /// reads it with `new Date(...)` and a local string without an offset would
  /// be read in the functions region's timezone rather than the caller's.
  Map<String, dynamic> toWire() => <String, dynamic>{
    'startAt': startAt.toUtc().toIso8601String(),
    'label': label,
  };

  /// Whether this slot is still far enough away to be agreed to.
  bool isAgreeableAt(DateTime now) =>
      startAt.difference(now) > viewingEditFloor;

  /// Slots are compared by instant alone, the same way the server matches an
  /// acceptance against what was offered - a label rendered in French must
  /// still accept a slot that was offered in English.
  @override
  bool operator ==(Object other) =>
      other is ViewingSlot &&
      other.startAt.millisecondsSinceEpoch == startAt.millisecondsSinceEpoch;

  @override
  int get hashCode => startAt.millisecondsSinceEpoch.hashCode;
}

/// Slots as the record holds them, in the order they were offered.
///
/// Anything unreadable is dropped rather than allowed through as a bad time:
/// a list with one good slot and one broken one still lets the viewing happen.
List<ViewingSlot> viewingSlotsFromStored(Object? value) {
  if (value is! List) return const <ViewingSlot>[];
  return value
      .map(ViewingSlot.fromStored)
      .whereType<ViewingSlot>()
      .toList(growable: false);
}

/// One line of the audit trail the server appends to `viewingHistory`.
///
/// Kept because "they never offered me that time" is the argument this feature
/// will eventually produce, and a record settles it.
class ViewingHistoryEntry {
  const ViewingHistoryEntry({
    required this.actor,
    required this.action,
    required this.slots,
    required this.at,
  });

  static ViewingHistoryEntry? fromStored(Object? value) {
    if (value is! Map) return null;
    final atMs = value['atMs'];
    final millis = atMs is num ? atMs.round() : int.tryParse('${atMs ?? ''}');
    if (millis == null) return null;
    return ViewingHistoryEntry(
      actor: viewingPartyFromWire(value['actor']),
      action: (value['action'] ?? '').toString().trim(),
      slots: viewingSlotsFromStored(value['slots']),
      at: DateTime.fromMillisecondsSinceEpoch(millis),
    );
  }

  /// Null for an actor the app does not recognise, so a future server-side
  /// party does not render as "customer".
  final ViewingParty? actor;
  final String action;
  final List<ViewingSlot> slots;
  final DateTime at;
}

/// The trail oldest-first, which is the order `arrayUnion` appends in and the
/// order a conversation reads in.
List<ViewingHistoryEntry> viewingHistoryFromStored(Object? value) {
  if (value is! List) return const <ViewingHistoryEntry>[];
  final entries = value
      .map(ViewingHistoryEntry.fromStored)
      .whereType<ViewingHistoryEntry>()
      .toList();
  entries.sort((a, b) => a.at.compareTo(b.at));
  return List<ViewingHistoryEntry>.unmodifiable(entries);
}

/// Everything a decision about a viewing depends on, and nothing else.
///
/// Deliberately not the whole `CarPurchase`: these are exactly the fields
/// `decideViewingAction` reads, so the two can be compared side by side, and a
/// test can build a state without a Firestore document.
class ViewingState {
  const ViewingState({
    required this.purchaseStatus,
    this.proposedSlots = const <ViewingSlot>[],
    this.proposedBy,
    this.proposalRound = 0,
    this.respondByAt,
    this.appointmentStart,
    this.appointmentLabel = '',
    this.history = const <ViewingHistoryEntry>[],
  });

  final String purchaseStatus;
  final List<ViewingSlot> proposedSlots;
  final ViewingParty? proposedBy;
  final int proposalRound;
  final DateTime? respondByAt;
  final DateTime? appointmentStart;
  final String appointmentLabel;
  final List<ViewingHistoryEntry> history;

  /// Who owes a reply, or null when nobody does.
  ViewingParty? get awaiting => viewingAwaitingParty(purchaseStatus);

  /// Whether the appointment has not happened and something can still change.
  bool get isOpen => openViewingStatuses.contains(purchaseStatus);

  /// Whether someone is being waited on.
  bool get isPending => pendingViewingStatuses.contains(purchaseStatus);
}

/// Who owes a reply in this state. `awaitingParty` on the server.
ViewingParty? viewingAwaitingParty(String status) {
  if (status == viewingRequested) return ViewingParty.business;
  if (status == viewingCountered) return ViewingParty.customer;
  return null;
}

/// Whether a proposal has run out of time. `isProposalExpired` on the server,
/// including the second test that actually bites: every slot on the table
/// having gone by while nobody answered. Without it a business is shown an
/// "Accept" for a slot that was yesterday.
bool viewingProposalExpired(ViewingState state, {DateTime? now}) {
  if (!state.isPending) return false;
  final at = now ?? DateTime.now();
  final deadline = state.respondByAt;
  if (deadline != null && !at.isBefore(deadline)) return true;
  if (state.proposedSlots.isEmpty) return false;
  return state.proposedSlots.every((slot) => !slot.isAgreeableAt(at));
}

/// Whether either party may still pull out.
///
/// Deliberately the most permissive gate there is - any open state, either
/// party, right up to an hour before an agreed time. Someone who cannot come
/// should never be forced to leave the other side waiting.
bool viewingCanCancel(ViewingState state, {DateTime? now}) {
  if (!state.isOpen) return false;
  final at = now ?? DateTime.now();
  if (viewingProposalExpired(state, now: at)) return false;
  if (state.purchaseStatus != viewingScheduled) return true;
  final agreed = state.appointmentStart;
  if (agreed == null) return true;
  return agreed.difference(at) > viewingEditFloor;
}

/// Whether [actor] may accept one of the times on the table.
///
/// Only the party being waited on, and only while at least one offered slot is
/// still more than an hour away: the server checks both, and a card offering
/// "Accept" over three slots that have all passed is a refusal waiting to
/// happen.
bool viewingCanAccept(ViewingState state, ViewingParty actor, {DateTime? now}) {
  if (!state.isOpen) return false;
  final at = now ?? DateTime.now();
  if (viewingProposalExpired(state, now: at)) return false;
  if (state.awaiting != actor) return false;
  return state.proposedSlots.any((slot) => slot.isAgreeableAt(at));
}

/// Whether [actor] may propose (or counter with) new times.
///
/// The round cap is the server's: after three rounds the parties must accept,
/// decline or cancel. Re-proposing against an already agreed time is a
/// reschedule and restarts the conversation instead of counting toward the
/// cap - a change of plan weeks later is not the haggling the cap exists to
/// stop.
bool viewingCanPropose(
  ViewingState state,
  ViewingParty actor, {
  DateTime? now,
}) {
  if (!state.isOpen) return false;
  final at = now ?? DateTime.now();
  if (viewingProposalExpired(state, now: at)) return false;
  if (state.purchaseStatus == viewingScheduled) {
    // A reschedule is subject to the same floor a cancellation is: nothing
    // moves inside the last hour.
    return viewingCanCancel(state, now: at);
  }
  return state.proposalRound + 1 <= maxViewingProposalRounds;
}

/// Whether the business may turn the viewing down outright.
///
/// The server would also take a decline on a countered or an agreed viewing.
/// Both clients keep it to the one place it reads as an answer - a buyer's
/// unanswered request - because declining a time you offered yourself, or one
/// both sides already agreed to, is a cancellation wearing another word.
/// Mirrors the console's `viewingActionAvailability`, which gates it the same
/// way; offering fewer actions than the server allows is safe, offering more
/// is not.
bool viewingCanDecline(
  ViewingState state,
  ViewingParty actor, {
  DateTime? now,
}) {
  if (actor != ViewingParty.business) return false;
  if (state.purchaseStatus != viewingRequested) return false;
  return !viewingProposalExpired(state, now: now ?? DateTime.now());
}

/// Everything [actor] may do to this viewing right now.
///
/// The screens branch on this rather than on the status directly, so the two
/// sides of the conversation cannot drift apart, and so a rule that changes on
/// the server changes in one place here.
///
/// The listing's own status is deliberately not consulted: the record does not
/// carry it, and the server refuses a viewing on a car that is no longer for
/// sale with a sentence of its own. Cancel survives that refusal, which is why
/// nobody is ever trapped in a record they cannot close.
Set<ViewingAction> availableViewingActions(
  ViewingState state,
  ViewingParty actor, {
  DateTime? now,
}) {
  final at = now ?? DateTime.now();
  return <ViewingAction>{
    if (viewingCanAccept(state, actor, now: at)) ViewingAction.accept,
    if (viewingCanPropose(state, actor, now: at)) ViewingAction.propose,
    if (viewingCanDecline(state, actor, now: at)) ViewingAction.decline,
    if (viewingCanCancel(state, now: at)) ViewingAction.cancel,
  };
}

/// How many times [actor] may put on the table at once. `MAX_COUNTER_SLOTS`
/// for a business, one for a customer.
int maxViewingSlotsFor(ViewingParty actor) =>
    actor == ViewingParty.business ? maxViewingCounterSlots : 1;

/// Everything a proposal can be refused for, in the server's own vocabulary so
/// the two never drift.
enum ViewingSlotError {
  /// Nothing chosen at all. `no_slots` on the server.
  noSlots,

  /// More alternatives than the party may offer. `too_many_slots`.
  tooManySlots,

  /// Inside the one-hour floor, so it could never be agreed to.
  /// `slot_too_soon`.
  slotTooSoon,
}

/// Every problem at once, not just the first - a sheet that reveals its
/// objections one submission at a time is how a scheduling thread dies.
List<ViewingSlotError> validateViewingSlots(
  List<ViewingSlot> slots, {
  required ViewingParty actor,
  DateTime? now,
}) {
  final at = now ?? DateTime.now();
  final errors = <ViewingSlotError>[];
  if (slots.isEmpty) errors.add(ViewingSlotError.noSlots);
  if (slots.length > maxViewingSlotsFor(actor)) {
    errors.add(ViewingSlotError.tooManySlots);
  }
  if (slots.any((slot) => !slot.isAgreeableAt(at))) {
    errors.add(ViewingSlotError.slotTooSoon);
  }
  return errors;
}

/// The times a picker offers, as instants with no words attached.
///
/// Lifted from the two copies the reservation sheets each kept, so the customer
/// and the business are choosing from the same grid: weekdays, four times a
/// day, starting from the next one at least [lead] away. The labels are the
/// caller's to format - they are what the other party reads, so they belong
/// where the locale is.
///
/// [lead] is two hours rather than the server's one-hour floor on purpose: a
/// slot that is legal when the sheet opens and illegal by the time it is sent
/// is a refusal nobody can act on.
List<DateTime> suggestedViewingStarts({
  DateTime? now,
  int count = 8,
  Duration lead = const Duration(hours: 2),
}) {
  final from = now ?? DateTime.now();
  final earliest = from.add(lead);
  final starts = <DateTime>[];
  var day = DateTime(from.year, from.month, from.day);

  while (starts.length < count) {
    day = day.add(const Duration(days: 1));
    if (day.weekday == DateTime.sunday) continue;
    for (final hour in const <int>[10, 12, 14, 16]) {
      final start = DateTime(day.year, day.month, day.day, hour);
      if (start.isBefore(earliest)) continue;
      starts.add(start);
      if (starts.length == count) break;
    }
  }
  return starts;
}

/// What `actOnCarViewing` answers with.
class CarViewingActionResult {
  const CarViewingActionResult({
    required this.success,
    required this.purchaseId,
    required this.purchaseStatus,
    required this.awaiting,
  });

  /// Reads the response defensively: an answer the app cannot parse must not
  /// read as "nobody is waiting on anything", which is what an unchecked cast
  /// would produce.
  factory CarViewingActionResult.fromCallable(Object? data) {
    final decoded = deepCastCallableValue(data);
    final row = decoded is Map ? decoded : const <Object?, Object?>{};
    return CarViewingActionResult(
      success: row['success'] != false,
      purchaseId: (row['purchaseId'] ?? '').toString().trim(),
      purchaseStatus: (row['purchaseStatus'] ?? '').toString().trim(),
      awaiting: viewingPartyFromWire(row['awaiting']),
    );
  }

  final bool success;
  final String purchaseId;
  final String purchaseStatus;

  /// Who owes the next reply, or null once a time is agreed and nobody does.
  final ViewingParty? awaiting;
}

/// The one callable every viewing transition goes through, behind an
/// injectable [FirebaseFunctions] so widget tests can drive the screens
/// without a network - the same shape [CarPurchaseService] already uses.
///
/// Refusals arrive as a `FirebaseFunctionsException` whose message is already
/// written for the person reading it ("Choose one of the times that was
/// offered"), so callers show `error.message` rather than inventing wording of
/// their own.
class CarViewingService {
  CarViewingService({FirebaseFunctions? functions})
    : _functions = functions ?? FirebaseFunctions.instance;

  final FirebaseFunctions _functions;

  Future<CarViewingActionResult> act({
    required String purchaseId,
    required ViewingAction action,
    List<ViewingSlot> slots = const <ViewingSlot>[],
  }) async {
    final response = await _functions
        .httpsCallable('actOnCarViewing')
        .call<Object?>(<String, dynamic>{
          'purchaseId': purchaseId,
          'action': action.wireValue,
          'slots': slots.map((slot) => slot.toWire()).toList(growable: false),
        });
    return CarViewingActionResult.fromCallable(response.data);
  }

  /// Puts times on the table. One slot from a customer, up to
  /// [maxViewingCounterSlots] from a business countering.
  Future<CarViewingActionResult> propose({
    required String purchaseId,
    required List<ViewingSlot> slots,
  }) =>
      act(purchaseId: purchaseId, action: ViewingAction.propose, slots: slots);

  /// Takes one of the times the other party offered. The slot must be one
  /// already on the table; the server refuses anything else rather than let
  /// "accept" become a silent way to set any time at all.
  Future<CarViewingActionResult> accept({
    required String purchaseId,
    required ViewingSlot slot,
  }) => act(
    purchaseId: purchaseId,
    action: ViewingAction.accept,
    slots: <ViewingSlot>[slot],
  );

  /// The business turning the viewing down outright.
  Future<CarViewingActionResult> decline({required String purchaseId}) =>
      act(purchaseId: purchaseId, action: ViewingAction.decline);

  /// Either party pulling out.
  Future<CarViewingActionResult> cancel({required String purchaseId}) =>
      act(purchaseId: purchaseId, action: ViewingAction.cancel);
}

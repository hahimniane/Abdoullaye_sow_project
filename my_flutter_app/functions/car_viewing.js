/**
 * Car viewing appointments, as a negotiation rather than a booking.
 *
 * Before this, a customer picked a time and the record was written straight to
 * `viewing_scheduled` - the business had no say and, because nothing on that
 * path sent a notification, often no idea it had happened. A viewing is an
 * appointment for two parties, so both have to agree to it.
 *
 * The shape is deliberately the same as the transport quote flow already in
 * this codebase: one side proposes, the other accepts or counters. People here
 * already understand that.
 *
 * Everything stays editable. Either party may re-propose, and either party may
 * cancel, right up until an hour before the agreed time - the same floor the
 * old edit path used. Locking a record down early only produces phone calls.
 */

/** Awaiting the business: the customer proposed and has not been answered. */
const VIEWING_REQUESTED = "viewing_requested";
/** Awaiting the customer: the business offered alternative slots. */
const VIEWING_COUNTERED = "viewing_countered";
/** Both parties agreed on a time. */
const VIEWING_SCHEDULED = "viewing_scheduled";
/** The business said no outright. */
const VIEWING_DECLINED = "viewing_declined";
/** Nobody answered before the deadline. */
const VIEWING_EXPIRED = "viewing_expired";
/** Either party pulled out. Shared with the rest of carPurchases. */
const VIEWING_CANCELLED = "cancelled";

const VIEWING_STATUSES = Object.freeze([
  VIEWING_REQUESTED,
  VIEWING_COUNTERED,
  VIEWING_SCHEDULED,
  VIEWING_DECLINED,
  VIEWING_EXPIRED,
  VIEWING_CANCELLED,
]);

/**
 * Statuses where the appointment has not happened and something can still
 * change. Used both for the "one active viewing per listing" guard and to
 * decide what a cancel is allowed to act on.
 */
const OPEN_VIEWING_STATUSES = Object.freeze([
  VIEWING_REQUESTED,
  VIEWING_COUNTERED,
  VIEWING_SCHEDULED,
]);

/** Waiting on someone to reply. */
const PENDING_VIEWING_STATUSES = Object.freeze([
  VIEWING_REQUESTED,
  VIEWING_COUNTERED,
]);

const CUSTOMER = "customer";
const BUSINESS = "business";

/**
 * A business may offer up to three alternatives in one counter. One-at-a-time
 * ping-pong is how scheduling threads die; three slots usually ends it in a
 * single round.
 */
const MAX_COUNTER_SLOTS = 3;

/**
 * Proposals allowed before the flow stops accepting counters and the parties
 * must accept, decline or cancel. Without a cap two stubborn people can pass a
 * record back and forth forever.
 */
const MAX_PROPOSAL_ROUNDS = 3;

/** Normal window to answer a proposal. */
const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Nothing may be agreed, moved or cancelled inside this window. Matches the
 * old assertViewingEditable floor so behaviour people already rely on does not
 * change underneath them.
 */
const EDIT_FLOOR_MS = 60 * 60 * 1000;

/**
 * When a proposal must be answered by.
 *
 * The deadline is the sooner of "a day from now" and "an hour before the
 * earliest slot on offer". Giving someone 24 hours to answer a request for
 * tomorrow morning would let it expire after the slot had already passed.
 *
 * @param {Array<object>} slots Proposed slots, each with startAtMs.
 * @param {number} nowMs Current time in ms.
 * @return {number} Deadline in ms since epoch.
 */
function responseDeadlineMs(slots, nowMs) {
  const earliest = slots
      .map((slot) => Number(slot.startAtMs))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)[0];
  const standard = nowMs + RESPONSE_WINDOW_MS;
  if (!Number.isFinite(earliest)) return standard;
  return Math.min(standard, earliest - EDIT_FLOOR_MS);
}

/**
 * Whether a proposal has run out of time.
 *
 * Two ways to expire, and the second is the one that bites: the deadline
 * passing, or every slot on the table having gone by while nobody answered.
 * Without the second check a business could "accept" a slot that was yesterday.
 *
 * @param {object} record The viewing record.
 * @param {number} nowMs Current time in ms.
 * @return {boolean} True when the proposal can no longer be answered.
 */
function isProposalExpired(record, nowMs) {
  if (!PENDING_VIEWING_STATUSES.includes(record.purchaseStatus)) return false;
  const deadline = Number(record.respondByAtMs);
  if (Number.isFinite(deadline) && nowMs >= deadline) return true;
  const slots = Array.isArray(record.proposedSlots) ? record.proposedSlots : [];
  if (slots.length === 0) return false;
  return slots.every((slot) => {
    const start = Number(slot.startAtMs);
    return Number.isFinite(start) && start - EDIT_FLOOR_MS <= nowMs;
  });
}

/**
 * Validates slots offered in a proposal.
 *
 * @param {Array<object>} slots Slots being offered, each with startAtMs.
 * @param {number} nowMs Current time in ms.
 * @param {number} maxSlots Most slots this proposal may carry.
 * @return {object} {ok} plus an {error} code when invalid.
 */
function validateProposedSlots(slots, nowMs, maxSlots) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return {ok: false, error: "no_slots"};
  }
  if (slots.length > maxSlots) {
    return {ok: false, error: "too_many_slots"};
  }
  for (const slot of slots) {
    const start = Number(slot?.startAtMs);
    if (!Number.isFinite(start)) return {ok: false, error: "invalid_slot"};
    // The same floor a change has to respect, applied when the slot is first
    // offered - otherwise a slot can be proposed that is already unagreeable.
    if (start - EDIT_FLOOR_MS <= nowMs) {
      return {ok: false, error: "slot_too_soon"};
    }
  }
  return {ok: true};
}

/**
 * Decides whether an action is allowed, and what it produces.
 *
 * Pure so the rules can be tested without Firestore. The caller applies the
 * returned status inside a transaction that re-reads the record, which is what
 * makes a simultaneous cancel-and-accept resolve to one winner rather than a
 * lost update.
 *
 * @param {object} params Everything the decision needs.
 * @param {object} params.record Current viewing record.
 * @param {string} params.actor CUSTOMER or BUSINESS.
 * @param {string} params.action propose | accept | decline | cancel.
 * @param {Array<object>} [params.slots] Slots, for propose.
 * @param {number} params.nowMs Current time in ms.
 * @param {string} [params.carStatus] Listing status, e.g. "active".
 * @return {object} {ok}, an {error} code when refused, and the
 *     {next} field values to apply when allowed.
 */
function decideViewingAction({
  record,
  actor,
  action,
  slots = [],
  nowMs,
  carStatus,
}) {
  const status = record?.purchaseStatus;
  if (!VIEWING_STATUSES.includes(status)) {
    return {ok: false, error: "not_a_viewing"};
  }
  if (!OPEN_VIEWING_STATUSES.includes(status)) {
    // declined, expired, cancelled - and completed/no_show, which never reach
    // here because they are not viewing statuses.
    return {ok: false, error: "viewing_closed"};
  }
  if (isProposalExpired(record, nowMs)) {
    return {ok: false, error: "proposal_expired"};
  }

  if (action === "cancel") {
    // Deliberately the most permissive action there is. Either party, from any
    // open state, up to the edit floor. Someone who cannot come should never
    // be forced to leave the other side waiting.
    if (status === VIEWING_SCHEDULED) {
      const agreed = Number(record.appointmentStartMs);
      if (Number.isFinite(agreed) && agreed - EDIT_FLOOR_MS <= nowMs) {
        return {ok: false, error: "too_close_to_appointment"};
      }
    }
    return {ok: true, next: {purchaseStatus: VIEWING_CANCELLED}};
  }

  // A listing that is no longer for sale cannot be viewed. Cancelling is still
  // allowed above, so nobody is trapped in a record they cannot close.
  if (carStatus && carStatus !== "active") {
    return {ok: false, error: "car_unavailable"};
  }

  if (action === "decline") {
    if (actor !== BUSINESS) return {ok: false, error: "not_your_action"};
    return {ok: true, next: {purchaseStatus: VIEWING_DECLINED}};
  }

  if (action === "accept") {
    const awaiting = awaitingParty(status);
    if (awaiting !== actor) return {ok: false, error: "not_your_turn"};
    const chosen = slots[0];
    const start = Number(chosen?.startAtMs);
    if (!Number.isFinite(start)) return {ok: false, error: "invalid_slot"};
    const offered = (record.proposedSlots || [])
        .map((slot) => Number(slot.startAtMs));
    if (!offered.includes(start)) {
      // Accepting has to mean accepting something that was actually offered.
      // Otherwise "accept" becomes a silent way to set any time at all.
      return {ok: false, error: "slot_not_offered"};
    }
    if (start - EDIT_FLOOR_MS <= nowMs) {
      return {ok: false, error: "slot_too_soon"};
    }
    return {
      ok: true,
      next: {
        purchaseStatus: VIEWING_SCHEDULED,
        appointmentStartMs: start,
        appointmentLabel: chosen.label || "",
      },
    };
  }

  if (action === "propose") {
    const maxSlots = actor === BUSINESS ? MAX_COUNTER_SLOTS : 1;
    const validation = validateProposedSlots(slots, nowMs, maxSlots);
    if (!validation.ok) return validation;

    const round = Number(record.proposalRound || 0) + 1;
    // Re-proposing against an already agreed time restarts the conversation
    // rather than counting toward the cap - a reschedule weeks later is not
    // the haggling the cap exists to stop.
    const isReschedule = status === VIEWING_SCHEDULED;
    if (!isReschedule && round > MAX_PROPOSAL_ROUNDS) {
      return {ok: false, error: "too_many_rounds"};
    }
    return {
      ok: true,
      next: {
        purchaseStatus: actor === CUSTOMER ?
          VIEWING_REQUESTED :
          VIEWING_COUNTERED,
        proposedBy: actor,
        proposedSlots: slots,
        proposalRound: isReschedule ? 1 : round,
        respondByAtMs: responseDeadlineMs(slots, nowMs),
      },
    };
  }

  return {ok: false, error: "unknown_action"};
}

/**
 * Who owes a reply in this state.
 *
 * @param {string} status A viewing status.
 * @return {string} CUSTOMER, BUSINESS, or "" when nobody is waiting.
 */
function awaitingParty(status) {
  if (status === VIEWING_REQUESTED) return BUSINESS;
  if (status === VIEWING_COUNTERED) return CUSTOMER;
  return "";
}

/**
 * One line of the audit trail.
 *
 * Kept because "they never offered me that time" is the argument this feature
 * will eventually produce, and a record settles it.
 *
 * @param {object} params Entry contents.
 * @param {string} params.actor Who acted.
 * @param {string} params.action What they did.
 * @param {Array<object>} [params.slots] Slots involved.
 * @param {number} params.atMs When.
 * @return {object} The history entry to append.
 */
function viewingHistoryEntry({actor, action, slots = [], atMs}) {
  return {
    actor,
    action,
    slots: slots.map((slot) => ({
      startAtMs: Number(slot.startAtMs),
      label: String(slot.label || ""),
    })),
    atMs,
  };
}

module.exports = {
  VIEWING_REQUESTED,
  VIEWING_COUNTERED,
  VIEWING_SCHEDULED,
  VIEWING_DECLINED,
  VIEWING_EXPIRED,
  VIEWING_CANCELLED,
  VIEWING_STATUSES,
  OPEN_VIEWING_STATUSES,
  PENDING_VIEWING_STATUSES,
  CUSTOMER,
  BUSINESS,
  MAX_COUNTER_SLOTS,
  MAX_PROPOSAL_ROUNDS,
  RESPONSE_WINDOW_MS,
  EDIT_FLOOR_MS,
  responseDeadlineMs,
  isProposalExpired,
  validateProposedSlots,
  decideViewingAction,
  awaitingParty,
  viewingHistoryEntry,
};

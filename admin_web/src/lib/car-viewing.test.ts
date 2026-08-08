// The console's copy of the car-viewing negotiation.
//
// A viewing is the one record in this codebase both parties act on, and every
// refusal the server can give has a matching gap in the UI: an accept button
// on somebody else's turn, a counter after the rounds are used up, any button
// at all inside the hour before the appointment. These tests pin the answers
// this module gives against the state machine they are ported from
// (`my_flutter_app/functions/car_viewing.js`).
//
// The two properties worth stating outright, because breaking either produces
// a genuinely stuck user:
//
//   1. Cancel is offered whenever the viewing is open, including on a listing
//      that is no longer active — the one action that must never disappear.
//   2. Nothing is offered that the callable would refuse.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_VIEWING_COUNTER_SLOTS,
  MAX_VIEWING_PROPOSAL_ROUNDS,
  VIEWING_EDIT_FLOOR_MS,
  VIEWING_SLOT_ERROR_MESSAGES,
  VIEWING_STATUS_LABELS,
  carPurchaseIsViewing,
  isViewingProposalExpired,
  validateViewingSlots,
  viewingActionAvailability,
  viewingActionPayload,
  viewingAwaitingParty,
  viewingHistoryFrom,
  viewingHistoryLabel,
  viewingRecordFrom,
  viewingSlotInputMin,
  viewingSlotsFrom,
  viewingStatusLabel,
  viewingWaitingLabel,
  type ViewingActor,
  type ViewingRecord,
} from "./car-viewing.ts";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);

function record(overrides: Partial<ViewingRecord> = {}): ViewingRecord {
  return {
    purchaseStatus: "viewing_requested",
    proposedSlots: [{ startAtMs: NOW + 5 * HOUR, label: "Sat 5pm" }],
    proposedBy: "customer",
    proposalRound: 1,
    respondByAtMs: NOW + 4 * HOUR,
    appointmentStartMs: null,
    appointmentLabel: "",
    ...overrides,
  };
}

function availability(
  actor: ViewingActor,
  overrides: Partial<ViewingRecord> = {},
  carStatus = "",
) {
  return viewingActionAvailability({
    record: record(overrides),
    actor,
    nowMs: NOW,
    carStatus,
  });
}

test("the caps are the server's", () => {
  assert.equal(MAX_VIEWING_COUNTER_SLOTS, 3);
  assert.equal(MAX_VIEWING_PROPOSAL_ROUNDS, 3);
  assert.equal(VIEWING_EDIT_FLOOR_MS, HOUR);
});

test("a viewing is recognised by payment type, and by the legacy shape", () => {
  assert.equal(carPurchaseIsViewing({ paymentType: "viewing_reservation" }), true);
  // Written before paymentType existed: an appointment with no deposit was
  // only ever a viewing.
  assert.equal(
    carPurchaseIsViewing({ appointmentStart: 1, depositAmount: 0 }),
    true,
  );
  assert.equal(
    carPurchaseIsViewing({ appointmentStart: 1, depositAmount: 500 }),
    false,
  );
  assert.equal(carPurchaseIsViewing({ paymentType: "reservation_deposit" }), false);
  assert.equal(carPurchaseIsViewing(null), false);
});

test("stored slots are read in time order and unusable ones are dropped", () => {
  assert.deepEqual(
    viewingSlotsFrom([
      { startAtMs: 3000, label: " late " },
      { startAtMs: "nonsense", label: "junk" },
      { startAtMs: 1000, label: "early" },
      null,
    ]),
    [
      { startAtMs: 1000, label: "early" },
      { startAtMs: 3000, label: "late" },
    ],
  );
  assert.deepEqual(viewingSlotsFrom(undefined), []);
});

test("a record is read the same whether Firestore hands back a Timestamp, a number, or a string", () => {
  const asTimestamp = viewingRecordFrom({
    purchaseStatus: "viewing_scheduled",
    appointmentStart: { toMillis: () => NOW },
    proposalRound: 2,
  });
  const asNumber = viewingRecordFrom({
    purchaseStatus: "viewing_scheduled",
    appointmentStart: NOW,
    proposalRound: 2,
  });
  const asString = viewingRecordFrom({
    purchaseStatus: "viewing_scheduled",
    appointmentStart: new Date(NOW).toISOString(),
    proposalRound: 2,
  });
  assert.equal(asTimestamp.appointmentStartMs, NOW);
  assert.deepEqual(asNumber, asTimestamp);
  assert.deepEqual(asString, asTimestamp);
});

test("who owes the reply, and how each side is told", () => {
  assert.equal(viewingAwaitingParty("viewing_requested"), "business");
  assert.equal(viewingAwaitingParty("viewing_countered"), "customer");
  assert.equal(viewingAwaitingParty("viewing_scheduled"), "");
  assert.equal(viewingAwaitingParty("cancelled"), "");

  assert.equal(viewingWaitingLabel("viewing_requested", "business"), "Your reply is needed");
  assert.equal(viewingWaitingLabel("viewing_requested", "customer"), "Waiting on the seller");
  assert.equal(viewingWaitingLabel("viewing_countered", "customer"), "Your reply is needed");
  assert.equal(viewingWaitingLabel("viewing_countered", "business"), "Waiting on the buyer");
  assert.equal(viewingWaitingLabel("viewing_scheduled", "customer"), "");
});

test("a request offers the business accept, counter and decline", () => {
  const business = availability("business");
  assert.equal(business.open, true);
  assert.equal(business.canAccept, true);
  assert.equal(business.canPropose, true);
  assert.equal(business.canDecline, true);
  assert.equal(business.canCancel, true);
  assert.equal(business.maxSlots, MAX_VIEWING_COUNTER_SLOTS);
  assert.equal(business.blockedReason, "");
});

test("the customer may re-propose or cancel a request, but not accept their own", () => {
  const customer = availability("customer");
  assert.equal(customer.canAccept, false);
  assert.equal(customer.canPropose, true);
  assert.equal(customer.canDecline, false);
  assert.equal(customer.canCancel, true);
  // Customers send exactly one time; only a business counters with several.
  assert.equal(customer.maxSlots, 1);
});

test("a counter puts accept in the customer's hands and takes it out of the business's", () => {
  const countered = { purchaseStatus: "viewing_countered", proposedBy: "business" };
  assert.equal(availability("customer", countered).canAccept, true);
  assert.equal(availability("business", countered).canAccept, false);
  // Decline is a business answer to a fresh request, nowhere else - less than
  // the server allows, which is the safe direction to differ in.
  assert.equal(availability("business", countered).canDecline, false);
});

test("an agreed viewing can be rescheduled or cancelled by either side, and accepted by neither", () => {
  const scheduled = {
    purchaseStatus: "viewing_scheduled",
    appointmentStartMs: NOW + 48 * HOUR,
    respondByAtMs: null,
    proposalRound: MAX_VIEWING_PROPOSAL_ROUNDS,
  };
  for (const actor of ["customer", "business"] as const) {
    const state = availability(actor, scheduled);
    assert.equal(state.canAccept, false);
    assert.equal(state.canCancel, true);
    // A reschedule restarts the conversation instead of counting toward the
    // cap, so a used-up round count does not block it.
    assert.equal(state.canPropose, true);
    assert.equal(state.proposalsLeft, MAX_VIEWING_PROPOSAL_ROUNDS);
  }
});

test("counters stop after three rounds; accepting, declining and cancelling do not", () => {
  const exhausted = { proposalRound: MAX_VIEWING_PROPOSAL_ROUNDS };
  const business = availability("business", exhausted);
  assert.equal(business.proposalsLeft, 0);
  assert.equal(business.canPropose, false);
  assert.equal(business.canAccept, true);
  assert.equal(business.canDecline, true);
  assert.equal(business.canCancel, true);

  assert.equal(availability("business", { proposalRound: 2 }).proposalsLeft, 1);
});

test("nothing may change inside the hour before the appointment - not even cancel", () => {
  const state = availability("customer", {
    purchaseStatus: "viewing_scheduled",
    appointmentStartMs: NOW + 30 * 60 * 1000,
    respondByAtMs: null,
  });
  assert.equal(state.open, false);
  assert.equal(state.canCancel, false);
  assert.equal(state.blockedReason, "tooCloseToAppointment");

  // An hour and a minute out is still fair game.
  assert.equal(
    availability("customer", {
      purchaseStatus: "viewing_scheduled",
      appointmentStartMs: NOW + HOUR + 60_000,
      respondByAtMs: null,
    }).canCancel,
    true,
  );
});

test("an inactive listing leaves cancel and nothing else", () => {
  const state = availability("business", {}, "sold");
  assert.equal(state.open, true);
  assert.equal(state.canCancel, true);
  assert.equal(state.canAccept, false);
  assert.equal(state.canPropose, false);
  assert.equal(state.canDecline, false);
  assert.equal(state.blockedReason, "carUnavailable");

  // Unknown listing status is not the same as an inactive one: the customer
  // console has no listings to read, and must not lose its buttons for it.
  assert.equal(availability("business", {}, "").canAccept, true);
  assert.equal(availability("business", {}, "active").canAccept, true);
});

test("a proposal expires on its deadline, or when every slot on it has gone by", () => {
  assert.equal(
    isViewingProposalExpired(record({ respondByAtMs: NOW - 1 }), NOW),
    true,
  );
  assert.equal(
    isViewingProposalExpired(
      record({
        respondByAtMs: NOW + 4 * HOUR,
        // Inside the edit floor, so it could never be agreed anyway.
        proposedSlots: [{ startAtMs: NOW + 30 * 60 * 1000, label: "soon" }],
      }),
      NOW,
    ),
    true,
  );
  // An agreed viewing is nobody's turn, so it cannot expire.
  assert.equal(
    isViewingProposalExpired(
      record({ purchaseStatus: "viewing_scheduled", respondByAtMs: NOW - 1 }),
      NOW,
    ),
    false,
  );
});

test("an expired proposal offers nothing, cancel included - the server checks expiry first", () => {
  const state = availability("business", { respondByAtMs: NOW - 1 });
  assert.equal(state.open, false);
  assert.equal(state.canCancel, false);
  assert.equal(state.blockedReason, "expired");
});

test("a closed viewing offers nothing at all", () => {
  for (const status of ["viewing_declined", "viewing_expired", "cancelled", "completed"]) {
    const state = availability("customer", { purchaseStatus: status });
    assert.equal(state.open, false);
    assert.equal(state.canCancel, false);
    assert.equal(state.blockedReason, "closed");
  }
});

test("only the offered times still far enough out may be accepted", () => {
  const state = availability("business", {
    proposedSlots: [
      { startAtMs: NOW + 30 * 60 * 1000, label: "too soon" },
      { startAtMs: NOW + 5 * HOUR, label: "fine" },
    ],
  });
  assert.deepEqual(state.acceptableSlots, [
    { startAtMs: NOW + 5 * HOUR, label: "fine" },
  ]);
  assert.equal(state.canAccept, true);
});

test("slot validation refuses exactly what the server refuses", () => {
  const good = { startAtMs: NOW + 5 * HOUR, label: "fine" };
  assert.equal(validateViewingSlots([good], NOW, 3), "");
  assert.equal(validateViewingSlots([], NOW, 3), "noSlots");
  assert.equal(validateViewingSlots([good, good], NOW, 1), "tooManySlots");
  assert.equal(
    validateViewingSlots([{ startAtMs: Number.NaN, label: "" }], NOW, 3),
    "invalidSlot",
  );
  assert.equal(
    validateViewingSlots([{ startAtMs: NOW + 30 * 60 * 1000, label: "" }], NOW, 3),
    "slotTooSoon",
  );
  // The sentences are the server's own, so a refusal caught here and one
  // caught by the callable read identically.
  assert.equal(
    VIEWING_SLOT_ERROR_MESSAGES.slotTooSoon,
    "Viewing times must be more than an hour away",
  );
  assert.equal(
    VIEWING_SLOT_ERROR_MESSAGES.tooManySlots,
    "Too many times offered at once",
  );
});

test("the payload carries ISO times and never a role", () => {
  const payload = viewingActionPayload({
    purchaseId: "purchase_1",
    action: "accept",
    slots: [{ startAtMs: NOW, label: "Sat 12pm" }],
  });
  assert.deepEqual(payload, {
    purchaseId: "purchase_1",
    action: "accept",
    slots: [{ startAt: new Date(NOW).toISOString(), label: "Sat 12pm" }],
  });
  // The callable derives the actor from the record. Anything the client sent
  // would be a claim, not a fact.
  assert.equal("role" in payload, false);
  assert.equal("actor" in payload, false);
  assert.deepEqual(
    viewingActionPayload({ purchaseId: "purchase_1", action: "cancel" }).slots,
    [],
  );
});

test("the datetime-local floor is local time, an hour out", () => {
  const min = viewingSlotInputMin(NOW);
  assert.match(min, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  // `new Date(value)` on a datetime-local string parses as local time, so the
  // round trip has to land exactly on the floor. A UTC-based minimum (the old
  // `toISOString().slice(0, 16)` habit) misses it by the timezone offset.
  assert.equal(new Date(min).getTime(), NOW + HOUR);
});

test("history is read oldest first and every actor-action pair has a phrase", () => {
  const history = viewingHistoryFrom({
    viewingHistory: [
      { actor: "business", action: "propose", slots: [{ startAtMs: NOW }], atMs: 200 },
      { actor: "customer", action: "propose", slots: [], atMs: 100 },
    ],
  });
  assert.deepEqual(
    history.map((entry) => entry.atMs),
    [100, 200],
  );
  assert.equal(viewingHistoryLabel(history[0]), "Buyer proposed a time");
  assert.equal(viewingHistoryLabel(history[1]), "Seller offered other times");
  assert.equal(
    viewingHistoryLabel({ actor: "platform", action: "expire", slots: [], atMs: 0 }),
    "Viewing updated",
  );
  assert.deepEqual(viewingHistoryFrom({}), []);
});

test("every viewing status has a name a customer can read", () => {
  for (const status of [
    "viewing_requested",
    "viewing_countered",
    "viewing_scheduled",
    "viewing_declined",
    "viewing_expired",
    "cancelled",
  ]) {
    assert.ok(VIEWING_STATUS_LABELS[status], `${status} has no label`);
    assert.equal(viewingStatusLabel(status), VIEWING_STATUS_LABELS[status]);
  }
  // Anything else keeps whatever the console already showed.
  assert.equal(viewingStatusLabel("reserved"), "");
});

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  VIEWING_REQUESTED,
  VIEWING_COUNTERED,
  VIEWING_SCHEDULED,
  VIEWING_DECLINED,
  VIEWING_CANCELLED,
  CUSTOMER,
  BUSINESS,
  MAX_COUNTER_SLOTS,
  MAX_PROPOSAL_ROUNDS,
  EDIT_FLOOR_MS,
  responseDeadlineMs,
  isProposalExpired,
  validateProposedSlots,
  decideViewingAction,
  awaitingParty,
} = require("../car_viewing");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1770000000000;

const slotAt = (offsetMs, label = "") => ({
  startAtMs: NOW + offsetMs,
  label,
});

const requested = (overrides = {}) => ({
  purchaseStatus: VIEWING_REQUESTED,
  proposedBy: CUSTOMER,
  proposedSlots: [slotAt(3 * DAY)],
  proposalRound: 1,
  respondByAtMs: NOW + DAY,
  ...overrides,
});

describe("viewing response deadlines", () => {
  it("gives a day to answer a proposal that is comfortably ahead", () => {
    assert.equal(responseDeadlineMs([slotAt(7 * DAY)], NOW), NOW + DAY);
  });

  it("shortens the deadline when the slot itself is sooner than a day", () => {
    // A request for tomorrow morning cannot carry a 24 hour reply window: the
    // window would outlive the slot.
    const deadline = responseDeadlineMs([slotAt(4 * HOUR)], NOW);
    assert.equal(deadline, NOW + 4 * HOUR - EDIT_FLOOR_MS);
    assert.ok(deadline < NOW + DAY);
  });

  it("uses the earliest slot when several are offered", () => {
    const deadline = responseDeadlineMs(
        [slotAt(5 * DAY), slotAt(3 * HOUR), slotAt(2 * DAY)],
        NOW,
    );
    assert.equal(deadline, NOW + 3 * HOUR - EDIT_FLOOR_MS);
  });
});

describe("viewing proposal expiry", () => {
  it("expires once the reply deadline has passed", () => {
    const record = requested({respondByAtMs: NOW - 1});
    assert.equal(isProposalExpired(record, NOW), true);
  });

  it("expires when every offered slot has gone by, deadline or not", () => {
    // The case that matters: nobody answered, the deadline is still in the
    // future, but the slots are in the past. Accepting here would schedule a
    // viewing for yesterday.
    const record = requested({
      respondByAtMs: NOW + DAY,
      proposedSlots: [slotAt(-2 * DAY), slotAt(-HOUR)],
    });
    assert.equal(isProposalExpired(record, NOW), true);
  });

  it("does not expire while at least one slot is still answerable", () => {
    const record = requested({
      proposedSlots: [slotAt(-2 * DAY), slotAt(3 * DAY)],
    });
    assert.equal(isProposalExpired(record, NOW), false);
  });

  it("never reports an agreed viewing as an expired proposal", () => {
    const record = {...requested(), purchaseStatus: VIEWING_SCHEDULED};
    assert.equal(isProposalExpired(record, NOW), false);
  });
});

describe("slot validation", () => {
  it("rejects an empty proposal", () => {
    assert.equal(validateProposedSlots([], NOW, 3).error, "no_slots");
  });

  it("caps how many alternatives a business may offer at once", () => {
    const slots = [slotAt(DAY), slotAt(2 * DAY), slotAt(3 * DAY),
      slotAt(4 * DAY)];
    assert.equal(
        validateProposedSlots(slots, NOW, MAX_COUNTER_SLOTS).error,
        "too_many_slots",
    );
  });

  it("rejects a slot inside the edit floor", () => {
    assert.equal(
        validateProposedSlots([slotAt(30 * 60 * 1000)], NOW, 3).error,
        "slot_too_soon",
    );
  });

  it("rejects an unparseable time", () => {
    assert.equal(
        validateProposedSlots([{startAtMs: "soon"}], NOW, 3).error,
        "invalid_slot",
    );
  });
});

describe("who owes a reply", () => {
  it("puts the ball with the business on a fresh request", () => {
    assert.equal(awaitingParty(VIEWING_REQUESTED), BUSINESS);
  });

  it("puts the ball with the customer after a counter", () => {
    assert.equal(awaitingParty(VIEWING_COUNTERED), CUSTOMER);
  });

  it("leaves nobody waiting once a time is agreed", () => {
    assert.equal(awaitingParty(VIEWING_SCHEDULED), "");
  });
});

describe("accepting", () => {
  it("schedules the viewing at the accepted slot", () => {
    const slot = slotAt(3 * DAY, "Tue 10:00");
    const result = decideViewingAction({
      record: requested({proposedSlots: [slot]}),
      actor: BUSINESS,
      action: "accept",
      slots: [slot],
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.ok, true);
    assert.equal(result.next.purchaseStatus, VIEWING_SCHEDULED);
    assert.equal(result.next.appointmentStartMs, slot.startAtMs);
    assert.equal(result.next.appointmentLabel, "Tue 10:00");
  });

  it("refuses to accept a time that was never offered", () => {
    // Otherwise "accept" is a back door for setting an arbitrary time without
    // the other party ever seeing it.
    const result = decideViewingAction({
      record: requested(),
      actor: BUSINESS,
      action: "accept",
      slots: [slotAt(5 * DAY)],
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "slot_not_offered");
  });

  it("refuses when it is not that party's turn", () => {
    const result = decideViewingAction({
      record: requested(),
      actor: CUSTOMER,
      action: "accept",
      slots: requested().proposedSlots,
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.error, "not_your_turn");
  });
});

describe("countering", () => {
  it("hands the decision back to the customer", () => {
    const result = decideViewingAction({
      record: requested(),
      actor: BUSINESS,
      action: "propose",
      slots: [slotAt(4 * DAY), slotAt(5 * DAY)],
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.ok, true);
    assert.equal(result.next.purchaseStatus, VIEWING_COUNTERED);
    assert.equal(result.next.proposedBy, BUSINESS);
    assert.equal(result.next.proposalRound, 2);
  });

  it("stops the haggling after the round cap", () => {
    const result = decideViewingAction({
      record: requested({proposalRound: MAX_PROPOSAL_ROUNDS}),
      actor: BUSINESS,
      action: "propose",
      slots: [slotAt(4 * DAY)],
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.error, "too_many_rounds");
  });

  it("treats re-proposing an agreed viewing as a fresh conversation", () => {
    // A reschedule three weeks later is not the back-and-forth the cap exists
    // to stop, so it restarts the count rather than hitting the ceiling.
    const result = decideViewingAction({
      record: {
        purchaseStatus: VIEWING_SCHEDULED,
        proposalRound: MAX_PROPOSAL_ROUNDS,
        appointmentStartMs: NOW + 10 * DAY,
        proposedSlots: [slotAt(10 * DAY)],
      },
      actor: CUSTOMER,
      action: "propose",
      slots: [slotAt(12 * DAY)],
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.ok, true);
    assert.equal(result.next.proposalRound, 1);
    assert.equal(result.next.purchaseStatus, VIEWING_REQUESTED);
  });

  it("lets a customer offer only one time", () => {
    const result = decideViewingAction({
      record: requested({purchaseStatus: VIEWING_COUNTERED}),
      actor: CUSTOMER,
      action: "propose",
      slots: [slotAt(4 * DAY), slotAt(5 * DAY)],
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.error, "too_many_slots");
  });
});

describe("cancelling stays available", () => {
  it("lets either party cancel while a reply is outstanding", () => {
    for (const actor of [CUSTOMER, BUSINESS]) {
      const result = decideViewingAction({
        record: requested(),
        actor,
        action: "cancel",
        nowMs: NOW,
        carStatus: "active",
      });
      assert.equal(result.ok, true, actor);
      assert.equal(result.next.purchaseStatus, VIEWING_CANCELLED);
    }
  });

  it("lets either party cancel an agreed viewing", () => {
    const result = decideViewingAction({
      record: {
        purchaseStatus: VIEWING_SCHEDULED,
        appointmentStartMs: NOW + 2 * DAY,
      },
      actor: CUSTOMER,
      action: "cancel",
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.ok, true);
  });

  it("still allows cancelling when the listing is no longer for sale", () => {
    // Nobody should be stuck holding a record they cannot close just because
    // the car sold.
    const result = decideViewingAction({
      record: requested(),
      actor: CUSTOMER,
      action: "cancel",
      nowMs: NOW,
      carStatus: "sold",
    });
    assert.equal(result.ok, true);
  });

  it("stops a cancellation inside the last hour", () => {
    const result = decideViewingAction({
      record: {
        purchaseStatus: VIEWING_SCHEDULED,
        appointmentStartMs: NOW + 30 * 60 * 1000,
      },
      actor: BUSINESS,
      action: "cancel",
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.error, "too_close_to_appointment");
  });
});

describe("closed and unavailable records", () => {
  it("refuses any action once the viewing is cancelled", () => {
    const result = decideViewingAction({
      record: {purchaseStatus: VIEWING_CANCELLED},
      actor: BUSINESS,
      action: "accept",
      slots: [slotAt(DAY)],
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.error, "viewing_closed");
  });

  it("refuses to schedule against a car that is no longer active", () => {
    const result = decideViewingAction({
      record: requested(),
      actor: BUSINESS,
      action: "accept",
      slots: requested().proposedSlots,
      nowMs: NOW,
      carStatus: "sold",
    });
    assert.equal(result.error, "car_unavailable");
  });

  it("refuses to answer a proposal that has already expired", () => {
    const result = decideViewingAction({
      record: requested({respondByAtMs: NOW - 1}),
      actor: BUSINESS,
      action: "accept",
      slots: requested().proposedSlots,
      nowMs: NOW,
      carStatus: "active",
    });
    assert.equal(result.error, "proposal_expired");
  });

  it("only lets the business decline", () => {
    assert.equal(
        decideViewingAction({
          record: requested(),
          actor: CUSTOMER,
          action: "decline",
          nowMs: NOW,
          carStatus: "active",
        }).error,
        "not_your_action",
    );
    assert.equal(
        decideViewingAction({
          record: requested(),
          actor: BUSINESS,
          action: "decline",
          nowMs: NOW,
          carStatus: "active",
        }).next.purchaseStatus,
        VIEWING_DECLINED,
    );
  });
});

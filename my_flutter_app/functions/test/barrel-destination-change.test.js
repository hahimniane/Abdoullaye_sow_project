const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  planBarrelDestinationRefund,
} = require("../barrel_destination_change");

describe("barrel destination change refunds", () => {
  it("returns an overpayment to the card it was taken from", () => {
    const plan = planBarrelDestinationRefund({
      differenceCents: -4500,
      paymentStatus: "succeeded",
      stripePaymentIntentId: "pi_123",
    });
    assert.deepEqual(plan, {
      action: "card_refund",
      refundCents: 4500,
      reason: "overpaid_on_card",
      paymentIntentId: "pi_123",
    });
  });

  it("never routes money to a platform-held balance", () => {
    // The wallet is retired (docs/PLAN-2026-08-backlog.md #3): the only
    // destination an overpayment can have is the original card.
    const actions = [-1, -100, -999999].map((cents) =>
      planBarrelDestinationRefund({
        differenceCents: cents,
        paymentStatus: "succeeded",
        stripePaymentIntentId: "pi_abc",
      }).action,
    );
    assert.deepEqual(actions, ["card_refund", "card_refund", "card_refund"]);
  });

  it("does nothing when the new destination costs the same or more", () => {
    for (const cents of [0, 1, 2500]) {
      const plan = planBarrelDestinationRefund({
        differenceCents: cents,
        paymentStatus: "succeeded",
        stripePaymentIntentId: "pi_123",
      });
      assert.equal(plan.action, "none");
      assert.equal(plan.refundCents, 0);
      assert.equal(plan.reason, "no_overpayment");
    }
  });

  it("does nothing when the shipment was never paid", () => {
    const plan = planBarrelDestinationRefund({
      differenceCents: -4500,
      paymentStatus: "pending",
      stripePaymentIntentId: "",
    });
    assert.equal(plan.action, "none");
    assert.equal(plan.refundCents, 0);
    assert.equal(plan.reason, "not_paid");
  });

  it("flags a paid shipment with no charge to refund against", () => {
    const plan = planBarrelDestinationRefund({
      differenceCents: -4500,
      paymentStatus: "succeeded",
      stripePaymentIntentId: "   ",
    });
    assert.equal(plan.action, "manual_review");
    assert.equal(plan.refundCents, 4500);
    assert.equal(plan.reason, "missing_payment_intent");
  });

  it("treats an unusable difference as nothing owed", () => {
    for (const value of [undefined, null, "", NaN, "abc"]) {
      const plan = planBarrelDestinationRefund({
        differenceCents: value,
        paymentStatus: "succeeded",
        stripePaymentIntentId: "pi_123",
      });
      assert.equal(plan.action, "none");
      assert.equal(plan.refundCents, 0);
    }
  });

  it("rounds a fractional difference to whole cents", () => {
    const plan = planBarrelDestinationRefund({
      differenceCents: -4500.4,
      paymentStatus: "succeeded",
      stripePaymentIntentId: "pi_123",
    });
    assert.equal(plan.refundCents, 4500);
  });
});

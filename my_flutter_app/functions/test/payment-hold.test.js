const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  CAPTURE_NOTICE_MS,
  CAPTURE_SAFETY_MS,
  paymentIntentSecured,
  checkoutSessionSecured,
  holdAction,
  cancellationOutcome,
  estimateProcessingFeeCents,
  newHoldRecord,
  captureDeadlineMs,
} = require("../payment_hold");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("what counts as money secured", () => {
  it("accepts a held intent, not only a captured one", () => {
    // requires_capture IS the feature. A handler that only accepts
    // "succeeded" silently rejects every held payment.
    assert.equal(paymentIntentSecured("succeeded"), true);
    assert.equal(paymentIntentSecured("requires_capture"), true);
  });

  it("rejects everything that is not money in hand", () => {
    for (const status of [
      "requires_payment_method", "requires_confirmation", "requires_action",
      "processing", "canceled", "", undefined, null,
    ]) {
      assert.equal(paymentIntentSecured(status), false, String(status));
    }
  });

  it("treats a complete-but-unpaid session as secured", () => {
    // With manual capture Stripe reports a completed session as "unpaid".
    // Taking that word at face value would void the entire hold model.
    const held = {
      status: "complete",
      payment_status: "unpaid",
      payment_intent: "pi_123",
    };
    const captured = {...held, payment_status: "paid"};
    assert.equal(checkoutSessionSecured(held), true);
    assert.equal(checkoutSessionSecured(captured), true);
  });

  it("still rejects sessions that are genuinely not done", () => {
    assert.equal(checkoutSessionSecured({
      status: "open", payment_status: "unpaid", payment_intent: "pi_1",
    }), false);
    assert.equal(checkoutSessionSecured({
      status: "complete", payment_status: "unpaid", payment_intent: "",
    }), false);
    assert.equal(checkoutSessionSecured(null), false);
  });
});

describe("when to act on a hold", () => {
  const deadline = 100 * DAY;

  it("waits while the deadline is far away", () => {
    assert.deepEqual(
        holdAction({captureBeforeMs: deadline, nowMs: deadline - 3 * DAY}),
        {action: "wait"},
    );
  });

  it("warns the customer about a day ahead", () => {
    assert.deepEqual(
        holdAction({captureBeforeMs: deadline, nowMs: deadline - 20 * HOUR}),
        {action: "notify"},
    );
    assert.equal(CAPTURE_NOTICE_MS, 24 * HOUR);
  });

  it("does not warn twice", () => {
    assert.deepEqual(
        holdAction({
          captureBeforeMs: deadline,
          nowMs: deadline - 20 * HOUR,
          noticeSent: true,
        }),
        {action: "wait"},
    );
  });

  it("captures inside the safety margin", () => {
    assert.deepEqual(
        holdAction({captureBeforeMs: deadline, nowMs: deadline - 5 * HOUR}),
        {action: "capture"},
    );
    assert.equal(CAPTURE_SAFETY_MS, 6 * HOUR);
  });

  it("captures even when the notice was never sent", () => {
    // A missed warning is an apology; a missed capture is the entire payment.
    assert.deepEqual(
        holdAction({
          captureBeforeMs: deadline,
          nowMs: deadline - 2 * HOUR,
          noticeSent: false,
        }),
        {action: "capture"},
    );
  });

  it("reports a dead hold instead of pretending to capture it", () => {
    // Past the deadline the network has already released the funds.
    assert.deepEqual(
        holdAction({captureBeforeMs: deadline, nowMs: deadline + 1}),
        {action: "overdue"},
    );
  });

  it("reports a hold it cannot schedule at all", () => {
    for (const bad of [undefined, null, NaN, "abc"]) {
      assert.deepEqual(
          holdAction({captureBeforeMs: bad, nowMs: 5 * DAY}),
          {action: "overdue"},
          String(bad),
      );
    }
  });
});

describe("what a cancellation does to the money", () => {
  it("releases an uncaptured hold for free, whoever cancels", () => {
    // Nothing settled, so there is no fee and nothing to refund. This is the
    // outcome the whole model exists to make common.
    for (const cancelledBy of ["customer", "business"]) {
      assert.deepEqual(
          cancellationOutcome({cancelledBy, captured: false,
            amountCents: 22000}),
          {kind: "release_hold", refundCents: 0, refundApplicationFee: false},
          cancelledBy,
      );
    }
  });

  it("charges the fee to the customer who cancels after capture", () => {
    // Told at checkout, charged as told: the fee lands on the person who
    // cancelled, using the REAL fee from the balance transaction.
    const outcome = cancellationOutcome({
      cancelledBy: "customer",
      captured: true,
      amountCents: 11000,
      stripeFeeCents: 349,
    });
    assert.deepEqual(outcome, {
      kind: "refund_minus_fee",
      refundCents: 10651,
      // The commission goes back to the BUSINESS: its balance funded the
      // customer's refund, and without this it would end a cancelled job out
      // of pocket by our commission. Customer pays only Stripe's fee.
      refundApplicationFee: true,
    });
  });

  it("gives everything back when the business cancels", () => {
    // The customer pays nothing for someone else's failure - and the platform
    // returns its commission, per the launch-meeting decision.
    const outcome = cancellationOutcome({
      cancelledBy: "business",
      captured: true,
      amountCents: 11000,
      stripeFeeCents: 349,
    });
    assert.deepEqual(outcome, {
      kind: "refund_full",
      refundCents: 11000,
      refundApplicationFee: true,
    });
  });

  it("never refunds a negative amount", () => {
    const outcome = cancellationOutcome({
      cancelledBy: "customer",
      captured: true,
      amountCents: 100,
      stripeFeeCents: 349,
    });
    assert.equal(outcome.refundCents, 0);
  });
});

describe("the fee quoted at checkout", () => {
  it("estimates standard card pricing", () => {
    // 2.9% + 30 cents. On a $110 barrel: $3.49.
    assert.equal(estimateProcessingFeeCents(11000), 349);
    assert.equal(estimateProcessingFeeCents(22000), 668);
  });

  it("quotes nothing on nothing", () => {
    for (const bad of [0, -5, NaN, undefined]) {
      assert.equal(estimateProcessingFeeCents(bad), 0, String(bad));
    }
  });
});

describe("reading Stripe's capture deadline", () => {
  it("uses the stamp on the charge when it is there", () => {
    const charge = {
      payment_method_details: {card: {capture_before: 1700000000}},
    };
    assert.equal(captureDeadlineMs(charge, 0), 1700000000 * 1000);
  });

  it("assumes the shortest network window when it is not", () => {
    // Five days is the shortest any card network uses (Visa MIT). Capturing
    // early is a non-event; capturing late is a lost payment.
    const authorizedAt = 50 * DAY;
    assert.equal(captureDeadlineMs({}, authorizedAt), authorizedAt + 5 * DAY);
  });
});

describe("the hold registry record", () => {
  it("carries everything the scheduler needs, denormalized", () => {
    const record = newHoldRecord({
      paymentIntentId: "pi_9",
      connectedAccountId: "acct_1",
      amountCents: 22000,
      captureBeforeMs: 7 * DAY,
      orderType: "barrelOrder",
      collection: "barrelOrders",
      recordId: "order-1",
      customerUid: "uid-1",
      nowMs: 1 * DAY,
    });
    assert.equal(record.status, "held");
    assert.equal(record.noticeSent, false);
    assert.equal(record.connectedAccountId, "acct_1");
    assert.equal(record.captureBeforeMs, 7 * DAY);
    assert.equal(record.amountCents, 22000);
  });
});

describe("what may be sent to Stripe", () => {
  const indexSource = require("node:fs")
      .readFileSync(require("node:path").join(__dirname, "..", "index.js"),
          "utf8");

  it("never asks Stripe for extended authorization at all", () => {
    // "if_available" does NOT degrade gracefully on a Checkout Session: an
    // account that is not on IC+ pricing gets
    // "This account is not eligible for the requested card features" and the
    // session is never created. This took down every web booking on
    // 2026-08-14. The PaymentIntent path accepts the same parameter fine,
    // so only the session builder is forbidden from sending it.
    // Both builders: the Checkout Session rejects the parameter at CREATE,
    // and the PaymentIntent accepts it at create then rejects at CONFIRM -
    // which is worse, because it passes any test that stops at creation.
    const start = indexSource.indexOf(
        "async function createStripeCustomerCheckoutSession");
    const end = indexSource.indexOf(
        "async function expireStripeCheckoutSession", start);
    const piStart = indexSource.indexOf(
        "async function createStripePaymentIntent");
    const piEnd = indexSource.indexOf("function stripeFormRequest", piStart);
    assert.ok(start > 0 && end > start, "session builder not found");
    assert.ok(piStart > 0 && piEnd > piStart, "intent builder not found");
    const session = indexSource.slice(start, end) +
      indexSource.slice(piStart, piEnd);
    // Asserts on what is SENT, not on prose - the comment above the fix
    // names the parameter deliberately so the reason survives.
    const sent = session
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
    assert.match(sent, /payment_intent_data\[capture_method\]/);
    assert.doesNotMatch(sent, /request_extended_authorization/);
  });
});

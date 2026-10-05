"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {monthEndBillingAmount} = require("../business_billing_plan");
const {
  SUBSCRIPTION_CHARGE_LEASE_MS,
  STRIPE_IDEMPOTENCY_SAFE_MS,
  SUBSCRIPTION_BILLING_PAGE_SIZE,
  subscriptionInvoiceAction,
  billingRunStart,
  accrualPageBusinessIds,
  summarizeBusinessAccruals,
  subscriptionAccrualEntry,
  subscriptionEventIsStale,
} = require("../subscription_billing");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "index.js"), "utf8");
const fnBody = (signature) => {
  const start = source.indexOf(signature);
  assert.ok(start > 0, `${signature} exists`);
  return source.slice(start, source.indexOf("\n}\n", start));
};
const exportBody = (name) => {
  const start = source.indexOf(`exports.${name} =`);
  assert.ok(start > 0, `${name} is exported`);
  return source.slice(start, source.indexOf("\n);\n", start));
};

const NOW = Date.UTC(2026, 9, 1, 12);

describe("a month is charged once per business", () => {
  it("never charges a paid or pending invoice again", () => {
    // Before the fix every re-run charged again; Stripe's idempotency key
    // only covered the first 24 hours.
    for (const status of ["paid", "pending"]) {
      const decision = subscriptionInvoiceAction(
          {status, stripePaymentIntentId: "pi_1"},
          {nowMs: NOW + 40 * 24 * 60 * 60 * 1000, canCharge: true},
      );
      assert.equal(decision.action, "skip", status);
    }
  });

  it("lets only one of two overlapping runs charge", () => {
    // Two runs read the same invoice; Firestore serializes the claiming
    // transactions, so the second sees the first one's claim.
    let invoice = null;
    const outcomes = [];
    for (const claimId of ["run_a", "run_b"]) {
      const decision = subscriptionInvoiceAction(invoice, {
        nowMs: NOW, canCharge: true,
      });
      outcomes.push(decision.action);
      if (decision.action === "charge") {
        invoice = {status: "charging", chargeClaimId: claimId,
          chargeClaimedAtMs: NOW};
      }
    }
    assert.deepEqual(outcomes, ["charge", "skip"]);
    // A report-only pass meanwhile must not clobber the claim either.
    assert.equal(
        subscriptionInvoiceAction(invoice, {nowMs: NOW, canCharge: false})
            .action,
        "skip",
    );
  });

  it("retries a crashed claim only inside Stripe's idempotency window", () => {
    const claimed = {status: "charging", chargeClaimedAtMs: NOW};
    const at = (offset) => subscriptionInvoiceAction(claimed, {
      nowMs: NOW + offset, canCharge: true,
    });
    assert.equal(at(SUBSCRIPTION_CHARGE_LEASE_MS - 1).reason,
        "charge_in_flight");
    assert.deepEqual(at(SUBSCRIPTION_CHARGE_LEASE_MS),
        {action: "charge", reason: "stale_claim_retry"});
    assert.deepEqual(at(STRIPE_IDEMPOTENCY_SAFE_MS),
        {action: "skip", reason: "needs_review"});
    assert.ok(STRIPE_IDEMPOTENCY_SAFE_MS < 24 * 60 * 60 * 1000);
    assert.equal(
        subscriptionInvoiceAction({status: "charging"}, {
          nowMs: NOW, canCharge: true,
        }).reason,
        "needs_review",
    );
  });

  it("charges or reports everything that has not moved money", () => {
    for (const existing of [null, {status: "report_only"},
      {status: "awaiting_card"}, {status: "failed"}]) {
      assert.equal(subscriptionInvoiceAction(existing, {
        nowMs: NOW, canCharge: true,
      }).action, "charge");
      assert.equal(subscriptionInvoiceAction(existing, {
        nowMs: NOW, canCharge: false,
      }).action, "report");
    }
  });
});

describe("a large month resumes instead of stopping", () => {
  it("skips a finished month on the scheduler's extra firings", () => {
    assert.equal(billingRunStart({status: "complete"}, "scheduled").skip,
        true);
  });

  it("resumes an unfinished run from its cursor", () => {
    for (const trigger of ["scheduled", "manual"]) {
      assert.deepEqual(
          billingRunStart({status: "in_progress", cursorBusinessId: "biz_m"},
              trigger),
          {skip: false, reason: "resume", cursorBusinessId: "biz_m",
            fresh: false},
      );
    }
  });

  it("lets an admin re-run a finished month from the top", () => {
    assert.deepEqual(billingRunStart({status: "complete",
      cursorBusinessId: "x"}, "manual"), {
      skip: false, reason: "fresh_pass", cursorBusinessId: null, fresh: true,
    });
    assert.equal(billingRunStart(null, "scheduled").fresh, true);
  });

  it("bills each business on a page once, whole", () => {
    assert.deepEqual(accrualPageBusinessIds([
      {businessId: "a", scope: "business"},
      {businessId: "a", scope: "carParking"},
      {businessId: ""},
      {businessId: "b"},
      {},
    ]), ["a", "b"]);
    const bill = summarizeBusinessAccruals([
      {scope: "business", accruedCommissionCents: 1000,
        accruedStripeFeeCents: 200, monthlyFeeCents: 5000,
        transactionCount: 3},
      {scope: "carParking", accruedCommissionCents: 9000,
        accruedStripeFeeCents: 0, monthlyFeeCents: 4000},
    ], monthEndBillingAmount);
    assert.equal(bill.amountCents, 1200 + 4000);
    assert.deepEqual(bill.buckets.map((b) => b.basis),
        ["accrued", "monthly_fee"]);
    assert.equal(bill.buckets[0].transactionCount, 3);
  });

  describe("index.js wiring", () => {
    it("gives the scheduled job a timeout and repeat firings", () => {
      const job = exportBody("chargeMonthlySubscriptions");
      assert.match(job, /timeoutSeconds: 540/);
      assert.match(job, /schedule: "0 8-23 1 \* \*"/);
      assert.match(job, /trigger: "scheduled"/);
      assert.match(exportBody("runSubscriptionBillingForMonth"),
          /trigger: "manual"/);
    });

    it("pages by businessId under a deadline and records its cursor", () => {
      const run = fnBody("async function runMonthlySubscriptionBilling(");
      assert.match(run, /collection\("businessBillingRuns"\)\.doc\(month\)/);
      assert.match(run, /billingRunStart\(/);
      assert.match(run, /\.orderBy\("businessId"\)/);
      assert.match(run, /\.limit\(SUBSCRIPTION_BILLING_PAGE_SIZE\)/);
      assert.match(run, /startAfter\(cursor\)/);
      assert.match(run, /Date\.now\(\) >= deadlineMs/);
      assert.match(run, /cursorBusinessId: cursor/);
      // The old shape loaded the whole month in one unbounded query.
      assert.doesNotMatch(run, /where\("month", "==", month\)\s*\.get\(\)/);
      assert.ok(SUBSCRIPTION_BILLING_PAGE_SIZE > 0);
    });

    it("claims the invoice in a transaction before charging", () => {
      const bill = fnBody("async function billBusinessForMonth(");
      const txAt = bill.indexOf("db.runTransaction(");
      const decideAt = bill.indexOf("subscriptionInvoiceAction(existing");
      const chargeAt = bill.indexOf("await chargeBusinessBillingCard(");
      assert.ok(txAt > 0 && txAt < decideAt && decideAt < chargeAt);
      assert.match(bill, /status: "charging"/);
      assert.match(bill, /if \(decision\.action === "skip"\)/);
    });

    it("ships the composite index the paged query needs", () => {
      const indexes = JSON.parse(fs.readFileSync(
          path.join(root, "..", "firestore.indexes.json"), "utf8",
      )).indexes;
      assert.ok(indexes.some((index) =>
        index.collectionGroup === "businessBillingAccruals" &&
        index.fields.map((f) => f.fieldPath).join(",") ===
          "month,businessId"));
    });
  });
});

describe("a payment accrues commission once", () => {
  const record = {
    billingMode: "subscription",
    businessId: "biz_1",
    subscriptionGrossCents: 10000,
    subscriptionCommissionCents: 800,
    subscriptionScope: "carParking",
    subscriptionMonthlyFeeCents: 4900,
  };

  it("keys the ledger entry by PaymentIntent", () => {
    const plan = subscriptionAccrualEntry(record, {
      paymentIntentId: "pi_123", nowMs: NOW,
    });
    assert.deepEqual(plan, {
      accrualId: "biz_1_2026-10_carParking",
      entryId: "pi_123",
      businessId: "biz_1",
      month: "2026-10",
      scope: "carParking",
      monthlyFeeCents: 4900,
      commissionCents: 800,
      stripeFeeCents: 320,
    });
  });

  it("adds a replayed completion zero more times", () => {
    // What the transaction does: create the entry, and increment only when
    // the create is new. Before the fix every completion incremented.
    const entries = new Set();
    const accrual = {accruedCommissionCents: 0, transactionCount: 0};
    for (let i = 0; i < 3; i += 1) {
      const plan = subscriptionAccrualEntry(record, {
        paymentIntentId: "pi_123", nowMs: NOW,
      });
      const key = `${plan.accrualId}/entries/${plan.entryId}`;
      if (entries.has(key)) continue;
      entries.add(key);
      accrual.accruedCommissionCents += plan.commissionCents;
      accrual.transactionCount += 1;
    }
    assert.deepEqual(accrual, {accruedCommissionCents: 800,
      transactionCount: 1});
  });

  it("accrues nothing it cannot key or that is not subscription-billed", () => {
    const opts = {paymentIntentId: "pi_1", nowMs: NOW};
    assert.equal(subscriptionAccrualEntry({...record,
      billingMode: "commission"}, opts), null);
    assert.equal(subscriptionAccrualEntry({...record, businessId: ""},
        opts), null);
    assert.equal(subscriptionAccrualEntry(record,
        {paymentIntentId: "", nowMs: NOW}), null);
    assert.equal(subscriptionAccrualEntry(record,
        {paymentIntentId: "pi/1", nowMs: NOW}), null);
  });
});

describe("Stripe subscription events apply in order", () => {
  it("ignores an event older than the one applied", () => {
    assert.equal(subscriptionEventIsStale({
      storedEventCreated: 1700000100, eventCreated: 1700000000,
    }), true);
  });

  it("applies newer and same-second events", () => {
    assert.equal(subscriptionEventIsStale({
      storedEventCreated: 1700000000, eventCreated: 1700000100,
    }), false);
    assert.equal(subscriptionEventIsStale({
      storedEventCreated: 1700000000, eventCreated: 1700000000,
    }), false);
  });

  it("accepts the first event for a business with nothing stored", () => {
    assert.equal(subscriptionEventIsStale({
      storedEventCreated: undefined, eventCreated: 1700000000,
    }), false);
  });

  it("will not let an undated event overwrite a dated one", () => {
    assert.equal(subscriptionEventIsStale({
      storedEventCreated: 1700000000, eventCreated: undefined,
    }), true);
  });

  describe("index.js wiring", () => {
    it("checks and writes the entitlement in one transaction", () => {
      const fn = fnBody("async function updateBusinessProEntitlement(");
      const readAt = fn.indexOf("transaction.get(subscriptionRef)");
      const checkAt = fn.indexOf("subscriptionEventIsStale(");
      const writeAt = fn.indexOf("transaction.set(subscriptionRef");
      assert.ok(readAt > 0 && readAt < checkAt && checkAt < writeAt);
      assert.match(fn, /stripeEventCreated:/);
      assert.doesNotMatch(fn, /db\.batch\(\)/);
    });

    it("passes every event's created time from the webhook", () => {
      const calls = source.split("await updateBusinessProEntitlement({")
          .slice(1)
          .map((tail) => tail.slice(0, tail.indexOf("});")));
      assert.equal(calls.length, 3);
      for (const call of calls) {
        assert.match(call, /eventCreated: event\.created/);
        assert.match(call, /eventId: event\.id/);
      }
    });
  });
});

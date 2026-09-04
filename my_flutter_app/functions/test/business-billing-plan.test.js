"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  estimateStripeFeeCents,
  normalizeBillingPlan,
  resolveBillingPlan,
  isSubscriptionBilled,
  subscriptionAccrualDelta,
  monthEndBillingAmount,
} = require("../business_billing_plan");

describe("plan resolution", () => {
  it("defaults to commission when nothing is configured", () => {
    assert.deepEqual(resolveBillingPlan({}, "carParking"), {
      mode: "commission", monthlyFeeCents: 0, source: "default",
    });
    assert.equal(isSubscriptionBilled({}, "carParking"), false);
  });

  it("business-wide subscription applies to every service", () => {
    const biz = {billingPlan: {mode: "subscription", monthlyFeeCents: 5000}};
    assert.deepEqual(resolveBillingPlan(biz, "freight"), {
      mode: "subscription", monthlyFeeCents: 5000, source: "business",
    });
    assert.ok(isSubscriptionBilled(biz, "freight"));
  });

  it("a per-service plan overrides the business-wide one", () => {
    const biz = {
      billingPlan: {mode: "subscription", monthlyFeeCents: 5000},
      serviceBillingPlan: {carParking: {mode: "commission"}},
    };
    assert.equal(resolveBillingPlan(biz, "carParking").mode, "commission");
    assert.equal(resolveBillingPlan(biz, "freight").mode, "subscription");
  });

  it("a subscription plan with no positive fee falls back", () => {
    assert.equal(
        normalizeBillingPlan({mode: "subscription", monthlyFeeCents: 0}),
        null,
    );
    assert.equal(
        resolveBillingPlan(
            {billingPlan: {mode: "subscription", monthlyFeeCents: 0}}, "x",
        ).mode,
        "commission",
    );
  });
});

describe("per-transaction accrual", () => {
  it("estimates the absorbed Stripe fee as 2.9% + 30c", () => {
    assert.equal(estimateStripeFeeCents(10000), 320); // 290 + 30
    assert.equal(estimateStripeFeeCents(0), 0);
  });

  it("accrues forgone commission plus the absorbed Stripe fee", () => {
    // $100 charge, 10% commission: commission 1000c, stripe est 320c.
    assert.deepEqual(
        subscriptionAccrualDelta({grossCents: 10000, platformFeePct: 0.1}),
        {commissionCents: 1000, stripeFeeCents: 320},
    );
    // A real settled Stripe fee overrides the estimate.
    assert.deepEqual(
        subscriptionAccrualDelta(
            {grossCents: 10000, platformFeePct: 0.1, stripeFeeCents: 313}),
        {commissionCents: 1000, stripeFeeCents: 313},
    );
  });
});

describe("month-end 'whichever is smaller'", () => {
  it("bills the accrued total when it is below the flat fee", () => {
    // accrued 3000+900=3900 < 5000 flat -> pay 3900.
    assert.deepEqual(
        monthEndBillingAmount({
          accruedCommissionCents: 3000,
          accruedStripeFeeCents: 900,
          monthlyFeeCents: 5000,
        }),
        {
          amountCents: 3900, basis: "accrued",
          accruedCents: 3900, monthlyFeeCents: 5000,
        },
    );
  });

  it("caps at the flat fee when the accrued total exceeds it", () => {
    // accrued 20000+2000=22000 > 5000 -> pay 5000.
    const r = monthEndBillingAmount({
      accruedCommissionCents: 20000,
      accruedStripeFeeCents: 2000,
      monthlyFeeCents: 5000,
    });
    assert.equal(r.amountCents, 5000);
    assert.equal(r.basis, "monthly_fee");
  });

  it("a tie bills the agreed flat fee", () => {
    const r = monthEndBillingAmount({
      accruedCommissionCents: 5000,
      accruedStripeFeeCents: 0,
      monthlyFeeCents: 5000,
    });
    assert.equal(r.amountCents, 5000);
    assert.equal(r.basis, "monthly_fee");
  });
});

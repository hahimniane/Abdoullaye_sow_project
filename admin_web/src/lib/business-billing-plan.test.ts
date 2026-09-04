import assert from "node:assert/strict";
import test from "node:test";

import {
  feeDollarsToCents,
  resolveBillingPlan,
  isSubscriptionBilled,
  normalizeBillingPlan,
  monthEndBillingAmount,
  validateBillingPlanDraft,
  billingPlanPayload,
  estimateStripeFeeCents,
} from "./business-billing-plan.ts";

test("fee input parses to cents; junk is null", () => {
  assert.equal(feeDollarsToCents("50"), 5000);
  assert.equal(feeDollarsToCents("$1,200.00"), 120000);
  assert.equal(feeDollarsToCents(""), null);
  assert.equal(feeDollarsToCents("-5"), null);
});

test("plan resolves per-service over business over default commission", () => {
  assert.equal(resolveBillingPlan({}, "freight").mode, "commission");
  const biz = {
    billingPlan: { mode: "subscription", monthlyFeeCents: 5000 },
    serviceBillingPlan: { carParking: { mode: "commission" } },
  };
  assert.equal(resolveBillingPlan(biz, "freight").source, "business");
  assert.ok(isSubscriptionBilled(biz, "freight"));
  assert.equal(resolveBillingPlan(biz, "carParking").mode, "commission");
});

test("a subscription plan with no positive fee is invalid", () => {
  assert.equal(
    normalizeBillingPlan({ mode: "subscription", monthlyFeeCents: 0 }),
    null,
  );
});

test("month-end pays whichever is smaller (commission+stripe vs flat)", () => {
  assert.equal(
    monthEndBillingAmount({
      accruedCommissionCents: 3000,
      accruedStripeFeeCents: 900,
      monthlyFeeCents: 5000,
    }).amountCents,
    3900,
  );
  const capped = monthEndBillingAmount({
    accruedCommissionCents: 20000,
    accruedStripeFeeCents: 2000,
    monthlyFeeCents: 5000,
  });
  assert.equal(capped.amountCents, 5000);
  assert.equal(capped.basis, "monthly_fee");
});

test("stripe estimate is 2.9% + 30c", () => {
  assert.equal(estimateStripeFeeCents(10000), 320);
});

test("draft validation and payload", () => {
  assert.deepEqual(validateBillingPlanDraft("subscription", ""), [
    "billing_fee_required",
  ]);
  assert.deepEqual(validateBillingPlanDraft("subscription", "50"), []);
  assert.deepEqual(validateBillingPlanDraft("commission", ""), []);
  assert.deepEqual(billingPlanPayload("subscription", "50"), {
    mode: "subscription",
    monthlyFeeCents: 5000,
  });
  assert.deepEqual(billingPlanPayload("commission", ""), {
    mode: "commission",
    monthlyFeeCents: 0,
  });
});

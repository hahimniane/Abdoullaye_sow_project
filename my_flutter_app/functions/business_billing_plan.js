"use strict";

/**
 * Subscription billing — the flat-monthly-fee alternative to per-transaction
 * commission, resolved in one place (a deliberate sibling of platform_fees.js).
 *
 * A business (or one of its services) can be put on a "subscription" plan by an
 * admin. Under that plan, for the covered service:
 *   - the charge runs on the PLATFORM account, so Laawol pays Stripe's fee and
 *     the business receives 100% of the payout during the month (no per-
 *     transaction commission is skimmed);
 *   - the platform ACCRUES, per transaction, what it gave up: the commission it
 *     would have taken PLUS the Stripe processing fee it absorbed;
 *   - at month end the business is charged the SMALLER of that accrued
 *     total and the flat monthly fee — "pay whichever is smaller".
 *
 * This module is pure: it resolves the plan, decides the per-transaction
 * accrual, and computes the month-end amount. Every Firestore/Stripe call stays
 * with the caller in index.js. Mirrored by admin_web/src/lib/
 * business-billing-plan.ts and validated by business-billing-plan.test.js.
 */

const BILLING_MODES = Object.freeze(["commission", "subscription"]);
const DEFAULT_BILLING_MODE = "commission";

// Stripe US card pricing, used to ESTIMATE the fee Laawol absorbs at charge
// time (the exact fee is only known once the balance transaction settles; the
// webhook reconciles the accrual with the real number when it arrives).
const STRIPE_PCT = 0.029;
const STRIPE_FIXED_CENTS = 30;

/**
 * @param {number} grossCents The charge amount.
 * @return {number} The estimated Stripe processing fee, in cents.
 */
function estimateStripeFeeCents(grossCents) {
  const gross = Math.max(0, Math.round(Number(grossCents) || 0));
  if (gross === 0) return 0;
  return Math.round(gross * STRIPE_PCT) + STRIPE_FIXED_CENTS;
}

/**
 * A stored plan, normalized. `monthlyFeeCents` is only meaningful for
 * subscription mode; a non-positive fee falls back to commission so a
 * half-configured plan never bills nothing.
 *
 * @param {*} raw The stored plan object.
 * @return {?{mode: string, monthlyFeeCents: number}} The plan, or null.
 */
function normalizeBillingPlan(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mode = String(raw.mode || "").trim();
  if (!BILLING_MODES.includes(mode)) return null;
  if (mode === "commission") return {mode, monthlyFeeCents: 0};
  const fee = Math.round(Number(raw.monthlyFeeCents) || 0);
  if (!Number.isFinite(fee) || fee <= 0) return null;
  return {mode: "subscription", monthlyFeeCents: fee};
}

/**
 * The plan in force for a service, most specific first: the business's
 * per-service plan, then its business-wide plan, then plain commission.
 *
 * @param {?Object} business The business document.
 * @param {string} serviceKey e.g. "carParking", "freight". "" for none.
 * @return {{mode: string, monthlyFeeCents: number, source: string}}
 */
function resolveBillingPlan(business, serviceKey = "") {
  const perService = business?.serviceBillingPlan;
  if (perService && typeof perService === "object" && serviceKey) {
    const plan = normalizeBillingPlan(perService[serviceKey]);
    if (plan) return {...plan, source: "service"};
  }
  const wide = normalizeBillingPlan(business?.billingPlan);
  if (wide) return {...wide, source: "business"};
  return {mode: DEFAULT_BILLING_MODE, monthlyFeeCents: 0, source: "default"};
}

/**
 * True when the covered service should run as a platform charge with a full
 * payout and month-end accrual instead of a per-transaction commission skim.
 *
 * @param {?Object} business The business document.
 * @param {string} serviceKey The service being charged.
 * @return {boolean}
 */
function isSubscriptionBilled(business, serviceKey = "") {
  return resolveBillingPlan(business, serviceKey).mode === "subscription";
}

/**
 * What one subscription-billed transaction adds to the month's accrual: the
 * commission Laawol forwent plus the Stripe fee it absorbed. `stripeFeeCents`
 * may be supplied (the real settled fee); otherwise it is estimated.
 *
 * @param {object} params grossCents, platformFeePct, [stripeFeeCents].
 * @return {{commissionCents: number, stripeFeeCents: number}}
 */
function subscriptionAccrualDelta(
    {grossCents, platformFeePct, stripeFeeCents}) {
  const gross = Math.max(0, Math.round(Number(grossCents) || 0));
  const pct = Number(platformFeePct);
  const commissionCents = Number.isFinite(pct) && pct > 0 ?
    Math.round(gross * pct) : 0;
  const absorbed = stripeFeeCents === undefined || stripeFeeCents === null ?
    estimateStripeFeeCents(gross) :
    Math.max(0, Math.round(Number(stripeFeeCents) || 0));
  return {commissionCents, stripeFeeCents: absorbed};
}

/**
 * The month-end amount and which side won. "pay whichever is smaller": the
 * flat fee versus (accrued commission + accrued absorbed Stripe fees).
 *
 * @param {object} params accruedCommissionCents, accruedStripeFeeCents,
 *   monthlyFeeCents.
 * @return {{amountCents: number, basis: string, accruedCents: number,
 *   monthlyFeeCents: number}}
 */
function monthEndBillingAmount({
  accruedCommissionCents,
  accruedStripeFeeCents,
  monthlyFeeCents,
}) {
  const accrued = Math.max(0, Math.round(Number(accruedCommissionCents) || 0)) +
    Math.max(0, Math.round(Number(accruedStripeFeeCents) || 0));
  const monthly = Math.max(0, Math.round(Number(monthlyFeeCents) || 0));
  // Whichever is smaller. A tie bills the flat fee (the agreed number).
  const useAccrued = accrued < monthly;
  return {
    amountCents: useAccrued ? accrued : monthly,
    basis: useAccrued ? "accrued" : "monthly_fee",
    accruedCents: accrued,
    monthlyFeeCents: monthly,
  };
}

module.exports = {
  BILLING_MODES,
  DEFAULT_BILLING_MODE,
  STRIPE_PCT,
  STRIPE_FIXED_CENTS,
  estimateStripeFeeCents,
  normalizeBillingPlan,
  resolveBillingPlan,
  isSubscriptionBilled,
  subscriptionAccrualDelta,
  monthEndBillingAmount,
};

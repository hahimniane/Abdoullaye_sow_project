"use strict";

/**
 * Month-end subscription billing and Business Pro entitlement - the decisions
 * that keep a business from being charged twice, and an old Stripe event from
 * undoing a newer one.
 *
 * Pure: every Firestore transaction and Stripe call stays in index.js. These
 * functions decide; the caller runs them INSIDE a transaction against the
 * document it just read, which is what makes "check, then claim" atomic.
 *
 * Why this exists (audit, 2026-10):
 *   1. Re-running a month (the scheduler retrying, an admin pressing "run
 *      billing" again, two runs overlapping) charged every business again.
 *      Stripe's Idempotency-Key only dedupes for 24 hours, so a re-run the
 *      next day was a second real charge.
 *   2. The scheduled run had the default timeout and one unbounded loop, so a
 *      large month silently stopped part way and nothing resumed it.
 *   3. A settled payment could be completed twice (webhook + return page +
 *      stale sweep racing), and each completion added its commission to the
 *      month's accrual again - billing the business for money it never owed.
 *   4. Stripe does not deliver events in order. An older
 *      `customer.subscription.updated` arriving late flipped a business back
 *      to a stale plan.
 */

const {subscriptionAccrualDelta} = require("./business_billing_plan");

/**
 * How long a "charging" claim on an invoice blocks other runs. Long enough to
 * cover one off-session charge with retries; short enough that a crashed run
 * does not lock the invoice for the day.
 */
const SUBSCRIPTION_CHARGE_LEASE_MS = 15 * 60 * 1000;

/**
 * Stripe keeps an Idempotency-Key for 24 hours. Inside that window a retry
 * with the same key returns the original PaymentIntent instead of charging
 * again, so a stale claim may safely be retried. Past it, a retry is a brand
 * new charge - and we cannot tell whether the crashed run's charge landed.
 * One hour of margin under Stripe's 24.
 */
const STRIPE_IDEMPOTENCY_SAFE_MS = 23 * 60 * 60 * 1000;

/** Accrual documents read per page by the month-end run. */
const SUBSCRIPTION_BILLING_PAGE_SIZE = 50;

/**
 * What the month-end run may do with one business's invoice, given the
 * invoice as it stands right now (read inside the claiming transaction).
 *
 * - `charge`: take the claim and charge the card.
 * - `report`: write the computed bill without charging (report-only mode, or
 *   no card on file).
 * - `skip`: leave the invoice alone - it is paid, a charge is in flight, or a
 *   person has to look at it.
 *
 * @param {?object} existing The invoice document, or null when none exists.
 * @param {object} params Inputs.
 * @param {number} params.nowMs The current time.
 * @param {boolean} params.canCharge Whether this run may charge at all.
 * @return {{action: string, reason: string}} The decision.
 */
function subscriptionInvoiceAction(existing, {nowMs, canCharge}) {
  const invoice = existing && typeof existing === "object" ? existing : null;
  const status = String(invoice?.status || "").trim();
  if (status === "paid") return {action: "skip", reason: "already_paid"};
  if (status === "pending") {
    // Stripe accepted the charge and is still settling it (or it needs the
    // customer). Charging again would be a second charge for the same month.
    return {action: "skip", reason: "charge_pending"};
  }
  if (status === "charging") {
    const claimedAt = Number(invoice.chargeClaimedAtMs);
    const now = Number(nowMs);
    if (!Number.isFinite(claimedAt) || claimedAt <= 0 ||
        !Number.isFinite(now)) {
      // A claim we cannot date is a claim we cannot prove is dead.
      return {action: "skip", reason: "needs_review"};
    }
    const age = now - claimedAt;
    if (age < SUBSCRIPTION_CHARGE_LEASE_MS) {
      return {action: "skip", reason: "charge_in_flight"};
    }
    if (age >= STRIPE_IDEMPOTENCY_SAFE_MS) {
      // The run that claimed this crashed, and Stripe has forgotten its
      // idempotency key. Whether that charge landed is unknowable from here.
      return {action: "skip", reason: "needs_review"};
    }
    // Crashed inside the idempotency window: the same key replays the same
    // PaymentIntent, so retrying cannot charge twice.
    return canCharge ?
      {action: "charge", reason: "stale_claim_retry"} :
      {action: "skip", reason: "charge_in_flight"};
  }
  if (canCharge) return {action: "charge", reason: "claimable"};
  return {action: "report", reason: "cannot_charge"};
}

/**
 * Where a month-end run starts.
 *
 * The scheduler fires several times on the 1st so a run that hit its deadline
 * resumes; once a month is complete the extra firings do nothing. An admin's
 * manual run resumes an unfinished pass, or starts a fresh pass over a
 * finished month (that is how report-only months get charged after
 * auto-charge is switched on). A fresh pass is safe because every invoice is
 * claimed before it is charged.
 *
 * @param {?object} run The `businessBillingRuns/{month}` document, or null.
 * @param {string} trigger "scheduled" or "manual".
 * @return {{skip: boolean, reason: string, cursorBusinessId: ?string,
 *   fresh: boolean}} Where to begin.
 */
function billingRunStart(run, trigger) {
  const status = String(run?.status || "").trim();
  const cursor = String(run?.cursorBusinessId || "").trim() || null;
  if (status === "complete") {
    if (trigger === "manual") {
      return {skip: false, reason: "fresh_pass", cursorBusinessId: null,
        fresh: true};
    }
    return {skip: true, reason: "already_complete", cursorBusinessId: null,
      fresh: false};
  }
  if (status === "in_progress") {
    return {skip: false, reason: "resume", cursorBusinessId: cursor,
      fresh: false};
  }
  return {skip: false, reason: "first_pass", cursorBusinessId: null,
    fresh: true};
}

/**
 * The distinct business ids on one page of accrual documents, in page order.
 * Each business is then billed from ALL of its buckets (read separately), so
 * a business whose buckets straddle two pages is still billed once, whole.
 *
 * @param {Array<object>} rows Accrual documents, ordered by businessId.
 * @return {Array<string>} Business ids, first-seen order, no blanks.
 */
function accrualPageBusinessIds(rows) {
  const ids = [];
  const seen = new Set();
  for (const row of rows || []) {
    const id = String(row?.businessId || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Bill-ready summary of one business's buckets for a month.
 *
 * @param {Array<object>} rows That business's accrual documents.
 * @param {function} amountFor monthEndBillingAmount (injected so this module
 *   does not decide the "whichever is smaller" rule twice).
 * @return {{amountCents: number, buckets: Array<object>}} The bill.
 */
function summarizeBusinessAccruals(rows, amountFor) {
  let amountCents = 0;
  const buckets = [];
  for (const row of rows || []) {
    const bucket = amountFor({
      accruedCommissionCents: row?.accruedCommissionCents,
      accruedStripeFeeCents: row?.accruedStripeFeeCents,
      monthlyFeeCents: row?.monthlyFeeCents,
    });
    amountCents += bucket.amountCents;
    buckets.push({
      scope: String(row?.scope || "business"),
      ...bucket,
      transactionCount: Number(row?.transactionCount || 0),
    });
  }
  return {amountCents, buckets};
}

/**
 * What one settled subscription-billed payment adds to its business's
 * accrual, and the ledger entry that makes adding it idempotent.
 *
 * The entry lives at `businessBillingAccruals/{accrualId}/entries/{entryId}`
 * and is keyed by the PaymentIntent. The caller creates it in the same
 * transaction that increments the accrual, and skips both when it already
 * exists - so however many times a payment is completed, it accrues once.
 *
 * @param {object} record The settled payment record.
 * @param {object} params Inputs.
 * @param {string} params.paymentIntentId The intent that settled it.
 * @param {number} params.nowMs The current time (picks the month).
 * @return {?object} The plan, or null when nothing should accrue.
 */
function subscriptionAccrualEntry(record, {paymentIntentId, nowMs}) {
  if (String(record?.billingMode || "") !== "subscription") return null;
  const businessId = String(record?.businessId || "").trim();
  const entryId = String(paymentIntentId || "").trim();
  if (!businessId || !entryId || entryId.includes("/")) return null;
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return null;
  const delta = subscriptionAccrualDelta({
    grossCents: Number(record.subscriptionGrossCents || 0),
    platformFeePct: 0,
  });
  const commissionCents =
    Math.max(0, Math.round(Number(record.subscriptionCommissionCents || 0)));
  const scope = String(record.subscriptionScope || "business");
  const monthlyFeeCents =
    Math.max(0, Math.round(Number(record.subscriptionMonthlyFeeCents || 0)));
  const month = new Date(now).toISOString().slice(0, 7);
  return {
    accrualId: `${businessId}_${month}_${scope}`,
    entryId,
    businessId,
    month,
    scope,
    monthlyFeeCents,
    commissionCents,
    stripeFeeCents: delta.stripeFeeCents,
  };
}

/**
 * Whether a Stripe subscription event is older than the one already applied.
 *
 * Stripe stamps every event with `created` (epoch seconds) and does not
 * promise delivery order. An event older than the stored one is ignored.
 * Equal timestamps apply (Stripe often emits several events in the same
 * second, and that is no worse than before). A business with nothing stored
 * yet - every business before this fix - accepts the event.
 *
 * @param {object} params Inputs.
 * @param {*} params.storedEventCreated The applied event's created, if any.
 * @param {*} params.eventCreated The incoming event's created.
 * @return {boolean} True when the incoming event must be ignored.
 */
function subscriptionEventIsStale({storedEventCreated, eventCreated}) {
  const stored = Number(storedEventCreated);
  const incoming = Number(eventCreated);
  if (!Number.isFinite(stored) || stored <= 0) return false;
  // An event we cannot date cannot be proven newer than one we can.
  if (!Number.isFinite(incoming) || incoming <= 0) return true;
  return incoming < stored;
}

module.exports = {
  SUBSCRIPTION_CHARGE_LEASE_MS,
  STRIPE_IDEMPOTENCY_SAFE_MS,
  SUBSCRIPTION_BILLING_PAGE_SIZE,
  subscriptionInvoiceAction,
  billingRunStart,
  accrualPageBusinessIds,
  summarizeBusinessAccruals,
  subscriptionAccrualEntry,
  subscriptionEventIsStale,
};

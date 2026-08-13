/**
 * Hold first, charge later. The platform's payment-timing policy in one place.
 *
 * Decided 2026-08-10 (see docs/PLAN-payment-timing-and-cancellation.md):
 * every booking payment starts as an authorization - a hold - not a charge.
 * A hold that is cancelled costs nothing, because nothing ever settled; that
 * is the whole point. The rules this module encodes:
 *
 * 1. **Cancel while held: completely free.** The hold is released.
 * 2. **Capture just before the hold expires.** The card networks release an
 *    uncaptured authorization - most cards after 7 days, Visa
 *    merchant-initiated after 5, extended authorizations after ~30. Stripe
 *    stamps the exact deadline on every charge (`capture_before`); this module
 *    schedules from THAT, never from a hardcoded day count, because guessing
 *    wrong means the hold evaporates and the platform gets nothing.
 * 3. **Warn the customer ~24h before capturing.** Cheap to send, and it is
 *    the difference between "I knew this was coming" and a dispute.
 * 4. **Cancel after capture: refund minus the processing fee** - the fee
 *    Stripe keeps on refund lands on the person who cancelled, and they were
 *    told at checkout.
 * 5. **The business cancels: the customer gets everything back.** The fee
 *    falls on the business (Stripe's default on a direct charge), and the
 *    platform returns its commission - no commission on a job that never
 *    happened.
 *
 * Pure decisions only. Stripe calls, Firestore writes and notifications live
 * with the callers; every rule here is testable without either.
 */

/**
 * The payment types that hold instead of charging.
 *
 * The dividing line is whether the service happens later. A freight
 * settlement is paid at drop-off and a hold-extension takes effect the moment
 * it is bought - holding those only delays the business's money for nothing.
 * Shared-barrel pools are retired. Everything a customer books ahead holds.
 *
 * Declared once, by paymentType - the same string every PaymentIntent carries
 * in its metadata - so creation, verification and the scheduler cannot
 * disagree about which flows hold.
 */
const HOLD_PAYMENT_TYPES = Object.freeze([
  "parking_deposit",
  "barrel_shipment",
  "barrel_order",
  "freight_shipment",
  "reservation_deposit",
  "full_purchase",
]);

/**
 * The capture method a new PaymentIntent should use.
 *
 * @param {string} paymentType The metadata.paymentType of the payment.
 * @return {string} "manual" for flows that hold, "" for immediate capture.
 */
function holdCaptureMethod(paymentType) {
  return HOLD_PAYMENT_TYPES.includes(String(paymentType || "").trim()) ?
    "manual" :
    "";
}

/**
 * PaymentIntent statuses that mean the money is secured.
 *
 * `requires_capture` is the whole feature: with a manual-capture intent the
 * customer has confirmed, the bank has reserved the funds, and capture cannot
 * fail the way a fresh off-session charge can. Any handler that only accepts
 * "succeeded" silently rejects every held payment.
 */
const SECURED_INTENT_STATUSES = Object.freeze([
  "succeeded",
  "requires_capture",
]);

/**
 * Whether a PaymentIntent's status means the money is secured.
 *
 * @param {string} status A PaymentIntent status.
 * @return {boolean} True for captured or held.
 */
function paymentIntentSecured(status) {
  return SECURED_INTENT_STATUSES.includes(String(status || "").trim());
}

/**
 * Whether a completed Checkout Session means the money is secured.
 *
 * With `capture_method: manual` a completed session reports
 * `payment_status: "unpaid"` - the money is reserved but not captured. That
 * word is Stripe's, and taking it at face value would void the entire hold
 * model, so "complete + unpaid + a real PaymentIntent" counts as secured and
 * the intent's own status is checked by the caller when it needs certainty.
 *
 * @param {object} session A Checkout Session.
 * @return {boolean} True when the session's money is captured or held.
 */
function checkoutSessionSecured(session) {
  const complete = String(session?.status || "").trim() === "complete";
  const paymentStatus = String(session?.payment_status || "").trim();
  const hasIntent = String(session?.payment_intent || "").startsWith("pi_");
  if (!complete || !hasIntent) return false;
  return paymentStatus === "paid" || paymentStatus === "unpaid";
}

/** How long before capture the customer is warned. */
const CAPTURE_NOTICE_MS = 24 * 60 * 60 * 1000;

/**
 * How long before the network deadline the capture fires. Stripe's own
 * automatic-delayed capture uses ~6 hours; enough margin for retries without
 * giving up a meaningful slice of the hold.
 */
const CAPTURE_SAFETY_MS = 6 * 60 * 60 * 1000;

/**
 * What to do with one held payment right now.
 *
 * The order of the checks is the safety property: a hold inside the capture
 * window is captured even if the notice was never sent, because a missed
 * warning is an apology while a missed capture is the entire payment.
 *
 * @param {object} params Inputs.
 * @param {number} params.captureBeforeMs Stripe's deadline for this charge.
 * @param {number} params.nowMs The current time.
 * @param {boolean} [params.noticeSent] Whether the customer was warned.
 * @return {{action: string}} One of "wait", "notify", "capture", "overdue".
 */
function holdAction({captureBeforeMs, nowMs, noticeSent}) {
  const deadline = Number(captureBeforeMs);
  const now = Number(nowMs);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) {
    // A hold with no deadline cannot be scheduled - surface it rather than
    // quietly waiting forever while the authorization dies.
    return {action: "overdue"};
  }
  if (now >= deadline) {
    // The network has already released the funds; capturing now will fail.
    // The caller escalates - this is a lost payment, not a scheduling state.
    return {action: "overdue"};
  }
  if (now >= deadline - CAPTURE_SAFETY_MS) return {action: "capture"};
  if (!noticeSent && now >= deadline - CAPTURE_NOTICE_MS) {
    return {action: "notify"};
  }
  return {action: "wait"};
}

/**
 * What a cancellation does to the money, depending on who cancelled and
 * whether the payment is still a hold.
 *
 * @param {object} params Inputs.
 * @param {string} params.cancelledBy "customer" or "business".
 * @param {boolean} params.captured Whether the payment has been captured.
 * @param {number} params.amountCents What was paid, in cents.
 * @param {number} [params.stripeFeeCents] The ACTUAL fee from the charge's
 *     balance transaction. Required once captured; the estimate is only for
 *     checkout copy.
 * @return {object} The instruction the caller executes.
 */
function cancellationOutcome({
  cancelledBy,
  captured,
  amountCents,
  stripeFeeCents,
}) {
  const amount = Math.max(0, Math.trunc(Number(amountCents) || 0));
  const actor = String(cancelledBy || "").trim();

  if (!captured) {
    // Nothing has settled, so there is nothing to refund and no fee to argue
    // about. This is the outcome the whole model exists to make common.
    return {kind: "release_hold", refundCents: 0, refundApplicationFee: false};
  }

  if (actor === "business") {
    // The customer pays nothing for someone else's failure: full refund, and
    // the platform returns its commission too. The processing fee lands on
    // the business by Stripe's own direct-charge default.
    return {
      kind: "refund_full",
      refundCents: amount,
      refundApplicationFee: true,
    };
  }

  const fee = Math.max(0, Math.trunc(Number(stripeFeeCents) || 0));
  // The fee can never eat the whole refund; a tiny amount nets to zero rather
  // than to a negative refund Stripe would reject.
  const refundCents = Math.max(0, amount - fee);
  // The application fee goes back too - to the BUSINESS, not the customer.
  // The ledger on a direct charge makes this the only fair answer: the
  // business's balance holds (amount - stripeFee - appFee), and the customer's
  // refund of (amount - stripeFee) is pulled from that balance. Without the
  // app-fee refund the business ends the cancellation out of pocket by our
  // commission, for a job that never happened - the same rule the owner set
  // for business-initiated cancellations. End state: customer pays only
  // Stripe's fee, business at zero, platform at zero.
  return {kind: "refund_minus_fee", refundCents, refundApplicationFee: true};
}

/**
 * The processing fee to *quote* in checkout copy, in cents.
 *
 * Standard US card pricing, 2.9% + 30¢. The real fee for a real refund comes
 * from the charge's balance transaction - this exists only so the disclosure
 * sentence can say "about $3.50" before any charge exists.
 *
 * @param {number} amountCents The order total in cents.
 * @return {number} The estimated fee in cents.
 */
function estimateProcessingFeeCents(amountCents) {
  const amount = Number(amountCents);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 0.029) + 30;
}

/**
 * The fields a new hold registry document carries.
 *
 * One document per held PaymentIntent, in `paymentHolds`. The scheduler works
 * from these documents alone, so everything it needs to capture - including
 * the connected account, without which a direct-charge capture 404s - is
 * denormalized here at verification time.
 *
 * @param {object} params Inputs.
 * @param {string} params.paymentIntentId The held intent.
 * @param {string} [params.connectedAccountId] Set for direct charges.
 * @param {number} params.amountCents What will be captured.
 * @param {number} params.captureBeforeMs Stripe's deadline for the charge.
 * @param {string} params.orderType The customer-checkout order type.
 * @param {string} params.collection Firestore collection of the order.
 * @param {string} params.recordId The order document id.
 * @param {string} params.customerUid Who to notify before capture.
 * @param {number} params.nowMs The current time.
 * @return {object} The document to write.
 */
function newHoldRecord({
  paymentIntentId,
  connectedAccountId,
  amountCents,
  captureBeforeMs,
  orderType,
  collection,
  recordId,
  customerUid,
  nowMs,
}) {
  return {
    paymentIntentId: String(paymentIntentId || ""),
    connectedAccountId: String(connectedAccountId || ""),
    amountCents: Math.max(0, Math.trunc(Number(amountCents) || 0)),
    captureBeforeMs: Number(captureBeforeMs) || 0,
    orderType: String(orderType || ""),
    collection: String(collection || ""),
    recordId: String(recordId || ""),
    customerUid: String(customerUid || ""),
    status: "held",
    noticeSent: false,
    createdAtMs: Number(nowMs) || 0,
    updatedAtMs: Number(nowMs) || 0,
  };
}

/**
 * Reads Stripe's capture deadline off a charge, in milliseconds.
 *
 * `capture_before` is stamped in epoch seconds on the charge's card details.
 * When it is absent (non-card payment methods), the conservative fallback is
 * five days from authorization - the shortest window any card network uses -
 * because capturing early is a non-event while capturing late is a lost
 * payment.
 *
 * @param {object} charge A Stripe charge.
 * @param {number} authorizedAtMs When the intent was confirmed.
 * @return {number} The deadline in epoch ms.
 */
function captureDeadlineMs(charge, authorizedAtMs) {
  const seconds = Number(
      charge?.payment_method_details?.card?.capture_before,
  );
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const authorized = Number(authorizedAtMs);
  const base = Number.isFinite(authorized) && authorized > 0 ?
    authorized :
    0;
  return base + 5 * 24 * 60 * 60 * 1000;
}

module.exports = {
  HOLD_PAYMENT_TYPES,
  holdCaptureMethod,
  SECURED_INTENT_STATUSES,
  CAPTURE_NOTICE_MS,
  CAPTURE_SAFETY_MS,
  paymentIntentSecured,
  checkoutSessionSecured,
  holdAction,
  cancellationOutcome,
  estimateProcessingFeeCents,
  newHoldRecord,
  captureDeadlineMs,
};

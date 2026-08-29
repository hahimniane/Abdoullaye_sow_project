/**
 * Paid-hold settlement rules for car purchases.
 *
 * A reservation deposit is not sold until Stripe has actually secured the
 * money and the purchase is reserved. The live bug: the business console
 * offered Mark sold / Completed on a pending unpaid hold, and
 * businessFinalizeCarPurchase wrote purchaseStatus=completed while
 * paymentStatus was still pending — a $0 sale.
 */

const SETTLED_PAYMENTS = Object.freeze([
  "succeeded",
  "paid",
  "reserved",
]);

const RESERVED_HOLD_STATUSES = Object.freeze([
  "reserved",
  "hold_review_required",
]);

const TERMINAL_PURCHASE_STATUSES = Object.freeze([
  "completed",
  "no_show",
  "cancelled",
  "refunded",
  "forfeited",
]);

function isPaidHold(purchase) {
  return String(purchase?.paymentType || "").trim() === "reservation_deposit";
}

function purchaseIsViewing(purchase) {
  if (String(purchase?.paymentType || "").trim() === "viewing_reservation") {
    return true;
  }
  return Boolean(purchase?.appointmentStart) &&
    Number(purchase?.depositAmount || 0) === 0;
}

function isTerminalPurchaseStatus(status) {
  return TERMINAL_PURCHASE_STATUSES.includes(String(status || "").trim());
}

function carPurchasePaymentSucceeded(purchase) {
  return SETTLED_PAYMENTS.includes(
      String(purchase?.paymentStatus || "").trim().toLowerCase(),
  );
}

function paidHoldIsReserved(purchase) {
  return RESERVED_HOLD_STATUSES.includes(
      String(purchase?.purchaseStatus || "").trim().toLowerCase(),
  );
}

/**
 * A hold the business may mark sold / no-show / extend.
 *
 * Payment must have succeeded and the purchase must already be reserved.
 * A pending unpaid hold is not actionable — that is how a $0 sale happened.
 *
 * @param {object} purchase A carPurchases document.
 * @return {boolean}
 */
function paidHoldCanBeFinalized(purchase) {
  return isPaidHold(purchase) &&
    carPurchasePaymentSucceeded(purchase) &&
    paidHoldIsReserved(purchase);
}

/**
 * Why a paid-hold action is refused, or "" when it is allowed.
 *
 * @param {object} purchase A carPurchases document.
 * @return {string}
 */
function paidHoldActionRefusal(purchase) {
  if (!isPaidHold(purchase)) return "not_a_paid_hold";
  if (isTerminalPurchaseStatus(purchase?.purchaseStatus)) {
    return "already_finalized";
  }
  if (!carPurchasePaymentSucceeded(purchase) || !paidHoldIsReserved(purchase)) {
    return "not_settled";
  }
  return "";
}

/**
 * Whether the business console may mark this record Completed / sold.
 *
 * Viewings have their own negotiation complete path. Paid holds must be
 * settled. Other purchases still require a succeeded payment when money
 * was supposed to move.
 *
 * @param {object} purchase A carPurchases document.
 * @return {boolean}
 */
function carPurchaseCanMarkCompleted(purchase) {
  const record = purchase && typeof purchase === "object" ? purchase : {};
  if (purchaseIsViewing(record)) return false;
  if (isPaidHold(record)) return paidHoldCanBeFinalized(record);
  if (isTerminalPurchaseStatus(record.purchaseStatus)) return false;
  if (String(record.paymentStatus || "").trim().toLowerCase() ===
      "not_required") {
    return true;
  }
  return carPurchasePaymentSucceeded(record);
}

module.exports = {
  SETTLED_PAYMENTS,
  RESERVED_HOLD_STATUSES,
  TERMINAL_PURCHASE_STATUSES,
  carPurchaseCanMarkCompleted,
  carPurchasePaymentSucceeded,
  isPaidHold,
  isTerminalPurchaseStatus,
  paidHoldActionRefusal,
  paidHoldCanBeFinalized,
  paidHoldIsReserved,
  purchaseIsViewing,
};

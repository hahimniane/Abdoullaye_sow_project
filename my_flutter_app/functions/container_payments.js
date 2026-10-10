"use strict";

/**
 * What a customer owes for one package in a container, and what has been paid
 * against it so far.
 *
 * A package carries a price in US dollars (whole cents, never converted) and
 * collects money in pieces: all of it at the counter, some now and the rest
 * later, or nothing now because it will be paid on arrival, when the Guinea
 * team records it. Every payment is its own row so the history says who took
 * what and when, and a mistaken one is struck through (reverted), never
 * erased. `paidCents` on the package is always the sum of the payments that
 * were not reverted, and never more than the price.
 *
 * Pure: no Firestore, no clock. The callables in `index.js` run these inside
 * a transaction; `invoice_ledger.js` is the model (integer cents, MAX_CENTS,
 * the same payment methods), and the console and the app mirror the status
 * words.
 */

const {INVOICE_PAYMENT_METHODS, MAX_CENTS} = require("./invoice_ledger");

// The same vocabulary as invoice and ledger payments, so "received via" reads
// the same everywhere.
const CONTAINER_PAYMENT_METHODS = INVOICE_PAYMENT_METHODS;

const PAYMENT_STATUS = Object.freeze({
  NO_PRICE: "no_price",
  UNPAID: "unpaid",
  PARTIAL: "partial",
  PAID: "paid",
  PAY_ON_ARRIVAL: "pay_on_arrival",
});

const MAX_NOTE = 200;

const text = (value, max = MAX_NOTE) =>
  String(value ?? "").trim().slice(0, max);

/**
 * Whether a price was typed at all. An empty field means "no price yet",
 * which is a state of its own, not a price of zero.
 *
 * @param {*} value Raw price input.
 * @return {boolean} True when there is something to judge.
 */
function priceGiven(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

/**
 * @param {*} value Raw price in cents.
 * @return {number|null} Whole cents, or null for "no price" and for
 *   anything that is not a price (the validator names that case).
 */
function priceCentsOf(value) {
  if (!priceGiven(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= MAX_CENTS ? n : null;
}

/**
 * @param {*} value A stored paid amount.
 * @return {number} Whole non-negative cents.
 */
function paidCentsOf(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_CENTS) : 0;
}

/**
 * Error codes for a price a person typed: a whole number of cents above zero
 * and within what a package can plausibly cost - and never below what has
 * already been paid, because that would leave a negative balance.
 *
 * @param {*} priceCents Raw price, null or "" for none.
 * @param {*} paidCents What has been paid so far.
 * @return {string[]} Error codes.
 */
function priceErrors(priceCents, paidCents = 0) {
  if (!priceGiven(priceCents)) {
    // Taking the price away is only possible while nothing has been paid.
    return paidCentsOf(paidCents) > 0 ? ["price_below_paid"] : [];
  }
  const price = priceCentsOf(priceCents);
  if (price === null) return ["price_invalid"];
  if (price < paidCentsOf(paidCents)) return ["price_below_paid"];
  return [];
}

/**
 * @param {object} input Validated callable data.
 * @return {object} The price half of a line as stored: {priceCents (whole
 *   cents or null), payOnArrival}.
 */
function linePriceRecord(input) {
  const row = input && typeof input === "object" ? input : {};
  return {
    priceCents: priceCentsOf(row.priceCents),
    payOnArrival: row.payOnArrival === true || row.payOnArrival === "true",
  };
}

/**
 * @param {object} input Raw callable data {amountCents, method, note}.
 * @param {object} line The stored line, read inside the transaction.
 * @return {string[]} Error codes.
 */
function validateLinePayment(input, line) {
  const errors = [];
  const row = line && typeof line === "object" ? line : {};
  const price = priceCentsOf(row.priceCents);
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) errors.push("amount_required");
  else if (amount > MAX_CENTS) errors.push("amount_too_large");
  else if (price === null) errors.push("price_required");
  // More than is owed is a typo nine times in ten; the tenth time the price
  // is raised first, then the money recorded.
  else if (amount > price - paidCentsOf(row.paidCents)) {
    errors.push("payment_exceeds_balance");
  }
  if (!CONTAINER_PAYMENT_METHODS.includes(text(input?.method, 40))) {
    errors.push("payment_method_invalid");
  }
  return errors;
}

/**
 * @param {object} input Validated callable data.
 * @return {object} The payment body (the caller adds who and when).
 */
function linePaymentRecord(input) {
  return {
    amountCents: Math.round(Number(input.amountCents)),
    method: text(input.method, 40),
    note: text(input.note),
    reverted: false,
  };
}

/**
 * @param {object[]} payments A line's payments, reverted ones included.
 * @return {number} The sum of those that still count.
 */
function sumLivePayments(payments) {
  return (Array.isArray(payments) ? payments : [])
      .filter((p) => p && p.reverted !== true)
      .reduce((sum, p) => sum + paidCentsOf(p.amountCents), 0);
}

/**
 * @param {object} payment The stored payment, or null when gone.
 * @return {string|null} Why it cannot be reverted, or null.
 */
function paymentRevertRefusal(payment) {
  if (!payment || typeof payment !== "object") return "payment_not_found";
  if (payment.reverted === true) return "payment_already_reverted";
  return null;
}

/**
 * Where a package stands, as the chips say it. A price that was never set is
 * not "unpaid": there is nothing to pay yet. Pay on arrival is a promise
 * about the rest, so it reads as such until money lands, then as partial or
 * paid like any other.
 *
 * @param {object} line The stored line.
 * @return {object} The standing: {status, priceCents (null when unpriced),
 *   paidCents, balanceCents}.
 */
function linePaymentStanding(line) {
  const row = line && typeof line === "object" ? line : {};
  const price = priceCentsOf(row.priceCents);
  const paid = paidCentsOf(row.paidCents);
  const payOnArrival = row.payOnArrival === true;
  let status = PAYMENT_STATUS.UNPAID;
  if (price === null) {
    status = payOnArrival ? PAYMENT_STATUS.PAY_ON_ARRIVAL :
      PAYMENT_STATUS.NO_PRICE;
  } else if (paid >= price) {
    status = PAYMENT_STATUS.PAID;
  } else if (paid > 0) {
    status = PAYMENT_STATUS.PARTIAL;
  } else if (payOnArrival) {
    status = PAYMENT_STATUS.PAY_ON_ARRIVAL;
  }
  return {
    status,
    priceCents: price,
    paidCents: paid,
    balanceCents: price === null ? 0 : Math.max(0, price - paid),
  };
}

module.exports = {
  CONTAINER_PAYMENT_METHODS,
  PAYMENT_STATUS,
  MAX_CENTS,
  priceCentsOf,
  paidCentsOf,
  priceErrors,
  linePriceRecord,
  validateLinePayment,
  linePaymentRecord,
  sumLivePayments,
  paymentRevertRefusal,
  linePaymentStanding,
};

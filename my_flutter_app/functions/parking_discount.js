"use strict";

// A negotiated discount on a parked car's bill (docs/PARKING_DISCOUNT.md).
// Owner, 11/11/2026: a car ran up $2,000 and the lot agreed to take $1,500.
// The discount is its own line: the price is never rewritten, and it is never
// money in (staff cash, "collected", payouts). It lives on the car:
//   parkingDiscounts: [{id, amountCents, reason, mode, paymentCents,
//     givenByUid, at, atMs, undone?, undoneByUid?, undoneAtMs?}]
//   parkingDiscountCents: the sum of the live (not undone) ones.
// Every balance reader takes `discountCentsOf(car)` off what is owed.

const {
  dayNumber,
  discountCentsOf,
  paidCents,
  parkingBalanceNow,
} = require("./parking_month_statement");

const DISCOUNT_MESSAGES = Object.freeze({
  discount_not_direct:
    "A discount can only be given on a car the business records payments " +
    "for (cash, Zelle...). Online and payment-link cars are paid in Stripe.",
  discount_reason_required: "Say why the discount was agreed.",
  discount_no_amount: "Enter the discount amount.",
  discount_nothing_owed: "This car owes nothing right now.",
  discount_more_than_owed:
    "That is more than this car owes. Enter at most what is owed.",
  discount_paid_not_less:
    "The amount paid must be less than what is owed. For the full amount, " +
    "record a normal payment.",
  discount_receiver_required: "Say who took the money.",
  discount_owed_changed:
    "What this car owes has changed. Check the amount and try again.",
  discount_not_found: "That discount was not found.",
  discount_already_undone: "That discount was already undone.",
  discount_voided: "This car record was voided.",
});

const MAX_REASON = 300;
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * Whether the business records this car's payments by hand (the cars a
 * bill payment can pay): direct, and entered by the business.
 *
 * @param {object} car A parkedCars document.
 * @return {boolean} Whether a discount may be given.
 */
function discountableCar(car) {
  const r = car && typeof car === "object" ? car : {};
  return text(r.paymentMethod, 40) === "direct" &&
    (text(r.source, 40) === "business" || r.enteredByBusiness === true);
}

/**
 * The stored total of a stay with a leave date, in cents (0 for open
 * stays and older records without one).
 *
 * @param {object} car A parkedCars document.
 * @return {number} Cents.
 */
function fixedTotalCents(car) {
  const cents = Number(car?.amountDueCents ?? car?.totalCostCents);
  if (Number.isFinite(cents) && cents > 0) return Math.round(cents);
  const dollars = Number(car?.amountDue ?? car?.totalCost);
  return Number.isFinite(dollars) && dollars > 0 ?
    Math.round(dollars * 100) : 0;
}

/**
 * What the car owes now, before any new discount: an open stay through
 * today; a stay with a leave date its whole total (a booking paid ahead can
 * be discounted on its full price), or the days so far when that is more.
 *
 * @param {object} car A parkedCars document.
 * @param {Date} now The moment.
 * @return {number} Cents, never negative.
 */
function owedNowCents(car, now) {
  const balance = parkingBalanceNow(car, now);
  if (!balance) return 0;
  if (balance.leftDayKey === null) return balance.balanceCents;
  const today = dayNumber(now);
  const total = fixedTotalCents(car);
  const whole = Math.max(0,
      total - paidCents(car, today) - discountCentsOf(car));
  return Math.max(whole, balance.balanceCents);
}

/**
 * Whether, with `extraDiscount` more and `extraPaid` more cash, a stay with
 * a leave date is covered in full (the "paid" shape). Open stays never are:
 * they keep running up from tomorrow (decision 5).
 *
 * @param {object} car A parkedCars document.
 * @param {number} extraPaid Cents paid now.
 * @param {number} extraDiscount Cents of new discount.
 * @param {Date} now The moment.
 * @return {boolean} Whether the stay is settled.
 */
function settlesStay(car, extraPaid, extraDiscount, now) {
  if (!car?.parkingEndDate) return false;
  const total = fixedTotalCents(car);
  if (total <= 0) return false;
  const today = dayNumber(now);
  return paidCents(car, today) + extraPaid +
    discountCentsOf(car) + extraDiscount >= total;
}

function refusal(reason) {
  return {ok: false, reason, message: DISCOUNT_MESSAGES[reason] || reason};
}

function cleanCents(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Give a discount alone: the balance left stays to pay later.
 *
 * @param {{car: object, amountCents: *, reason: *, now: Date}} input
 * @return {object} {ok, reason?, message?, owedCents, discountCents,
 *   paidCents, leftCents, settles}
 */
function discountGivePlan({car, amountCents, reason, now = new Date()}) {
  const r = car && typeof car === "object" ? car : {};
  if (r.voided === true) return refusal("discount_voided");
  if (!discountableCar(r)) return refusal("discount_not_direct");
  const amount = cleanCents(amountCents);
  if (!(amount > 0)) return refusal("discount_no_amount");
  const owed = owedNowCents(r, now);
  if (owed <= 0) return refusal("discount_nothing_owed");
  if (amount > owed) return refusal("discount_more_than_owed");
  if (!text(reason, MAX_REASON)) return refusal("discount_reason_required");
  return {
    ok: true,
    owedCents: owed,
    discountCents: amount,
    paidCents: 0,
    leftCents: owed - amount,
    settles: settlesStay(r, 0, amount, now),
  };
}

/**
 * Settle for a lower amount: the customer pays `paidCents` now and the
 * rest of what is owed today is the discount.
 *
 * @param {{car: object, paidCents: *, reason: *, receivedByStaffId: *,
 *   expectedOwedCents: *, now: Date}} input
 * @return {object} {ok, reason?, message?, owedCents, discountCents,
 *   paidCents, leftCents, settles}
 */
function discountSettlePlan({car, paidCents: paidNow, reason,
  receivedByStaffId, expectedOwedCents, now = new Date()}) {
  const r = car && typeof car === "object" ? car : {};
  if (r.voided === true) return refusal("discount_voided");
  if (!discountableCar(r)) return refusal("discount_not_direct");
  const paid = cleanCents(paidNow);
  if (!(paid >= 0)) return refusal("discount_no_amount");
  const owed = owedNowCents(r, now);
  if (owed <= 0) return refusal("discount_nothing_owed");
  const expected = Number(expectedOwedCents);
  if (expectedOwedCents !== undefined && expectedOwedCents !== null &&
      Number.isFinite(expected) && Math.round(expected) !== owed) {
    return {...refusal("discount_owed_changed"), owedCents: owed};
  }
  if (paid >= owed) return refusal("discount_paid_not_less");
  if (!text(reason, MAX_REASON)) return refusal("discount_reason_required");
  if (paid > 0 && !text(receivedByStaffId, 180)) {
    return refusal("discount_receiver_required");
  }
  const discount = owed - paid;
  return {
    ok: true,
    owedCents: owed,
    discountCents: discount,
    paidCents: paid,
    leftCents: 0,
    settles: settlesStay(r, paid, discount, now),
  };
}

/**
 * The car's live discounts, oldest first.
 *
 * @param {object} car A parkedCars document.
 * @return {object[]} Entries not undone.
 */
function liveDiscounts(car) {
  const list = Array.isArray(car?.parkingDiscounts) ?
    car.parkingDiscounts : [];
  return list.filter((d) => d && typeof d === "object" && d.undone !== true);
}

/**
 * The sum a discount list adds up to.
 *
 * @param {object[]} list Discount entries.
 * @return {number} Cents.
 */
function discountListCents(list) {
  return (Array.isArray(list) ? list : []).reduce((sum, d) => {
    if (!d || typeof d !== "object" || d.undone === true) return sum;
    const cents = Math.round(Number(d.amountCents));
    return sum + (Number.isFinite(cents) && cents > 0 ? cents : 0);
  }, 0);
}

/**
 * Undo one discount: it stays on the car marked undone (who, when), and
 * comes off the total. A stay it had settled goes back to owing.
 *
 * @param {{car: object, discountId: *, uid: string, nowMs: number}} input
 * @return {object} {ok, reason?, message?, amountCents, discounts,
 *   discountCents, reopens}
 */
function discountUndoPlan({car, discountId, uid, nowMs}) {
  const r = car && typeof car === "object" ? car : {};
  const id = text(discountId, 80);
  const list = Array.isArray(r.parkingDiscounts) ? r.parkingDiscounts : [];
  const index = list.findIndex((d) => d && d.id === id);
  if (!id || index < 0) return refusal("discount_not_found");
  const entry = list[index];
  if (entry.undone === true) return refusal("discount_already_undone");
  const discounts = list.slice();
  discounts[index] = {...entry, undone: true, undoneByUid: uid,
    undoneAtMs: nowMs};
  const amount = Math.max(0, Math.round(Number(entry.amountCents) || 0));
  const status = text(r.paymentStatus, 40);
  // A stay in the paid shape that money and the discounts left no longer
  // cover goes back to owing.
  const cash = Math.max(0, Math.round(Number(r.amountPaidCents) || 0));
  const total = fixedTotalCents(r);
  const reopens = status === "paid" && Boolean(r.parkingEndDate) &&
    total > 0 && cash + discountListCents(discounts) < total;
  return {
    ok: true,
    amountCents: amount,
    discounts,
    discountCents: discountListCents(discounts),
    reopens,
  };
}

module.exports = {
  DISCOUNT_MESSAGES,
  MAX_REASON,
  discountGivePlan,
  discountListCents,
  discountSettlePlan,
  discountUndoPlan,
  discountableCar,
  liveDiscounts,
  owedNowCents,
};

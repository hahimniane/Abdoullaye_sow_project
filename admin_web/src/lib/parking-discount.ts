/**
 * A negotiated discount on a parked car (docs/PARKING_DISCOUNT.md). Mirrors
 * the server's `parking_discount.js`, so the console's preview says exactly
 * what the server will record. The discount is never money in: it lives in
 * `parkingDiscounts` / `parkingDiscountCents`, not in the payments.
 *
 * Pure: no React, no clock of its own (the caller passes `now`).
 */

import { parkingBalanceNow } from "./parking-balance.ts";
import { dayNumber, discountCentsOf, paidCents } from "./parking-month-statement.ts";

type Row = Record<string, unknown>;

export const DISCOUNT_MESSAGES: Record<string, string> = {
  discount_not_direct:
    "A discount can only be given on a car the business records payments for (cash, Zelle...). Online and payment-link cars are paid in Stripe.",
  discount_reason_required: "Say why the discount was agreed.",
  discount_no_amount: "Enter the discount amount.",
  discount_nothing_owed: "This car owes nothing right now.",
  discount_more_than_owed: "That is more than this car owes. Enter at most what is owed.",
  discount_paid_not_less:
    "The amount paid must be less than what is owed. For the full amount, record a normal payment.",
  discount_receiver_required: "Say who took the money.",
  discount_owed_changed: "What this car owes has changed. Check the amount and try again.",
  discount_not_found: "That discount was not found.",
  discount_already_undone: "That discount was already undone.",
  discount_voided: "This car record was voided.",
};

const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);

export type ParkingDiscount = {
  id: string;
  amountCents: number;
  reason: string;
  mode: "discount" | "settle";
  paymentCents: number;
  givenByUid: string;
  atMs: number;
  undone: boolean;
  undoneByUid: string;
  undoneAtMs: number;
};

/** Whether the business records this car's payments by hand. */
export function discountableCar(car: Row): boolean {
  return text(car?.paymentMethod, 40) === "direct" &&
    (text(car?.source, 40) === "business" || car?.enteredByBusiness === true);
}

function fixedTotalCents(car: Row): number {
  const cents = Number(car?.amountDueCents ?? car?.totalCostCents);
  if (Number.isFinite(cents) && cents > 0) return Math.round(cents);
  const dollars = Number(car?.amountDue ?? car?.totalCost);
  return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
}

/** What the car owes now, before any new discount (the server's rule). */
export function owedNowCents(car: Row, now: Date = new Date()): number {
  const balance = parkingBalanceNow(car, now);
  if (!balance) return 0;
  if (balance.leftDayKey === null) return balance.balanceCents;
  const today = dayNumber(now) ?? 0;
  const whole = Math.max(0, fixedTotalCents(car) - paidCents(car, today) - discountCentsOf(car));
  return Math.max(whole, balance.balanceCents);
}

export type DiscountPreview =
  | { ok: true; owedCents: number; discountCents: number; paidCents: number; leftCents: number; settles: boolean }
  | { ok: false; reason: string; message: string };

function refusal(reason: string): DiscountPreview {
  return { ok: false, reason, message: DISCOUNT_MESSAGES[reason] || reason };
}

/** Whether a stay with a leave date is covered in full after this (open stays never are). */
function settlesStay(car: Row, extraPaid: number, extraDiscount: number, now: Date): boolean {
  if (!car?.parkingEndDate) return false;
  const total = fixedTotalCents(car);
  if (total <= 0) return false;
  const today = dayNumber(now) ?? 0;
  return paidCents(car, today) + extraPaid + discountCentsOf(car) + extraDiscount >= total;
}

/**
 * The preview for either form, in the server's order of checks
 * (parking_discount.js). "discount": the amount is the discount, the rest
 * stays owed. "settle": the amount is paid now, the rest owed today is the
 * discount; money taken needs who took it.
 */
export function discountPreview(
  car: Row,
  mode: "discount" | "settle",
  amountCents: number,
  reason: string,
  receivedByStaffId = "",
  now: Date = new Date(),
): DiscountPreview {
  if (car?.voided === true) return refusal("discount_voided");
  if (!discountableCar(car)) return refusal("discount_not_direct");
  const amount = Math.round(Number(amountCents));
  if (mode === "discount") {
    if (!(amount > 0)) return refusal("discount_no_amount");
  } else if (!(amount >= 0)) {
    return refusal("discount_no_amount");
  }
  const owed = owedNowCents(car, now);
  if (owed <= 0) return refusal("discount_nothing_owed");
  if (mode === "discount") {
    if (amount > owed) return refusal("discount_more_than_owed");
    if (!text(reason, 300)) return refusal("discount_reason_required");
    return { ok: true, owedCents: owed, discountCents: amount, paidCents: 0, leftCents: owed - amount,
      settles: settlesStay(car, 0, amount, now) };
  }
  if (amount >= owed) return refusal("discount_paid_not_less");
  if (!text(reason, 300)) return refusal("discount_reason_required");
  if (amount > 0 && !text(receivedByStaffId, 180)) return refusal("discount_receiver_required");
  return { ok: true, owedCents: owed, discountCents: owed - amount, paidCents: amount, leftCents: 0,
    settles: settlesStay(car, amount, owed - amount, now) };
}

/** The car's discounts, newest first, undone ones included. */
export function parkingDiscountsOf(car: Row): ParkingDiscount[] {
  const list = Array.isArray(car?.parkingDiscounts) ? (car.parkingDiscounts as unknown[]) : [];
  return list
    .filter((d): d is Row => Boolean(d) && typeof d === "object")
    .map((d) => ({
      id: text(d.id, 80),
      amountCents: Math.max(0, Math.round(Number(d.amountCents) || 0)),
      reason: text(d.reason, 300),
      mode: d.mode === "settle" ? ("settle" as const) : ("discount" as const),
      paymentCents: Math.max(0, Math.round(Number(d.paymentCents) || 0)),
      givenByUid: text(d.givenByUid, 128),
      atMs: Math.max(0, Number(d.atMs) || 0),
      undone: d.undone === true,
      undoneByUid: text(d.undoneByUid, 128),
      undoneAtMs: Math.max(0, Number(d.undoneAtMs) || 0),
    }))
    .filter((d) => d.id && d.amountCents > 0)
    .sort((a, b) => b.atMs - a.atMs);
}

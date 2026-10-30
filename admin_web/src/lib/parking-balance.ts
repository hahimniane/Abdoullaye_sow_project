/**
 * What a parked car owes right now (docs/PARKING_WHATSAPP.md §2, "Money on
 * the car"). Mirrors the server's `parkingBalanceNow(car, now)`; the shared
 * fixture `my_flutter_app/functions/test/fixtures/parking-balance-cases.json`
 * is run by the server, this console and the app, so the three agree to the
 * cent.
 *
 * Balance = what the stay has run up to today (an open stay: days x the
 * daily rate; a closed one: its total, the same accrual as the month-end
 * statement) minus the payments that stand (a reverted payment leaves the
 * running total, so it never counts). Never negative.
 *
 * Pure: no React, no clock of its own (the caller passes `now`).
 */

import { accruedThroughCents, dayNumber } from "./parking-month-statement.ts";

export type ParkingBalance = {
  dailyRateCents: number;
  /** The day the car was parked, "YYYY-MM-DD". */
  sinceDayKey: string;
  /** The day it leaves or left, "YYYY-MM-DD"; null while open-ended. */
  leftDayKey: string | null;
  /** Days counted so far (the first day and the last both count). */
  days: number;
  accruedCents: number;
  paidCents: number;
  balanceCents: number;
  paidInFull: boolean;
  /** No leave day yet, or the leave day is today or later. */
  stillParked: boolean;
};

type Row = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKeyOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const text = (value: unknown, max = 40) => String(value ?? "").trim().slice(0, max);

/** One recorded payment in cents (`amountCents`, else dollars in `amount`). */
function paymentCents(payment: Row): number {
  const cents = Math.round(Number(payment?.amountCents));
  if (Number.isFinite(cents) && cents > 0) return cents;
  const dollars = Number(payment?.amount);
  return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
}

/** The record's running total, or the stay so far when it is marked paid. */
function recordedPaidCents(row: Row, today: number): number {
  const recorded = Math.round(Number(row?.amountPaidCents) || 0);
  if (recorded > 0) return recorded;
  const status = text(row?.paymentStatus);
  if (status === "succeeded" || status === "paid") return accruedThroughCents(row, today, today);
  return 0;
}

/**
 * What is paid now: the live instalments, or the record's total when it is
 * larger. Once any instalment is reverted, only the live list counts.
 */
function paidNowCents(row: Row, today: number): number {
  const list = Array.isArray(row?.parkingPayments)
    ? (row.parkingPayments as unknown[]).filter((p): p is Row => Boolean(p) && typeof p === "object")
    : [];
  const live = list.filter((p) => p.reverted !== true);
  const liveCents = live.reduce((sum, p) => sum + paymentCents(p), 0);
  if (live.length < list.length) return liveCents;
  return Math.max(liveCents, recordedPaidCents(row, today));
}

/**
 * The money on a parked car today. Mirrors the server's `parkingBalanceNow`
 * (parking_month_statement.js) line for line; the shared fixture
 * `my_flutter_app/functions/test/fixtures/parking-balance-cases.json` pins
 * server, console and app. Null for a voided or cancelled car, or one with
 * no arrival day.
 */
export function parkingBalanceNow(car: Row, now: Date = new Date()): ParkingBalance | null {
  const r = car && typeof car === "object" ? car : {};
  if (r.voided === true || text(r.status) === "cancelled") return null;
  const start = dayNumber(r.parkingDate);
  const today = dayNumber(now);
  if (start === null || today === null) return null;
  const leave = dayNumber(r.parkingEndDate);
  const through = leave === null ? today : Math.min(today, leave);
  const accruedCents = accruedThroughCents(r, today, today);
  const paid = paidNowCents(r, today);
  const dailyDollars = Number(r.dailyRate);
  const dailyRateCents = Number.isFinite(dailyDollars) && dailyDollars > 0
    ? Math.round(dailyDollars * 100)
    : Math.max(0, Math.round(Number(r.dailyRateCents) || 0));
  return {
    dailyRateCents,
    sinceDayKey: dayKeyOf(start),
    leftDayKey: leave === null ? null : dayKeyOf(leave),
    days: Math.max(0, through - start + 1),
    accruedCents,
    paidCents: paid,
    balanceCents: Math.max(0, accruedCents - paid),
    paidInFull: accruedCents > 0 && paid >= accruedCents,
    stillParked: leave === null || leave >= today,
  };
}

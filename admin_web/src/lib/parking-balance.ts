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
  /** The day it left, "YYYY-MM-DD"; "" while it is still parked. */
  leftDayKey: string;
  /** Days counted so far (the first day and the last both count). */
  days: number;
  accruedCents: number;
  paidCents: number;
  balanceCents: number;
  paidInFull: boolean;
  stillParked: boolean;
};

type Row = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKeyOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const wholeCents = (value: unknown) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function parkingBalanceNow(car: Row, now: Date = new Date()): ParkingBalance {
  const today = dayNumber(now) ?? 0;
  const start = dayNumber(car.parkingDate);
  const leave = dayNumber(car.parkingEndDate);
  const dailyRateCents = wholeCents(car.dailyRateCents) || wholeCents(Number(car.dailyRate) * 100);
  const stillParked = leave === null;
  const end = leave === null ? today : leave;
  const days = start === null || end < start ? 0 : end - start + 1;
  const accruedCents = start === null ? 0 : accruedThroughCents(car, today, today);
  let paidCents = wholeCents(car.amountPaidCents);
  if (paidCents === 0) {
    const status = String(car.paymentStatus ?? "").trim();
    if (status === "succeeded" || status === "paid") paidCents = accruedCents;
  }
  const balanceCents = Math.max(0, accruedCents - paidCents);
  return {
    dailyRateCents,
    sinceDayKey: start === null ? "" : dayKeyOf(start),
    leftDayKey: leave === null ? "" : dayKeyOf(leave),
    days,
    accruedCents,
    paidCents,
    balanceCents,
    paidInFull: accruedCents > 0 && balanceCents === 0,
    stillParked,
  };
}

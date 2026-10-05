// What the console-totals callables answer (my_flutter_app/functions/
// console_totals.js), as types, plus the small pure helpers the panels use
// to decide when to ask again. No Firebase here, so it is unit-tested.

import type { LotLedgerTotals } from "./lot-ledger.ts";
import type { ParkingOverdue, ParkingTotals } from "./business-parking-entry.ts";

/** getParkingTotals().parking, and getLotLedgerTotals().parking. */
export type ServerParkingSummary = {
  totals: ParkingTotals;
  overdue: ParkingOverdue;
  /** Cents collected per month of `months`, by the month the money arrived. */
  collectedByMonth: number[];
  records: number;
  months: string[];
  year: number;
  complete: boolean;
};

/** getLotLedgerTotals() */
export type ServerLedgerTotals = {
  ledger: LotLedgerTotals;
  parking: ServerParkingSummary;
  request: { rangeStart: string; rangeEnd: string; month: string; year: number; nowMonth: string };
  complete: boolean;
  computedAtMs: number;
};

function stamp(value: unknown): string {
  if (!value) return "";
  if (typeof value === "object") {
    const v = value as { toMillis?: () => number; seconds?: number };
    if (typeof v.toMillis === "function") return String(v.toMillis());
    if (typeof v.seconds === "number") return String(v.seconds);
  }
  return String(value);
}

/**
 * A key that changes whenever a row's money or state could have moved, so a
 * server total is asked for again after a payment, an edit or a new record -
 * and not on a render that changed nothing.
 */
export function totalsReloadKey(
  rows: readonly Record<string, unknown>[],
  fields: readonly string[] = [
    "status",
    "paymentStatus",
    "amountPaidCents",
    "amountPaid",
    "feeCents",
    "balanceCents",
    "paidCents",
    "voided",
    "updatedAt",
  ],
): string {
  return rows
    .map((row) => [String(row.id ?? ""), ...fields.map((field) => stamp(row[field]))].join(":"))
    .sort()
    .join("|");
}

/** The parking scoreboard asks again when a running stay changes. */
export function parkingTotalsReloadKey(rows: readonly Record<string, unknown>[]): string {
  return totalsReloadKey(rows, [
    "status",
    "paymentStatus",
    "amountPaidCents",
    "amountPaid",
    "parkingEndDate",
    "updatedAt",
  ]);
}

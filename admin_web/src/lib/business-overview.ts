// What the business Today tab totals: headline counts, the analytics
// breakdowns and earnings by service.
//
// This used to be computed inline in business-console.tsx from listeners
// capped at 500 rows with no order - a random subset once a business had more
// than that - so every figure on the page drifted the day a collection
// passed 500 documents. The server now runs this exact function over every
// record (`businessOverviewSummary` in
// my_flutter_app/functions/console_summaries.js, held to this file by
// console-summaries-parity.test.ts) and the console renders its answer.

import { summarizeBusinessEarnings, type BusinessEarningsSummary } from "./business-earnings.ts";
import type { FirestoreRow } from "@/types/admin";

export type StatusCount = [status: string, count: number];

export type BusinessOverview = {
  metrics: {
    activeListings: number;
    openShipments: number;
    pendingPurchases: number;
    openSupport: number;
    transports: number;
    parkedCars: number;
  };
  listingBreakdown: StatusCount[];
  operationBreakdown: StatusCount[];
  purchaseBreakdown: StatusCount[];
  activeInventoryValue: number;
  paidHoldValue: number;
  earnings: BusinessEarningsSummary;
};

export type BusinessOverviewInput = {
  cars?: FirestoreRow[];
  purchases?: FirestoreRow[];
  shipments?: FirestoreRow[];
  freightShipments?: FirestoreRow[];
  transports?: FirestoreRow[];
  parkedCars?: FirestoreRow[];
  support?: FirestoreRow[];
};

/** Statuses that end a record; anything else (and not blank) is open. */
export const CLOSED_STATUSES = [
  "",
  "completed",
  "cancelled",
  "sold",
  "inactive",
  "refunded",
  "rejected",
  "resolved",
  "closed",
] as const;

const CLOSED_STATUS_SET = new Set<string>(CLOSED_STATUSES);

function trimmedText(value: unknown) {
  return String(value ?? "").trim();
}

function numericValue(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function isOpenStatus(value: unknown) {
  return !CLOSED_STATUS_SET.has(trimmedText(value).toLowerCase());
}

export function purchaseStatus(row: FirestoreRow) {
  return trimmedText(row.purchaseStatus ?? row.status) || "pending";
}

export function topStatuses(rows: FirestoreRow[], field: string): StatusCount[] {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const value = (trimmedText(row[field]) || "unknown").toLowerCase();
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

export function businessOverviewSummary(input: BusinessOverviewInput = {}): BusinessOverview {
  const list = (rows: FirestoreRow[] | undefined) => (Array.isArray(rows) ? rows : []);
  const cars = list(input.cars);
  const purchases = list(input.purchases);
  const shipments = list(input.shipments);
  const freightShipments = list(input.freightShipments);
  const transports = list(input.transports);
  const parkedCars = list(input.parkedCars);
  const support = list(input.support);
  const activeCars = cars.filter((row) => trimmedText(row.status) === "active");
  return {
    metrics: {
      activeListings: activeCars.length,
      openShipments: [...shipments, ...freightShipments].filter((row) => isOpenStatus(row.status)).length,
      pendingPurchases: purchases.filter((row) => isOpenStatus(purchaseStatus(row))).length,
      openSupport: support.filter((row) => isOpenStatus(row.status)).length,
      transports: transports.length,
      parkedCars: parkedCars.length,
    },
    listingBreakdown: topStatuses(cars, "status"),
    operationBreakdown: topStatuses(
      [...shipments, ...freightShipments, ...transports, ...parkedCars],
      "status",
    ),
    purchaseBreakdown: topStatuses(purchases, "purchaseStatus"),
    activeInventoryValue: activeCars.reduce((sum, row) => sum + numericValue(row.price), 0),
    paidHoldValue: purchases.reduce(
      (sum, row) => sum + numericValue(row.depositAmount ?? row.holdDepositAmount),
      0,
    ),
    earnings: summarizeBusinessEarnings({ purchases, shipments, freightShipments, transports, parkedCars }),
  };
}

/** An all-zero overview, for the moment before the server answers. */
export function emptyBusinessOverview(): BusinessOverview {
  return businessOverviewSummary({});
}

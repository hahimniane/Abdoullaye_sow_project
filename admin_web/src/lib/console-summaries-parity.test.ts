// The server works out the consoles' totals (my_flutter_app/functions/
// console_summaries.js) with a copy of the console's own math. This runs
// both over the same records and requires the same answer, so the figures a
// business sees cannot drift from the definitions tested here.
//
// Dates are read in UTC on both sides for the run (the server is told the
// viewer's zone; the console reads the browser's).

process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { businessOverviewSummary } from "./business-overview.ts";
import { summarizeBusinessEarnings } from "./business-earnings.ts";
import {
  businessParkingCollectedByMonth,
  businessParkingOverdue,
  businessParkingTotals,
} from "./business-parking-entry.ts";
import { invoiceBoard } from "./invoice-ledger.ts";
import { lotActivityMonth, lotLedgerTotals, lotYearMonthKeys } from "./lot-ledger.ts";
import { summarizePlatformEarnings } from "./platform-earnings.ts";
import type { FirestoreRow } from "@/types/admin";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const server = require("../../../my_flutter_app/functions/console_summaries.js");

const NOW = new Date("2026-10-05T15:00:00Z");
const at = (iso: string) => {
  const date = new Date(iso);
  return { toDate: () => date, toMillis: () => date.getTime(), seconds: Math.floor(date.getTime() / 1000) };
};
const rows = (list: Record<string, unknown>[]): FirestoreRow[] =>
  list.map((row, i) => ({ id: String(row.id ?? `r${i}`), ...row }) as FirestoreRow);

/** Plain data, so a Map-vs-object or undefined-vs-missing difference shows. */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------
// Fixtures: enough variety to touch every branch that has one.
// ---------------------------------------------------------------------------

const cars = rows([
  { status: "active", price: 12000 },
  { status: "active", price: "8500" },
  { status: "sold", price: 9000 },
  { status: "inactive" },
  {},
]);
const purchases = rows([
  { purchaseStatus: "reserved", depositAmount: 500, paymentStatus: "succeeded", amount: 500, platformFeeCents: 2500, createdAt: at("2026-09-02") },
  { purchaseStatus: "completed", holdDepositAmount: 250, paymentStatus: "succeeded", createdAt: at("2026-08-10") },
  { status: "pending" },
  { purchaseStatus: "cancelled", paymentStatus: "refunded" },
]);
const shipments = rows([
  { status: "pending", price: 150, paymentStatus: "paid", platformFeeCents: 750, createdAt: at("2026-09-20") },
  { status: "in_transit", totalPrice: 300, paymentStatus: "succeeded", createdAt: at("2026-07-01") },
  { status: "completed", price: 90, paymentStatus: "pending_payment" },
  { status: "cancelled", price: 40 },
]);
const freightShipments = rows([
  { status: "ready_for_pickup", totalPrice: 220, paymentStatus: "succeeded", settlementStatus: "settled", createdAt: at("2026-10-01") },
  { status: "awaiting_weight_confirmation", estimatedTotal: 75, paymentStatus: "card_saved" },
]);
const transports = rows([
  { status: "scheduled", price: 1200, paymentStatus: "succeeded", createdAt: at("2026-06-01") },
  { status: "delivered", price: 800 },
]);
const parkedCars = rows([
  { status: "parked", source: "business", dailyRate: 10, parkingDate: at("2026-09-20"), amountPaidCents: 5000, paymentStatus: "awaiting_direct_payment",
    parkingPayments: [{ amountCents: 3000, at: at("2026-09-25") }, { amountCents: 2000, at: at("2026-10-02") }], businessId: "biz" },
  { status: "parked", source: "customer", dailyRate: 15, parkingDate: at("2026-08-01"), parkingEndDate: at("2026-08-31"), paymentStatus: "succeeded",
    totalCostCents: 45000, amountPaidCents: 45000, paidAt: at("2026-08-01"), businessId: "biz" },
  { status: "parked", source: "business", dailyRate: 20, parkingDate: at("2026-07-01"), parkingEndDate: at("2026-07-11"), paymentStatus: "awaiting_direct_payment",
    totalCostCents: 20000, amountPaidCents: 5000, businessId: "biz" },
  { status: "cancelled", dailyRate: 10, parkingDate: at("2026-09-01"), businessId: "biz" },
  { status: "reserved", source: "customer", dailyRate: 12, parkingDate: at("2026-10-10"), parkingEndDate: at("2026-10-20"), businessId: "biz" },
]);
const support = rows([{ status: "open" }, { status: "resolved" }, { status: "" }, {}]);
const businesses = rows([{ id: "biz", name: "Atlantic" }, { id: "other", name: "Other" }]);

// ---------------------------------------------------------------------------

test("the business Today overview is the same on both sides", () => {
  const input = { cars, purchases, shipments, freightShipments, transports, parkedCars, support };
  const client = businessOverviewSummary(input);
  assert.deepEqual(plain(server.businessOverviewSummary(input)), plain(client));
  // The fixture actually exercises the counts and the money.
  assert.equal(client.metrics.activeListings, 2);
  assert.equal(client.activeInventoryValue, 20500);
  assert.ok(client.metrics.openShipments > 0 && client.metrics.openSupport > 0);
});

test("business earnings are the same on both sides", () => {
  const input = { purchases, shipments, freightShipments, transports, parkedCars };
  const client = summarizeBusinessEarnings(input);
  assert.deepEqual(plain(server.summarizeBusinessEarnings(input)), plain(client));
  assert.ok(JSON.stringify(client).match(/[1-9]/), "non-trivial earnings");
});

test("platform earnings are the same on both sides, focused or not", () => {
  const withBusiness = (list: FirestoreRow[], businessId: string) => list.map((row) => ({ ...row, businessId }));
  const input = {
    purchases: withBusiness(purchases, "biz"),
    shipments: withBusiness(shipments, "other"),
    freightShipments: withBusiness(freightShipments, "biz"),
    transports: withBusiness(transports, "other"),
    parkedCars,
    businesses,
  };
  assert.deepEqual(plain(server.summarizePlatformEarnings(input)), plain(summarizePlatformEarnings(input)));
  const focused = { ...input, focus: { businessKey: "biz" } };
  assert.deepEqual(plain(server.summarizePlatformEarnings(focused)), plain(summarizePlatformEarnings(focused)));
});

test("parking figures are the same on both sides, and the ended/active split adds back up", () => {
  const months = lotYearMonthKeys(2026);
  const options = { now: NOW, months, timeZone: "UTC" };
  const whole = server.finishParkingSummary(server.parkingSummaryPartial(parkedCars, options), 40);
  assert.deepEqual(plain(whole.totals), plain(businessParkingTotals(parkedCars, 40, NOW)));
  assert.ok(whole.totals.collected > 0 && whole.totals.owed > 0 && whole.overdue.count > 0, "non-trivial parking");
  assert.deepEqual(plain(whole.overdue), plain(businessParkingOverdue(parkedCars, NOW)));
  assert.deepEqual(plain(whole.collectedByMonth), plain(businessParkingCollectedByMonth(parkedCars, months, NOW)));
  // getParkingTotals caches the ended stays and reads the running ones fresh.
  const split = server.finishParkingSummary(server.combineParkingPartials(
    server.parkingSummaryPartial(parkedCars.slice(0, 2), options),
    server.parkingSummaryPartial(parkedCars.slice(2), options),
  ), 40);
  assert.deepEqual(plain(split), plain(whole));
});

test("the lot ledger's totals are the same on both sides", () => {
  const activities = rows([
    { id: "a1", activityTypeId: "title", feeCents: 15000, activityDate: at("2026-09-03"), paymentStatus: "succeeded", amountPaidCents: 15000 },
    { id: "a2", activityTypeId: "custom", feeCents: 5000, activityDateMonth: "2026-09", activityDate: at("2026-09-30"), paymentStatus: "awaiting_direct_payment", amountPaidCents: 2000 },
    { id: "a3", activityTypeId: "title", feeCents: 9000, activityDate: at("2026-08-15"), paymentStatus: "awaiting_payment_link" },
    { id: "a4", activityTypeId: "wash", feeCents: 2000, activityDate: at("2026-10-01"), paymentStatus: "cancelled" },
    { id: "a5", activityTypeId: "wash", feeCents: 3000, activityDate: at("2026-02-11"), paymentStatus: "succeeded", voided: true },
  ]);
  const payments = rows([
    { activityId: "a1", amountCents: 15000, paidAtMonth: "2026-10", paidAt: at("2026-10-02") },
    { activityId: "a2", amountCents: 2000, paidAtMonth: "2026-09", paidAt: at("2026-09-30") },
  ]);
  const expenseLines = rows([
    { id: "rent", kind: "fixed", amountCents: 100000, createdAt: at("2026-01-01"), active: true },
    { id: "fuel", kind: "variable" },
  ]);
  const expenseEntries = rows([
    { lineId: "fuel", amountCents: 4500, month: "2026-09" },
    { lineId: "rent", amountCents: 90000, month: "2026-08" },
    { lineId: "fuel", amountCents: 1200, month: "", spentAt: "2026-07-14" },
    { lineId: "fuel", amountCents: 999, month: "2026-09", voided: true },
  ]);
  const request = { rangeStart: "2026-08", rangeEnd: "2026-10", month: "2026-09", year: 2026, nowMonth: "2026-10" };
  const client = lotLedgerTotals({ activities, payments, expenseLines, expenseEntries, ...request });
  const fromServer = server.lotLedgerTotals({ activities, payments, expenseLines, expenseEntries, ...request, timeZone: "UTC" });
  assert.deepEqual(plain(fromServer), plain(client));
  assert.ok(client.monthRevenueCents > 0 && client.monthExpenseCents > 0 && client.scoreboard.collectedCents > 0, "non-trivial ledger");
  // Same month reading on both sides.
  for (const row of activities) assert.equal(server.lotActivityMonth(row), lotActivityMonth(row));
});

test("the invoice board is the same on both sides", () => {
  const invoices = rows([
    { status: "open", balanceCents: 5000, paidCents: 1000, dueOn: "2026-09-30" },
    { status: "open", balanceCents: 2500, paidCents: 0, dueOn: "2026-12-01" },
    { status: "open", balanceCents: 700, paidCents: 0, dueOn: "" },
    { status: "paid", balanceCents: 0, paidCents: 9000 },
  ]);
  assert.deepEqual(plain(server.invoiceBoard(invoices, "2026-10-05")), plain(invoiceBoard(invoices, "2026-10-05")));
});

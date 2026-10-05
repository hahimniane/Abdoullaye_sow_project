"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  mergeRowsById,
  monthBoundsMs,
  parkingMonthSummary,
} = require("../parking_month_statement");
const {occupancyEndMs} = require("../parking_occupancy");

// notifyParkingMonthEnd used to read every parkedCars row and every
// lotActivities row a lot ever had. It now reads four narrow queries. These
// tests replay those queries in memory and require the month's summary to
// be identical to the one built from the whole history.

const ts = (iso) => {
  const date = new Date(`${iso}T12:00:00Z`);
  return {toDate: () => date, toMillis: () => date.getTime()};
};
const NOW = new Date("2026-10-01T13:00:00Z");
const MONTH = "2026-09";

const car = (id, fields) => {
  const row = {id, customerPhone: `555000${id.length}${id}`,
    customerName: id, dailyRate: 10, totalCostCents: 9000,
    status: "parked", ...fields};
  return {...row, occupancyEndMs: occupancyEndMs(row)};
};

const cars = [
  car("old-closed-paid", {parkingDate: ts("2025-01-01"),
    parkingEndDate: ts("2025-02-01"), paymentStatus: "succeeded",
    amountPaidCents: 31000}),
  car("old-open", {parkingDate: ts("2024-05-01")}),
  car("ends-in-month", {parkingDate: ts("2026-08-20"),
    parkingEndDate: ts("2026-09-05")}),
  car("ended-day-before", {parkingDate: ts("2026-08-01"),
    parkingEndDate: ts("2026-08-31")}),
  car("ends-first-day", {parkingDate: ts("2026-08-25"),
    parkingEndDate: ts("2026-09-01")}),
  car("in-month", {parkingDate: ts("2026-09-10"),
    parkingEndDate: ts("2026-09-12")}),
  car("after-month", {parkingDate: ts("2026-10-03")}),
  car("cancelled", {parkingDate: ts("2026-09-02"), status: "cancelled"}),
  car("released-open", {parkingDate: ts("2026-07-01"), status: "released"}),
];

const activity = (id, fields) => ({id, feeCents: 5000,
  customerPhone: "5559990000", customerName: "Activity customer",
  paymentStatus: "awaiting_direct_payment", ...fields});

const activities = [
  activity("old-paid", {activityDate: ts("2025-03-01"),
    paymentStatus: "succeeded"}),
  activity("old-unpaid", {activityDate: ts("2026-06-15")}),
  activity("old-part-paid", {activityDate: ts("2026-07-15"),
    amountPaidCents: 2000}),
  activity("in-month-paid", {activityDate: ts("2026-09-03"),
    paymentStatus: "succeeded"}),
  activity("in-month-unpaid", {activityDate: ts("2026-09-30")}),
  activity("first-day", {activityDate: ts("2026-09-01")}),
  activity("future", {activityDate: ts("2026-10-02")}),
  activity("voided", {activityDate: ts("2026-09-04"), voided: true}),
  activity("undated", {activityDate: null, createdAt: ts("2026-09-08")}),
];

function narrowCars(rows, bounds) {
  return rows.filter((row) => row.occupancyEndMs >= bounds.startMs);
}

function narrowActivities(rows, bounds) {
  const ms = (row) => row.activityDate?.toMillis?.();
  const inMonth = rows.filter((row) => Number.isFinite(ms(row)) &&
    ms(row) >= bounds.startMs && ms(row) < bounds.endMs);
  // Firestore's != skips rows without the field, like this does.
  const unsettled = rows.filter((row) => typeof row.paymentStatus ===
    "string" && row.paymentStatus !== "succeeded");
  const undated = rows.filter((row) => row.activityDate === null);
  return mergeRowsById(inMonth, unsettled, undated);
}

describe("month-scoped reads for the month-end notice", () => {
  it("bounds a month in UTC days, end exclusive", () => {
    assert.deepEqual(monthBoundsMs("2026-09"), {
      startMs: Date.UTC(2026, 8, 1),
      endMs: Date.UTC(2026, 9, 1),
    });
    assert.deepEqual(monthBoundsMs("2026-12"), {
      startMs: Date.UTC(2026, 11, 1),
      endMs: Date.UTC(2027, 0, 1),
    });
    assert.equal(monthBoundsMs("2026-13"), null);
    assert.equal(monthBoundsMs("nope"), null);
  });

  it("merges rows from several queries, each once", () => {
    const merged = mergeRowsById([{id: "a", n: 1}], [{id: "a", n: 2},
      {id: "b"}], [], undefined);
    assert.deepEqual(merged, [{id: "a", n: 1}, {id: "b"}]);
  });

  it("the narrow reads give exactly the whole-history summary", () => {
    const bounds = monthBoundsMs(MONTH);
    const full = parkingMonthSummary(cars, MONTH, NOW, activities);
    const narrow = parkingMonthSummary(
        narrowCars(cars, bounds), MONTH, NOW,
        narrowActivities(activities, bounds));
    assert.deepEqual(narrow, full);
    // And the fixture actually exercises something.
    assert.ok(full.customersOwing.length > 0);
    assert.ok(full.bills.some((bill) => bill.id === "old-open"));
    assert.ok(full.bills.some((bill) => bill.id === "ends-first-day"));
  });

  it("while reading far less than the history", () => {
    const bounds = monthBoundsMs(MONTH);
    const read = narrowCars(cars, bounds).map((row) => row.id);
    assert.equal(read.includes("old-closed-paid"), false);
    assert.equal(read.includes("ended-day-before"), false);
    const acts = narrowActivities(activities, bounds).map((row) => row.id);
    assert.equal(acts.includes("old-paid"), false);
  });
});

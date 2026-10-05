"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  combineParkingPartials,
  finishParkingSummary,
  invoiceBoard,
  invoiceBoardAggregates,
  lotLedgerTotals,
  parkingSummaryPartial,
  platformEarningsLines,
  summarizePlatformEarnings,
  summarizePlatformEarningsLines,
  yearMonthKeys,
  zonedDayKey,
} = require("../console_summaries");
const {
  monthRangeMs,
  normalizeLedgerRequest,
  startOfUtcDayMs,
  withOther,
} = require("../console_totals");

const ts = (iso) => {
  const date = new Date(iso);
  return {toDate: () => date, toMillis: () => date.getTime()};
};

// Firestore's answer to one aggregation spec, replayed over rows in memory.
// String comparison is what Firestore does for "yyyy-mm-dd" keys.
function replayAggregate(rows, spec) {
  const matches = rows.filter((row) => spec.filters.every(([f, op, v]) => {
    const value = row[f];
    if (value === undefined) return false;
    if (op === "==") return value === v;
    if (op === ">") return typeof value === typeof v && value > v;
    if (op === "<") return typeof value === typeof v && value < v;
    throw new Error(`unhandled op ${op}`);
  }));
  if (!spec.sum) return matches.length;
  return matches.reduce((sum, row) =>
    sum + (typeof row[spec.sum] === "number" ? row[spec.sum] : 0), 0);
}

describe("invoice board aggregates", () => {
  const today = "2026-10-05";
  const invoices = [
    {status: "open", dueOn: "2026-09-01", balanceCents: 5000,
      paidCents: 1000},
    {status: "open", dueOn: "2026-10-05", balanceCents: 2500, paidCents: 0},
    {status: "open", dueOn: "", balanceCents: 700, paidCents: 300},
    {status: "open", dueOn: "2026-12-01", balanceCents: 0, paidCents: 900},
    {status: "paid", dueOn: "2026-01-01", balanceCents: 0, paidCents: 12000},
  ];

  it("answers the same board as reading every invoice", () => {
    const fromRows = invoiceBoard(invoices, today);
    const fromAggregates = Object.fromEntries(invoiceBoardAggregates(today)
        .map((spec) => [spec.key, replayAggregate(invoices, spec)]));
    assert.deepEqual(fromAggregates, fromRows);
    assert.deepEqual(fromRows, {open: 4, overdue: 1, owedCents: 8200,
      collectedCents: 14200, count: 5});
  });

  it("never counts an invoice with no due date as overdue", () => {
    const spec = invoiceBoardAggregates(today)
        .find((s) => s.key === "overdue");
    assert.equal(replayAggregate([{status: "open", dueOn: ""}], spec), 0);
  });
});

describe("parking partials", () => {
  const now = new Date("2026-10-05T15:00:00Z");
  const rows = [
    {id: "ended-paid", source: "business", status: "parked",
      parkingDate: ts("2026-08-01T12:00:00Z"),
      parkingEndDate: ts("2026-08-10T12:00:00Z"), totalCostCents: 10000,
      paymentStatus: "succeeded", directPaymentReceivedAt:
        ts("2026-08-11T12:00:00Z")},
    {id: "ended-owing", source: "business", status: "parked",
      parkingDate: ts("2026-09-01T12:00:00Z"),
      parkingEndDate: ts("2026-09-05T12:00:00Z"), totalCostCents: 5000,
      amountPaidCents: 2000, parkingPayments: [{amountCents: 2000,
        at: ts("2026-09-02T12:00:00Z")}]},
    {id: "open-ended", source: "business", status: "parked",
      parkingDate: ts("2026-10-01T12:00:00Z"), dailyRate: 10},
    {id: "reserved", status: "reserved",
      parkingDate: ts("2026-10-10T12:00:00Z"),
      parkingEndDate: ts("2026-10-12T12:00:00Z"), totalCost: 30},
    {id: "cancelled", source: "business", status: "cancelled",
      parkingDate: ts("2026-09-01T12:00:00Z"),
      parkingEndDate: ts("2026-09-02T12:00:00Z"), totalCostCents: 9000},
  ];
  const months = yearMonthKeys(2026);
  const options = {now, months, timeZone: "America/New_York"};

  it("adds up to the same figures as one pass over every row", () => {
    const whole = finishParkingSummary(parkingSummaryPartial(rows, options),
        20);
    const boundary = startOfUtcDayMs(now);
    const endMs = (row) => row.parkingEndDate ?
      row.parkingEndDate.toMillis() : Number.MAX_SAFE_INTEGER;
    const ended = rows.filter((row) => endMs(row) < boundary);
    const active = rows.filter((row) => endMs(row) >= boundary);
    const split = finishParkingSummary(combineParkingPartials(
        parkingSummaryPartial(ended, options),
        parkingSummaryPartial(active, options)), 20);
    assert.deepEqual(split, whole);
    assert.equal(whole.totals.inLot, 1);
    assert.equal(whole.totals.reserved, 1);
    assert.equal(whole.totals.left, 3);
    assert.equal(whole.totals.collected, 120);
    // ended-owing 30 + open-ended 5 days x $10 + reserved $30.
    assert.equal(whole.totals.owed, 110);
    assert.deepEqual(whole.overdue, {count: 1, amount: 30});
    assert.equal(whole.collectedByMonth[7], 10000);
    assert.equal(whole.collectedByMonth[8], 2000);
  });
});

describe("lot ledger totals", () => {
  const activity = (id, fields) => ({id, feeCents: 10000,
    activityTypeId: "title", paymentStatus: "awaiting_direct_payment",
    ...fields});
  const input = {
    activities: [
      activity("sep-paid", {activityDateMonth: "2026-09",
        paymentStatus: "succeeded"}),
      activity("oct-part", {activityDateMonth: "2026-10",
        amountPaidCents: 4000}),
      activity("oct-void", {activityDateMonth: "2026-10", voided: true}),
      activity("aug-custom", {activityDateMonth: "2026-08",
        activityTypeId: "custom"}),
    ],
    payments: [
      {id: "p1", activityId: "oct-part", amountCents: 4000,
        paidAtMonth: "2026-10"},
      {id: "p2", activityId: "sep-paid", amountCents: 10000,
        paidAtMonth: "2026-10"},
    ],
    expenseLines: [{id: "rent", kind: "fixed", recurringCents: 50000,
      createdAt: ts("2026-09-15T12:00:00Z")}],
    expenseEntries: [{id: "e1", lineId: "fuel", month: "2026-10",
      amountCents: 2500}],
    rangeStart: "2026-10",
    rangeEnd: "2026-10",
    month: "2026-10",
    year: 2026,
    nowMonth: "2026-10",
    timeZone: "UTC",
  };

  it("counts money in the month it arrived and owed on the span's jobs",
      () => {
        const totals = lotLedgerTotals(input);
        assert.deepEqual(totals.scoreboard, {generatedCents: 10000,
          collectedCents: 14000, owedCents: 6000, jobs: 1});
        assert.equal(totals.monthRevenueCents, 10000);
        assert.equal(totals.monthExpenseCents, 52500);
        // Rent only from the month the line was created.
        assert.equal(totals.yearExpenseByMonth[7], 0);
        assert.equal(totals.yearExpenseByMonth[8], 50000);
        assert.deepEqual(totals.yearRevenueByType,
            {title: 20000, custom: 10000});
      });

  it("normalizes the request and reads every month the screen can show",
      () => {
        const request = normalizeLedgerRequest({rangeStart: "2026-10",
          rangeEnd: "2026-08", month: "2025-12", year: 2026,
          timeZone: "Not/AZone"}, new Date("2026-10-05T12:00:00Z"));
        assert.equal(request.rangeStart, "2026-08");
        assert.equal(request.rangeEnd, "2026-10");
        assert.equal(request.readFrom, "2025-12");
        assert.equal(request.readThrough, "2026-12");
        assert.equal(request.timeZone, "");
        assert.throws(() => normalizeLedgerRequest({rangeStart: "2020-01",
          rangeEnd: "2026-01"}), /too long/);
        const bounds = monthRangeMs("2026-01", "2026-12");
        assert.equal(new Date(bounds.startMs).toISOString(),
            "2026-01-01T00:00:00.000Z");
        assert.equal(new Date(bounds.endMs).toISOString(),
            "2027-01-01T00:00:00.000Z");
      });
});

describe("platform earnings lines", () => {
  const input = {
    purchases: [{businessId: "b1", depositAmountCents: 20000,
      paymentStatus: "succeeded", platformFeeCents: 2000,
      createdAt: ts("2026-09-01T00:00:00Z")}],
    shipments: [{businessId: "b2", totalCents: 30000, paymentStatus: "pending",
      platformFeePct: 0.1, createdAt: ts("2026-09-03T00:00:00Z")}],
    parkedCars: [{businessName: "Walk-in lot", totalCostCents: 5000,
      paymentMethod: "direct"}],
    businesses: [{id: "b1", name: "One"}, {id: "b2", name: "Two"}],
  };

  it("summarizes the same as the record-level function, focused or not",
      () => {
        const lines = platformEarningsLines(input);
        assert.deepEqual(summarizePlatformEarningsLines(lines),
            summarizePlatformEarnings(input));
        for (const focus of [{businessKey: "b1"}, {serviceId: "carParking"},
          {businessKey: "b2", serviceId: "barrelShipping"}]) {
          assert.deepEqual(summarizePlatformEarningsLines(lines, focus),
              summarizePlatformEarnings({...input, focus}));
        }
        const totals = summarizePlatformEarnings(input).totals;
        assert.equal(totals.earnedCents, 2000);
        assert.equal(totals.pendingCents, 3000);
        assert.equal(totals.notCommissionableCents, 5000);
      });
});

describe("small helpers", () => {
  it("completes status counts with other", () => {
    assert.deepEqual(withOther(10, {a: 3, b: 4}), {a: 3, b: 4, other: 3});
    assert.deepEqual(withOther(7, {a: 3, b: 4}), {a: 3, b: 4});
  });

  it("reads a day in the viewer's zone", () => {
    const lateEvening = new Date("2026-10-06T02:30:00Z");
    assert.equal(zonedDayKey(lateEvening, "America/New_York"), "2026-10-05");
    assert.equal(zonedDayKey(lateEvening, ""), "2026-10-06");
  });
});

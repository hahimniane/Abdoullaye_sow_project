"use strict";

// Voiding a parked car and an expense line, and stopping a line after a
// month: the pure rules behind updateBusinessParkingEntry action "void",
// voidLotExpenseEntry {lineId} and upsertLotExpenseLine action
// "setEndMonth", and every reader that must skip what they leave behind.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  BUSINESS_PARKING_VOID_REFUSALS,
  PARKING_LINK_STATES,
  businessParkingVoidPlan,
  businessParkingVoided,
  parkingLinkCancelledFields,
  parkingPaymentLinkState,
} = require("../business_parking_entry");
const {
  isActiveParkingRow,
  parkingAvailability,
} = require("../parking_occupancy");
const {parkingMonthStatement} = require("../parking_month_statement");
const {
  businessOverviewSummary,
  lotLedgerTotals,
  parkingSummaryPartial,
  summarizeBusinessEarnings,
} = require("../console_summaries");
const {
  LOT_EXPENSE_LINE_REFUSALS,
  lotLineEndMonth,
  lotLineEndMonthPlan,
  lotLineLiveIn,
  lotLineVoidPlan,
  lotMonthLabel,
} = require("../lot_ledger");
const {voidedTrackingRecord} = require("../guest_tracking");
const {candidateShows} = require("../phone_accounts");

const linkEntry = (overrides = {}) => ({
  businessId: "biz",
  source: "business",
  status: "reserved",
  paymentMethod: "payment_link",
  paymentStatus: "pending",
  amountDueCents: 12000,
  checkoutSessionId: "cs_test",
  parkingDate: new Date("2026-10-01T12:00:00Z"),
  parkingEndDate: new Date("2026-10-10T12:00:00Z"),
  ...overrides,
});

describe("businessParkingVoidPlan", () => {
  it("voids with who and why, and cancels an unpaid link", () => {
    const plan = businessParkingVoidPlan({entry: linkEntry(),
      reason: "  entered twice  ", byStaffId: "staff-1"});
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.update, {voided: true,
      voidedByStaffId: "staff-1", voidReason: "entered twice"});
    assert.equal(plan.cancelLink, true);
  });

  it("keeps a paid link's payment and never cancels it", () => {
    const plan = businessParkingVoidPlan({
      entry: linkEntry({paymentStatus: "paid"}), reason: "",
      byStaffId: "s"});
    assert.equal(plan.ok, true);
    assert.equal(plan.cancelLink, false);
    assert.equal(plan.update.voidReason, "");
  });

  it("caps the reason at 300 characters", () => {
    const plan = businessParkingVoidPlan({entry: linkEntry(),
      reason: "x".repeat(400), byStaffId: "s"});
    assert.equal(plan.update.voidReason.length, 300);
  });

  it("refuses a missing or already voided car", () => {
    assert.equal(businessParkingVoidPlan({entry: null}).reason,
        "car_not_found");
    const again = businessParkingVoidPlan({entry: linkEntry({voided: true})});
    assert.equal(again.ok, false);
    assert.equal(again.reason, "car_voided");
    assert.equal(BUSINESS_PARKING_VOID_REFUSALS.car_voided, "Already voided.");
  });

  it("a voided car's link answers cancelled", () => {
    assert.equal(parkingPaymentLinkState(linkEntry({voided: true})),
        PARKING_LINK_STATES.CANCELLED);
    assert.equal(businessParkingVoided({voided: true}), true);
    assert.equal(businessParkingVoided({voided: "yes"}), false);
    assert.deepEqual(parkingLinkCancelledFields("u", "AT"), {
      paymentLinkCancelledAt: "AT", paymentLinkCancelledByUid: "u",
      checkoutStatus: "cancelled"});
  });
});

describe("a voided parked car frees its space", () => {
  it("is never an active row, whatever its status", () => {
    assert.equal(isActiveParkingRow({status: "reserved"}), true);
    assert.equal(isActiveParkingRow({status: "reserved", voided: true}),
        false);
  });

  it("gives its space back to availability", () => {
    const business = {parkingTotalSpaces: 2, parkingBlockedSpaces: 0};
    const start = new Date("2026-10-05T00:00:00Z");
    const end = new Date("2026-10-06T00:00:00Z");
    const car = linkEntry();
    assert.equal(parkingAvailability({business, start, end,
      reservations: [car, car]}), 0);
    assert.equal(parkingAvailability({business, start, end,
      reservations: [car, {...car, voided: true}]}), 1);
  });
});

describe("a voided parked car drops out of every total", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const car = {
    id: "c1", businessId: "biz", source: "business", status: "reserved",
    paymentMethod: "direct", paymentStatus: "awaiting_direct_payment",
    customerName: "A", customerPhone: "+12015551234",
    parkingDate: new Date("2026-10-01T12:00:00Z"),
    parkingEndDate: new Date("2026-10-10T12:00:00Z"),
    dailyRate: 10, amountDueCents: 10000, totalCostCents: 10000,
    amountPaidCents: 4000,
  };

  it("has no month-end bill", () => {
    assert.ok(parkingMonthStatement(car, "2026-10", now));
    assert.equal(parkingMonthStatement({...car, voided: true}, "2026-10",
        now), null);
  });

  it("counts as a record but in no parking figure", () => {
    const live = parkingSummaryPartial([car], {now, months: ["2026-10"]});
    const voided = parkingSummaryPartial([{...car, voided: true}],
        {now, months: ["2026-10"]});
    assert.ok(live.collected > 0);
    assert.ok(live.owed > 0);
    assert.deepEqual(voided, {inLot: 0, reserved: 0, left: 0, collected: 0,
      owed: 0, overdueCount: 0, overdueAmount: 0, records: 1,
      collectedByMonth: [0]});
  });

  it("is in no overview count or earning", () => {
    const live = businessOverviewSummary({parkedCars: [car]});
    const voided = businessOverviewSummary({parkedCars: [{...car,
      voided: true}]});
    assert.equal(live.metrics.parkedCars, 1);
    assert.equal(voided.metrics.parkedCars, 0);
    const earnings = summarizeBusinessEarnings({parkedCars: [{...car,
      voided: true}]});
    assert.equal(earnings.totals.pendingGross, 0);
    assert.equal(earnings.totals.grossReceived, 0);
  });

  it("is gone for the customer and for guest tracking", () => {
    assert.equal(voidedTrackingRecord({collection: "parkedCars",
      data: {voided: true}}), true);
    assert.equal(voidedTrackingRecord({collection: "parkedCars",
      data: {}}), false);
    assert.equal(voidedTrackingRecord({collection: "barrelShipments",
      data: {voided: true}}), false);
    const candidate = (data) => ({collection: "parkedCars",
      raw: "customerPhone", data});
    assert.equal(candidateShows(candidate({customerPhone: "+12015551234"}),
        "+12015551234"), true);
    assert.equal(candidateShows(candidate({customerPhone: "+12015551234",
      voided: true}), "+12015551234"), false);
  });
});

describe("expense lines: void and stop", () => {
  it("voids a line only once and never over live purchases", () => {
    assert.deepEqual(lotLineVoidPlan({line: {label: "x"}, livePurchases: 0}),
        {ok: true, reason: ""});
    assert.equal(lotLineVoidPlan({line: null}).reason, "line_not_found");
    assert.equal(lotLineVoidPlan({line: {voided: true}}).reason,
        "line_voided");
    assert.equal(lotLineVoidPlan({line: {}, livePurchases: 2}).reason,
        "line_has_purchases");
    assert.equal(LOT_EXPENSE_LINE_REFUSALS.line_has_purchases,
        "Void this line's purchases first.");
  });

  it("stops after a month, resumes, and refuses a bad or early month", () => {
    const line = {kind: "fixed", recurringCents: 2000};
    const stop = lotLineEndMonthPlan({line, endMonth: "2026-10",
      purchaseMonths: ["2026-09", "2026-10"]});
    assert.deepEqual(stop, {ok: true, reason: "", endMonth: "2026-10",
      summary: "Stopped after October 2026", changed: true});
    const resume = lotLineEndMonthPlan({line: {...line, endMonth: "2026-10"},
      endMonth: "", purchaseMonths: []});
    assert.equal(resume.summary, "Resumed");
    assert.equal(resume.changed, true);
    assert.equal(lotLineEndMonthPlan({line, endMonth: "2026-13"}).reason,
        "end_month_invalid");
    assert.equal(lotLineEndMonthPlan({line, endMonth: "Oct"}).reason,
        "end_month_invalid");
    assert.equal(lotLineEndMonthPlan({line, endMonth: "2026-09",
      purchaseMonths: ["2026-10"]}).reason, "end_month_before_purchases");
    assert.equal(lotLineEndMonthPlan({line: {voided: true},
      endMonth: "2026-10"}).reason, "line_voided");
    assert.equal(lotMonthLabel("2026-01"), "January 2026");
  });

  it("is live through its last month and not after", () => {
    const line = {endMonth: "2026-10"};
    assert.equal(lotLineLiveIn(line, "2026-09"), true);
    assert.equal(lotLineLiveIn(line, "2026-10"), true);
    assert.equal(lotLineLiveIn(line, "2026-11"), false);
    assert.equal(lotLineLiveIn({}, "2030-01"), true);
    assert.equal(lotLineLiveIn({voided: true}, "2026-01"), false);
    assert.equal(lotLineEndMonth({endMonth: "garbage"}), "");
  });

  it("totals skip a voided line in every month and a stopped one after",
      () => {
        const base = {kind: "fixed", recurringCents: 2000, label: "Waste",
          createdAt: new Date("2026-01-15T12:00:00Z")};
        const totals = (line, month) => lotLedgerTotals({
          activities: [], payments: [], expenseEntries: [],
          expenseLines: [{id: "l1", ...line}],
          rangeStart: month, rangeEnd: month, month, year: 2026,
          nowMonth: "2026-12", timeZone: "UTC",
        });
        const cents = (line, month) =>
          totals(line, month).monthExpenseCents === 2000;
        assert.equal(cents(base, "2026-11"), true);
        assert.equal(cents({...base, voided: true}, "2026-03"), false);
        // Voided without `active: false` (a hand-edited row) still drops.
        assert.equal(cents({...base, voided: true, active: true}, "2026-11"),
            false);
        const stopped = {...base, endMonth: "2026-10"};
        assert.equal(cents(stopped, "2026-09"), true);
        assert.equal(cents(stopped, "2026-10"), true);
        assert.equal(cents(stopped, "2026-11"), false);
      });
});

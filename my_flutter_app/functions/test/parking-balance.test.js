"use strict";

// What a parked car owes today (docs/PARKING_WHATSAPP.md §2 "Money on the
// car"). The cases live in test/fixtures/parking-balance-cases.json, which
// the console (admin_web/src/lib/parking-month-statement.ts) and the app
// (lib/services/parking_month_statement.dart) run too, so the three agree.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  accruedThroughCents,
  parkingBalanceNow,
  paidNowCents,
} = require("../parking_month_statement");

const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "parking-balance-cases.json"), "utf8"));
const NOW = new Date(fixture.now);

describe("parkingBalanceNow: the shared fixture", () => {
  it("names the cases the console and the app must also pass", () => {
    assert.deepEqual(fixture.cases.map((c) => c.name), [
      "open stay, nothing paid",
      "closed stay is its total",
      "part-paid open stay",
      "overpaid never goes negative",
      "a reverted payment is ignored",
      "marked paid in full without amounts",
      "part payments then marked paid in full",
      "arriving in the future owes nothing yet",
      "no daily rate runs up nothing",
      "a stay that ends later is pro-rated so far",
      "voided car has no balance",
      "cancelled car has no balance",
    ]);
  });

  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      assert.deepEqual(parkingBalanceNow(testCase.car, NOW),
          testCase.expected);
    });
  }
});

describe("parkingBalanceNow: the rules behind the fixture", () => {
  const car = (extra = {}) => ({
    parkingDate: "2026-10-20T12:00:00Z", dailyRate: 10, ...extra});

  it("counts the arrival day and today, like the month-end bill", () => {
    const balance = parkingBalanceNow(car(), NOW);
    assert.equal(balance.days, 10);
    // The very number the month-end statement runs up through today.
    assert.equal(balance.accruedCents, accruedThroughCents(
        car(), Math.floor(NOW.getTime() / 86400000),
        Math.floor(NOW.getTime() / 86400000)));
  });

  it("is one day on the day it arrives", () => {
    const balance = parkingBalanceNow(
        car({parkingDate: "2026-10-29T08:00:00Z"}), NOW);
    assert.equal(balance.days, 1);
    assert.equal(balance.accruedCents, 1000);
    assert.equal(balance.balanceCents, 1000);
  });

  it("flags paidInFull only once something was run up and covered", () => {
    assert.equal(parkingBalanceNow(car({paymentStatus: "succeeded"}), NOW)
        .paidInFull, true);
    assert.equal(parkingBalanceNow(car({dailyRate: 0,
      paymentStatus: "succeeded"}), NOW).paidInFull, false);
    assert.equal(parkingBalanceNow(car({amountPaidCents: 9999}), NOW)
        .paidInFull, false);
    assert.equal(parkingBalanceNow(car({amountPaidCents: 10000}), NOW)
        .paidInFull, true);
  });

  it("knows a car that left from one that is still there", () => {
    assert.equal(parkingBalanceNow(car(), NOW).stillParked, true);
    assert.equal(parkingBalanceNow(car({
      parkingEndDate: "2026-10-25T12:00:00Z", amountDueCents: 6000}), NOW)
        .stillParked, false);
    // Leaving today: still on the lot today.
    assert.equal(parkingBalanceNow(car({
      parkingEndDate: "2026-10-29T12:00:00Z", amountDueCents: 10000}), NOW)
        .stillParked, true);
  });

  it("reads Firestore timestamps and dollar-only records", () => {
    const stamp = (iso) => ({seconds: Date.parse(iso) / 1000});
    const balance = parkingBalanceNow({
      parkingDate: stamp("2026-10-28T12:00:00Z"),
      dailyRateCents: 2500,
      parkingPayments: [{amount: 10}],
    }, NOW);
    assert.equal(balance.dailyRateCents, 2500);
    assert.equal(balance.days, 2);
    assert.equal(balance.paidCents, 1000);
  });

  it("is null for a car with no arrival day", () => {
    assert.equal(parkingBalanceNow({dailyRate: 10}, NOW), null);
    assert.equal(parkingBalanceNow(null, NOW), null);
  });
});

describe("paidNowCents", () => {
  const today = Math.floor(NOW.getTime() / 86400000);
  it("takes the larger of the instalments and the record's total", () => {
    assert.equal(paidNowCents({parkingPayments: [{amountCents: 2000}],
      amountPaidCents: 10000}, today), 10000);
    assert.equal(paidNowCents({parkingPayments: [{amountCents: 2000},
      {amountCents: 500}]}, today), 2500);
  });

  it("trusts the list alone once it marks a payment reverted", () => {
    assert.equal(paidNowCents({amountPaidCents: 3000,
      parkingPayments: [{amountCents: 2000},
        {amountCents: 1000, reverted: true}]}, today), 2000);
    assert.equal(paidNowCents({amountPaidCents: 1000,
      parkingPayments: [{amountCents: 1000, reverted: true}]}, today), 0);
  });
});

"use strict";

// docs/PARKING_DISCOUNT.md. The shared fixture is also run by the console
// (admin_web/src/lib/parking-discount.test.ts) and the app
// (test/parking_discount_test.dart).

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  discountGivePlan,
  discountSettlePlan,
  discountUndoPlan,
} = require("../parking_discount");
const {
  parkingBalanceNow,
  parkingMonthStatement,
} = require("../parking_month_statement");
const fixture = require("./fixtures/parking-discount-cases.json");

const NOW = new Date(fixture.now);
const pick = (value, keys) =>
  Object.fromEntries(keys.map((k) => [k, value?.[k]]));

describe("parking discount: the month bill", () => {
  for (const c of fixture.monthCases) {
    it(c.name, () => {
      const bill = parkingMonthStatement(c.car, c.monthKey, NOW);
      assert.deepEqual(pick(bill, Object.keys(c.expect)), c.expect);
    });
  }
});

describe("parking discount: the plans", () => {
  for (const c of fixture.planCases) {
    it(c.name, () => {
      const plan = c.mode === "settle" ?
        discountSettlePlan({car: c.car, paidCents: c.amountCents,
          reason: c.reason, receivedByStaffId: c.receivedByStaffId,
          now: NOW}) :
        discountGivePlan({car: c.car, amountCents: c.amountCents,
          reason: c.reason, now: NOW});
      assert.deepEqual(pick(plan, Object.keys(c.expect)), c.expect);
      if (!plan.ok) assert.ok(plan.message, "a refusal says why");
    });
  }

  it("an expected amount that moved refuses", () => {
    const c = fixture.planCases.find((x) => x.mode === "settle" && x.expect.ok);
    const plan = discountSettlePlan({car: c.car, paidCents: c.amountCents,
      reason: c.reason, receivedByStaffId: "staff-a",
      expectedOwedCents: c.expect.owedCents + 1, now: NOW});
    assert.equal(plan.reason, "discount_owed_changed");
    assert.equal(plan.owedCents, c.expect.owedCents);
  });

  it("a settled car is not owing, and the discount is not paid money", () => {
    const c = fixture.planCases.find((x) =>
      x.name.startsWith("settle: $2,000"));
    const after = {...c.car, amountPaidCents: 150000, paymentStatus: "paid",
      parkingPayments: [{amountCents: 150000, receivedVia: "cash"}],
      parkingDiscountCents: 50000};
    const balance = parkingBalanceNow(after, NOW);
    assert.equal(balance.paidCents, 150000);
    assert.equal(balance.discountCents, 50000);
    assert.equal(balance.balanceCents, 0);
    assert.equal(balance.paidInFull, true);
  });
});

describe("parking discount: undo", () => {
  const car = {paymentMethod: "direct", source: "business",
    parkingDate: "2026-10-01", parkingEndDate: "2026-10-31",
    amountDueCents: 200000, amountPaidCents: 150000, paymentStatus: "paid",
    parkingDiscountCents: 50000,
    parkingDiscounts: [{id: "d1", amountCents: 50000, reason: "agreed"}]};

  it("marks it undone, keeps it, and reopens the stay", () => {
    const plan = discountUndoPlan({car, discountId: "d1", uid: "u1",
      nowMs: 5});
    assert.equal(plan.ok, true);
    assert.equal(plan.discountCents, 0);
    assert.equal(plan.reopens, true);
    assert.equal(plan.discounts.length, 1);
    assert.equal(plan.discounts[0].undone, true);
    assert.equal(plan.discounts[0].undoneByUid, "u1");
  });

  it("refuses twice and unknown ids", () => {
    const once = discountUndoPlan({car, discountId: "d1", uid: "u", nowMs: 1});
    const twice = discountUndoPlan({car: {...car,
      parkingDiscounts: once.discounts}, discountId: "d1", uid: "u", nowMs: 2});
    assert.equal(twice.reason, "discount_already_undone");
    assert.equal(discountUndoPlan({car, discountId: "x", uid: "u",
      nowMs: 1}).reason, "discount_not_found");
  });

  it("a stay money alone still covers does not reopen", () => {
    const plan = discountUndoPlan({car: {...car, amountPaidCents: 200000},
      discountId: "d1", uid: "u", nowMs: 1});
    assert.equal(plan.reopens, false);
  });
});

describe("parking discount: the money figures", () => {
  const {
    businessParkingAmountPaid,
    businessParkingBalance,
    combineParkingPartials,
    finishParkingSummary,
    parkingSummaryPartial,
  } = require("../console_summaries");
  const now = new Date("2026-11-15T15:00:00Z");
  const months = ["2026-10", "2026-11"];
  const atNov = Date.parse("2026-11-10T15:00:00Z");
  const cars = [
    {paymentMethod: "direct", source: "business", parkingDate: "2026-10-01",
      parkingEndDate: "2026-10-31", amountDueCents: 200000,
      amountPaidCents: 150000, paymentStatus: "paid",
      parkingPayments: [{amountCents: 150000, at: new Date(atNov)}],
      parkingDiscountCents: 50000,
      parkingDiscounts: [
        {id: "a", amountCents: 50000, atMs: atNov, givenByUid: "u1"},
        {id: "b", amountCents: 900, atMs: atNov, givenByUid: "u2",
          undone: true},
      ]},
    {paymentMethod: "direct", source: "business", parkingDate: "2026-11-01",
      dailyRate: 12, parkingDiscountCents: 3000,
      parkingDiscounts: [{id: "c", amountCents: 3000, atMs: atNov,
        givenByUid: "u2"}]},
  ];

  it("a discount is owed off, never collected", () => {
    assert.equal(businessParkingAmountPaid(cars[0], now), 1500);
    assert.equal(businessParkingBalance(cars[0], now), 0);
    assert.equal(businessParkingBalance(cars[1], now), 150);
    // Marked paid with no amount: only the net counts as money in.
    const noAmount = {...cars[0], amountPaidCents: 0, parkingPayments: []};
    assert.equal(businessParkingAmountPaid(noAmount, now), 1500);
  });

  it("counts discounts per month and per person, skipping undone", () => {
    const options = {now, months, timeZone: "America/New_York"};
    const told = finishParkingSummary(combineParkingPartials(
        parkingSummaryPartial([cars[0]], options),
        parkingSummaryPartial([cars[1]], options)));
    assert.deepEqual(told.discountedByMonth, [0, 53000]);
    assert.deepEqual(told.discountedByMonthByUid,
        [{}, {u1: 50000, u2: 3000}]);
    assert.equal(told.totals.collected, 1500);
    assert.equal(told.totals.owed, 150);
  });
});

describe("parking discount: mark paid, part payments, closing", () => {
  const {
    businessParkingClosePlan,
    businessParkingPaidUpdate,
    businessParkingPartialPaymentPlan,
  } = require("../business_parking_entry");
  const fixed = {source: "business", paymentMethod: "direct",
    status: "reserved", paymentStatus: "awaiting_direct_payment",
    parkingDate: "2026-10-01", parkingEndDate: "2026-10-31",
    amountDueCents: 200000, parkingDiscountCents: 50000};

  it("mark paid records only the net as money", () => {
    const plan = businessParkingPaidUpdate({entry: fixed, receivedVia: "cash",
      note: "", markedByUid: "u"});
    assert.equal(plan.ok, true);
    assert.equal(plan.amountPaidCents, 150000);
    assert.equal(plan.update.amountPaidCents, 150000);
  });

  it("a part payment is capped at the total less the discount", () => {
    const plan = businessParkingPartialPaymentPlan({entry: fixed,
      amountCents: 190000, dailyRateCents: 1200});
    assert.equal(plan.appliedCents, 150000);
    assert.equal(plan.fullyCovered, true);
  });

  it("closing an open stay settles it when money and discount cover it", () => {
    const open = {source: "business", paymentMethod: "direct",
      status: "reserved", paymentStatus: "awaiting_direct_payment",
      parkingDate: "2026-11-01T12:00:00Z", dailyRateCents: 1200,
      amountPaidCents: 10000, parkingDiscountCents: 2000};
    const plan = businessParkingClosePlan({entry: open,
      endDate: "2026-11-10T12:00:00Z"});
    assert.equal(plan.amountDueCents, 12000);
    assert.equal(plan.remainingCents, 0);
    assert.equal(plan.fullyCovered, true);
    assert.equal(plan.update.paymentStatus, "paid");
  });
});

describe("parking discount: what the customer sees", () => {
  const {receiptModel, stayStatementModel} =
    require("../parking_receipt_pdf");
  const car = {trackingCode: "PK-TEST1", customerName: "Test Customer",
    paymentMethod: "direct", source: "business",
    parkingDate: "2026-10-01", parkingEndDate: "2026-10-31",
    amountDueCents: 200000, amountPaidCents: 150000, paymentStatus: "paid",
    parkingDiscountCents: 50000};

  it("the stay statement and the receipt carry the discount line", () => {
    const balance = parkingBalanceNow(car, NOW);
    const statement = stayStatementModel({business: {name: "Lot"}, car,
      balance});
    assert.equal(statement.kind, "receipt");
    assert.ok(statement.rows.some((r) => r.label === "Discount / Remise" &&
      r.value === "-$500.00"), JSON.stringify(statement.rows));
    const receipt = receiptModel({business: {name: "Lot"}, car, balance,
      payment: {amountCents: 150000, method: "cash", atMs: NOW.getTime()}});
    assert.ok(receipt.totals.some((t) => t.label === "Discount / Remise"));
    assert.equal(receipt.status.paidInFull, true);
  });

  it("no discount, no line", () => {
    const plain = {...car, parkingDiscountCents: 0, amountPaidCents: 200000};
    const statement = stayStatementModel({business: {name: "Lot"},
      car: plain, balance: parkingBalanceNow(plain, NOW)});
    assert.ok(!statement.rows.some((r) => r.label === "Discount / Remise"));
  });
});

describe("parking discount: no WhatsApp payment for a discount", () => {
  const {newPayments} = require("../parking_whatsapp");
  it("a discount that settles a car sends no payment receipt", () => {
    const before = {paymentMethod: "direct", source: "business",
      parkingDate: "2026-10-01", parkingEndDate: "2026-10-31",
      amountDueCents: 200000, paymentStatus: "awaiting_direct_payment"};
    const after = {...before, paymentStatus: "paid",
      parkingDiscountCents: 200000};
    assert.deepEqual(newPayments({businessId: "b", carId: "c", before,
      after, eventMs: NOW.getTime(), now: NOW}), []);
  });
});

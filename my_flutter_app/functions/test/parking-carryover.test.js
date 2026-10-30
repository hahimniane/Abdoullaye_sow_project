"use strict";
/* eslint-disable max-len */

// Cars that left before the month still owing come along on the month's
// bill as "unpaid from before" (docs/PARKING_CARRYOVER.md). The fixture is
// shared with the console and app mirrors.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  carriedCarItem,
  monthBillPaymentPlan,
  parkingMonthCustomerText,
  parkingMonthSummary,
} = require("../parking_month_statement");
const {invoiceModel} = require("../parking_invoice_pdf");
const {invoiceRecipients} = require("../parking_invoices");
const {cases} = require("./fixtures/parking-carryover-cases.json");

describe("unpaid parking carried from earlier months", () => {
  for (const k of cases) {
    it(k.name, () => {
      const s = parkingMonthSummary(k.cars, k.monthKey, new Date(k.now), []);
      assert.deepEqual(s.carried.map((c) => ({id: c.id,
        periodFrom: c.periodFrom, periodTo: c.periodTo, days: c.days,
        accruedCents: c.accruedCents, dueCents: c.dueCents})),
      k.expect.carried);
      assert.deepEqual(s.customers.map((c) => ({key: c.key,
        carIds: c.cars.map((b) => b.id),
        olderCarIds: c.olderCars.map((b) => b.id), monthCents: c.monthCents,
        priorUnpaidCents: c.priorUnpaidCents, dueCents: c.dueCents,
        owes: c.owes, paid: c.paid})), k.expect.customers);
    });
  }

  const yao = cases.find((k) => k.name.startsWith("same phone"));
  const summary = parkingMonthSummary(yao.cars, yao.monthKey,
      new Date(yao.now), []);
  const customer = summary.customers[0];

  it("is null for a car that never left, or left inside the month", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    assert.equal(carriedCarItem({parkingDate: "2026-09-01", dailyRate: 10},
        "2026-10", now), null);
    assert.equal(carriedCarItem({parkingDate: "2026-09-01",
      parkingEndDate: "2026-10-02", amountDueCents: 100}, "2026-10", now),
    null);
    assert.equal(carriedCarItem(null, "2026-10", now), null);
  });

  it("prints the carried car under Unpaid from before in the bill text", () => {
    const text = parkingMonthCustomerText(customer, "Dala Parking");
    assert.match(text, /Unpaid from before\nSep 6, 2026 to Sep 7, 2026 · Parking · 2021 Toyota Highlander \(registered to Mariam\) — \$24\.00/);
    assert.match(text, /BALANCE DUE: \$588\.00/);
  });

  it("Mark all paid records the carried car first, for what it still owes", () => {
    const plan = monthBillPaymentPlan(customer);
    assert.deepEqual(plan.items.map((i) => [i.kind, i.id, i.amountCents]),
        [["car", "highlander", 2400], ["car", "rogue", 56400]]);
    assert.equal(plan.totalCents, 58800);
  });

  it("the invoice lists it under Unpaid from before and bills the customer who only has it", () => {
    const model = invoiceModel({business: {name: "Dala Parking"},
      monthKey: "2026-10", recipient: {customer: {...customer,
        expenseLines: [], earlierExpenseCents: 0},
      invoiceNumber: "INV-202610-0101-1", phone: "+12015550101"},
      issuedMs: Date.UTC(2026, 10, 1)});
    const before = model.summary.find((x) => /^Unpaid from before/.test(x.label));
    assert.equal(before.value, "$384.00");
    assert.ok(before.sub.some((s) => s.value === "$24.00" &&
      /Sep 6, 2026 – Sep 7, 2026 · Parking \/ Stationnement · 2021 Toyota Highlander/.test(s.label)), JSON.stringify(before.sub));
    const bah = cases.find((k) => k.name.startsWith("a customer with only"));
    const book = invoiceRecipients(parkingMonthSummary(bah.cars, bah.monthKey,
        new Date(bah.now), []), null, new Date(bah.now),
    {business: {country: "United States"}});
    assert.equal(book.recipients.length, 1);
    assert.equal(book.recipients[0].totalDueCents, 28800);
    assert.equal(book.recipients[0].stillParked, false);
  });
});

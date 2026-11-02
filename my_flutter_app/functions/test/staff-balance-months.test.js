"use strict";

// Staff balances month by month (docs/STAFF_BALANCES_MONTHLY.md): money
// counts in the month its bill was for, and the months add up to the net.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {staffBalances} = require("../staff_balances");
const {allocate, staffBalanceMonths} = require("../staff_balance_months");
const fixture = require("./fixtures/staff-balances-cases.json");

const inputOf = (c) => ({
  now: new Date(c.nowMs),
  staffNames: c.staffNames,
  sources: c.sources,
  counted: c.counted,
  handovers: c.handovers,
  netting: c.netting,
});

describe("staffBalanceMonths", () => {
  for (const c of fixture.cases) {
    it(`the months add up to the net: ${c.name}`, () => {
      const input = inputOf(c);
      const answer = staffBalances(input);
      const months = staffBalanceMonths(input);
      for (const row of answer.staff) {
        const list = months[row.staffId] || [];
        const last = list.length ? list[list.length - 1].runningNetCents : 0;
        assert.equal(last, row.netCents, `${row.staffId} in ${c.name}`);
        let running = 0;
        for (const m of list) {
          running += m.monthNetCents;
          assert.equal(m.runningNetCents, running);
          assert.equal(m.collectedCents, m.lines.collected
              .reduce((t, l) => t + l.amountCents, 0));
          assert.equal(m.expensesPaidCents, m.lines.expenses
              .reduce((t, l) => t + l.amountCents, 0));
        }
      }
    });
  }

  it("a parking payment pays the oldest month first", () => {
    const bounds = [{month: "2026-09", upTo: 36000},
      {month: "2026-10", upTo: 55200}];
    assert.deepEqual(allocate(bounds, 0, 10000, "x"),
        [{month: "2026-09", amountCents: 10000}]);
    assert.deepEqual(allocate(bounds, 30000, 40000, "x"), [
      {month: "2026-09", amountCents: 6000},
      {month: "2026-10", amountCents: 4000}]);
    // Paid beyond every charge: the extra sits on the last month.
    assert.deepEqual(allocate(bounds, 50000, 60000, "x"),
        [{month: "2026-10", amountCents: 10000}]);
    assert.deepEqual(allocate([], 0, 500, "2026-11"),
        [{month: "2026-11", amountCents: 500}]);
  });

  it("September's parking collected in October counts for September", () => {
    const car = {id: "c1", parkingDate: "2026-09-21T12:00:00Z",
      parkingEndDate: "2026-10-13T12:00:00Z", amountDueCents: 27600,
      paymentMethod: "direct", enteredByBusiness: true,
      parkingPayments: [{amountCents: 27600, receivedVia: "other",
        receivedByStaffId: "yao", at: Date.parse("2026-10-13T15:00:00Z")}]};
    const months = staffBalanceMonths({now: new Date("2026-11-02T18:00:00Z"),
      sources: {parkedCars: [car]}, handovers: [],
      netting: {entries: [], repayments: [], links: {}}});
    const yao = Object.fromEntries(months.yao.map((m) => [m.monthKey, m]));
    // 23 days at $12: 10 in September, 13 in October.
    assert.equal(yao["2026-09"].collectedCents, 12000);
    assert.equal(yao["2026-10"].collectedCents, 15600);
    assert.equal(yao["2026-11"].collectedCents, 0);
    assert.equal(yao["2026-09"].lines.collected[0].collectedAtMs,
        Date.parse("2026-10-13T15:00:00Z"));
  });

  it("bills paid, handovers and paid back land in their months", () => {
    const months = staffBalanceMonths({now: new Date("2026-11-02T18:00:00Z"),
      sources: {}, staffNames: {yao: "Yao", al: "Al"},
      handovers: [
        {id: "h1", fromStaffId: "yao", toId: "al", amountCents: 1000,
          status: "confirmed", createdAtMs: Date.parse("2026-10-05T12:00:00Z")},
        {id: "h2", fromStaffId: "yao", toId: "al", amountCents: 999,
          status: "pending", createdAtMs: Date.parse("2026-10-06T12:00:00Z")},
      ],
      netting: {
        entries: [
          {id: "r", lineId: "rent", month: "2026-09", amountCents: 850000,
            paidByStaffId: "yao"},
          {id: "b", lineId: "x", month: "2026-10", amountCents: 500,
            paidByStaffId: "business_account"},
          {id: "s", lineId: "rent", month: "2026-10", amountCents: 850000,
            paidByStaffId: "yao", standing: true},
        ],
        repayments: [{id: "p", staffId: "yao", month: "2026-11",
          amountCents: 20000}],
        links: {},
        lines: [{id: "rent", label: "Rent"}],
      }});
    const yao = Object.fromEntries(months.yao.map((m) => [m.monthKey, m]));
    assert.equal(yao["2026-09"].expensesPaidCents, 850000);
    assert.equal(yao["2026-09"].lines.expenses[0].label, "Rent");
    assert.equal(yao["2026-10"].expensesPaidCents, 850000);
    assert.equal(yao["2026-10"].lines.expenses[0].standing, true);
    assert.equal(yao["2026-10"].handedOutCents, 1000, "pending stays out");
    assert.equal(yao["2026-11"].paidBackCents, 20000);
    assert.equal(yao["2026-11"].runningNetCents, -850000 - 1000 - 850000 +
      20000);
    const al = Object.fromEntries(months.al.map((m) => [m.monthKey, m]));
    assert.equal(al["2026-10"].receivedFromOthersCents, 1000);
    assert.equal(al["2026-10"].lines.handovers[0].otherName, "Yao");
  });
});

describe("card payments online are nobody's cash", () => {
  const {collectReceipts} = require("../staff_balances");
  it("a stay Stripe settled is not held by its old 'received by'", () => {
    const base = {parkingDate: "2026-10-22T12:00:00Z",
      parkingEndDate: "2026-10-26T12:00:00Z", amountDueCents: 4800,
      paymentStatus: "succeeded", paymentMethod: "direct",
      receivedByStaffId: "yao"};
    const online = {...base, id: "a",
      stripeReconciledAt: "2026-10-26T17:57:02Z"};
    const byHand = {...base, id: "b", directPaymentReceived: true,
      stripeReconciledAt: "2026-10-26T17:57:02Z"};
    const plain = {...base, id: "c"};
    const now = new Date("2026-11-02T18:00:00Z");
    const ids = collectReceipts({parkedCars: [online, byHand, plain]}, now,
        {parking: true}).map((r) => r.id).sort();
    assert.deepEqual(ids, ["b", "c"]);
  });
});

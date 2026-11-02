"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const credit = require("../staff_expense_credit");
const fixture = require("./fixtures/staff-expense-credit-cases.json");

const pick = (c) => ({
  key: c.key,
  dueBeforeExpensesCents: c.dueBeforeExpensesCents,
  expenseCreditCents: c.expenseCreditCents,
  dueCents: c.dueCents,
  linkedStaffIds: c.linkedStaffIds,
});

describe("staff expenses netted against parking (shared fixture)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const out = credit.netStaffExpenses(c.customers, c);
      assert.deepEqual(out.customers.map(pick), c.expect.customers);
      assert.deepEqual(out.businessOwes, c.expect.businessOwes);
      assert.equal(out.businessOwesCents, c.expect.businessOwesCents);
      assert.equal(out.expenseCreditCents, c.expect.expenseCreditCents);
    });
  }
  for (const c of fixture.bills) {
    it(`bill lines: ${c.name}`, () => {
      const net = credit.netStaffExpenses(c.customers, c).customers[0];
      const lines = credit.monthExpenseLines(c.entries, c.monthKey,
          net.linkedStaffIds, credit.expenseLineLabels(c.lines));
      assert.deepEqual(lines.map((l) => ({id: l.id, label: l.label,
        amountCents: l.amountCents})), c.expect.lines);
      const listed = lines.reduce((s, l) => s + l.amountCents, 0);
      assert.equal(listed, c.expect.linesCents);
      assert.equal(net.expenseCreditCents, c.expect.expenseCreditCents);
      assert.equal(net.dueCents, c.expect.dueCents);
      const earlier = credit.earlierExpenseCents(net.expenseCreditCents,
          lines);
      assert.equal(earlier, c.expect.earlierExpenseCents);
      if (listed <= net.expenseCreditCents) {
        assert.equal(listed + earlier, net.expenseCreditCents,
            "the lines add up to Less expenses");
      }
    });
  }
  for (const [i, c] of fixture.itemsAfterCredit.entries()) {
    it(`Mark all paid pays only what the credit leaves (${i + 1})`, () => {
      assert.deepEqual(credit.itemsAfterCredit(c.items, c.creditCents),
          c.expect);
    });
  }
});

describe("staffCredits", () => {
  it("ignores bad months, voided rows and later months", () => {
    const out = credit.staffCredits([
      {paidByStaffId: "a", amountCents: 100, month: "2026-10"},
      {paidByStaffId: "a", amountCents: 100, month: "bad"},
      {paidByStaffId: "", amountCents: 100, month: "2026-10"},
      {paidByStaffId: "a", amountCents: -50, month: "2026-10"},
    ], [], "2026-10");
    assert.deepEqual(out, {a: {expensesCents: 100, repaidCents: 0,
      creditCents: 100}});
    assert.deepEqual(credit.staffCredits([], [], "nope"), {});
  });

  it("never lets paid back push the credit below zero", () => {
    const out = credit.staffCredits(
        [{paidByStaffId: "a", amountCents: 100, month: "2026-10"}],
        [{staffId: "a", amountCents: 500, month: "2026-10"}], "2026-10");
    assert.equal(out.a.creditCents, 0);
  });
});

describe("monthExpenseLines", () => {
  it("lists this month's entries of the linked staff, oldest first", () => {
    const lines = credit.monthExpenseLines([
      {id: "b", paidByStaffId: "a", amountCents: 200, month: "2026-10",
        spentAtMs: 20},
      {id: "a", paidByStaffId: "a", amountCents: 100, month: "2026-10",
        spentAtMs: 10, note: "Battery"},
      {id: "c", paidByStaffId: "a", amountCents: 100, month: "2026-09"},
      {id: "d", paidByStaffId: "z", amountCents: 100, month: "2026-10"},
      {id: "e", paidByStaffId: "a", amountCents: 100, month: "2026-10",
        voided: true},
    ], "2026-10", ["a"]);
    assert.deepEqual(lines.map((l) => l.id), ["a", "b"]);
    assert.equal(lines[0].note, "Battery");
  });
});

describe("standing payers on monthly lines (EXPENSE_PAID_BY.md)", () => {
  const pickStanding = (e) => ({id: e.id, lineId: e.lineId, month: e.month,
    amountCents: e.amountCents, paidByStaffId: e.paidByStaffId});
  for (const c of fixture.standing) {
    it(c.name, () => {
      const out = credit.standingPayerEntries(c.lines, c.entries, c.nowMonth);
      assert.deepEqual(out.map(pickStanding), c.expect);
      assert.ok(out.every((e) => e.standing === true && e.note === ""));
    });
  }
  it("withStandingPayers keeps the real entries first", () => {
    const real = [{id: "x", lineId: "other", month: "2026-10",
      paidByStaffId: "a", amountCents: 5}];
    const out = credit.withStandingPayers(real, fixture.standing[0].lines,
        "2026-10");
    assert.equal(out[0], real[0]);
    assert.deepEqual(out.map((e) => e.id), ["x", "standing:rent:2026-10"]);
  });
  it("linePayerFor picks the latest start on or before the month", () => {
    const line = {payers: [{fromMonth: "2026-10", staffId: "yao"},
      {fromMonth: "2026-12", staffId: "business_account"}]};
    assert.equal(credit.linePayerFor(line, "2026-09"), "");
    assert.equal(credit.linePayerFor(line, "2026-11"), "yao");
    assert.equal(credit.linePayerFor(line, "2026-12"), "");
  });
  it("standing rent counts as Yao's credit in the netting", () => {
    const entries = credit.withStandingPayers([],
        fixture.standing[0].lines, "2026-11");
    const out = credit.staffCredits(entries, [], "2026-10");
    assert.equal(out.yao.creditCents, 850000);
  });
});

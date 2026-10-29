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

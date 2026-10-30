// The shared fixture (docs/STAFF_EXPENSE_CREDIT.md §3): the server, the
// console and the app run every case, so the three agree to the cent.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import {
  earlierExpenseCents,
  expenseLabel,
  expenseLineLabels,
  itemsAfterCredit,
  monthExpenseLines,
  netStaffExpenses,
  splitByCredit,
  staffByCustomer,
  staffCredits,
} from "./staff-expense-credit.ts";

const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/staff-expense-credit-cases.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
  cases: {
    name: string;
    monthKey: string;
    customers: { key: string; dueCents: number }[];
    entries: Record<string, unknown>[];
    repayments: Record<string, unknown>[];
    links: Record<string, { customerKey: string }>;
    staffNames: Record<string, string>;
    expect: {
      customers: Record<string, unknown>[];
      businessOwes: Record<string, unknown>[];
      businessOwesCents: number;
      expenseCreditCents: number;
    };
  }[];
  itemsAfterCredit: { items: { id: string; amountCents: number }[]; creditCents: number; expect: unknown[] }[];
  bills: {
    name: string;
    monthKey: string;
    customers: { key: string; dueCents: number }[];
    lines: Record<string, unknown>[];
    entries: Record<string, unknown>[];
    repayments: Record<string, unknown>[];
    links: Record<string, { customerKey: string }>;
    staffNames: Record<string, string>;
    expect: {
      lines: { id: string; label: string; amountCents: number }[];
      linesCents: number;
      expenseCreditCents: number;
      earlierExpenseCents: number;
      dueCents: number;
    };
  }[];
};

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const server = require("../../../my_flutter_app/functions/staff_expense_credit.js");

test("the fixture has cases to run", () => {
  assert.ok(fixture.cases.length >= 5);
  assert.ok(fixture.itemsAfterCredit.length >= 3);
});

for (const c of fixture.cases) {
  test(`fixture: ${c.name}`, () => {
    const out = netStaffExpenses(c.customers, {
      entries: c.entries,
      repayments: c.repayments,
      links: c.links,
      monthKey: c.monthKey,
      staffNames: c.staffNames,
    });
    assert.equal(out.customers.length, c.expect.customers.length);
    c.expect.customers.forEach((want, i) => {
      for (const [k, v] of Object.entries(want)) {
        assert.deepEqual((out.customers[i] as Record<string, unknown>)[k], v, `${c.name}: customer ${i} ${k}`);
      }
    });
    assert.deepEqual(out.businessOwes, c.expect.businessOwes);
    assert.equal(out.businessOwesCents, c.expect.businessOwesCents);
    assert.equal(out.expenseCreditCents, c.expect.expenseCreditCents);
    // And the server's own module gives the very same answer.
    assert.deepEqual(
      JSON.parse(JSON.stringify(out)),
      JSON.parse(JSON.stringify(server.netStaffExpenses(c.customers, {
        entries: c.entries, repayments: c.repayments, links: c.links, monthKey: c.monthKey, staffNames: c.staffNames,
      }))),
    );
  });
}

for (const c of fixture.bills) {
  test(`fixture bill lines: ${c.name}`, () => {
    const net = netStaffExpenses(c.customers, c).customers[0];
    const labels = expenseLineLabels(c.lines);
    const lines = monthExpenseLines(c.entries, c.monthKey, net.linkedStaffIds, labels);
    assert.deepEqual(lines.map((l) => ({ id: l.id, label: l.label, amountCents: l.amountCents })), c.expect.lines);
    const listed = lines.reduce((s, l) => s + l.amountCents, 0);
    assert.equal(listed, c.expect.linesCents);
    assert.equal(net.expenseCreditCents, c.expect.expenseCreditCents);
    assert.equal(net.dueCents, c.expect.dueCents);
    const earlier = earlierExpenseCents(net.expenseCreditCents, lines);
    assert.equal(earlier, c.expect.earlierExpenseCents);
    if (listed <= net.expenseCreditCents) assert.equal(listed + earlier, net.expenseCreditCents, "the lines add up to Less expenses");
    // The server's module agrees, field for field.
    assert.deepEqual(lines, server.monthExpenseLines(c.entries, c.monthKey, net.linkedStaffIds, server.expenseLineLabels(c.lines)));
    assert.equal(earlier, server.earlierExpenseCents(net.expenseCreditCents, lines));
  });
}

test("an expense reads as its line's name, then its note", () => {
  assert.equal(expenseLabel("grosseries", "tissu, cups"), "grosseries · tissu, cups");
  assert.equal(expenseLabel("grosseries", ""), "grosseries");
  assert.equal(expenseLabel("", " tissu "), "tissu");
  assert.equal(expenseLabel("Grosseries", "grosseries"), "Grosseries");
  assert.equal(expenseLabel(null, undefined), "");
  for (const [a, b] of [["x", "y"], ["", ""], ["A", "a"]]) assert.equal(expenseLabel(a, b), server.expenseLabel(a, b));
});

fixture.itemsAfterCredit.forEach((c, i) => {
  test(`fixture: items after credit #${i + 1}`, () => {
    assert.deepEqual(itemsAfterCredit(c.items, c.creditCents), c.expect);
    assert.deepEqual(itemsAfterCredit(c.items, c.creditCents), server.itemsAfterCredit(c.items, c.creditCents));
  });
});

test("the smaller pieces match the server's", () => {
  const entries = [
    { id: "b", paidByStaffId: "s1", amountCents: 500, month: "2026-10", note: " Bulbs ", spentAtMs: 20 },
    { id: "a", paidByStaffId: "s1", amountCents: 700, month: "2026-10", spentAtMs: 10 },
    { id: "c", paidByStaffId: "s2", amountCents: 900, month: "2026-10", spentAtMs: 5 },
    { id: "d", paidByStaffId: "s1", amountCents: 900, month: "2026-09", spentAtMs: 1 },
    { id: "e", paidByStaffId: "s1", amountCents: 900, month: "2026-10", voided: true },
  ];
  const lines = monthExpenseLines(entries, "2026-10", ["s1"]);
  assert.deepEqual(lines.map((l) => l.id), ["a", "b"]);
  assert.equal(lines[1].note, "Bulbs");
  assert.deepEqual(lines, server.monthExpenseLines(entries, "2026-10", ["s1"]));
  assert.deepEqual(staffCredits(entries, [], "2026-10"), server.staffCredits(entries, [], "2026-10"));
  assert.deepEqual(staffCredits(entries, [], "nope"), {});
  const links = { z: { customerKey: "k" }, a: { customerKey: "k" }, x: { customerKey: "" } };
  assert.deepEqual(staffByCustomer(links), { k: ["a", "z"] });
  assert.deepEqual(staffByCustomer(links), server.staffByCustomer(links));
  const credits = { a: { expensesCents: 1, repaidCents: 0, creditCents: 1 }, b: { expensesCents: 2, repaidCents: 0, creditCents: 2 } };
  assert.deepEqual(splitByCredit(100, ["a", "b"], credits), { a: 34, b: 66 });
  assert.deepEqual(splitByCredit(100, ["a", "b"], credits), server.splitByCredit(100, ["a", "b"], credits));
});

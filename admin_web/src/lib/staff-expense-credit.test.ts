// The shared fixture (docs/STAFF_EXPENSE_CREDIT.md §3): the server, the
// console and the app run every case, so the three agree to the cent.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import {
  BUSINESS_PAYER,
  earlierExpenseCents,
  expenseLabel,
  expenseLineLabels,
  itemsAfterCredit,
  linePayerEntryFor,
  linePayerFor,
  monthExpenseLines,
  netStaffExpenses,
  splitByCredit,
  staffByCustomer,
  staffCredits,
  standingPayerEntries,
  withStandingPayers,
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
  standing: {
    name: string;
    nowMonth: string;
    lines: Record<string, unknown>[];
    entries: Record<string, unknown>[];
    expect: { id: string; lineId: string; month: string; amountCents: number; paidByStaffId: string }[];
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

const pick = (rows: Record<string, unknown>[]) =>
  rows.map((e) => ({ id: e.id, lineId: e.lineId, month: e.month, amountCents: e.amountCents, paidByStaffId: e.paidByStaffId }));

test("the fixture has standing-payer cases", () => {
  assert.ok(fixture.standing.length >= 5);
});

for (const c of fixture.standing) {
  test(`fixture standing payers: ${c.name}`, () => {
    const out = standingPayerEntries(c.lines, c.entries, c.nowMonth);
    assert.deepEqual(pick(out), c.expect);
    // The server's module gives the very same entries, field for field.
    assert.deepEqual(out, server.standingPayerEntries(c.lines, c.entries, c.nowMonth));
    assert.deepEqual(
      withStandingPayers(c.entries, c.lines, c.nowMonth),
      server.withStandingPayers(c.entries, c.lines, c.nowMonth),
    );
    assert.equal(withStandingPayers(c.entries, c.lines, c.nowMonth).length, c.entries.length + c.expect.length);
  });
}

test("a monthly line's payer is the latest entry that has started", () => {
  const line = {
    payers: [
      { fromMonth: "2026-10", staffId: "yao" },
      { fromMonth: "2026-12", staffId: BUSINESS_PAYER },
      { fromMonth: "2026-08", staffId: "ada" },
    ],
  };
  assert.equal(linePayerFor(line, "2026-07"), "");
  assert.equal(linePayerFor(line, "2026-09"), "ada");
  assert.equal(linePayerFor(line, "2026-11"), "yao");
  assert.equal(linePayerFor(line, "2027-01"), "");
  assert.deepEqual(linePayerEntryFor(line, "2026-11"), { fromMonth: "2026-10", staffId: "yao" });
  assert.equal(linePayerEntryFor(line, "2027-01"), null);
  assert.equal(linePayerEntryFor({}, "2026-11"), null);
  for (const m of ["2026-07", "2026-09", "2026-11", "2027-01"]) {
    assert.equal(linePayerFor(line, m), server.linePayerFor(line, m));
  }
  assert.equal(BUSINESS_PAYER, server.BUSINESS_PAYER);
});

test("the business is nobody's credit and never on a bill", () => {
  const entries = [
    { id: "a", paidByStaffId: BUSINESS_PAYER, amountCents: 900, month: "2026-10", spentAtMs: 1 },
    { id: "b", paidByStaffId: "s1", amountCents: 100, month: "2026-10", spentAtMs: 2 },
  ];
  assert.deepEqual(Object.keys(staffCredits(entries, [], "2026-10")), ["s1"]);
  assert.deepEqual(monthExpenseLines(entries, "2026-10", [BUSINESS_PAYER, "s1"]).map((l) => l.id), ["b"]);
  assert.deepEqual(monthExpenseLines(entries, "2026-10", [BUSINESS_PAYER]), []);
  assert.deepEqual(monthExpenseLines(entries, "2026-10", [BUSINESS_PAYER, "s1"]),
    server.monthExpenseLines(entries, "2026-10", [BUSINESS_PAYER, "s1"]));
});

test("linePayerEntryFor: 'since' is where the same person's run began", async () => {
  const { linePayerEntryFor } = await import("./staff-expense-credit.ts");
  const line = { payers: [
    { fromMonth: "2026-09", staffId: "yao" },
    { fromMonth: "2026-10", staffId: "yao" },
    { fromMonth: "2026-11", staffId: "business_account" },
    { fromMonth: "2027-01", staffId: "yao" },
  ] };
  assert.deepEqual(linePayerEntryFor(line, "2026-10"), { fromMonth: "2026-09", staffId: "yao" });
  assert.equal(linePayerEntryFor(line, "2026-11"), null);
  assert.deepEqual(linePayerEntryFor(line, "2027-02"), { fromMonth: "2027-01", staffId: "yao" });
});

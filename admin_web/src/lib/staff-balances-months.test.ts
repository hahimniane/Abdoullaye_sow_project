// Staff balances, month by month (docs/STAFF_BALANCES_MONTHLY.md): the
// console's reading of the server's `months`, the wording of the running
// total, the table's view, the corrected "Expenses they paid" total, and the
// French of every new string.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import {
  balanceMonthFrom,
  balanceMonthLabel,
  defaultOpenMonthKey,
  expensesPaidTotalCents,
  monthHandedNetCents,
  monthTableView,
  runningPhrase,
  staffBalancesFrom,
} from "./staff-balances.ts";

const emptyLines = { collected: [], expenses: [], handovers: [], parking: [], paidBack: [] };
const month = (monthKey: string, over: Record<string, unknown> = {}) => ({
  monthKey, collectedCents: 0, handedOutCents: 0, receivedFromOthersCents: 0, ownParkingCents: 0,
  expensesPaidCents: 0, paidBackCents: 0, monthNetCents: 0, runningNetCents: 0, lines: emptyLines, ...over,
});

// Yao, from the owner's real example.
const YAO = {
  staffId: "yao", name: "Yao", collectedCents: 1_035_100, collectedByMethod: {}, handedOutCents: 0,
  receivedFromOthersCents: 0, pendingOutCents: 0, pendingInCents: 0, heldCents: 0, parkingDueCents: 0,
  expenseCreditCents: 100_000, expenseOwedToThemCents: 891_734, netCents: -891_734,
  months: [
    month("2026-11", {
      collectedCents: 3600, ownParkingCents: 2400, monthNetCents: 6000, runningNetCents: -891_734,
    }),
    month("2026-09", {
      collectedCents: 838_000, ownParkingCents: 38_400, expensesPaidCents: 1_111_519, monthNetCents: -235_119, runningNetCents: -235_119,
    }),
    month("2026-10", {
      collectedCents: 193_500, ownParkingCents: 59_800, expensesPaidCents: 915_915, monthNetCents: -662_615, runningNetCents: -897_734,
      lines: {
        collected: [{
          source: "parking", id: "p1", label: "Parking", customerName: "Dia Motors", vehicle: "2019 Camry", code: "A12",
          amountCents: 50_000, collectedAtMs: 1_792_000_000_000, method: "zelle",
        }],
        expenses: [{ id: "e1", label: "Gate repair", amountCents: 915_915, standing: true }],
        handovers: [{ id: "h1", direction: "in", otherName: "Abdoulaye", amountCents: 1000, atMs: 1_792_000_000_000 }],
        parking: [{ customerKey: "staff:yao", label: "Yao", amountCents: 59_800 }],
        paidBack: [],
      },
    }),
  ],
};

const yao = staffBalancesFrom({ staff: [YAO] }).staff[0];

test("months are read, oldest first, with their lines", () => {
  assert.deepEqual(yao.months?.map((m) => m.monthKey), ["2026-09", "2026-10", "2026-11"]);
  const oct = yao.months![1];
  assert.equal(oct.lines.collected[0].customerName, "Dia Motors");
  assert.equal(oct.lines.collected[0].collectedAtMs, 1_792_000_000_000);
  assert.equal(oct.lines.expenses[0].standing, true);
  assert.equal(oct.lines.handovers[0].direction, "in");
  assert.equal(oct.monthNetCents, -662_615);
});

test("signed cents survive, odd months are dropped, and an old answer has no months", () => {
  assert.equal(balanceMonthFrom({ monthNetCents: -5, runningNetCents: "-7" }).runningNetCents, -7);
  const odd = staffBalancesFrom({ staff: [{ staffId: "a", months: [null, {}, { monthKey: "2026-02" }, 5] }] }).staff[0];
  assert.deepEqual(odd.months?.map((m) => m.monthKey), ["2026-02"]);
  assert.equal(odd.months?.[0].lines.collected.length, 0);
  const old = staffBalancesFrom({ staff: [{ staffId: "a", name: "A" }] }).staff[0];
  assert.equal(old.months, undefined);
  assert.equal(monthTableView(old.months).rows.length, 0);
});

test("the running total reads Owes / Business owes / Settled", () => {
  assert.deepEqual(runningPhrase(6000), { tone: "owes", label: "Owes", cents: 6000 });
  assert.deepEqual(runningPhrase(-897_734), { tone: "owed", label: "Business owes", cents: 897_734 });
  assert.deepEqual(runningPhrase(0), { tone: "even", label: "Settled up", cents: 0 });
});

test("month labels are 'September 2026' in English and French", () => {
  assert.equal(balanceMonthLabel("2026-09", "en"), "September 2026");
  assert.equal(balanceMonthLabel("2026-09", "fr"), "septembre 2026");
});

test("the table view: handed-over column only when any month has one, handed = out minus in", () => {
  assert.equal(monthHandedNetCents(month("2026-10", { handedOutCents: 500, receivedFromOthersCents: 200 }) as never), 300);
  const none = monthTableView(yao.months, "en");
  assert.equal(none.showHandedOver, false);
  assert.deepEqual(none.rows.map((r) => r.label), ["September 2026", "October 2026", "November 2026"]);
  assert.equal(none.rows[2].running.tone, "owed");
  assert.equal(none.rows[1].lineCount, 4);
  const withHandover = monthTableView([balanceMonthFrom(month("2026-10", { handedOutCents: 100 }))], "en");
  assert.equal(withHandover.showHandedOver, true);
  assert.equal(withHandover.rows[0].handedNetCents, 100);
});

test("the latest month starts open", () => {
  assert.equal(defaultOpenMonthKey(yao.months), "2026-11");
  assert.equal(defaultOpenMonthKey([]), "");
  assert.equal(defaultOpenMonthKey(undefined), "");
});

test("'Expenses they paid for the lot' is the real total, not only the part used for parking", () => {
  assert.equal(expensesPaidTotalCents(yao), 1_111_519 + 915_915);
  const old = staffBalancesFrom({ staff: [{ staffId: "a", expenseCreditCents: 30000, expenseOwedToThemCents: 20000 }] }).staff[0];
  assert.equal(expensesPaidTotalCents(old), 50000);
  const panel = readFileSync(join("src", "components", "business", "staff-balances-panel.tsx"), "utf8");
  assert.ok(panel.includes("moneyText(expensesPaidTotalCents(row))"));
  assert.ok(panel.includes("Used for their own parking"));
});

test("every new string has a French entry", () => {
  const strings = [
    "Month by month", "Month", "Collected", "Bills paid", "Own parking", "Handed over", "That month", "Running total",
    "Owes", "Business owes", "Settled up", "Used for their own parking", "collected", "monthly", "Handed to",
    "Received from", "Paid back to them", "Nothing recorded this month.",
    "Money counts in the month its bill was for. A positive total is what they owe the business.",
  ];
  assert.deepEqual(strings.filter((s) => !(s in TEXT_TRANSLATIONS)), []);
  assert.equal(translateValue("Month by month", "fr"), "Mois par mois");
  assert.equal(translateValue("Business owes", "fr"), "L’entreprise doit");
  assert.equal(translateValue("Settled up", "fr"), "À jour");
});

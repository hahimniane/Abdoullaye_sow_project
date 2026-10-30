// Month end's "Business owes" counts the cash each person holds for the
// business (owner, 2026-10-30): someone who collected more than they are owed
// "holds $X for the business" instead of being owed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TEXT_TRANSLATIONS } from "./french-dom.ts";
import { businessOwesWithCash, type StaffBalanceRow } from "./staff-balances.ts";

const row = (staffId: string, heldCents: number, netCents: number): StaffBalanceRow => ({
  staffId, name: staffId, collectedCents: heldCents, collectedByMethod: {}, handedOutCents: 0,
  receivedFromOthersCents: 0, pendingOutCents: 0, pendingInCents: 0, heldCents, parkingDueCents: 0,
  expenseCreditCents: 0, expenseOwedToThemCents: 0, netCents,
});
const line = (staffId: string, owedCents: number) => ({ staffId, staffName: staffId, customerKey: `phone:${staffId}`, owedCents });

test("before the balances are known, a line reads as the expenses owed", () => {
  const out = businessOwesWithCash([line("kofi", 147704)], null);
  assert.deepEqual(out.lines[0], { staffId: "kofi", staffName: "kofi", customerKey: "phone:kofi", expenseOwedCents: 147704,
    heldCents: 0, netCents: null, owedNowCents: 147704, holdsCents: 0, canPayBack: true });
  assert.equal(out.owedNowCents, 147704);
  assert.equal(out.holdsCents, 0);
});

test("someone holding more cash than they are owed holds the difference for the business", () => {
  const out = businessOwesWithCash([line("kofi", 147704)], [row("kofi", 1023600, 932096)]);
  assert.equal(out.lines[0].heldCents, 1023600);
  assert.equal(out.lines[0].holdsCents, 932096);
  assert.equal(out.lines[0].owedNowCents, 0);
  assert.equal(out.lines[0].canPayBack, false);
  assert.deepEqual([out.owedNowCents, out.holdsCents], [0, 932096]);
});

test("someone holding less than they are owed is owed the difference, never more than the expenses", () => {
  const out = businessOwesWithCash([line("ama", 50000), line("ibou", 3500)], [row("ama", 20000, -30000), row("ibou", 0, -90000)]);
  assert.deepEqual(out.lines.map((l) => [l.owedNowCents, l.holdsCents, l.canPayBack]), [[30000, 0, true], [3500, 0, true]]);
  assert.equal(out.owedNowCents, 33500);
});

test("settled up, or no balance row at all", () => {
  const out = businessOwesWithCash([line("even", 1000), line("nobody", 2500)], [row("even", 1000, 0)]);
  assert.deepEqual(out.lines.map((l) => [l.owedNowCents, l.holdsCents, l.canPayBack, l.netCents]), [[0, 0, false, 0], [2500, 0, true, -2500]]);
});

test("Month end asks Staff balances, with a timeout, and shows the cash held", () => {
  const src = readFileSync(new URL("../components/business/business-owes-section.tsx", import.meta.url), "utf8");
  assert.match(src, /staffBalancesRequest\(businessId\)/);
  assert.match(src, /STAFF_BALANCES_TIMEOUT_MS/);
  assert.match(src, /businessOwesWithCash\(summary\.businessOwes, cashState === "ready" \? balances : null\)/);
  assert.match(src, /holds for the business/);
  assert.match(src, /canPayBack/);
});

test("the new words have their French", () => {
  const strings = [
    "Lot expenses staff paid out of their own pocket, after their parking bill and the business money they hold.",
    "holds for the business",
    "Expenses owed",
    "Holding",
    "Settled up",
    "Staff hold",
    "Cash held is as of today, from Staff balances.",
    "Checking the cash staff hold…",
    "The cash staff hold could not be checked; showing expenses only.",
  ];
  assert.deepEqual(strings.filter((s) => !TEXT_TRANSLATIONS[s]), []);
});

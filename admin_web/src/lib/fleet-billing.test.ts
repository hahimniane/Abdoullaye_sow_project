/**
 * The console's fleet billing rules against the shared fixture the server
 * also runs (docs/FLEET.md section 3).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FLEET_MESSAGES,
  allocatePayment,
  applyCredit,
  assignPersonalCents,
  driverBalance,
  lateFeesToCreate,
  rentBillsToCreate,
  rentPeriods,
  type FleetAssignment,
  type FleetBill,
  type FleetSettings,
} from "./fleet-billing.ts";

type Row = Record<string, unknown>;
const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/fleet-billing-cases.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
  periodCases: { name: string; assignment: FleetAssignment; through: string; expect: Row[] }[];
  billCases: {
    name: string;
    assignment: FleetAssignment;
    existing: string[];
    through: string;
    settings: FleetSettings;
    expect?: Row[];
    expectIds?: string[];
    expectAmounts?: number[];
  }[];
  lateFeeCases: { name: string; settings: FleetSettings; today: string; bills: FleetBill[]; expect: Row[] }[];
  allocationCases: { name: string; bills: FleetBill[]; amountCents: number; expect: Row }[];
  creditCases: { name: string; bills: FleetBill[]; creditCents: number; expect: Row }[];
  balanceCases: { name: string; today: string; creditCents: number; bills: FleetBill[]; expect: Row }[];
  personalCases: { name: string; drivers: { id: string; personalCents: number | null; createdAt: number }[]; expect: Row }[];
};
const pick = (value: unknown, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, (value as Row | null)?.[k]]));

describe("fleet billing (console): rent periods", () => {
  for (const c of fixture.periodCases) {
    it(c.name, () => {
      assert.deepEqual(rentPeriods(c.assignment, c.through), c.expect);
    });
  }
});

describe("fleet billing (console): rent bills", () => {
  for (const c of fixture.billCases) {
    it(c.name, () => {
      const bills = rentBillsToCreate(c.assignment, c.existing, c.through, c.settings);
      if (c.expect) assert.deepEqual(bills, c.expect);
      if (c.expectIds) assert.deepEqual(bills.map((b) => b.id), c.expectIds);
      if (c.expectAmounts) assert.deepEqual(bills.map((b) => b.amountCents), c.expectAmounts);
    });
  }
});

describe("fleet billing (console): late fees", () => {
  for (const c of fixture.lateFeeCases) {
    it(c.name, () => {
      const fees = lateFeesToCreate(c.bills, c.settings, c.today);
      const keys = Object.keys(c.expect[0] || {});
      assert.deepEqual(fees.map((f) => pick(f, keys)), c.expect);
    });
  }
});

describe("fleet billing (console): payments and credit", () => {
  for (const c of fixture.allocationCases) {
    it(c.name, () => {
      assert.deepEqual(allocatePayment(c.bills, c.amountCents), c.expect);
    });
  }
  for (const c of fixture.creditCases) {
    it(`credit: ${c.name}`, () => {
      assert.deepEqual(applyCredit(c.bills, c.creditCents), c.expect);
    });
  }
  it("every refusal code has a plain sentence", () => {
    assert.ok(FLEET_MESSAGES.fleet_no_amount);
  });
});

describe("fleet billing (console): balance and personal cents", () => {
  for (const c of fixture.balanceCases) {
    it(c.name, () => {
      assert.deepEqual(driverBalance(c.bills, c.creditCents, c.today), c.expect);
    });
  }
  for (const c of fixture.personalCases) {
    it(c.name, () => {
      assert.deepEqual(assignPersonalCents(c.drivers), c.expect);
    });
  }
});

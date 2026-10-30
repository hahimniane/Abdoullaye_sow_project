// What a parked car owes right now (docs/PARKING_WHATSAPP.md §2). The server,
// this console and the app run the same fixture, so the three agree to the
// cent: my_flutter_app/functions/test/fixtures/parking-balance-cases.json.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { parkingBalanceNow } from "./parking-balance.ts";

const NOW = new Date("2026-10-29T15:00:00Z");

test("an open stay runs up its daily rate for every day, the first and today both counted", () => {
  const b = parkingBalanceNow({ parkingDate: "2026-10-27T10:00:00Z", dailyRate: 12 }, NOW);
  assert.deepEqual(b, {
    dailyRateCents: 1200,
    sinceDayKey: "2026-10-27",
    leftDayKey: "",
    days: 3,
    accruedCents: 3600,
    paidCents: 0,
    balanceCents: 3600,
    paidInFull: false,
    stillParked: true,
  });
});

test("a part payment comes off the balance", () => {
  const b = parkingBalanceNow({ parkingDate: "2026-10-27", dailyRate: 12, amountPaidCents: 1200 }, NOW);
  assert.equal(b.paidCents, 1200);
  assert.equal(b.balanceCents, 2400);
  assert.equal(b.paidInFull, false);
});

test("a car paid up to today reads Paid in full, and one paid ahead never owes below zero", () => {
  const exact = parkingBalanceNow({ parkingDate: "2026-10-27", dailyRate: 12, amountPaidCents: 3600 }, NOW);
  assert.equal(exact.balanceCents, 0);
  assert.equal(exact.paidInFull, true);
  const ahead = parkingBalanceNow({ parkingDate: "2026-10-27", dailyRate: 12, amountPaidCents: 9000 }, NOW);
  assert.equal(ahead.balanceCents, 0);
  assert.equal(ahead.paidInFull, true);
});

test("tomorrow the same car owes one more day", () => {
  const car = { parkingDate: "2026-10-27", dailyRate: 12, amountPaidCents: 3600 };
  const next = parkingBalanceNow(car, new Date("2026-10-30T01:00:00Z"));
  assert.equal(next.balanceCents, 1200);
  assert.equal(next.paidInFull, false);
});

test("a car that has left owes its total, however long ago it left", () => {
  const car = {
    parkingDate: "2026-10-20",
    parkingEndDate: "2026-10-21",
    dailyRate: 10,
    amountDueCents: 5000,
  };
  const b = parkingBalanceNow(car, NOW);
  assert.equal(b.stillParked, false);
  assert.equal(b.leftDayKey, "2026-10-21");
  assert.equal(b.days, 2);
  assert.equal(b.accruedCents, 5000);
  assert.equal(b.balanceCents, 5000);
  assert.equal(parkingBalanceNow({ ...car, amountPaidCents: 5000 }, NOW).paidInFull, true);
});

test("a record settled as paid with no running total counts as paid up to its accrual", () => {
  const b = parkingBalanceNow({ parkingDate: "2026-10-27", dailyRate: 12, paymentStatus: "paid" }, NOW);
  assert.equal(b.paidCents, 3600);
  assert.equal(b.balanceCents, 0);
});

test("a stay with no rate has nothing to pay and is not 'paid in full'", () => {
  const b = parkingBalanceNow({ parkingDate: "2026-10-27" }, NOW);
  assert.equal(b.accruedCents, 0);
  assert.equal(b.balanceCents, 0);
  assert.equal(b.paidInFull, false);
});

test("a car parked later today counts one day; a missing date counts none", () => {
  assert.equal(parkingBalanceNow({ parkingDate: "2026-10-29", dailyRate: 8 }, NOW).days, 1);
  const none = parkingBalanceNow({ dailyRate: 8 }, NOW);
  assert.equal(none.days, 0);
  assert.equal(none.accruedCents, 0);
  assert.equal(none.sinceDayKey, "");
});

// ---------------------------------------------------------------------------
// The shared fixture. It is written by the server side; until it is on this
// branch the cases above carry the contract (the test says so, it does not
// pass silently).
// ---------------------------------------------------------------------------

const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/parking-balance-cases.json", import.meta.url);

type FixtureCase = Record<string, unknown>;

function fixtureCases(): FixtureCase[] {
  const raw = JSON.parse(readFileSync(fixtureUrl, "utf8")) as unknown;
  const list = Array.isArray(raw) ? raw : ((raw as { cases?: unknown }).cases ?? []);
  return list as FixtureCase[];
}

function nowOf(value: unknown): Date {
  if (typeof value === "number") return new Date(value);
  return new Date(String(value));
}

test("the shared parking-balance fixture gives the same answers", { skip: !existsSync(fixtureUrl) && "fixture not on this branch yet" }, () => {
  const cases = fixtureCases();
  assert.ok(cases.length > 0, "the fixture has cases");
  for (const c of cases) {
    const input = (c.input ?? {}) as Record<string, unknown>;
    const car = (c.car ?? c.row ?? c.entry ?? input.car ?? input.row) as Record<string, unknown>;
    const now = nowOf(c.now ?? c.nowMs ?? c.today ?? input.now ?? input.nowMs);
    const expected = (c.expect ?? c.expected ?? c.result) as Record<string, unknown>;
    assert.ok(car && expected, `${String(c.name)}: car and expected are present`);
    const got = parkingBalanceNow(car, now) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(got[key], value, `${String(c.name)}: ${key}`);
    }
  }
});

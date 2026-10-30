import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parkingBalanceNow } from "./parking-balance.ts";

// The server's parkingBalanceNow (my_flutter_app/functions/
// parking_month_statement.js) is the rule; this fixture pins the server, the
// console and the app to the same answers (docs/PARKING_WHATSAPP.md §2).
const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/parking-balance-cases.json", import.meta.url);
type FixtureCase = { name: string; car: Record<string, unknown>; now?: string; expected: Record<string, unknown> | null };
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as { now: string; cases: FixtureCase[] };

test("every shared parking-balance case gives the server's answer", () => {
  assert.ok(fixture.cases.length >= 10, "the fixture has its cases");
  for (const c of fixture.cases) {
    const got = parkingBalanceNow(c.car, new Date(c.now ?? fixture.now));
    assert.deepEqual(got, c.expected, c.name);
  }
});

test("the console mirror keeps the server's shape and rule names", () => {
  const source = readFileSync(new URL("./parking-balance.ts", import.meta.url), "utf8");
  for (const name of ["paidNowCents", "recordedPaidCents", "paymentCents", "accruedThroughCents"]) {
    assert.match(source, new RegExp(`\\b${name}\\b`), name);
  }
  assert.match(source, /leftDayKey: leave === null \? null : dayKeyOf\(leave\)/);
  assert.match(source, /stillParked: leave === null \|\| leave >= today/);
});

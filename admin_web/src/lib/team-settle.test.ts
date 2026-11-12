import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SETTLE_MESSAGES,
  defaultSettleCents,
  mayAnswerSettlement,
  paybackRefusal,
  settlementRecords,
  teamSettlePlan,
  teamSettleRefusalText,
} from "./team-settle.ts";

// "I paid everything" (docs/TEAM_SETTLE.md). The server's team_settle.js is
// the rule; the shared fixture pins both to the same answers.
const fixture = JSON.parse(
  readFileSync(new URL("../../../my_flutter_app/functions/test/fixtures/team-settle-cases.json", import.meta.url), "utf8"),
) as {
  plans: { name: string; statement: never; cashHeldCents?: number; parkingDueCents?: number; amountCents: number; scope: string; expected: unknown }[];
  defaults: { name: string; statement: never; expected: number }[];
  paybacks: { name: string; owesCents: number; amountCents: number; method: string; expected: string }[];
};

test("every shared split gives the server's answer", () => {
  for (const c of fixture.plans) {
    assert.deepEqual(
      teamSettlePlan({ statement: c.statement, cashHeldCents: c.cashHeldCents, parkingDueCents: c.parkingDueCents, amountCents: c.amountCents, scope: c.scope }),
      c.expected,
      c.name,
    );
  }
});

test("every shared default is the statement's number", () => {
  for (const c of fixture.defaults) assert.equal(defaultSettleCents(c.statement), c.expected, c.name);
});

test("every shared pay-back gives the server's answer", () => {
  for (const c of fixture.paybacks) assert.equal(paybackRefusal(c), c.expected, c.name);
});

test("a refusal reads in plain words, never the raw text", () => {
  assert.equal(teamSettleRefusalText({ details: { reason: "team_settle_not_own" } }), SETTLE_MESSAGES.team_settle_not_own);
  assert.match(teamSettleRefusalText({ code: "functions/permission-denied", message: "internal detail" }), /not allowed/);
  assert.doesNotMatch(teamSettleRefusalText({ message: "boom" }), /boom/);
});

test("settlements are read oldest first and odd rows are left out", () => {
  const rows = settlementRecords([
    { id: "b", status: "confirmed", requestedAtMs: 2, amountCents: 100 },
    { id: "a", status: "pending", requestedAtMs: 1, amountCents: 50 },
    { id: "x", status: "weird" },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b"]);
});

test("only the named receiver in a receiver role answers a pending one", () => {
  const pending = settlementRecords([{ id: "a", status: "pending", receiverId: "owner" }])[0];
  assert.equal(mayAnswerSettlement(pending, { uid: "owner", isReceiver: true }), true);
  assert.equal(mayAnswerSettlement(pending, { uid: "other", isReceiver: true }), false);
  assert.equal(mayAnswerSettlement(pending, { uid: "owner", isReceiver: false }), false);
  const account = settlementRecords([{ id: "b", status: "pending", receiverId: "business_account" }])[0];
  assert.equal(mayAnswerSettlement(account, { uid: "anyone", isReceiver: true }), true);
  const done = settlementRecords([{ id: "c", status: "confirmed", receiverId: "owner" }])[0];
  assert.equal(mayAnswerSettlement(done, { uid: "owner", isReceiver: true }), false);
});

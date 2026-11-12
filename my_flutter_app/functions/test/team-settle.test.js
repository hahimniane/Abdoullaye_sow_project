"use strict";

// "I paid everything" (docs/TEAM_SETTLE.md): how one amount is split for the
// scope the payer chose, and who may do what. Pure: no Firestore.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const settle = require("../team_settle");

const FIXTURE = require("./fixtures/team-settle-cases.json");

describe("splitting a settlement (the shared fixture)", () => {
  for (const c of FIXTURE.plans) {
    it(c.name, () => {
      assert.deepEqual(settle.teamSettlePlan({
        statement: c.statement, amountCents: c.amountCents, scope: c.scope,
        cashHeldCents: c.cashHeldCents, parkingDueCents: c.parkingDueCents,
      }), c.expected);
    });
  }
});

describe("the default amount (the shared fixture)", () => {
  for (const c of FIXTURE.defaults) {
    it(c.name, () => {
      assert.equal(settle.defaultSettleCents(c.statement), c.expected);
    });
  }
});

describe("paying a team member back (the shared fixture)", () => {
  for (const c of FIXTURE.paybacks) {
    it(c.name, () => {
      assert.equal(settle.paybackRefusal(c), c.expected);
    });
  }
});

describe("the request and who answers it", () => {
  const ok = {monthKey: "2026-10", scope: "everything", method: "cash",
    receiverId: "owner-1"};
  it("refuses a bad month, scope, method or receiver", () => {
    assert.equal(settle.requestRefusal(ok), "");
    assert.equal(settle.requestRefusal({...ok, monthKey: "Oct"}),
        "team_settle_month_invalid");
    assert.equal(settle.requestRefusal({...ok, scope: "x"}),
        "team_settle_scope_invalid");
    assert.equal(settle.requestRefusal({...ok, method: "gold"}),
        "team_settle_method_invalid");
    assert.equal(settle.requestRefusal({...ok, receiverId: "a/b"}),
        "team_settle_receiver_invalid");
    assert.equal(settle.requestRefusal({...ok, receiverId: "business_account"}),
        "");
  });

  const plan = settle.teamSettlePlan({
    statement: {parkingJobsCents: 5000, expenseCents: 0, cashHeldCents: 1000},
    amountCents: 6000, scope: "everything"});
  const row = settle.settlementRecord({businessId: "b", staffId: "s",
    monthKey: "2026-10", scope: "everything", method: "cash",
    receiverId: "owner-1", note: "n"}, plan,
  {uid: "s", statementOwedCents: 6000, nowMs: 1000});

  it("freezes the amount, the split and the statement's number", () => {
    assert.equal(row.amountCents, 6000);
    assert.equal(row.cashCents, 1000);
    assert.equal(row.parkingCents, 5000);
    assert.equal(row.statementOwedCents, 6000);
    assert.equal(row.status, "pending");
    assert.equal(row.requestedByUid, "s");
    assert.equal(row.confirmedAtMs, 0);
  });

  it("only the named receiver, in a receiver role, answers a pending one",
      () => {
        const ctx = (extra) => ({uid: "owner-1", businessId: "b",
          isReceiverRole: true, ...extra});
        assert.equal(settle.settlementAnswerRefusal(row, ctx()), "");
        assert.equal(settle.settlementAnswerRefusal(row,
            ctx({uid: "other"})), "team_settle_not_receiver");
        assert.equal(settle.settlementAnswerRefusal(row,
            ctx({isReceiverRole: false})), "team_settle_not_receiver");
        assert.equal(settle.settlementAnswerRefusal(row,
            ctx({businessId: "x"})), "team_settle_not_found");
        assert.equal(settle.settlementAnswerRefusal(
            {...row, status: "confirmed"}, ctx()), "team_settle_not_pending");
        const account = {...row, receiverId: "business_account"};
        assert.equal(settle.settlementAnswerRefusal(account,
            ctx({uid: "any-owner"})), "");
      });

  it("any staff may undo one that waits or counts, once", () => {
    assert.equal(settle.settlementUndoRefusal(
        {...row, status: "confirmed"}, "b"), "");
    assert.equal(settle.settlementUndoRefusal(row, "b"), "");
    assert.equal(settle.settlementUndoRefusal(
        {...row, status: "undone"}, "b"), "team_settle_not_undoable");
    assert.equal(settle.settlementUndoRefusal(
        {...row, status: "declined"}, "b"), "team_settle_not_undoable");
    assert.equal(settle.settlementUndoRefusal(row, "x"),
        "team_settle_not_found");
  });

  it("a pay-back counts in the month it settles", () => {
    assert.equal(settle.paybackDay("2026-10", "2026-11-11"), "2026-10-31");
    assert.equal(settle.paybackDay("2026-11", "2026-11-11"), "2026-11-11");
    assert.equal(settle.paybackDay("2026-02", "2026-11-11"), "2026-02-28");
  });

  it("every refusal has a plain sentence and a kind", () => {
    for (const code of Object.values(settle.REFUSAL)) {
      const {kind, message} = settle.teamSettleRefusal(code);
      assert.ok(kind && message && message !== code, code);
    }
  });
});

"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  BANK_MATCH_START_MS,
  bankRefreshDue,
  bankScheduleQuote,
  cleanBankSchedule,
  depositMatchable,
  matchDeposit,
  senderKey,
} = require("../fleet_bank");
const fb = require("../fleet_bank");

// New York times in November 2026 (UTC-5).
const ny = (day, hour, minute = 0) =>
  Date.UTC(2026, 10, day, hour + 5, minute);

describe("pay-day bank checks: the business's choice and its cost", () => {
  it("cleans the schedule; off by default", () => {
    assert.deepEqual(cleanBankSchedule({}), {every: 0, fromHour: 7,
      toHour: 23, monthDays: [], mondays: false});
    assert.deepEqual(cleanBankSchedule({every: 15, fromHour: 7, toHour: 23,
      monthDays: [3, 1, 2, 2, 40, 0], mondays: true}), {every: 15,
      fromHour: 7, toHour: 23, monthDays: [1, 2, 3], mondays: true});
    assert.equal(cleanBankSchedule({every: 10}).every, 0, "only 15/30/60");
    assert.deepEqual(cleanBankSchedule({fromHour: 20, toHour: 8}).fromHour,
        7, "an upside-down window falls back");
  });

  it("quotes the month: 15 min, 7 AM-11 PM, 1st-3rd = 192 checks, $23.04",
      () => {
        assert.deepEqual(bankScheduleQuote({every: 15, fromHour: 7,
          toHour: 23, monthDays: [1, 2, 3]}), {perDay: 64, days: 3,
          perMonth: 192, centsEach: 12, monthCents: 2304});
        assert.equal(bankScheduleQuote({every: 15, fromHour: 0, toHour: 24,
          monthDays: [1, 2, 3]}).monthCents, 3456, "around the clock");
        assert.equal(bankScheduleQuote({every: 30, fromHour: 7, toHour: 23,
          monthDays: [1, 2, 3]}).monthCents, 1152);
        assert.equal(bankScheduleQuote({every: 15, fromHour: 7, toHour: 23,
          monthDays: [1, 2, 3], mondays: true}).perMonth, 448);
        assert.equal(bankScheduleQuote({every: 15, monthDays: [1]}, 20)
            .monthCents, 64 * 20, "the business's own price when it has one");
        assert.equal(bankScheduleQuote({every: 0, monthDays: [1]})
            .monthCents, 0);
      });

  it("asks the bank only on chosen days, inside the hours, every N minutes",
      () => {
        const s = {every: 15, fromHour: 7, toHour: 23, monthDays: [1, 2, 3]};
        assert.equal(bankRefreshDue(s, ny(2, 9, 0), 0), true);
        assert.equal(bankRefreshDue(s, ny(2, 9, 0), ny(2, 8, 45)), true);
        assert.equal(bankRefreshDue(s, ny(2, 9, 0), ny(2, 8, 50)), false);
        assert.equal(bankRefreshDue(s, ny(2, 6, 45), 0), false, "before 7");
        assert.equal(bankRefreshDue(s, ny(2, 23, 0), 0), false, "after 11");
        assert.equal(bankRefreshDue(s, ny(4, 9, 0), 0), false, "the 4th");
        // Monday Nov 9, 2026.
        assert.equal(bankRefreshDue({...s, mondays: true}, ny(9, 9), 0), true);
        assert.equal(bankRefreshDue(s, ny(9, 9), 0), false);
        assert.equal(bankRefreshDue({...s, every: 0}, ny(2, 9), 0), false);
      });
});

describe("the shared cost cases (console mirror: lib/fleet-bank.ts)", () => {
  const cases = require("./fixtures/fleet-bank-cases.json").quotes;
  for (const c of cases) {
    it(c.name, () => {
      assert.deepEqual(bankScheduleQuote(c.schedule, c.centsEach), c.expect);
    });
  }
});

describe("a deposit pays the right driver", () => {
  const drivers = [
    {id: "d1", status: "active", personalCents: 17,
      rememberedSenders: ["MOUSSA KEITA"]},
    {id: "d2", status: "active", personalCents: 42, rememberedSenders: []},
    {id: "d3", status: "left", personalCents: 55,
      rememberedSenders: ["OLD DRIVER"]},
  ];

  it("a remembered sender first, in any spelling the bank uses", () => {
    assert.equal(senderKey("Moussa  Keïta."), "MOUSSA KEITA");
    assert.deepEqual(matchDeposit({amountCents: 35000,
      senderName: "moussa keita"}, drivers), {driverId: "d1", how: "sender"});
  });

  it("else the amount's cents are the driver's code", () => {
    assert.deepEqual(matchDeposit({amountCents: 35042,
      senderName: "NEW PERSON"}, drivers), {driverId: "d2", how: "cents"});
    assert.deepEqual(matchDeposit({amountCents: 35000,
      senderName: "NEW PERSON"}, drivers), {reason: "unknown"});
    assert.deepEqual(matchDeposit({amountCents: 35055,
      senderName: "OLD DRIVER"}, drivers), {reason: "unknown"},
    "a driver who left is never paid");
  });

  it("two drivers who could be the sender: nobody is guessed", () => {
    const twins = [...drivers, {id: "d4", status: "active", personalCents: 17,
      rememberedSenders: ["MOUSSA KEITA"]}];
    assert.deepEqual(matchDeposit({amountCents: 35017,
      senderName: "MOUSSA KEITA"}, twins), {reason: "two_drivers"});
  });

  it("only new, unused money from a person is tried", () => {
    const after = BANK_MATCH_START_MS + 1000;
    assert.equal(depositMatchable({amountCents: 100, senderName: "A",
      atMs: after}, BANK_MATCH_START_MS), true);
    assert.equal(depositMatchable({amountCents: 100, senderName: "A",
      atMs: BANK_MATCH_START_MS - 1}, BANK_MATCH_START_MS), false);
    assert.equal(depositMatchable({amountCents: 100, senderName: "",
      atMs: after}, BANK_MATCH_START_MS), false, "no sender: not a driver");
    assert.equal(depositMatchable({amountCents: 100, senderName: "A",
      atMs: after, consumedBy: {kind: "sale", id: "s"}},
    BANK_MATCH_START_MS), false, "already used for a sale");
    assert.equal(depositMatchable({amountCents: 100, senderName: "A",
      atMs: after, removed: true}, BANK_MATCH_START_MS), false);
    assert.equal(depositMatchable({amountCents: 100, senderName: "A",
      atMs: null, dateKey: "2026-11-12"}, BANK_MATCH_START_MS), true);
  });
});

describe("a deposit the bank may have sent twice", () => {
  const used = {id: "a", accountId: "acct", amountCents: 35017,
    senderName: "MOUSSA DIALLO", dateKey: "2026-12-01", pending: true,
    consumedBy: {kind: "fleet_payment", id: "p1"}};
  const fresh = {id: "b", accountId: "acct", amountCents: 35017,
    senderName: "Moussa Diallo", dateKey: "2026-12-02", pending: false};
  it("same account, amount and sender as a used pending or removed one",
      () => {
        assert.equal(fb.possibleDuplicateOf(fresh, [used]).id, "a");
        assert.equal(fb.possibleDuplicateOf(fresh,
            [{...used, pending: false, removed: true}]).id, "a");
      });
  it("not when the used one posted normally, or differs, or is far apart",
      () => {
        assert.equal(fb.possibleDuplicateOf(fresh,
            [{...used, pending: false}]), null);
        assert.equal(fb.possibleDuplicateOf(fresh,
            [{...used, consumedBy: null}]), null);
        assert.equal(fb.possibleDuplicateOf(fresh,
            [{...used, amountCents: 35018}]), null);
        assert.equal(fb.possibleDuplicateOf(fresh,
            [{...used, senderName: "OTHER"}]), null);
        assert.equal(fb.possibleDuplicateOf(fresh,
            [{...used, accountId: "other"}]), null);
        assert.equal(fb.possibleDuplicateOf(fresh,
            [{...used, dateKey: "2026-11-20"}]), null);
        assert.equal(fb.possibleDuplicateOf(fresh, [fresh]), null);
      });
});

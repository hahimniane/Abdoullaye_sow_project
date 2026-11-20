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

describe("a deposit pays the right driver (no personal cents)", () => {
  const drivers = [
    {id: "d1", name: "Moussa Keita", status: "active",
      rememberedSenders: ["MOUSSA KEITA"]},
    {id: "d2", name: "Fatoumata Bah", status: "active",
      rememberedSenders: []},
    {id: "d3", name: "Old Driver", status: "left",
      rememberedSenders: ["OLD DRIVER"]},
  ];
  const claim = (over) => ({id: "c1", driverId: "d2", amountCents: 40000,
    payerName: "", dayKey: "2026-12-02", createdAtMs: 1, ...over});
  const dep = (over) => ({id: "x", amountCents: 40000,
    senderName: "Fatoumata B. Bah #12", zelle: true, dateKey: "2026-12-02",
    ...over});

  it("0. accounts, non-Zelle and nameless deposits wait", () => {
    assert.deepEqual(matchDeposit(dep({senderName: "360 Checking XXXXXXX2820"}),
        drivers), {reason: "own_transfer"});
    assert.deepEqual(matchDeposit(dep({zelle: false}), drivers),
        {reason: "not_zelle"});
    assert.deepEqual(matchDeposit(dep({senderName: ""}), drivers),
        {reason: "unknown"});
    assert.deepEqual(matchDeposit(dep({senderName: "Zelle"}), drivers),
        {reason: "unknown"});
  });

  it("the cents of an amount mean nothing any more", () => {
    assert.deepEqual(matchDeposit(dep({amountCents: 35042,
      senderName: "NEW PERSON"}), drivers), {reason: "unknown"});
  });

  it("1. an undone deposit never pays by itself again", () => {
    for (const over of [{fleetUndone: true},
      {fleetWaitingReason: "undone"}]) {
      assert.deepEqual(matchDeposit(dep({senderName: "moussa keita",
        ...over}), drivers, {claims: []}), {reason: "undone"});
      assert.deepEqual(matchDeposit(dep({...over}), drivers,
          {claims: [claim()]}), {reason: "undone"}, "not even by a claim");
    }
  });

  it("2. a sender remembered for one active driver pays that driver, " +
      "whatever the amount", () => {
    assert.equal(senderKey("Moussa  Keïta."), "MOUSSA KEITA");
    for (const amountCents of [35000, 35042, 1]) {
      assert.deepEqual(matchDeposit({amountCents, senderName: "moussa keita"},
          drivers), {driverId: "d1", how: "sender"});
    }
  });

  it("3. a sender remembered for two active drivers waits, unless exactly " +
      "one of them has an open claim for that amount", () => {
    const shared = [...drivers, {id: "d4", name: "Wife Keita",
      status: "active", rememberedSenders: ["MOUSSA KEITA"]}];
    const d = {amountCents: 40000, senderName: "MOUSSA KEITA"};
    assert.deepEqual(matchDeposit(d, shared), {reason: "shared_payer"});
    assert.deepEqual(matchDeposit(d, shared, {claims: [
      claim({driverId: "d4"})]}), {driverId: "d4", how: "claim",
      claimId: "c1"});
    assert.deepEqual(matchDeposit(d, shared, {claims: [
      claim({driverId: "d4"}), claim({id: "c2", driverId: "d1"})]}),
    {reason: "shared_payer"}, "two drivers have one");
    assert.deepEqual(matchDeposit(d, shared, {claims: [
      claim({driverId: "d4", amountCents: 39000})]}),
    {reason: "shared_payer"}, "another amount");
    assert.deepEqual(matchDeposit(d, shared, {claims: [
      claim({driverId: "d2"})]}), {reason: "shared_payer"},
    "a claim of a driver who is not an owner of the name");
  });

  it("4. a sender remembered only for a driver who left waits", () => {
    assert.deepEqual(matchDeposit({amountCents: 35055,
      senderName: "Old Driver"}, drivers, {claims: [claim()]}),
    {reason: "driver_left"});
  });

  it("5a. an unknown sender is the claim's payerName", () => {
    assert.deepEqual(matchDeposit(dep({amountCents: 12345,
      senderName: "Aminata Diallo"}), drivers, {claims: [
      claim({payerName: "AMINATA DIALLO"})]}),
    {driverId: "d2", how: "claim", claimId: "c1"}, "any amount (Q3)");
    assert.deepEqual(matchDeposit(dep({senderName: "Aminata Diallo"}),
        drivers, {claims: [claim({payerName: "AMINATA DIALLO"}),
          claim({id: "c2", payerName: "Aminata Diallo"})]}).reason, "unknown",
    "two claims name the same payer: nobody is guessed");
  });

  it("5b. no payerName: equal amount, the driver's own name, nothing " +
      "else fits", () => {
    const ctx = {claims: [claim()], others: []};
    assert.deepEqual(matchDeposit(dep(), drivers, ctx),
        {driverId: "d2", how: "claim", claimId: "c1"});
    assert.equal(matchDeposit(dep({amountCents: 40001}), drivers, ctx).reason,
        "unknown", "amounts differ");
    assert.equal(matchDeposit(dep({senderName: "Bah"}), drivers, ctx).reason,
        "unknown", "one word is nobody");
    assert.equal(matchDeposit(dep({senderName: "Someone Else"}), drivers,
        ctx).reason, "unknown", "not the driver's own name");
    // Another unused deposit fits the same way.
    const rival = matchDeposit(dep(), drivers, {claims: [claim()],
      others: [{id: "y", amountCents: 40000, senderName: "Fatoumata Bah",
        dateKey: "2026-12-02"}]});
    assert.equal(rival.reason, "unknown");
    assert.deepEqual(rival.claimIds, ["c1"]);
    // Another open claim fits the same way (a second driver of that name).
    const twin = [...drivers, {id: "d5", name: "Fatoumata Bah",
      status: "active", rememberedSenders: []}];
    assert.equal(matchDeposit(dep(), twin, {claims: [claim(),
      claim({id: "c2", driverId: "d5"})]}).reason, "unknown");
    // An unrelated unused deposit does not block it.
    assert.equal(matchDeposit(dep(), drivers, {claims: [claim()],
      others: [{id: "y", amountCents: 40000, senderName: "Joe Doe"}]})
        .driverId, "d2");
    // A deposit dated before the photo's day cannot be that payment.
    assert.equal(matchDeposit(dep({dateKey: "2026-11-20"}), drivers, ctx)
        .reason, "unknown");
  });

  it("6. otherwise it waits as unknown", () => {
    assert.deepEqual(matchDeposit(dep(), drivers), {reason: "unknown"});
  });

  it("'is the same name': every word of the shorter, at least two", () => {
    assert.equal(fb.nameIs("FATOUMATA BAH", "Fatoumata B. Bah #12"), true);
    assert.equal(fb.nameIs("Fatoumata Bah", "Fatoumata Mariam Bah"), true);
    assert.equal(fb.nameIs("BAH", "Fatoumata Bah"), false);
    assert.equal(fb.nameIs("Fatoumata B", "Fatoumata Bah"), false);
    assert.equal(fb.nameIs("Mamadou Bah", "Fatoumata Bah"), false);
    assert.equal(fb.nameIs("", ""), false);
  });

  it("only a person's Zelle with a real name is remembered", () => {
    const {senderRememberable} = require("../fleet_bank");
    for (const senderName of ["STRIPE", "ATM", "Uber"]) {
      assert.equal(senderRememberable({senderName, zelle: false}), false);
    }
    for (const senderName of ["Zelle", "Venmo", "Cash App", "", "BAH",
      "MONEY SENT", "PMT XFER", "Moussa #1234"]) {
      assert.equal(senderRememberable({senderName, zelle: true}), false,
          senderName);
    }
    assert.equal(senderRememberable({senderName: "360 Checking XXXXXXX2820",
      zelle: true}), false);
    assert.equal(senderRememberable({senderName: "Awa Sow", zelle: true}),
        true);
    assert.equal(senderRememberable({senderName: "Awa Sow"}), true);
    assert.equal(fb.nameRememberable("Awa"), false);
  });

  it("sender names lose reference numbers and bank words", () => {
    assert.equal(fb.cleanSenderName("ZELLE MONEY SENT Awa Sow JPM99abc1234"),
        "Awa Sow");
    assert.equal(fb.cleanSenderName("Awa Sow PMT 8839 XFER"), "Awa Sow");
    assert.equal(fb.cleanSenderName("Awa Sow #12"), "Awa Sow");
    // An account keeps its digits: they are what marks it an account.
    assert.equal(fb.cleanSenderName("360 Checking XXXXXXX2820"),
        "360 Checking XXXXXXX2820");
    assert.equal(fb.matchKey("Awa Sow MONEY"), "AWA SOW");
  });

  it("a transfer from an account is nobody's", () => {
    const {senderIsAccount} = require("../fleet_bank");
    for (const name of ["360 Checking XXXXXXX2820", "Savings ****1234",
      "CHECKING 0042", "Money Market xx9911"]) {
      assert.equal(senderIsAccount(name), true, name);
    }
    for (const name of ["HASSIMIOU NIANE", "Moussa Keïta", "Maxine Checkley",
      ""]) {
      assert.equal(senderIsAccount(name), false, name);
    }
  });

  it("only new, unused money is looked at", () => {
    const after = BANK_MATCH_START_MS + 1000;
    assert.equal(depositMatchable({amountCents: 100, senderName: "A",
      atMs: after}, BANK_MATCH_START_MS), true);
    assert.equal(depositMatchable({amountCents: 100, senderName: "A",
      atMs: BANK_MATCH_START_MS - 1}, BANK_MATCH_START_MS), false);
    assert.equal(depositMatchable({amountCents: 100, senderName: "A",
      atMs: after, consumedBy: {kind: "sale", id: "s"}},
    BANK_MATCH_START_MS), false, "already used for a sale");
    assert.equal(depositMatchable({amountCents: 100, senderName: "A",
      atMs: after, removed: true}, BANK_MATCH_START_MS), false);
    assert.equal(depositMatchable({amountCents: 100, senderName: "A",
      atMs: null, dateKey: "2026-11-12"}, BANK_MATCH_START_MS), true);
  });

  it("connecting a different bank login starts matching from that moment",
      () => {
        const business = {fleet: {enabledAtMs: BANK_MATCH_START_MS + 5}};
        assert.equal(fb.matchStartMs(business, {}), BANK_MATCH_START_MS + 5);
        assert.equal(fb.matchStartMs(business, {matchFromMs: 9e12}), 9e12);
        assert.equal(fb.matchStartMs({}, null), BANK_MATCH_START_MS);
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
  it("a deposit the office undid, and the bank's copy of it, never pays " +
      "by itself", () => {
    const undone = {id: "u", accountId: "acct", amountCents: 35017,
      senderName: "MOUSSA DIALLO", dateKey: "2026-12-01", pending: false,
      fleetUndone: true};
    assert.equal(fb.possibleDuplicateOf(fresh, [undone]).id, "u");
    assert.equal(fb.possibleDuplicateOf(fresh,
        [{...undone, fleetUndone: false}]), null);
  });
});

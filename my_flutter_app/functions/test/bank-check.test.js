"use strict";

// Check bank any time (bank_check.js, docs/ZELLE_BANK_CHECK.md "Check bank
// any time"): the window staff pick, which deposits answer it, "Use for a
// sale", the monthly limit of paid refreshes and the usage the owner sees.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const b = require("../bank_check");
const z = require("../zelle_check");

const MIN = 60 * 1000;
// 2:30 PM in New York on Tuesday, October 20, 2026 (EDT, UTC-4).
const NOW = Date.parse("2026-10-20T18:30:00Z");
const NY = "America/New_York";
const credit = (over = {}) => ({id: "biz_t1", businessId: "biz",
  accountId: "acc", amountCents: 4000, pending: false, atMs: NOW - 5 * MIN,
  timeKnown: true, dateKey: "2026-10-20", senderName: "FATOU BAH",
  ...over});
const ctxFor = (since, over = {}) => ({amountCents: 4000, accountId: "acc",
  window: b.standaloneWindow({since, nowMs: NOW, timeZone: NY}), ...over});

describe("check bank: when it was sent", () => {
  it("offers last 15 minutes (default), last hour and today", () => {
    assert.deepEqual(b.SINCE_OPTIONS, ["15m", "1h", "today"]);
    assert.equal(b.cleanSince(undefined), "15m");
    assert.equal(b.cleanSince(""), "15m");
    assert.equal(b.cleanSince("1h"), "1h");
    assert.equal(b.cleanSince("today"), "today");
    assert.equal(b.cleanSince("yesterday"), null);
    assert.equal(b.cleanSince("15M"), null);
  });

  it("windows end now (plus a little for bank clocks)", () => {
    const quarter = b.standaloneWindow({since: "15m", nowMs: NOW,
      timeZone: NY});
    assert.equal(quarter.fromMs, NOW - 15 * MIN);
    assert.equal(quarter.toMs, NOW + b.FUTURE_GRACE_MS);
    assert.equal(b.standaloneWindow({since: "1h", nowMs: NOW, timeZone: NY})
        .fromMs, NOW - 60 * MIN);
  });

  it("today starts at midnight in the business's zone", () => {
    const today = b.standaloneWindow({since: "today", nowMs: NOW,
      timeZone: NY});
    assert.equal(today.fromMs, Date.parse("2026-10-20T04:00:00Z"));
    assert.deepEqual([...today.dateKeys], ["2026-10-20"]);
    // Dakar is UTC+0: its day started four hours later than New York's.
    assert.equal(b.standaloneWindow({since: "today", nowMs: NOW,
      timeZone: "Africa/Dakar"}).fromMs, Date.parse("2026-10-20T00:00:00Z"));
    // An unknown zone reads as New York.
    assert.equal(b.standaloneWindow({since: "today", nowMs: NOW,
      timeZone: "Mars/Base"}).fromMs, today.fromMs);
    // Across the end of daylight time (Nov 1, 2026): midnight is EDT.
    const after = Date.parse("2026-11-01T15:00:00Z");
    assert.equal(b.zonedDayStartMs(after, NY),
        Date.parse("2026-11-01T04:00:00Z"));
    assert.equal(b.zonedDayStartMs(Date.parse("2026-11-02T15:00:00Z"), NY),
        Date.parse("2026-11-02T05:00:00Z"));
  });

  it("a 15-minute window just after midnight also covers yesterday's date",
      () => {
        const justAfter = Date.parse("2026-10-21T04:05:00Z"); // 12:05 AM
        const w = b.standaloneWindow({since: "15m", nowMs: justAfter,
          timeZone: NY});
        assert.deepEqual([...w.dateKeys].sort(),
            ["2026-10-20", "2026-10-21"]);
      });
});

describe("check bank: which deposits answer it", () => {
  it("exact amount, edges of the window included", () => {
    assert.equal(b.standaloneIneligibility(credit(), ctxFor("15m")), null);
    assert.equal(b.standaloneIneligibility(credit({amountCents: 4001}),
        ctxFor("15m")), "amount");
    assert.equal(b.standaloneIneligibility(credit({atMs: NOW - 15 * MIN}),
        ctxFor("15m")), null);
    assert.equal(b.standaloneIneligibility(
        credit({atMs: NOW - 15 * MIN - 1}), ctxFor("15m")), "outside_window");
    assert.equal(b.standaloneIneligibility(credit({atMs: NOW - 40 * MIN}),
        ctxFor("15m")), "outside_window");
    assert.equal(b.standaloneIneligibility(credit({atMs: NOW - 40 * MIN}),
        ctxFor("1h")), null);
    assert.equal(b.standaloneIneligibility(
        credit({atMs: NOW + b.FUTURE_GRACE_MS}), ctxFor("15m")), null);
    assert.equal(b.standaloneIneligibility(
        credit({atMs: NOW + b.FUTURE_GRACE_MS + 1}), ctxFor("15m")),
    "outside_window");
  });

  it("today: since midnight, not yesterday evening", () => {
    const midnight = Date.parse("2026-10-20T04:00:00Z");
    assert.equal(b.standaloneIneligibility(credit({atMs: midnight}),
        ctxFor("today")), null);
    assert.equal(b.standaloneIneligibility(credit({atMs: midnight - 1}),
        ctxFor("today")), "outside_window");
  });

  it("never a used, removed or other-account deposit", () => {
    assert.equal(b.standaloneIneligibility(credit({consumedBy: {
      kind: "inventory_sale", id: "s1"}}), ctxFor("15m")), "consumed");
    assert.equal(b.standaloneIneligibility(credit({removed: true}),
        ctxFor("15m")), "removed");
    assert.equal(b.standaloneIneligibility(credit({accountId: "savings"}),
        ctxFor("15m")), "other_account");
    assert.equal(b.standaloneIneligibility(null, ctxFor("15m")), "missing");
  });

  it("a date-only deposit is held to the window's dates", () => {
    const dated = credit({atMs: null, timeKnown: false,
      dateKey: "2026-10-20"});
    assert.equal(b.standaloneIneligibility(dated, ctxFor("15m")), null);
    assert.equal(b.standaloneIneligibility({...dated,
      dateKey: "2026-10-19"}, ctxFor("today")), "outside_window");
  });

  it("one -> received, several -> listed newest first, none -> not found",
      () => {
        assert.deepEqual(b.standaloneOutcome(ctxFor("15m"), []),
            {result: "not_found", deposits: []});
        const one = b.standaloneOutcome(ctxFor("15m"), [credit(),
          credit({id: "biz_old", atMs: NOW - 2 * 60 * MIN})]);
        assert.equal(one.result, "received");
        assert.deepEqual(one.deposits, [{creditId: "biz_t1",
          amountCents: 4000, atMs: NOW - 5 * MIN, timeKnown: true,
          senderName: "FATOU BAH", pending: false}]);
        const several = b.standaloneOutcome(ctxFor("1h"), [
          credit({id: "biz_a", atMs: NOW - 50 * MIN, senderName: "A"}),
          credit({id: "biz_b", atMs: NOW - 2 * MIN, senderName: "B",
            pending: true}),
          credit({id: "biz_c", atMs: null, timeKnown: false,
            dateKey: "2026-10-20", senderName: "C"})]);
        assert.equal(several.result, "several");
        // Timed deposits newest first; a date-only one after them.
        assert.deepEqual(several.deposits.map((d) => d.senderName),
            ["B", "A", "C"]);
        const dateOnly = several.deposits.find((d) => d.senderName === "C");
        assert.deepEqual([dateOnly.timeKnown, dateOnly.atMs],
            [false, Date.parse("2026-10-20T12:00:00Z")]);
      });

  it("shows nothing but amount, time, sender and pending", () => {
    const view = b.depositView(credit({accountId: "acc", balance: 99999,
      name: "ZELLE FROM FATOU BAH REF 123", consumedBy: null}));
    assert.deepEqual(Object.keys(view).sort(), ["amountCents", "atMs",
      "creditId", "pending", "senderName", "timeKnown"]);
  });

  it("amounts are whole cents from $0.01 to $1,000,000", () => {
    assert.equal(b.cleanCheckCents(4000), 4000);
    for (const bad of [0, -5, 40.5, "4000", "40.00", null, undefined,
      100000001]) {
      assert.equal(b.cleanCheckCents(bad), null, String(bad));
    }
  });
});

describe("check bank: use for a sale", () => {
  const useCtx = (over = {}) => ({amountCents: 4000, accountId: "acc",
    nowMs: NOW, timeZone: NY, ...over});

  it("takes a deposit of today or yesterday, not older", () => {
    assert.equal(b.useIneligibility(credit(), useCtx()), null);
    const yesterdayMorning = Date.parse("2026-10-19T04:00:00Z");
    assert.equal(b.useIneligibility(credit({atMs: yesterdayMorning}),
        useCtx()), null);
    assert.equal(b.useIneligibility(credit({atMs: yesterdayMorning - 1}),
        useCtx()), "outside_window");
    assert.equal(b.useIneligibility(credit({atMs: null, timeKnown: false,
      dateKey: "2026-10-19"}), useCtx()), null);
    assert.equal(b.useIneligibility(credit({atMs: null, timeKnown: false,
      dateKey: "2026-10-18"}), useCtx()), "outside_window");
  });

  it("needs the same amount, the account, and a free deposit", () => {
    assert.equal(b.useIneligibility(credit(), useCtx({amountCents: 4001})),
        "amount");
    assert.equal(b.useIneligibility(credit({accountId: "x"}), useCtx()),
        "other_account");
    assert.equal(b.useIneligibility(credit({removed: true}), useCtx()),
        "removed");
    const used = credit({consumedBy: {kind: "inventory_sale", id: "s1"}});
    assert.equal(b.useIneligibility(used, useCtx()), "consumed");
    assert.equal(b.useIneligibility(used, useCtx({consumedByMe: {
      kind: "inventory_sale", id: "s1"}})), null);
  });

  it("offers live Zelle records of exactly that amount, not confirmed", () => {
    const sale = {businessId: "biz", paymentMethod: "zelle",
      paidNowCents: 4000, totalCents: 9000};
    assert.equal(b.recordOffered("inventory_sale", sale, "biz", 4000), true);
    assert.equal(b.recordOffered("inventory_sale", sale, "biz", 9000),
        false);
    assert.equal(b.recordOffered("inventory_sale", {...sale,
      paymentMethod: "cash"}, "biz", 4000), false);
    assert.equal(b.recordOffered("inventory_sale", {...sale, voided: true},
        "biz", 4000), false);
    assert.equal(b.recordOffered("inventory_sale", {...sale,
      bankCheck: {status: "confirmed", amountCents: 4000}}, "biz", 4000),
    false);
    // A "not found yet" note does not hide it.
    assert.equal(b.recordOffered("inventory_sale", {...sale,
      bankCheck: {status: "not_found"}}, "biz", 4000), true);
    assert.equal(b.recordOffered("inventory_sale", sale, "other", 4000),
        false);
    const pay = {businessId: "biz", method: "zelle", amountCents: 4000,
      reverted: false};
    assert.equal(b.recordOffered("container_line_payment", pay, "biz", 4000),
        true);
    assert.equal(b.recordOffered("inventory_credit_payment", {...pay,
      reverted: true}, "biz", 4000), false);
    assert.equal(b.useRecordRefusal("container_line_payment", pay, "biz",
        3000), "amount_mismatch");
  });

  it("lists newest first, searches customer, items, code and id", () => {
    const views = [
      b.useRecordView({kind: "inventory_sale", id: "s1", record: {
        paidNowCents: 4000, createdAt: NOW - 3 * MIN}, who: "Awa",
      what: b.saleItemsSummary([{name: "Rice 25kg", quantity: 2},
        {name: "Oil", quantity: 1}])}),
      b.useRecordView({kind: "container_line_payment", id: "p1", record: {
        amountCents: 4000, createdAt: NOW - MIN}, who: "Moussa",
      what: "LW-4821"}),
      b.useRecordView({kind: "inventory_credit_payment", id: "c1",
        record: {amountCents: 4000, createdAt: NOW - 9 * MIN}, who: "",
        what: "Sugar"}),
    ];
    assert.equal(views[0].what, "2 x Rice 25kg, Oil");
    assert.deepEqual(b.pickRecords(views, "", 8).map((v) => v.id),
        ["p1", "s1", "c1"]);
    assert.deepEqual(b.pickRecords(views, b.cleanQuery("  RICE "), 8)
        .map((v) => v.id), ["s1"]);
    assert.deepEqual(b.pickRecords(views, "lw-48", 8).map((v) => v.id),
        ["p1"]);
    assert.deepEqual(b.pickRecords(views, "c1", 8).map((v) => v.id), ["c1"]);
    assert.deepEqual(b.pickRecords(views, "", 2).length, 2);
    assert.deepEqual(b.pickRecords([...views, views[0]], "", 8).length, 3);
  });
});

describe("check bank: the monthly limit of paid refreshes", () => {
  const KEY = "amount:4000";
  const plan = (over = {}) => z.refreshPlan({lastRefreshAt: null, marks: {},
    recordKey: KEY, nowMs: NOW, ...over});

  it("is 100 by default, the owner sets 0 to 1000", () => {
    assert.equal(b.refreshLimitOf(null), 100);
    assert.equal(b.refreshLimitOf({refreshLimit: 0}), 0);
    assert.equal(b.refreshLimitOf({refreshLimit: 250}), 250);
    assert.equal(b.refreshLimitOf({refreshLimit: 5000}), 100);
    for (const bad of [-1, 1001, 2.5, "lots", null]) {
      assert.equal(b.cleanRefreshLimit(bad), null, String(bad));
    }
    assert.equal(b.cleanRefreshLimit("40"), 40);
  });

  it("once reached, checks only sync", () => {
    assert.deepEqual([plan({monthRefreshes: 99, monthlyLimit: 100}).refresh,
      plan({monthRefreshes: 100, monthlyLimit: 100}).reason],
    [true, "monthly_limit"]);
    assert.equal(plan({monthRefreshes: 0, monthlyLimit: 0}).reason,
        "monthly_limit");
    // Without a limit given, the old rule alone (existing callers).
    assert.equal(plan({monthRefreshes: 5000}).refresh, true);
    // The 5-minute and 60-second rules still come first.
    assert.equal(plan({marks: {[KEY]: NOW - MIN}, monthRefreshes: 100,
      monthlyLimit: 100}).reason, "record_recent");
  });

  it("the check that reaches the limit sends the month's one notice", () => {
    const at99 = b.limitState({plan: {refresh: true}, usedBefore: 99,
      limit: 100, noticeSent: false});
    assert.deepEqual(at99, {refreshesAfter: 100, limitReached: true,
      notify: true});
    assert.equal(b.limitState({plan: {refresh: false}, usedBefore: 100,
      limit: 100, noticeSent: true}).notify, false);
    assert.equal(b.limitState({plan: {refresh: true}, usedBefore: 10,
      limit: 100, noticeSent: false}).limitReached, false);
    // A limit lowered under the count: the next check notices it.
    assert.equal(b.limitState({plan: {refresh: false}, usedBefore: 30,
      limit: 20, noticeSent: false}).notify, true);
    // A limit of 0 is the owner's choice: no notice.
    assert.equal(b.limitState({plan: {refresh: false}, usedBefore: 0,
      limit: 0, noticeSent: false}).notify, false);
  });

  it("replayed concurrently in one order, never more than the limit", () => {
    // Each check reads the count in its transaction; the transaction makes
    // them one after another. 30 checks against a limit of 3.
    let used = 0;
    let lastRefreshAt = null;
    let notices = 0;
    for (let i = 0; i < 30; i += 1) {
      const nowMs = NOW + i * 61 * 1000; // past the 60 s throttle each time
      const p = z.refreshPlan({lastRefreshAt, marks: {},
        recordKey: `amount:${i}`, nowMs, monthRefreshes: used,
        monthlyLimit: 3});
      const s = b.limitState({plan: p, usedBefore: used, limit: 3,
        noticeSent: notices > 0});
      if (p.refresh) lastRefreshAt = nowMs;
      used = s.refreshesAfter;
      if (s.notify) notices += 1;
    }
    assert.deepEqual([used, notices], [3, 1]);
  });
});

describe("check bank: usage the owner sees", () => {
  it("counts checks, paid refreshes, cost at $0.12, by staff member", () => {
    assert.equal(b.REFRESH_COST_CENTS, 12);
    const view = b.usageView({month: "2026-10", limit: 100,
      usage: {checks: 14, refreshes: 6, refreshesFailed: 1, byUid: {
        u1: {checks: 4, refreshes: 1}, u2: {checks: 10, refreshes: 5},
        u3: {checks: 0, refreshes: 0}}},
      names: new Map([["u1", "Awa Diallo"]])});
    assert.deepEqual(view, {month: "2026-10", checks: 14, refreshes: 6,
      refreshesFailed: 1, estimatedCostCents: 72, refreshLimit: 100,
      limitReached: false, byStaff: [
        {uid: "u2", name: "", checks: 10, refreshes: 5},
        {uid: "u1", name: "Awa Diallo", checks: 4, refreshes: 1}]});
    assert.equal(b.usageView({month: "2026-10", limit: 6,
      usage: {refreshes: 6}}).limitReached, true);
    assert.deepEqual(b.usageView({month: "2026-10", usage: null}).byStaff,
        []);
  });

  it("months are New York months; one document per business per month",
      () => {
        assert.equal(b.usageMonthKey(Date.parse("2026-11-01T03:59:00Z")),
            "2026-10");
        assert.equal(b.usageMonthKey(Date.parse("2026-11-01T04:00:00Z")),
            "2026-11");
        assert.equal(b.usageDocId("biz", "2026-10"), "biz_2026-10");
      });

  it("names people, never by uid", () => {
    assert.equal(b.personName({fullName: " Awa  Diallo "}), "Awa Diallo");
    assert.equal(b.personName({email: "a@b.test"}), "a@b.test");
    assert.equal(b.personName(null), "");
  });
});

describe("check bank: a bank link active in a month (Bills)", () => {
  const october = {startMs: Date.parse("2026-10-01T04:00:00Z"),
    endMs: Date.parse("2026-11-01T04:00:00Z")};
  const link = (over = {}) => ({itemId: "item", status: "active",
    connectedAt: Date.parse("2026-09-03T12:00:00Z"), ...over});

  it("a link connected before the month and still on counts", () => {
    assert.equal(b.linkActiveInMonth({link: link(), usage: null,
      window: october}), true);
    assert.equal(b.linkActiveInMonth({link: link({status: "needs_reauth"}),
      usage: null, window: october}), true);
  });

  it("connected after it, or gone before it began, does not", () => {
    assert.equal(b.linkActiveInMonth({link: link({
      connectedAt: october.endMs}), usage: null, window: october}), false);
    assert.equal(b.linkActiveInMonth({link: link({status: "disconnected",
      disconnectedAt: october.startMs - 1}), usage: null, window: october}),
    false);
    assert.equal(b.linkActiveInMonth({link: link({status: "disconnected",
      disconnectedAt: october.startMs + DAY}), usage: null,
    window: october}), true);
    assert.equal(b.linkActiveInMonth({link: null, usage: null,
      window: october}), false);
  });

  it("a month whose usage saw the link active counts, whatever since", () => {
    assert.equal(b.linkActiveInMonth({link: null,
      usage: {linkActive: true}, window: october}), true);
  });
});
const DAY = 24 * 60 * MIN;

describe("check bank: callable contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"),
      "utf8");
  // Each export's own text: from `exports.x = ` to its closing `);`.
  const endOf = (from) => Math.min(...["\n);\n", "\nexports.",
    "\nasync function ", "\nfunction "].map((mark) => {
    const at = source.indexOf(mark, from + 1);
    return at < 0 ? source.length : at;
  }));
  const exportBlocks = [...source.matchAll(/^exports\.(\w+) = /gm)]
      .map((m) => ({name: m[1], body: source.slice(m.index, endOf(m.index))}));
  const exportsUsing = (fn) => exportBlocks
      .filter((block) => new RegExp(`\\b${fn}\\(`).test(block.body))
      .map((block) => block.name);

  it("rides the existing callables: no new function", () => {
    assert.deepEqual(exportsUsing("standaloneBankCheck"),
        ["checkZellePayment"]);
    assert.deepEqual(exportsUsing("bankUseRecords"),
        ["confirmZelleCandidate"]);
  });

  it("whatever reaches Plaid binds the bank secrets", () => {
    for (const fn of ["refreshAndSyncBank", "usableBankLink",
      "standaloneBankCheck"]) {
      const users = exportsUsing(fn);
      for (const name of users) {
        const part = exportBlocks.find((block) => block.name === name).body;
        assert.match(part.slice(0, part.indexOf("async")),
            /secrets: BANK_SECRETS/, `${name} (${fn})`);
      }
      // ...and through the callables that call those helpers.
      for (const name of fn === "standaloneBankCheck" ? users : []) {
        assert.equal(name, "checkZellePayment");
      }
    }
  });

  it("counts the refresh in the transaction that decides it", () => {
    const start = source.indexOf("async function refreshAndSyncBank(");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    const tx = body.slice(body.indexOf("db.runTransaction("));
    assert.match(tx, /tx\.getAll\(linkRef, usageRef\)/);
    assert.match(tx, /zelleCheck\.refreshPlan\(/);
    assert.match(tx, /monthlyLimit: limit/);
    assert.match(tx, /patch\.refreshes = state\.refreshesAfter/);
    assert.ok(body.indexOf("refreshTransactions(") > body.indexOf(
        "db.runTransaction("), "Plaid is asked only after the count");
  });

  it("the usage stays server-only", () => {
    const rules = fs.readFileSync(path.join(__dirname, "..", "..",
        "firestore.rules"), "utf8");
    assert.match(rules, new RegExp("match /businessBankUsage/\\{[a-zA-Z]+\\} " +
      "\\{\\s*allow read, write: if false;"));
  });

  it("every new refusal has a kind and a message", () => {
    for (const code of ["mode_invalid", "check_amount_invalid",
      "since_invalid", "limit_invalid", "amount_mismatch"]) {
      assert.ok(z.BANK_REFUSALS[code], code);
    }
  });
});

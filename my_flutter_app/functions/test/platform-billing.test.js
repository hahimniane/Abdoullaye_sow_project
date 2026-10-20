"use strict";

// Laawol bills, the pure half (platform_billing.js, docs/PLATFORM_BILLING.md).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const billing = require("../platform_billing");

const {cases} = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "platform-billing-cases.json"), "utf8"));

/**
 * @param {*} raw A fixture deal (null: no deal).
 * @return {object|null} The validated deal.
 */
function dealOf(raw) {
  if (raw === null) return null;
  const {deal, errors} = billing.normalizeDeal(raw);
  assert.deepEqual(errors, []);
  return deal;
}

describe("the shared bill cases", () => {
  for (const c of cases) {
    it(c.name, () => {
      const bill = billing.computeBill({deal: dealOf(c.deal), usage: c.usage,
        commissionCents: c.commissionCents});
      const lines = Object.fromEntries(bill.lines.map((l) => [l.key,
        l.cents]));
      assert.deepEqual(lines, c.expect.lines);
      assert.equal(bill.chargesCents, c.expect.chargesCents);
      assert.equal(bill.amountCents, c.expect.amountCents);
      assert.equal(bill.minimumAdjustmentCents,
          c.expect.minimumAdjustmentCents);
      assert.equal(bill.capAdjustmentCents, c.expect.capAdjustmentCents);
      assert.equal(bill.earnedCents, c.expect.earnedCents);
      const pkg = bill.lines.find((l) => l.key === "packages");
      if (c.expect.packageNoPrice !== undefined) {
        assert.equal(pkg.noPriceCount, c.expect.packageNoPrice);
        assert.equal(pkg.atMinimumCount, c.expect.packageAtMinimum);
      }
      if (c.expect.packageQuantity !== undefined) {
        assert.equal(pkg.quantity, c.expect.packageQuantity);
      }
    });
  }
});

describe("percentOfCents rounds half up to the cent", () => {
  it("works in whole numbers", () => {
    assert.equal(billing.percentOfCents(2010, 500), 101); // 100.5
    assert.equal(billing.percentOfCents(2009, 500), 100); // 100.45
    assert.equal(billing.percentOfCents(1, 5000), 1); // 0.5
    assert.equal(billing.percentOfCents(1, 4999), 0);
    assert.equal(billing.percentOfCents(0, 500), 0);
    assert.equal(billing.percentOfCents(100000000, 10000), 100000000);
  });
});

describe("a deal is validated, never clamped", () => {
  const refuse = (raw, ...codes) => {
    const {deal, errors} = billing.normalizeDeal(raw);
    assert.equal(deal, null);
    for (const code of codes) assert.ok(errors.includes(code), code);
  };

  it("refuses what is not a deal", () => {
    refuse(null, "deal_invalid");
    refuse([], "deal_invalid");
    refuse("5", "deal_invalid");
    refuse({barrel: 5}, "deal_invalid");
  });

  it("refuses zero, negative, fractional and huge unit amounts", () => {
    refuse({barrel: {centsEach: 0}}, "amount_invalid");
    refuse({barrel: {centsEach: -100}}, "amount_invalid");
    refuse({barrel: {centsEach: 1.5}}, "amount_invalid");
    refuse({barrel: {centsEach: "100"}}, "amount_invalid");
    refuse({itemSold: {centsEach: 1000001}}, "amount_invalid");
    refuse({shippedCar: {}}, "amount_invalid");
  });

  it("refuses unknown modes and bad rates", () => {
    refuse({package: {mode: "weight", centsEach: 100}},
        "charge_mode_invalid");
    refuse({parking: {mode: "perDay", centsEach: 100}},
        "charge_mode_invalid");
    refuse({package: {mode: "percent", bps: 0}}, "rate_invalid");
    refuse({package: {mode: "percent", bps: 10001}}, "rate_invalid");
    refuse({parking: {mode: "percent", bps: 2.5}}, "rate_invalid");
    refuse({package: {mode: "percent", bps: 500, minCents: -1}},
        "minimum_invalid");
  });

  it("refuses bad flat, minimum and cap, and a minimum above the cap",
      () => {
        refuse({flatCents: -1}, "amount_invalid");
        refuse({minimumCents: 0}, "minimum_invalid");
        refuse({capCents: 0}, "cap_invalid");
        refuse({capCents: 100000001}, "cap_invalid");
        refuse({minimumCents: 5000, capCents: 4000}, "minimum_above_cap");
      });

  it("collects every error once", () => {
    const {errors} = billing.normalizeDeal({barrel: {centsEach: 0},
      shippedCar: {centsEach: -1}, minimumCents: 9, capCents: 1});
    assert.deepEqual(errors.sort(), ["amount_invalid", "minimum_above_cap"]);
  });

  it("keeps a good deal and fills the defaults", () => {
    const {deal} = billing.normalizeDeal({package: {mode: "percent",
      bps: 500}, minimumCents: 1000});
    assert.deepEqual(deal.package, {mode: "percent", bps: 500, minCents: 0});
    assert.equal(deal.flatCents, 0);
    assert.equal(deal.capCents, null);
    assert.equal(billing.isEmptyDeal(deal), false);
    assert.equal(billing.isEmptyDeal(billing.emptyDeal()), true);
    assert.equal(billing.isEmptyDeal({...billing.emptyDeal(),
      minimumCents: 100}), false);
  });

  it("names the extra reads a deal needs", () => {
    assert.deepEqual(billing.dealNeeds(null),
        {packagePrices: false, parking: false, items: false, bank: false});
    assert.deepEqual(billing.dealNeeds(billing.normalizeDeal({
      package: {mode: "percent", bps: 100}, parking: {mode: "perCar",
        centsEach: 1}, itemSold: {centsEach: 1}}).deal),
    {packagePrices: true, parking: true, items: true, bank: false});
    assert.equal(billing.dealNeeds(billing.normalizeDeal({
      package: {mode: "fixed", centsEach: 1}}).deal).packagePrices, false);
    assert.equal(billing.dealNeeds(billing.normalizeDeal({
      bankCheck: {centsEach: 15}}).deal).bank, true);
    assert.equal(billing.dealNeeds(billing.normalizeDeal({
      bankConnection: {centsEach: 300}}).deal).bank, true);
    assert.deepEqual(billing.mergeNeeds({parking: true}, {items: true}),
        {packagePrices: false, parking: true, items: true, bank: false});
  });

  it("bank lines are optional: deals saved before read as no bank charge",
      () => {
        // A deal stored before Check bank existed has neither key.
        const old = billing.storedDeal({barrel: {centsEach: 100}});
        assert.equal(old.bankConnection, null);
        assert.equal(old.bankCheck, null);
        assert.deepEqual(billing.computeBill({deal: old,
          usage: {barrels: 2, bankConnected: true, bankRefreshes: 50}})
            .lines.map((l) => l.key), ["barrels"]);
        const deal = billing.normalizeDeal({bankConnection: {centsEach: 300},
          bankCheck: {centsEach: 15}}).deal;
        assert.deepEqual([deal.bankConnection, deal.bankCheck],
            [{centsEach: 300}, {centsEach: 15}]);
        assert.equal(billing.isEmptyDeal(deal), false);
        assert.deepEqual(billing.normalizeDeal({bankCheck: {centsEach: 0}})
            .errors, ["amount_invalid"]);
        assert.deepEqual(billing.normalizeDeal({bankConnection: 5}).errors,
            ["deal_invalid"]);
        assert.ok(billing.CHARGE_KEYS.includes("bankConnection"));
        assert.ok(billing.CHARGE_KEYS.includes("bankChecks"));
      });

  it("bank lines show what they were worked out from", () => {
    const bill = billing.computeBill({deal: billing.normalizeDeal({
      bankConnection: {centsEach: 300}, bankCheck: {centsEach: 15}}).deal,
    usage: {bankConnected: true, bankRefreshes: 7}});
    assert.deepEqual(bill.lines, [
      {key: "bankConnection", mode: "fixed", quantity: 1, centsEach: 300,
        cents: 300},
      {key: "bankChecks", mode: "fixed", quantity: 7, centsEach: 15,
        cents: 105},
    ]);
    // Usage that was not read (null) bills nothing rather than guessing.
    const unread = billing.computeBill({deal: billing.normalizeDeal({
      bankConnection: {centsEach: 300}}).deal, usage: {}});
    assert.equal(unread.amountCents, 0);
    assert.equal(billing.normalizeUsage({}).bankConnected, null);
    assert.equal(billing.normalizeUsage({}).bankRefreshes, null);
  });

  it("an unreadable stored deal reads as no charge", () => {
    assert.deepEqual(billing.storedDeal({barrel: {centsEach: -4}}),
        billing.emptyDeal());
  });
});

describe("the deal in effect for a month", () => {
  const v = (id, effectiveFrom, createdAtMs, centsEach) => ({id,
    effectiveFrom, createdAtMs, deal: {barrel: {centsEach}}});
  const versions = [
    v("a", "2026-01", 1, 100),
    v("b", "2026-06", 2, 200),
    v("c", "2026-06", 5, 300), // saved later for the same month: wins
    v("d", "2026-12", 3, 400), // future
    v("e", "2026-03", 9, 150), // saved last, but an earlier month
  ];

  it("takes the greatest effective month not after the month", () => {
    assert.equal(billing.dealInEffect(versions, "2025-12"), null);
    assert.equal(billing.dealInEffect(versions, "2026-01").id, "a");
    assert.equal(billing.dealInEffect(versions, "2026-04").id, "e");
    assert.equal(billing.dealInEffect(versions, "2026-06").id, "c");
    assert.equal(billing.dealInEffect(versions, "2026-11").id, "c");
    assert.equal(billing.dealInEffect(versions, "2027-02").id, "d");
    assert.equal(billing.dealInEffect(versions, "2026-07").deal.barrel
        .centsEach, 300);
  });

  it("adds versions oldest first", () => {
    const list = billing.addVersion(versions.slice(0, 2),
        v("z", "2025-11", 10, 1));
    assert.deepEqual(list.map((x) => x.id), ["z", "a", "b"]);
  });

  it("refuses a bad, far, closed effective month and a long note", () => {
    const base = {currentMonth: "2026-10", note: ""};
    assert.deepEqual(billing.dealSaveErrors({...base,
      effectiveFrom: "2026-13"}), ["effective_month_invalid"]);
    assert.deepEqual(billing.dealSaveErrors({...base,
      effectiveFrom: "2024-09"}), ["effective_month_out_of_range"]);
    assert.deepEqual(billing.dealSaveErrors({...base,
      effectiveFrom: "2024-10"}), []);
    assert.deepEqual(billing.dealSaveErrors({...base,
      effectiveFrom: "2027-11"}), ["effective_month_out_of_range"]);
    assert.deepEqual(billing.dealSaveErrors({...base,
      effectiveFrom: "2026-09", closedMonths: new Set(["2026-09"])}),
    ["effective_month_closed"]);
    assert.deepEqual(billing.dealSaveErrors({...base,
      effectiveFrom: "2026-10", note: "x".repeat(301)}), ["note_too_long"]);
    assert.deepEqual(billing.dealSaveErrors({...base,
      effectiveFrom: "2026-10", versionCount: 120}), ["deal_history_full"]);
  });

  it("lists past months a deal applied to that are still open", () => {
    const list = [v("a", "2026-07", 1, 100)];
    assert.deepEqual(billing.pastOpenMonths({versions: list,
      closedMonths: new Set(["2026-08"]), currentMonth: "2026-10"}),
    ["2026-09", "2026-07"]);
    // An empty deal from September on ends the billing.
    const ended = [...list, {id: "b", effectiveFrom: "2026-09",
      createdAtMs: 2, deal: {}}];
    assert.deepEqual(billing.pastOpenMonths({versions: ended,
      closedMonths: new Set(), currentMonth: "2026-10"}),
    ["2026-08", "2026-07"]);
    assert.deepEqual(billing.pastOpenMonths({versions: [],
      closedMonths: new Set(), currentMonth: "2026-10"}), []);
  });
});

describe("package prices come from the pieces", () => {
  it("one per box/other piece; barrels, cars and pickup fees are not",
      () => {
        const prices = billing.packagePricesOfLines([
          {kind: "other", pieces: [
            {kind: "barrel", priceCents: 9000},
            {kind: "box", description: "TV", priceCents: 4000},
            {kind: "other", description: "Bag", priceCents: null},
          ], pickupFeeCents: 2500, priceCents: 15500},
          {kind: "car", priceCents: 120000},
          // Legacy: $100 over 3 packages is 33.34, 33.33, 33.33.
          {kind: "other", quantity: 3, priceCents: 10000},
          {kind: "barrels", quantity: 2, priceCents: 5000},
          {kind: "other", pieces: [{kind: "box", description: "x",
            priceCents: 0}]},
        ]);
        assert.deepEqual(prices, [4000, null, 3334, 3333, 3333, 0]);
      });
});

describe("drift after a month is closed", () => {
  const {deal} = billing.normalizeDeal({package: {mode: "fixed",
    centsEach: 100}, barrel: {centsEach: 500}});
  const usage = {barrels: 10, packages: 87, cars: 1};
  const bill = billing.computeBill({deal, usage, commissionCents: 900});
  const snapshot = {deal, usage: billing.normalizeUsage(usage), bill};

  it("nothing changed: no drift", () => {
    const drift = billing.billDrift(snapshot, usage, 900);
    assert.equal(drift.changed, false);
    assert.deepEqual(drift.items, []);
    assert.equal(drift.amountDeltaCents, 0);
    assert.equal(drift.closedAmountCents, 13700);
  });

  it("3 packages added and commission moved: listed, amount recomputed",
      () => {
        const drift = billing.billDrift(snapshot,
            {...usage, packages: 90}, 1000);
        assert.equal(drift.changed, true);
        assert.deepEqual(drift.items.map((i) => [i.key, i.delta]),
            [["packages", 3], ["commissionCents", 100]]);
        assert.equal(drift.amountNowCents, 14000);
        assert.equal(drift.amountDeltaCents, 300);
        assert.equal(drift.closedAmountCents, 13700);
      });

  it("figures not read at close are not compared", () => {
    const drift = billing.billDrift(snapshot, {...usage, parkingCars: 4,
      itemsSold: 7}, 900);
    assert.equal(drift.changed, false);
  });

  it("bank refreshes counted after the close show as drift", () => {
    const bankDeal = billing.normalizeDeal({bankCheck: {centsEach: 20}})
        .deal;
    const before = {bankConnected: true, bankRefreshes: 10};
    const closed = {deal: bankDeal, usage: billing.normalizeUsage(before),
      bill: billing.computeBill({deal: bankDeal, usage: before})};
    const drift = billing.billDrift(closed, {bankConnected: true,
      bankRefreshes: 12}, 0);
    assert.deepEqual(drift.items.map((i) => [i.key, i.delta]),
        [["bankRefreshes", 2]]);
    assert.equal(drift.closedAmountCents, 200);
    assert.equal(drift.amountNowCents, 240);
    // A month closed before Check bank existed never reads as drift.
    assert.equal(billing.billDrift(snapshot, {...usage, bankConnected: true,
      bankRefreshes: 3}, 900).changed, false);
  });

  it("package prices drift in percent deals", () => {
    const pct = billing.normalizeDeal({package: {mode: "percent",
      bps: 1000, minCents: 50}}).deal;
    const before = {packagePrices: [1000, null]};
    const closed = {deal: pct, usage: billing.normalizeUsage(before),
      bill: billing.computeBill({deal: pct, usage: before})};
    const drift = billing.billDrift(closed, {packagePrices: [1000, 2000]},
        0);
    assert.deepEqual(drift.items.map((i) => i.key),
        ["packagesNoPrice", "packagePriceCents"]);
    assert.equal(drift.closedAmountCents, 150);
    assert.equal(drift.amountNowCents, 300);
  });
});

describe("payments", () => {
  const ok = {amountCents: 5000, paidOn: "2026-10-03", method: "zelle",
    note: ""};

  it("accepts a good payment", () => {
    assert.deepEqual(billing.paymentErrors(ok, "2026-10-19"), []);
    for (const method of billing.PAYMENT_METHODS) {
      assert.deepEqual(billing.paymentErrors({...ok, method},
          "2026-10-19"), []);
    }
  });

  it("refuses bad amounts, days, methods and notes", () => {
    const codes = (input) => billing.paymentErrors({...ok, ...input},
        "2026-10-19");
    assert.deepEqual(codes({amountCents: 0}), ["amount_invalid"]);
    assert.deepEqual(codes({amountCents: -5}), ["amount_invalid"]);
    assert.deepEqual(codes({amountCents: 10.5}), ["amount_invalid"]);
    assert.deepEqual(codes({amountCents: 100000001}), ["amount_invalid"]);
    assert.deepEqual(codes({paidOn: "2026-10-20"}), ["paid_on_invalid"]);
    assert.deepEqual(codes({paidOn: "2026-02-30"}), ["paid_on_invalid"]);
    assert.deepEqual(codes({paidOn: "10/03/2026"}), ["paid_on_invalid"]);
    assert.deepEqual(codes({paidOn: "2019-12-31"}), ["paid_on_invalid"]);
    assert.deepEqual(codes({method: "bitcoin"}), ["method_invalid"]);
    assert.deepEqual(codes({note: "y".repeat(301)}), ["note_too_long"]);
  });

  it("stores the payment and sums the ones not voided", () => {
    const record = billing.paymentRecord({...ok, note: "  first  "},
        {businessId: "b1", month: "2026-09", recordedBy: "u1",
          recordedAtMs: 7});
    assert.deepEqual(record, {businessId: "b1", month: "2026-09",
      amountCents: 5000, paidOn: "2026-10-03", method: "zelle",
      note: "first", recordedBy: "u1", recordedAtMs: 7, voided: false});
    assert.equal(billing.sumPayments([record, {...record, amountCents: 300},
      {...record, voided: true}]), 5300);
  });

  it("says where a month stands", () => {
    assert.equal(billing.monthStanding({amountCents: 0, paidCents: 0})
        .status, "nothing_owed");
    assert.deepEqual(billing.monthStanding({amountCents: 1000,
      paidCents: 0}), {status: "unpaid", unpaidCents: 1000,
      overpaidCents: 0});
    assert.equal(billing.monthStanding({amountCents: 1000, paidCents: 400})
        .status, "partial");
    assert.equal(billing.monthStanding({amountCents: 1000, paidCents: 1000})
        .status, "paid");
    assert.deepEqual(billing.monthStanding({amountCents: 1000,
      paidCents: 1200}), {status: "overpaid", unpaidCents: 0,
      overpaidCents: 200});
  });

  it("a closed month refuses more than it still owes; open is free", () => {
    assert.equal(billing.paymentBalanceRefusal({closed: true,
      amountCents: 1000, paidCents: 400, addCents: 700}),
    "payment_exceeds_balance");
    assert.equal(billing.paymentBalanceRefusal({closed: true,
      amountCents: 1000, paidCents: 400, addCents: 600}), null);
    assert.equal(billing.paymentBalanceRefusal({closed: false,
      amountCents: 0, paidCents: 0, addCents: 600}), null);
  });

  it("a month can be closed once it is over", () => {
    assert.equal(billing.monthIsOver("2026-09", "2026-10"), true);
    assert.equal(billing.monthIsOver("2026-10", "2026-10"), false);
    assert.equal(billing.monthIsOver("2026-11", "2026-10"), false);
  });
});

describe("commission keep / replace", () => {
  it("replace zeroes the business rate and every service override", () => {
    const plan = billing.commissionReplacePlan({platformFeePct: 0.08,
      servicePlatformFeePct: {parkingPlatformFeePct: 0.05,
        freightPlatformFeePct: 0.12}});
    assert.deepEqual(plan.set, {platformFeePct: 0,
      "servicePlatformFeePct.freightPlatformFeePct": 0,
      "servicePlatformFeePct.parkingPlatformFeePct": 0});
    assert.deepEqual(plan.backup, {
      platformFeePct: {present: true, value: 0.08},
      servicePlatformFeePct: {freightPlatformFeePct: 0.12,
        parkingPlatformFeePct: 0.05}});
  });

  it("an inherited rate is backed up as absent", () => {
    const plan = billing.commissionReplacePlan({name: "Shop"});
    assert.deepEqual(plan.set, {platformFeePct: 0});
    assert.deepEqual(plan.backup.platformFeePct,
        {present: false, value: null});
  });

  it("keep restores exactly what was there", () => {
    const before = {platformFeePct: 0.08,
      servicePlatformFeePct: {parkingPlatformFeePct: 0.05}};
    const {backup, set} = billing.commissionReplacePlan(before);
    const replaced = {platformFeePct: set.platformFeePct,
      servicePlatformFeePct: {parkingPlatformFeePct: 0}};
    const restore = billing.commissionRestorePlan(replaced, backup);
    assert.deepEqual(restore.set, {platformFeePct: 0.08,
      "servicePlatformFeePct.parkingPlatformFeePct": 0.05});
    assert.deepEqual(restore.remove, []);
    assert.deepEqual(restore.notRestored, []);
  });

  it("an absent rate is removed again", () => {
    const {backup} = billing.commissionReplacePlan({});
    const restore = billing.commissionRestorePlan({platformFeePct: 0},
        backup);
    assert.deepEqual(restore.set, {});
    assert.deepEqual(restore.remove, ["platformFeePct"]);
  });

  it("a rate someone changed since is left alone", () => {
    const {backup} = billing.commissionReplacePlan({platformFeePct: 0.08,
      servicePlatformFeePct: {parkingPlatformFeePct: 0.05}});
    const restore = billing.commissionRestorePlan({platformFeePct: 0.06,
      servicePlatformFeePct: {parkingPlatformFeePct: 0}}, backup);
    assert.deepEqual(restore.set,
        {"servicePlatformFeePct.parkingPlatformFeePct": 0.05});
    assert.deepEqual(restore.notRestored, ["platformFeePct"]);
  });
});

describe("commission taken in a month", () => {
  it("sums earned lines of each business inside the window", () => {
    const window = {startMs: 1000, endMs: 2000};
    const map = billing.commissionByBusiness([
      {businessId: "a", state: "earned", feeCents: 100, ms: 1000},
      {businessId: "a", state: "earned", feeCents: 50, ms: 1999},
      {businessId: "a", state: "earned", feeCents: 70, ms: 2000},
      {businessId: "a", state: "pending", feeCents: 999, ms: 1500},
      {businessId: "b", state: "earned", feeCents: 30, ms: null},
      {businessId: "", state: "earned", feeCents: 30, ms: 1500},
      {businessId: "c", state: "earned", feeCents: 30, ms: 1500},
    ], window);
    assert.deepEqual([...map.entries()], [["a", 150], ["c", 30]]);
  });
});

describe("the month's table", () => {
  it("lists businesses with a deal first, then by name", () => {
    const rows = billing.orderCandidates([
      {businessId: "z", name: "alpha", hasDeal: false},
      {businessId: "y", name: "Zulu", hasDeal: true},
      {businessId: "x", name: "Bravo", hasDeal: true},
      {businessId: "w", name: "", hasDeal: false},
    ]);
    assert.deepEqual(rows.map((r) => r.businessId), ["x", "y", "z", "w"]);
  });

  it("sums the tiles", () => {
    assert.deepEqual(billing.summarizeRows([
      {amountCents: 1000, paidCents: 200, commissionCents: 50,
        hasDeal: true},
      {amountCents: 0, paidCents: 0, commissionCents: 25, hasDeal: false},
    ]), {owedCents: 1000, paidCents: 200, commissionCents: 75,
      earnedCents: 1075, businesses: 2, withDeal: 1});
  });

  it("every refusal code has a status and a message", () => {
    for (const code of Object.keys(billing.REFUSAL_STATUS)) {
      assert.ok(billing.REFUSAL_MESSAGES[code], code);
    }
    assert.deepEqual(Object.keys(billing.REFUSAL_MESSAGES).sort(),
        Object.keys(billing.REFUSAL_STATUS).sort());
  });

  it("months and days are strict", () => {
    assert.equal(billing.isMonthKey("2026-10"), true);
    assert.equal(billing.isMonthKey("2026-13"), false);
    assert.equal(billing.isDayKey("2024-02-29"), true);
    assert.equal(billing.isDayKey("2026-02-29"), false);
    assert.equal(billing.billingMonthId("a/b", "2026-10"), "a_b_2026-10");
  });
});

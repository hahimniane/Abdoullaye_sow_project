import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import * as billing from "./platform-billing.ts";
import { previewPlatformBilling, resetBillingPreview } from "./platform-billing-preview.ts";
import { currentVolumeMonth, shiftVolumeMonth } from "./volume.ts";

// The mirror discipline (docs/PLATFORM_BILLING.md): the server's
// functions/platform_billing.js is the authority; its shared cases run here
// exactly as the server runs them, and its refusal codes all read as words.

const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/platform-billing-cases.json", import.meta.url);
const { cases } = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
  cases: Array<{
    name: string;
    deal: unknown;
    usage: unknown;
    commissionCents: number;
    expect: Record<string, unknown> & { lines: Record<string, number> };
  }>;
};
const require = createRequire(import.meta.url);
const server = require("../../../my_flutter_app/functions/platform_billing.js") as {
  REFUSAL_MESSAGES: Record<string, string>;
  normalizeDeal: (raw: unknown) => { deal: unknown; errors: string[] };
  computeBill: (args: unknown) => unknown;
  normalizeUsage: (raw: unknown) => unknown;
  dealNeeds: (deal: unknown) => unknown;
  mergeNeeds: (...needs: unknown[]) => unknown;
  billDrift: (snapshot: unknown, liveUsage: unknown, liveCommissionCents: number) => { items: Array<{ key: string }> };
  CHARGE_KEYS: readonly string[];
};

test("the shared bill cases bill the same in the console", () => {
  assert.ok(cases.length >= 14);
  for (const c of cases) {
    const deal = c.deal === null ? null : billing.normalizeDeal(c.deal).deal;
    const bill = billing.computeBill({ deal, usage: c.usage, commissionCents: c.commissionCents });
    assert.deepEqual(Object.fromEntries(bill.lines.map((l) => [l.key, l.cents])), c.expect.lines, c.name);
    assert.equal(bill.amountCents, c.expect.amountCents, c.name);
    assert.equal(bill.chargesCents, c.expect.chargesCents, c.name);
    assert.equal(bill.minimumAdjustmentCents, c.expect.minimumAdjustmentCents, c.name);
    assert.equal(bill.capAdjustmentCents, c.expect.capAdjustmentCents, c.name);
    assert.equal(bill.earnedCents, c.expect.earnedCents, c.name);
    // And line for line, field for field, the server's own answer.
    const serverDeal = c.deal === null ? null : server.normalizeDeal(c.deal).deal;
    assert.deepEqual(bill, server.computeBill({ deal: serverDeal, usage: c.usage, commissionCents: c.commissionCents }), c.name);
  }
});

test("Check bank's three shared cases bill field for field as the server bills them", () => {
  const bank = cases.filter((c) => Object.keys(c.expect.lines).some((key) => key === "bankConnection" || key === "bankChecks"));
  assert.deepEqual(
    bank.map((c) => c.name),
    [
      "bank connection: one month's price when the business had an active bank link",
      "no active bank link: no connection charge; 37 paid refreshes x $0.20",
      "bank lines count toward the minimum like any charge",
    ],
  );
  for (const c of bank) {
    const mine = billing.normalizeDeal(c.deal);
    const theirs = server.normalizeDeal(c.deal);
    assert.deepEqual(mine.errors, [], c.name);
    assert.deepEqual(mine.deal, theirs.deal, c.name);
    assert.deepEqual(billing.normalizeUsage(c.usage), server.normalizeUsage(c.usage), c.name);
    const bill = billing.computeBill({ deal: mine.deal, usage: c.usage, commissionCents: c.commissionCents });
    assert.deepEqual(bill, server.computeBill({ deal: theirs.deal, usage: c.usage, commissionCents: c.commissionCents }), c.name);
    for (const [key, cents] of Object.entries(c.expect.lines)) {
      assert.equal(bill.lines.find((line) => line.key === key)?.cents, cents, `${c.name}: ${key}`);
    }
    for (const field of ["chargesCents", "amountCents", "minimumAdjustmentCents", "capAdjustmentCents", "earnedCents"] as const) {
      assert.equal(bill[field], c.expect[field], `${c.name}: ${field}`);
    }
  }
});

test("bank charge keys, drift figures and deal needs follow the server", () => {
  assert.deepEqual([...billing.CHARGE_KEYS], [...server.CHARGE_KEYS]);
  for (const key of billing.CHARGE_KEYS) assert.ok(billing.CHARGE_LABELS[key], key);
  // Every drift figure differs, so the server lists them all, in its order.
  const before = { barrels: 1, packages: 1, packagePrices: [100], cars: 1, parkingCars: 1, parkingBilledCents: 1, itemsSold: 1, bankConnected: false, bankRefreshes: 1 };
  const after = { barrels: 2, packages: 2, packagePrices: [null, 300], cars: 2, parkingCars: 2, parkingBilledCents: 2, itemsSold: 2, bankConnected: true, bankRefreshes: 3 };
  const drift = server.billDrift({ usage: before, deal: null, bill: { commissionCents: 1, amountCents: 0 } }, after, 2);
  assert.deepEqual(drift.items.map((item) => item.key), billing.DRIFT_KEYS.map(([key]) => key));
  for (const [key] of billing.DRIFT_KEYS) assert.ok(billing.DRIFT_LABELS[key], key);
  for (const raw of [null, { bankConnection: { centsEach: 300 } }, { bankCheck: { centsEach: 20 } }, { itemSold: { centsEach: 5 }, parking: { mode: "perCar", centsEach: 100 } }]) {
    const deal = raw === null ? null : billing.normalizeDeal(raw).deal;
    assert.deepEqual(billing.dealNeeds(deal), server.dealNeeds(raw === null ? null : server.normalizeDeal(raw).deal), JSON.stringify(raw));
  }
  const a = billing.dealNeeds(billing.normalizeDeal({ bankCheck: { centsEach: 20 } }).deal);
  const b = billing.dealNeeds(null);
  assert.deepEqual(billing.mergeNeeds(a, b, null), server.mergeNeeds(a, b, null));
});

test("the bank deal lines round-trip the form and read as segments", () => {
  const deal = billing.normalizeDeal({ bankConnection: { centsEach: 300 }, bankCheck: { centsEach: 20 } }).deal;
  assert.ok(deal);
  assert.equal(billing.isEmptyDeal(deal), false);
  assert.deepEqual(billing.dealFromDraft(billing.draftFromDeal(deal)).deal, deal);
  const draft = { ...billing.emptyDealDraft(), bankCheckMode: "fixed" as const, bankCheck: "0,20" };
  assert.deepEqual(billing.dealFromDraft(draft).deal?.bankCheck, { centsEach: 20 });
  const bad = billing.dealFromDraft({ ...billing.emptyDealDraft(), bankConnectionMode: "fixed", bankConnection: "0" });
  assert.equal(bad.deal, null);
  assert.equal(bad.errors.bankConnection, billing.DRAFT_MESSAGES.amount);
  assert.deepEqual(
    billing.dealSegments(deal).map((s) => [s.key, s.label, s.cents, s.unit]),
    [
      ["bankConnection", "Bank connection", 300, "a month with a connected bank"],
      ["bankChecks", "Bank checks", 20, "per paid refresh"],
    ],
  );
  // A deal saved before Check bank has neither line.
  const old = billing.normalizeDeal({ barrel: { centsEach: 500 } }).deal;
  assert.equal(old?.bankConnection, null);
  assert.equal(old?.bankCheck, null);
});

test("the console refuses a deal exactly as the server does", () => {
  const samples: unknown[] = [
    null,
    [],
    { barrel: 5 },
    { barrel: { centsEach: 0 } },
    { barrel: { centsEach: 1.5 } },
    { package: { mode: "weight" } },
    { package: { mode: "percent", bps: 0 } },
    { package: { mode: "percent", bps: 500, minCents: -1 } },
    { parking: { mode: "percent", bps: 10001 } },
    { minimumCents: 0 },
    { capCents: 0 },
    { minimumCents: 500, capCents: 100 },
    { flatCents: -2 },
    { itemSold: { centsEach: 25 }, capCents: 900 },
    { bankConnection: { centsEach: 0 } },
    { bankCheck: { centsEach: 2.5 } },
    { bankCheck: 20 },
    { bankConnection: { centsEach: 300 }, bankCheck: { centsEach: 20 }, minimumCents: 1000 },
  ];
  for (const raw of samples) {
    const mine = billing.normalizeDeal(raw);
    const theirs = server.normalizeDeal(raw);
    assert.deepEqual([...mine.errors].sort(), [...theirs.errors].sort(), JSON.stringify(raw));
    assert.deepEqual(mine.deal, theirs.deal, JSON.stringify(raw));
  }
});

test("every server refusal a person can meet has words, in French too", async () => {
  const { translateValue } = await import("./french-dom.ts");
  for (const code of Object.keys(server.REFUSAL_MESSAGES)) {
    if (code === "action_invalid" || code === "cursor_invalid") continue; // never from the screens
    const text = billing.REFUSAL_TEXT[code];
    assert.ok(text, `${code} has no console text`);
    assert.notEqual(translateValue(text, "fr"), text, `${code} is not translated`);
  }
  assert.equal(billing.refusalMessage({ details: { reasons: ["payment_exceeds_balance"] } }), "That is more than this month still owes.");
  assert.equal(billing.refusalMessage(new Error("boom")), billing.GENERIC_FAILURE);
});

test("a typed percentage reads like money: hundredths, French comma, refused when finer", () => {
  assert.equal(billing.percentToBps("5"), 500);
  assert.equal(billing.percentToBps("2.5"), 250);
  assert.equal(billing.percentToBps("2,5"), 250);
  assert.equal(billing.percentToBps("0.01"), 1);
  assert.equal(billing.percentToBps("2.555"), null);
  assert.equal(billing.percentToBps("five"), null);
  assert.equal(billing.bpsToInput(250), "2.5");
  assert.equal(billing.centsToInput(25), "0.25");
  assert.equal(billing.centsToInput(500), "5");
});

test("the deal form round-trips a deal and names each bad field", () => {
  const deal = billing.normalizeDeal({
    barrel: { centsEach: 500 },
    package: { mode: "percent", bps: 250, minCents: 100 },
    shippedCar: { centsEach: 4000 },
    parking: { mode: "percent", bps: 1000 },
    itemSold: { centsEach: 15 },
    flatCents: 2500,
    minimumCents: 5000,
    capCents: 90000,
  }).deal;
  assert.ok(deal);
  assert.deepEqual(billing.dealFromDraft(billing.draftFromDeal(deal)).deal, deal);
  assert.deepEqual(billing.dealFromDraft(billing.emptyDealDraft()), { deal: billing.emptyDeal(), errors: {} });

  const draft = { ...billing.emptyDealDraft(), barrelMode: "fixed" as const, barrel: "0", packageMode: "percent" as const, packagePct: "120" };
  const { deal: none, errors } = billing.dealFromDraft(draft);
  assert.equal(none, null);
  assert.equal(errors.barrel, billing.DRAFT_MESSAGES.amount);
  assert.equal(errors.packagePct, billing.DRAFT_MESSAGES.percent);
  const limits = billing.dealFromDraft({ ...billing.emptyDealDraft(), minimum: "500", cap: "100" });
  assert.equal(limits.errors.minimum, billing.DRAFT_MESSAGES.minimumAboveCap);
  // "12,50" is twelve dollars fifty, not 1,250.
  const comma = billing.dealFromDraft({ ...billing.emptyDealDraft(), itemMode: "fixed", item: "0,25", flat: "12,50" });
  assert.equal(comma.deal?.itemSold?.centsEach, 25);
  assert.equal(comma.deal?.flatCents, 1250);
});

test("a deal reads as short segments; amounts stay data", () => {
  const deal = billing.normalizeDeal({ barrel: { centsEach: 500 }, parking: { mode: "percent", bps: 1000 }, minimumCents: 5000 }).deal;
  assert.deepEqual(
    billing.dealSegments(deal).map((s) => [s.key, s.label, s.cents ?? s.bps, s.unit ?? ""]),
    [
      ["barrels", "Barrels", 500, "per barrel"],
      ["parking", "Parking", 1000, "of parking billed"],
      ["minimum", "Monthly minimum", 5000, ""],
    ],
  );
  assert.deepEqual(billing.dealSegments(null), []);
  assert.equal(billing.formatBps(250, "fr"), "2,5 %");
  assert.equal(billing.formatCents(125000, "fr"), "1 250,00 $");
  assert.equal(billing.formatDelta(-300, "cents"), "−$3.00");
  assert.equal(billing.formatDelta(3, "count"), "+3");
});

test("payments: today in New York is the latest day; methods are the agreed six", () => {
  const today = "2026-10-19";
  const ok = { amount: "40", paidOn: "2026-10-19", method: "zelle", note: "" };
  assert.deepEqual(billing.paymentDraftErrors(ok, today), {});
  assert.ok(billing.paymentDraftErrors({ ...ok, paidOn: "2026-10-20" }, today).paidOn);
  assert.ok(billing.paymentDraftErrors({ ...ok, paidOn: "2026-02-30" }, today).paidOn);
  assert.ok(billing.paymentDraftErrors({ ...ok, amount: "0" }, today).amount);
  assert.ok(billing.paymentDraftErrors({ ...ok, method: "venmo" }, today).method);
  assert.deepEqual(billing.PAYMENT_METHODS, ["zelle", "cash", "card", "bank_transfer", "check", "other"]);
  assert.equal(billing.todayInNewYork(new Date("2026-10-20T03:30:00Z")), "2026-10-19");
  assert.equal(billing.monthIsOver("2026-09", "2026-10"), true);
  assert.equal(billing.monthIsOver("2026-10", "2026-10"), false);
  const months = billing.effectiveMonthOptions("2026-10");
  assert.equal(months[0], "2024-10");
  assert.equal(months[months.length - 1], "2027-10");
  assert.equal(months.length, 37);
});

test("the preview answers like the server: refuses, records, closes, reopens", async () => {
  resetBillingPreview();
  const current = currentVolumeMonth();
  const prev = shiftVolumeMonth(current, -1);
  const month = (await previewPlatformBilling({ action: "getMonthBills", month: prev }, current)) as billing.MonthBillsResponse;
  const atlantic = month.rows.find((row) => row.businessId === "atlantic_exports");
  assert.equal(atlantic?.status, "closed");
  assert.equal(atlantic?.drift?.changed, true);
  assert.equal(month.rows[0].hasDeal, true);
  const reasons = async (data: Record<string, unknown>) => {
    try {
      await previewPlatformBilling(data, current);
      return [];
    } catch (error) {
      return (error as { details: { reasons: string[] } }).details.reasons;
    }
  };
  assert.deepEqual(await reasons({ action: "closeMonth", businessId: "keren_auto_sales", month: current }), ["month_not_over"]);
  const owed = (await previewPlatformBilling({ action: "getBusinessBill", businessId: "atlantic_exports", month: prev }, current)) as billing.BusinessBillResponse;
  assert.deepEqual(
    await reasons({ action: "recordPayment", businessId: "atlantic_exports", month: prev, amountCents: owed.unpaidCents + 1, paidOn: billing.todayInNewYork(), method: "cash" }),
    ["payment_exceeds_balance"],
  );
  await previewPlatformBilling({ action: "recordPayment", businessId: "atlantic_exports", month: prev, amountCents: owed.unpaidCents, paidOn: billing.todayInNewYork(), method: "cash" }, current);
  const paid = (await previewPlatformBilling({ action: "getBusinessBill", businessId: "atlantic_exports", month: prev }, current)) as billing.BusinessBillResponse;
  assert.equal(paid.standing.status, "paid");
  assert.deepEqual(await reasons({ action: "reopenMonth", businessId: "atlantic_exports", month: prev, reason: "" }), ["reason_required"]);
  await previewPlatformBilling({ action: "reopenMonth", businessId: "atlantic_exports", month: prev, reason: "Missed barrels" }, current);
  const open = (await previewPlatformBilling({ action: "getBusinessBill", businessId: "atlantic_exports", month: prev }, current)) as billing.BusinessBillResponse;
  assert.equal(open.status, "open");
  assert.equal(open.reopenHistory.length, 1);
  const what = (await previewPlatformBilling({ action: "whatIf", month: prev, deal: { parking: { mode: "perCar", centsEach: 500 } } }, current)) as billing.WhatIfAllResponse;
  assert.ok(what.rows.some((row) => row.businessId === "dakar_parking"));
  assert.equal(what.totals.altCents, what.rows.reduce((sum, row) => sum + row.altCents, 0));
  resetBillingPreview();
});

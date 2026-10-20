import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import {
  AMOUNT_MESSAGE,
  BANK_SINCE_OPTIONS,
  DEFAULT_REFRESH_LIMIT,
  DEFAULT_SINCE,
  LIMIT_MESSAGE,
  MAX_CHECK_CENTS,
  MAX_REFRESH_LIMIT,
  RECORD_KIND_LABELS,
  STANDALONE_TEXT,
  TEAM_MEMBER,
  USAGE_TEXT,
  USE_TEXT,
  canCheckBank,
  checkBankEntry,
  readBankUsage,
  readCheckAmount,
  readOwnerBankExtras,
  readRefreshLimit,
  readStandaloneAnswer,
  readUseRecords,
  setRefreshLimitRequest,
  staffName,
  standaloneCheckRequest,
  useDepositRequest,
  useRecordsRequest,
} from "./bank-check.ts";
import { previewBankCall, resetBankPreview } from "./bank-check-preview.ts";
import { BANK_ERROR_MESSAGES, ZELLE_MESSAGES, nextRecheckInMs, zelleFailureMessage } from "./zelle-check.ts";

// The server is the authority (functions/bank_check.js, zelle_check.js);
// these tests hold the console's half of "Check bank any time" to it.
const require = createRequire(import.meta.url);
const server = require("../../../my_flutter_app/functions/bank_check.js") as {
  SINCE_OPTIONS: readonly string[];
  DEFAULT_SINCE: string;
  MAX_CHECK_CENTS: number;
  DEFAULT_REFRESH_LIMIT: number;
  MAX_REFRESH_LIMIT: number;
  REFRESH_COST_CENTS: number;
  cleanCheckCents: (value: unknown) => number | null;
  cleanRefreshLimit: (value: unknown) => number | null;
  usageView: (input: unknown) => Record<string, unknown>;
};
const zelleServer = require("../../../my_flutter_app/functions/zelle_check.js") as {
  BANK_REFUSALS: Record<string, [string, string]>;
};

test("the console's bounds are the server's", () => {
  assert.deepEqual(BANK_SINCE_OPTIONS.map((o) => o.value), [...server.SINCE_OPTIONS]);
  assert.equal(DEFAULT_SINCE, server.DEFAULT_SINCE);
  assert.equal(MAX_CHECK_CENTS, server.MAX_CHECK_CENTS);
  assert.equal(DEFAULT_REFRESH_LIMIT, server.DEFAULT_REFRESH_LIMIT);
  assert.equal(MAX_REFRESH_LIMIT, server.MAX_REFRESH_LIMIT);
});

test("who sees Check bank: the server's rule, and the header's three states", () => {
  const base = { isOwner: false, inventoryPermission: false, inventoryService: false, containersPermission: false };
  assert.equal(canCheckBank({ ...base, isOwner: true }), true);
  assert.equal(canCheckBank({ ...base, inventoryPermission: true, inventoryService: true }), true);
  // The inventory permission without the service is not enough.
  assert.equal(canCheckBank({ ...base, inventoryPermission: true }), false);
  assert.equal(canCheckBank({ ...base, containersPermission: true }), true);
  assert.equal(canCheckBank(base), false);

  const active = { connected: true, status: "active" as const };
  const reauth = { connected: true, status: "needs_reauth" as const };
  const none = { connected: false, status: "disconnected" as const };
  assert.equal(checkBankEntry(null, true, true), "none");
  assert.equal(checkBankEntry(active, true, false), "button");
  assert.equal(checkBankEntry(active, false, false), "none");
  assert.equal(checkBankEntry(reauth, true, true), "reconnect_hint");
  assert.equal(checkBankEntry(none, true, true), "connect_hint");
  // Staff never see a hint they cannot act on.
  assert.equal(checkBankEntry(reauth, true, false), "none");
  assert.equal(checkBankEntry(none, true, false), "none");
});

test("the typed amount is whole cents the server accepts, or the sentence", () => {
  assert.deepEqual(readCheckAmount("40"), { cents: 4000, error: "" });
  assert.deepEqual(readCheckAmount("40.5"), { cents: 4050, error: "" });
  assert.deepEqual(readCheckAmount("40,50"), { cents: 4050, error: "" });
  assert.deepEqual(readCheckAmount("0.01"), { cents: 1, error: "" });
  for (const bad of ["", "0", "-5", "abc", "1000001", "4.005"]) {
    assert.deepEqual(readCheckAmount(bad), { cents: null, error: AMOUNT_MESSAGE }, bad);
  }
  for (const typed of ["40", "40,50", "0.01", "1000000"]) {
    const read = readCheckAmount(typed);
    assert.equal(server.cleanCheckCents(read.cents), read.cents, typed);
  }
  // The sentence is the server's own refusal for a bad amount.
  assert.equal(AMOUNT_MESSAGE, zelleServer.BANK_REFUSALS.check_amount_invalid[1]);
});

test("the requests carry the contract's names; a click sends no auto", () => {
  assert.deepEqual(standaloneCheckRequest(" b1 ", 4000, "1h"), { businessId: "b1", mode: "standalone", amountCents: 4000, since: "1h" });
  assert.deepEqual(standaloneCheckRequest("b1", 4000, "15m", true), { businessId: "b1", mode: "standalone", amountCents: 4000, since: "15m", auto: true });
  assert.deepEqual(useRecordsRequest("b1", "c1"), { businessId: "b1", mode: "records", creditId: "c1" });
  assert.deepEqual(useRecordsRequest("b1", "c1", "  Mariama   Sow "), { businessId: "b1", mode: "records", creditId: "c1", query: "Mariama Sow" });
  assert.equal(useRecordsRequest("b1", "c1", "x".repeat(200)).query?.length, 80);
  assert.deepEqual(useDepositRequest("b1", "c1", "inventory_sale", "s1"), { businessId: "b1", mode: "use", creditId: "c1", kind: "inventory_sale", id: "s1" });
  assert.deepEqual(setRefreshLimitRequest("b1", 0), { businessId: "b1", refreshLimit: 0 });
});

test("a standalone answer is read defensively: the result agrees with the deposits", () => {
  const one = readStandaloneAnswer({
    result: "several",
    deposits: [{ creditId: "c1", amountCents: 4000, atMs: 10, timeKnown: false, senderName: "  FATOU BAH ", pending: true }, { amountCents: 4000 }],
    since: "today",
    fromMs: 5,
    limitReached: true,
  });
  assert.equal(one.result, "received");
  assert.deepEqual(one.deposits, [{ creditId: "c1", amountCents: 4000, atMs: 10, timeKnown: false, senderName: "FATOU BAH", pending: true }]);
  assert.equal(one.since, "today");
  assert.equal(one.limitReached, true);
  assert.equal(readStandaloneAnswer({ deposits: [{ creditId: "a" }, { creditId: "b" }] }).result, "several");
  const empty = readStandaloneAnswer(null);
  assert.deepEqual(empty, { result: "not_found", deposits: [], since: "15m", fromMs: null, limitReached: false });
});

test("Use for a sale lists only the record kinds it knows", () => {
  const read = readUseRecords({
    searched: true,
    records: [
      { kind: "inventory_sale", id: "s1", amountCents: 4000, atMs: 1, who: "Mariama", what: "Rice" },
      { kind: "car_payment", id: "x1", amountCents: 4000 },
      { kind: "container_line_payment", id: "", amountCents: 4000 },
    ],
  });
  assert.equal(read.searched, true);
  assert.deepEqual(read.records, [{ kind: "inventory_sale", id: "s1", amountCents: 4000, atMs: 1, who: "Mariama", what: "Rice" }]);
  assert.deepEqual(readUseRecords(undefined), { records: [], searched: false });
});

test("the month's usage reads the server's own usageView; a nameless person is a team member", () => {
  const view = server.usageView({
    month: "2026-10",
    limit: 40,
    usage: { checks: 23, refreshes: 40, refreshesFailed: 1, byUid: { u1: { checks: 14, refreshes: 11 }, u2: { checks: 3, refreshes: 2 }, u3: { checks: 0 } } },
    names: new Map([["u1", "Aminata Diallo"]]),
  });
  const usage = readBankUsage(view);
  assert.ok(usage);
  assert.deepEqual(usage, view);
  assert.equal(usage.estimatedCostCents, 40 * server.REFRESH_COST_CENTS);
  assert.equal(usage.limitReached, true);
  assert.deepEqual(usage.byStaff.map(staffName), ["Aminata Diallo", ""]);
  assert.equal(readBankUsage(null), null);
  assert.equal(readBankUsage([]), null);
  // A bad month or limit reads as none / the default, never as garbage.
  const odd = readBankUsage({ month: "2026-13", refreshLimit: "lots", refreshes: 3 });
  assert.equal(odd?.month, "");
  assert.equal(odd?.refreshLimit, DEFAULT_REFRESH_LIMIT);
  assert.deepEqual(readOwnerBankExtras({ refreshLimit: 0 }), { refreshLimit: 0, usage: null });
  assert.equal(readOwnerBankExtras({}).refreshLimit, DEFAULT_REFRESH_LIMIT);
});

test("the typed monthly limit is what the server would keep", () => {
  for (const typed of ["0", "100", "1000", " 25 "]) {
    const read = readRefreshLimit(typed);
    assert.equal(read.error, "", typed);
    assert.equal(read.limit, server.cleanRefreshLimit(typed), typed);
  }
  for (const bad of ["", "-1", "1001", "2.5", "ten", "10000"]) {
    assert.deepEqual(readRefreshLimit(bad), { limit: null, error: LIMIT_MESSAGE }, bad);
  }
});

test("automatic re-checks fall every 20 s for 3 minutes, then stop", () => {
  assert.equal(nextRecheckInMs(0, 0), 20_000);
  assert.equal(nextRecheckInMs(0, 5_000), 15_000);
  assert.equal(nextRecheckInMs(0, 20_000), 20_000);
  assert.equal(nextRecheckInMs(0, 170_000), 10_000);
  assert.equal(nextRecheckInMs(0, 180_000), null);
  assert.equal(nextRecheckInMs(Number.NaN, 0), null);
});

test("the new refusals read as the server's sentences; a busy bank says so", () => {
  for (const code of ["mode_invalid", "check_amount_invalid", "since_invalid", "limit_invalid", "amount_mismatch"]) {
    assert.equal(ZELLE_MESSAGES[code], zelleServer.BANK_REFUSALS[code][1], code);
    assert.equal(zelleFailureMessage({ code: "functions/invalid-argument", details: { reason: code } }), ZELLE_MESSAGES[code]);
  }
  assert.equal(zelleFailureMessage({ details: { reason: "bank_error", bankError: "rate_limited" } }), BANK_ERROR_MESSAGES.rate_limited);
  assert.equal(zelleFailureMessage({ details: { reason: "bank_error", bankError: "link_expired" } }), ZELLE_MESSAGES.bank_needs_reauth);
  assert.equal(zelleFailureMessage({ details: { reason: "bank_error", bankError: "other" } }), ZELLE_MESSAGES.bank_error);
});

test("the preview answers like the server: received, several, not yet, then use", async () => {
  resetBankPreview();
  const now = Date.UTC(2026, 9, 20, 15);
  const one = readStandaloneAnswer(await previewBankCall("checkZellePayment", standaloneCheckRequest("b", 4000, "15m"), now));
  assert.equal(one.result, "received");
  assert.equal(readStandaloneAnswer(await previewBankCall("checkZellePayment", standaloneCheckRequest("b", 2500, "today"), now)).result, "several");
  assert.equal(readStandaloneAnswer(await previewBankCall("checkZellePayment", standaloneCheckRequest("b", 1234, "1h"), now)).result, "not_found");
  const records = readUseRecords(await previewBankCall("confirmZelleCandidate", useRecordsRequest("b", one.deposits[0].creditId), now));
  assert.equal(records.records.length, 3);
  assert.ok(records.records.every((r) => r.amountCents === 4000));
  const used = await previewBankCall("confirmZelleCandidate", useDepositRequest("b", one.deposits[0].creditId, records.records[0].kind, records.records[0].id), now);
  assert.equal((used as { result: string }).result, "confirmed");
  // Spent: the deposit no longer shows.
  assert.equal(readStandaloneAnswer(await previewBankCall("checkZellePayment", standaloneCheckRequest("b", 4000, "15m"), now)).result, "not_found");
  await assert.rejects(previewBankCall("setBankCheckWindow", setRefreshLimitRequest("b", 5000), now), (e: { details: { reason: string } }) => e.details.reason === "limit_invalid");
  resetBankPreview();
});

test("the three labels that clashed with other screens' French are renamed", () => {
  assert.equal(STANDALONE_TEXT.received, "Deposit received");
  assert.equal(USE_TEXT.searched, "Search results");
  const dialog = readFileSync(new URL("../components/business/check-bank-dialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, />Use this one</);
  assert.doesNotMatch(dialog, />Use</);
  // "Check" alone is "Chèque" elsewhere in the console.
  assert.doesNotMatch(dialog, /: "Check"\}/);
  assert.equal(translateValue("Deposit received", "fr"), "Dépôt reçu");
  assert.equal(translateValue("Use this one", "fr"), "Utiliser celui-ci");
  assert.equal(translateValue("Search results", "fr"), "Résultats de la recherche");
});

test("every sentence Check bank shows has its French, attributes included", () => {
  const shown = [
    ...BANK_SINCE_OPTIONS.map((o) => o.label),
    ...Object.values(STANDALONE_TEXT),
    ...Object.values(USE_TEXT),
    ...Object.values(USAGE_TEXT),
    ...Object.values(RECORD_KIND_LABELS),
    ...Object.values(BANK_ERROR_MESSAGES),
    ...Object.values(ZELLE_MESSAGES),
    AMOUNT_MESSAGE,
    LIMIT_MESSAGE,
    TEAM_MEMBER,
    // check-bank-dialog.tsx
    "Check bank",
    "Connect a bank for Zelle checks",
    "The bank needs you to sign in again",
    "Connect a bank",
    "Reconnect the bank",
    "See whether a Zelle payment reached the business's bank before you record it.",
    "Exact amount",
    "When was it sent?",
    "Check now",
    "Checking…",
    "Check again",
    "pending",
    "Use for a sale",
    "Search",
    "Searching…",
    "Use this one",
    "Not now",
    "Close",
    // bank-zelle-card.tsx (the limit form)
    "Save",
    "Saving…",
    // billing-views.tsx
    "a month with a connected bank",
    "per paid refresh",
    "No bank was connected this month.",
    "Bank checks this month",
    "Bank connected",
    "No bank connected",
    "Estimated cost is what Plaid bills for the paid refreshes ($0.12 each). Checks themselves are free.",
    "Bank connection",
    "Bank checks",
    "How it is charged",
    "No charge",
    "Per month with a connected bank",
    "Charged for a month in which the business had its bank connected for Zelle checks.",
    "Per month",
    "Per paid bank refresh",
    "A check that asks the bank for new deposits is a paid refresh. Re-checks that only read are free.",
    "Per paid refresh",
    "Paid bank refreshes",
  ];
  const missing = shown.filter((english) => !(english in TEXT_TRANSLATIONS));
  assert.deepEqual(missing, []);
  // placeholder / aria-label / title.
  const attributes = ["Search by customer, items or tracking code"];
  assert.deepEqual(attributes.filter((english) => !(english in ATTRIBUTE_TRANSLATIONS) && !(english in TEXT_TRANSLATIONS)), []);
  for (const english of [...shown, ...attributes]) assert.notEqual(translateValue(english, "fr"), english, english);
});

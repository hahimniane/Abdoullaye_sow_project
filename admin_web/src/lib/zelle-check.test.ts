import assert from "node:assert/strict";
import { test } from "node:test";

import { inventorySaleFromRow } from "./inventory.ts";
import { packagePaymentEntries } from "./waiting-packages.ts";
import { TEXT_TRANSLATIONS } from "./french-dom.ts";
import {
  BANK_STATUS_LABELS,
  ZELLE_MESSAGES,
  bankAccountText,
  bankCheckFrom,
  bankLinkTokenRequest,
  canManageBank,
  checkZelleRequest,
  confirmZelleCandidateRequest,
  confirmationFromBankCheck,
  connectBankRequest,
  readBankStatus,
  readZelleCheckAnswer,
  windowOptions,
  zelleCheckable,
  zelleFailureMessage,
} from "./zelle-check.ts";

const AT = Date.parse("2026-10-16T18:02:00Z");

test("a record's bankCheck is read for what it says, and nothing else", () => {
  const check = bankCheckFrom({ status: "confirmed", creditId: "biz_t1", amountCents: 4000, atMs: AT, timeKnown: true,
    senderName: "FATOU BAH", institutionName: "Chase", checkedByUid: "u1", checkedAt: { toMillis: () => AT } });
  assert.deepEqual(check, { status: "confirmed", creditId: "biz_t1", checkedByUid: "u1", amountCents: 4000, atMs: AT,
    timeKnown: true, senderName: "FATOU BAH", institutionName: "Chase" });
  assert.deepEqual(confirmationFromBankCheck(check), { amountCents: 4000, atMs: AT, timeKnown: true,
    senderName: "FATOU BAH", institutionName: "Chase" });
  assert.deepEqual(bankCheckFrom({ status: "not_found", checkedByUid: "u2" }), { status: "not_found", checkedByUid: "u2" });
  assert.equal(confirmationFromBankCheck(bankCheckFrom({ status: "not_found" })), null);
  assert.equal(bankCheckFrom(undefined), null);
  assert.equal(bankCheckFrom({ status: "whatever" }), null);
  assert.equal(bankCheckFrom({ status: "confirmed", timeKnown: false })?.status, "confirmed");
});

test("bankCheck round-trips through the sale and payment models", () => {
  const sale = inventorySaleFromRow({ id: "s1", totalCents: 4000, paymentMethod: "zelle",
    bankCheck: { status: "confirmed", creditId: "c", amountCents: 4000, atMs: AT, senderName: "A" } });
  assert.equal(sale.bankCheck?.status, "confirmed");
  assert.equal(inventorySaleFromRow({ id: "s2", totalCents: 1 }).bankCheck, null);
  const [entry] = packagePaymentEntries([{ id: "p1", amountCents: 500, method: "zelle",
    bankCheck: { status: "not_found", checkedByUid: "u" } }]);
  assert.deepEqual(entry.bankCheck, { status: "not_found", checkedByUid: "u" });
});

test("only a standing Zelle payment can be checked", () => {
  assert.equal(zelleCheckable({ method: "zelle", amountCents: 100, voided: false }), true);
  assert.equal(zelleCheckable({ method: "cash", amountCents: 100, voided: false }), false);
  assert.equal(zelleCheckable({ method: "zelle", amountCents: 0, voided: false }), false);
  assert.equal(zelleCheckable({ method: "zelle", amountCents: 100, voided: true }), false);
});

test("the requests carry the contract's names", () => {
  assert.deepEqual(checkZelleRequest(" biz ", "inventory_sale", "s1"), { businessId: "biz", kind: "inventory_sale", id: "s1" });
  assert.deepEqual(confirmZelleCandidateRequest("biz", "container_line_payment", "p1", "biz_t1"),
    { businessId: "biz", kind: "container_line_payment", id: "p1", creditId: "biz_t1" });
  assert.deepEqual(bankLinkTokenRequest("biz", "fr"), { businessId: "biz", platform: "web", language: "fr" });
  assert.deepEqual(connectBankRequest("biz", "public-x", { accounts: [{ id: "acc1" }] }),
    { businessId: "biz", publicToken: "public-x", accountId: "acc1" });
  assert.deepEqual(connectBankRequest("biz", "public-x", {}), { businessId: "biz", publicToken: "public-x" });
});

test("check answers are read defensively", () => {
  const confirmed = readZelleCheckAnswer({ result: "confirmed", confirmation: { amountCents: 4000, atMs: AT,
    senderName: "FATOU BAH", institutionName: "Chase" } });
  assert.equal(confirmed.result, "confirmed");
  assert.equal(confirmed.confirmation?.senderName, "FATOU BAH");
  assert.equal(confirmed.confirmation?.timeKnown, true);
  const choose = readZelleCheckAnswer({ result: "choose", candidates: [
    { creditId: "a", atMs: AT, senderName: "A" }, { creditId: "", atMs: AT }, { creditId: "b", timeKnown: false, atMs: AT } ] });
  assert.deepEqual(choose.candidates.map((c) => [c.creditId, c.timeKnown]), [["a", true], ["b", false]]);
  assert.equal(readZelleCheckAnswer({ result: "choose", candidates: [] }).result, "not_found");
  assert.equal(readZelleCheckAnswer(null).result, "not_found");
  assert.equal(readZelleCheckAnswer({ result: "not_found", confirmation: { amountCents: 1 } }).confirmation, null);
});

test("refusals read as sentences, never as Firebase's words", () => {
  assert.equal(zelleFailureMessage({ code: "functions/failed-precondition", details: { reason: "bank_not_connected" } }),
    ZELLE_MESSAGES.bank_not_connected);
  assert.equal(zelleFailureMessage({ code: "functions/permission-denied", message: "This staff account is not allowed" }),
    ZELLE_MESSAGES.permission_denied);
  assert.equal(zelleFailureMessage({ code: "functions/internal", message: "internal" }), "The bank check did not finish. Try again.");
});

test("the owner's status view and the window choices", () => {
  const status = readBankStatus({ connected: true, status: "active", windowMinutes: 20, institutionName: "Chase",
    accountMask: "1234", lastSyncAt: AT });
  assert.equal(status.connected, true);
  assert.equal(status.lastSyncAtMs, AT);
  assert.equal(bankAccountText(status), "Chase ••1234");
  const staff = readBankStatus({ connected: true, status: "needs_reauth", windowMinutes: 99 });
  assert.equal(staff.windowMinutes, 15);
  assert.equal(staff.institutionName, "");
  assert.equal(readBankStatus({ connected: true, status: "disconnected" }).connected, false);
  assert.deepEqual(windowOptions(15), [2, 5, 10, 15, 20, 30, 45, 60]);
  assert.deepEqual(windowOptions(7), [2, 5, 7, 10, 15, 20, 30, 45, 60]);
  assert.equal(canManageBank({ role: "businessOwner", businessId: "b" }, "b"), true);
  assert.equal(canManageBank({ role: "staff", businessId: "b" }, "b"), false);
  assert.equal(canManageBank({ role: "businessOwner", businessId: "other" }, "b"), false);
});

test("every sentence the Zelle check shows has its French", () => {
  const shown = [
    ...Object.values(ZELLE_MESSAGES),
    "The bank check did not finish. Try again.",
    ...Object.values(BANK_STATUS_LABELS),
    "Bank for Zelle checks",
    "Connect the business's bank so staff can check a Zelle payment at the counter without calling you. Laawol only reads deposits; it cannot move money. Staff never see your balance or other transactions.",
    "Connect bank", "Reconnect", "Disconnect", "Connecting…", "Check window",
    "Staff look for a deposit of exactly the payment's amount, this many minutes before or after it was recorded.",
    "Disconnect the bank? Staff can no longer check Zelle payments until you connect it again.",
    "Bank connected.", "Bank disconnected.", "Check window saved.", "Last read", "Not read yet",
    "The bank needs you to sign in again before staff can check Zelle payments.",
    "Check Zelle", "Checking…", "Zelle confirmed", "Not found yet", "Check again",
    "No deposit of this amount has arrived yet. Ask the customer to wait a minute, then check again.",
    "Several deposits of this amount arrived. Pick the one from this customer:",
    "This one", "pending", "Loading the bank…",
    "The bank connected, but its history is still being prepared. Checks work in a few minutes.",
  ];
  const missing = shown.filter((english) => !(english in TEXT_TRANSLATIONS));
  assert.deepEqual(missing, []);
});

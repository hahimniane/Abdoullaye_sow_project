import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import * as billing from "./platform-billing.ts";

// Source contracts for the Bills page (docs/PLATFORM_BILLING.md §9): the
// callable it talks to, typed values kept out of the translator, async
// actions that show progress, a read that always resolves, every string in
// French, and a layout that fits a 375 px phone.

const view = readFileSync(new URL("../components/billing-views.tsx", import.meta.url), "utf8");
const consoleSource = readFileSync(new URL("../components/admin-console.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const serverIndex = readFileSync(new URL("../../../my_flutter_app/functions/index.js", import.meta.url), "utf8");

function rule(selector: string): string {
  const at = styles.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} exists`);
  return styles.slice(at, styles.indexOf("}", at) + 1);
}

test("the page talks to the one platformBilling callable the server exports", () => {
  assert.equal(billing.BILLING_CALLABLE, "platformBilling");
  assert.match(serverIndex, /exports\.platformBilling = onCall\(\s*\{enforceAppCheck: ENFORCE_APP_CHECK, cors: true, invoker: "public",\s*maxInstances: 1/);
  assert.match(view, /httpsCallable\(functions, BILLING_CALLABLE/);
  for (const action of ["getMonthBills", "getBusinessBill", "whatIf", "saveDeal", "setCommissionMode", "recordPayment", "voidPayment", "closeMonth", "reopenMonth"]) {
    assert.ok(view.includes(`action: "${action}"`), `${action} is reachable from the page`);
    assert.ok(serverIndex.includes("platform_billing_handlers") && readFileSync(new URL("../../../my_flutter_app/functions/platform_billing_handlers.js", import.meta.url), "utf8").includes(`    ${action},`), `${action} is routed on the server`);
  }
});

test("the admin console shows Bills to Finance readers", () => {
  assert.match(consoleSource, /activeTab === "bills" && <AdminBillsView previewMode=\{previewMode\} \/>/);
  assert.match(consoleSource, /bills: "Bills",/);
  assert.match(consoleSource, /bills: "What businesses owe Laawol",/);
  assert.match(consoleSource, /bills: <Receipt \{\.\.\.props\} \/>,/);
  assert.match(consoleSource, /"finance", "volume", "bills", "support"/);
});

test("typed values never reach the translator", () => {
  // Business names, notes and reasons are typed by people.
  for (const value of ["{bill.business.name}", "{payment.note}", "{v.note}", "{entry.reason}", "{row.name}"]) {
    const at = view.indexOf(value);
    assert.ok(at > 0, `${value} is shown`);
    const open = view.lastIndexOf("<", at);
    const tag = view.slice(open, at);
    assert.match(tag + view.slice(at - 40, at), /data-no-translate/, `${value} is inside data-no-translate`);
  }
  // A name inside a confirmation message would be translated with it.
  const confirms = [...view.matchAll(/confirmImportantAction\(([\s\S]*?)\);/g)].map((m) => m[1]);
  assert.ok(confirms.length >= 3);
  for (const message of confirms) assert.doesNotMatch(message, /business\.name|\.note|\.reason/);
});

test("every async action shows progress and cannot run twice", () => {
  for (const label of ["Saving…", "Calculating…", "Closing…", "Reopening…", "Voiding…"]) {
    assert.ok(view.includes(label), `${label} progress label`);
  }
  const busyButtons = view.match(/aria-busy=\{[^}]+\}/g) ?? [];
  assert.ok(busyButtons.length >= 8, `only ${busyButtons.length} busy buttons`);
  for (const fn of ["async function save()", "async function calculate(", "async function reopen()", "async function run("]) {
    const at = view.indexOf(fn);
    assert.ok(at > 0, fn);
    assert.match(view.slice(at, at + 200), /if \(busy\) return;/, `${fn} refuses a second run`);
  }
  assert.ok((view.match(/finally \{\s*set(Busy|MoreBusy)\(/g) ?? []).length >= 6, "busy always resets in finally");
});

test("a bills read always resolves its loading state", () => {
  const hook = view.slice(view.indexOf("function useBillingRead"), view.indexOf("// Small pieces."));
  assert.match(hook, /window\.setTimeout\(/);
  assert.match(hook, /loading: false, error: READ_SLOW/);
  assert.match(hook, /loading: false, error: READ_FAILED/);
  assert.match(hook, /window\.clearTimeout\(timer\)/);
});

test("every string the page and its words use reads in French", () => {
  const words = [
    ...Object.values(billing.CHARGE_LABELS),
    ...Object.values(billing.STANDING_LABELS),
    ...Object.values(billing.DRIFT_LABELS),
    ...Object.values(billing.PAYMENT_METHOD_LABELS).filter((w) => w !== "Zelle"),
    ...Object.values(billing.DEAL_LABELS),
    ...Object.values(billing.DRAFT_MESSAGES),
    ...Object.values(billing.REFUSAL_TEXT),
    billing.GENERIC_FAILURE,
    "per barrel",
    "per package",
    "per car",
    "of the price",
    "of parking billed",
    "per item",
    "a month",
  ];
  const jsxText = [...view.matchAll(/>\s*([A-Z][^<>{}]*[a-z.…:?)])\s*</g)].map((m) => m[1].replace(/\s+/g, " ").trim().replace(/&apos;/g, "'"));
  const attributes = [...view.matchAll(/(?:title|placeholder|label|hint|empty)="([A-Z][^"]+)"/g)].map((m) => m[1]);
  const flashes = [...view.matchAll(/(?:done|onSaved|setError|run\([^)]*?)\("([A-Z][^"]+)"\)/g)].map((m) => m[1]);
  const all = [...new Set([...words, ...jsxText, ...attributes, ...flashes])];
  assert.ok(all.length > 120, `only ${all.length} strings checked`);
  // Spelled the same in French (an identity entry would break convergence).
  const same = new Set(["Note", "Total", "Zelle"]);
  const untranslated = all.filter((english) => !same.has(english) && translateValue(english, "fr") === english);
  assert.deepEqual(untranslated, []);
});

test("the page fits a 375 px phone: shrinkable columns, the table scrolls in its card", () => {
  assert.match(rule(".bl-page"), /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(rule(".bl-grid"), /minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(rule(".metric-grid.bl-tiles"), /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.ok((view.match(/<div className="vol-table-scroll">/g) ?? []).length >= 2, "both tables scroll inside their card");
  const phone = styles.slice(styles.lastIndexOf("@media (max-width: 720px) {"));
  assert.match(phone, /\.bl-field-pair,\s*\.bl-field-trio \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  const narrow = styles.slice(styles.indexOf("@media (max-width: 1100px) {"));
  assert.match(narrow, /\.bl-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { INVENTORY_MESSAGES, INVENTORY_MOVEMENT_LABELS } from "./inventory.ts";
import { TRANSFER_CHIP_LABELS, WRITE_OFF_REASON_LABELS, transferFixedSentences } from "./inventory-transfers.ts";
import { inventoryNotificationPreferenceFields } from "./notification-preferences.ts";

// The console wiring of Inventory v5 (store transfers), pinned by reading the
// source the way the v2-v4 contract tests do. The contract is docs/INVENTORY.md
// "Store transfers (v5)": exact callable names, the refusal codes, the reads,
// and "only for businesses with two or more active stores".

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const B = "../components/business/";
const panel = read(B + "inventory-panel.tsx");
const view = read(B + "inventory-transfers-view.tsx");
const compose = read(B + "inventory-transfer-compose-dialog.tsx");
const receive = read(B + "inventory-transfer-receive-dialog.tsx");
const review = read(B + "inventory-transfer-review-dialog.tsx");
const cancel = read(B + "inventory-transfer-cancel-dialog.tsx");
const detail = read(B + "inventory-item-detail.tsx");
const history = read(B + "inventory-history.tsx");
const summaryCard = read(B + "inventory-summary-card.tsx");
const businessData = read("./business-data.ts");
const screens = [panel, view, compose, receive, review, cancel].join("\n");

test("every v5 callable is called by the dialog that owns it, by its contract name", () => {
  const calls: Array<[string, string, string]> = [
    ["sendInventoryTransfer", "the New transfer dialog", compose],
    ["saveInventoryTransferDraft", "the New transfer dialog", compose],
    ["cancelInventoryTransfer", "the cancel dialog", cancel],
    ["receiveInventoryTransfer", "the receive dialog", receive],
    ["resolveInventoryTransferLine", "the review dialog", review],
  ];
  for (const [callable, owner, source] of calls) {
    assert.match(source, new RegExp(`"${callable}"`), `${callable} is not called by ${owner}`);
  }
  assert.match(compose, /httpsCallable\(functions, kind === "send" \? "sendInventoryTransfer" : "saveInventoryTransferDraft"\)\(request\)/);
  for (const source of [cancel, receive, review]) assert.match(source, /httpsCallable\(functions, "[a-zA-Z]+InventoryTransfer[a-zA-Z]*"\)\(/);
  // Nothing is written from the browser, and the instant move is gone from the console.
  assert.doesNotMatch(screens, /\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\(/);
  assert.doesNotMatch(screens + detail, /transferInventoryStock/);
  assert.equal(existsSync(new URL(B + "inventory-transfer-dialog.tsx", import.meta.url)), false, "the old Move stock dialog is removed");
});

test("the requests are built by the tested pure helpers, with a retry key made once per dialog", () => {
  assert.match(compose, /composeRequest\(businessId, clientRequestId, fromStoreId, toStoreId, lines\)/);
  assert.match(compose, /clientRequestId: newTransferRequestId\(\)/);
  assert.match(compose, /if \(draft\) return composeFromDraft\(draft\);/);
  assert.match(cancel, /const \[requestId\] = useState\(\(\) => newTransferRequestId\(\)\);/);
  assert.match(cancel, /cancelTransferRequest\(businessId, transfer\.id, requestId\)/);
  assert.match(receive, /const \[requestId\] = useState\(\(\) => newTransferRequestId\(\)\);/);
  assert.match(receive, /receiveTransferRequest\(businessId, transfer, counts, shortfall\.missing > 0 \? note : "", requestId\)/);
  assert.match(receive, /useState<Record<string, number>>\(\(\) => receiveCountsFrom\(transfer\)\)/);
  assert.match(review, /resolveLineRequest\(businessId, transfer\.id, itemId, action, \{ reason, note, requestId: requestIdFor\(key\) \}\)/);
});

test("every async button blocks a second click and always comes back", () => {
  for (const [name, source] of [["compose", compose], ["receive", receive], ["review", review], ["cancel", cancel]] as const) {
    assert.match(source, /if \(inFlight\.current\) return;/, name);
    assert.match(source, /finally \{\s*inFlight\.current = false;\s*set(Busy|BusyKey)\((false|""|"")\);/, name);
    assert.match(source, /aria-busy=/, name);
    assert.match(source, /transferFailure\(failure\)/, name);
  }
});

test("reads: the panel reads the open transfers, the view the recent and the month's, a store's staff both sides", () => {
  assert.match(panel, /useInventoryTransfers\("open", businessId, transfersOn, access\.scopedStoreId\)/);
  assert.match(panel, /const transfersOn = enabled && access\.multi && !access\.needsHomeStore;/);
  assert.match(view, /useInventoryTransfers\("recent", businessId, enabled, scoped\)/);
  assert.match(view, /useInventoryTransfers\("month", businessId, enabled, scoped, since\)/);
  assert.match(view, /useLiveDocRead\("inventoryTransfers", selectedId, enabled && Boolean\(selectedId\)\)/);
  assert.match(businessData, /transferReadOptions\(read, store \? "from" : "", store, monthStart\)/);
  assert.match(businessData, /useBusinessCollection\("inventoryTransfers", businessId, enabled && Boolean\(store\),\s*transferReadOptions\(read, "to", store, monthStart\)\)/);
  // Screens use the named hooks only.
  assert.doesNotMatch(screens, /useBusinessCollection\(|\bquery\(/);
});

test("the Transfers tab and every send entry point exist only with two or more stores", () => {
  assert.match(panel, /\.\.\.\(transfersOn \? \[\["transfers", "Transfers", transferBadge > 0 \? transferBadge : null\]/);
  assert.match(panel, /\{view === "transfers" && transfersOn \? \(/);
  assert.match(panel, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); openCompose\(item\.id\); \}\} title="Send to another store"/);
  assert.match(detail, /\{canSend && \(/);
  assert.match(panel, /canSend=\{canSendTransfers\}/);
});

test("user data on the transfer screens is never translated", () => {
  // Store names, product names, codes, counts and the sentences built per language.
  for (const pattern of [
    /<code className="ctn-code" data-no-translate>\{t\.code \|\| "—"\}<\/code>/,
    /<span className=\{pillClass\(status\)\} data-no-translate>\{status\.label\}<\/span>/,
    /<span data-no-translate>\{line\.text\}<\/span>/,
    /<strong data-no-translate>\{productDisplayName\(line\)\}<\/strong>/,
  ]) assert.match(view, pattern);
  assert.match(compose, /<strong data-no-translate>\{nameOf\(line\.itemId\)\}<\/strong>/);
  assert.match(compose, /<option key=\{store\.id\} value=\{store\.id\} data-no-translate>\{store\.name\}<\/option>/);
  assert.match(receive, /<strong data-no-translate>\{productDisplayName\(line\)\}<\/strong>/);
  assert.match(review, /<span data-no-translate>\{returnToText\(fromName, lang\)\}<\/span>/);
  assert.match(summaryCard, /\{transfersLine && <p className="lst-hint ivt-tr-summary-line" data-no-translate>\{transfersLine\}<\/p>\}/);
  assert.match(detail, /<small data-no-translate>\{movementTransferText\(entry\.transferCode/);
  assert.match(history, /<small data-no-translate>\{movementTransferText\(event\.transferCode/);
});

test("a transfer alert that cannot be read says so after 15 seconds at most", () => {
  assert.match(view, /const FOCUS_READ_TIMEOUT_MS = 15_000;/);
  assert.match(view, /window\.setTimeout\(\(\) => setTimedOutKey\(focusKey\), FOCUS_READ_TIMEOUT_MS\)/);
  assert.match(view, /\{focusUnavailable && <div className="lst-form-error" role="status">That transfer is not available\.<\/div>\}/);
});

test("every fixed sentence, label and refusal of v5 has its French", () => {
  const strings = [
    ...transferFixedSentences(),
    ...Object.values(TRANSFER_CHIP_LABELS),
    ...Object.values(WRITE_OFF_REASON_LABELS),
    ...Object.values(INVENTORY_MOVEMENT_LABELS),
    ...inventoryNotificationPreferenceFields.flatMap((field) => [field.label, field.hint]),
    "Transfers",
  ];
  const missing = strings.filter((english) => !(english in TEXT_TRANSLATIONS));
  assert.deepEqual(missing, []);
  for (const english of strings) assert.notEqual(translateValue(english, "fr"), english, english);
  // The codes the contract adds all have a sentence.
  for (const code of [
    "transfer_not_found", "transfer_not_draft", "transfer_not_in_transit", "line_not_disputed", "line_already_resolved",
    "store_has_transfers", "item_in_transfer", "item_not_in_transfer", "received_too_many", "write_off_reason_invalid",
    "resolution_invalid", "transfer_lines_required", "transfer_lines_too_many", "client_request_id_invalid",
  ]) {
    assert.ok(code in INVENTORY_MESSAGES, code);
  }
  // The French comes back to the English it came from.
  for (const english of ["Instant transfer", "Store transfers", "Settle differences", "Disputed", "New transfer"]) {
    assert.equal(translateValue(translateValue(english, "fr"), "en"), english, english);
  }
});

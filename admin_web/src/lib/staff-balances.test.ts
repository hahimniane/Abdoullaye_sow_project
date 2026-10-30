// The console's side of Staff balances (docs/STAFF_BALANCES.md): the page
// rendered from a recorded `staff_balances` answer (pure helpers), the
// hand-over / confirm / decline / void / opening wiring, the Business account
// option in every "Received by" picker, and the French for every string.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { deliverRequest } from "./container-delivery.ts";
import { packagePhotoPath, photoPathUnder } from "./package-proof.ts";
import {
  BUSINESS_ACCOUNT_LABEL,
  BUSINESS_ACCOUNT_RECEIVER,
  HANDOVER_METHODS,
  HANDOVER_STATUS_LABELS,
  PENDING_HANDOVERS_WHERE,
  STAFF_BALANCES_REFUSAL_COPY,
  balanceTotals,
  breakdownLines,
  businessAccountName,
  canVoidHandover,
  collectedByMethodLines,
  confirmHandoverRequest,
  declineHandoverRequest,
  emptyHandoverDraft,
  handoverFrom,
  handoverHistory,
  handoverPartyName,
  handoverProblem,
  isBalancesOwner,
  isBusinessAccount,
  isStaffHandoverProofPath,
  mergeHandovers,
  netPhrase,
  openingProblem,
  receiverChoices,
  recordHandoverRequest,
  recordOpeningRequest,
  sortedBalanceRows,
  staffBalancesFrom,
  staffBalancesRefusalText,
  staffBalancesRequest,
  staffHandoverProofPath,
  timeMs,
  voidHandoverRequest,
  waitingOnViewer,
  waitingOnViewerRows,
  waitingOnYou,
} from "./staff-balances.ts";
import { staffNameFrom, staffNameIndex } from "./staff-names.ts";

// A recorded answer of `staff_balances` (docs/STAFF_BALANCES.md §3), as the
// callable returns it: Awa holds cash, Moussa owes parking, Keren is owed
// expenses, one hand-over waits.
const ANSWER = {
  asOfMs: 1_793_000_000_000,
  staff: [
    {
      staffId: "awa", name: "Awa Diallo", collectedCents: 50000, collectedByMethod: { cash: 30000, zelle: 20000 },
      handedOutCents: 10000, receivedFromOthersCents: 0, pendingOutCents: 5000, pendingInCents: 0,
      heldCents: 40000, parkingDueCents: 0, expenseCreditCents: 0, expenseOwedToThemCents: 0, netCents: 40000,
    },
    {
      staffId: "moussa", name: "Moussa Bah", collectedCents: 0, collectedByMethod: {},
      handedOutCents: 0, receivedFromOthersCents: 0, pendingOutCents: 0, pendingInCents: 5000,
      heldCents: 0, parkingDueCents: 12000, expenseCreditCents: 0, expenseOwedToThemCents: 0, netCents: 12000,
    },
    {
      staffId: "keren", name: "Keren", collectedCents: 0, collectedByMethod: {},
      handedOutCents: 0, receivedFromOthersCents: 0, pendingOutCents: 0, pendingInCents: 0,
      heldCents: 0, parkingDueCents: 0, expenseCreditCents: 30000, expenseOwedToThemCents: 30000, netCents: -30000,
    },
    {
      staffId: "zero", name: "Even Steven", collectedCents: 0, collectedByMethod: {},
      handedOutCents: 0, receivedFromOthersCents: 0, pendingOutCents: 0, pendingInCents: 0,
      heldCents: 0, parkingDueCents: 0, expenseCreditCents: 0, expenseOwedToThemCents: 0, netCents: 0,
    },
  ],
  businessAccount: { receivedCents: 25000, pendingInCents: 0 },
  pending: [
    {
      id: "h1", businessId: "biz", kind: "handover", fromStaffId: "awa", toId: "moussa", amountCents: 5000, method: "cash",
      note: "for the yard", proofPath: "", status: "pending", createdByUid: "awa", createdAt: { seconds: 1_792_000_000 },
    },
  ],
};

const answer = staffBalancesFrom(ANSWER);
const owner = { uid: "boss", isOwner: true };
const awa = { uid: "awa", isOwner: false };
const moussa = { uid: "moussa", isOwner: false };

// ---------------------------------------------------------------------------
// The page, rendered from a recorded answer.
// ---------------------------------------------------------------------------

test("the answer is read into rows, totals and a pending list", () => {
  assert.equal(answer.staff.length, 4);
  assert.equal(answer.businessAccount.receivedCents, 25000);
  assert.equal(answer.pending.length, 1);
  assert.equal(answer.pending[0].createdAtMs, 1_792_000_000_000);
  assert.deepEqual(balanceTotals(answer.staff), { heldCents: 40000, owedToBusinessCents: 52000, owedToStaffCents: 30000 });
});

test("an odd or missing answer reads as nobody, never throws", () => {
  for (const bad of [null, undefined, 5, "x", [], { staff: "nope", pending: 3 }, { staff: [null, {}, { staffId: "" }] }]) {
    const a = staffBalancesFrom(bad);
    assert.deepEqual(a.staff, []);
    assert.deepEqual(a.pending, []);
    assert.deepEqual(a.businessAccount, { receivedCents: 0, pendingInCents: 0 });
  }
});

test("net reads 'owes' for a positive number, 'is owed' for a negative one, 'settled' for zero", () => {
  assert.deepEqual(netPhrase(12000), { tone: "owes", label: "Owes the business", cents: 12000 });
  assert.deepEqual(netPhrase(-30000), { tone: "owed", label: "The business owes them", cents: 30000 });
  assert.deepEqual(netPhrase(0), { tone: "even", label: "Settled up", cents: 0 });
});

test("people with money in play come first, then by name", () => {
  assert.deepEqual(sortedBalanceRows(answer.staff).map((r) => r.staffId), ["awa", "keren", "moussa", "zero"]);
});

test("the breakdown adds up to the row's own numbers", () => {
  const lines = breakdownLines(answer.staff[0]);
  assert.deepEqual(lines.map((l) => l.key), ["collected", "handedOut", "received", "held", "parking", "expenses", "net"]);
  const sum = (key: string) => lines.find((l) => l.key === key)!.cents;
  // collected - handed out + received = held (pending does not move it)
  assert.equal(sum("collected") + sum("handedOut") + sum("received"), sum("held") + 0 + 10000 - 10000);
  assert.equal(sum("held"), 40000);
  assert.equal(sum("net"), 40000);
  // Expenses owed to them lower the net, so they show negative.
  assert.equal(breakdownLines(answer.staff[2]).find((l) => l.key === "expenses")!.cents, -30000);
});

test("collected by method is listed largest first, in the console's words", () => {
  assert.deepEqual(collectedByMethodLines(answer.staff[0]), [
    { method: "cash", label: "Cash", cents: 30000 },
    { method: "zelle", label: "Zelle transfer", cents: 20000 },
  ]);
  assert.deepEqual(collectedByMethodLines(answer.staff[1]), []);
});

test("timestamps of every shape read as milliseconds", () => {
  assert.equal(timeMs(5), 5);
  assert.equal(timeMs({ seconds: 2 }), 2000);
  assert.equal(timeMs({ _seconds: 3 }), 3000);
  assert.equal(timeMs({ toMillis: () => 7 }), 7);
  assert.equal(timeMs(null), 0);
  assert.equal(timeMs("nonsense"), 0);
});

// ---------------------------------------------------------------------------
// Who may do what.
// ---------------------------------------------------------------------------

const h = (over: Record<string, unknown>) => handoverFrom({
  id: "x", fromStaffId: "awa", toId: "moussa", amountCents: 1000, status: "pending", createdByUid: "awa", createdAt: 1, ...over,
});

test("a hand-over waits on its receiver; the Business account waits on the owner", () => {
  const toMoussa = h({});
  assert.equal(waitingOnViewer(toMoussa, moussa), true);
  assert.equal(waitingOnViewer(toMoussa, awa), false, "the giver does not confirm their own");
  assert.equal(waitingOnViewer(toMoussa, owner), false, "the owner confirms only the Business account's");
  const toBusiness = h({ toId: BUSINESS_ACCOUNT_RECEIVER });
  assert.equal(waitingOnViewer(toBusiness, owner), true);
  assert.equal(waitingOnViewer(toBusiness, moussa), false);
  assert.equal(waitingOnViewer(h({ status: "confirmed" }), moussa), false, "only pending ones wait");
  assert.equal(waitingOnViewer(toMoussa, { uid: "", isOwner: false }), false);
});

test("the badge counts and totals what waits on the viewer", () => {
  const rows = [h({ id: "a", amountCents: 500 }), h({ id: "b", amountCents: 700 }), h({ id: "c", toId: BUSINESS_ACCOUNT_RECEIVER, amountCents: 900 })];
  assert.deepEqual(waitingOnYou(rows, moussa), { count: 2, amountCents: 1200 });
  assert.deepEqual(waitingOnYou(rows, owner), { count: 1, amountCents: 900 });
  assert.deepEqual(waitingOnYou(rows, awa), { count: 0, amountCents: 0 });
  assert.deepEqual(waitingOnViewerRows(rows, moussa).map((r) => r.id), ["a", "b"]);
});

test("void: the giver while pending, the owner any time before it is void", () => {
  assert.equal(canVoidHandover(h({}), awa), true);
  assert.equal(canVoidHandover(h({}), moussa), false, "the receiver declines, not voids");
  assert.equal(canVoidHandover(h({ status: "confirmed" }), awa), false);
  assert.equal(canVoidHandover(h({ status: "confirmed" }), owner), true);
  assert.equal(canVoidHandover(h({ status: "pending" }), owner), true);
  assert.equal(canVoidHandover(h({ status: "voided" }), owner), false);
  assert.equal(canVoidHandover(h({ status: "declined" }), owner), false);
  assert.equal(canVoidHandover(h({ kind: "opening", status: "confirmed", fromStaffId: "awa", toId: BUSINESS_ACCOUNT_RECEIVER }), owner), true);
});

test("the owner is the business owner or a platform admin", () => {
  assert.equal(isBalancesOwner("businessOwner"), true);
  assert.equal(isBalancesOwner("admin"), true);
  assert.equal(isBalancesOwner("staff"), false);
  assert.equal(isBalancesOwner(undefined), false);
});

test("history is newest-change first, and the live read wins over the answer's copy", () => {
  const a = h({ id: "a", createdAt: 100 });
  const b = h({ id: "b", createdAt: 50, status: "confirmed", confirmedAt: 300 });
  assert.deepEqual(handoverHistory([a, b]).map((r) => r.id), ["b", "a"]);
  const merged = mergeHandovers([h({ id: "a", status: "confirmed" })], [h({ id: "a" }), h({ id: "z" })]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((r) => r.id === "a")!.status, "confirmed");
});

test("a person who left the team is named plainly, the Business account in the page's language", () => {
  const names = new Map([["awa", "Awa Diallo"]]);
  assert.equal(handoverPartyName("awa", names, "en"), "Awa Diallo");
  assert.equal(handoverPartyName("gone", names, "en"), "Former team member");
  assert.equal(handoverPartyName("gone", names, "fr"), "Ancien membre de l’équipe");
  assert.equal(handoverPartyName(BUSINESS_ACCOUNT_RECEIVER, names, "en"), "Business account");
  assert.equal(handoverPartyName(BUSINESS_ACCOUNT_RECEIVER, names, "fr"), "Compte de l’entreprise");
});

// ---------------------------------------------------------------------------
// The requests (docs/STAFF_BALANCES.md §3).
// ---------------------------------------------------------------------------

test("staff_balances asks for the business", () => {
  assert.deepEqual(staffBalancesRequest("biz"), { action: "staff_balances", businessId: "biz" });
});

test("record_handover carries the receiver, cents, method, note and photo", () => {
  assert.deepEqual(
    recordHandoverRequest("biz", { toId: "moussa", amount: "$1,250.50", method: "zelle", note: "  yard  ", proofPath: "staffHandoverProofs/biz/awa/abcdefgh12.jpg" }),
    { action: "record_handover", businessId: "biz", toId: "moussa", amountCents: 125050, method: "zelle", note: "yard", proofPath: "staffHandoverProofs/biz/awa/abcdefgh12.jpg" },
  );
  // No note and no photo: neither key is sent.
  assert.deepEqual(
    recordHandoverRequest("biz", { toId: BUSINESS_ACCOUNT_RECEIVER, amount: "40", method: "cash", note: "", proofPath: "" }),
    { action: "record_handover", businessId: "biz", toId: "business_account", amountCents: 4000, method: "cash" },
  );
});

test("confirm, decline, void and opening carry the ids the server asks for", () => {
  assert.deepEqual(confirmHandoverRequest("biz", "h1"), { action: "confirm_handover", businessId: "biz", handoverId: "h1" });
  assert.deepEqual(declineHandoverRequest("biz", "h1", " not received "), { action: "decline_handover", businessId: "biz", handoverId: "h1", note: "not received" });
  assert.deepEqual(declineHandoverRequest("biz", "h1"), { action: "decline_handover", businessId: "biz", handoverId: "h1" });
  assert.deepEqual(voidHandoverRequest("biz", "h1", "typo"), { action: "void_handover", businessId: "biz", handoverId: "h1", reason: "typo" });
  assert.deepEqual(voidHandoverRequest("biz", "h1"), { action: "void_handover", businessId: "biz", handoverId: "h1" });
  assert.deepEqual(
    recordOpeningRequest("biz", { staffId: "awa", amount: "300", note: "before the app" }),
    { action: "record_opening", businessId: "biz", staffId: "awa", amountCents: 30000, note: "before the app" },
  );
});

test("a hand-over is checked before it is sent, with the server's own words", () => {
  const members = ["awa", "moussa"];
  const ok = { ...emptyHandoverDraft(), toId: "moussa", amount: "10", method: "cash" };
  assert.equal(handoverProblem(ok, "awa", members), "");
  assert.equal(handoverProblem({ ...ok, toId: BUSINESS_ACCOUNT_RECEIVER }, "awa", members), "");
  assert.equal(handoverProblem({ ...ok, toId: "" }, "awa", members), STAFF_BALANCES_REFUSAL_COPY.handover_receiver_invalid);
  assert.equal(handoverProblem({ ...ok, toId: "awa" }, "awa", members), STAFF_BALANCES_REFUSAL_COPY.handover_to_self);
  assert.equal(handoverProblem({ ...ok, toId: "stranger" }, "awa", members), STAFF_BALANCES_REFUSAL_COPY.handover_receiver_invalid);
  assert.equal(handoverProblem({ ...ok, amount: "0" }, "awa", members), STAFF_BALANCES_REFUSAL_COPY.handover_amount_invalid);
  assert.equal(handoverProblem({ ...ok, amount: "abc" }, "awa", members), STAFF_BALANCES_REFUSAL_COPY.handover_amount_invalid);
  assert.equal(handoverProblem({ ...ok, method: "gold" }, "awa", members), STAFF_BALANCES_REFUSAL_COPY.handover_method_invalid);
  assert.equal(openingProblem({ staffId: "awa", amount: "5", note: "" }, members), "");
  assert.notEqual(openingProblem({ staffId: "nobody", amount: "5", note: "" }, members), "");
  assert.equal(openingProblem({ staffId: "awa", amount: "", note: "" }, members), STAFF_BALANCES_REFUSAL_COPY.handover_amount_invalid);
});

test("every server refusal reads in the console's words, not as raw text", () => {
  for (const code of Object.keys(STAFF_BALANCES_REFUSAL_COPY) as (keyof typeof STAFF_BALANCES_REFUSAL_COPY)[]) {
    assert.equal(staffBalancesRefusalText({ details: { reason: code }, message: "internal" }), STAFF_BALANCES_REFUSAL_COPY[code], code);
    assert.equal(staffBalancesRefusalText({ message: `failed: ${code}` }), STAFF_BALANCES_REFUSAL_COPY[code], `${code} in the message`);
  }
  // The staff-expense refusals keep working, and an unknown failure never leaks its text.
  assert.match(staffBalancesRefusalText({ details: { reason: "staff_not_member" } }), /no longer on this business/);
  assert.match(staffBalancesRefusalText({ code: "functions/permission-denied" }), /not allowed/);
  assert.match(staffBalancesRefusalText(new Error("boom: secret internals")), /did not save/);
});

test("proof photos live under staffHandoverProofs/{business}/{uid}/{file}.jpg, uploader's folder", () => {
  assert.equal(staffHandoverProofPath("biz", "awa", "abcdef123456.jpg"), "staffHandoverProofs/biz/awa/abcdef123456.jpg");
  assert.equal(staffHandoverProofPath("biz", "awa", "../x.jpg"), "");
  assert.equal(isStaffHandoverProofPath("staffHandoverProofs/biz/awa/abcdef123456.jpg"), true);
  assert.equal(isStaffHandoverProofPath("packagePhotos/biz/awa/abcdef123456.jpg"), false, "a package photo is not a hand-over slip");
  assert.equal(isStaffHandoverProofPath("staffHandoverProofs/biz/abcdef123456.jpg"), false);
  // The package photo path is unchanged by sharing the builder.
  assert.equal(packagePhotoPath("biz", "awa", "abcdef123456.jpg"), photoPathUnder("packagePhotos", "biz", "awa", "abcdef123456.jpg"));
});

test("the badge asks one equality query: this business, status pending", () => {
  assert.deepEqual(PENDING_HANDOVERS_WHERE, [["status", "==", "pending"]]);
});

// ---------------------------------------------------------------------------
// The Business account in every "Received by" picker.
// ---------------------------------------------------------------------------

test("the Business account is the first choice, then the people", () => {
  const choices = receiverChoices([{ id: "awa", name: "Awa" }]);
  assert.deepEqual(choices.map((c) => c.id), [BUSINESS_ACCOUNT_RECEIVER, "awa"]);
  assert.equal(choices[0].name, BUSINESS_ACCOUNT_LABEL);
  assert.equal(BUSINESS_ACCOUNT_LABEL, "Business account (Zelle, transfer, card)");
  assert.equal(BUSINESS_ACCOUNT_RECEIVER, "business_account");
  assert.equal(isBusinessAccount("business_account"), true);
  assert.equal(isBusinessAccount("awa"), false);
});

test("a payment received by the Business account is named, not 'not on your team'", () => {
  const index = staffNameIndex([{ id: "awa", fullName: "Awa Diallo" }]);
  assert.equal(staffNameFrom(index, "awa"), "Awa Diallo");
  assert.equal(staffNameFrom(index, BUSINESS_ACCOUNT_RECEIVER), businessAccountName());
  assert.equal(staffNameFrom(index, "gone"), "");
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

// Every picker the console records money with, and how many "Received by" selects each has.
const PICKERS: Record<string, { names: number; me?: number }> = {
  "package-payment-dialog.tsx": { names: 1 }, // a container line's / waiting package's payments
  "waiting-packages-panel.tsx": { names: 1 }, // the money on a waiting package
  "package-requests-panel.tsx": { names: 1 }, // receiving a package request, with a payment
  "inventory-sale-switch-dialog.tsx": { names: 1 }, // inventory sale: normal <-> credit
  "inventory-credit-payment-dialog.tsx": { names: 1 }, // an inventory credit payment
  "parking-month-end.tsx": { names: 1 }, // marking a whole month bill paid
  "operations-panels.tsx": { names: 6 }, // parking entry, lot ledger payment, instalment (chase), parking paid / part / settle
  "invoices-panel.tsx": { names: 0, me: 1 }, // an invoice payment (the signed-in person, or the Business account)
  "package-delivery.tsx": { names: 0, me: 1 }, // cash collected at a handover
};

test("every picker where the console records money offers the Business account", () => {
  const problems: string[] = [];
  for (const [file, want] of Object.entries(PICKERS)) {
    const path = join("src", "components", "business", file);
    const source = readFileSync(path, "utf8");
    const names = (source.match(/<ReceivedByOptions\b/g) ?? []).length;
    const me = (source.match(/<ReceivedByMeOptions\b/g) ?? []).length;
    if (names !== want.names) problems.push(`${file}: ${names} <ReceivedByOptions>, expected ${want.names}`);
    if (me !== (want.me ?? 0)) problems.push(`${file}: ${me} <ReceivedByMeOptions>, expected ${want.me ?? 0}`);
  }
  assert.deepEqual(problems, []);
});

test("no 'Received by' select is built by hand any more", () => {
  const offenders: string[] = [];
  const hasOptions = (block: string) => /ReceivedBy(Me)?Options/.test(block);
  for (const file of sourceFiles(join("src", "components"))) {
    const source = readFileSync(file, "utf8");
    // A label with the select right after it...
    for (const m of source.matchAll(/<span>Received by<\/span>\s*<select/g)) {
      const start = m.index!;
      const block = source.slice(start, source.indexOf("</select>", start));
      if (!hasOptions(block)) offenders.push(`${file}: ${block.slice(0, 100)}`);
    }
    // ...or the select itself carrying the label.
    for (const m of source.matchAll(/<select[^>]*aria-label="Received by"[^>]*>/g)) {
      const start = m.index!;
      const block = source.slice(start, source.indexOf("</select>", start));
      if (!hasOptions(block)) offenders.push(`${file}: ${block.slice(0, 100)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("invoice and delivery payments name the Business account only when it is chosen", () => {
  const delivery = deliverRequest({ businessId: "b", lineId: "l", collectedCents: 4000, receivedByStaffId: BUSINESS_ACCOUNT_RECEIVER });
  assert.equal(delivery.receivedByStaffId, BUSINESS_ACCOUNT_RECEIVER);
  assert.equal("receivedByStaffId" in deliverRequest({ businessId: "b", lineId: "l", collectedCents: 4000, receivedByStaffId: "" }), false, "the server defaults to the agent");
  assert.equal("receivedByStaffId" in deliverRequest({ businessId: "b", lineId: "l", collectedCents: 4000, receivedByStaffId: "someone" }), false);
  assert.equal("receivedByStaffId" in deliverRequest({ businessId: "b", lineId: "l", collectedCents: 0, receivedByStaffId: BUSINESS_ACCOUNT_RECEIVER }), false, "no money, no receiver");
  const invoices = readFileSync(join("src", "components", "business", "invoices-panel.tsx"), "utf8");
  assert.match(invoices, /paymentReceiver === BUSINESS_ACCOUNT_RECEIVER \? \{ receivedByStaffId: BUSINESS_ACCOUNT_RECEIVER \}/);
});

// ---------------------------------------------------------------------------
// The wiring: page, actions, badge, Today row, sidebar.
// ---------------------------------------------------------------------------

const panel = readFileSync(join("src", "components", "business", "staff-balances-panel.tsx"), "utf8");
const consoleSource = readFileSync(join("src", "components", "business-console.tsx"), "utf8");

test("the page asks the server for the numbers, with a timeout, and again after every action", () => {
  assert.match(panel, /httpsCallable\(functions, "updateLotExpenseEntry"\)\(staffBalancesRequest\(businessId\)\)/);
  assert.match(panel, /STAFF_BALANCES_TIMEOUT_MS/);
  assert.match(panel, /finally \{[^}]*setLoading\(false\)/s, "loading always resolves");
  assert.match(panel, /await httpsCallable\(functions, "updateLotExpenseEntry"\)\(payload\);[\s\S]*?void load\(\);/, "refresh after an action");
  assert.match(panel, /useBusinessCollection\("staffHandovers", businessId/);
});

test("each action sends its request through updateLotExpenseEntry", () => {
  assert.match(panel, /act\("record", recordHandoverRequest\(businessId, draft\)/);
  assert.match(panel, /act\("confirm", confirmHandoverRequest\(businessId, id\)/);
  assert.match(panel, /act\("decline", declineHandoverRequest\(businessId, id, note\)/);
  assert.match(panel, /act\("void", voidHandoverRequest\(businessId, id, reason\)/);
  assert.match(panel, /act\("opening", recordOpeningRequest\(businessId, draft\)/);
  assert.match(panel, /uploadStaffHandoverProof\(businessId, file\)/);
});

test("the actions are offered only to who may take them, and block double taps", () => {
  assert.match(panel, /viewer\.isOwner && \(\s*<button[^>]*onClick=\{\(\) => setOpening\(true\)\}/, "Opening amount is the owner's");
  assert.match(panel, /canVoidHandover\(h, viewer\) && \(/);
  assert.match(panel, /waitingOnViewerRows\(handovers, viewer\)/);
  assert.match(panel, /disabled=\{busy !== ""\} onClick=\{\(\) => void onConfirm\(h\.id\)\}/);
  assert.match(panel, /handoverProblem\(draft, viewerUid,/, "the form checks before sending");
});

test("the sidebar entry, its badge and the Today row are wired", () => {
  assert.match(consoleSource, /badge=\{tab\.id === "staffBalances" \? waitingHandovers\.count : 0\}/);
  assert.match(consoleSource, /where: PENDING_HANDOVERS_WHERE/);
  assert.match(consoleSource, /extraAttention=\{todayExtraAttention\}/);
  assert.match(consoleSource, /tab: "staffBalances"/);
  assert.match(consoleSource, /activeTab === "staffBalances" &&/);
  const today = readFileSync(join("src", "components", "business", "today-view.tsx"), "utf8");
  assert.match(today, /\[\.\.\.extraAttention, \.\.\.attention\]/);
  assert.match(today, /attentionRows\.map\(\(item\) =>/);
});

// ---------------------------------------------------------------------------
// French.
// ---------------------------------------------------------------------------

const known = (english: string) => english in TEXT_TRANSLATIONS || english in ATTRIBUTE_TRANSLATIONS;

test("the Business account and the page's words are translated", () => {
  assert.equal(translateValue(BUSINESS_ACCOUNT_LABEL, "fr"), "Compte de l’entreprise (Zelle, virement, carte)");
  assert.equal(translateValue("Business account", "fr"), "Compte de l’entreprise");
  assert.equal(translateValue("Staff balances", "fr"), "Soldes du personnel");
  assert.equal(translateValue("Hand over money", "fr"), "Remettre de l’argent");
  assert.equal(translateValue("Confirm received", "fr"), "Confirmer la réception");
});

test("every refusal, method, status, breakdown line and net phrase has a French entry", () => {
  const strings = [
    ...Object.values(STAFF_BALANCES_REFUSAL_COPY),
    ...HANDOVER_METHODS.map((m) => m.label),
    ...Object.values(HANDOVER_STATUS_LABELS),
    ...breakdownLines(answer.staff[0]).map((l) => l.label),
    netPhrase(1).label, netPhrase(-1).label, netPhrase(0).label,
    "Choose the team member.", "Money handed to you to confirm", "Who holds or owes what",
    BUSINESS_ACCOUNT_LABEL, "Me (I hold the money)", "Business account (the owner confirms)",
  ];
  const missing = strings.filter((s) => !known(s));
  assert.deepEqual(missing, []);
});

test("every word the Staff balances page shows has a French entry", () => {
  const strings = new Set<string>();
  const add = (value: string) => {
    const v = value.replace(/\s+/g, " ").trim().replace(/&apos;/g, "'");
    // Skip code-ish text: braces, punctuation only, numbers, or a lone symbol.
    if (v && /[A-Za-z]{2}/.test(v) && !/[{}=<>]/.test(v) && !/Promise/.test(v)) strings.add(v);
  };
  for (const m of panel.matchAll(/>([^<>{}]+)</g)) add(m[1]);
  for (const m of panel.matchAll(/\b(?:title|intro|label|confirmLabel|placeholder|aria-label|alt)="([^"{}]+)"/g)) add(m[1]);
  for (const m of panel.matchAll(/<h3>([^<{]+)<\/h3><p>([^<{]+)<\/p>/g)) { add(m[1]); add(m[2]); }
  for (const m of panel.matchAll(/(?:setFlash|"(?:Hand-over|Opening)[^"]*")/g)) void m;
  for (const m of panel.matchAll(/"((?:Hand-over|Opening amount|The balances|Loading the balances)[^"]*)"/g)) add(m[1]);
  const missing = [...strings].filter((s) => !known(s));
  assert.deepEqual(missing, []);
});

test("every English picker label is a dictionary entry", () => {
  const options = readFileSync(join("src", "components", "business", "received-by-options.tsx"), "utf8");
  assert.ok(known("Me (I hold the money)") && options.includes("Me (I hold the money)"));
  assert.ok(known(BUSINESS_ACCOUNT_LABEL));
});

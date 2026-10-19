import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStockIndex, inventoryItemFromRow, inventoryStores, type InventoryViewer } from "./inventory.ts";
import {
  addComposeLine,
  arrivedOfText,
  canCancelTransfer,
  canContinueDraft,
  canDiscardDraft,
  canReceiveTransfer,
  canResolveLine,
  canResolveTransfer,
  cancelTransferRequest,
  clampQuantity,
  composeFromDraft,
  composeItemsCount,
  composeProblems,
  composeRequest,
  confirmReceivedText,
  didNotArriveText,
  inventoryTransferFromRow,
  lineResultText,
  maySendFrom,
  mergeComposeLines,
  mergeTransferRows,
  monthStartMs,
  movementDirection,
  movementTransferText,
  newTransferRequestId,
  readSendAnswer,
  readTransferTotals,
  readTypedQuantity,
  receiveCountsFrom,
  receiveShortfall,
  receiveTransferRequest,
  resolveLineRequest,
  sendButtonText,
  sendableStores,
  sentNoticeText,
  storeAvailable,
  trackRecordLines,
  transferAttentionCount,
  transferChipCounts,
  transferChipList,
  transferFailure,
  transferFocusFrom,
  transferReadOptions,
  transferStatusView,
  transferTabCounts,
  transferTabs,
  transferTiles,
  transferTimeText,
  transferTotalsText,
  transferVisibleToViewer,
  transfersCountText,
  validateWriteOff,
  withDifferencesText,
  type InventoryTransfer,
  type TransferViewer,
} from "./inventory-transfers.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 18, 18, 0); // Oct 18, 2026, 2:00 PM New York

const owner: TransferViewer = { isOwner: true, homeStoreId: "", allStores: false, uid: "u-owner" };
const allStaff: TransferViewer = { isOwner: false, homeStoreId: "bronx", allStores: true, uid: "u-all" };
const bronxStaff: TransferViewer = { isOwner: false, homeStoreId: "bronx", allStores: false, uid: "u-bronx" };
const harlemStaff: TransferViewer = { isOwner: false, homeStoreId: "harlem", allStores: false, uid: "u-harlem" };
const queensStaff: TransferViewer = { isOwner: false, homeStoreId: "queens", allStores: false, uid: "u-queens" };

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    businessId: "biz",
    clientRequestId: "web-key-1",
    code: "TR-4K8Q2A",
    status: "in_transit",
    stage: "in_transit",
    fromStoreId: "bronx",
    fromStoreName: "Bronx store",
    toStoreId: "harlem",
    toStoreName: "Harlem store",
    lines: [
      { itemId: "i1", name: "11", brand: "Jordan", code: "IT-AAAAAA", costCents: 5000, quantitySent: 6, quantityReceived: null, missing: 0, resolution: "" },
      { itemId: "i2", name: "Air Force 1", brand: "", code: "IT-BBBBBB", costCents: null, quantitySent: 5, quantityReceived: null, missing: 0, resolution: "" },
    ],
    productsCount: 2,
    itemsCount: 11,
    receivedCount: null,
    missingCount: 0,
    openMissingCount: 0,
    valueCents: 30000,
    openMissingValueCents: 0,
    linesWithoutCost: 1,
    createdByStaffId: "u-bronx",
    createdByName: "Ibrahima",
    createdAt: new Date(NOW - 3 * DAY),
    updatedAt: new Date(NOW - 3 * DAY),
    sentByStaffId: "u-bronx",
    sentByName: "Ibrahima",
    sentAt: new Date(NOW - 3 * DAY),
    timeline: [],
    ...over,
  };
}

const t = (over: Record<string, unknown> = {}): InventoryTransfer => inventoryTransferFromRow(row(over));

// ---------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------

test("a transfer document is read with every field, and timestamps as milliseconds", () => {
  const transfer = t();
  assert.equal(transfer.code, "TR-4K8Q2A");
  assert.equal(transfer.status, "in_transit");
  assert.equal(transfer.stage, "in_transit");
  assert.equal(transfer.lines.length, 2);
  assert.equal(transfer.lines[0].costCents, 5000);
  assert.equal(transfer.lines[1].costCents, null);
  assert.equal(transfer.lines[0].quantityReceived, null);
  assert.equal(transfer.sentAtMs, NOW - 3 * DAY);
  assert.equal(transfer.receivedAtMs, 0);
});

test("missing fields are worked out from the lines and the status, never thrown on", () => {
  const bare = inventoryTransferFromRow({
    id: "t9",
    status: "received_with_differences",
    lines: [
      { itemId: "i1", costCents: 100, quantitySent: 4, quantityReceived: 3 },
      { itemId: "i2", quantitySent: 2, quantityReceived: 2 },
      { name: "no id" },
    ],
  });
  assert.equal(bare.lines.length, 2);
  assert.equal(bare.lines[0].missing, 1);
  assert.equal(bare.itemsCount, 6);
  assert.equal(bare.receivedCount, 5);
  assert.equal(bare.missingCount, 1);
  assert.equal(bare.openMissingCount, 1);
  assert.equal(bare.stage, "review");
  assert.equal(bare.valueCents, 400);
  assert.equal(bare.openMissingValueCents, 100);
  assert.equal(bare.linesWithoutCost, 1);
  // Junk reads as an empty draft.
  const junk = inventoryTransferFromRow(null);
  assert.equal(junk.status, "draft");
  assert.equal(junk.stage, "draft");
  assert.deepEqual(junk.lines, []);
  assert.equal(inventoryTransferFromRow({ status: "weird" }).status, "draft");
  // A settled transfer with differences is done.
  assert.equal(inventoryTransferFromRow({ status: "received_with_differences", openMissingCount: 0 }).stage, "done");
});

test("the timeline is read oldest first", () => {
  const transfer = t({
    timeline: [
      { event: "sent", byName: "Ibrahima", at: new Date(NOW - DAY), itemsCount: 11 },
      { event: "draft_created", byName: "Ibrahima", at: new Date(NOW - 2 * DAY) },
      { byName: "no event" },
    ],
  });
  assert.deepEqual(transfer.timeline.map((e) => e.event), ["draft_created", "sent"]);
});

// ---------------------------------------------------------------------------
// Permissions mirror the server.
// ---------------------------------------------------------------------------

test("who may send from a store: the owner, all-stores staff, or that store's own staff", () => {
  assert.ok(maySendFrom(owner, "harlem"));
  assert.ok(maySendFrom(allStaff, "harlem"));
  assert.ok(maySendFrom(bronxStaff, "bronx"));
  assert.ok(!maySendFrom(bronxStaff, "harlem"));
  assert.ok(!maySendFrom(owner, ""));
  const stores = inventoryStores([
    { id: "bronx", name: "Bronx store", createdAt: 1 },
    { id: "harlem", name: "Harlem store", createdAt: 2 },
    { id: "old", name: "Old", archived: true, createdAt: 3 },
  ], true);
  assert.deepEqual(sendableStores(owner, stores).map((s) => s.id), ["bronx", "harlem"]);
  assert.deepEqual(sendableStores(bronxStaff, stores).map((s) => s.id), ["bronx"]);
  assert.deepEqual(sendableStores(queensStaff, stores).map((s) => s.id), []);
});

test("cancel: the sender, the owner or all-stores staff, only while in transit", () => {
  const transfer = t();
  assert.ok(canCancelTransfer(transfer, owner));
  assert.ok(canCancelTransfer(transfer, allStaff));
  assert.ok(canCancelTransfer(transfer, bronxStaff), "the sender");
  assert.ok(!canCancelTransfer(transfer, harlemStaff), "the destination cannot cancel");
  assert.ok(!canCancelTransfer(transfer, { ...bronxStaff, uid: "someone-else" }), "a colleague of the sender");
  assert.ok(!canCancelTransfer(t({ status: "received", stage: "done" }), owner));
});

test("drafts: discarded by their creator or whoever may send from the source; continued by whoever may send", () => {
  const draft = t({ status: "draft", stage: "draft", createdByStaffId: "u-bronx" });
  assert.ok(canDiscardDraft(draft, bronxStaff));
  assert.ok(canDiscardDraft(draft, owner));
  assert.ok(canDiscardDraft(draft, allStaff));
  assert.ok(!canDiscardDraft(draft, harlemStaff));
  // The creator moved to another store can still discard it, not send it.
  const moved: TransferViewer = { ...harlemStaff, uid: "u-bronx" };
  assert.ok(canDiscardDraft(draft, moved));
  assert.ok(!canContinueDraft(draft, moved));
  assert.ok(canContinueDraft(draft, bronxStaff));
  assert.ok(!canDiscardDraft(t(), owner), "not a draft");
});

test("receive: the destination's staff, the owner or all-stores staff; resolve: owner and all-stores staff in review", () => {
  const transfer = t();
  assert.ok(canReceiveTransfer(transfer, harlemStaff));
  assert.ok(canReceiveTransfer(transfer, owner));
  assert.ok(canReceiveTransfer(transfer, allStaff));
  assert.ok(!canReceiveTransfer(transfer, bronxStaff), "the source store cannot confirm its own transfer");
  assert.ok(!canReceiveTransfer(t({ status: "cancelled", stage: "done" }), harlemStaff));
  const review = t({
    status: "received_with_differences", stage: "review",
    lines: [{ itemId: "i1", quantitySent: 6, quantityReceived: 4, missing: 2, resolution: "" }, { itemId: "i2", quantitySent: 5, quantityReceived: 5, missing: 0 }],
  });
  assert.ok(canResolveTransfer(review, owner));
  assert.ok(canResolveTransfer(review, allStaff));
  assert.ok(!canResolveTransfer(review, harlemStaff));
  assert.ok(canResolveLine(review, review.lines[0], owner));
  assert.ok(!canResolveLine(review, review.lines[1], owner), "nothing missing");
  assert.ok(!canResolveTransfer(t(), owner), "not in review");
});

test("visibility: the business, the store reach, and drafts only for whoever may send from their source", () => {
  assert.ok(transferVisibleToViewer(row(), "biz", owner));
  assert.ok(!transferVisibleToViewer(row(), "other", owner));
  assert.ok(transferVisibleToViewer(row(), "biz", harlemStaff));
  assert.ok(transferVisibleToViewer(row(), "biz", bronxStaff));
  assert.ok(!transferVisibleToViewer(row(), "biz", queensStaff));
  const draft = row({ status: "draft", stage: "draft" });
  assert.ok(transferVisibleToViewer(draft, "biz", bronxStaff));
  assert.ok(!transferVisibleToViewer(draft, "biz", harlemStaff), "a destination never sees another store's draft");
  assert.ok(transferVisibleToViewer(draft, "biz", owner));
  assert.ok(!transferVisibleToViewer(row(), "biz", { ...harlemStaff, homeStoreId: "" }));
});

test("merging reads: one entry per transfer, the latest write kept, foreign and hidden rows dropped", () => {
  const older = row({ updatedAt: new Date(NOW - DAY), status: "in_transit" });
  const newer = row({ updatedAt: new Date(NOW), status: "received", stage: "done", receivedAt: new Date(NOW) });
  const foreign = row({ id: "t2", businessId: "x" });
  const draftOther = row({ id: "t3", status: "draft", stage: "draft", fromStoreId: "queens" });
  const merged = mergeTransferRows([[older, foreign], [newer, draftOther]], "biz", harlemStaff);
  assert.deepEqual(merged.map((m) => [m.id, m.status]), [["t1", "received"]]);
});

// ---------------------------------------------------------------------------
// Lists.
// ---------------------------------------------------------------------------

const list = [
  t({ id: "a-draft", status: "draft", stage: "draft", updatedAt: new Date(NOW - DAY), createdAt: new Date(NOW - DAY), sentAt: null }),
  t({ id: "b-old", status: "in_transit", stage: "in_transit", sentAt: new Date(NOW - 3 * DAY) }),
  t({ id: "c-new", status: "in_transit", stage: "in_transit", fromStoreId: "harlem", toStoreId: "bronx", sentAt: new Date(NOW - 2 * 3600_000) }),
  t({ id: "d-review", status: "received_with_differences", stage: "review", receivedAt: new Date(NOW - DAY), openMissingCount: 2, openMissingValueCents: 10000, receivedCount: 9, missingCount: 2 }),
  t({ id: "e-done", status: "received", stage: "done", fromStoreId: "queens", toStoreId: "harlem", receivedAt: new Date(NOW - 2 * DAY), receivedCount: 11 }),
  t({ id: "f-cancel", status: "cancelled", stage: "done", fromStoreId: "queens", toStoreId: "bronx", cancelledAt: new Date(NOW - 4 * DAY), updatedAt: new Date(NOW - 4 * DAY) }),
];

test("tabs for one store: outgoing drafts first, incoming without drafts, in transit both ways, review both ways", () => {
  const tabs = transferTabs(list, "bronx");
  assert.deepEqual(tabs.outgoing.map((x) => x.id), ["a-draft", "b-old", "d-review"]);
  assert.deepEqual(tabs.incoming.map((x) => x.id), ["c-new", "f-cancel"]);
  assert.deepEqual(tabs.in_transit.map((x) => x.id), ["b-old", "c-new"]);
  assert.deepEqual(tabs.review.map((x) => x.id), ["d-review"]);
  assert.deepEqual(transferTabCounts(list, "harlem"), { outgoing: 1, incoming: 3, in_transit: 2, review: 1 });
});

test("tabs for All stores: outgoing is everything, incoming and in transit are what is on the road", () => {
  const tabs = transferTabs(list, "");
  assert.equal(tabs.outgoing.length, list.length);
  assert.deepEqual(tabs.outgoing.slice(0, 4).map((x) => x.id), ["a-draft", "b-old", "c-new", "d-review"]);
  assert.deepEqual(tabs.incoming.map((x) => x.id), ["b-old", "c-new"]);
  assert.deepEqual(tabs.in_transit.map((x) => x.id), ["b-old", "c-new"]);
  assert.deepEqual(tabs.review.map((x) => x.id), ["d-review"]);
});

test("console chips: review first, then in transit oldest first, then drafts, then the rest newest first", () => {
  assert.deepEqual(transferChipList(list, "all", "").map((x) => x.id), ["d-review", "b-old", "c-new", "a-draft", "e-done", "f-cancel"]);
  assert.deepEqual(transferChipList(list, "in_transit", "").map((x) => x.id), ["b-old", "c-new"]);
  assert.deepEqual(transferChipList(list, "review", "").map((x) => x.id), ["d-review"]);
  assert.deepEqual(transferChipList(list, "drafts", "").map((x) => x.id), ["a-draft"]);
  assert.deepEqual(transferChipList(list, "all", "queens").map((x) => x.id), ["e-done", "f-cancel"]);
  assert.deepEqual(transferChipCounts(list, ""), { all: 6, in_transit: 2, review: 1, drafts: 1 });
  assert.deepEqual(transferChipCounts(list, "harlem"), { all: 5, in_transit: 2, review: 1, drafts: 1 });
});

test("the tab badge: review for whoever decides, incoming in transit for a store's staff", () => {
  assert.equal(transferAttentionCount(list, owner), 1);
  assert.equal(transferAttentionCount(list, allStaff), 1);
  assert.equal(transferAttentionCount(list, harlemStaff), 1);
  assert.equal(transferAttentionCount(list, bronxStaff), 1);
  assert.equal(transferAttentionCount(list, queensStaff), 0);
  assert.equal(transferAttentionCount(list, { ...queensStaff, homeStoreId: "" }), 0);
});

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

test("the read shapes match the contract: open by stage, recent newest first, received since the month start", () => {
  assert.deepEqual(transferReadOptions("open", "", ""), { pageSize: null, where: [["stage", "in", ["draft", "in_transit", "review"]]], sort: "query" });
  assert.deepEqual(transferReadOptions("open", "from", "bronx").where, [["fromStoreId", "==", "bronx"], ["stage", "in", ["draft", "in_transit", "review"]]]);
  assert.deepEqual(transferReadOptions("open", "to", "bronx").where?.[0], ["toStoreId", "==", "bronx"]);
  assert.deepEqual(transferReadOptions("recent", "", ""), { pageSize: 100, where: [], sort: "query" });
  assert.equal(transferReadOptions("recent", "to", "bronx").pageSize, 50);
  const month = transferReadOptions("month", "from", "bronx", 1000);
  assert.equal(month.orderBy, "receivedAt");
  assert.equal(month.direction, "desc");
  assert.equal(month.pageSize, null);
  assert.deepEqual(month.where, [["fromStoreId", "==", "bronx"], ["receivedAt", ">=", new Date(1000)]]);
  // A side without a store is the unscoped read.
  assert.deepEqual(transferReadOptions("recent", "from", "").where, []);
});

test("the month starts at midnight of the 1st in the business's zone", () => {
  assert.equal(monthStartMs("2026-10-18", "America/New_York"), Date.UTC(2026, 9, 1, 4, 0));
  assert.equal(monthStartMs("2026-03-20", "America/New_York"), Date.UTC(2026, 2, 1, 5, 0));
});

// ---------------------------------------------------------------------------
// Tiles and the summary line.
// ---------------------------------------------------------------------------

test("tiles: in transit and disputed from the open read, received this month from the month read, narrowed by store", () => {
  const open = list.filter((x) => x.stage !== "done");
  const month = [
    t({ id: "m1", status: "received", stage: "done", receivedAt: new Date(NOW - DAY), receivedCount: 10 }),
    t({ id: "m2", status: "received_with_differences", stage: "review", receivedAt: new Date(NOW - DAY), receivedCount: 9 }),
    t({ id: "m3", status: "received", stage: "done", receivedAt: new Date(NOW - 40 * DAY), receivedCount: 4 }),
    t({ id: "m1", status: "received", stage: "done", receivedAt: new Date(NOW - DAY), receivedCount: 10 }),
  ];
  const since = NOW - 20 * DAY;
  const all = transferTiles(open, month, "", since);
  assert.deepEqual(all.inTransit, { transfers: 2, items: 22, valueCents: 60000, linesWithoutCost: 2 });
  assert.deepEqual(all.disputed, { transfers: 1, items: 2, valueCents: 10000 });
  assert.deepEqual(all.received, { transfers: 2, items: 19, withDifferences: 1 });
  const queens = transferTiles(open, month, "queens", since);
  assert.equal(queens.inTransit.transfers, 0);
  assert.equal(queens.received.transfers, 0);
});

test("the summary's transfers block: absent on an old server, a short line when anything is open", () => {
  assert.equal(readTransferTotals({ salesCount: 1 }), null);
  assert.equal(transferTotalsText(null), "");
  const totals = readTransferTotals({ transfers: { inTransitCount: 2, inTransitItems: 14, inTransitValueCents: 12000, disputedCount: 1, disputedItems: 2, disputedValueCents: 4000 } });
  assert.ok(totals);
  assert.equal(transferTotalsText(totals, "en"), "In transit $120.00 · Disputed $40.00");
  assert.equal(transferTotalsText(totals, "fr"), "En route 120,00 $ · Litige 40,00 $");
  const noCost = readTransferTotals({ transfers: { inTransitCount: 1, inTransitItems: 3 } });
  assert.equal(transferTotalsText(noCost, "en"), "In transit 3 items");
  assert.equal(transferTotalsText(readTransferTotals({ transfers: {} }), "en"), "");
});

// ---------------------------------------------------------------------------
// Status and sentences.
// ---------------------------------------------------------------------------

test("status: in transit shows its age from 2 days, highlighted", () => {
  const fresh = transferStatusView(t({ sentAt: new Date(NOW - DAY - 3600_000) }), { nowMs: NOW });
  assert.deepEqual([fresh.label, fresh.tone], ["In transit", "navy"]);
  const late = transferStatusView(t({ sentAt: new Date(NOW - 3 * DAY) }), { nowMs: NOW });
  assert.deepEqual([late.label, late.tone], ["In transit 3 days", "warn"]);
  assert.equal(transferStatusView(t({ sentAt: new Date(NOW - 2 * DAY) }), { nowMs: NOW }).label, "In transit 2 days");
  assert.equal(transferStatusView(t({ sentAt: new Date(NOW - 3 * DAY) }), { nowMs: NOW, lang: "fr" }).label, "En route depuis 3 jours");
});

test("status: draft, received, review (by who decides), settled, cancelled", () => {
  const draft = transferStatusView(t({ status: "draft", stage: "draft" }), { nowMs: NOW });
  assert.deepEqual([draft.label, draft.detail], ["Draft", "not sent · nothing reserved yet"]);
  const received = transferStatusView(
    t({ status: "received", stage: "done", receivedCount: 11, receivedAt: new Date(Date.UTC(2026, 9, 15, 16)), receivedByName: "Aminata" }),
    { nowMs: NOW },
  );
  assert.deepEqual([received.label, received.detail], ["Received", "11 of 11 received · Oct 15 by Aminata"]);
  const reviewRow = { status: "received_with_differences", stage: "review", receivedCount: 9, missingCount: 2, receivedAt: new Date(NOW) };
  assert.deepEqual([transferStatusView(t(reviewRow), { nowMs: NOW, canResolve: true }).label, transferStatusView(t(reviewRow), { nowMs: NOW, canResolve: true }).tone], ["Needs review", "danger"]);
  assert.equal(transferStatusView(t(reviewRow), { nowMs: NOW }).label, "Received · 2 missing");
  assert.equal(transferStatusView(t({ ...reviewRow, stage: "done" }), { nowMs: NOW }).label, "Settled");
  assert.equal(transferStatusView(t({ status: "cancelled", stage: "done" }), { nowMs: NOW }).label, "Cancelled");
  assert.equal(transferStatusView(t({ status: "cancelled", stage: "done" }), { nowMs: NOW, lang: "fr" }).label, "Annulé");
});

test("a line's result, per language", () => {
  const base = { itemId: "i", name: "11", brand: "Jordan", code: "", costCents: null, quantitySent: 6, resolutionNote: "", resolvedByStaffId: "", resolvedByName: "", resolvedAtMs: 0 };
  assert.equal(lineResultText({ ...base, quantityReceived: null, missing: 0, resolution: "", writeOffReason: "" }, "Bronx store"), "");
  assert.equal(lineResultText({ ...base, quantityReceived: 6, missing: 0, resolution: "", writeOffReason: "" }, "Bronx store"), "Complete");
  assert.equal(lineResultText({ ...base, quantityReceived: 4, missing: 2, resolution: "", writeOffReason: "" }, "Bronx store"), "2 missing · disputed");
  assert.equal(lineResultText({ ...base, quantityReceived: 4, missing: 2, resolution: "returned", writeOffReason: "" }, "Bronx store"), "2 returned to Bronx store");
  assert.equal(lineResultText({ ...base, quantityReceived: 4, missing: 2, resolution: "written_off", writeOffReason: "lost" }, "Bronx store"), "2 written off · Lost in transit");
  assert.equal(lineResultText({ ...base, quantityReceived: 4, missing: 2, resolution: "written_off", writeOffReason: "damaged" }, "Bronx store", "fr"), "2 passés en perte · Endommagé");
  assert.equal(lineResultText({ ...base, quantityReceived: 4, missing: 2, resolution: "", writeOffReason: "" }, "Bronx store", "fr"), "2 manquants · en litige");
});

test("the track record names who and when, oldest first, with the receive note", () => {
  const transfer = t({
    timeline: [
      { event: "draft_created", byName: "Ibrahima", at: new Date(Date.UTC(2026, 9, 18, 18, 31)) },
      { event: "sent", byName: "Ibrahima", at: new Date(Date.UTC(2026, 9, 18, 18, 40)), itemsCount: 14 },
      { event: "received", byName: "Aminata", at: new Date(Date.UTC(2026, 9, 18, 21, 12)), receivedCount: 12, missingCount: 2, note: "Box arrived opened" },
      { event: "returned", byName: "", at: new Date(Date.UTC(2026, 9, 19, 13)), itemName: "Jordan 11", quantity: 1 },
      { event: "written_off", byName: "Owner", at: new Date(Date.UTC(2026, 9, 19, 14)), itemName: "Jordan 11", quantity: 1, reason: "stolen", note: "police report" },
      { event: "mystery", byName: "X", at: new Date() },
    ],
  });
  const lines = trackRecordLines(transfer, { storeName: (_id, snap) => snap });
  assert.deepEqual(lines.map((l) => l.text), [
    "Draft created by Ibrahima",
    "Sent by Ibrahima · 14 items",
    "Aminata confirmed 12 received, 2 missing",
    "Someone returned 1 × Jordan 11 to Bronx store",
    "Owner wrote off 1 × Jordan 11 · Stolen",
  ]);
  assert.equal(lines[0].at, "Oct 18, 2:31 PM");
  assert.equal(lines[2].note, "Box arrived opened");
  const fr = trackRecordLines(transfer, { lang: "fr" });
  assert.equal(fr[0].at, "18 oct., 14:31");
  assert.equal(fr[2].text, "Aminata a confirmé 12 reçus, 2 manquants");
  assert.equal(fr[3].text, "Quelqu’un a renvoyé 1 × Jordan 11 à Bronx store");
  const allArrived = trackRecordLines(t({ timeline: [{ event: "received", byName: "Aminata", at: new Date(NOW), receivedCount: 1, missingCount: 0 }] }));
  assert.equal(allArrived[0].text, "Aminata confirmed all 1 item received");
  const cancelled = trackRecordLines(t({ timeline: [{ event: "cancelled", byName: "Ibrahima", at: new Date(NOW), itemsCount: 11 }] }), { storeName: () => "Bronx (renamed)" });
  assert.equal(cancelled[0].text, "Cancelled by Ibrahima · 11 items back in Bronx (renamed)");
});

test("times read month first in English, day first in French, in the business's zone", () => {
  assert.equal(transferTimeText(Date.UTC(2026, 9, 15, 3, 5), "en", "America/New_York"), "Oct 14, 11:05 PM");
  assert.equal(transferTimeText(0), "");
});

test("the sentences with counts and store names", () => {
  assert.equal(sendButtonText(14), "Send 14 items");
  assert.equal(sendButtonText(1, "fr"), "Envoyer 1 article");
  assert.deepEqual(sentNoticeText(14, "Harlem store"), {
    lead: "14 items are on their way. Harlem store's team got a notification and will confirm when they arrive.",
    hint: "Until Harlem store confirms, these items can't be sold in either store. Made a mistake? You can cancel until Harlem store confirms.",
  });
  assert.match(sentNoticeText(1, "Harlem store", "fr").lead, /^1 article est en route\./);
  assert.equal(didNotArriveText(2), "2 items didn't arrive");
  assert.equal(didNotArriveText(1, "fr"), "1 article n’est pas arrivé");
  assert.equal(arrivedOfText(12, 14), "12 of 14 arrived. The owner will be told about the missing ones.");
  assert.equal(confirmReceivedText(12), "Confirm 12 received");
  assert.equal(confirmReceivedText(12, "fr"), "Confirmer 12 reçus");
  assert.equal(transfersCountText(1), "1 transfer");
  assert.equal(transfersCountText(3, "fr"), "3 transferts");
  assert.equal(withDifferencesText(2), "2 with differences");
});

test("movements of a transfer read code and direction, without words to translate", () => {
  assert.deepEqual(movementDirection("transfer_received", "harlem", "bronx"), { fromStoreId: "bronx", toStoreId: "harlem" });
  assert.deepEqual(movementDirection("transfer_sent", "bronx", "harlem"), { fromStoreId: "bronx", toStoreId: "harlem" });
  assert.equal(movementTransferText("TR-4K8Q2A", "Bronx store", "Harlem store"), "TR-4K8Q2A · Bronx store → Harlem store");
  assert.equal(movementTransferText("TR-4K8Q2A", "", ""), "TR-4K8Q2A");
});

// ---------------------------------------------------------------------------
// Composing, receiving, resolving.
// ---------------------------------------------------------------------------

test("lines: a product added twice is merged, quantities stay within the store's count", () => {
  let lines = addComposeLine([], "i1", 1, 3);
  lines = addComposeLine(lines, "i2", 1, null);
  lines = addComposeLine(lines, "i1", 5, 3);
  assert.deepEqual(lines, [{ itemId: "i1", quantity: 3 }, { itemId: "i2", quantity: 1 }]);
  assert.deepEqual(mergeComposeLines([{ itemId: "a", quantity: 2 }, { itemId: "b", quantity: 0 }, { itemId: "a", quantity: 3 }, { itemId: " ", quantity: 1 }]), [{ itemId: "a", quantity: 5 }]);
  assert.equal(composeItemsCount([{ itemId: "a", quantity: 2 }, { itemId: "a", quantity: 3 }]), 5);
  assert.equal(clampQuantity(9, 1, 3), 3);
  assert.equal(clampQuantity(-2, 1, 3), 1);
  assert.equal(clampQuantity("x", 0, 3), 0);
  assert.equal(clampQuantity(5_000_000, 1, null), 1_000_000);
  assert.equal(readTypedQuantity("4", 1, 3), 3);
  assert.equal(readTypedQuantity("", 1, 3), null);
  assert.equal(readTypedQuantity("2.5", 1, 3), null);
});

test("what a line may send: the source store's count, the whole count at Main for a product not yet counted per store", () => {
  const stores = inventoryStores([
    { id: "main", name: "Main store", isMain: true, createdAt: 1 },
    { id: "down", name: "Downtown", createdAt: 2 },
  ]);
  const counted = inventoryItemFromRow({ id: "i1", quantity: 9, storeStock: true });
  const legacy = inventoryItemFromRow({ id: "i2", quantity: 7 });
  const stock = buildStockIndex([{ itemId: "i1", storeId: "main", quantity: 4 }, { itemId: "i1", storeId: "down", quantity: 5 }]);
  assert.equal(storeAvailable(counted, "main", stores, stock, true), 4);
  assert.equal(storeAvailable(counted, "down", stores, stock, true), 5);
  assert.equal(storeAvailable(legacy, "main", stores, stock, true), 7, "unmaterialised: Main holds the whole count");
  assert.equal(storeAvailable(legacy, "down", stores, stock, true), 0);
  assert.equal(storeAvailable(counted, "main", stores, stock, false), null, "unknown until the counts arrive");
  assert.equal(storeAvailable(undefined, "main", stores, stock, true), null);
});

test("compose problems: stores, lines, and over the store's count (a draft may go over, a send may not)", () => {
  const avail = (id: string) => (id === "i1" ? 3 : null);
  assert.deepEqual(composeProblems({ fromStoreId: "", toStoreId: "", lines: [] }, avail, true).problems, ["transfer_store_required", "transfer_lines_required"]);
  assert.deepEqual(composeProblems({ fromStoreId: "a", toStoreId: "a", lines: [{ itemId: "i1", quantity: 1 }] }, avail, true).problems, ["same_store"]);
  const over = composeProblems({ fromStoreId: "a", toStoreId: "b", lines: [{ itemId: "i1", quantity: 4 }, { itemId: "i9", quantity: 50 }] }, avail, true);
  assert.deepEqual(over, { problems: ["over_available"], overItemIds: ["i1"] });
  assert.deepEqual(composeProblems({ fromStoreId: "a", toStoreId: "b", lines: [{ itemId: "i1", quantity: 4 }] }, avail, false).problems, []);
  const many = Array.from({ length: 101 }, (_, i) => ({ itemId: `x${i}`, quantity: 1 }));
  assert.deepEqual(composeProblems({ fromStoreId: "a", toStoreId: "b", lines: many }, () => null, true).problems, ["transfer_lines_too_many"]);
});

test("the draft and send request: the key, both stores, merged lines", () => {
  assert.deepEqual(
    composeRequest(" biz ", "web-1", "bronx", "harlem", [{ itemId: "i1", quantity: 2 }, { itemId: "i1", quantity: 1 }, { itemId: "i2", quantity: 0 }]),
    { businessId: "biz", clientRequestId: "web-1", fromStoreId: "bronx", toStoreId: "harlem", lines: [{ itemId: "i1", quantity: 3 }] },
  );
  const draft = composeFromDraft(t({ status: "draft", stage: "draft" }));
  assert.deepEqual(draft, { clientRequestId: "web-key-1", fromStoreId: "bronx", toStoreId: "harlem", lines: [{ itemId: "i1", quantity: 6 }, { itemId: "i2", quantity: 5 }] });
  assert.match(newTransferRequestId(() => "abc"), /^web-abc$/);
  assert.deepEqual(readSendAnswer({ transferId: "t1", code: "TR-1", status: "in_transit", itemsCount: 3, productsCount: 1, replayed: true }),
    { transferId: "t1", code: "TR-1", status: "in_transit", itemsCount: 3, productsCount: 1, replayed: true });
  assert.equal(readSendAnswer(null).replayed, false);
});

test("receiving: prefilled with what was sent, capped at it, the shortfall worked out, the request explicit", () => {
  const transfer = t();
  const counts = receiveCountsFrom(transfer);
  assert.deepEqual(counts, { i1: 6, i2: 5 });
  assert.deepEqual(receiveShortfall(transfer, counts), { sent: 11, received: 11, missing: 0, lines: [] });
  const short = receiveShortfall(transfer, { i1: 4, i2: 99 });
  assert.deepEqual(short, { sent: 11, received: 9, missing: 2, lines: [{ itemId: "i1", name: "Jordan 11", sent: 6, counted: 4 }] });
  assert.deepEqual(receiveTransferRequest("biz", transfer, { i1: 4 }, "  Box opened ", "r1"), {
    businessId: "biz", transferId: "t1",
    lines: [{ itemId: "i1", quantityReceived: 4 }, { itemId: "i2", quantityReceived: 5 }],
    note: "Box opened", requestId: "r1",
  });
  assert.equal("note" in receiveTransferRequest("biz", transfer, counts, " ", "r1"), false);
  assert.deepEqual(cancelTransferRequest("biz", "t1", "c1"), { businessId: "biz", transferId: "t1", requestId: "c1" });
});

test("resolving: return needs nothing more; write off needs a reason, the note is optional", () => {
  assert.deepEqual(resolveLineRequest("biz", "t1", "i1", "return", { reason: "lost", note: "x", requestId: "q" }),
    { businessId: "biz", transferId: "t1", itemId: "i1", action: "return", requestId: "q" });
  assert.deepEqual(resolveLineRequest("biz", "t1", "i1", "write_off", { reason: "damaged", note: " wet ", requestId: "q" }),
    { businessId: "biz", transferId: "t1", itemId: "i1", action: "write_off", reason: "damaged", note: "wet", requestId: "q" });
  assert.deepEqual(validateWriteOff("", ""), ["write_off_reason_invalid"]);
  assert.deepEqual(validateWriteOff("other", "n".repeat(301)), ["note_too_long"]);
  assert.deepEqual(validateWriteOff("stolen", ""), []);
});

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

test("refusals are worded by code and by the details the server attaches", () => {
  const err = (reason: string, details: Record<string, unknown> = {}) => ({ code: "functions/failed-precondition", message: "x", details: { reason, ...details } });
  assert.equal(transferFailure(err("transfer_not_in_transit", { status: "received" })).message, "Already confirmed by the destination.");
  assert.equal(transferFailure(err("transfer_not_in_transit", { status: "received_with_differences" })).message, "Already confirmed by the destination.");
  assert.equal(transferFailure(err("transfer_not_in_transit", { status: "cancelled" })).message, "This transfer was cancelled.");
  assert.equal(transferFailure(err("transfer_not_in_transit")).message, "This transfer is no longer in transit.");
  assert.equal(transferFailure(err("transfer_not_draft", { status: "in_transit" })).message, "This transfer was already sent. Open it from the list.");
  const short = transferFailure(err("insufficient_stock", { itemIds: ["i1"], available: { i1: 2, i2: "x" } }));
  assert.equal(short.message, "Some products have fewer in the store now. Each line shows the most you can send.");
  assert.deepEqual(short.available, { i1: 2 });
  assert.deepEqual(short.itemIds, ["i1"]);
  assert.equal(transferFailure(err("item_archived", { itemIds: ["i1"] })).message, "A product in this transfer is archived. Unarchive it or take it out.");
  assert.equal(transferFailure(err("line_already_resolved", { resolution: "written_off" })).message, "Those items were already written off.");
  assert.equal(transferFailure(err("transfer_not_found")).message, "That transfer is not available.");
  assert.equal(transferFailure(err("received_too_many")).message, "You can't receive more than was sent.");
  assert.equal(transferFailure(err("store_not_allowed")).message, "You can only work in your own store.");
  // An unknown reason keeps the server's words.
  assert.equal(transferFailure({ message: "Something new.", details: { reason: "brand_new" } }).message, "Something new.");
});

test("a store or product held by open transfers names their codes", async () => {
  const { inventoryCallableFailure } = await import("./inventory.ts");
  assert.equal(
    inventoryCallableFailure({ details: { reason: "store_has_transfers", transferCodes: ["TR-1", "TR-2"] } }).message,
    "A transfer in transit or waiting for review comes from or goes to this store. Settle it first. (TR-1, TR-2)",
  );
  assert.equal(
    inventoryCallableFailure({ details: { reason: "item_in_transfer" } }).message,
    "This product is in a transfer that is in transit or waiting for review. Settle it first.",
  );
});

test("a transfer alert's focus", () => {
  assert.deepEqual(transferFocusFrom(" t1 ", 5), { transferId: "t1", key: 5 });
  assert.equal(transferFocusFrom("", 5), null);
});

// The viewer type is the shared one: the panel hands its InventoryViewer plus the uid.
const _typeCheck: InventoryViewer = owner;
void _typeCheck;

/**
 * Store transfers (v5), console side - stock moved between the stores of one
 * business in two steps: the source store sends (the pieces leave its count
 * and are "in transit", sellable nowhere), the destination confirms what
 * arrived, and only what did not arrive goes to the owner, who returns it to
 * the source store or writes it off. The contract is docs/INVENTORY.md,
 * "Store transfers (v5)"; the callables are the authority
 * (`saveInventoryTransferDraft`, `sendInventoryTransfer`,
 * `cancelInventoryTransfer`, `receiveInventoryTransfer`,
 * `resolveInventoryTransferLine`).
 *
 * This is the pure half: reading a transfer document tolerantly, the lists
 * and their counts, the tiles, who may do what (mirroring the server's
 * rules, so a button is only offered when the server would accept it), the
 * requests, and the sentences with numbers or names in them, built per
 * language. Nothing here imports Firebase or React:
 * `inventory-transfers.test.ts` runs it in node.
 */

import { moneyText } from "./invoice-ledger.ts";
import {
  INVENTORY_MESSAGES,
  inventoryCallableFailure,
  itemCountText,
  itemStockView,
  newClientRequestId,
  productCountText,
  productDisplayName,
  type InventoryItem,
  type InventoryRefusal,
  type InventoryStore,
  type InventoryViewer,
  type StockIndex,
} from "./inventory.ts";
import { periodFor, startOfDayMs } from "./inventory-history.ts";
import type { BusinessCollectionOptions } from "./paged-query.ts";

type Row = Record<string, unknown>;
type Lang = "en" | "fr";

const DAY_MS = 86_400_000;
/** A transfer in transit this many days or more is late: its card says how long. */
export const TRANSIT_LATE_DAYS = 2;
/** The most products one transfer carries (the server's cap). */
export const MAX_TRANSFER_LINES = 100;
/** The most pieces of one product on a line (the server's cap). */
export const MAX_TRANSFER_QUANTITY = 1_000_000;
/** The receive note and the write-off note (the server's cap). */
export const MAX_TRANSFER_NOTE = 300;

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function text(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

function count(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function countOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function millis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime() || 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

// ---------------------------------------------------------------------------
// A transfer, as the screens read it.
// ---------------------------------------------------------------------------

export type TransferStatus = "draft" | "in_transit" | "received" | "received_with_differences" | "cancelled";
export type TransferStage = "draft" | "in_transit" | "review" | "done";
export type TransferResolution = "" | "returned" | "written_off";
export type WriteOffReason = "lost" | "damaged" | "stolen" | "other";

export const WRITE_OFF_REASONS: readonly WriteOffReason[] = ["lost", "damaged", "stolen", "other"];

/** The reasons as the screens offer them (the dictionary carries the French). */
export const WRITE_OFF_REASON_LABELS: Record<WriteOffReason, string> = {
  lost: "Lost in transit",
  damaged: "Damaged",
  stolen: "Stolen",
  other: "Other",
};

const WRITE_OFF_REASON_FR: Record<WriteOffReason, string> = {
  lost: "Perdu en route",
  damaged: "Endommagé",
  stolen: "Volé",
  other: "Autre",
};

const STATUSES: readonly TransferStatus[] = ["draft", "in_transit", "received", "received_with_differences", "cancelled"];
const STAGES: readonly TransferStage[] = ["draft", "in_transit", "review", "done"];

export type TransferLine = {
  itemId: string;
  name: string;
  brand: string;
  code: string;
  costCents: number | null;
  quantitySent: number;
  /** null until the destination confirms. */
  quantityReceived: number | null;
  missing: number;
  resolution: TransferResolution;
  writeOffReason: WriteOffReason | "";
  resolutionNote: string;
  resolvedByStaffId: string;
  resolvedByName: string;
  resolvedAtMs: number;
};

export type TransferEventKind = "draft_created" | "sent" | "cancelled" | "draft_discarded" | "received" | "returned" | "written_off";

export type TransferEvent = {
  event: string;
  byStaffId: string;
  byName: string;
  atMs: number;
  itemsCount: number;
  receivedCount: number;
  missingCount: number;
  note: string;
  itemId: string;
  itemName: string;
  quantity: number;
  reason: string;
};

export type InventoryTransfer = {
  id: string;
  businessId: string;
  clientRequestId: string;
  code: string;
  status: TransferStatus;
  stage: TransferStage;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  lines: TransferLine[];
  productsCount: number;
  itemsCount: number;
  receivedCount: number | null;
  missingCount: number;
  openMissingCount: number;
  returnedCount: number;
  writtenOffCount: number;
  valueCents: number;
  openMissingValueCents: number;
  linesWithoutCost: number;
  createdByStaffId: string;
  createdByName: string;
  createdAtMs: number;
  updatedAtMs: number;
  sentByStaffId: string;
  sentByName: string;
  sentAtMs: number;
  receivedByStaffId: string;
  receivedByName: string;
  receivedAtMs: number;
  receiveNote: string;
  cancelledByStaffId: string;
  cancelledByName: string;
  cancelledAtMs: number;
  settledAtMs: number;
  /** The track record, oldest first. */
  timeline: TransferEvent[];
};

function transferLineFromRow(raw: unknown): TransferLine {
  const r = asRow(raw);
  const cost = r.costCents === null || r.costCents === undefined || r.costCents === "" ? null : countOrNull(r.costCents);
  const resolution = text(r.resolution, 20);
  const reason = text(r.writeOffReason, 20);
  const quantitySent = count(r.quantitySent ?? r.quantity);
  const quantityReceived = countOrNull(r.quantityReceived);
  const missing = r.missing === undefined && quantityReceived !== null ? Math.max(0, quantitySent - quantityReceived) : count(r.missing);
  return {
    itemId: text(r.itemId),
    name: text(r.name, 120),
    brand: text(r.brand, 60),
    code: text(r.code, 40),
    costCents: cost,
    quantitySent,
    quantityReceived,
    missing,
    resolution: resolution === "returned" || resolution === "written_off" ? resolution : "",
    writeOffReason: (WRITE_OFF_REASONS as readonly string[]).includes(reason) ? (reason as WriteOffReason) : "",
    resolutionNote: text(r.resolutionNote, MAX_TRANSFER_NOTE),
    resolvedByStaffId: text(r.resolvedByStaffId),
    resolvedByName: text(r.resolvedByName, 120),
    resolvedAtMs: millis(r.resolvedAt),
  };
}

function transferEventFromRow(raw: unknown): TransferEvent {
  const r = asRow(raw);
  return {
    event: text(r.event, 40),
    byStaffId: text(r.byStaffId),
    byName: text(r.byName, 120),
    atMs: millis(r.at),
    itemsCount: count(r.itemsCount),
    receivedCount: count(r.receivedCount),
    missingCount: count(r.missingCount),
    note: text(r.note, MAX_TRANSFER_NOTE),
    itemId: text(r.itemId),
    itemName: text(r.itemName, 200),
    quantity: count(r.quantity),
    reason: text(r.reason, 20),
  };
}

/** A transfer document, read tolerantly: missing counts are worked out from the lines, a missing stage from the status. */
export function inventoryTransferFromRow(row: unknown): InventoryTransfer {
  const r = asRow(row);
  const statusRaw = text(r.status, 40) as TransferStatus;
  const status: TransferStatus = STATUSES.includes(statusRaw) ? statusRaw : "draft";
  const lines = (Array.isArray(r.lines) ? r.lines : []).map(transferLineFromRow).filter((line) => line.itemId);
  const sum = (pick: (line: TransferLine) => number) => lines.reduce((total, line) => total + pick(line), 0);
  const openMissingFromLines = sum((line) => (line.resolution ? 0 : line.missing));
  const openMissingCount = r.openMissingCount === undefined ? openMissingFromLines : count(r.openMissingCount);
  const stageRaw = text(r.stage, 20) as TransferStage;
  const stage: TransferStage = STAGES.includes(stageRaw)
    ? stageRaw
    : status === "draft" ? "draft"
    : status === "in_transit" ? "in_transit"
    : status === "received_with_differences" && openMissingCount > 0 ? "review"
    : "done";
  const received = lines.some((line) => line.quantityReceived !== null) ? sum((line) => line.quantityReceived ?? 0) : null;
  return {
    id: text(r.id),
    businessId: text(r.businessId),
    clientRequestId: text(r.clientRequestId, 100),
    code: text(r.code, 40),
    status,
    stage,
    fromStoreId: text(r.fromStoreId),
    fromStoreName: text(r.fromStoreName, 80),
    toStoreId: text(r.toStoreId),
    toStoreName: text(r.toStoreName, 80),
    lines,
    productsCount: r.productsCount === undefined ? lines.length : count(r.productsCount),
    itemsCount: r.itemsCount === undefined ? sum((line) => line.quantitySent) : count(r.itemsCount),
    receivedCount: r.receivedCount === undefined ? received : countOrNull(r.receivedCount),
    missingCount: r.missingCount === undefined ? sum((line) => line.missing) : count(r.missingCount),
    openMissingCount,
    returnedCount: count(r.returnedCount),
    writtenOffCount: count(r.writtenOffCount),
    valueCents: r.valueCents === undefined
      ? sum((line) => (line.costCents === null ? 0 : line.costCents * line.quantitySent))
      : count(r.valueCents),
    openMissingValueCents: r.openMissingValueCents === undefined
      ? sum((line) => (line.costCents === null || line.resolution ? 0 : line.costCents * line.missing))
      : count(r.openMissingValueCents),
    linesWithoutCost: r.linesWithoutCost === undefined ? lines.filter((line) => line.costCents === null).length : count(r.linesWithoutCost),
    createdByStaffId: text(r.createdByStaffId),
    createdByName: text(r.createdByName, 120),
    createdAtMs: millis(r.createdAt),
    updatedAtMs: millis(r.updatedAt),
    sentByStaffId: text(r.sentByStaffId),
    sentByName: text(r.sentByName, 120),
    sentAtMs: millis(r.sentAt),
    receivedByStaffId: text(r.receivedByStaffId),
    receivedByName: text(r.receivedByName, 120),
    receivedAtMs: millis(r.receivedAt),
    receiveNote: text(r.receiveNote, MAX_TRANSFER_NOTE),
    cancelledByStaffId: text(r.cancelledByStaffId),
    cancelledByName: text(r.cancelledByName, 120),
    cancelledAtMs: millis(r.cancelledAt),
    settledAtMs: millis(r.settledAt),
    timeline: (Array.isArray(r.timeline) ? r.timeline : []).map(transferEventFromRow).filter((event) => event.event)
      .sort((a, b) => a.atMs - b.atMs),
  };
}

/** The pieces of a line still waiting for the owner's decision. */
export function lineOpenMissing(line: TransferLine): number {
  return line.resolution ? 0 : line.missing;
}

// ---------------------------------------------------------------------------
// Who may do what. Mirrors the server (docs/INVENTORY.md "Callables").
// ---------------------------------------------------------------------------

/** The signed-in person, as the transfer rules read them. */
export type TransferViewer = InventoryViewer & { uid: string };

/** The owner and all-stores staff: every store, and the owner's review. */
export function seesAllStores(viewer: Pick<InventoryViewer, "isOwner" | "allStores">): boolean {
  return viewer.isOwner || viewer.allStores;
}

/** "May send from a store": the owner, all-stores staff, or staff whose home store it is. */
export function maySendFrom(viewer: InventoryViewer, storeId: string): boolean {
  if (!storeId) return false;
  return seesAllStores(viewer) || viewer.homeStoreId === storeId;
}

/** The stores a new transfer may leave from: every active store for whoever sees all, else the home store. */
export function sendableStores(viewer: InventoryViewer, stores: readonly InventoryStore[]): InventoryStore[] {
  return stores.filter((store) => !store.archived && maySendFrom(viewer, store.id));
}

/** Cancel a transfer in transit: the sender, the owner or all-stores staff. */
export function canCancelTransfer(transfer: InventoryTransfer, viewer: TransferViewer): boolean {
  if (transfer.status !== "in_transit") return false;
  return seesAllStores(viewer) || (Boolean(viewer.uid) && transfer.sentByStaffId === viewer.uid);
}

/** Discard a draft: its creator, anyone who may send from its source store, the owner and all-stores staff. */
export function canDiscardDraft(transfer: InventoryTransfer, viewer: TransferViewer): boolean {
  if (transfer.status !== "draft") return false;
  return (Boolean(viewer.uid) && transfer.createdByStaffId === viewer.uid) || maySendFrom(viewer, transfer.fromStoreId);
}

/** Continue (and send) a draft: whoever may send from its source store. */
export function canContinueDraft(transfer: InventoryTransfer, viewer: TransferViewer): boolean {
  return transfer.status === "draft" && maySendFrom(viewer, transfer.fromStoreId);
}

/** Confirm what arrived: the destination's staff, the owner or all-stores staff. */
export function canReceiveTransfer(transfer: InventoryTransfer, viewer: InventoryViewer): boolean {
  if (transfer.status !== "in_transit") return false;
  return seesAllStores(viewer) || (Boolean(viewer.homeStoreId) && viewer.homeStoreId === transfer.toStoreId);
}

/** Decide the missing pieces: the owner and all-stores staff, while the transfer is in review. */
export function canResolveTransfer(transfer: InventoryTransfer, viewer: InventoryViewer): boolean {
  return transfer.stage === "review" && seesAllStores(viewer);
}

/** One missing line, not yet decided. */
export function canResolveLine(transfer: InventoryTransfer, line: TransferLine, viewer: InventoryViewer): boolean {
  return canResolveTransfer(transfer, viewer) && lineOpenMissing(line) > 0;
}

/**
 * Whether a transfer may be shown to this viewer: the same reach as the
 * rules, plus the contract's "drafts are shown only to whoever may send from
 * their source store". Another business's transfer never; staff tied to one
 * store, only transfers from or to that store.
 */
export function transferVisibleToViewer(row: unknown, businessId: string, viewer: InventoryViewer): boolean {
  const r = asRow(row);
  if (!businessId || text(r.businessId) !== businessId) return false;
  const transfer = inventoryTransferFromRow(row);
  if (transfer.status === "draft" && !maySendFrom(viewer, transfer.fromStoreId)) return false;
  if (seesAllStores(viewer)) return true;
  const home = viewer.homeStoreId;
  return Boolean(home) && (transfer.fromStoreId === home || transfer.toStoreId === home);
}

/**
 * The transfers the screens list: every read merged (the same document can
 * sit in the open read and the recent one), the live single read included,
 * and only what the viewer may see. Newest first.
 */
export function mergeTransferRows(lists: readonly (readonly unknown[])[], businessId: string, viewer: InventoryViewer): InventoryTransfer[] {
  const byId = new Map<string, InventoryTransfer>();
  for (const list of lists) {
    for (const row of Array.isArray(list) ? list : []) {
      const transfer = inventoryTransferFromRow(row);
      if (!transfer.id || !transferVisibleToViewer(row, businessId, viewer)) continue;
      const known = byId.get(transfer.id);
      // The later write wins when two reads disagree for an instant.
      if (!known || transfer.updatedAtMs >= known.updatedAtMs) byId.set(transfer.id, transfer);
    }
  }
  return [...byId.values()].sort((a, b) => activityMs(b) - activityMs(a) || a.id.localeCompare(b.id));
}

function activityMs(transfer: InventoryTransfer): number {
  return Math.max(transfer.updatedAtMs, transfer.createdAtMs, transfer.sentAtMs, transfer.receivedAtMs, transfer.cancelledAtMs);
}

// ---------------------------------------------------------------------------
// The lists: the tabs both clients share, and the console's filter chips.
// ---------------------------------------------------------------------------

export type TransferTab = "outgoing" | "incoming" | "in_transit" | "review";
export const TRANSFER_TABS: readonly TransferTab[] = ["outgoing", "incoming", "in_transit", "review"];

function touches(transfer: InventoryTransfer, storeId: string): boolean {
  return transfer.fromStoreId === storeId || transfer.toStoreId === storeId;
}

/** Drafts first, then in transit (longest on the road first), then review, then the rest newest first. */
function stageRank(transfer: InventoryTransfer, order: readonly TransferStage[]): number {
  const at = order.indexOf(transfer.stage);
  return at < 0 ? order.length : at;
}

function sortBy(order: readonly TransferStage[]) {
  return (a: InventoryTransfer, b: InventoryTransfer) => {
    const rank = stageRank(a, order) - stageRank(b, order);
    if (rank) return rank;
    if (a.stage === "in_transit" && b.stage === "in_transit") return a.sentAtMs - b.sentAtMs || a.id.localeCompare(b.id);
    return activityMs(b) - activityMs(a) || a.id.localeCompare(b.id);
  };
}

/**
 * The four tabs, per the contract's "Screens" rules. `storeId` is the one
 * store being looked at (a store's staff, or an all-stores viewer who picked
 * one); "" is "All stores". The list is what the viewer may see already.
 */
export function transferTabs(transfers: readonly InventoryTransfer[], storeId: string): Record<TransferTab, InventoryTransfer[]> {
  if (!storeId) {
    const inTransit = transfers.filter((t) => t.stage === "in_transit").sort(sortBy(["in_transit"]));
    return {
      outgoing: [...transfers].sort(sortBy(["draft", "in_transit", "review"])),
      incoming: inTransit,
      in_transit: [...inTransit],
      review: transfers.filter((t) => t.stage === "review").sort(sortBy(["review"])),
    };
  }
  return {
    outgoing: transfers.filter((t) => t.fromStoreId === storeId).sort(sortBy(["draft", "in_transit"])),
    incoming: transfers.filter((t) => t.toStoreId === storeId && t.stage !== "draft").sort(sortBy(["in_transit", "review"])),
    in_transit: transfers.filter((t) => touches(t, storeId) && t.stage === "in_transit").sort(sortBy(["in_transit"])),
    review: transfers.filter((t) => touches(t, storeId) && t.stage === "review").sort(sortBy(["review"])),
  };
}

export function transferTabCounts(transfers: readonly InventoryTransfer[], storeId: string): Record<TransferTab, number> {
  const tabs = transferTabs(transfers, storeId);
  return { outgoing: tabs.outgoing.length, incoming: tabs.incoming.length, in_transit: tabs.in_transit.length, review: tabs.review.length };
}

export type TransferChip = "all" | "in_transit" | "review" | "drafts";
export const TRANSFER_CHIPS: readonly TransferChip[] = ["all", "in_transit", "review", "drafts"];
export const TRANSFER_CHIP_LABELS: Record<TransferChip, string> = {
  all: "All transfers",
  in_transit: "In transit",
  review: "Needs review",
  drafts: "Drafts",
};

/** The console's list: one chip, narrowed to one store ("" = all). What needs a decision comes first. */
export function transferChipList(transfers: readonly InventoryTransfer[], chip: TransferChip, storeId: string): InventoryTransfer[] {
  const inScope = storeId ? transfers.filter((t) => touches(t, storeId)) : [...transfers];
  const order: TransferStage[] = ["review", "in_transit", "draft"];
  if (chip === "in_transit") return inScope.filter((t) => t.stage === "in_transit").sort(sortBy(order));
  if (chip === "review") return inScope.filter((t) => t.stage === "review").sort(sortBy(order));
  if (chip === "drafts") return inScope.filter((t) => t.stage === "draft").sort(sortBy(order));
  return inScope.sort(sortBy(order));
}

export function transferChipCounts(transfers: readonly InventoryTransfer[], storeId: string): Record<TransferChip, number> {
  const inScope = storeId ? transfers.filter((t) => touches(t, storeId)) : transfers;
  const counts: Record<TransferChip, number> = { all: inScope.length, in_transit: 0, review: 0, drafts: 0 };
  for (const t of inScope) {
    if (t.stage === "in_transit") counts.in_transit += 1;
    else if (t.stage === "review") counts.review += 1;
    else if (t.stage === "draft") counts.drafts += 1;
  }
  return counts;
}

/**
 * The number on the Inventory "Transfers" tab: what is waiting for this
 * person. For the owner and all-stores staff, the transfers in review; for a
 * store's staff, what is on its way to their store.
 */
export function transferAttentionCount(transfers: readonly InventoryTransfer[], viewer: InventoryViewer): number {
  if (seesAllStores(viewer)) return transfers.filter((t) => t.stage === "review").length;
  if (!viewer.homeStoreId) return 0;
  return transfers.filter((t) => t.stage === "in_transit" && t.toStoreId === viewer.homeStoreId).length;
}

// ---------------------------------------------------------------------------
// The reads (docs/INVENTORY.md "Rules and indexes"). Shared with the index
// contract test, so the shapes it checks are the shapes the console asks.
// ---------------------------------------------------------------------------

export const OPEN_TRANSFER_STAGES: readonly TransferStage[] = ["draft", "in_transit", "review"];
export type TransferRead = "open" | "recent" | "month";
/** One side of a store-scoped read: a store's staff read "from" and "to" separately (the rules refuse an unscoped list). */
export type TransferSide = "" | "from" | "to";
export const RECENT_TRANSFERS_LIMIT = 100;
export const RECENT_TRANSFERS_SCOPED_LIMIT = 50;

/** The useBusinessCollection options of one read, on one side ("" = unscoped, for whoever sees every store). */
export function transferReadOptions(read: TransferRead, side: TransferSide, storeId: string, monthStartMs = 0): BusinessCollectionOptions {
  const store = text(storeId);
  const scoped: [string, "==", string][] = side && store ? [[side === "from" ? "fromStoreId" : "toStoreId", "==", store]] : [];
  if (read === "open") {
    return { pageSize: null, where: [...scoped, ["stage", "in", [...OPEN_TRANSFER_STAGES]]], sort: "query" };
  }
  if (read === "recent") {
    return { pageSize: scoped.length ? RECENT_TRANSFERS_SCOPED_LIMIT : RECENT_TRANSFERS_LIMIT, where: scoped, sort: "query" };
  }
  return {
    pageSize: null,
    where: [...scoped, ["receivedAt", ">=", new Date(Math.max(0, monthStartMs))]],
    orderBy: "receivedAt",
    direction: "desc",
    sort: "query",
  };
}

/** The first instant of the month holding `todayKey`, in the business's zone. */
export function monthStartMs(todayKey: string, zone: string): number {
  return startOfDayMs(periodFor("month", todayKey).startKey, zone);
}

// ---------------------------------------------------------------------------
// The tiles.
// ---------------------------------------------------------------------------

export type TransferTiles = {
  inTransit: { transfers: number; items: number; valueCents: number; linesWithoutCost: number };
  disputed: { transfers: number; items: number; valueCents: number };
  received: { transfers: number; items: number; withDifferences: number };
};

/**
 * In transit and Disputed are what is open now (the open read); Received
 * this month counts what was received since `sinceMs` (the month read).
 * `storeId` narrows all three to transfers from or to that store.
 */
export function transferTiles(open: readonly InventoryTransfer[], month: readonly InventoryTransfer[], storeId: string, sinceMs: number): TransferTiles {
  const inScope = (t: InventoryTransfer) => !storeId || touches(t, storeId);
  const tiles: TransferTiles = {
    inTransit: { transfers: 0, items: 0, valueCents: 0, linesWithoutCost: 0 },
    disputed: { transfers: 0, items: 0, valueCents: 0 },
    received: { transfers: 0, items: 0, withDifferences: 0 },
  };
  for (const t of open) {
    if (!inScope(t)) continue;
    if (t.stage === "in_transit") {
      tiles.inTransit.transfers += 1;
      tiles.inTransit.items += t.itemsCount;
      tiles.inTransit.valueCents += t.valueCents;
      tiles.inTransit.linesWithoutCost += t.linesWithoutCost;
    } else if (t.stage === "review") {
      tiles.disputed.transfers += 1;
      tiles.disputed.items += t.openMissingCount;
      tiles.disputed.valueCents += t.openMissingValueCents;
    }
  }
  const seen = new Set<string>();
  for (const t of month) {
    if (!inScope(t) || seen.has(t.id) || !t.receivedAtMs || t.receivedAtMs < sinceMs) continue;
    if (t.status !== "received" && t.status !== "received_with_differences") continue;
    seen.add(t.id);
    tiles.received.transfers += 1;
    tiles.received.items += t.receivedCount ?? 0;
    if (t.status === "received_with_differences") tiles.received.withDifferences += 1;
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// The summary card's line (getInventorySummary's `transfers`).
// ---------------------------------------------------------------------------

export type TransferTotals = {
  inTransitCount: number;
  inTransitItems: number;
  inTransitValueCents: number;
  disputedCount: number;
  disputedItems: number;
  disputedValueCents: number;
  receivedCount: number;
  receivedItems: number;
  receivedWithDifferences: number;
  linesWithoutCost: number;
};

/** The summary's `transfers` block; null from a server without it (show nothing). */
export function readTransferTotals(summary: unknown): TransferTotals | null {
  const raw = asRow(summary).transfers;
  if (!raw || typeof raw !== "object") return null;
  const r = asRow(raw);
  return {
    inTransitCount: count(r.inTransitCount),
    inTransitItems: count(r.inTransitItems),
    inTransitValueCents: count(r.inTransitValueCents),
    disputedCount: count(r.disputedCount),
    disputedItems: count(r.disputedItems),
    disputedValueCents: count(r.disputedValueCents),
    receivedCount: count(r.receivedCount),
    receivedItems: count(r.receivedItems),
    receivedWithDifferences: count(r.receivedWithDifferences),
    linesWithoutCost: count(r.linesWithoutCost),
  };
}

/**
 * "In transit $120.00 · Disputed $40.00" / "En route 120,00 $ · Litige 40,00 $",
 * or "" when nothing is in transit or disputed. A part with no known cost
 * says its pieces instead of "$0.00".
 */
export function transferTotalsText(totals: TransferTotals | null, lang: Lang = "en"): string {
  if (!totals) return "";
  const parts: string[] = [];
  const amount = (cents: number, items: number) => (cents > 0 ? moneyText(cents, lang) : itemCountText(items, lang));
  if (totals.inTransitCount > 0 || totals.inTransitItems > 0) {
    parts.push(`${lang === "fr" ? "En route" : "In transit"} ${amount(totals.inTransitValueCents, totals.inTransitItems)}`);
  }
  if (totals.disputedCount > 0 || totals.disputedItems > 0) {
    parts.push(`${lang === "fr" ? "Litige" : "Disputed"} ${amount(totals.disputedValueCents, totals.disputedItems)}`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Dates, per language, in the business's zone (US month-first in English).
// ---------------------------------------------------------------------------

function tidy(value: string): string {
  // Newer ICU puts a narrow no-break space before AM/PM.
  return value.replace(/[  ]/g, " ");
}

/** "Oct 18, 2:31 PM" / "18 oct., 14:31"; "" for no time. */
export function transferTimeText(ms: number, lang: Lang = "en", zone = "America/New_York"): string {
  if (!ms) return "";
  return tidy(new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", {
    timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(ms)));
}

/** "Oct 15" / "15 oct."; "" for no time. */
export function transferDayText(ms: number, lang: Lang = "en", zone = "America/New_York"): string {
  if (!ms) return "";
  return tidy(new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", { timeZone: zone, month: "short", day: "numeric" }).format(new Date(ms)));
}

/** Whole days since it was sent. */
export function transitDays(transfer: InventoryTransfer, nowMs: number): number {
  if (transfer.status !== "in_transit" || !transfer.sentAtMs) return 0;
  return Math.max(0, Math.floor((nowMs - transfer.sentAtMs) / DAY_MS));
}

// ---------------------------------------------------------------------------
// Sentences with numbers or names in them, per language.
// ---------------------------------------------------------------------------

function someone(name: string, lang: Lang): string {
  return name || (lang === "fr" ? "Quelqu’un" : "Someone");
}

/** "14 items · 3 products" / "14 articles · 3 produits". */
export function transferCountsText(transfer: Pick<InventoryTransfer, "itemsCount" | "productsCount">, lang: Lang = "en"): string {
  return `${itemCountText(transfer.itemsCount, lang)} · ${productCountText(transfer.productsCount, lang)}`;
}

/** "3 transfers" / "3 transferts". */
export function transfersCountText(n: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${n} ${n === 1 ? "transfert" : "transferts"}`;
  return `${n} ${n === 1 ? "transfer" : "transfers"}`;
}

/** "2 with differences" / "2 avec écarts". */
export function withDifferencesText(n: number, lang: Lang = "en"): string {
  return lang === "fr" ? `${n} avec écarts` : `${n} with differences`;
}

/** "2 missing" / "2 manquants". */
export function missingText(n: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${n} ${n === 1 ? "manquant" : "manquants"}`;
  return `${n} missing`;
}

export type TransferStatusView = {
  label: string;
  /** "ok" | "warn" | "navy" | "muted", or "danger" (red). */
  tone: "ok" | "warn" | "navy" | "muted" | "danger";
  /** The line under the card's counts ("" for none). */
  detail: string;
};

/**
 * A card's status, per the contract: Draft ("not sent · nothing reserved
 * yet"), In transit ("In transit 3 days" from 2 days, highlighted), Needs
 * review (red, for whoever decides; the stores read "Received · 2 missing"),
 * Received ("10 of 10 received · Oct 15 by Aminata"), Settled, Cancelled.
 */
export function transferStatusView(
  transfer: InventoryTransfer,
  { nowMs, lang = "en", canResolve = false, zone = "America/New_York", receivedBy = "" }: {
    nowMs: number; lang?: Lang; canResolve?: boolean; zone?: string; receivedBy?: string;
  },
): TransferStatusView {
  const fr = lang === "fr";
  const receivedLine = () => {
    const who = receivedBy || transfer.receivedByName;
    const of = fr
      ? `${transfer.receivedCount ?? 0} sur ${transfer.itemsCount} reçus`
      : `${transfer.receivedCount ?? 0} of ${transfer.itemsCount} received`;
    const day = transferDayText(transfer.receivedAtMs, lang, zone);
    const when = day ? ` · ${day}` : "";
    const by = who ? (fr ? ` par ${who}` : ` by ${who}`) : "";
    return `${of}${when}${by}`;
  };
  switch (transfer.status) {
    case "draft":
      return { label: fr ? "Brouillon" : "Draft", tone: "muted", detail: fr ? "pas envoyé · rien n’est réservé" : "not sent · nothing reserved yet" };
    case "in_transit": {
      const days = transitDays(transfer, nowMs);
      if (days >= TRANSIT_LATE_DAYS) {
        return { label: fr ? `En route depuis ${days} jours` : `In transit ${days} days`, tone: "warn", detail: "" };
      }
      return { label: fr ? "En route" : "In transit", tone: "navy", detail: "" };
    }
    case "received":
      return { label: fr ? "Reçu" : "Received", tone: "ok", detail: receivedLine() };
    case "received_with_differences":
      if (transfer.stage === "review") {
        return canResolve
          ? { label: fr ? "À vérifier" : "Needs review", tone: "danger", detail: receivedLine() }
          : { label: fr ? `Reçu · ${missingText(transfer.missingCount, lang)}` : `Received · ${missingText(transfer.missingCount, lang)}`, tone: "warn", detail: receivedLine() };
      }
      return { label: fr ? "Réglé" : "Settled", tone: "ok", detail: receivedLine() };
    case "cancelled":
    default:
      return { label: fr ? "Annulé" : "Cancelled", tone: "muted", detail: "" };
  }
}

/** The store's current name when the list has it, else the name saved on the transfer. */
export function transferStoreName(storeId: string, snapshot: string, names: ReadonlyMap<string, string>): string {
  return names.get(storeId) || snapshot || storeId;
}

/**
 * A line's Result: "Complete", "2 missing · disputed", "2 returned to Bronx
 * store", "2 written off · Lost in transit"; "" before it is received.
 */
export function lineResultText(line: TransferLine, fromStoreName: string, lang: Lang = "en"): string {
  const fr = lang === "fr";
  if (line.quantityReceived === null) return "";
  if (line.missing <= 0) return fr ? "Complet" : "Complete";
  if (line.resolution === "returned") return fr ? `${line.missing} renvoyés à ${fromStoreName}` : `${line.missing} returned to ${fromStoreName}`;
  if (line.resolution === "written_off") {
    const reason = line.writeOffReason ? (fr ? WRITE_OFF_REASON_FR[line.writeOffReason] : WRITE_OFF_REASON_LABELS[line.writeOffReason]) : "";
    const head = fr ? `${line.missing} passés en perte` : `${line.missing} written off`;
    return reason ? `${head} · ${reason}` : head;
  }
  return fr ? `${missingText(line.missing, lang)} · en litige` : `${missingText(line.missing, lang)} · disputed`;
}

/** A write-off reason in the reader's language. */
export function writeOffReasonText(reason: string, lang: Lang = "en"): string {
  if (!(WRITE_OFF_REASONS as readonly string[]).includes(reason)) return "";
  return lang === "fr" ? WRITE_OFF_REASON_FR[reason as WriteOffReason] : WRITE_OFF_REASON_LABELS[reason as WriteOffReason];
}

export type TrackRecordLine = { key: string; at: string; text: string; note: string };

/** The track record (timeline), oldest first, with who and when; names are the ones saved on each event. */
export function trackRecordLines(
  transfer: InventoryTransfer,
  { lang = "en", zone = "America/New_York", storeName = (_id: string, snapshot: string) => snapshot }: {
    lang?: Lang; zone?: string; storeName?: (storeId: string, snapshot: string) => string;
  } = {},
): TrackRecordLine[] {
  const fr = lang === "fr";
  const from = storeName(transfer.fromStoreId, transfer.fromStoreName);
  const lines: TrackRecordLine[] = [];
  transfer.timeline.forEach((event, index) => {
    const who = someone(event.byName, lang);
    const items = itemCountText(event.itemsCount || transfer.itemsCount, lang);
    const piece = `${event.quantity} × ${event.itemName}`;
    let sentence = "";
    switch (event.event) {
      case "draft_created":
        sentence = fr ? `Brouillon créé par ${who}` : `Draft created by ${who}`;
        break;
      case "sent":
        sentence = fr ? `Envoyé par ${who} · ${items}` : `Sent by ${who} · ${items}`;
        break;
      case "cancelled":
        sentence = fr ? `Annulé par ${who} · ${items} de retour à ${from}` : `Cancelled by ${who} · ${items} back in ${from}`;
        break;
      case "draft_discarded":
        sentence = fr ? `Brouillon supprimé par ${who}` : `Draft discarded by ${who}`;
        break;
      case "received":
        sentence = event.missingCount > 0
          ? (fr ? `${who} a confirmé ${event.receivedCount} reçus, ${missingText(event.missingCount, lang)}` : `${who} confirmed ${event.receivedCount} received, ${event.missingCount} missing`)
          : (fr ? `${who} a confirmé la réception des ${itemCountText(event.receivedCount, lang)}` : `${who} confirmed all ${itemCountText(event.receivedCount, lang)} received`);
        break;
      case "returned":
        sentence = fr ? `${who} a renvoyé ${piece} à ${from}` : `${who} returned ${piece} to ${from}`;
        break;
      case "written_off": {
        const reason = writeOffReasonText(event.reason, lang);
        sentence = fr ? `${who} a passé en perte ${piece}` : `${who} wrote off ${piece}`;
        if (reason) sentence += ` · ${reason}`;
        break;
      }
      default:
        return;
    }
    lines.push({ key: `${index}-${event.event}`, at: transferTimeText(event.atMs, lang, zone), text: sentence, note: event.note });
  });
  return lines;
}

/** "Sent to Harlem store" / "Envoyé à Harlem store". */
export function sentToText(storeName: string, lang: Lang = "en"): string {
  return lang === "fr" ? `Envoyé à ${storeName}` : `Sent to ${storeName}`;
}

/** The sent screen's two sentences, with the counts and the destination's name. */
export function sentNoticeText(items: number, toStore: string, lang: Lang = "en"): { lead: string; hint: string } {
  if (lang === "fr") {
    return {
      lead: `${itemCountText(items, lang)} ${items === 1 ? "est en route" : "sont en route"}. L’équipe de ${toStore} a reçu une notification et confirmera à l’arrivée.`,
      hint: `Tant que ${toStore} n’a pas confirmé, ces articles ne peuvent être vendus dans aucun des deux magasins. Une erreur ? Vous pouvez annuler jusqu’à la confirmation de ${toStore}.`,
    };
  }
  return {
    lead: `${itemCountText(items, lang)} ${items === 1 ? "is" : "are"} on ${items === 1 ? "its" : "their"} way. ${toStore}'s team got a notification and will confirm when they arrive.`,
    hint: `Until ${toStore} confirms, these items can't be sold in either store. Made a mistake? You can cancel until ${toStore} confirms.`,
  };
}

/** "Send 14 items" / "Envoyer 14 articles". */
export function sendButtonText(items: number, lang: Lang = "en"): string {
  return lang === "fr" ? `Envoyer ${itemCountText(items, lang)}` : `Send ${itemCountText(items, lang)}`;
}

/** "8 in Bronx store" / "8 dans Bronx store": a line's source count. */
export function inStoreText(n: number, storeName: string, lang: Lang = "en"): string {
  return lang === "fr" ? `${n} dans ${storeName}` : `${n} in ${storeName}`;
}

/**
 * The receive note's placeholder. A <textarea> is never walked by the French
 * DOM translator (it would rewrite what was typed), so its placeholder is
 * chosen here by language.
 */
export function receiveNotePlaceholder(lang: Lang = "en"): string {
  return lang === "fr" ? "ex. Le carton est arrivé ouvert" : "e.g. The box arrived opened";
}

/** "2 items didn't arrive" / "2 articles ne sont pas arrivés". */
export function didNotArriveText(missing: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${itemCountText(missing, lang)} ${missing === 1 ? "n’est pas arrivé" : "ne sont pas arrivés"}`;
  return `${itemCountText(missing, lang)} didn't arrive`;
}

/** "12 of 14 arrived. The owner will be told about the missing ones." */
export function arrivedOfText(received: number, sent: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${received} sur ${sent} ${received === 1 ? "arrivé" : "arrivés"}. Le propriétaire sera prévenu des articles manquants.`;
  return `${received} of ${sent} arrived. The owner will be told about the missing ones.`;
}

/** "Confirm 12 received" / "Confirmer 12 reçus". */
export function confirmReceivedText(received: number, lang: Lang = "en"): string {
  return lang === "fr" ? `Confirmer ${received} ${received === 1 ? "reçu" : "reçus"}` : `Confirm ${received} received`;
}

/** "Jordan 11: sent 6, counted 4" / "Jordan 11 : envoyé 6, compté 4". */
export function shortfallLineText(name: string, sent: number, counted: number, lang: Lang = "en"): string {
  return lang === "fr" ? `${name} : envoyé ${sent}, compté ${counted}` : `${name}: sent ${sent}, counted ${counted}`;
}

/** "2 fewer than sent" / "2 de moins qu’envoyé". */
export function fewerThanSentText(n: number, lang: Lang = "en"): string {
  return lang === "fr" ? `${n} de moins qu’envoyé` : `${n} fewer than sent`;
}

/** "14 items from Bronx store" / "14 articles de Bronx store". */
export function itemsFromText(items: number, fromStore: string, lang: Lang = "en"): string {
  return lang === "fr" ? `${itemCountText(items, lang)} de ${fromStore}` : `${itemCountText(items, lang)} from ${fromStore}`;
}

/** "Return to Bronx store" / "Renvoyer à Bronx store". */
export function returnToText(storeName: string, lang: Lang = "en"): string {
  return lang === "fr" ? `Renvoyer à ${storeName}` : `Return to ${storeName}`;
}

/** "Write off 2" / "Passer 2 en perte". */
export function writeOffButtonText(n: number, lang: Lang = "en"): string {
  return lang === "fr" ? `Passer ${n} en perte` : `Write off ${n}`;
}

/** The cancel confirmation's sentence: "The 14 items go back to Bronx store. Harlem store's team is told." */
export function cancelConsequenceText(items: number, fromStore: string, toStore: string, lang: Lang = "en"): string {
  if (lang === "fr") return `Les ${itemCountText(items, lang)} reviennent à ${fromStore}. L’équipe de ${toStore} est prévenue.`;
  return `The ${itemCountText(items, lang)} go back to ${fromStore}. ${toStore}'s team is told.`;
}

/** "TR-4K8Q2A · Bronx store → Harlem store": a movement's transfer, language-free. */
export function movementTransferText(code: string, fromStore: string, toStore: string): string {
  return [code, fromStore && toStore ? `${fromStore} → ${toStore}` : ""].filter(Boolean).join(" · ");
}

/**
 * Which way a v5 movement went, as two store ids: the movement's own store
 * and the other one. A received movement came from the other store; every
 * other kind is on the source side.
 */
export function movementDirection(type: string, storeId: string, counterpartStoreId: string): { fromStoreId: string; toStoreId: string } {
  return type === "transfer_received"
    ? { fromStoreId: counterpartStoreId, toStoreId: storeId }
    : { fromStoreId: storeId, toStoreId: counterpartStoreId };
}

// ---------------------------------------------------------------------------
// Composing a transfer.
// ---------------------------------------------------------------------------

export type ComposeLine = { itemId: string; quantity: number };

/** A fresh key for a new transfer (or a cancel / receive / resolve retry key). */
export function newTransferRequestId(random?: () => string): string {
  return newClientRequestId(random);
}

/** A product added: a new line of 1, or one more on its line (a product added twice is merged). */
export function addComposeLine(lines: readonly ComposeLine[], itemId: string, quantity = 1, max: number | null = null): ComposeLine[] {
  const id = text(itemId);
  if (!id) return [...lines];
  const at = lines.findIndex((line) => line.itemId === id);
  if (at < 0) return [...lines, { itemId: id, quantity: clampQuantity(quantity, 1, max) }];
  return lines.map((line, i) => (i === at ? { ...line, quantity: clampQuantity(line.quantity + quantity, 1, max) } : line));
}

/** Lines with the same product merged, in first-seen order, quantities summed. */
export function mergeComposeLines(lines: readonly ComposeLine[]): ComposeLine[] {
  const out: ComposeLine[] = [];
  const at = new Map<string, number>();
  for (const line of lines) {
    const id = text(line.itemId);
    const q = Math.max(0, Math.round(Number(line.quantity) || 0));
    if (!id || q <= 0) continue;
    const known = at.get(id);
    if (known === undefined) {
      at.set(id, out.length);
      out.push({ itemId: id, quantity: q });
    } else {
      out[known] = { itemId: id, quantity: out[known].quantity + q };
    }
  }
  return out;
}

/** A number kept between min and max (no max = the server's cap). */
export function clampQuantity(value: unknown, min: number, max: number | null): number {
  const n = Math.round(Number(value));
  const top = Math.min(max ?? MAX_TRANSFER_QUANTITY, MAX_TRANSFER_QUANTITY);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(top, n));
}

/** A typed quantity: a whole number from min, capped at max; null for anything else (left as typed). */
export function readTypedQuantity(value: unknown, min: number, max: number | null): number | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,7}$/.test(raw)) return null;
  return clampQuantity(Number(raw), min, max);
}

/**
 * What a store holds of a product, the most a line may send. Reads the
 * per-store counts through itemStockView, so a product the server has not yet
 * counted per store sits whole at the Main store (the unmaterialised-Main
 * rule). null when the counts are not known yet (the server decides).
 */
export function storeAvailable(
  item: InventoryItem | undefined,
  storeId: string,
  stores: readonly InventoryStore[],
  stock: StockIndex,
  stockReady: boolean,
): number | null {
  if (!item || !storeId || !stockReady) return null;
  const view = itemStockView(item, { stores, storeId, stock });
  return view.multi ? view.cells[0]?.quantity ?? 0 : item.quantity;
}

export type ComposeProblem =
  | "transfer_store_required"
  | "same_store"
  | "transfer_lines_required"
  | "transfer_lines_too_many"
  | "over_available";

/**
 * Every problem with a transfer before it is saved or sent. `available` is
 * the source count per product (null = unknown); a draft may go over it
 * (it reserves nothing), a send may not.
 */
export function composeProblems(
  draft: { fromStoreId: string; toStoreId: string; lines: readonly ComposeLine[] },
  available: (itemId: string) => number | null,
  forSend: boolean,
): { problems: ComposeProblem[]; overItemIds: string[] } {
  const problems: ComposeProblem[] = [];
  const from = text(draft.fromStoreId);
  const to = text(draft.toStoreId);
  if (!from || !to) problems.push("transfer_store_required");
  else if (from === to) problems.push("same_store");
  const lines = mergeComposeLines(draft.lines);
  if (lines.length === 0) problems.push("transfer_lines_required");
  else if (lines.length > MAX_TRANSFER_LINES) problems.push("transfer_lines_too_many");
  const overItemIds = lines.filter((line) => {
    const max = available(line.itemId);
    return max !== null && line.quantity > max;
  }).map((line) => line.itemId);
  if (forSend && overItemIds.length) problems.push("over_available");
  return { problems, overItemIds };
}

export const COMPOSE_PROBLEM_MESSAGES: Record<ComposeProblem, string> = {
  transfer_store_required: "Choose the store it leaves and the store it goes to.",
  same_store: "Choose two different stores.",
  transfer_lines_required: "Add at least one product.",
  transfer_lines_too_many: "A transfer holds at most 100 products.",
  over_available: "A line asks for more than the store has. Lower it to send.",
};

export function composeProblemMessage(problems: readonly ComposeProblem[]): string {
  return problems.map((problem) => COMPOSE_PROBLEM_MESSAGES[problem]).join(" ");
}

/** saveInventoryTransferDraft / sendInventoryTransfer take the same request. */
export function composeRequest(businessId: string, clientRequestId: string, fromStoreId: string, toStoreId: string, lines: readonly ComposeLine[]) {
  return {
    businessId: text(businessId),
    clientRequestId: text(clientRequestId, 100),
    fromStoreId: text(fromStoreId),
    toStoreId: text(toStoreId),
    lines: mergeComposeLines(lines).map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
  };
}

/** A draft reopened from the list: its key and its lines, so saving or sending updates the same transfer. */
export function composeFromDraft(transfer: InventoryTransfer): { clientRequestId: string; fromStoreId: string; toStoreId: string; lines: ComposeLine[] } {
  return {
    clientRequestId: transfer.clientRequestId,
    fromStoreId: transfer.fromStoreId,
    toStoreId: transfer.toStoreId,
    lines: mergeComposeLines(transfer.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantitySent }))),
  };
}

/** The pieces on the lines. */
export function composeItemsCount(lines: readonly ComposeLine[]): number {
  return mergeComposeLines(lines).reduce((total, line) => total + line.quantity, 0);
}

export type SendAnswer = { transferId: string; code: string; status: string; itemsCount: number; productsCount: number; replayed: boolean };

/** The send / save-draft answer, read tolerantly. */
export function readSendAnswer(data: unknown): SendAnswer {
  const r = asRow(data);
  return {
    transferId: text(r.transferId),
    code: text(r.code, 40),
    status: text(r.status, 40),
    itemsCount: count(r.itemsCount),
    productsCount: count(r.productsCount),
    replayed: r.replayed === true,
  };
}

// ---------------------------------------------------------------------------
// Cancel, receive, resolve.
// ---------------------------------------------------------------------------

export function cancelTransferRequest(businessId: string, transferId: string, requestId: string) {
  return { businessId: text(businessId), transferId: text(transferId), requestId: text(requestId, 100) };
}

/** The receive form starts on what was sent: people change a number only when it differs. */
export function receiveCountsFrom(transfer: InventoryTransfer): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of transfer.lines) counts[line.itemId] = line.quantitySent;
  return counts;
}

export type Shortfall = { sent: number; received: number; missing: number; lines: Array<{ itemId: string; name: string; sent: number; counted: number }> };

/** What the counts say arrived, against what was sent (each count capped at what was sent). */
export function receiveShortfall(transfer: InventoryTransfer, counts: Readonly<Record<string, number>>): Shortfall {
  let sent = 0;
  let received = 0;
  const lines: Shortfall["lines"] = [];
  for (const line of transfer.lines) {
    const counted = clampQuantity(counts[line.itemId] ?? line.quantitySent, 0, line.quantitySent);
    sent += line.quantitySent;
    received += counted;
    if (counted < line.quantitySent) lines.push({ itemId: line.itemId, name: productDisplayName(line), sent: line.quantitySent, counted });
  }
  return { sent, received, missing: sent - received, lines };
}

/** receiveInventoryTransfer: every line named with what arrived, the optional note, the retry key. */
export function receiveTransferRequest(businessId: string, transfer: InventoryTransfer, counts: Readonly<Record<string, number>>, note: unknown, requestId: string) {
  const trimmed = text(note, MAX_TRANSFER_NOTE + 1);
  return {
    businessId: text(businessId),
    transferId: transfer.id,
    lines: transfer.lines.map((line) => ({
      itemId: line.itemId,
      quantityReceived: clampQuantity(counts[line.itemId] ?? line.quantitySent, 0, line.quantitySent),
    })),
    ...(trimmed ? { note: trimmed.slice(0, MAX_TRANSFER_NOTE) } : {}),
    requestId: text(requestId, 100),
  };
}

export function noteTooLong(note: unknown): boolean {
  return String(note ?? "").trim().length > MAX_TRANSFER_NOTE;
}

export type ResolveAction = "return" | "write_off";

/** resolveInventoryTransferLine: return the missing pieces, or write them off with a reason. */
export function resolveLineRequest(
  businessId: string,
  transferId: string,
  itemId: string,
  action: ResolveAction,
  { reason = "", note = "", requestId }: { reason?: string; note?: string; requestId: string },
) {
  const trimmed = text(note, MAX_TRANSFER_NOTE);
  return {
    businessId: text(businessId),
    transferId: text(transferId),
    itemId: text(itemId),
    action,
    ...(action === "write_off" ? { reason: text(reason, 20) } : {}),
    ...(action === "write_off" && trimmed ? { note: trimmed } : {}),
    requestId: text(requestId, 100),
  };
}

export function validateWriteOff(reason: unknown, note: unknown): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  if (!(WRITE_OFF_REASONS as readonly string[]).includes(text(reason, 20))) errors.push("write_off_reason_invalid");
  if (noteTooLong(note)) errors.push("note_too_long");
  return errors;
}

// ---------------------------------------------------------------------------
// Refusals, worded by code (and by the details the server attaches).
// ---------------------------------------------------------------------------

export const TRANSFER_FAILURE_MESSAGES = {
  alreadyReceived: "Already confirmed by the destination.",
  cancelled: "This transfer was cancelled.",
  notSent: "This transfer has not been sent yet.",
  alreadyReturned: "Those items were already returned.",
  alreadyWrittenOff: "Those items were already written off.",
  insufficient: "Some products have fewer in the store now. Each line shows the most you can send.",
  itemArchived: "A product in this transfer is archived. Unarchive it or take it out.",
  itemMissing: "A product in this transfer no longer exists. Take it out.",
  quantity: "Enter a whole number for each product.",
  notAvailable: "That transfer is not available.",
} as const;

export type TransferFailure = {
  message: string;
  reason: string;
  /** details.status (transfer_not_draft, transfer_not_in_transit). */
  status: string;
  /** details.available: what the source store holds now, by product (insufficient_stock). */
  available: Record<string, number>;
  /** details.itemIds: the products the refusal is about. */
  itemIds: string[];
};

/**
 * A transfer callable's rejection read for the sentence a dialog shows. The
 * shared reader words the code; the transfer codes that carry details read
 * them (two receivers, or a cancel that won; what the store holds now).
 */
export function transferFailure(error: unknown): TransferFailure {
  const base = inventoryCallableFailure(error);
  const details = asRow(asRow(error).details);
  const status = text(details.status, 40);
  const availableRaw = asRow(details.available);
  const available: Record<string, number> = {};
  for (const [itemId, value] of Object.entries(availableRaw)) {
    const n = countOrNull(value);
    if (n !== null) available[itemId] = n;
  }
  const itemIds = Array.isArray(details.itemIds) ? details.itemIds.map((id) => text(id)).filter(Boolean) : [];
  const failure: TransferFailure = { message: base.message, reason: base.reason, status, available, itemIds };
  const M = TRANSFER_FAILURE_MESSAGES;
  switch (base.reason) {
    case "transfer_not_in_transit":
    case "transfer_not_draft":
      if (status === "received" || status === "received_with_differences") failure.message = M.alreadyReceived;
      else if (status === "cancelled") failure.message = M.cancelled;
      else if (status === "draft") failure.message = M.notSent;
      break;
    case "line_already_resolved": {
      const resolution = text(details.resolution, 20);
      if (resolution === "returned") failure.message = M.alreadyReturned;
      else if (resolution === "written_off") failure.message = M.alreadyWrittenOff;
      break;
    }
    case "insufficient_stock":
      failure.message = M.insufficient;
      break;
    case "item_archived":
      if (itemIds.length) failure.message = M.itemArchived;
      break;
    case "item_not_found":
      if (itemIds.length) failure.message = M.itemMissing;
      break;
    case "quantity_invalid":
      failure.message = M.quantity;
      break;
    case "transfer_not_found":
      failure.message = M.notAvailable;
      break;
    default:
      break;
  }
  return failure;
}

/** Every fixed sentence this module can put on screen (for the French check). */
export function transferFixedSentences(): string[] {
  return [
    ...Object.values(TRANSFER_FAILURE_MESSAGES),
    ...Object.values(COMPOSE_PROBLEM_MESSAGES),
    ...Object.values(WRITE_OFF_REASON_LABELS),
    ...Object.values(TRANSFER_CHIP_LABELS),
    ...(["transfer_not_found", "transfer_not_draft", "transfer_not_in_transit", "line_not_disputed", "line_already_resolved",
      "store_has_transfers", "item_in_transfer", "item_not_in_transfer", "received_too_many", "write_off_reason_invalid",
      "resolution_invalid", "transfer_lines_required", "transfer_lines_too_many", "client_request_id_invalid"] as const)
      .map((code) => INVENTORY_MESSAGES[code]),
  ];
}

// ---------------------------------------------------------------------------
// A transfer a notification asked to open.
// ---------------------------------------------------------------------------

/** `key` is new on every click, so the same alert tapped twice is a fresh request. */
export type TransferFocus = { transferId: string; key: number };

export function transferFocusFrom(transferId: unknown, key: number): TransferFocus | null {
  const id = text(transferId);
  return id ? { transferId: id, key } : null;
}

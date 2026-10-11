/**
 * Inventory, console side - a shop's products, the QR tag on each, and the
 * sales staff ring up at the counter. The contract is docs/INVENTORY.md; the
 * callables are the authority (`createInventoryItem`, `adjustInventoryStock`,
 * `recordInventorySale`, `voidInventorySale`, `getInventorySummary`...). This
 * module is the pure half the console's forms use, so a bad entry is refused
 * before it costs a round trip and a refusal reads as a sentence.
 *
 * Counter selling happens in the app; the console lists and voids sales. The
 * basket math and the sale request live here anyway, tested once, so the two
 * clients agree on what a discount is and what a sale is sent as.
 *
 * Money is integer cents end to end, read through money-input.ts ("12,50" is
 * twelve dollars fifty). Nothing here imports Firebase or React:
 * `inventory.test.ts` runs it without a browser. Same shape as
 * `waiting-packages.ts`, whose callable-failure reader it parallels.
 */

import {
  INVOICE_PAYMENT_METHODS,
  INVOICE_PAYMENT_METHOD_LABELS,
  MAX_INVOICE_CENTS,
  centsToInput,
  type InvoicePaymentMethod,
} from "./invoice-ledger.ts";
import { readMoneyInput } from "./money-input.ts";
import { PACKAGE_TRACKING_ALPHABET } from "./package-staff.ts";

type Row = Record<string, unknown>;

const MAX_NAME = 120;
const MAX_CATEGORY = 60;
const MAX_NOTE = 200;
const MAX_URL = 1000;
const MAX_ID = 200;
/** A count past this is a typo (assumption: the contract names no cap). */
export const MAX_INVENTORY_QUANTITY = 1000000;
/** `getInventoryLabelsUrl` takes 1..500 copies. */
export const MAX_LABEL_COPIES = 500;
/** The most lines one sale carries (a console-side sanity cap; the server decides). */
export const MAX_SALE_LINES = 100;

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function text(value: unknown, max = MAX_ID): string {
  return String(value ?? "").trim().slice(0, max);
}

type Lang = "en" | "fr";

/** A whole number from typed text: null for blank, NaN for anything else, and NaN outside min..max. */
export function readWholeNumber(value: unknown, min = 0, max = MAX_INVENTORY_QUANTITY): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d{1,9}$/.test(raw)) return Number.NaN;
  const n = Number(raw);
  return n >= min && n <= max ? n : Number.NaN;
}

function wholeCents(value: unknown): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : null;
}

function nonNegativeInt(value: unknown): number {
  const n = wholeCents(value);
  return n === null ? 0 : Math.max(0, n);
}

function millis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime() || 0;
  const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const parsed = new Date(String(value)).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

// ---------------------------------------------------------------------------
// The code on a tag.
// ---------------------------------------------------------------------------

const ITEM_CODE = new RegExp(`^IT([${PACKAGE_TRACKING_ALPHABET}]{6})$`);

/**
 * A typed or scanned code as "IT-XXXXXX", or "" when it is not a product's
 * code. Accepts the tag's link (`https://customer.laawoldigital.com/i/IT-...`)
 * as well as the bare code; spaces, dashes and lower case are the typist's.
 */
export function inventoryCodeFrom(raw: unknown): string {
  let value = text(raw, 300);
  const linked = /\/i\/([^/?#\s]+)/i.exec(value);
  if (linked) value = linked[1];
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = ITEM_CODE.exec(compact);
  return match ? `IT-${match[1]}` : "";
}

/** The link a product's tag encodes. */
export function inventoryTagUrl(code: string): string {
  return `https://customer.laawoldigital.com/i/${inventoryCodeFrom(code) || text(code, 40)}`;
}

// ---------------------------------------------------------------------------
// A product, as the list reads it.
// ---------------------------------------------------------------------------

export type InventoryItem = {
  id: string;
  name: string;
  code: string;
  priceCents: number;
  costCents: number | null;
  quantity: number;
  lowStockAt: number | null;
  category: string;
  photoUrl: string;
  archived: boolean;
  countWasOff: boolean;
  createdByStaffId: string;
  createdAt: unknown;
  updatedAt: unknown;
};

export function inventoryItemFromRow(row: unknown): InventoryItem {
  const r = asRow(row);
  const cost = r.costCents === null || r.costCents === undefined || r.costCents === "" ? null : wholeCents(r.costCents);
  const low = r.lowStockAt === null || r.lowStockAt === undefined || r.lowStockAt === "" ? null : wholeCents(r.lowStockAt);
  return {
    id: text(r.id),
    name: text(r.name, MAX_NAME),
    code: text(r.code, 40),
    priceCents: nonNegativeInt(r.priceCents),
    costCents: cost === null ? null : Math.max(0, cost),
    quantity: nonNegativeInt(r.quantity),
    lowStockAt: low === null ? null : Math.max(0, low),
    category: text(r.category, MAX_CATEGORY),
    photoUrl: text(r.photoUrl, MAX_URL),
    archived: r.archived === true,
    countWasOff: r.countWasOff === true,
    createdByStaffId: text(r.createdByStaffId),
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

export type InventoryStatus = "ok" | "low" | "out" | "archived";

export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  ok: "In stock",
  low: "Low stock",
  out: "Out of stock",
  archived: "Archived",
};

/** The `status-pill` tone of each chip. */
export const INVENTORY_STATUS_TONES: Record<InventoryStatus, string> = {
  ok: "ok",
  low: "warn",
  out: "warn",
  archived: "muted",
};

/**
 * Where a product stands: archived wins; none left is out of stock; at or
 * below the "low stock at" number (when one is set) is low. A count of zero is
 * ALWAYS low, whatever the number says (the contract's rule).
 */
export function inventoryStatus(item: Pick<InventoryItem, "archived" | "quantity" | "lowStockAt">): InventoryStatus {
  if (item.archived) return "archived";
  if (item.quantity <= 0) return "out";
  if (item.lowStockAt !== null && item.quantity <= item.lowStockAt) return "low";
  return "ok";
}

/** Low in the contract's sense: zero left, or at/below the threshold. Never for an archived product. */
export function inventoryIsLow(item: Pick<InventoryItem, "archived" | "quantity" | "lowStockAt">): boolean {
  const status = inventoryStatus(item);
  return status === "low" || status === "out";
}

export type InventoryFilter = "all" | "low" | "countOff" | "archived";

export const INVENTORY_FILTER_LABELS: Record<InventoryFilter, string> = {
  all: "All products",
  low: "Low stock",
  countOff: "Count was off",
  archived: "Archived",
};

function searchKey(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * The products a filter and a search box narrow the list to, by name. "All"
 * is every product still on sale; Archived is the ones put away. A search
 * matches name, category and code (the code with or without its dash, or a
 * pasted tag link), every typed word having to match.
 */
export function filterInventoryItems(
  rows: readonly unknown[],
  filter: InventoryFilter,
  query: string,
): InventoryItem[] {
  const items = (Array.isArray(rows) ? rows : []).map(inventoryItemFromRow).filter((item) => item.id);
  const inFilter = items.filter((item) => {
    if (filter === "archived") return item.archived;
    if (item.archived) return false;
    if (filter === "low") return inventoryIsLow(item);
    if (filter === "countOff") return item.countWasOff;
    return true;
  });
  // A pasted tag link or a whole code finds that product alone.
  const scanned = inventoryCodeFrom(query);
  const words = searchKey(text(query, 120)).split(/\s+/).filter(Boolean);
  const hits = scanned
    ? inFilter.filter((item) => item.code === scanned)
    : words.length === 0
    ? inFilter
    : inFilter.filter((item) => {
      const haystack = [searchKey(`${item.name} ${item.category} ${item.code}`), item.code.replace(/-/g, "").toLowerCase()].join(" ");
      return words.every((word) => haystack.includes(word.replace(/-/g, "")) || haystack.includes(word));
    });
  return [...hits].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

export type InventoryCounts = { onSale: number; low: number; countOff: number };

/** What the filter chips show beside their names; one pass. */
export function inventoryCounts(rows: readonly unknown[]): InventoryCounts {
  const counts: InventoryCounts = { onSale: 0, low: 0, countOff: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = inventoryItemFromRow(row);
    if (!item.id || item.archived) continue;
    counts.onSale += 1;
    if (inventoryIsLow(item)) counts.low += 1;
    if (item.countWasOff) counts.countOff += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// What the server and the forms say.
// ---------------------------------------------------------------------------

export type InventoryRefusal =
  // Checked here before the call.
  | "name_required"
  | "name_too_long"
  | "price_invalid"
  | "cost_invalid"
  | "quantity_invalid"
  | "low_stock_invalid"
  | "category_too_long"
  | "photo_url_invalid"
  | "add_quantity_invalid"
  | "set_quantity_invalid"
  | "note_too_long"
  | "copies_invalid"
  | "sale_lines_required"
  | "sale_quantity_invalid"
  | "sold_price_invalid"
  | "sale_total_too_large"
  | "payment_method_invalid"
  | "delete_not_confirmed"
  // The server's `details.reason` codes (the ones the contract names, and the ones a form can cause).
  | "item_archived"
  | "item_not_found"
  | "sale_not_found"
  | "sale_voided"
  | "confirm_required"
  | "service_not_enabled"
  | "permission_denied"
  | "sign_in_required"
  | "offline";

export const INVENTORY_MESSAGES: Record<InventoryRefusal, string> = {
  name_required: "Enter the product's name.",
  name_too_long: "The product's name is too long.",
  price_invalid: "Enter the price in dollars, more than zero.",
  cost_invalid: "Enter the cost in dollars, or leave it empty.",
  quantity_invalid: "Enter how many are in stock, a whole number from 0.",
  low_stock_invalid: "Enter the low-stock number as a whole number, or leave it empty.",
  category_too_long: "The category is too long.",
  photo_url_invalid: "The photo link must be a web address that starts with https://.",
  add_quantity_invalid: "Enter how many to add, a whole number above zero.",
  set_quantity_invalid: "Enter the number you counted, a whole number from 0.",
  note_too_long: "The note is too long.",
  copies_invalid: "Choose between 1 and 500 tags.",
  sale_lines_required: "Add at least one product to the sale.",
  sale_quantity_invalid: "Enter how many are sold, a whole number above zero.",
  sold_price_invalid: "Enter the price it sold at, in dollars.",
  sale_total_too_large: "That sale is larger than the system can record.",
  payment_method_invalid: "Say how the customer paid.",
  delete_not_confirmed: "Type the product's code to confirm the deletion.",
  item_archived: "That product is archived. Unarchive it before selling it.",
  item_not_found: "That product no longer exists.",
  sale_not_found: "That sale no longer exists.",
  sale_voided: "That sale was already voided.",
  confirm_required: "Confirm the deletion first.",
  service_not_enabled: "Inventory is not switched on for this business.",
  permission_denied: "You do not have access to Inventory. Ask the owner to add it to your permissions.",
  sign_in_required: "Sign in again to continue.",
  offline: "Could not reach Laawol. Check your connection and try again.",
};

export function inventoryMessage(codes: readonly InventoryRefusal[]): string {
  return codes.map((code) => INVENTORY_MESSAGES[code]).join(" ");
}

export type InventoryCallableFailure = {
  message: string;
  /** The server's `details.reason` (or the mapped code), "" when it gave none. */
  reason: string;
};

const GENERIC_FAILURE = "The change did not save.";

/** Firebase's own words for "something broke" - not a sentence for a shop assistant. */
function isOpaqueMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return !message || lower === "internal" || lower === "unknown" || lower.startsWith("functions/") || lower.startsWith("firebase");
}

/**
 * A callable's rejection read for the sentence a form shows. The reason code
 * the server attached (`details.reason`) is mapped to a friendly sentence;
 * with no known reason the transport's code is, then the server's own message
 * when it is readable, then a plain "did not save".
 */
export function inventoryCallableFailure(error: unknown): InventoryCallableFailure {
  if (typeof error === "string") {
    return { message: text(error, 500) || GENERIC_FAILURE, reason: "" };
  }
  const e = asRow(error);
  const details = asRow(e.details);
  const reason = text(details.reason, 60);
  if (reason && reason in INVENTORY_MESSAGES) {
    return { message: INVENTORY_MESSAGES[reason as InventoryRefusal], reason };
  }
  const code = text(e.code, 60).replace(/^functions\//, "");
  const byCode: Record<string, InventoryRefusal> = {
    "permission-denied": "permission_denied",
    unauthenticated: "sign_in_required",
    unavailable: "offline",
    "deadline-exceeded": "offline",
  };
  const message = text(e.message, 500);
  // A permission or sign-in refusal is the same sentence whatever words the transport used.
  if (code in byCode) {
    const mapped = byCode[code];
    return { message: INVENTORY_MESSAGES[mapped], reason: reason || mapped };
  }
  return { message: isOpaqueMessage(message) ? GENERIC_FAILURE : message, reason };
}

/**
 * Runs one callable-backed action behind a busy flag and hands a failure over
 * already read. Same contract as `runPackageCall`: the flag always comes
 * down, the form keeps the whole refusal.
 */
export async function runInventoryCall(
  setBusy: (busy: boolean) => void,
  action: () => Promise<void>,
  onFailure: (failure: InventoryCallableFailure) => void,
): Promise<void> {
  setBusy(true);
  try {
    await action();
  } catch (error) {
    onFailure(inventoryCallableFailure(error));
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// The product form.
// ---------------------------------------------------------------------------

export type InventoryItemDraft = {
  name: string;
  /** US dollars as typed. */
  price: string;
  /** US dollars as typed; blank is "not known". */
  cost: string;
  /** As typed; only when a product is created (a count changes through its own dialog). */
  quantity: string;
  /** As typed; blank is "never flag it as low (only at zero)". */
  lowStockAt: string;
  category: string;
  photoUrl: string;
};

export const emptyInventoryItemDraft: InventoryItemDraft = {
  name: "",
  price: "",
  cost: "",
  quantity: "0",
  lowStockAt: "",
  category: "",
  photoUrl: "",
};

/** A stored product back into the form, so the same form edits it. */
export function inventoryDraftFromItem(item: InventoryItem): InventoryItemDraft {
  return {
    name: item.name,
    price: item.priceCents > 0 ? centsToInput(item.priceCents) : "",
    cost: item.costCents === null ? "" : centsToInput(item.costCents),
    quantity: String(item.quantity),
    lowStockAt: item.lowStockAt === null ? "" : String(item.lowStockAt),
    category: item.category,
    photoUrl: item.photoUrl,
  };
}

/** The price as cents: null for blank or unusable (the form says which), never zero or negative. */
export function readInventoryPrice(value: unknown): number | null {
  const read = readMoneyInput(value);
  if (read.cents === null || read.cents <= 0 || read.cents > MAX_INVOICE_CENTS) return null;
  return read.cents;
}

/** The cost as cents: blank is "unknown" (cents null, no error); zero is allowed. */
export function readInventoryCost(value: unknown): { cents: number | null; error: boolean } {
  const read = readMoneyInput(value);
  if (read.issue === "empty") return { cents: null, error: false };
  if (read.cents === null || read.cents < 0 || read.cents > MAX_INVOICE_CENTS) return { cents: null, error: true };
  return { cents: read.cents, error: false };
}

/** A photo is a link, never an upload (the console's rule): blank, or an https address. */
export function photoUrlOk(value: unknown): boolean {
  const raw = text(value, MAX_URL + 1);
  if (!raw) return true;
  if (raw.length > MAX_URL || /\s/.test(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Every problem at once; `creating` also checks the starting count. */
export function validateInventoryItemDraft(draft: InventoryItemDraft, creating: boolean): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  const name = text(draft.name, MAX_NAME + 1);
  if (!name) errors.push("name_required");
  else if (name.length > MAX_NAME) errors.push("name_too_long");
  if (readInventoryPrice(draft.price) === null) errors.push("price_invalid");
  if (readInventoryCost(draft.cost).error) errors.push("cost_invalid");
  const count = readWholeNumber(draft.quantity);
  if (creating && (count === null || Number.isNaN(count))) errors.push("quantity_invalid");
  if (Number.isNaN(readWholeNumber(draft.lowStockAt) ?? 0)) errors.push("low_stock_invalid");
  if (text(draft.category, MAX_CATEGORY + 1).length > MAX_CATEGORY) errors.push("category_too_long");
  if (!photoUrlOk(draft.photoUrl)) errors.push("photo_url_invalid");
  return errors;
}

/** The `createInventoryItem` request; blank optional fields are left out. */
export function createInventoryItemRequest(businessId: string, draft: InventoryItemDraft) {
  const cost = readInventoryCost(draft.cost).cents;
  const low = readWholeNumber(draft.lowStockAt);
  const category = text(draft.category, MAX_CATEGORY);
  const photoUrl = text(draft.photoUrl, MAX_URL);
  return {
    businessId: text(businessId),
    name: text(draft.name, MAX_NAME),
    priceCents: readInventoryPrice(draft.price) ?? 0,
    quantity: readWholeNumber(draft.quantity) ?? 0,
    ...(cost !== null ? { costCents: cost } : {}),
    ...(low !== null && !Number.isNaN(low) ? { lowStockAt: low } : {}),
    ...(category ? { category } : {}),
    ...(photoUrl ? { photoUrl } : {}),
  };
}

/**
 * The `updateInventoryItem` request: never the count. A cost or low-stock
 * number the person cleared is sent as null (so it is removed); one that was
 * never set and still is, is not sent at all. Category and photo clear with "".
 */
export function updateInventoryItemRequest(businessId: string, item: InventoryItem, draft: InventoryItemDraft) {
  const cost = readInventoryCost(draft.cost).cents;
  const low = readWholeNumber(draft.lowStockAt);
  const lowValue = low !== null && !Number.isNaN(low) ? low : null;
  return {
    businessId: text(businessId),
    itemId: item.id,
    name: text(draft.name, MAX_NAME),
    priceCents: readInventoryPrice(draft.price) ?? 0,
    ...(cost !== null ? { costCents: cost } : item.costCents !== null ? { costCents: null } : {}),
    ...(lowValue !== null ? { lowStockAt: lowValue } : item.lowStockAt !== null ? { lowStockAt: null } : {}),
    category: text(draft.category, MAX_CATEGORY),
    photoUrl: text(draft.photoUrl, MAX_URL),
  };
}

/** Whether saving an edit changes anything the server stores (an unchanged form is not sent). */
export function inventoryDraftChanged(item: InventoryItem, draft: InventoryItemDraft): boolean {
  const before = inventoryDraftFromItem(item);
  const same = (a: string, b: string) => a.trim() === b.trim();
  const sameMoney = (a: string, b: string) => readMoneyInput(a).cents === readMoneyInput(b).cents;
  return !(
    same(before.name, draft.name) &&
    sameMoney(before.price, draft.price) &&
    sameMoney(before.cost, draft.cost) &&
    readWholeNumber(before.lowStockAt) === readWholeNumber(draft.lowStockAt) &&
    same(before.category, draft.category) &&
    same(before.photoUrl, draft.photoUrl)
  );
}

/**
 * Whether a business has Inventory on, read the way the server reads it: only
 * the stored `enabledServices` list counts (a business that never stored one
 * does not have it).
 */
export function businessHasInventory(row: Row | null | undefined): boolean {
  const services = row?.enabledServices;
  return Array.isArray(services) && services.some((service) => String(service) === "inventory");
}

/**
 * Whether a business asked for Inventory on its application and an admin has
 * not switched it on yet. `requestedInventory` is only a request: it never
 * turns the service on, and the server clears it when an admin does.
 */
export function businessRequestedInventory(row: Row | null | undefined): boolean {
  return row?.requestedInventory === true && !businessHasInventory(row);
}

/** What the admin console sends to `setBusinessInventoryService`. */
export function setBusinessInventoryRequest(businessId: string, enabled: boolean) {
  return { businessId: text(businessId), enabled: enabled === true };
}

export function archiveInventoryItemRequest(businessId: string, itemId: string, archived: boolean) {
  return { businessId: text(businessId), itemId: text(itemId), archived: archived === true };
}

export function deleteInventoryItemRequest(businessId: string, itemId: string) {
  return { businessId: text(businessId), itemId: text(itemId), confirm: true as const };
}

/**
 * The strong confirmation for a delete: the product's code, typed. The code
 * is short and printed on its tag, so it is easy to check and hard to type by
 * accident. Dashes, spaces and case do not matter.
 */
export function deleteConfirmationMatches(item: Pick<InventoryItem, "code" | "name">, typed: unknown): boolean {
  const norm = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const want = norm(item.code || item.name);
  return want.length > 0 && norm(typed) === want;
}

// ---------------------------------------------------------------------------
// Stock: add, or set the count.
// ---------------------------------------------------------------------------

export type StockMode = "add" | "set";

export type StockDraft = {
  mode: StockMode;
  quantity: string;
  note: string;
};

export const emptyStockDraft: StockDraft = { mode: "add", quantity: "", note: "" };

export function validateStockDraft(draft: StockDraft): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  if (draft.mode === "add") {
    const n = readWholeNumber(draft.quantity, 1);
    if (n === null || Number.isNaN(n)) errors.push("add_quantity_invalid");
  } else {
    const n = readWholeNumber(draft.quantity, 0);
    if (n === null || Number.isNaN(n)) errors.push("set_quantity_invalid");
  }
  if (text(draft.note, MAX_NOTE + 1).length > MAX_NOTE) errors.push("note_too_long");
  return errors;
}

/** The count the product will have once the draft is applied; null while the draft is unusable. */
export function stockAfter(currentQuantity: number, draft: StockDraft): number | null {
  if (validateStockDraft(draft).some((code) => code !== "note_too_long")) return null;
  const n = readWholeNumber(draft.quantity, draft.mode === "add" ? 1 : 0) as number;
  return draft.mode === "add" ? Math.max(0, currentQuantity) + n : n;
}

/** The `adjustInventoryStock` request. */
export function adjustInventoryStockRequest(businessId: string, itemId: string, draft: StockDraft) {
  const note = text(draft.note, MAX_NOTE);
  return {
    businessId: text(businessId),
    itemId: text(itemId),
    mode: draft.mode === "set" ? ("set" as const) : ("add" as const),
    quantity: readWholeNumber(draft.quantity, draft.mode === "add" ? 1 : 0) ?? 0,
    ...(note ? { note } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tags.
// ---------------------------------------------------------------------------

export function validateLabelCopies(value: unknown): InventoryRefusal[] {
  const n = readWholeNumber(value, 1, MAX_LABEL_COPIES);
  return n === null || Number.isNaN(n) ? ["copies_invalid"] : [];
}

/** The `getInventoryLabelsUrl` request. */
export function inventoryLabelsRequest(businessId: string, itemId: string, copies: unknown) {
  return {
    businessId: text(businessId),
    itemId: text(itemId),
    copies: readWholeNumber(copies, 1, MAX_LABEL_COPIES) ?? 1,
  };
}

/** The tags page's link out of the callable's answer, "" when it gave none. */
export function inventoryLabelsUrl(data: unknown): string {
  const url = text(asRow(data).url, 2000);
  return /^https?:\/\//i.test(url) ? url : "";
}

// ---------------------------------------------------------------------------
// The sale: basket math and its request (the app sells; the console lists and voids).
// ---------------------------------------------------------------------------

export type BasketLine = {
  itemId: string;
  name: string;
  code: string;
  /** As typed; defaults to "1". */
  quantity: string;
  /** What the product is priced at. */
  listPriceCents: number;
  /** What it sold at, as typed (dollars); the list price until changed. */
  soldPrice: string;
};

export function basketLineFromItem(item: InventoryItem): BasketLine {
  return {
    itemId: item.id,
    name: item.name,
    code: item.code,
    quantity: "1",
    listPriceCents: item.priceCents,
    soldPrice: centsToInput(item.priceCents),
  };
}

/** Scanning the same product again adds one to its line instead of a second line. */
export function addToBasket(lines: readonly BasketLine[], item: InventoryItem): BasketLine[] {
  const at = lines.findIndex((line) => line.itemId === item.id);
  if (at < 0) return [...lines, basketLineFromItem(item)];
  return lines.map((line, index) => {
    if (index !== at) return line;
    const n = readWholeNumber(line.quantity, 1);
    const next = n === null || Number.isNaN(n) ? 1 : Math.min(MAX_INVENTORY_QUANTITY, n + 1);
    return { ...line, quantity: String(next) };
  });
}

export type BasketLineTotals = {
  quantity: number;
  listPriceCents: number;
  soldPriceCents: number;
  lineTotalCents: number;
  /** (list - sold) * quantity where positive; selling above the list price is not a discount. */
  discountCents: number;
  valid: boolean;
};

export function basketLineTotals(line: BasketLine): BasketLineTotals {
  const quantity = readWholeNumber(line.quantity, 1);
  const sold = readMoneyInput(line.soldPrice).cents;
  const list = Math.max(0, Math.round(Number(line.listPriceCents)) || 0);
  const valid = quantity !== null && !Number.isNaN(quantity) && sold !== null && sold >= 0 && sold <= MAX_INVOICE_CENTS;
  const q = valid ? (quantity as number) : 0;
  const s = valid ? (sold as number) : 0;
  return {
    quantity: q,
    listPriceCents: list,
    soldPriceCents: s,
    lineTotalCents: q * s,
    discountCents: valid && list > s ? (list - s) * q : 0,
    valid,
  };
}

export type BasketTotals = {
  totalCents: number;
  listTotalCents: number;
  discountCents: number;
  itemCount: number;
};

export function basketTotals(lines: readonly BasketLine[]): BasketTotals {
  let totalCents = 0;
  let listTotalCents = 0;
  let discountCents = 0;
  let itemCount = 0;
  for (const line of lines) {
    const t = basketLineTotals(line);
    if (!t.valid) continue;
    totalCents += t.lineTotalCents;
    listTotalCents += t.listPriceCents * t.quantity;
    discountCents += t.discountCents;
    itemCount += t.quantity;
  }
  return { totalCents, listTotalCents, discountCents, itemCount };
}

export function validateBasket(lines: readonly BasketLine[], paymentMethod: unknown): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  if (lines.length === 0 || lines.length > MAX_SALE_LINES) errors.push("sale_lines_required");
  for (const line of lines) {
    const quantity = readWholeNumber(line.quantity, 1);
    if (quantity === null || Number.isNaN(quantity)) {
      if (!errors.includes("sale_quantity_invalid")) errors.push("sale_quantity_invalid");
    }
    const sold = readMoneyInput(line.soldPrice).cents;
    if (sold === null || sold < 0 || sold > MAX_INVOICE_CENTS) {
      if (!errors.includes("sold_price_invalid")) errors.push("sold_price_invalid");
    }
  }
  if (errors.length === 0 && basketTotals(lines).totalCents > MAX_INVOICE_CENTS) errors.push("sale_total_too_large");
  if (!(INVOICE_PAYMENT_METHODS as readonly string[]).includes(text(paymentMethod, 40))) {
    errors.push("payment_method_invalid");
  }
  return errors;
}

/**
 * The `recordInventorySale` request. `clientRequestId` makes a retry the same
 * sale: generate it once when the sale is started and resend it unchanged.
 */
export function recordInventorySaleRequest(
  businessId: string,
  clientRequestId: string,
  paymentMethod: string,
  lines: readonly BasketLine[],
) {
  return {
    businessId: text(businessId),
    clientRequestId: text(clientRequestId, 100),
    paymentMethod: text(paymentMethod, 40),
    lines: lines.map((line) => ({
      itemId: text(line.itemId),
      quantity: readWholeNumber(line.quantity, 1) ?? 0,
      soldPriceCents: readMoneyInput(line.soldPrice).cents ?? 0,
    })),
  };
}

/** A fresh idempotency key; the random source is a parameter so a test can fix it. */
export function newClientRequestId(random: () => string = defaultUuid): string {
  return `web-${random()}`;
}

function defaultUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export type SaleResponse = {
  saleId: string;
  totalCents: number;
  /** The products whose count was off: their stock floored at zero. */
  countWasOffItemIds: string[];
};

/** The sale callable's answer, read tolerantly. */
export function readSaleResponse(data: unknown): SaleResponse {
  const r = asRow(data);
  const warnings = Array.isArray(r.warnings) ? r.warnings.map(asRow) : [];
  return {
    saleId: text(r.saleId),
    totalCents: nonNegativeInt(r.totalCents),
    countWasOffItemIds: warnings.filter((w) => text(w.reason, 40) === "count_was_off").map((w) => text(w.itemId)).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// A sale, as the list reads it.
// ---------------------------------------------------------------------------

export type InventorySaleLine = {
  itemId: string;
  name: string;
  code: string;
  quantity: number;
  listPriceCents: number;
  soldPriceCents: number;
  costCents: number | null;
  countWasOff: boolean;
  lineTotalCents: number;
  /** (list - sold) * quantity where positive. */
  discountCents: number;
  /** Sold at a price other than the list price. */
  repriced: boolean;
};

export type InventorySale = {
  id: string;
  lines: InventorySaleLine[];
  totalCents: number;
  listTotalCents: number;
  discountCents: number;
  itemCount: number;
  paymentMethod: string;
  methodLabel: string;
  soldByStaffId: string;
  voided: boolean;
  voidedByStaffId: string;
  voidedAt: unknown;
  voidReason: string;
  anyCountWasOff: boolean;
  createdAt: unknown;
};

export function inventoryMethodLabel(method: unknown): string {
  const id = text(method, 40);
  return id in INVOICE_PAYMENT_METHOD_LABELS ? INVOICE_PAYMENT_METHOD_LABELS[id as InvoicePaymentMethod] : id;
}

export function inventorySaleFromRow(row: unknown): InventorySale {
  const r = asRow(row);
  const lines: InventorySaleLine[] = (Array.isArray(r.lines) ? r.lines : []).map((raw) => {
    const l = asRow(raw);
    const quantity = Math.max(0, wholeCents(l.quantity) ?? 0);
    const list = nonNegativeInt(l.listPriceCents);
    const sold = nonNegativeInt(l.soldPriceCents);
    const cost = l.costCents === null || l.costCents === undefined || l.costCents === "" ? null : wholeCents(l.costCents);
    return {
      itemId: text(l.itemId),
      name: text(l.name, MAX_NAME),
      code: text(l.code, 40),
      quantity,
      listPriceCents: list,
      soldPriceCents: sold,
      costCents: cost === null ? null : Math.max(0, cost),
      countWasOff: l.countWasOff === true,
      lineTotalCents: quantity * sold,
      discountCents: list > sold ? (list - sold) * quantity : 0,
      repriced: list !== sold,
    };
  });
  const listTotal = lines.reduce((sum, l) => sum + l.listPriceCents * l.quantity, 0);
  return {
    id: text(r.id),
    lines,
    // The stored total is the record; the lines are only added up when it is missing.
    totalCents: r.totalCents === undefined || r.totalCents === null
      ? lines.reduce((sum, l) => sum + l.lineTotalCents, 0)
      : nonNegativeInt(r.totalCents),
    listTotalCents: listTotal,
    discountCents: lines.reduce((sum, l) => sum + l.discountCents, 0),
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    paymentMethod: text(r.paymentMethod, 40),
    methodLabel: inventoryMethodLabel(r.paymentMethod),
    soldByStaffId: text(r.soldByStaffId),
    voided: r.voided === true,
    voidedByStaffId: text(r.voidedByStaffId),
    voidedAt: r.voidedAt ?? null,
    voidReason: text(r.voidReason ?? r.reason, MAX_NOTE),
    anyCountWasOff: lines.some((l) => l.countWasOff),
    createdAt: r.createdAt ?? null,
  };
}

/** The first product names on a sale, in the order they were rung up, and how many more there are. */
export function saleLinesSummary(sale: Pick<InventorySale, "lines">, max = 2): { names: string[]; more: number } {
  const names = sale.lines.map((line) => line.name).filter(Boolean);
  return { names: names.slice(0, max), more: Math.max(0, names.length - max) };
}

/** The `voidInventorySale` request; the reason is optional. */
export function voidInventorySaleRequest(businessId: string, saleId: string, reason: unknown) {
  const why = text(reason, MAX_NOTE);
  return { businessId: text(businessId), saleId: text(saleId), ...(why ? { reason: why } : {}) };
}

export function validateVoidReason(reason: unknown): InventoryRefusal[] {
  return text(reason, MAX_NOTE + 1).length > MAX_NOTE ? ["note_too_long"] : [];
}

// ---------------------------------------------------------------------------
// Stock history.
// ---------------------------------------------------------------------------

export type InventoryMovementType = "initial" | "add" | "set" | "sale" | "void";

export const INVENTORY_MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  initial: "Starting count",
  add: "Stock added",
  set: "Count set",
  sale: "Sold",
  void: "Sale voided",
};

export type InventoryMovement = {
  id: string;
  type: string;
  label: string;
  delta: number;
  /** "+5", "-2" or "0". */
  deltaText: string;
  quantityAfter: number;
  byStaffId: string;
  note: string;
  saleId: string;
  at: unknown;
};

export function signedCount(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `-${Math.abs(delta)}`;
  return "0";
}

/** An item's stock history, newest first. */
export function inventoryMovementEntries(rows: readonly unknown[]): InventoryMovement[] {
  return (Array.isArray(rows) ? rows : [])
    .map(asRow)
    .map((row) => {
      const type = text(row.type, 20);
      const delta = wholeCents(row.delta) ?? 0;
      return {
        id: text(row.id),
        type,
        label: type in INVENTORY_MOVEMENT_LABELS ? INVENTORY_MOVEMENT_LABELS[type as InventoryMovementType] : type,
        delta,
        deltaText: signedCount(delta),
        quantityAfter: nonNegativeInt(row.quantityAfter),
        byStaffId: text(row.byStaffId),
        note: text(row.note, MAX_NOTE),
        saleId: text(row.saleId),
        at: row.createdAt ?? null,
      };
    })
    .sort((a, b) => millis(b.at) - millis(a.at));
}

// ---------------------------------------------------------------------------
// The summary (computed by the server; never from the list on screen).
// ---------------------------------------------------------------------------

export type InventorySummaryRange = "today" | "month";

export const INVENTORY_RANGE_LABELS: Record<InventorySummaryRange, string> = {
  today: "Today",
  month: "This month",
};

/** The `getInventorySummary` request. */
export function inventorySummaryRequest(businessId: string, range: InventorySummaryRange, timeZone: string) {
  return {
    businessId: text(businessId),
    range: range === "month" ? ("month" as const) : ("today" as const),
    timeZone: text(timeZone, 80),
  };
}

export type InventorySummary = {
  salesCount: number;
  itemsSold: number;
  revenueCents: number;
  /** Known costs only. */
  costCents: number;
  profitCents: number;
  discountCents: number;
  best: Array<{ itemId: string; name: string; quantity: number; revenueCents: number }>;
  low: Array<{ itemId: string; name: string; quantity: number; lowStockAt: number | null }>;
  countWasOff: Array<{ itemId: string; name: string }>;
};

function signedInt(value: unknown): number {
  return wholeCents(value) ?? 0;
}

/** The summary callable's answer read tolerantly; null when it is not an answer at all. */
export function readInventorySummary(data: unknown): InventorySummary | null {
  if (!data || typeof data !== "object") return null;
  const r = asRow(data);
  const list = (value: unknown) => (Array.isArray(value) ? value.map(asRow) : []);
  return {
    salesCount: nonNegativeInt(r.salesCount),
    itemsSold: nonNegativeInt(r.itemsSold),
    revenueCents: signedInt(r.revenueCents),
    costCents: signedInt(r.costCents),
    profitCents: signedInt(r.profitCents),
    discountCents: nonNegativeInt(r.discountCents),
    best: list(r.best).map((b) => ({
      itemId: text(b.itemId),
      name: text(b.name, MAX_NAME),
      quantity: nonNegativeInt(b.quantity),
      revenueCents: signedInt(b.revenueCents),
    })),
    low: list(r.low).map((b) => ({
      itemId: text(b.itemId),
      name: text(b.name, MAX_NAME),
      quantity: nonNegativeInt(b.quantity),
      lowStockAt: b.lowStockAt === null || b.lowStockAt === undefined || b.lowStockAt === "" ? null : nonNegativeInt(b.lowStockAt),
    })),
    countWasOff: list(r.countWasOff).map((b) => ({ itemId: text(b.itemId), name: text(b.name, MAX_NAME) })),
  };
}

// ---------------------------------------------------------------------------
// Sentences with numbers in them, built per language (the numbers sit inside).
// ---------------------------------------------------------------------------

/** "12 products" / "12 produits". */
export function productCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "produit" : "produits"}`;
  return `${count} ${count === 1 ? "product" : "products"}`;
}

/** "3 items" / "3 articles": the pieces on a sale. */
export function itemCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "article" : "articles"}`;
  return `${count} ${count === 1 ? "item" : "items"}`;
}

/** "5 left" / "5 restants": what a product's count reads as in a list. */
export function leftText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "restant" : "restants"}`;
  return `${count} left`;
}

/** "Low at 3" / "Bas à 3": the product's own low-stock line. */
export function lowAtText(count: number, lang: Lang = "en"): string {
  return lang === "fr" ? `Bas à ${count}` : `Low at ${count}`;
}

/** "2 tags" / "2 étiquettes". */
export function tagCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "étiquette" : "étiquettes"}`;
  return `${count} ${count === 1 ? "tag" : "tags"}`;
}

/** "Voided by Anna" / "Annulée par Anna". */
export function voidedByText(name: string, lang: Lang = "en"): string {
  if (lang === "fr") return name ? `Annulée par ${name}` : "Annulée";
  return name ? `Voided by ${name}` : "Voided";
}

/** "Sold by Anna" / "Vendu par Anna". */
export function soldByText(name: string, lang: Lang = "en"): string {
  if (lang === "fr") return name ? `Vendu par ${name}` : "";
  return name ? `Sold by ${name}` : "";
}

/** The stock a void puts back, as a sentence for its confirmation. */
export function voidConsequenceText(itemCount: number, lang: Lang = "en"): string {
  if (lang === "fr") {
    return `Le stock ${itemCount === 1 ? "de l’article vendu revient" : `des ${itemCount} articles vendus revient`}. La vente reste dans l’historique, marquée comme annulée.`;
  }
  return `Stock for ${itemCount === 1 ? "the 1 item sold" : `the ${itemCount} items sold`} goes back. The sale stays in the history, marked voided.`;
}

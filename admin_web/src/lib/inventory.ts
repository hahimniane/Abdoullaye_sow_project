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
const MAX_BRAND = 60;
const MAX_NOTE = 200;
/** Console-side caps for a store's details (the contract names none; the server decides). */
const MAX_STORE_NAME = 80;
const MAX_STORE_ADDRESS = 200;
const MAX_STORE_PHONE = 40;
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
  /** The name of the category the product was saved with (a snapshot; the list's name wins once renamed). */
  category: string;
  /** The category's id; "" for a legacy product whose typed category is not in the list yet. */
  categoryId: string;
  /** The name of the brand the product was saved with ("" = none; a snapshot, the list's name wins once renamed). */
  brand: string;
  /** The brand's id; "" for none. */
  brandId: string;
  photoUrl: string;
  archived: boolean;
  countWasOff: boolean;
  /** True once the server counts this product per store; until then its whole `quantity` sits at the Main store. */
  storeStock: boolean;
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
    categoryId: text(r.categoryId),
    brand: text(r.brand, MAX_BRAND),
    brandId: text(r.brandId),
    photoUrl: text(r.photoUrl, MAX_URL),
    archived: r.archived === true,
    countWasOff: r.countWasOff === true,
    storeStock: r.storeStock === true,
    createdByStaffId: text(r.createdByStaffId),
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

/**
 * What a product is called everywhere a person reads it: the brand in front,
 * then the name ("Jordan 11"); just the name when there is no brand. The
 * stored `name` holds only the part after the brand.
 */
export function productDisplayName(item: { name: string; brand?: string | null }): string {
  const name = text(item.name, MAX_NAME);
  const brand = text(item.brand ?? "", MAX_BRAND);
  return brand ? `${brand} ${name}`.trim() : name;
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
 * matches brand, name, category and code (the code with or without its dash, or a
 * pasted tag link), every typed word having to match.
 *
 * `scope` is the v2 part (categories and stores). Left out, this is exactly
 * the single-store list: no category filter, and "low" / "count was off" read
 * the product's own total.
 */
export function filterInventoryItems(
  rows: readonly unknown[],
  filter: InventoryFilter,
  query: string,
  scope: InventoryListScope = {},
): InventoryItem[] {
  const items = (Array.isArray(rows) ? rows : []).map(inventoryItemFromRow).filter((item) => item.id);
  const categories = scope.categories ?? [];
  // Built once for the whole list, then read per product.
  const resolve = categoryResolver(categories);
  const resolveBrand = brandResolver(scope.brands ?? []);
  const inFilter = items.map((item) => withCurrentBrand(item, resolveBrand)).filter((item) => {
    if (!itemInCategory(item, resolve, scope.categoryId ?? "")) return false;
    if (!itemInBrand(item, resolveBrand, scope.brandId ?? "")) return false;
    if (filter === "archived") return item.archived;
    if (item.archived) return false;
    if (filter === "low") return itemStockView(item, scope).low;
    if (filter === "countOff") return itemStockView(item, scope).countWasOff;
    return true;
  });
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  // A pasted tag link or a whole code finds that product alone.
  const scanned = inventoryCodeFrom(query);
  const words = searchKey(text(query, 120)).split(/\s+/).filter(Boolean);
  const hits = scanned
    ? inFilter.filter((item) => item.code === scanned)
    : words.length === 0
    ? inFilter
    : inFilter.filter((item) => {
      const category = categoryNames.get(item.categoryId) ?? item.category;
      const haystack = [searchKey(`${productDisplayName(item)} ${category} ${item.code}`), item.code.replace(/-/g, "").toLowerCase()].join(" ");
      return words.every((word) => haystack.includes(word.replace(/-/g, "")) || haystack.includes(word));
    });
  return [...hits].sort((a, b) => productDisplayName(a).localeCompare(productDisplayName(b)) || a.code.localeCompare(b.code));
}

export type InventoryCounts = { onSale: number; low: number; countOff: number };

/**
 * What the filter chips show beside their names; one pass. In a multi-store
 * business `scope` says whose stock is counted (one store, or all of them).
 */
export function inventoryCounts(rows: readonly unknown[], scope: InventoryListScope = {}): InventoryCounts {
  const counts: InventoryCounts = { onSale: 0, low: 0, countOff: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = inventoryItemFromRow(row);
    if (!item.id || item.archived) continue;
    counts.onSale += 1;
    const view = itemStockView(item, scope);
    if (view.low) counts.low += 1;
    if (view.countWasOff) counts.countOff += 1;
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
  | "brand_too_long"
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
  | "stock_store_invalid"
  | "store_required"
  | "transfer_item_required"
  | "transfer_store_required"
  | "transfer_quantity_invalid"
  | "store_name_too_long"
  | "store_detail_too_long"
  | "staff_store_required"
  // The server's v2 codes (categories and stores), also raised here before the call where the form can tell.
  | "category_name_required"
  | "category_name_taken"
  | "category_not_found"
  // The server's v3 codes (brands).
  | "brand_name_required"
  | "brand_name_taken"
  | "brand_not_found"
  | "store_name_required"
  | "store_not_found"
  | "store_archived"
  | "store_has_stock"
  | "store_not_allowed"
  | "home_store_required"
  | "same_store"
  | "insufficient_stock"
  | "owner_only"
  // The server's `details.reason` codes (the ones the contract names, and the ones a form can cause).
  | "item_archived"
  | "item_not_found"
  | "sale_not_found"
  | "sale_voided"
  | "confirm_required"
  // The server's v4 codes (credit sales and who received the money).
  | "received_by_invalid"
  | "credit_invalid"
  | "paid_now_invalid"
  | "credit_customer_required"
  | "customer_phone_invalid"
  | "collector_invalid"
  | "due_date_invalid"
  | "amount_invalid"
  | "payment_exceeds_balance"
  | "no_credit"
  | "credit_has_payments"
  | "payment_not_found"
  | "payment_already_reverted"
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
  brand_too_long: "The brand is too long.",
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
  stock_store_invalid: "Enter a whole number from 0 for each store, or leave it empty.",
  store_required: "Choose which store.",
  transfer_item_required: "Choose the product to move.",
  transfer_store_required: "Choose the store it leaves and the store it goes to.",
  transfer_quantity_invalid: "Enter how many to move, a whole number above zero.",
  store_name_too_long: "The store's name is too long.",
  store_detail_too_long: "The address or phone number is too long.",
  staff_store_required: "Choose a home store, or let this person work in all stores.",
  category_name_required: "Enter the category's name.",
  category_name_taken: "You already have a category with that name.",
  category_not_found: "That category no longer exists.",
  brand_name_required: "Enter the brand's name.",
  brand_name_taken: "You already have a brand with that name.",
  brand_not_found: "That brand no longer exists.",
  store_name_required: "Enter the store's name.",
  store_not_found: "That store no longer exists.",
  store_archived: "That store is archived. Restore it first.",
  store_has_stock: "That store still has stock. Move it to another store first.",
  store_not_allowed: "You can only work in your own store.",
  home_store_required: "You have no home store yet. Ask the owner to assign one.",
  same_store: "Choose two different stores.",
  insufficient_stock: "There are not enough in the store it leaves to move that many.",
  owner_only: "Only the owner can do this.",
  item_archived: "That product is archived. Unarchive it before selling it.",
  item_not_found: "That product no longer exists.",
  sale_not_found: "That sale no longer exists.",
  sale_voided: "That sale was already voided.",
  confirm_required: "Confirm the deletion first.",
  received_by_invalid: "Choose who received the money: someone of this business.",
  credit_invalid: "The credit details could not be read.",
  paid_now_invalid: "The amount paid now must be less than the sale total.",
  credit_customer_required: "Enter the customer's name and phone number.",
  customer_phone_invalid: "Enter the customer's phone number with its country code.",
  collector_invalid: "Choose who collects the rest: someone of this business.",
  due_date_invalid: "The due date must be today or later.",
  amount_invalid: "Enter the amount received, more than zero.",
  payment_exceeds_balance: "That is more than the customer still owes.",
  no_credit: "That sale was not made on credit.",
  credit_has_payments: "Money was already collected on this credit. Revert those payments before voiding the sale.",
  payment_not_found: "That payment no longer exists.",
  payment_already_reverted: "That payment was already reverted.",
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
  /**
   * The category's name: the chosen one's, or - for a legacy product whose
   * typed category is not in the list yet, or a business whose list could not
   * be read - the typed text the server turns into a category.
   */
  category: string;
  /** The chosen category's id; "" for none (or for the typed text above). Left out in the v1 shape. */
  categoryId?: string;
  /** The brand's name: the chosen one's, or the typed text the server turns into a brand. "" = no brand. */
  brand?: string;
  /** The chosen brand's id; "" for none (or for the typed text above). */
  brandId?: string;
  /**
   * Multi-store only: the starting count typed for each store, by store id.
   * Left out (or ignored) in a single-store business, where `quantity` is the count.
   */
  stock?: Record<string, string>;
  photoUrl: string;
};

export const emptyInventoryItemDraft: InventoryItemDraft = {
  name: "",
  price: "",
  cost: "",
  quantity: "0",
  lowStockAt: "",
  category: "",
  categoryId: "",
  brand: "",
  brandId: "",
  stock: {},
  photoUrl: "",
};

/**
 * "Save and add another like it": the empty form again, keeping ONLY the brand
 * and the category (the ones a run of similar products shares). Name, price,
 * cost, the count (or each store's), the low-stock number and the photo start
 * empty.
 */
export function quickEntryDraft(saved: InventoryItemDraft): InventoryItemDraft {
  return {
    ...emptyInventoryItemDraft,
    stock: {},
    category: saved.category,
    categoryId: saved.categoryId ?? "",
    brand: saved.brand ?? "",
    brandId: saved.brandId ?? "",
  };
}

/**
 * A stored product back into the form, so the same form edits it. With the
 * business's categories the product's category is matched to the list (by id,
 * else by name); one that is not in the list yet stays as typed text.
 */
export function inventoryDraftFromItem(
  item: InventoryItem,
  categories: readonly InventoryCategory[] = [],
  brands: readonly InventoryBrand[] = [],
): InventoryItemDraft {
  const match = categoryForItem(item, categories);
  const brandMatch = brandForItem(item, brands);
  return {
    name: item.name,
    price: item.priceCents > 0 ? centsToInput(item.priceCents) : "",
    cost: item.costCents === null ? "" : centsToInput(item.costCents),
    quantity: String(item.quantity),
    lowStockAt: item.lowStockAt === null ? "" : String(item.lowStockAt),
    category: match ? match.name : item.category,
    categoryId: match ? match.id : "",
    brand: brandMatch ? brandMatch.name : item.brand,
    brandId: brandMatch ? brandMatch.id : "",
    stock: {},
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

/** The stores a product form asks a starting count for: none in a single-store business. */
export type ItemFormStores = { multiStore: boolean };

/**
 * The starting count per store: the stores with a number above zero, as
 * `{storeId: quantity}`. A blank box is nothing; anything that is not a whole
 * number is `invalid`.
 */
export function readStartingStock(stock: Record<string, string> | undefined): { stock: Record<string, number>; invalid: boolean } {
  const out: Record<string, number> = {};
  let invalid = false;
  for (const [storeId, raw] of Object.entries(stock ?? {})) {
    const n = readWholeNumber(raw);
    if (n === null) continue;
    if (Number.isNaN(n)) invalid = true;
    else if (n > 0 && storeId) out[storeId] = n;
  }
  return { stock: out, invalid };
}

/**
 * Every problem at once; `creating` also checks the starting count - the one
 * number of a single-store business, or each store's own in a multi-store one.
 */
export function validateInventoryItemDraft(
  draft: InventoryItemDraft,
  creating: boolean,
  form: ItemFormStores = { multiStore: false },
): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  const name = text(draft.name, MAX_NAME + 1);
  if (!name) errors.push("name_required");
  else if (name.length > MAX_NAME) errors.push("name_too_long");
  if (readInventoryPrice(draft.price) === null) errors.push("price_invalid");
  if (readInventoryCost(draft.cost).error) errors.push("cost_invalid");
  if (creating && form.multiStore) {
    if (readStartingStock(draft.stock).invalid) errors.push("stock_store_invalid");
  } else {
    const count = readWholeNumber(draft.quantity);
    if (creating && (count === null || Number.isNaN(count))) errors.push("quantity_invalid");
  }
  if (Number.isNaN(readWholeNumber(draft.lowStockAt) ?? 0)) errors.push("low_stock_invalid");
  if (text(draft.category, MAX_CATEGORY + 1).length > MAX_CATEGORY) errors.push("category_too_long");
  if (text(draft.brand ?? "", MAX_BRAND + 1).length > MAX_BRAND) errors.push("brand_too_long");
  if (!photoUrlOk(draft.photoUrl)) errors.push("photo_url_invalid");
  return errors;
}

/**
 * The category part of a product request: the chosen category's id, or - with
 * no id - the typed name (a legacy product, or a list that could not be read),
 * which the server finds or creates. Exactly the v1 shape in the second case.
 */
function categoryFields(draft: InventoryItemDraft): { categoryId?: string; category?: string } {
  const categoryId = text(draft.categoryId);
  if (categoryId) return { categoryId };
  const category = text(draft.category, MAX_CATEGORY);
  return category ? { category } : {};
}

/**
 * The brand part of a create request: the chosen brand's id, or the typed name
 * (which the server finds or creates), or nothing: a product without a brand
 * sends exactly the v2 request.
 */
function brandFields(draft: InventoryItemDraft): { brandId?: string; brand?: string } {
  const brandId = text(draft.brandId ?? "");
  if (brandId) return { brandId };
  const brand = text(draft.brand ?? "", MAX_BRAND);
  return brand ? { brand } : {};
}

/**
 * The `createInventoryItem` request; blank optional fields are left out. A
 * single-store business sends the one `quantity` (the v1 shape, which every
 * business still accepts); a multi-store one sends `stock: {storeId: n}`.
 */
export function createInventoryItemRequest(
  businessId: string,
  draft: InventoryItemDraft,
  form: ItemFormStores = { multiStore: false },
): {
  businessId: string;
  name: string;
  priceCents: number;
  quantity?: number;
  stock?: Record<string, number>;
  costCents?: number;
  lowStockAt?: number;
  categoryId?: string;
  category?: string;
  brandId?: string;
  brand?: string;
  photoUrl?: string;
} {
  const cost = readInventoryCost(draft.cost).cents;
  const low = readWholeNumber(draft.lowStockAt);
  const photoUrl = text(draft.photoUrl, MAX_URL);
  return {
    businessId: text(businessId),
    name: text(draft.name, MAX_NAME),
    priceCents: readInventoryPrice(draft.price) ?? 0,
    ...(form.multiStore ? { stock: readStartingStock(draft.stock).stock } : { quantity: readWholeNumber(draft.quantity) ?? 0 }),
    ...(cost !== null ? { costCents: cost } : {}),
    ...(low !== null && !Number.isNaN(low) ? { lowStockAt: low } : {}),
    ...categoryFields(draft),
    ...brandFields(draft),
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
    ...updateCategoryFields(item, draft),
    ...updateBrandFields(item, draft),
    photoUrl: text(draft.photoUrl, MAX_URL),
  };
}

/**
 * A chosen category is sent by id. Otherwise the typed name goes as in v1,
 * and "" clears it; a product that had a category id also clears the id.
 */
function updateCategoryFields(item: InventoryItem, draft: InventoryItemDraft): { categoryId?: string; category?: string } {
  const chosen = text(draft.categoryId);
  if (chosen) return { categoryId: chosen };
  const category = text(draft.category, MAX_CATEGORY);
  if (category) return { category };
  return item.categoryId ? { category: "", categoryId: "" } : { category: "" };
}

/**
 * A chosen brand is sent by id, a typed one as its name. No brand now but one
 * before clears both (`brand: ""` + `brandId: ""`); a product that never had a
 * brand sends nothing about it.
 */
function updateBrandFields(item: InventoryItem, draft: InventoryItemDraft): { brandId?: string; brand?: string } {
  const chosen = text(draft.brandId ?? "");
  if (chosen) return { brandId: chosen };
  const brand = text(draft.brand ?? "", MAX_BRAND);
  if (brand) return { brand };
  return item.brandId || item.brand ? { brand: "", brandId: "" } : {};
}

/**
 * Whether saving an edit changes anything the server stores (an unchanged
 * form is not sent). `categories` is the list the form was opened with, so a
 * legacy product matched to a category by name is not "changed" by the match.
 */
export function inventoryDraftChanged(
  item: InventoryItem,
  draft: InventoryItemDraft,
  categories: readonly InventoryCategory[] = [],
  brands: readonly InventoryBrand[] = [],
): boolean {
  const before = inventoryDraftFromItem(item, categories, brands);
  const same = (a: string, b: string) => a.trim() === b.trim();
  const sameMoney = (a: string, b: string) => readMoneyInput(a).cents === readMoneyInput(b).cents;
  return !(
    same(before.name, draft.name) &&
    sameMoney(before.price, draft.price) &&
    sameMoney(before.cost, draft.cost) &&
    readWholeNumber(before.lowStockAt) === readWholeNumber(draft.lowStockAt) &&
    same(before.categoryId ?? "", draft.categoryId ?? "") &&
    (text(draft.categoryId) !== "" || same(before.category, draft.category)) &&
    same(before.brandId ?? "", draft.brandId ?? "") &&
    (text(draft.brandId ?? "") !== "" || same(before.brand ?? "", draft.brand ?? "")) &&
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

/**
 * The `adjustInventoryStock` request. A multi-store business names the store
 * whose count changes (`storeId`); a single-store one sends none, the v1 shape
 * every business still accepts.
 */
export function adjustInventoryStockRequest(businessId: string, itemId: string, draft: StockDraft, storeId = "") {
  const note = text(draft.note, MAX_NOTE);
  const store = text(storeId);
  return {
    businessId: text(businessId),
    itemId: text(itemId),
    mode: draft.mode === "set" ? ("set" as const) : ("add" as const),
    quantity: readWholeNumber(draft.quantity, draft.mode === "add" ? 1 : 0) ?? 0,
    ...(store ? { storeId: store } : {}),
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
  storeId = "",
) {
  const store = text(storeId);
  return {
    businessId: text(businessId),
    clientRequestId: text(clientRequestId, 100),
    paymentMethod: text(paymentMethod, 40),
    // Left out, the server sells from the caller's home store (the v1 shape).
    ...(store ? { storeId: store } : {}),
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
  /** The brand when it was sold (a snapshot); "" for none. */
  brand: string;
  brandId: string;
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
  /** The store it was sold in; "" for a sale from before the business had stores. */
  storeId: string;
  /** The store's name when it was sold (a snapshot). */
  storeName: string;
  voided: boolean;
  voidedByStaffId: string;
  voidedAt: unknown;
  voidReason: string;
  anyCountWasOff: boolean;
  createdAt: unknown;
  /** Who took the money at the counter (v4); the seller for a sale from before v4. */
  receivedByStaffId: string;
  /** What was paid at the counter: the whole total unless the sale went on credit. */
  paidNowCents: number;
  /** What the customer owed after the sale (0 for a normal sale). */
  creditCents: number;
  /** Collected since, from payments that were not reverted. */
  creditPaidCents: number;
  /** Still owed: creditCents - creditPaidCents. */
  creditRemainingCents: number;
  /** "none" for a normal (or voided) sale, else "open" until it is paid. */
  creditStatus: InventoryCreditStatus;
  /** Who owes and who collects; null for a normal sale. */
  credit: InventorySaleCredit | null;
};

export type InventoryCreditStatus = "none" | "open" | "paid";

export type InventorySaleCredit = {
  customerName: string;
  customerPhone: string;
  collectorStaffId: string;
  /** "YYYY-MM-DD", or "" for no due date. */
  dueDate: string;
};

const DATE_KEY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

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
      brand: text(l.brand, MAX_BRAND),
      brandId: text(l.brandId),
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
  // The stored total is the record; the lines are only added up when it is missing.
  const totalCents = r.totalCents === undefined || r.totalCents === null
    ? lines.reduce((sum, l) => sum + l.lineTotalCents, 0)
    : nonNegativeInt(r.totalCents);
  const voided = r.voided === true;
  // v4 money: a sale from before it has none of these fields and was paid in full at the counter.
  const creditCents = Math.min(totalCents, nonNegativeInt(r.creditCents));
  const creditPaidCents = Math.min(creditCents, nonNegativeInt(r.creditPaidCents));
  const rawCredit = asRow(r.credit);
  const dueDate = text(rawCredit.dueDate, 10);
  const credit: InventorySaleCredit | null = creditCents > 0
    ? {
      customerName: text(rawCredit.customerName, MAX_NAME),
      customerPhone: text(rawCredit.customerPhone, 40),
      collectorStaffId: text(rawCredit.collectorStaffId),
      dueDate: DATE_KEY.test(dueDate) ? dueDate : "",
    }
    : null;
  return {
    id: text(r.id),
    lines,
    totalCents,
    listTotalCents: listTotal,
    discountCents: lines.reduce((sum, l) => sum + l.discountCents, 0),
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    paymentMethod: text(r.paymentMethod, 40),
    methodLabel: inventoryMethodLabel(r.paymentMethod),
    soldByStaffId: text(r.soldByStaffId),
    storeId: text(r.storeId),
    storeName: text(r.storeName, MAX_STORE_NAME),
    voided,
    voidedByStaffId: text(r.voidedByStaffId),
    voidedAt: r.voidedAt ?? null,
    voidReason: text(r.voidReason ?? r.reason, MAX_NOTE),
    anyCountWasOff: lines.some((l) => l.countWasOff),
    createdAt: r.createdAt ?? null,
    receivedByStaffId: text(r.receivedByStaffId) || text(r.soldByStaffId),
    paidNowCents: totalCents - creditCents,
    creditCents,
    creditPaidCents,
    creditRemainingCents: creditCents - creditPaidCents,
    creditStatus: voided || creditCents <= 0 ? "none" : creditPaidCents >= creditCents ? "paid" : "open",
    credit,
  };
}

/** The first product names on a sale, in the order they were rung up, and how many more there are. */
export function saleLinesSummary(sale: Pick<InventorySale, "lines">, max = 2): { names: string[]; more: number } {
  const names = sale.lines.map((line) => productDisplayName(line)).filter(Boolean);
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

export type InventoryMovementType = "initial" | "add" | "set" | "sale" | "void" | "transfer" | "transfer_in" | "transfer_out";

export const INVENTORY_MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  initial: "Starting count",
  add: "Stock added",
  set: "Count set",
  sale: "Sold",
  void: "Sale voided",
  transfer: "Stock moved",
  transfer_in: "Moved in from another store",
  transfer_out: "Moved out to another store",
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
  /** The store whose count this line changed; "" when it predates stores. */
  storeId: string;
  /** Both sides of a transfer share this. */
  transferId: string;
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
      const transferId = text(row.transferId);
      return {
        id: text(row.id),
        type,
        // An unknown type that carries a transfer id is still a transfer, in words.
        label: type in INVENTORY_MOVEMENT_LABELS
          ? INVENTORY_MOVEMENT_LABELS[type as InventoryMovementType]
          : transferId ? INVENTORY_MOVEMENT_LABELS.transfer : type,
        delta,
        deltaText: signedCount(delta),
        quantityAfter: nonNegativeInt(row.quantityAfter),
        byStaffId: text(row.byStaffId),
        note: text(row.note, MAX_NOTE),
        saleId: text(row.saleId),
        storeId: text(row.storeId),
        transferId,
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

/**
 * The `getInventorySummary` request. `storeId` narrows it to one store: left
 * out (or "") is every store the caller may see, the v1 shape.
 */
export function inventorySummaryRequest(businessId: string, range: InventorySummaryRange, timeZone: string, storeId = "") {
  const store = text(storeId);
  return {
    businessId: text(businessId),
    range: range === "month" ? ("month" as const) : ("today" as const),
    timeZone: text(timeZone, 80),
    ...(store ? { storeId: store } : {}),
  };
}

/** One category's line in the summary. An empty `categoryId` is the "Uncategorized" row. */
export type InventoryCategorySales = {
  categoryId: string;
  name: string;
  itemsSold: number;
  revenueCents: number;
  profitCents: number;
};

/** One brand's line in the summary. An empty `brandId` is the "No brand" row. */
export type InventoryBrandSales = {
  brandId: string;
  name: string;
  itemsSold: number;
  revenueCents: number;
  profitCents: number;
};

/** One store's line in the summary (all-store callers of a multi-store business only). */
export type InventoryStoreSales = {
  storeId: string;
  name: string;
  salesCount: number;
  itemsSold: number;
  revenueCents: number;
  profitCents: number;
};

export type InventorySummary = {
  salesCount: number;
  itemsSold: number;
  revenueCents: number;
  /** Known costs only. */
  costCents: number;
  profitCents: number;
  discountCents: number;
  /** A row's `brand` is "" unless the server sends it; the screen then looks the product's brand up itself. */
  best: Array<{ itemId: string; name: string; brand: string; quantity: number; revenueCents: number }>;
  /** In a multi-store business a low row also names the store it is low in. */
  low: Array<{ itemId: string; name: string; brand: string; quantity: number; lowStockAt: number | null; storeId: string; storeName: string }>;
  countWasOff: Array<{ itemId: string; name: string; brand: string }>;
  /** Every category, most money first; voided sales are not in it. */
  byCategory: InventoryCategorySales[];
  /** Every brand that sold, most money first; "No brand" is the row with an empty `brandId`. Empty unless the server sent it. */
  byBrand: InventoryBrandSales[];
  /** Per store, most money first; empty unless the server sent it. */
  byStore: InventoryStoreSales[];
  /** Of the revenue: taken at the counter (v4). The whole revenue from a server without the field. */
  paidNowCents: number;
  /** Of the revenue: put on credit (v4); 0 from a server without the field. */
  creditCents: number;
  /** Still owed today on the period's credit sales. */
  creditOutstandingCents: number;
};

/** Most money first; equal money by name, so the order never jitters between answers. */
function byMoneyThenName<T extends { revenueCents: number; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name));
}

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
      brand: text(b.brand, MAX_BRAND),
      quantity: nonNegativeInt(b.quantity),
      revenueCents: signedInt(b.revenueCents),
    })),
    low: list(r.low).map((b) => ({
      itemId: text(b.itemId),
      name: text(b.name, MAX_NAME),
      brand: text(b.brand, MAX_BRAND),
      quantity: nonNegativeInt(b.quantity),
      lowStockAt: b.lowStockAt === null || b.lowStockAt === undefined || b.lowStockAt === "" ? null : nonNegativeInt(b.lowStockAt),
      storeId: text(b.storeId),
      storeName: text(b.storeName ?? b.store, MAX_STORE_NAME),
    })),
    countWasOff: list(r.countWasOff).map((b) => ({ itemId: text(b.itemId), name: text(b.name, MAX_NAME), brand: text(b.brand, MAX_BRAND) })),
    byCategory: byMoneyThenName(list(r.byCategory).map((c) => ({
      categoryId: text(c.categoryId),
      name: text(c.name, MAX_CATEGORY),
      itemsSold: nonNegativeInt(c.itemsSold),
      revenueCents: signedInt(c.revenueCents),
      profitCents: signedInt(c.profitCents),
    }))),
    byBrand: byMoneyThenName(list(r.byBrand).map((c) => ({
      brandId: text(c.brandId),
      name: text(c.name, MAX_BRAND),
      itemsSold: nonNegativeInt(c.itemsSold),
      revenueCents: signedInt(c.revenueCents),
      profitCents: signedInt(c.profitCents),
    }))),
    paidNowCents: r.paidNowCents === undefined || r.paidNowCents === null
      ? Math.max(0, signedInt(r.revenueCents) - nonNegativeInt(r.creditCents))
      : nonNegativeInt(r.paidNowCents),
    creditCents: nonNegativeInt(r.creditCents),
    creditOutstandingCents: nonNegativeInt(r.creditOutstandingCents),
    byStore: byMoneyThenName(list(r.byStore).map((s) => ({
      storeId: text(s.storeId),
      name: text(s.name, MAX_STORE_NAME),
      salesCount: nonNegativeInt(s.salesCount),
      itemsSold: nonNegativeInt(s.itemsSold),
      revenueCents: signedInt(s.revenueCents),
      profitCents: signedInt(s.profitCents),
    }))),
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

// ===========================================================================
// v2: categories and stores (docs/INVENTORY.md, "Categories and stores (v2)").
//
// Everything below is optional on top of the v1 pieces above: a single-store
// business with no categories reads, validates and sends exactly what it did.
// ===========================================================================

// ---------------------------------------------------------------------------
// Categories: one list per business, shared by every store.
// ---------------------------------------------------------------------------

export type InventoryCategory = {
  id: string;
  name: string;
  /** Lowercased trimmed name: what "already used" is decided on. */
  nameKey: string;
  archived: boolean;
};

/** The server's `nameKey`: the trimmed name, lowercased. */
export function categoryKey(name: unknown): string {
  return text(name, MAX_CATEGORY * 4).toLowerCase();
}

export function inventoryCategoryFromRow(row: unknown): InventoryCategory {
  const r = asRow(row);
  const name = text(r.name, MAX_CATEGORY);
  return { id: text(r.id), name, nameKey: text(r.nameKey, MAX_CATEGORY * 4) || categoryKey(name), archived: r.archived === true };
}

/** The business's categories by name; archived ones only when asked for. */
export function inventoryCategories(rows: readonly unknown[], includeArchived = false): InventoryCategory[] {
  return (Array.isArray(rows) ? rows : [])
    .map(inventoryCategoryFromRow)
    .filter((category) => category.id && category.name && (includeArchived || !category.archived))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** "Everything" is "", a product with no category is this, anything else is a category's id. */
export const UNCATEGORIZED_FILTER = "__none__";

export type CategoryResolver = (item: Pick<InventoryItem, "categoryId" | "category">) => InventoryCategory | null;

/**
 * Which category of the list a product belongs to: by its id, else (a legacy
 * product whose typed category the server has not converted yet) by name.
 * Built once per list, then read per product.
 */
export function categoryResolver(categories: readonly InventoryCategory[]): CategoryResolver {
  const byId = new Map<string, InventoryCategory>();
  const byKey = new Map<string, InventoryCategory>();
  for (const category of categories) {
    byId.set(category.id, category);
    // Archived categories keep their products; an active one wins a name both share.
    if (!byKey.has(category.nameKey) || !category.archived) byKey.set(category.nameKey, category);
  }
  return (item) => {
    const byItsId = item.categoryId ? byId.get(item.categoryId) : undefined;
    if (byItsId) return byItsId;
    const key = categoryKey(item.category);
    return key ? byKey.get(key) ?? null : null;
  };
}

export function categoryForItem(item: Pick<InventoryItem, "categoryId" | "category">, categories: readonly InventoryCategory[]): InventoryCategory | null {
  return categoryResolver(categories)(item);
}

/** The name a product shows: its category's current name (so a rename shows at once), else the snapshot it was saved with. */
export function itemCategoryName(item: Pick<InventoryItem, "categoryId" | "category">, categories: readonly InventoryCategory[]): string {
  return categoryForItem(item, categories)?.name ?? text(item.category, MAX_CATEGORY);
}

/** Whether a product is under the category filter ("" = any, UNCATEGORIZED_FILTER = none, else an id). */
export function itemInCategory(
  item: Pick<InventoryItem, "categoryId" | "category">,
  categories: readonly InventoryCategory[] | CategoryResolver,
  filter: string,
): boolean {
  if (!filter) return true;
  const match = (typeof categories === "function" ? categories : categoryResolver(categories))(item);
  if (filter === UNCATEGORIZED_FILTER) return match === null && !text(item.category) && !text(item.categoryId);
  return match?.id === filter;
}

/** The choices of a category dropdown: the active categories, plus the product's own when it is archived. */
export function categoryOptions(categories: readonly InventoryCategory[], selectedId = ""): InventoryCategory[] {
  return categories
    .filter((category) => !category.archived || category.id === selectedId)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Every problem with a category's name; `exceptId` is the one being renamed. */
export function validateCategoryName(name: unknown, categories: readonly InventoryCategory[], exceptId = ""): InventoryRefusal[] {
  const value = text(name, MAX_CATEGORY + 1);
  if (!value) return ["category_name_required"];
  if (value.length > MAX_CATEGORY) return ["category_too_long"];
  const key = categoryKey(value);
  return categories.some((category) => category.id !== exceptId && category.nameKey === key) ? ["category_name_taken"] : [];
}

export function createInventoryCategoryRequest(businessId: string, name: unknown) {
  return { businessId: text(businessId), name: text(name, MAX_CATEGORY) };
}

export function renameInventoryCategoryRequest(businessId: string, categoryId: string, name: unknown) {
  return { businessId: text(businessId), categoryId: text(categoryId), name: text(name, MAX_CATEGORY) };
}

export function archiveInventoryCategoryRequest(businessId: string, categoryId: string, archived: boolean) {
  return { businessId: text(businessId), categoryId: text(categoryId), archived: archived === true };
}

/** The new category's id out of `createInventoryCategory`'s answer, "" when it gave none. */
export function readCreatedCategoryId(data: unknown): string {
  return text(asRow(data).categoryId);
}

// ---------------------------------------------------------------------------
// Stores. A business with zero or one active store is "single store": nothing
// about stores shows. With two or more, stock is counted per store.
// ---------------------------------------------------------------------------

export type InventoryStore = {
  id: string;
  name: string;
  address: string;
  phone: string;
  archived: boolean;
  /** The store made when the business first added a second one: it holds the whole count of any product not yet counted per store. */
  isMain: boolean;
  createdAt: unknown;
};

export function inventoryStoreFromRow(row: unknown): InventoryStore {
  const r = asRow(row);
  return {
    id: text(r.id),
    name: text(r.name, MAX_STORE_NAME),
    address: text(r.address, MAX_STORE_ADDRESS),
    phone: text(r.phone, MAX_STORE_PHONE),
    archived: r.archived === true,
    isMain: r.isMain === true,
    createdAt: r.createdAt ?? null,
  };
}

/** Oldest first (the Main store comes first), then by name. */
function compareStores(a: InventoryStore, b: InventoryStore): number {
  return millis(a.createdAt) - millis(b.createdAt) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** The business's stores, archived ones only when asked for. */
export function inventoryStores(rows: readonly unknown[], includeArchived = false): InventoryStore[] {
  return (Array.isArray(rows) ? rows : [])
    .map(inventoryStoreFromRow)
    .filter((store) => store.id && (includeArchived || !store.archived))
    .sort(compareStores);
}

/** Two or more active stores: stock is per store and the store pickers, columns and filters appear. */
export function isMultiStore(stores: readonly Pick<InventoryStore, "archived">[]): boolean {
  return stores.filter((store) => !store.archived).length >= 2;
}

export function storeNameIndex(stores: readonly InventoryStore[]): Map<string, string> {
  return new Map(stores.map((store) => [store.id, store.name]));
}

/**
 * The store a record from before the business had stores belongs to: the
 * Main store, the oldest one. "" when there are no stores.
 */
export function legacyStoreId(stores: readonly InventoryStore[]): string {
  return [...stores].sort(compareStores)[0]?.id ?? "";
}

export type StoreDraft = { name: string; address: string; phone: string };

export const emptyStoreDraft: StoreDraft = { name: "", address: "", phone: "" };

export function storeDraftFromStore(store: InventoryStore): StoreDraft {
  return { name: store.name, address: store.address, phone: store.phone };
}

export function validateStoreDraft(draft: StoreDraft): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  const name = text(draft.name, MAX_STORE_NAME + 1);
  if (!name) errors.push("store_name_required");
  else if (name.length > MAX_STORE_NAME) errors.push("store_name_too_long");
  if (text(draft.address, MAX_STORE_ADDRESS + 1).length > MAX_STORE_ADDRESS || text(draft.phone, MAX_STORE_PHONE + 1).length > MAX_STORE_PHONE) {
    errors.push("store_detail_too_long");
  }
  return errors;
}

/** The `createInventoryStore` request; a blank address or phone is left out. */
export function createInventoryStoreRequest(businessId: string, draft: StoreDraft) {
  const address = text(draft.address, MAX_STORE_ADDRESS);
  const phone = text(draft.phone, MAX_STORE_PHONE);
  return {
    businessId: text(businessId),
    name: text(draft.name, MAX_STORE_NAME),
    ...(address ? { address } : {}),
    ...(phone ? { phone } : {}),
  };
}

/** What an edit changes; the three fields are compared as trimmed text. */
export function storeDraftChanges(store: InventoryStore, draft: StoreDraft): Partial<StoreDraft> {
  const changes: Partial<StoreDraft> = {};
  if (text(draft.name, MAX_STORE_NAME) !== store.name) changes.name = text(draft.name, MAX_STORE_NAME);
  if (text(draft.address, MAX_STORE_ADDRESS) !== store.address) changes.address = text(draft.address, MAX_STORE_ADDRESS);
  if (text(draft.phone, MAX_STORE_PHONE) !== store.phone) changes.phone = text(draft.phone, MAX_STORE_PHONE);
  return changes;
}

/** The `updateInventoryStore` request: only what changed (a cleared address or phone is ""). */
export function updateInventoryStoreRequest(businessId: string, store: InventoryStore, draft: StoreDraft) {
  return { businessId: text(businessId), storeId: store.id, ...storeDraftChanges(store, draft) };
}

export function archiveInventoryStoreRequest(businessId: string, storeId: string, archived: boolean) {
  return { businessId: text(businessId), storeId: text(storeId), archived: archived === true };
}

/** The new store's id out of `createInventoryStore`'s answer. */
export function readCreatedStoreId(data: unknown): string {
  return text(asRow(data).storeId);
}

// ---------------------------------------------------------------------------
// Who may see and do what across stores.
// ---------------------------------------------------------------------------

export type InventoryViewer = {
  /** The business owner: every store, and the only one who manages stores. */
  isOwner: boolean;
  /** Staff: the store they work in ("" until the owner assigns one). */
  homeStoreId: string;
  /** Staff the owner let work in every store. */
  allStores: boolean;
};

/** The signed-in person's store access, from their profile (`users/{uid}`). */
export function inventoryViewerFromProfile(profile: Row | null | undefined): InventoryViewer {
  return {
    isOwner: profile?.role === "businessOwner",
    homeStoreId: text(profile?.inventoryHomeStoreId),
    allStores: profile?.inventoryAllStores === true,
  };
}

export type StoreAccess = {
  /** Two or more active stores. */
  multi: boolean;
  /** The active stores, oldest first. */
  stores: InventoryStore[];
  /** Owner or all-stores staff: sees every store and may pick one as a filter. */
  canSeeAll: boolean;
  /** Staff without all-stores: their one store ("" for a viewer who sees all, or has no valid home store). */
  scopedStoreId: string;
  /** Multi-store staff with no (valid) home store: nothing to show until the owner assigns one. */
  needsHomeStore: boolean;
  /** The owner and all-stores staff move stock between stores. */
  canTransfer: boolean;
  /**
   * Only the owner. Offered even while there is a single store: it is how a
   * second store is added, which is what turns multi-store mode on.
   */
  canManageStores: boolean;
  /** The store a dialog starts on: the person's own, else the first. */
  defaultStoreId: string;
};

export function resolveStoreAccess(viewer: InventoryViewer, storeRows: readonly unknown[]): StoreAccess {
  const stores = inventoryStores(storeRows);
  const multi = stores.length >= 2;
  const canSeeAll = !multi || viewer.isOwner || viewer.allStores;
  const homeValid = stores.some((store) => store.id === viewer.homeStoreId);
  const scopedStoreId = multi && !canSeeAll && homeValid ? viewer.homeStoreId : "";
  return {
    multi,
    stores,
    canSeeAll,
    scopedStoreId,
    needsHomeStore: multi && !canSeeAll && !homeValid,
    canTransfer: multi && canSeeAll,
    canManageStores: viewer.isOwner,
    defaultStoreId: scopedStoreId || (homeValid ? viewer.homeStoreId : stores[0]?.id ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Stock per store: `inventoryStock/{itemId}__{storeId}`.
// ---------------------------------------------------------------------------

export type InventoryStockRow = {
  itemId: string;
  storeId: string;
  quantity: number;
  countWasOff: boolean;
};

export function inventoryStockRowFromRow(row: unknown): InventoryStockRow {
  const r = asRow(row);
  let itemId = text(r.itemId);
  let storeId = text(r.storeId);
  const id = text(r.id, 420);
  if ((!itemId || !storeId) && id.includes("__")) {
    const at = id.indexOf("__");
    itemId = itemId || id.slice(0, at);
    storeId = storeId || id.slice(at + 2);
  }
  return { itemId, storeId, quantity: nonNegativeInt(r.quantity), countWasOff: r.countWasOff === true };
}

/** itemId -> storeId -> row. Built once per read, then looked up per product. */
export type StockIndex = Map<string, Map<string, InventoryStockRow>>;

export function buildStockIndex(rows: readonly unknown[]): StockIndex {
  const index: StockIndex = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = inventoryStockRowFromRow(raw);
    if (!row.itemId || !row.storeId) continue;
    let byStore = index.get(row.itemId);
    if (!byStore) {
      byStore = new Map();
      index.set(row.itemId, byStore);
    }
    byStore.set(row.storeId, row);
  }
  return index;
}

/** What one store holds of a product: 0 when it never had any. */
export function stockCountFor(index: StockIndex | undefined, itemId: string, storeId: string): number {
  return index?.get(itemId)?.get(storeId)?.quantity ?? 0;
}

/** What the products list is scoped to; left empty it is the single-store list. */
export type InventoryListScope = {
  categories?: readonly InventoryCategory[];
  /** "" = every category, UNCATEGORIZED_FILTER, or a category id. */
  categoryId?: string;
  /** v3: the business's brands (a rename shows at once, and the search reads them). */
  brands?: readonly InventoryBrand[];
  /** "" = every brand, NO_BRAND_FILTER, or a brand id. */
  brandId?: string;
  /** The active stores; two or more switch the list to per-store stock. */
  stores?: readonly InventoryStore[];
  /** "" = all stores. */
  storeId?: string;
  stock?: StockIndex;
};

export type StoreStockCell = {
  storeId: string;
  storeName: string;
  quantity: number;
  /** A count was ever recorded for this product in this store. A store it never held shows 0 and is not "low". */
  stocked: boolean;
  low: boolean;
  countWasOff: boolean;
};

export type ItemStockView = {
  /** Per-store stock applies (two or more active stores). */
  multi: boolean;
  /** The product's total across stores (its own `quantity`). */
  total: number;
  /** One cell per store in scope, oldest store first. */
  cells: StoreStockCell[];
  /** The count the row leads with: the chosen store's, else the total. */
  shown: number;
  status: InventoryStatus;
  /** Low or out of stock, in the scope looked at. */
  low: boolean;
  /** The names of the stores it is low in (several when looking at all stores). */
  lowStoreNames: string[];
  countWasOff: boolean;
};

/**
 * Where a product stands. Single-store: its own total, exactly as before.
 * Multi-store: the low-stock number applies per store (a store's count at or
 * below it, or zero, is low for that store), and a row can name the stores.
 *
 * DECISION: a store that never had a count for the product (no stock row)
 * reads 0 but is not flagged low - otherwise adding a second store would flag
 * every product as low there at once. Zero after a count was recorded is low,
 * as the contract says.
 */
export function itemStockView(item: InventoryItem, scope: Pick<InventoryListScope, "stores" | "storeId" | "stock"> = {}): ItemStockView {
  const stores = scope.stores ?? [];
  if (stores.length < 2) {
    return {
      multi: false,
      total: item.quantity,
      cells: [],
      shown: item.quantity,
      status: inventoryStatus(item),
      low: inventoryIsLow(item),
      lowStoreNames: [],
      countWasOff: item.countWasOff,
    };
  }
  const only = scope.storeId ? stores.filter((store) => store.id === scope.storeId) : stores;
  const cells: StoreStockCell[] = only.map((store) => {
    const row = scope.stock?.get(item.id)?.get(store.id);
    // A product the server has not yet counted per store sits whole at the
    // Main store (docs/INVENTORY.md, stock rows); it is not flagged low there.
    const implied = row === undefined && store.isMain && !item.storeStock;
    const quantity = row?.quantity ?? (implied ? item.quantity : 0);
    const stocked = row !== undefined;
    const belowLimit = item.lowStockAt !== null && quantity <= item.lowStockAt;
    return {
      storeId: store.id,
      storeName: store.name,
      quantity,
      stocked,
      low: !item.archived && stocked && (quantity <= 0 || belowLimit),
      countWasOff: row?.countWasOff === true || (implied && item.countWasOff),
    };
  });
  const lowCells = cells.filter((cell) => cell.low);
  const single = scope.storeId ? cells[0] : undefined;
  let status: InventoryStatus;
  if (item.archived) status = "archived";
  else if (single) status = !single.stocked ? "ok" : single.quantity <= 0 ? "out" : single.low ? "low" : "ok";
  else status = item.quantity <= 0 ? "out" : lowCells.length > 0 ? "low" : "ok";
  return {
    multi: true,
    total: item.quantity,
    cells,
    shown: single ? single.quantity : item.quantity,
    status,
    low: status === "low" || status === "out",
    lowStoreNames: lowCells.map((cell) => cell.storeName),
    countWasOff: single ? single.countWasOff : item.countWasOff || cells.some((cell) => cell.countWasOff),
  };
}

// ---------------------------------------------------------------------------
// Moving stock between stores.
// ---------------------------------------------------------------------------

export type TransferDraft = {
  itemId: string;
  fromStoreId: string;
  toStoreId: string;
  quantity: string;
  note: string;
};

export const emptyTransferDraft: TransferDraft = { itemId: "", fromStoreId: "", toStoreId: "", quantity: "", note: "" };

/**
 * Every problem with a transfer. `available` is what the source store holds
 * when that is known (null = unknown, the server decides): asking for more is
 * `insufficient_stock` before the round trip.
 */
export function validateTransferDraft(draft: TransferDraft, available: number | null = null): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  if (!text(draft.itemId)) errors.push("transfer_item_required");
  const from = text(draft.fromStoreId);
  const to = text(draft.toStoreId);
  if (!from || !to) errors.push("transfer_store_required");
  else if (from === to) errors.push("same_store");
  const n = readWholeNumber(draft.quantity, 1);
  if (n === null || Number.isNaN(n)) errors.push("transfer_quantity_invalid");
  else if (available !== null && n > available) errors.push("insufficient_stock");
  if (text(draft.note, MAX_NOTE + 1).length > MAX_NOTE) errors.push("note_too_long");
  return errors;
}

/** The `transferInventoryStock` request. */
export function transferInventoryStockRequest(businessId: string, draft: TransferDraft) {
  const note = text(draft.note, MAX_NOTE);
  return {
    businessId: text(businessId),
    itemId: text(draft.itemId),
    fromStoreId: text(draft.fromStoreId),
    toStoreId: text(draft.toStoreId),
    quantity: readWholeNumber(draft.quantity, 1) ?? 0,
    ...(note ? { note } : {}),
  };
}

/** Both counts after a transfer; null while the quantity is unusable. The total never changes. */
export function transferAfter(fromCount: number, toCount: number, quantity: unknown): { from: number; to: number } | null {
  const n = readWholeNumber(quantity, 1);
  if (n === null || Number.isNaN(n) || n > fromCount) return null;
  return { from: fromCount - n, to: toCount + n };
}

// ---------------------------------------------------------------------------
// Staff store access (the owner's People controls).
// ---------------------------------------------------------------------------

export type StaffStoreAccess = { homeStoreId: string; allStores: boolean };

/** What a team member's record says: their home store and whether they work in all stores. */
export function inventoryStaffAccessFromRow(row: Row | null | undefined): StaffStoreAccess {
  return { homeStoreId: text(row?.inventoryHomeStoreId), allStores: row?.inventoryAllStores === true };
}

/** A person who does not work in all stores needs a home store, or they cannot sell. */
export function validateStaffAccess(access: StaffStoreAccess, stores: readonly InventoryStore[]): InventoryRefusal[] {
  if (access.allStores) return [];
  return stores.some((store) => store.id === access.homeStoreId && !store.archived) ? [] : ["staff_store_required"];
}

export function staffAccessChanged(row: Row | null | undefined, next: StaffStoreAccess): boolean {
  const before = inventoryStaffAccessFromRow(row);
  return before.homeStoreId !== text(next.homeStoreId) || before.allStores !== (next.allStores === true);
}

/** The `setInventoryStaffAccess` request (owner only). */
export function setInventoryStaffAccessRequest(businessId: string, userId: string, access: StaffStoreAccess) {
  return {
    businessId: text(businessId),
    userId: text(userId),
    homeStoreId: text(access.homeStoreId),
    allStores: access.allStores === true,
  };
}

/** Whether a team member holds the Inventory permission (a staff record without a list holds them all). */
export function staffHasInventoryPermission(row: Row | null | undefined): boolean {
  const list = row?.businessPermissions;
  return Array.isArray(list) ? list.some((permission) => String(permission) === "inventory") : true;
}

// ---------------------------------------------------------------------------
// Sales by store.
// ---------------------------------------------------------------------------

/** The store a sale counts under: its own, else - a sale from before stores - the Main store. */
export function saleStoreId(sale: Pick<InventorySale, "storeId">, stores: readonly InventoryStore[]): string {
  return sale.storeId || legacyStoreId(stores);
}

/** The sales of one store ("" = all of them). The list is a page at a time: this narrows what is loaded. */
export function salesInStore(sales: readonly InventorySale[], storeId: string, stores: readonly InventoryStore[]): InventorySale[] {
  if (!storeId) return [...sales];
  const main = legacyStoreId(stores);
  return sales.filter((sale) => (sale.storeId || main) === storeId);
}

/**
 * A sale a notification asked to open. `key` is new on every click, so the
 * same alert tapped twice is a fresh request (the person may have moved on).
 */
export type SaleFocus = { saleId: string; storeId: string; key: number };

/** The focus a sale alert asks for; none without a sale id. */
export function saleFocusFrom(saleId: unknown, storeId: unknown, key: number): SaleFocus | null {
  const id = text(saleId);
  if (!id) return null;
  return { saleId: id, storeId: text(storeId), key };
}

/**
 * The store filter a sale alert applies: its store, but only for whoever sees
 * every store of a multi-store business and only when that store exists.
 * Staff of one store (and single-store businesses) keep the view they have.
 */
export function saleFocusStoreFilter(focus: Pick<SaleFocus, "storeId"> | null, access: StoreAccess): string {
  if (!focus || !focus.storeId) return "";
  if (!access.multi || !access.canSeeAll) return "";
  return access.stores.some((store) => store.id === focus.storeId) ? focus.storeId : "";
}

/**
 * Whether a sale opened by id may be shown to this viewer: the same reach as
 * the sales list and the rules. Another business's sale never; staff tied to
 * one store of a multi-store business, only that store's sales; staff with no
 * store yet, nothing.
 */
export function saleVisibleToViewer(row: unknown, businessId: string, access: StoreAccess): boolean {
  const r = asRow(row);
  if (!businessId || text(r.businessId) !== businessId) return false;
  if (access.needsHomeStore) return false;
  return !access.scopedStoreId || text(r.storeId) === access.scopedStoreId;
}

// ---------------------------------------------------------------------------
// v2 sentences with names or numbers in them, built per language.
// ---------------------------------------------------------------------------

/** "2 stores" / "2 magasins". */
export function storeCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "magasin" : "magasins"}`;
  return `${count} ${count === 1 ? "store" : "stores"}`;
}

/** "Low in Main store, Downtown" / "Bas dans Main store, Downtown". */
export function lowInStoresText(names: readonly string[], lang: Lang = "en"): string {
  return `${lang === "fr" ? "Bas dans" : "Low in"} ${names.join(", ")}`;
}

/** "5 available in Downtown" / "5 disponibles dans Downtown". */
export function availableInStoreText(count: number, storeName: string, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "disponible" : "disponibles"} dans ${storeName}`;
  return `${count} available in ${storeName}`;
}

/** "Anna (archived)" / "Anna (archivé)"; categories are feminine in French. */
export function archivedNameText(name: string, lang: Lang = "en", feminine = false): string {
  if (lang === "fr") return `${name} (${feminine ? "archivée" : "archivé"})`;
  return `${name} (archived)`;
}

/** "Main store 5 → 2": a store's count before and after a move. */
export function countChangeText(name: string, before: number, after: number): string {
  return `${name} ${before} → ${after}`;
}

/** "3 categories" / "3 catégories". */
export function categoryCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "catégorie" : "catégories"}`;
  return `${count} ${count === 1 ? "category" : "categories"}`;
}


// ===========================================================================
// v3: brands and quick entry (docs/INVENTORY.md, "Brands and quick entry (v3)").
//
// Brands mirror categories: one managed list per business, shared by every
// store, optional on a product. A product without a brand reads, validates and
// sends exactly what it did in v2.
// ===========================================================================

export type InventoryBrand = {
  id: string;
  name: string;
  /** Lowercased, spaces collapsed: what makes two names the same brand. */
  nameKey: string;
  archived: boolean;
};

export function brandKey(name: unknown): string {
  return text(name, MAX_BRAND * 4).toLowerCase();
}

export function inventoryBrandFromRow(row: unknown): InventoryBrand {
  const r = asRow(row);
  const name = text(r.name, MAX_BRAND);
  return { id: text(r.id), name, nameKey: text(r.nameKey, MAX_BRAND * 4) || brandKey(name), archived: r.archived === true };
}

/** The business's brands by name; archived ones only when asked for. */
export function inventoryBrands(rows: readonly unknown[], includeArchived = false): InventoryBrand[] {
  return (Array.isArray(rows) ? rows : [])
    .map(inventoryBrandFromRow)
    .filter((brand) => brand.id && brand.name && (includeArchived || !brand.archived))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "Everything" is "", a product with no brand is this, anything else is a brand's id. */
export const NO_BRAND_FILTER = "__none__";

export type BrandResolver = (item: Pick<InventoryItem, "brandId" | "brand">) => InventoryBrand | null;

/**
 * Which brand of the list a product belongs to: by its id, else (a brand that
 * was typed and is not in the list we hold) by name. Built once for a whole list.
 */
export function brandResolver(brands: readonly InventoryBrand[]): BrandResolver {
  const byId = new Map<string, InventoryBrand>();
  const byKey = new Map<string, InventoryBrand>();
  for (const brand of brands) {
    byId.set(brand.id, brand);
    if (!byKey.has(brand.nameKey) || !brand.archived) byKey.set(brand.nameKey, brand);
  }
  return (item) => {
    const byItsId = item.brandId ? byId.get(item.brandId) : undefined;
    if (byItsId) return byItsId;
    const key = brandKey(item.brand);
    return key ? byKey.get(key) ?? null : null;
  };
}

export function brandForItem(item: Pick<InventoryItem, "brandId" | "brand">, brands: readonly InventoryBrand[]): InventoryBrand | null {
  return brandResolver(brands)(item);
}

/** The product with its brand's CURRENT name (so a rename shows at once); unchanged when the brand is not in the list. */
export function withCurrentBrand<T extends Pick<InventoryItem, "brandId" | "brand">>(item: T, resolve: BrandResolver): T {
  const match = resolve(item);
  return match && match.name !== item.brand ? { ...item, brand: match.name } : item;
}

/** Whether a product is under the brand filter ("" = any, NO_BRAND_FILTER = none, else an id). */
export function itemInBrand(
  item: Pick<InventoryItem, "brandId" | "brand">,
  brands: readonly InventoryBrand[] | BrandResolver,
  filter: string,
): boolean {
  if (!filter) return true;
  const match = (typeof brands === "function" ? brands : brandResolver(brands))(item);
  if (filter === NO_BRAND_FILTER) return match === null && !text(item.brand) && !text(item.brandId);
  return match !== null && match.id === filter;
}

/** The choices of a brand dropdown: the active brands, plus the product's own when it is archived. */
export function brandOptions(brands: readonly InventoryBrand[], selectedId = ""): InventoryBrand[] {
  return brands
    .filter((brand) => !brand.archived || brand.id === selectedId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every problem with a brand's name; `exceptId` is the one being renamed. */
export function validateBrandName(name: unknown, brands: readonly InventoryBrand[], exceptId = ""): InventoryRefusal[] {
  const value = text(name, MAX_BRAND + 1);
  if (!value) return ["brand_name_required"];
  if (value.length > MAX_BRAND) return ["brand_too_long"];
  const key = brandKey(value);
  return brands.some((brand) => brand.id !== exceptId && brand.nameKey === key) ? ["brand_name_taken"] : [];
}

export function createInventoryBrandRequest(businessId: string, name: unknown) {
  return { businessId: text(businessId), name: text(name, MAX_BRAND) };
}

export function renameInventoryBrandRequest(businessId: string, brandId: string, name: unknown) {
  return { businessId: text(businessId), brandId: text(brandId), name: text(name, MAX_BRAND) };
}

export function archiveInventoryBrandRequest(businessId: string, brandId: string, archived: boolean) {
  return { businessId: text(businessId), brandId: text(brandId), archived: archived === true };
}

/** The new brand's id out of `createInventoryBrand`'s answer, "" when it gave none. */
export function readCreatedBrandId(data: unknown): string {
  return text(asRow(data).brandId);
}

/** "3 brands" / "3 marques". */
export function brandCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "marque" : "marques"}`;
  return `${count} ${count === 1 ? "brand" : "brands"}`;
}

/** "Saved Jordan 11. Add the next one." / "Jordan 11 enregistré. Ajoutez le suivant.": what quick entry says after each save. */
export function savedNextText(name: string, lang: Lang = "en"): string {
  if (lang === "fr") return `${name} enregistré. Ajoutez le suivant.`;
  return `Saved ${name}. Add the next one.`;
}

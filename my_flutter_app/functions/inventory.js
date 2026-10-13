"use strict";

/**
 * The inventory service: products a shop sells, the QR tag on each, and the
 * sales staff ring up at the counter. The rules are in docs/INVENTORY.md; this
 * file is the pure half of them (no Firestore, no clock unless one is passed),
 * so every rule is unit-tested and the callables in `index.js` only read and
 * write around it.
 *
 * Money is integer US cents, capped like invoice_ledger.js (MAX_CENTS), and the
 * payment methods are the ones invoices use. A sale is its own record, NOT an
 * invoice: Laawol never charges the customer, it records what the shop took at
 * the counter.
 *
 * Stock is never negative. Selling more than the count says is allowed (the
 * count was wrong, the goods are in the customer's hand): the quantity floors
 * at 0 and the line and the product are flagged `countWasOff` until someone
 * sets the count again.
 */

const crypto = require("node:crypto");
const {INVOICE_PAYMENT_METHODS, MAX_CENTS} = require("./invoice_ledger");
const {recipientLanguage} = require("./notification_settings");

const INVENTORY_PAYMENT_METHODS = INVOICE_PAYMENT_METHODS;

const MAX_NAME = 120;
const MAX_CATEGORY = 60;
const MAX_BRAND = 60;
const MAX_PHOTO_URL = 1000;
const MAX_NOTE = 200;
const MAX_REASON = 300;
/** Most pieces one product can hold, or one line can sell, at once. */
const MAX_QUANTITY = 1000000;
const MAX_SALE_LINES = 50;
const MIN_COPIES = 1;
const MAX_COPIES = 500;
const TAG_CODE_PREFIX = "IT";

const MAX_ADDRESS = 200;
const MAX_PHONE = 40;
/** The name the implicit first store gets when the owner adds a second one. */
const MAIN_STORE_NAME = "Main store";
const UNCATEGORIZED = "Uncategorized";
const NO_BRAND = "No brand";

const MOVEMENT_TYPES = Object.freeze(
    ["initial", "add", "set", "sale", "void", "transfer_out", "transfer_in"]);
const SUMMARY_RANGES = Object.freeze(["today", "month"]);

/** How many products the "best sellers" list names. */
const BEST_SELLERS = 5;
/** The summary lists never carry more than this many products each. */
const SUMMARY_LIST_CAP = 100;

/**
 * Every refusal's text. The callables answer with `details.reason` = the code
 * and this message; the clients translate by code.
 */
const INVENTORY_MESSAGES = Object.freeze({
  business_not_found: "This business was not found.",
  service_disabled: "The inventory service is not switched on for this " +
    "business.",
  item_not_found: "That product was not found.",
  item_archived: "That product is archived, so it cannot be sold. " +
    "Restore it first.",
  sale_not_found: "That sale was not found.",
  sale_voided: "That sale was already voided.",
  name_required: "Give the product a name.",
  name_too_long: `A product name can be at most ${MAX_NAME} characters.`,
  price_invalid: "The price must be a whole number of cents, above zero " +
    "for a product and not below zero for a sale line.",
  cost_invalid: "The cost must be a whole number of cents, or empty.",
  quantity_invalid: "The quantity must be a whole number " +
    `(at most ${MAX_QUANTITY}), above zero when adding or selling.`,
  low_stock_invalid: "The low-stock level must be a whole number of " +
    "pieces, or empty.",
  category_too_long: `A category can be at most ${MAX_CATEGORY} characters.`,
  photo_url_invalid: "The photo link must be an https address.",
  nothing_to_update: "Nothing to change: no field was sent.",
  quantity_not_editable: "The count is changed with the stock actions " +
    "(add or set), not by editing the product.",
  mode_invalid: "Stock can be added (add) or corrected (set).",
  archived_invalid: "Say whether to archive (true) or restore (false).",
  confirm_required: "Deleting a product cannot be undone. Confirm to go on.",
  payment_method_invalid: "Pick how the shop was paid: " +
    `${INVOICE_PAYMENT_METHODS.join(", ")}.`,
  lines_required: "Add at least one product to the sale.",
  lines_too_many: `A sale can have at most ${MAX_SALE_LINES} lines.`,
  total_too_large: "That sale adds up to more than the system accepts.",
  client_request_id_invalid: "The sale has no valid retry key.",
  copies_invalid: `Print between ${MIN_COPIES} and ${MAX_COPIES} tags.`,
  range_invalid: "The summary covers today or this month.",
  category_name_required: "Give the category a name.",
  category_name_taken: "A category with that name already exists.",
  category_not_found: "That category was not found.",
  brand_name_required: "Give the brand a name.",
  brand_name_taken: "A brand with that name already exists.",
  brand_not_found: "That brand was not found.",
  brand_too_long: `A brand can be at most ${MAX_BRAND} characters.`,
  store_name_required: "Give the store a name.",
  store_field_too_long: `A store address can be at most ${MAX_ADDRESS} ` +
    `characters and a phone number at most ${MAX_PHONE}.`,
  store_not_found: "That store was not found.",
  store_archived: "That store is archived. Restore it first.",
  store_has_stock: "That store still holds stock. Move it to another " +
    "store first.",
  last_store_active: "At least one store has to stay active.",
  store_not_allowed: "This account cannot use that store.",
  home_store_required: "This account has no store assigned yet. Ask the " +
    "owner to assign one.",
  same_store: "Pick two different stores.",
  insufficient_stock: "The source store does not hold that many pieces.",
  owner_only: "Only the business owner can do this.",
  user_not_found: "That staff member was not found in this business.",
  all_stores_invalid: "Say whether the staff member sees all stores " +
    "(true) or only their own (false).",
});

/** Codes answered as `not-found`; the rest of the state refusals below. */
const NOT_FOUND_CODES = Object.freeze(
    ["business_not_found", "item_not_found", "sale_not_found",
      "category_not_found", "brand_not_found", "store_not_found",
      "user_not_found"]);
const PRECONDITION_CODES = Object.freeze(
    ["service_disabled", "item_archived", "sale_voided", "store_archived",
      "store_has_stock", "last_store_active", "home_store_required",
      "insufficient_stock"]);
const PERMISSION_CODES = Object.freeze(["store_not_allowed", "owner_only"]);
const ALREADY_EXISTS_CODES = Object.freeze(
    ["category_name_taken", "brand_name_taken"]);

/**
 * @param {string} code A refusal code.
 * @return {"not-found"|"failed-precondition"|"invalid-argument"|
 *   "permission-denied"|"already-exists"} The HttpsError code that carries it.
 */
function refusalKind(code) {
  if (PERMISSION_CODES.includes(code)) return "permission-denied";
  if (ALREADY_EXISTS_CODES.includes(code)) return "already-exists";
  if (NOT_FOUND_CODES.includes(code)) return "not-found";
  if (PRECONDITION_CODES.includes(code)) return "failed-precondition";
  return "invalid-argument";
}

/**
 * @param {string|string[]} codes One or more refusal codes.
 * @return {string} Their messages, in order, joined for display.
 */
function inventoryMessage(codes) {
  return (Array.isArray(codes) ? codes : [codes])
      .map((code) => INVENTORY_MESSAGES[code] || String(code)).join(" ");
}

const text = (value, max) => String(value ?? "").trim().slice(0, max);

/**
 * Whether a field was sent at all. An empty field is "not given", which is a
 * state of its own, never the number zero.
 *
 * @param {*} value Raw input.
 * @return {boolean} True when there is something to judge.
 */
function given(value) {
  return value !== null && value !== undefined &&
    String(value).trim() !== "";
}

/**
 * @param {*} value Raw whole number (a number, or digits in a string).
 * @param {number} min Smallest allowed.
 * @param {number} max Largest allowed.
 * @return {number|null} The integer, or null when it is not one in range.
 */
function wholeNumber(value, min, max) {
  if (typeof value === "boolean" || !given(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// ---------------------------------------------------------------------------
// Products.
// ---------------------------------------------------------------------------

/**
 * @param {*} value A photo link.
 * @return {boolean} True for an empty string or an https address.
 */
function photoUrlOk(value) {
  const url = String(value ?? "").trim();
  if (!url) return true;
  if (url.length > MAX_PHOTO_URL) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch (_) {
    return false;
  }
}

/**
 * Errors for the fields of a product that were sent. `requireAll` is true on
 * create (name, price and count are needed) and false on update.
 *
 * @param {object} data The callable's data.
 * @param {boolean} requireAll Whether the required fields must be present.
 * @return {string[]} Refusal codes, deduplicated.
 */
function itemFieldErrors(data, requireAll) {
  const row = data && typeof data === "object" ? data : {};
  const errors = [];
  if (requireAll || row.name !== undefined) {
    const name = text(row.name, MAX_NAME + 1);
    if (!name) errors.push("name_required");
    else if (name.length > MAX_NAME) errors.push("name_too_long");
  }
  if (requireAll || row.priceCents !== undefined) {
    if (wholeNumber(row.priceCents, 1, MAX_CENTS) === null) {
      errors.push("price_invalid");
    }
  }
  if (given(row.costCents) &&
      wholeNumber(row.costCents, 0, MAX_CENTS) === null) {
    errors.push("cost_invalid");
  }
  if (given(row.lowStockAt) &&
      wholeNumber(row.lowStockAt, 0, MAX_QUANTITY) === null) {
    errors.push("low_stock_invalid");
  }
  if (String(row.category ?? "").trim().length > MAX_CATEGORY) {
    errors.push("category_too_long");
  }
  if (row.categoryId !== undefined && row.categoryId !== null &&
      typeof row.categoryId !== "string") {
    errors.push("category_not_found");
  }
  if (String(row.brand ?? "").trim().length > MAX_BRAND) {
    errors.push("brand_too_long");
  }
  if (row.brandId !== undefined && row.brandId !== null &&
      typeof row.brandId !== "string") {
    errors.push("brand_not_found");
  }
  if (!photoUrlOk(row.photoUrl)) errors.push("photo_url_invalid");
  return errors;
}

/** The most stores one product can be stocked in at creation. */
const MAX_STOCK_ENTRIES = 100;

/**
 * The per-store starting counts of a new product: {storeId: quantity}.
 *
 * @param {*} value The `stock` field.
 * @return {{errors: string[], entries: Array<[string, number]>}} The pairs
 *   (store id, count), or `quantity_invalid` when it is not a clean map.
 */
function parseStockMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {errors: ["quantity_invalid"], entries: []};
  }
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.length > MAX_STOCK_ENTRIES) {
    return {errors: ["quantity_invalid"], entries: []};
  }
  const entries = [];
  for (const key of keys) {
    const storeId = text(key, 200);
    const count = wholeNumber(value[key], 0, MAX_QUANTITY);
    if (!storeId || storeId.includes("/") || count === null) {
      return {errors: ["quantity_invalid"], entries: []};
    }
    entries.push([storeId, count]);
  }
  return {errors: [], entries};
}

/**
 * @param {object} data The createInventoryItem data.
 * @return {string[]} Refusal codes. A `stock` map stands in for `quantity`.
 */
function validateItemCreate(data) {
  const errors = itemFieldErrors(data, true);
  const hasStock = data?.stock !== undefined && data?.stock !== null;
  if (hasStock) {
    errors.push(...parseStockMap(data.stock).errors);
  } else if (wholeNumber(data?.quantity, 0, MAX_QUANTITY) === null) {
    errors.push("quantity_invalid");
  }
  return [...new Set(errors)];
}

/**
 * @param {object} data The updateInventoryItem data.
 * @return {string[]} Refusal codes. The count is never edited here.
 */
function validateItemUpdate(data) {
  const row = data && typeof data === "object" ? data : {};
  if (row.quantity !== undefined || row.stock !== undefined) {
    return ["quantity_not_editable"];
  }
  const fields = ["name", "priceCents", "costCents", "lowStockAt", "category",
    "categoryId", "brand", "brandId", "photoUrl"];
  if (!fields.some((key) => row[key] !== undefined)) {
    return ["nothing_to_update"];
  }
  return itemFieldErrors(row, false);
}

/**
 * The body of a new product (the caller adds the timestamps and, once
 * minted, `documentToken`).
 *
 * @param {object} data Validated createInventoryItem data.
 * @param {object} extra {businessId, code, uid, quantity?, category?, brand?}:
 *   `quantity` (the total, when it comes from a per-store map),
 *   `category` ({categoryId, name}) and `brand` ({brandId, name}), once
 *   resolved, replace the raw fields. A product made without a brand stores
 *   `brandId: ""` and `brand: ""`.
 * @return {object} The stored fields.
 */
function itemCreateRecord(data, {businessId, code, uid, quantity, category,
  brand}) {
  return {
    businessId,
    name: text(data.name, MAX_NAME),
    code,
    priceCents: Number(data.priceCents),
    costCents: given(data.costCents) ? Number(data.costCents) : null,
    quantity: quantity === undefined ? Number(data.quantity) :
      Number(quantity),
    lowStockAt: given(data.lowStockAt) ? Number(data.lowStockAt) : null,
    category: category ? text(category.name, MAX_CATEGORY) :
      text(data.category, MAX_CATEGORY),
    categoryId: category ? text(category.categoryId, 200) : "",
    brandId: brand ? text(brand.brandId, 200) : "",
    brand: brand ? text(brand.name, MAX_BRAND) : "",
    photoUrl: text(data.photoUrl, MAX_PHOTO_URL),
    archived: false,
    countWasOff: false,
    createdByStaffId: text(uid, 128),
    updatedByStaffId: text(uid, 128),
  };
}

/**
 * Only the fields an update sent, normalised. An empty cost or low-stock
 * level clears it (null); the count is never in here.
 *
 * @param {object} data Validated updateInventoryItem data.
 * @return {object} Fields to merge into the product.
 */
function itemUpdatePatch(data) {
  const patch = {};
  if (data.name !== undefined) patch.name = text(data.name, MAX_NAME);
  if (data.priceCents !== undefined) {
    patch.priceCents = Number(data.priceCents);
  }
  if (data.costCents !== undefined) {
    patch.costCents = given(data.costCents) ? Number(data.costCents) : null;
  }
  if (data.lowStockAt !== undefined) {
    patch.lowStockAt = given(data.lowStockAt) ?
      Number(data.lowStockAt) : null;
  }
  if (data.category !== undefined) {
    patch.category = text(data.category, MAX_CATEGORY);
  }
  if (data.photoUrl !== undefined) {
    patch.photoUrl = text(data.photoUrl, MAX_PHOTO_URL);
  }
  return patch;
}

const FIELD_LABELS = Object.freeze({
  name: {label: "Name"},
  priceCents: {label: "Price", money: true},
  costCents: {label: "Cost", money: true},
  lowStockAt: {label: "Low-stock level"},
  category: {label: "Category"},
  brand: {label: "Brand"},
  photoUrl: {label: "Photo"},
});

/**
 * @param {number|null|undefined} cents An amount.
 * @return {string} e.g. "$12.50".
 */
function moneyText(cents) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

/**
 * What an edit changed, as the history shows it.
 *
 * @param {object} before The stored product.
 * @param {object} patch The fields being written.
 * @return {object[]} [{field, from, to}] for fields that really differ.
 */
function itemFieldDiff(before, patch) {
  const changes = [];
  for (const [key, meta] of Object.entries(FIELD_LABELS)) {
    if (!(key in patch)) continue;
    const from = before?.[key];
    const to = patch[key];
    if (String(from ?? "") === String(to ?? "")) continue;
    const show = (v) => v === null || v === undefined || v === "" ?
      "—" : (meta.money ? moneyText(v) : String(v));
    changes.push({field: meta.label, from: show(from), to: show(to)});
  }
  return changes;
}

/**
 * Whether the product shows in the low-stock list: at or under its level, and
 * always when it is out.
 *
 * @param {object} item The product.
 * @return {boolean} True when it is low.
 */
function itemIsLow(item) {
  const quantity = Number(item?.quantity) || 0;
  if (quantity <= 0) return true;
  const level = item?.lowStockAt;
  return level !== null && level !== undefined &&
    Number.isFinite(Number(level)) && quantity <= Number(level);
}

// ---------------------------------------------------------------------------
// Stock.
// ---------------------------------------------------------------------------

/**
 * Judges a stock action against the product's current count.
 *
 * `add` puts a positive number on top; `set` corrects the count to a number
 * (zero allowed) and clears the "count was off" flag, because someone has now
 * counted. Never goes past MAX_QUANTITY.
 *
 * @param {object} item The stored product.
 * @param {object} input {mode: "add"|"set", quantity}.
 * @return {object} {errors, type, quantityAfter, delta, countWasOff}.
 */
function planStockAdjust(item, input) {
  const mode = text(input?.mode, 10);
  const before = Math.max(0, Math.round(Number(item?.quantity) || 0));
  if (mode !== "add" && mode !== "set") {
    return {errors: ["mode_invalid"]};
  }
  const amount = wholeNumber(input?.quantity, mode === "add" ? 1 : 0,
      MAX_QUANTITY);
  if (amount === null) return {errors: ["quantity_invalid"]};
  const quantityAfter = mode === "add" ? before + amount : amount;
  if (quantityAfter > MAX_QUANTITY) return {errors: ["quantity_invalid"]};
  return {
    errors: [],
    type: mode,
    quantityAfter,
    delta: quantityAfter - before,
    countWasOff: mode === "set" ? false : item?.countWasOff === true,
  };
}

/**
 * One row of a product's stock history.
 *
 * @param {object} args {businessId, itemId, type, delta, quantityAfter, uid,
 *   note, saleId, storeId, transferId}.
 * @return {object} The stored fields (the caller adds `createdAt`).
 */
function movementRecord({businessId, itemId, type, delta, quantityAfter, uid,
  note = "", saleId = "", storeId = "", transferId = ""}) {
  return {
    businessId,
    itemId,
    type,
    delta: Math.round(Number(delta) || 0) + 0,
    quantityAfter: Math.max(0, Math.round(Number(quantityAfter) || 0)),
    byStaffId: text(uid, 128),
    note: text(note, MAX_NOTE),
    saleId: text(saleId, 128),
    // Only a business with stores records where; a single-store business's
    // rows keep the shape they always had.
    ...(text(storeId, 200) ? {storeId: text(storeId, 200)} : {}),
    ...(text(transferId, 128) ? {transferId: text(transferId, 128)} : {}),
  };
}

// ---------------------------------------------------------------------------
// Sales.
// ---------------------------------------------------------------------------

/**
 * @param {*} value A retry key from the client.
 * @return {string} The key, or "" when it is not usable.
 */
function cleanClientRequestId(value) {
  const id = text(value, 101);
  return /^[A-Za-z0-9_.:-]{8,100}$/.test(id) ? id : "";
}

/**
 * The sale's document id: one per business and retry key, so the same key
 * lands on the same document and a retry can never ring up a second sale.
 *
 * @param {string} businessId The business.
 * @param {string} clientRequestId A valid retry key.
 * @return {string} A 40-character id.
 */
function saleDocId(businessId, clientRequestId) {
  return crypto.createHash("sha256")
      .update(`${businessId}\u0000${clientRequestId}`)
      .digest("hex").slice(0, 40);
}

/**
 * @param {object} data The recordInventorySale data.
 * @return {object} {errors, lines} - the lines normalised (itemId, quantity,
 *   soldPriceCents) when there are no errors.
 */
function cleanSaleInput(data) {
  const row = data && typeof data === "object" ? data : {};
  const errors = [];
  if (!cleanClientRequestId(row.clientRequestId)) {
    errors.push("client_request_id_invalid");
  }
  if (!INVENTORY_PAYMENT_METHODS.includes(text(row.paymentMethod, 40))) {
    errors.push("payment_method_invalid");
  }
  const raw = Array.isArray(row.lines) ? row.lines : [];
  if (raw.length === 0) errors.push("lines_required");
  else if (raw.length > MAX_SALE_LINES) errors.push("lines_too_many");
  const lines = [];
  if (raw.length > 0 && raw.length <= MAX_SALE_LINES) {
    for (const entry of raw) {
      const line = entry && typeof entry === "object" ? entry : {};
      const itemId = text(line.itemId, 200);
      const quantity = wholeNumber(line.quantity, 1, MAX_QUANTITY);
      // A price must be typed: an empty field is not a free item. Zero is a
      // price (a giveaway), and shows as a full discount.
      const soldPriceCents = wholeNumber(line.soldPriceCents, 0, MAX_CENTS);
      if (!itemId || itemId.includes("/")) errors.push("item_not_found");
      if (quantity === null) errors.push("quantity_invalid");
      if (soldPriceCents === null) errors.push("price_invalid");
      lines.push({itemId, quantity, soldPriceCents});
    }
  }
  if (errors.length === 0) {
    const total = lines.reduce(
        (sum, l) => sum + l.quantity * l.soldPriceCents, 0);
    if (total > MAX_CENTS) errors.push("total_too_large");
  }
  return {errors: [...new Set(errors)], lines};
}

/**
 * Why a sale cannot go ahead because of the products on it, or null.
 *
 * @param {object[]} lines The cleaned lines.
 * @param {Map<string, object>} items The business's products by id (a
 *   missing or foreign one is simply absent).
 * @return {?{reason: string, itemIds: string[]}} The first refusal and every
 *   product it is about.
 */
function saleItemRefusal(lines, items) {
  const missing = [];
  const archived = [];
  for (const line of lines) {
    const item = items.get(line.itemId);
    if (!item) missing.push(line.itemId);
    else if (item.archived === true) archived.push(line.itemId);
  }
  if (missing.length > 0) {
    return {reason: "item_not_found", itemIds: [...new Set(missing)]};
  }
  if (archived.length > 0) {
    return {reason: "item_archived", itemIds: [...new Set(archived)]};
  }
  return null;
}

/**
 * What a sale does: the lines as they will be recorded (name, price and cost
 * copied so history survives an edit or a delete), the count each product
 * ends on, and a stock movement per line.
 *
 * Lines are taken in order against a running count per product, so two lines
 * of one product (sold at two prices) share its stock. A line asking for more
 * than is left sells anyway: the count floors at 0, and the line and the
 * product are flagged `countWasOff`.
 *
 * @param {object[]} lines Cleaned lines.
 * @param {Map<string, object>} items The products (all present, none
 *   archived: see saleItemRefusal).
 * @return {object} {lines, totalCents, items: [{itemId, quantityAfter,
 *   countWasOff}], movements: [{itemId, delta, quantityAfter}], warnings}.
 */
function planSale(lines, items) {
  const running = new Map();
  const flagged = new Set();
  const outLines = [];
  const movements = [];
  let totalCents = 0;
  for (const line of lines) {
    const item = items.get(line.itemId) || {};
    const stock = running.has(line.itemId) ? running.get(line.itemId) :
      Math.max(0, Math.round(Number(item.quantity) || 0));
    const deducted = Math.min(line.quantity, stock);
    const short = line.quantity > stock;
    const after = stock - deducted;
    running.set(line.itemId, after);
    if (short) flagged.add(line.itemId);
    totalCents += line.quantity * line.soldPriceCents;
    outLines.push({
      itemId: line.itemId,
      name: text(item.name, MAX_NAME),
      code: text(item.code, 40),
      quantity: line.quantity,
      // What the product was filed under when it sold: reports group by it
      // even if the product moves to another category later.
      categoryId: text(item.categoryId, 200),
      category: text(item.category, MAX_CATEGORY),
      // Same for the brand (v3): the report reads what the line sold under.
      brandId: text(item.brandId, 200),
      brand: text(item.brand, MAX_BRAND),
      listPriceCents: Number(item.priceCents) || 0,
      soldPriceCents: line.soldPriceCents,
      costCents: item.costCents === null || item.costCents === undefined ?
        null : Number(item.costCents),
      countWasOff: short,
      // What really left the shelf: less than `quantity` when the count was
      // short. A void puts back exactly this, never invented stock.
      stockDeducted: deducted,
    });
    movements.push({itemId: line.itemId, delta: 0 - deducted,
      quantityAfter: after});
  }
  return {
    lines: outLines,
    totalCents,
    items: [...running.entries()].map(([itemId, quantityAfter]) => ({
      itemId,
      quantityAfter,
      countWasOff: flagged.has(itemId) || items.get(itemId)?.countWasOff ===
        true,
    })),
    movements,
    warnings: [...flagged].map((itemId) => ({itemId,
      reason: "count_was_off"})),
  };
}

/**
 * @param {object} sale A stored sale.
 * @return {object[]} The warnings its lines carry, one per product.
 */
function saleWarnings(sale) {
  const ids = [];
  for (const line of Array.isArray(sale?.lines) ? sale.lines : []) {
    if (line?.countWasOff === true && !ids.includes(line.itemId)) {
      ids.push(line.itemId);
    }
  }
  return ids.map((itemId) => ({itemId, reason: "count_was_off"}));
}

/**
 * Putting a voided sale's stock back. A product that has been deleted since
 * has nothing to put back onto and is reported as skipped.
 *
 * @param {object} sale The stored sale.
 * @param {Map<string, object>} items The products that still exist.
 * @return {object} {items: [{itemId, quantityAfter}], movements: [{itemId,
 *   delta, quantityAfter}], skipped: string[]}.
 */
function planVoid(sale, items) {
  const running = new Map();
  const movements = [];
  const skipped = [];
  for (const line of Array.isArray(sale?.lines) ? sale.lines : []) {
    const item = items.get(line.itemId);
    if (!item) {
      if (!skipped.includes(line.itemId)) skipped.push(line.itemId);
      continue;
    }
    const deducted = Number.isInteger(line.stockDeducted) ?
      Math.max(0, line.stockDeducted) : 0;
    const stock = running.has(line.itemId) ? running.get(line.itemId) :
      Math.max(0, Math.round(Number(item.quantity) || 0));
    const after = Math.min(MAX_QUANTITY, stock + deducted);
    running.set(line.itemId, after);
    movements.push({itemId: line.itemId, delta: after - stock,
      quantityAfter: after});
  }
  return {
    items: [...running.entries()].map(([itemId, quantityAfter]) =>
      ({itemId, quantityAfter})),
    movements,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------

/**
 * The UTC offset of an IANA zone at an instant, in milliseconds.
 *
 * @param {number} ms The instant.
 * @param {string} zone A valid IANA zone.
 * @return {number} Zone local time minus UTC.
 */
function zoneOffsetMs(ms, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric",
    day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ms));
  const pick = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"),
      pick("hour"), pick("minute"), pick("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * @param {*} timeZone What the client reported.
 * @return {string} A zone Intl accepts, or "UTC".
 */
function validZone(timeZone) {
  const zone = text(timeZone, 64);
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: zone});
    return zone;
  } catch (_) {
    return "UTC";
  }
}

/**
 * When "today" or "this month" began, in the viewer's zone.
 *
 * @param {string} range "today" or "month".
 * @param {*} timeZone IANA zone from the client ("" or unknown reads as UTC).
 * @param {Date} now The current instant.
 * @return {{startMs: number, zone: string, startKey: string}} The first
 *   instant of the range (inclusive) and the local date it began on.
 */
function rangeBounds(range, timeZone, now = new Date()) {
  const zone = validZone(timeZone);
  const local = new Date(now.getTime() + zoneOffsetMs(now.getTime(), zone));
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = range === "month" ? 1 : local.getUTCDate();
  // Local midnight as if it were UTC, then shifted by the zone's offset at
  // that moment; once more, because the offset can change by then (DST).
  const midnight = Date.UTC(year, month, day);
  let startMs = midnight - zoneOffsetMs(midnight, zone);
  startMs = midnight - zoneOffsetMs(startMs, zone);
  const key = `${year}-${String(month + 1).padStart(2, "0")}-${
    String(day).padStart(2, "0")}`;
  return {startMs, zone, startKey: key};
}

/**
 * The sales figures of a range. Voided sales are left out entirely.
 *
 * Cost and profit use the lines whose cost is known: a product with no cost
 * set contributes revenue but neither cost nor profit, and
 * `linesWithoutCost` says how many lines were left out of the profit, so a
 * screen can say so. profitCents = revenue of the lines with a known cost
 * minus their cost.
 *
 * @param {object[]} sales Stored sales (voided ones are skipped here).
 * @return {object} The summary's sales half.
 */
function summarizeSales(sales) {
  let salesCount = 0;
  let itemsSold = 0;
  let revenueCents = 0;
  let costCents = 0;
  let knownCostRevenueCents = 0;
  let discountCents = 0;
  let linesWithoutCost = 0;
  const byItem = new Map();
  for (const sale of Array.isArray(sales) ? sales : []) {
    if (!sale || sale.voided === true) continue;
    salesCount += 1;
    for (const line of Array.isArray(sale.lines) ? sale.lines : []) {
      const quantity = Number(line.quantity) || 0;
      const sold = Number(line.soldPriceCents) || 0;
      const list = Number(line.listPriceCents) || 0;
      const revenue = quantity * sold;
      itemsSold += quantity;
      revenueCents += revenue;
      if (list > sold) discountCents += (list - sold) * quantity;
      if (line.costCents === null || line.costCents === undefined) {
        linesWithoutCost += 1;
      } else {
        costCents += quantity * (Number(line.costCents) || 0);
        knownCostRevenueCents += revenue;
      }
      const entry = byItem.get(line.itemId) || {itemId: line.itemId,
        name: text(line.name, MAX_NAME), quantity: 0, revenueCents: 0};
      entry.quantity += quantity;
      entry.revenueCents += revenue;
      byItem.set(line.itemId, entry);
    }
  }
  const best = [...byItem.values()]
      .sort((a, b) => b.quantity - a.quantity ||
        b.revenueCents - a.revenueCents ||
        a.name.localeCompare(b.name) ||
        String(a.itemId).localeCompare(String(b.itemId)))
      .slice(0, BEST_SELLERS);
  return {
    salesCount,
    itemsSold,
    revenueCents,
    costCents,
    profitCents: knownCostRevenueCents - costCents,
    discountCents,
    linesWithoutCost,
    best,
  };
}

/**
 * The shelf half of the summary: what is low and what has a doubtful count.
 * Archived products are hidden from both.
 *
 * @param {Array<object>} items Products, each with its `id`.
 * @return {object} {low, lowCount, countWasOff, countWasOffCount}; the lists
 *   are capped, the counts are not.
 */
function summarizeShelf(items) {
  const live = (Array.isArray(items) ? items : [])
      .filter((item) => item && item.archived !== true);
  const byName = (a, b) => String(a.name || "")
      .localeCompare(String(b.name || ""));
  const low = live.filter(itemIsLow)
      .sort((a, b) => (Number(a.quantity) || 0) - (Number(b.quantity) || 0) ||
        byName(a, b));
  const off = live.filter((item) => item.countWasOff === true).sort(byName);
  return {
    low: low.slice(0, SUMMARY_LIST_CAP).map((item) => ({
      itemId: item.id,
      name: text(item.name, MAX_NAME),
      quantity: Number(item.quantity) || 0,
      lowStockAt: item.lowStockAt === undefined ? null : item.lowStockAt,
    })),
    lowCount: low.length,
    countWasOff: off.slice(0, SUMMARY_LIST_CAP).map((item) => ({
      itemId: item.id, name: text(item.name, MAX_NAME)})),
    countWasOffCount: off.length,
  };
}

// ---------------------------------------------------------------------------
// Tags.
// ---------------------------------------------------------------------------

/**
 * @param {*} value A requested number of tags.
 * @return {number|null} A whole number 1..500, else null.
 */
function tagCopies(value) {
  return wholeNumber(value, MIN_COPIES, MAX_COPIES);
}

/**
 * The address a tag's QR holds. The shop's staff scanning it in the app go
 * to the basket; anyone else's camera opens a neutral page with no product
 * details at all.
 *
 * @param {string} consoleUrl The customer console's base URL.
 * @param {string} code The product's code.
 * @return {string} The URL.
 */
function inventoryLink(consoleUrl, code) {
  const base = text(consoleUrl, 300).replace(/\/+$/, "") ||
    "https://customer.laawoldigital.com";
  const clean = text(code, 40).toUpperCase().replace(/[^A-Z0-9-]/g, "");
  return `${base}/i/${clean}`;
}

/**
 * What a tag page prints: the same code N times, QR only.
 *
 * @param {object} args {item, consoleUrl, copies}.
 * @return {object} {code, link, copies}.
 */
function tagsModel({item, consoleUrl, copies}) {
  const code = text(item?.code, 40);
  return {
    code,
    link: inventoryLink(consoleUrl, code),
    copies: tagCopies(copies) || MIN_COPIES,
  };
}

/**
 * Inventory is switched on by a platform admin, not by the owner. An owner's
 * own application or profile save can neither add it nor drop it: whether it
 * is on stays what the business already had. A platform admin sets it freely.
 * @param {string[]} requested - The normalized list the caller sent.
 * @param {*} current - The business's stored enabledServices (may be absent).
 * @param {boolean} callerIsAdmin - Whether a platform admin is saving.
 * @param {string[]} validOrder - VALID_BUSINESS_SERVICES, to keep their order.
 * @return {string[]} The services to store.
 */
function ownerEditableServices(requested, current, callerIsAdmin, validOrder) {
  if (callerIsAdmin) return requested;
  const had = Array.isArray(current) && current.includes("inventory");
  return validOrder.filter((service) => service === "inventory" ?
    had : requested.includes(service));
}

/**
 * What a platform admin's Inventory switch does to a business's services:
 * add or remove "inventory", keep every other service, and keep the
 * canonical order. Switching to the state it is already in changes nothing.
 * @param {string[]} current - The business's normalized enabledServices.
 * @param {*} enabled - The requested state; only boolean true/false count.
 * @param {string[]} validOrder - VALID_BUSINESS_SERVICES, to keep their order.
 * @return {{valid: boolean, changed: boolean, services: string[],
 *   enabled: boolean}} The plan; invalid when enabled is not a boolean.
 */
function planInventoryService(current, enabled, validOrder) {
  const base = Array.isArray(current) ? current : [];
  const had = base.includes("inventory");
  if (typeof enabled !== "boolean") {
    return {valid: false, changed: false, services: base, enabled: had};
  }
  const services = validOrder.filter((service) => service === "inventory" ?
    enabled : base.includes(service));
  return {valid: true, changed: had !== enabled, services, enabled};
}

// ---------------------------------------------------------------------------
// Categories (v2).
// ---------------------------------------------------------------------------

/**
 * @param {*} name A category name as typed.
 * @return {string} Its key: trimmed, inner spaces collapsed, lower case. Two
 *   names with the same key are the same category.
 */
function categoryNameKey(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * @param {*} name A category name as typed.
 * @return {string} The name as stored: trimmed, inner spaces collapsed.
 */
function categoryDisplayName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

/**
 * @param {*} name A category name as typed.
 * @return {string[]} Refusal codes.
 */
function validateCategoryName(name) {
  const clean = categoryDisplayName(name);
  if (!clean) return ["category_name_required"];
  if (clean.length > MAX_CATEGORY) return ["category_too_long"];
  return [];
}

/**
 * The lock document that keeps one category per name in a business: the same
 * name always lands on the same id, so two quick creates cannot both win.
 *
 * @param {string} businessId The business.
 * @param {string} nameKey categoryNameKey of the name.
 * @return {string} A 40-character id.
 */
function categoryKeyDocId(businessId, nameKey) {
  return crypto.createHash("sha256")
      .update(`${businessId}\u0000${nameKey}`)
      .digest("hex").slice(0, 40);
}

// ---------------------------------------------------------------------------
// Brands (v3): the same list-plus-lock design as categories.
// ---------------------------------------------------------------------------

/**
 * @param {*} name A brand name as typed.
 * @return {string} Its key (same rule as a category's): two names with the
 *   same key are the same brand.
 */
function brandNameKey(name) {
  return categoryNameKey(name);
}

/**
 * @param {*} name A brand name as typed.
 * @return {string} The name as stored: trimmed, inner spaces collapsed.
 */
function brandDisplayName(name) {
  return categoryDisplayName(name);
}

/**
 * @param {*} name A brand name as typed.
 * @return {string[]} Refusal codes.
 */
function validateBrandName(name) {
  const clean = brandDisplayName(name);
  if (!clean) return ["brand_name_required"];
  if (clean.length > MAX_BRAND) return ["brand_too_long"];
  return [];
}

/**
 * The lock document that keeps one brand per name in a business.
 *
 * @param {string} businessId The business.
 * @param {string} nameKey brandNameKey of the name.
 * @return {string} A 40-character id.
 */
function brandKeyDocId(businessId, nameKey) {
  return categoryKeyDocId(businessId, nameKey);
}

/**
 * How a product reads in a list: brand in front, then the name.
 *
 * @param {object} item A product (or sale line) with `name` and `brand`.
 * @return {string} "Jordan 11", or just the name without a brand.
 */
function itemDisplayName(item) {
  const brand = text(item?.brand, MAX_BRAND);
  const name = text(item?.name, MAX_NAME);
  return brand ? `${brand} ${name}`.trim() : name;
}

// ---------------------------------------------------------------------------
// Stores and who may use them (v2).
// ---------------------------------------------------------------------------

/**
 * @param {string} businessId The business.
 * @return {string} The id of its Main store, once there is one.
 */
function mainStoreIdOf(businessId) {
  return `${businessId}_main`;
}

/**
 * @param {string} itemId The product.
 * @param {string} storeId The store.
 * @return {string} The id of the product's stock row in that store.
 */
function stockDocId(itemId, storeId) {
  return `${itemId}__${storeId}`;
}

/**
 * What a signed-in caller may do with stores.
 *
 * @param {object} user The caller's profile.
 * @return {{owner: boolean, all: boolean, homeStoreId: string}} `owner` is
 *   the business owner or a platform admin; `all` adds staff the owner gave
 *   all-stores access; `homeStoreId` is the staff member's own store.
 */
function storeAccessOf(user) {
  const owner = user?.role === "businessOwner" || user?.role === "admin";
  return {
    owner,
    all: owner || user?.inventoryAllStores === true,
    homeStoreId: text(user?.inventoryHomeStoreId, 200),
  };
}

/**
 * @param {Array<object>} stores Every store of a business.
 * @return {object[]} The active ones.
 */
function activeStores(stores) {
  return (Array.isArray(stores) ? stores : []).filter(
      (store) => store && store.archived !== true);
}

/**
 * @param {Array<object>} stores Every store of a business.
 * @return {boolean} True with two or more active stores: the point where
 *   the screens start to show stores and staff are tied to one.
 */
function isMultiStore(stores) {
  return activeStores(stores).length >= 2;
}

/**
 * Which store a stock action is about, and whether the caller may use it.
 *
 * Without stores (never converted) there is no store at all and naming one is
 * refused. With stores, omitting it means the caller's home store (the
 * Main store for an owner without one), and a single active store is simply
 * "the" store. A staff member without all-stores access may only name their
 * own, and has none to default to until the owner assigns one.
 *
 * @param {object} args {converted, stores, mainStoreId, access,
 *   requestedStoreId}.
 * @return {{store: ?object, code: ?string}} The store (null for an
 *   unconverted business) or the refusal code.
 */
function resolveStore({converted, stores, mainStoreId, access,
  requestedStoreId}) {
  const requested = text(requestedStoreId, 200);
  if (!converted) {
    return requested ? {store: null, code: "store_not_found"} :
      {store: null, code: null};
  }
  const all = Array.isArray(stores) ? stores : [];
  const active = activeStores(all);
  const multi = active.length >= 2;
  if (requested) {
    const found = all.find((store) => store.id === requested);
    if (!found) return {store: null, code: "store_not_found"};
    if (found.archived === true) return {store: null, code: "store_archived"};
    if (multi && !access.all && found.id !== access.homeStoreId) {
      return {store: null, code: "store_not_allowed"};
    }
    return {store: found, code: null};
  }
  if (!multi) {
    return active.length === 1 ? {store: active[0], code: null} :
      {store: null, code: "store_not_found"};
  }
  const home = access.homeStoreId &&
    active.find((store) => store.id === access.homeStoreId);
  if (home) return {store: home, code: null};
  if (access.all) {
    const main = active.find((store) => store.id === mainStoreId) ||
      [...active].sort((a, b) => String(a.name).localeCompare(
          String(b.name)))[0];
    return {store: main, code: null};
  }
  return {store: null, code: "home_store_required"};
}

/**
 * @param {object} data createInventoryStore / updateInventoryStore data.
 * @param {boolean} requireName True on create.
 * @return {{errors: string[], fields: object}} Refusal codes and the cleaned
 *   fields that were sent.
 */
function cleanStoreInput(data, requireName) {
  const row = data && typeof data === "object" ? data : {};
  const errors = [];
  const fields = {};
  if (requireName || row.name !== undefined) {
    const name = text(row.name, MAX_NAME + 1);
    if (!name) errors.push("store_name_required");
    else if (name.length > MAX_NAME) errors.push("name_too_long");
    else fields.name = name;
  }
  for (const [key, max] of [["address", MAX_ADDRESS], ["phone", MAX_PHONE]]) {
    if (row[key] === undefined) continue;
    const value = String(row[key] ?? "").trim();
    if (value.length > max) errors.push("store_field_too_long");
    else fields[key] = value;
  }
  return {errors: [...new Set(errors)], fields};
}

// ---------------------------------------------------------------------------
// Stock per store (v2). A product's `quantity` is the total; the stores hold
// it in `inventoryStock` rows. A product that has no rows yet
// (`storeStock !== true`) is held, whole, by the Main store.
// ---------------------------------------------------------------------------

/**
 * @param {object} item The stored product.
 * @param {?object} row The stock row at the store (undefined when none).
 * @param {string} storeId The store.
 * @param {string} mainStoreId The Main store.
 * @return {{quantity: number, countWasOff: boolean, tracked: boolean}} What
 *   the store holds of the product. `tracked` is false when the product has
 *   never been in that store.
 */
function effectiveRow(item, row, storeId, mainStoreId) {
  if (row) {
    return {
      quantity: Math.max(0, Math.round(Number(row.quantity) || 0)),
      countWasOff: row.countWasOff === true,
      tracked: true,
    };
  }
  if (item?.storeStock !== true && storeId === mainStoreId) {
    return {
      quantity: Math.max(0, Math.round(Number(item?.quantity) || 0)),
      countWasOff: item?.countWasOff === true,
      tracked: true,
    };
  }
  return {quantity: 0, countWasOff: false, tracked: false};
}

/**
 * The Main row a not-yet-converted product must get the moment any other
 * store row of it is written, so the total is always the rows' sum.
 *
 * @param {object} item The stored product.
 * @param {string} mainStoreId The Main store.
 * @param {string[]} writtenStoreIds Stores whose rows are being written now.
 * @return {object[]} [] or [{storeId, quantity, countWasOff}].
 */
function mainRowToMaterialize(item, mainStoreId, writtenStoreIds) {
  if (item?.storeStock === true || writtenStoreIds.includes(mainStoreId)) {
    return [];
  }
  return [{storeId: mainStoreId,
    quantity: Math.max(0, Math.round(Number(item?.quantity) || 0)),
    countWasOff: item?.countWasOff === true}];
}

/**
 * A sale at one store of a business that has stores. The count that floors
 * and flags `countWasOff` is that store's, the product's total goes down by
 * what really left the shelf.
 *
 * @param {object[]} lines Cleaned lines.
 * @param {Map<string, object>} items The products.
 * @param {Map<string, object>} rows The stock row at `storeId` per product
 *   (absent when there is none).
 * @param {object} ctx {storeId, mainStoreId}.
 * @return {object} planSale's answer plus `writes`: [{itemId, rowQuantity,
 *   rowCountWasOff, totalAfter, itemCountWasOff, extraRows}] (the store's new
 *   row, the product's new total and the Main row to create, if any).
 */
function planStoreSale(lines, items, rows, {storeId, mainStoreId}) {
  const view = new Map();
  const before = new Map();
  for (const [itemId, item] of items) {
    const eff = effectiveRow(item, rows.get(itemId), storeId, mainStoreId);
    before.set(itemId, eff);
    view.set(itemId, {...item, quantity: eff.quantity,
      countWasOff: eff.countWasOff});
  }
  const plan = planSale(lines, view);
  const flagged = new Set(plan.warnings.map((w) => w.itemId));
  const writes = plan.items.map((change) => {
    const item = items.get(change.itemId) || {};
    const deducted = before.get(change.itemId).quantity - change.quantityAfter;
    return {
      itemId: change.itemId,
      rowQuantity: change.quantityAfter,
      rowCountWasOff: change.countWasOff,
      totalAfter: Math.max(0, (Number(item.quantity) || 0) - deducted),
      itemCountWasOff: flagged.has(change.itemId) ||
        item.countWasOff === true,
      extraRows: mainRowToMaterialize(item, mainStoreId, [storeId]),
    };
  });
  return {...plan, writes};
}

/**
 * Putting a voided sale's stock back into the store it was sold from.
 *
 * @param {object} sale The stored sale.
 * @param {Map<string, object>} items The products that still exist.
 * @param {Map<string, object>} rows The stock row at `storeId` per product.
 * @param {object} ctx {storeId, mainStoreId}.
 * @return {object} planVoid's answer plus `writes` like planStoreSale.
 */
function planStoreVoid(sale, items, rows, {storeId, mainStoreId}) {
  const view = new Map();
  const before = new Map();
  for (const [itemId, item] of items) {
    const eff = effectiveRow(item, rows.get(itemId), storeId, mainStoreId);
    before.set(itemId, eff);
    view.set(itemId, {...item, quantity: eff.quantity});
  }
  const plan = planVoid(sale, view);
  const writes = plan.items.map((change) => {
    const item = items.get(change.itemId) || {};
    const gained = change.quantityAfter - before.get(change.itemId).quantity;
    return {
      itemId: change.itemId,
      rowQuantity: change.quantityAfter,
      rowCountWasOff: before.get(change.itemId).countWasOff,
      totalAfter: Math.max(0, (Number(item.quantity) || 0) + gained),
      extraRows: mainRowToMaterialize(item, mainStoreId, [storeId]),
    };
  });
  return {...plan, writes};
}

/**
 * A stock add or set at one store of a business that has stores.
 *
 * @param {object} item The stored product.
 * @param {Map<string, object>} rows Every existing stock row of the
 *   product, by store id.
 * @param {string} storeId The store being changed.
 * @param {object} input {mode, quantity}.
 * @param {string} mainStoreId The Main store.
 * @return {object} {errors, type, quantityAfter (the store's), delta,
 *   rowCountWasOff, totalAfter, itemCountWasOff, extraRows}.
 */
function planStoreAdjust(item, rows, storeId, input, mainStoreId) {
  const eff = effectiveRow(item, rows.get(storeId), storeId, mainStoreId);
  const plan = planStockAdjust({quantity: eff.quantity,
    countWasOff: eff.countWasOff}, input);
  if (plan.errors.length > 0) return {errors: plan.errors};
  let total = plan.quantityAfter;
  let anyOff = plan.countWasOff;
  for (const [otherId, row] of rows) {
    if (otherId === storeId) continue;
    total += Math.max(0, Math.round(Number(row.quantity) || 0));
    anyOff = anyOff || row.countWasOff === true;
  }
  const extraRows = mainRowToMaterialize(item, mainStoreId, [storeId])
      .filter((extra) => !rows.has(extra.storeId));
  for (const extra of extraRows) {
    total += extra.quantity;
    anyOff = anyOff || extra.countWasOff;
  }
  if (total > MAX_QUANTITY) return {errors: ["quantity_invalid"]};
  return {
    errors: [],
    type: plan.type,
    quantityAfter: plan.quantityAfter,
    delta: plan.delta,
    rowCountWasOff: plan.countWasOff,
    totalAfter: total,
    itemCountWasOff: anyOff,
    extraRows,
  };
}

/**
 * Moving pieces of one product from one store to another. The total never
 * changes and no count goes below zero.
 *
 * @param {object} item The stored product.
 * @param {Map<string, object>} rows The product's existing stock rows.
 * @param {object} move {fromStoreId, toStoreId, quantity}.
 * @param {string} mainStoreId The Main store.
 * @return {object} {errors, amount, from: {quantityAfter, countWasOff},
 *   to: {...}, extraRows}.
 */
function planTransfer(item, rows, {fromStoreId, toStoreId, quantity},
    mainStoreId) {
  if (fromStoreId === toStoreId) return {errors: ["same_store"]};
  const amount = wholeNumber(quantity, 1, MAX_QUANTITY);
  if (amount === null) return {errors: ["quantity_invalid"]};
  const from = effectiveRow(item, rows.get(fromStoreId), fromStoreId,
      mainStoreId);
  const to = effectiveRow(item, rows.get(toStoreId), toStoreId, mainStoreId);
  if (from.quantity < amount) return {errors: ["insufficient_stock"]};
  if (to.quantity + amount > MAX_QUANTITY) {
    return {errors: ["quantity_invalid"]};
  }
  return {
    errors: [],
    amount,
    from: {quantityAfter: from.quantity - amount,
      countWasOff: from.countWasOff},
    to: {quantityAfter: to.quantity + amount, countWasOff: to.countWasOff},
    extraRows: mainRowToMaterialize(item, mainStoreId,
        [fromStoreId, toStoreId]),
  };
}

// ---------------------------------------------------------------------------
// Summary additions (v2).
// ---------------------------------------------------------------------------

/**
 * @param {object} sale A stored sale.
 * @param {string} mainStoreId The Main store ("" when there are no stores).
 * @return {string} The store it was rung up at; a sale from before stores
 *   existed belongs to the Main store.
 */
function saleStoreId(sale, mainStoreId) {
  return text(sale?.storeId, 200) || mainStoreId || "";
}

/**
 * Whether a sale's line lacks the category it was sold under. Lines from
 * before categories existed carry neither field and are read through the
 * product's current category instead.
 *
 * @param {object} line A stored sale line.
 * @return {boolean} True for a line written without a snapshot.
 */
function lineIsLegacyCategory(line) {
  return !line || (!("categoryId" in line) && !("category" in line));
}

/**
 * Whether a sale's line lacks the brand it was sold under (written before
 * v3). Such a line is read through the product's current brand instead.
 *
 * @param {object} line A stored sale line.
 * @return {boolean} True for a line written without a snapshot.
 */
function lineIsLegacyBrand(line) {
  return !line || (!("brandId" in line) && !("brand" in line));
}

/**
 * The sales figures grouped by one label (category or brand), voided sales
 * left out, everything that sold (not capped), biggest revenue first.
 *
 * @param {object[]} sales Stored sales.
 * @param {object} cfg {idField, nameField, max, empty, isLegacy, lists, items}
 * @return {object[]} [{<idField>, name, itemsSold, revenueCents,
 *   profitCents}]; id "" is the `empty` label.
 */
function summarizeByLabel(sales, cfg) {
  const {idField, nameField, max, empty, isLegacy, lists, items} = cfg;
  const names = new Map();
  const keyToId = new Map();
  for (const entry of lists) {
    names.set(entry.id, entry.name);
    keyToId.set(categoryNameKey(entry.name), entry.id);
  }
  const groups = new Map();
  for (const sale of Array.isArray(sales) ? sales : []) {
    if (!sale || sale.voided === true) continue;
    for (const line of Array.isArray(sale.lines) ? sale.lines : []) {
      let id = text(line[idField], 200);
      let name = text(line[nameField], max);
      if (isLegacy(line)) {
        const item = items.get(line.itemId);
        id = text(item?.[idField], 200);
        name = text(item?.[nameField], max);
      }
      if (!id && name) id = keyToId.get(categoryNameKey(name)) || "";
      const key = id || (name ? `text:${categoryNameKey(name)}` : "");
      const label = id ? (names.get(id) || name || empty) : (name || empty);
      const quantity = Number(line.quantity) || 0;
      const revenue = quantity * (Number(line.soldPriceCents) || 0);
      const entry = groups.get(key) || {id, name: label,
        itemsSold: 0, revenueCents: 0, knownRevenue: 0, costCents: 0};
      entry.itemsSold += quantity;
      entry.revenueCents += revenue;
      if (line.costCents !== null && line.costCents !== undefined) {
        entry.knownRevenue += revenue;
        entry.costCents += quantity * (Number(line.costCents) || 0);
      }
      groups.set(key, entry);
    }
  }
  return [...groups.values()]
      .map((e) => ({[idField]: e.id, name: e.name,
        itemsSold: e.itemsSold, revenueCents: e.revenueCents,
        profitCents: e.knownRevenue - e.costCents}))
      .sort((a, b) => b.revenueCents - a.revenueCents ||
        a.name.localeCompare(b.name));
}

/**
 * The sales figures per category, voided sales left out, all categories that
 * sold (not capped), biggest revenue first.
 *
 * @param {object[]} sales Stored sales.
 * @param {object} ctx {categories: Array<{id, name}>, items: Map<string,
 *   object>}: the business's categories and its products (for lines with no
 *   snapshot).
 * @return {object[]} [{categoryId, name, itemsSold, revenueCents,
 *   profitCents}]; categoryId "" is "Uncategorized".
 */
function summarizeByCategory(sales, {categories = [], items = new Map()}) {
  return summarizeByLabel(sales, {
    idField: "categoryId", nameField: "category", max: MAX_CATEGORY,
    empty: UNCATEGORIZED, isLegacy: lineIsLegacyCategory,
    lists: categories, items});
}

/**
 * The sales figures per brand (v3): the same rules as per category.
 *
 * @param {object[]} sales Stored sales.
 * @param {object} ctx {brands: Array<{id, name}>, items: Map<string,
 *   object>}: the business's brands and its products (for lines written
 *   before brands existed).
 * @return {object[]} [{brandId, name, itemsSold, revenueCents,
 *   profitCents}]; brandId "" is "No brand".
 */
function summarizeByBrand(sales, {brands = [], items = new Map()}) {
  return summarizeByLabel(sales, {
    idField: "brandId", nameField: "brand", max: MAX_BRAND,
    empty: NO_BRAND, isLegacy: lineIsLegacyBrand, lists: brands, items});
}

/**
 * The sales figures per store, voided sales left out. Every active store is
 * listed (a store with no sales shows zeros), plus an archived one that sold.
 *
 * @param {object[]} sales Stored sales.
 * @param {Array<object>} stores Every store, each with `id`, `name`,
 *   `archived`.
 * @param {string} mainStoreId The Main store.
 * @return {object[]} [{storeId, name, salesCount, itemsSold, revenueCents,
 *   profitCents}], biggest revenue first.
 */
function summarizeByStore(sales, stores, mainStoreId) {
  const rows = new Map();
  for (const store of Array.isArray(stores) ? stores : []) {
    rows.set(store.id, {storeId: store.id, name: text(store.name, MAX_NAME),
      archived: store.archived === true, salesCount: 0, itemsSold: 0,
      revenueCents: 0, knownRevenue: 0, costCents: 0});
  }
  for (const sale of Array.isArray(sales) ? sales : []) {
    if (!sale || sale.voided === true) continue;
    const id = saleStoreId(sale, mainStoreId);
    const row = rows.get(id) || {storeId: id, name: id, archived: true,
      salesCount: 0, itemsSold: 0, revenueCents: 0, knownRevenue: 0,
      costCents: 0};
    rows.set(id, row);
    row.salesCount += 1;
    for (const line of Array.isArray(sale.lines) ? sale.lines : []) {
      const quantity = Number(line.quantity) || 0;
      const revenue = quantity * (Number(line.soldPriceCents) || 0);
      row.itemsSold += quantity;
      row.revenueCents += revenue;
      if (line.costCents !== null && line.costCents !== undefined) {
        row.knownRevenue += revenue;
        row.costCents += quantity * (Number(line.costCents) || 0);
      }
    }
  }
  return [...rows.values()]
      .filter((row) => !row.archived || row.salesCount > 0)
      .map((row) => ({storeId: row.storeId, name: row.name,
        salesCount: row.salesCount, itemsSold: row.itemsSold,
        revenueCents: row.revenueCents,
        profitCents: row.knownRevenue - row.costCents}))
      .sort((a, b) => b.revenueCents - a.revenueCents ||
        a.name.localeCompare(b.name));
}

/**
 * The shelf half of the summary for a business with several stores: low stock
 * and doubtful counts are judged PER STORE, only where the product is
 * tracked, and each entry names its store. Archived products and archived
 * stores are hidden.
 *
 * @param {object} args {items: products with `id`, rows: every stock row,
 *   stores, mainStoreId, visibleStoreIds: Set|null (null = every store)}.
 * @return {object} {low, lowCount, countWasOff, countWasOffCount}.
 */
function summarizeShelfByStore({items, rows, stores, mainStoreId,
  visibleStoreIds = null}) {
  const storeById = new Map(activeStores(stores).map((s) => [s.id, s]));
  const rowsByItem = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const list = rowsByItem.get(row.itemId) || [];
    list.push(row);
    rowsByItem.set(row.itemId, list);
  }
  const low = [];
  const off = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.archived === true) continue;
    const tracked = item.storeStock === true ?
      (rowsByItem.get(item.id) || []) :
      [{storeId: mainStoreId, quantity: item.quantity,
        countWasOff: item.countWasOff === true}];
    for (const row of tracked) {
      const store = storeById.get(row.storeId);
      if (!store) continue;
      if (visibleStoreIds && !visibleStoreIds.has(row.storeId)) continue;
      const quantity = Math.max(0, Math.round(Number(row.quantity) || 0));
      if (itemIsLow({quantity, lowStockAt: item.lowStockAt})) {
        low.push({itemId: item.id, name: text(item.name, MAX_NAME), quantity,
          lowStockAt: item.lowStockAt === undefined ? null : item.lowStockAt,
          storeId: store.id, storeName: text(store.name, MAX_NAME)});
      }
      if (row.countWasOff === true) {
        off.push({itemId: item.id, name: text(item.name, MAX_NAME),
          storeId: store.id, storeName: text(store.name, MAX_NAME)});
      }
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name) ||
    a.storeName.localeCompare(b.storeName);
  low.sort((a, b) => a.quantity - b.quantity || byName(a, b));
  off.sort(byName);
  return {
    low: low.slice(0, SUMMARY_LIST_CAP),
    lowCount: low.length,
    countWasOff: off.slice(0, SUMMARY_LIST_CAP),
    countWasOffCount: off.length,
  };
}

/**
 * Which stores a summary covers for a caller.
 *
 * @param {object} args {converted, stores, access, requestedStoreId}.
 * @return {object} {code, multi, filterStoreId, allView}: `filterStoreId` is
 *   "" for every store; `allView` is true when the caller sees all stores in
 *   a multi-store business (and so gets `byStore`).
 */
function resolveSummaryScope({converted, stores, access, requestedStoreId}) {
  const requested = text(requestedStoreId, 200);
  if (!converted) {
    return {code: requested ? "store_not_found" : null, multi: false,
      filterStoreId: "", allView: false};
  }
  const all = Array.isArray(stores) ? stores : [];
  const active = activeStores(all);
  const multi = active.length >= 2;
  if (!multi) {
    return {code: null, multi: false, filterStoreId: "", allView: false};
  }
  if (access.all) {
    if (!requested) {
      return {code: null, multi, filterStoreId: "", allView: true};
    }
    if (!all.some((store) => store.id === requested)) {
      return {code: "store_not_found", multi, filterStoreId: "",
        allView: true};
    }
    return {code: null, multi, filterStoreId: requested, allView: true};
  }
  const home = active.find((store) => store.id === access.homeStoreId);
  if (!home) {
    return {code: "home_store_required", multi, filterStoreId: "",
      allView: false};
  }
  if (requested && requested !== home.id) {
    return {code: "store_not_allowed", multi, filterStoreId: home.id,
      allView: false};
  }
  return {code: null, multi, filterStoreId: home.id, allView: false};
}

// ---------------------------------------------------------------------------
// Sale notifications: when someone rings up a sale, the other people of that
// store (and the owner) get a push. Only the sale: no payment method, no
// profit. The seller never hears about their own sale.
// ---------------------------------------------------------------------------

/** The notification preference that switches these pushes off. */
const SALE_NOTIFICATION_PREFERENCE = "inventorySales";
/** The most people one sale notifies. */
const MAX_SALE_NOTIFICATION_RECIPIENTS = 50;

/**
 * @param {object} user The seller's profile.
 * @return {string} Their first name ("Mamadou" of "Mamadou Diallo"), else
 *   the first word of whatever name the profile has, else "".
 */
function sellerFirstName(user) {
  for (const key of ["fullName", "displayName", "name"]) {
    const value = text(user?.[key], 120);
    if (value) return value.split(/\s+/)[0];
  }
  return "";
}

/**
 * The words of one sale notification in one language.
 *
 * @param {object} sale The sale: lines, totalCents, storeName.
 * @param {boolean} named True when the title names the store.
 * @param {string} seller The seller's first name ("" when unknown).
 * @param {"en"|"fr"} language The language.
 * @return {{title: string, body: string}} The copy.
 */
function saleNotificationCopy(sale, named, seller, language) {
  const fr = language === "fr";
  const lines = Array.isArray(sale?.lines) ? sale.lines : [];
  const first = lines[0] || {};
  const name = itemDisplayName(first) || (fr ? "un article" : "an item");
  const quantity = Math.max(1, Math.round(Number(first.quantity) || 1));
  const item = quantity > 1 ? `${quantity} × ${name}` : name;
  const others = lines.length - 1;
  const more = others <= 0 ? "" :
    fr ? ` +${others} ${others === 1 ? "autre" : "autres"}` :
      ` +${others} more`;
  const who = seller || (fr ? "Quelqu'un" : "Someone");
  const store = text(sale?.storeName, MAX_NAME);
  const money = moneyText(sale?.totalCents);
  if (fr) {
    return {
      title: named && store ? `Vente à ${store}` : "Nouvelle vente",
      body: `${who} a vendu ${item}${more} · ${money}`,
    };
  }
  return {
    title: named && store ? `Sale at ${store}` : "New sale",
    body: `${who} sold ${item}${more} · ${money}`,
  };
}

/**
 * Who hears about a sale, and what they read.
 *
 * Recipients: in a business with several stores, staff holding the inventory
 * permission whose home store is the sale's store or who work in all stores;
 * in a single-store business (no stores yet, one active store, or a sale with
 * no store) every staff member holding the inventory permission. Plus the
 * business owner(s) always. Never the seller, never anyone who switched
 * "Sales at my store" off, never another business's people; owners first,
 * at most MAX_SALE_NOTIFICATION_RECIPIENTS.
 *
 * @param {object} input The sale and the people.
 * @param {object} input.sale The sale: id, businessId, storeId, storeName,
 *   lines [{name, brand, quantity}], totalCents.
 * @param {Array<object>} input.users The business's `users` profiles, each
 *   with its `id` (the uid).
 * @param {string} input.sellerUid Who rang it up.
 * @param {object} [input.seller] The seller's profile, when it is not among
 *   `users` (a platform admin).
 * @param {boolean} [input.multiStore] True when the business has two or more
 *   active stores.
 * @return {{recipients: Array<{uid: string, language: string, title: string,
 *   body: string}>, title: string, body: string, copy: object,
 *   data: object}} The plan; `title`/`body` are the English copy.
 */
function planSaleNotification({sale, users, sellerUid, seller, multiStore}) {
  const businessId = text(sale?.businessId, 200);
  const storeId = text(sale?.storeId, 200);
  const sellerId = text(sellerUid, 200);
  const perStore = multiStore === true && Boolean(storeId);
  const people = Array.isArray(users) ? users : [];
  const chosen = [];
  const seen = new Set();
  for (const user of people) {
    const uid = text(user?.id, 200);
    if (!uid || uid === sellerId || seen.has(uid)) continue;
    if (text(user.businessId, 200) !== businessId) continue;
    if (user.notificationPreferences?.[SALE_NOTIFICATION_PREFERENCE] ===
        false) {
      continue;
    }
    const owner = user.role === "businessOwner";
    if (!owner) {
      if (user.role !== "staff") continue;
      const permissions = Array.isArray(user.businessPermissions) ?
        user.businessPermissions : [];
      if (!permissions.includes("inventory")) continue;
      if (perStore && user.inventoryAllStores !== true &&
          text(user.inventoryHomeStoreId, 200) !== storeId) {
        continue;
      }
    }
    seen.add(uid);
    chosen.push({uid, owner, user});
  }
  chosen.sort((a, b) => (a.owner === b.owner ?
    (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0) : a.owner ? -1 : 1));
  const sellerProfile = seller ||
    people.find((user) => text(user?.id, 200) === sellerId) || {};
  const name = sellerFirstName(sellerProfile);
  const copy = {
    en: saleNotificationCopy(sale, perStore, name, "en"),
    fr: saleNotificationCopy(sale, perStore, name, "fr"),
  };
  const saleId = text(sale?.id, 200);
  return {
    recipients: chosen.slice(0, MAX_SALE_NOTIFICATION_RECIPIENTS)
        .map(({uid, user}) => {
          const language = recipientLanguage(user);
          return {uid, language, ...copy[language]};
        }),
    title: copy.en.title,
    body: copy.en.body,
    copy,
    data: {
      type: "inventory_sale",
      businessId,
      saleId,
      storeId,
      relatedCollection: "inventorySales",
      relatedId: saleId,
    },
  };
}

module.exports = {
  SALE_NOTIFICATION_PREFERENCE,
  MAX_SALE_NOTIFICATION_RECIPIENTS,
  planSaleNotification,
  ownerEditableServices,
  planInventoryService,
  INVENTORY_PAYMENT_METHODS,
  INVENTORY_MESSAGES,
  MAX_CENTS,
  MAX_NAME,
  MAX_QUANTITY,
  MAX_SALE_LINES,
  MIN_COPIES,
  MAX_COPIES,
  MAX_REASON,
  MAX_NOTE,
  MAX_ADDRESS,
  MAX_PHONE,
  MAIN_STORE_NAME,
  UNCATEGORIZED,
  NO_BRAND,
  MAX_BRAND,
  MOVEMENT_TYPES,
  SUMMARY_RANGES,
  TAG_CODE_PREFIX,
  BEST_SELLERS,
  SUMMARY_LIST_CAP,
  refusalKind,
  inventoryMessage,
  parseStockMap,
  validateItemCreate,
  validateItemUpdate,
  itemCreateRecord,
  itemUpdatePatch,
  itemFieldDiff,
  itemIsLow,
  moneyText,
  planStockAdjust,
  movementRecord,
  cleanClientRequestId,
  saleDocId,
  cleanSaleInput,
  saleItemRefusal,
  planSale,
  saleWarnings,
  planVoid,
  zoneOffsetMs,
  rangeBounds,
  summarizeSales,
  summarizeShelf,
  categoryNameKey,
  categoryDisplayName,
  validateCategoryName,
  categoryKeyDocId,
  brandNameKey,
  brandDisplayName,
  validateBrandName,
  brandKeyDocId,
  itemDisplayName,
  mainStoreIdOf,
  stockDocId,
  storeAccessOf,
  activeStores,
  isMultiStore,
  resolveStore,
  cleanStoreInput,
  effectiveRow,
  mainRowToMaterialize,
  planStoreSale,
  planStoreVoid,
  planStoreAdjust,
  planTransfer,
  saleStoreId,
  lineIsLegacyCategory,
  summarizeByCategory,
  lineIsLegacyBrand,
  summarizeByBrand,
  summarizeByStore,
  summarizeShelfByStore,
  resolveSummaryScope,
  tagCopies,
  inventoryLink,
  tagsModel,
  text,
};

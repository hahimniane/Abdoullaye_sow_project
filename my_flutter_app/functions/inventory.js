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

const INVENTORY_PAYMENT_METHODS = INVOICE_PAYMENT_METHODS;

const MAX_NAME = 120;
const MAX_CATEGORY = 60;
const MAX_PHOTO_URL = 1000;
const MAX_NOTE = 200;
const MAX_REASON = 300;
/** Most pieces one product can hold, or one line can sell, at once. */
const MAX_QUANTITY = 1000000;
const MAX_SALE_LINES = 50;
const MIN_COPIES = 1;
const MAX_COPIES = 500;
const TAG_CODE_PREFIX = "IT";

const MOVEMENT_TYPES = Object.freeze(
    ["initial", "add", "set", "sale", "void"]);
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
});

/** Codes answered as `not-found`; the rest of the state refusals below. */
const NOT_FOUND_CODES = Object.freeze(
    ["business_not_found", "item_not_found", "sale_not_found"]);
const PRECONDITION_CODES = Object.freeze(
    ["service_disabled", "item_archived", "sale_voided"]);

/**
 * @param {string} code A refusal code.
 * @return {"not-found"|"failed-precondition"|"invalid-argument"} The
 *   HttpsError code that carries it.
 */
function refusalKind(code) {
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
  if (!photoUrlOk(row.photoUrl)) errors.push("photo_url_invalid");
  return errors;
}

/**
 * @param {object} data The createInventoryItem data.
 * @return {string[]} Refusal codes.
 */
function validateItemCreate(data) {
  const errors = itemFieldErrors(data, true);
  if (wholeNumber(data?.quantity, 0, MAX_QUANTITY) === null) {
    errors.push("quantity_invalid");
  }
  return errors;
}

/**
 * @param {object} data The updateInventoryItem data.
 * @return {string[]} Refusal codes. The count is never edited here.
 */
function validateItemUpdate(data) {
  const row = data && typeof data === "object" ? data : {};
  if (row.quantity !== undefined) return ["quantity_not_editable"];
  const fields = ["name", "priceCents", "costCents", "lowStockAt", "category",
    "photoUrl"];
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
 * @param {object} extra {businessId, code, uid}.
 * @return {object} The stored fields.
 */
function itemCreateRecord(data, {businessId, code, uid}) {
  return {
    businessId,
    name: text(data.name, MAX_NAME),
    code,
    priceCents: Number(data.priceCents),
    costCents: given(data.costCents) ? Number(data.costCents) : null,
    quantity: Number(data.quantity),
    lowStockAt: given(data.lowStockAt) ? Number(data.lowStockAt) : null,
    category: text(data.category, MAX_CATEGORY),
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
 *   note, saleId}.
 * @return {object} The stored fields (the caller adds `createdAt`).
 */
function movementRecord({businessId, itemId, type, delta, quantityAfter, uid,
  note = "", saleId = ""}) {
  return {
    businessId,
    itemId,
    type,
    delta: Math.round(Number(delta) || 0) + 0,
    quantityAfter: Math.max(0, Math.round(Number(quantityAfter) || 0)),
    byStaffId: text(uid, 128),
    note: text(note, MAX_NOTE),
    saleId: text(saleId, 128),
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

module.exports = {
  ownerEditableServices,
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
  MOVEMENT_TYPES,
  SUMMARY_RANGES,
  TAG_CODE_PREFIX,
  BEST_SELLERS,
  SUMMARY_LIST_CAP,
  refusalKind,
  inventoryMessage,
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
  tagCopies,
  inventoryLink,
  tagsModel,
  text,
};

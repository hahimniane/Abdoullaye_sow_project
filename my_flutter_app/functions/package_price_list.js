"use strict";

/**
 * Business price lists for "Send a package" (docs/PACKAGE_PRICE_LIST.md).
 *
 * A business prices what it carries per destination country, separately by
 * Sea and by Air. A route holds:
 * - items: a fixed price per item ("Phone $40"), optionally covering only up
 *   to `includedLb` pounds each (above that, the extra pounds are charged at
 *   the item's category rate, once weighed at the counter);
 * - perLbCents: a price per pound for a whole category ("Clothes $6/lb");
 * - departure: the weekly schedule shown as "Next flight / container".
 * Anything not on the list is "ask me": the piece waits for a staff estimate.
 *
 * Pure: no Firestore, no clock except what callers pass. Mirrored by
 * admin_web/src/lib/package-price-list.ts and
 * my_flutter_app/lib/services/package_price_list.dart; the shared fixture
 * test/fixtures/package-price-list-cases.json pins all three.
 */

const CATEGORIES = Object.freeze([
  {id: "general", en: "General goods", fr: "Marchandises générales"},
  {id: "clothing", en: "Clothes and fabric", fr: "Vêtements et tissus"},
  {id: "food", en: "Food", fr: "Nourriture"},
  {id: "documents", en: "Documents", fr: "Documents"},
  {id: "cosmetics", en: "Cosmetics and liquids",
    fr: "Cosmétiques et liquides"},
  {id: "electronics", en: "Electronics", fr: "Électronique"},
  {id: "fragile", en: "Fragile items", fr: "Objets fragiles"},
]);
const CATEGORY_IDS = Object.freeze(CATEGORIES.map((c) => c.id));
const MODES = Object.freeze(["sea", "air"]);
const WEEK_DAYS = Object.freeze(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

/** One-tap weights for things priced by the pound (owner decision 9). */
const SIZE_PRESETS = Object.freeze([
  {id: "small_bag", lb: 10, en: "Small bag", fr: "Petit sac"},
  {id: "suitcase", lb: 50, en: "Suitcase", fr: "Valise"},
  {id: "big_box", lb: 70, en: "Big box", fr: "Grand carton"},
]);

const LIMIT = Object.freeze({
  ROUTES: 80,
  ITEMS_PER_ROUTE: 60,
  LABEL: 60,
  PRICE_CENTS: 1000000, // $10,000
  PER_LB_CENTS: 100000, // $1,000 a pound
  INCLUDED_LB: 500,
  WEIGHT_LB: 2000,
  QUANTITY: 50,
  EVERY_WEEKS: 8,
});

const ITEM_ID = /^i_[a-z0-9_]{1,40}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const PRICE_LIST_MESSAGES = Object.freeze({
  price_list_invalid: "The price list could not be read.",
  country_unknown: "That country is not one you ship to.",
  mode_invalid: "Choose Sea or Air.",
  too_many_routes: "Too many countries in one price list.",
  too_many_items: "A route can hold at most 60 items.",
  label_required: "Give every item a name.",
  label_too_long: "An item name is too long (60 characters).",
  label_duplicate: "Two items have the same name.",
  category_invalid: "Choose a category for every item.",
  price_invalid: "Enter a price between $0.01 and $10,000.",
  included_invalid: "The weight a price covers must be 0 to 500 lb.",
  per_lb_invalid: "Enter a price per pound between $0.01 and $1,000.",
  departure_invalid: "Pick the days it leaves, and how many weeks apart.",
  item_unknown: "That item is no longer on the price list.",
  quantity_invalid: "Enter how many (1 to 50).",
  weight_invalid: "Enter the weight in pounds (0.1 to 2,000).",
});

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const isObject = (value) => !!value && typeof value === "object" &&
  !Array.isArray(value);

/**
 * Whole cents from a client value; null when not a whole positive number in
 * range.
 *
 * @param {*} value The value.
 * @param {number} max Highest allowed.
 * @return {?number} Cents.
 */
function centsIn(value, max) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
}

/**
 * Pounds rounded to a tenth.
 *
 * @param {*} value The value.
 * @return {number} NaN when not a finite number.
 */
function tenth(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN;
}

/**
 * @param {string} label An item name.
 * @return {string} A stable id for it ("Phone (any)" -> "i_phone_any").
 */
function itemIdFor(label) {
  const slug = text(label, LIMIT.LABEL).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36);
  return `i_${slug || "item"}`;
}

/**
 * @param {*} raw A departure schedule a client sent.
 * @return {{departure: ?object, ok: boolean}} null when none is set.
 */
function cleanDeparture(raw) {
  if (raw === null || raw === undefined) return {departure: null, ok: true};
  if (!isObject(raw)) return {departure: null, ok: false};
  const days = Array.isArray(raw.weekdays) ? raw.weekdays : [];
  const weekdays = WEEK_DAYS.filter((d) => days.includes(d));
  if (weekdays.length === 0) {
    // An empty schedule is "not set"; anything unknown in it is an error.
    return {departure: null, ok: days.length === 0};
  }
  if (weekdays.length !== new Set(days).size) {
    return {departure: null, ok: false};
  }
  const everyWeeks = raw.everyWeeks === undefined || raw.everyWeeks === null ?
    1 : Number(raw.everyWeeks);
  if (!Number.isInteger(everyWeeks) || everyWeeks < 1 ||
      everyWeeks > LIMIT.EVERY_WEEKS) {
    return {departure: null, ok: false};
  }
  const anchor = text(raw.anchorDate, 10);
  if (everyWeeks > 1 && !dateKeyValid(anchor)) {
    return {departure: null, ok: false};
  }
  return {departure: {weekdays, everyWeeks,
    anchorDate: everyWeeks > 1 ? anchor : ""}, ok: true};
}

/**
 * Validates one route (a country by Sea or by Air).
 *
 * @param {*} raw The route a client sent.
 * @return {{route: ?object, errors: string[]}} The stored shape.
 */
function validateRoute(raw) {
  const errors = [];
  const add = (code) => {
    if (!errors.includes(code)) errors.push(code);
  };
  if (raw === null || raw === undefined) return {route: null, errors};
  if (!isObject(raw)) return {route: null, errors: ["price_list_invalid"]};
  const list = Array.isArray(raw.items) ? raw.items : [];
  if (list.length > LIMIT.ITEMS_PER_ROUTE) add("too_many_items");
  const items = [];
  const seenLabels = new Set();
  const seenIds = new Set();
  for (const entry of list.slice(0, LIMIT.ITEMS_PER_ROUTE)) {
    const item = isObject(entry) ? entry : {};
    const rawLabel = String(item.label ?? "").trim();
    if (!rawLabel) add("label_required");
    if (rawLabel.length > LIMIT.LABEL) add("label_too_long");
    const label = rawLabel.slice(0, LIMIT.LABEL);
    const key = label.toLowerCase();
    if (label && seenLabels.has(key)) add("label_duplicate");
    seenLabels.add(key);
    const categoryId = text(item.categoryId, 40);
    if (!CATEGORY_IDS.includes(categoryId)) add("category_invalid");
    const priceCents = centsIn(item.priceCents, LIMIT.PRICE_CENTS);
    if (priceCents === null) add("price_invalid");
    const included = item.includedLb === undefined ||
      item.includedLb === null || item.includedLb === "" ?
      0 : tenth(item.includedLb);
    if (!(included >= 0 && included <= LIMIT.INCLUDED_LB)) {
      add("included_invalid");
    }
    let id = ITEM_ID.test(text(item.id, 44)) ? text(item.id, 44) :
      itemIdFor(label);
    for (let n = 2; seenIds.has(id); n++) id = `${itemIdFor(label)}_${n}`;
    seenIds.add(id);
    items.push({id, categoryId, label, priceCents: priceCents || 0,
      includedLb: included >= 0 ? included : 0});
  }
  const perLbCents = {};
  const rates = isObject(raw.perLbCents) ? raw.perLbCents : {};
  for (const [categoryId, value] of Object.entries(rates)) {
    if (value === null || value === undefined || value === "") continue;
    if (!CATEGORY_IDS.includes(categoryId)) {
      add("category_invalid");
      continue;
    }
    const cents = centsIn(value, LIMIT.PER_LB_CENTS);
    if (cents === null) add("per_lb_invalid");
    else perLbCents[categoryId] = cents;
  }
  const {departure, ok} = cleanDeparture(raw.departure);
  if (!ok) add("departure_invalid");
  if (errors.length) return {route: null, errors};
  const empty = items.length === 0 && Object.keys(perLbCents).length === 0 &&
    !departure;
  return {route: empty ? null : {items, perLbCents, departure}, errors};
}

/**
 * Validates a whole price list.
 *
 * @param {*} raw {routes: {[countryId]: {sea?, air?}}}.
 * @param {string[]} countryIds The countries this business ships to.
 * @return {{routes: ?object, errors: string[]}} The stored routes map.
 */
function validatePriceList(raw, countryIds) {
  const data = isObject(raw) ? raw : {};
  const input = isObject(data.routes) ? data.routes : null;
  if (!input) return {routes: null, errors: ["price_list_invalid"]};
  const known = new Set(Array.isArray(countryIds) ? countryIds : []);
  const errors = [];
  const add = (code) => {
    if (!errors.includes(code)) errors.push(code);
  };
  const entries = Object.entries(input);
  if (entries.length > LIMIT.ROUTES) add("too_many_routes");
  const routes = {};
  for (const [countryId, value] of entries.slice(0, LIMIT.ROUTES)) {
    if (!known.has(countryId)) {
      add("country_unknown");
      continue;
    }
    if (!isObject(value)) {
      add("price_list_invalid");
      continue;
    }
    for (const key of Object.keys(value)) {
      if (!MODES.includes(key)) add("mode_invalid");
    }
    const pair = {};
    for (const mode of MODES) {
      const {route, errors: routeErrors} = validateRoute(value[mode]);
      routeErrors.forEach(add);
      if (route) pair[mode] = route;
    }
    if (Object.keys(pair).length) routes[countryId] = pair;
  }
  return errors.length ? {routes: null, errors} : {routes, errors};
}

/**
 * @param {*} list A stored price list (or its `routes`).
 * @param {string} countryId The destination.
 * @param {string} mode "sea" | "air".
 * @return {?object} The route, or null when the business priced nothing.
 */
function routeOf(list, countryId, mode) {
  const routes = isObject(list?.routes) ? list.routes : (isObject(list) ?
    list : {});
  const pair = isObject(routes[countryId]) ? routes[countryId] : {};
  const route = pair[mode === "air" ? "air" : "sea"];
  return isObject(route) ? route : null;
}

/**
 * The rate charged per pound above an item's included weight: its own
 * category's rate, else the route's general rate; null means staff decide.
 *
 * @param {object} route The route.
 * @param {string} categoryId The item's category.
 * @return {?number} Cents per pound.
 */
function excessRateCents(route, categoryId) {
  const rates = isObject(route?.perLbCents) ? route.perLbCents : {};
  const own = rates[categoryId];
  if (Number.isInteger(own) && own > 0) return own;
  const general = rates.general;
  return Number.isInteger(general) && general > 0 ? general : null;
}

/**
 * Prices one piece a customer added, at today's prices.
 *
 * A piece is one of:
 * - `{priceItemId, quantity}`: an item from the list;
 * - `{categoryId, weightLb}`: a category priced by the pound;
 * - `{kind: "barrel"}`: priced by the destination's barrel price;
 * - anything else ("ask me"): no price, staff estimate it.
 *
 * @param {object} route The route (or null).
 * @param {object} piece The piece as sent.
 * @param {object} ctx {barrelPriceCents}.
 * @return {{price: ?object, estimateCents: ?number, description: string,
 *   error: string}} `price` is the snapshot stored on the piece.
 */
function pricePiece(route, piece, ctx = {}) {
  const p = isObject(piece) ? piece : {};
  const itemId = text(p.priceItemId, 44);
  const categoryId = text(p.categoryId, 40);
  if (itemId) {
    const quantity = Number(p.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 ||
        quantity > LIMIT.QUANTITY) {
      return {price: null, estimateCents: null, description: "",
        error: "quantity_invalid"};
    }
    const item = (route?.items || []).find((row) => row.id === itemId);
    if (!item) {
      // Taken off the list since the customer looked: it becomes "ask me"
      // (today's prices rule) rather than refusing the request.
      const label = text(p.label, LIMIT.LABEL);
      return {price: null, estimateCents: null,
        description: label ? `${quantity} × ${label}` : "", error: ""};
    }
    return {
      price: {
        source: "item",
        itemId: item.id,
        label: item.label,
        categoryId: item.categoryId,
        quantity,
        unitCents: item.priceCents,
        includedLb: item.includedLb || 0,
        excessPerLbCents: item.includedLb > 0 ?
          excessRateCents(route, item.categoryId) : null,
        perLbCents: null,
        weightLb: null,
      },
      estimateCents: item.priceCents * quantity,
      description: quantity > 1 ? `${quantity} × ${item.label}` : item.label,
      error: "",
    };
  }
  if (categoryId && p.weightLb !== undefined && p.weightLb !== null &&
      p.weightLb !== "") {
    if (!CATEGORY_IDS.includes(categoryId)) {
      return {price: null, estimateCents: null, description: "",
        error: "category_invalid"};
    }
    const weightLb = tenth(p.weightLb);
    if (!(weightLb >= 0.1 && weightLb <= LIMIT.WEIGHT_LB)) {
      return {price: null, estimateCents: null, description: "",
        error: "weight_invalid"};
    }
    const rate = route?.perLbCents?.[categoryId];
    const label = CATEGORIES.find((c) => c.id === categoryId).en;
    if (!Number.isInteger(rate) || rate <= 0) {
      return {price: null, estimateCents: null,
        description: `${label} · ${weightLb} lb`, error: ""};
    }
    return {
      price: {
        source: "per_lb",
        itemId: "",
        label,
        categoryId,
        quantity: 1,
        unitCents: null,
        includedLb: 0,
        excessPerLbCents: null,
        perLbCents: rate,
        weightLb,
      },
      estimateCents: Math.round(rate * weightLb),
      description: `${label} · ${weightLb} lb`,
      error: "",
    };
  }
  if (text(p.kind, 20) === "barrel") {
    const cents = Number.isInteger(ctx.barrelPriceCents) &&
      ctx.barrelPriceCents > 0 ? ctx.barrelPriceCents : null;
    return {price: cents ? {source: "barrel", itemId: "", label: "Barrel",
      categoryId: "", quantity: 1, unitCents: cents, includedLb: 0,
      excessPerLbCents: null, perLbCents: null, weightLb: null} : null,
    estimateCents: cents, description: "", error: ""};
  }
  return {price: null, estimateCents: null, description: "", error: ""};
}

/**
 * The price once the counter scale has spoken. Fixed items without an
 * included weight never change; "up to X lb" items add the extra pounds at
 * the excess rate; by-the-pound pieces are rate × weight. Null when the
 * extra weight has no rate (staff type the price).
 *
 * @param {?object} price The snapshot on the piece.
 * @param {*} weighedLb What the scale read for the whole piece.
 * @return {?number} Cents.
 */
function counterPriceCents(price, weighedLb) {
  if (!isObject(price)) return null;
  const weight = tenth(weighedLb);
  if (price.source === "per_lb") {
    if (!(weight > 0)) return null;
    return Math.round(price.perLbCents * weight);
  }
  if (price.source === "barrel") return price.unitCents;
  if (price.source !== "item") return null;
  const base = price.unitCents * price.quantity;
  if (!(price.includedLb > 0)) return base;
  if (!(weight >= 0)) return null;
  const extra = Math.round((weight - price.includedLb * price.quantity) * 10) /
    10;
  if (extra <= 0) return base;
  if (!Number.isInteger(price.excessPerLbCents)) return null;
  return base + Math.round(extra * price.excessPerLbCents);
}

/**
 * Prices a customer's whole basket against one business's route.
 *
 * @param {?object} route The route.
 * @param {object[]} pieces The pieces as sent.
 * @param {object} ctx {barrelPriceCents, pickupFeeCents?}.
 * @return {{pieces: object[], pricedCents: number, unpricedCount: number,
 *   allPriced: boolean, totalCents: ?number, weighsAtCounter: boolean,
 *   errors: string[]}} totalCents is null unless every piece is priced.
 */
function priceBasket(route, pieces, ctx = {}) {
  const list = Array.isArray(pieces) ? pieces : [];
  const errors = [];
  const rows = list.map((piece) => {
    const result = pricePiece(route, piece, ctx);
    if (result.error && !errors.includes(result.error)) {
      errors.push(result.error);
    }
    return result;
  });
  const priced = rows.filter((r) => Number.isInteger(r.estimateCents));
  const pricedCents = priced.reduce((sum, r) => sum + r.estimateCents, 0);
  const fee = Number.isInteger(ctx.pickupFeeCents) && ctx.pickupFeeCents > 0 ?
    ctx.pickupFeeCents : 0;
  const unpricedCount = rows.length - priced.length;
  const allPriced = rows.length > 0 && unpricedCount === 0;
  return {
    pieces: rows,
    pricedCents: pricedCents + fee,
    unpricedCount,
    allPriced,
    totalCents: allPriced ? pricedCents + fee : null,
    weighsAtCounter: rows.some((r) => r.price && (r.price.source ===
      "per_lb" || (r.price.source === "item" && r.price.includedLb > 0))),
    errors,
  };
}

/**
 * Re-prices the stored pieces of an open request at today's list (owner
 * decision 10). Only pieces priced from the list (item / per pound) move; a
 * piece whose item left the list keeps its price (staff decide at the
 * counter); barrels and "ask me" pieces are left alone.
 *
 * @param {object[]} pieces Stored request pieces (with `price`).
 * @param {?object} route Today's route.
 * @return {{pieces: object[], changed: boolean, wentUp: boolean,
 *   cents: Map<string, number>}} `cents`: the new estimate per piece id.
 */
function repricePieces(pieces, route) {
  const list = Array.isArray(pieces) ? pieces : [];
  let changed = false;
  let wentUp = false;
  const cents = new Map();
  const next = list.map((piece) => {
    const source = piece?.price?.source;
    if (source !== "item" && source !== "per_lb") return piece;
    const again = pricePiece(route, source === "item" ?
      {priceItemId: piece.price.itemId, quantity: piece.price.quantity} :
      {categoryId: piece.price.categoryId, weightLb: piece.price.weightLb});
    if (!again.price || !Number.isInteger(again.estimateCents)) return piece;
    const before = Number.isInteger(piece.estimateCents) ?
      piece.estimateCents : null;
    if (before === again.estimateCents &&
        JSON.stringify(piece.price) === JSON.stringify(again.price)) {
      return piece;
    }
    changed = true;
    if (before === null || again.estimateCents > before) wentUp = true;
    cents.set(piece.id, again.estimateCents);
    return {...piece, price: again.price, estimateCents: again.estimateCents};
  });
  return {pieces: next, changed, wentUp, cents};
}

// ---------------------------------------------------------------------------
// Next departure (owner decision 5).
// ---------------------------------------------------------------------------

/**
 * @param {string} key "YYYY-MM-DD".
 * @return {boolean} Whether it is a real calendar day.
 */
function dateKeyValid(key) {
  if (!DATE_KEY.test(String(key || ""))) return false;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d;
}

/**
 * @param {string} key "YYYY-MM-DD".
 * @param {number} days Days to add.
 * @return {string} The new key.
 */
function addDays(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
      .toISOString().slice(0, 10);
}

/**
 * @param {string} key "YYYY-MM-DD".
 * @return {string} "mon".."sun".
 */
function weekdayOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return WEEK_DAYS[(js + 6) % 7];
}

/**
 * The next day the schedule leaves, from `todayKey` (inclusive).
 *
 * @param {?object} departure {weekdays, everyWeeks, anchorDate}.
 * @param {string} todayKey Today in the business's zone.
 * @return {string} "YYYY-MM-DD", or "" when no schedule.
 */
function nextScheduledDate(departure, todayKey) {
  if (!isObject(departure) || !dateKeyValid(todayKey)) return "";
  const days = Array.isArray(departure.weekdays) ? departure.weekdays : [];
  if (!days.length) return "";
  const every = Number(departure.everyWeeks || 1);
  const anchor = every > 1 && dateKeyValid(departure.anchorDate) ?
    departure.anchorDate : "";
  // Monday of the anchor week; a week counts when it is a multiple of
  // `every` weeks from it.
  const mondayOf = (key) => addDays(key, -WEEK_DAYS.indexOf(weekdayOf(key)));
  const anchorMonday = anchor ? mondayOf(anchor) : "";
  for (let i = 0; i < 7 * Math.max(1, every) + 7; i++) {
    const key = addDays(todayKey, i);
    if (!days.includes(weekdayOf(key))) continue;
    if (anchorMonday) {
      const weeks = Math.round((Date.parse(mondayOf(key)) -
        Date.parse(anchorMonday)) / (7 * DAY_MS));
      if (((weeks % every) + every) % every !== 0) continue;
    }
    return key;
  }
  return "";
}

/**
 * What the comparison row says about the next departure.
 *
 * A container/flight with a planned departure date wins over the schedule.
 * A planned date that has passed with the shipment still not gone makes the
 * row say "Departure date not confirmed", whatever the schedule says.
 *
 * @param {object} input {departure (schedule or null), planned: [{dateKey,
 *   departed: bool}], todayKey}.
 * @return {{dateKey: string, source: string, approximate: boolean}} source
 *   "planned" | "schedule" | "unconfirmed" | "none".
 */
function nextDeparture({departure, planned, todayKey}) {
  const list = (Array.isArray(planned) ? planned : [])
      .filter((p) => p && dateKeyValid(p.dateKey) && !p.departed);
  const upcoming = list.filter((p) => p.dateKey >= todayKey)
      .map((p) => p.dateKey).sort();
  if (upcoming.length) {
    return {dateKey: upcoming[0], source: "planned", approximate: false};
  }
  if (list.some((p) => p.dateKey < todayKey)) {
    return {dateKey: "", source: "unconfirmed", approximate: false};
  }
  const key = nextScheduledDate(departure, todayKey);
  if (key) {
    return {dateKey: key, source: "schedule",
      approximate: Number(departure?.everyWeeks || 1) > 1};
  }
  return {dateKey: "", source: "none", approximate: false};
}

// ---------------------------------------------------------------------------
// The comparison list (owner decisions 1 and 3).
// ---------------------------------------------------------------------------

const SORTS = Object.freeze(["best", "price", "rating", "soonest"]);

/**
 * Orders the businesses a customer compares.
 *
 * - best (default): every piece priced first, then the fewest pieces left
 *   to quote, then lowest total (known total, else what is priced so far),
 *   then rating, then name;
 * - price: the same without the rating;
 * - rating: highest rating first, unrated last;
 * - soonest: earliest next departure first, none last.
 *
 * @param {object[]} options {businessId, businessName, allPriced,
 *   unpricedCount, totalCents, pricedCents, rating (0..5 or null), reviewCount,
 *   departureKey ("" when none)}.
 * @param {string} sort One of SORTS.
 * @return {object[]} A new sorted array.
 */
function rankOptions(options, sort = "best") {
  const list = Array.isArray(options) ? options.slice() : [];
  const total = (o) => Number.isInteger(o.totalCents) ? o.totalCents :
    Number.MAX_SAFE_INTEGER;
  const partial = (o) => Number.isInteger(o.pricedCents) ? o.pricedCents :
    Number.MAX_SAFE_INTEGER;
  const rating = (o) => Number.isFinite(o.rating) && o.reviewCount > 0 ?
    o.rating : -1;
  const departure = (o) => o.departureKey || "9999-99-99";
  const left = (o) => Number.isInteger(o.unpricedCount) ? o.unpricedCount :
    Number.MAX_SAFE_INTEGER;
  const name = (a, b) => String(a.businessName || "")
      .localeCompare(String(b.businessName || "")) ||
    String(a.businessId).localeCompare(String(b.businessId));
  const by = {
    best: (a, b) => (Number(!!b.allPriced) - Number(!!a.allPriced)) ||
      left(a) - left(b) ||
      (a.allPriced ? total(a) - total(b) : partial(a) - partial(b)) ||
      rating(b) - rating(a) || name(a, b),
    price: (a, b) => (Number(!!b.allPriced) - Number(!!a.allPriced)) ||
      left(a) - left(b) ||
      (a.allPriced ? total(a) - total(b) : partial(a) - partial(b)) ||
      name(a, b),
    rating: (a, b) => rating(b) - rating(a) ||
      (b.reviewCount || 0) - (a.reviewCount || 0) || name(a, b),
    soonest: (a, b) => departure(a).localeCompare(departure(b)) ||
      total(a) - total(b) || name(a, b),
  };
  return list.sort(by[SORTS.includes(sort) ? sort : "best"]);
}

/**
 * Where a request came from (owner decision 4): "laawol" when the customer
 * found the business on Laawol (the comparison list), "business" when they
 * came through the business's own link, QR or WhatsApp QR.
 *
 * @param {*} value What the client sent.
 * @return {string} "laawol" | "business".
 */
function foundVia(value) {
  return text(value, 20) === "business" ? "business" : "laawol";
}

module.exports = {
  CATEGORIES,
  CATEGORY_IDS,
  MODES,
  WEEK_DAYS,
  SIZE_PRESETS,
  LIMIT,
  SORTS,
  PRICE_LIST_MESSAGES,
  itemIdFor,
  cleanDeparture,
  validateRoute,
  validatePriceList,
  routeOf,
  excessRateCents,
  pricePiece,
  counterPriceCents,
  priceBasket,
  repricePieces,
  dateKeyValid,
  addDays,
  weekdayOf,
  nextScheduledDate,
  nextDeparture,
  rankOptions,
  foundVia,
};

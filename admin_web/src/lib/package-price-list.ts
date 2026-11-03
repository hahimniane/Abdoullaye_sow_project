// Business price lists for "Send a package" (docs/PACKAGE_PRICE_LIST.md).
//
// An exact mirror of my_flutter_app/functions/package_price_list.js (and
// my_flutter_app/lib/services/package_price_list.dart). All three run the
// shared fixture my_flutter_app/functions/test/fixtures/package-price-list-cases.json,
// so the console, the customer form and the server price a basket the same
// way. Pure: no Firestore, no clock except what callers pass.

export type PriceMode = "sea" | "air";
export type WeekDayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type PriceCategory = { id: string; en: string; fr: string };

export const CATEGORIES: readonly PriceCategory[] = Object.freeze([
  { id: "general", en: "General goods", fr: "Marchandises générales" },
  { id: "clothing", en: "Clothes and fabric", fr: "Vêtements et tissus" },
  { id: "food", en: "Food", fr: "Nourriture" },
  { id: "documents", en: "Documents", fr: "Documents" },
  { id: "cosmetics", en: "Cosmetics and liquids", fr: "Cosmétiques et liquides" },
  { id: "electronics", en: "Electronics", fr: "Électronique" },
  { id: "fragile", en: "Fragile items", fr: "Objets fragiles" },
]);
export const CATEGORY_IDS: readonly string[] = Object.freeze(CATEGORIES.map((c) => c.id));
export const MODES: readonly PriceMode[] = Object.freeze(["sea", "air"] as PriceMode[]);
export const WEEK_DAYS: readonly WeekDayKey[] = Object.freeze(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as WeekDayKey[],
);

/** One-tap weights for things priced by the pound (owner decision 9). */
export const SIZE_PRESETS = Object.freeze([
  { id: "small_bag", lb: 10, en: "Small bag", fr: "Petit sac" },
  { id: "suitcase", lb: 50, en: "Suitcase", fr: "Valise" },
  { id: "big_box", lb: 70, en: "Big box", fr: "Grand carton" },
]);

export const LIMIT = Object.freeze({
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

export const SORTS = Object.freeze(["best", "price", "rating", "soonest"]);

const ITEM_ID = /^i_[a-z0-9_]{1,40}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the server says when it refuses a price list (details.reason). */
export const PRICE_LIST_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
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

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type PriceItem = {
  id: string;
  categoryId: string;
  label: string;
  priceCents: number;
  includedLb: number;
};

export type Departure = {
  weekdays: WeekDayKey[];
  everyWeeks: number;
  anchorDate: string;
};

export type Route = {
  items: PriceItem[];
  perLbCents: Record<string, number>;
  departure: Departure | null;
};

export type RoutePair = { sea?: Route; air?: Route };
export type RoutesMap = Record<string, RoutePair>;

export type PiecePrice = {
  source: "item" | "per_lb" | "barrel";
  itemId: string;
  label: string;
  categoryId: string;
  quantity: number;
  unitCents: number | null;
  includedLb: number;
  excessPerLbCents: number | null;
  perLbCents: number | null;
  weightLb: number | null;
};

export type PricedPiece = {
  price: PiecePrice | null;
  estimateCents: number | null;
  description: string;
  error: string;
};

export type BasketResult = {
  pieces: PricedPiece[];
  pricedCents: number;
  unpricedCount: number;
  allPriced: boolean;
  totalCents: number | null;
  weighsAtCounter: boolean;
  errors: string[];
};

export type RepriceResult<P> = {
  pieces: P[];
  changed: boolean;
  wentUp: boolean;
  cents: Map<string, number>;
};

export type NextDepartureResult = {
  dateKey: string;
  source: "planned" | "schedule" | "unconfirmed" | "none";
  approximate: boolean;
};

export type RankOption = {
  businessId: string;
  businessName?: string;
  allPriced?: boolean;
  unpricedCount?: number | null;
  totalCents?: number | null;
  pricedCents?: number | null;
  rating?: number | null;
  reviewCount?: number;
  departureKey?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const text = (value: unknown, max = 200): string => String(value ?? "").trim().slice(0, max);
const isObject = (value: unknown): value is Record<string, Loose> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Whole cents from a client value; null when not a whole positive number in range. */
function centsIn(value: unknown, max: number): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
}

/** Pounds rounded to a tenth (NaN when not a finite number). */
function tenth(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN;
}

/** A stable id for an item name ("Phone (any)" -> "i_phone_any"). */
export function itemIdFor(label: string): string {
  const slug = text(label, LIMIT.LABEL)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return `i_${slug || "item"}`;
}

/** @returns departure null when none is set. */
export function cleanDeparture(raw: unknown): { departure: Departure | null; ok: boolean } {
  if (raw === null || raw === undefined) return { departure: null, ok: true };
  if (!isObject(raw)) return { departure: null, ok: false };
  const days: unknown[] = Array.isArray(raw.weekdays) ? raw.weekdays : [];
  const weekdays = WEEK_DAYS.filter((d) => days.includes(d));
  if (weekdays.length === 0) {
    // An empty schedule is "not set"; anything unknown in it is an error.
    return { departure: null, ok: days.length === 0 };
  }
  if (weekdays.length !== new Set(days).size) {
    return { departure: null, ok: false };
  }
  const everyWeeks = raw.everyWeeks === undefined || raw.everyWeeks === null ? 1 : Number(raw.everyWeeks);
  if (!Number.isInteger(everyWeeks) || everyWeeks < 1 || everyWeeks > LIMIT.EVERY_WEEKS) {
    return { departure: null, ok: false };
  }
  const anchor = text(raw.anchorDate, 10);
  if (everyWeeks > 1 && !dateKeyValid(anchor)) {
    return { departure: null, ok: false };
  }
  return {
    departure: { weekdays: [...weekdays], everyWeeks, anchorDate: everyWeeks > 1 ? anchor : "" },
    ok: true,
  };
}

/** Validates one route (a country by Sea or by Air). */
export function validateRoute(raw: unknown): { route: Route | null; errors: string[] } {
  const errors: string[] = [];
  const add = (code: string) => {
    if (!errors.includes(code)) errors.push(code);
  };
  if (raw === null || raw === undefined) return { route: null, errors };
  if (!isObject(raw)) return { route: null, errors: ["price_list_invalid"] };
  const list: unknown[] = Array.isArray(raw.items) ? raw.items : [];
  if (list.length > LIMIT.ITEMS_PER_ROUTE) add("too_many_items");
  const items: PriceItem[] = [];
  const seenLabels = new Set<string>();
  const seenIds = new Set<string>();
  for (const entry of list.slice(0, LIMIT.ITEMS_PER_ROUTE)) {
    const item: Record<string, Loose> = isObject(entry) ? entry : {};
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
    const included =
      item.includedLb === undefined || item.includedLb === null || item.includedLb === ""
        ? 0
        : tenth(item.includedLb);
    if (!(included >= 0 && included <= LIMIT.INCLUDED_LB)) {
      add("included_invalid");
    }
    let id = ITEM_ID.test(text(item.id, 44)) ? text(item.id, 44) : itemIdFor(label);
    for (let n = 2; seenIds.has(id); n++) id = `${itemIdFor(label)}_${n}`;
    seenIds.add(id);
    items.push({
      id,
      categoryId,
      label,
      priceCents: priceCents || 0,
      includedLb: included >= 0 ? included : 0,
    });
  }
  const perLbCents: Record<string, number> = {};
  const rates: Record<string, Loose> = isObject(raw.perLbCents) ? raw.perLbCents : {};
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
  const { departure, ok } = cleanDeparture(raw.departure);
  if (!ok) add("departure_invalid");
  if (errors.length) return { route: null, errors };
  const empty = items.length === 0 && Object.keys(perLbCents).length === 0 && !departure;
  return { route: empty ? null : { items, perLbCents, departure }, errors };
}

/** Validates a whole price list ({routes: {[countryId]: {sea?, air?}}}). */
export function validatePriceList(
  raw: unknown,
  countryIds: string[],
): { routes: RoutesMap | null; errors: string[] } {
  const data: Record<string, Loose> = isObject(raw) ? raw : {};
  const input = isObject(data.routes) ? data.routes : null;
  if (!input) return { routes: null, errors: ["price_list_invalid"] };
  const known = new Set(Array.isArray(countryIds) ? countryIds : []);
  const errors: string[] = [];
  const add = (code: string) => {
    if (!errors.includes(code)) errors.push(code);
  };
  const entries = Object.entries(input);
  if (entries.length > LIMIT.ROUTES) add("too_many_routes");
  const routes: RoutesMap = {};
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
      if (!(MODES as readonly string[]).includes(key)) add("mode_invalid");
    }
    const pair: RoutePair = {};
    for (const mode of MODES) {
      const { route, errors: routeErrors } = validateRoute(value[mode]);
      routeErrors.forEach(add);
      if (route) pair[mode] = route;
    }
    if (Object.keys(pair).length) routes[countryId] = pair;
  }
  return errors.length ? { routes: null, errors } : { routes, errors };
}

/** The route for a country and mode, or null when the business priced nothing. */
export function routeOf(list: unknown, countryId: string, mode: string): Route | null {
  const l = list as Loose;
  const routes: Record<string, Loose> = isObject(l?.routes) ? l.routes : isObject(l) ? l : {};
  const pair: Record<string, Loose> = isObject(routes[countryId]) ? routes[countryId] : {};
  const route = pair[mode === "air" ? "air" : "sea"];
  return isObject(route) ? (route as Route) : null;
}

/**
 * The rate charged per pound above an item's included weight: its own
 * category's rate, else the route's general rate; null means staff decide.
 */
export function excessRateCents(route: Loose, categoryId: string): number | null {
  const rates: Record<string, Loose> = isObject(route?.perLbCents) ? route.perLbCents : {};
  const own = rates[categoryId];
  if (Number.isInteger(own) && own > 0) return own;
  const general = rates.general;
  return Number.isInteger(general) && general > 0 ? general : null;
}

/**
 * Prices one piece a customer added, at today's prices.
 * - `{priceItemId, quantity}`: an item from the list;
 * - `{categoryId, weightLb}`: a category priced by the pound;
 * - `{kind: "barrel"}`: priced by the destination's barrel price;
 * - anything else ("ask me"): no price, staff estimate it.
 */
export function pricePiece(
  route: Loose,
  piece: unknown,
  ctx: { barrelPriceCents?: number | null } = {},
): PricedPiece {
  const p: Record<string, Loose> = isObject(piece) ? piece : {};
  const itemId = text(p.priceItemId, 44);
  const categoryId = text(p.categoryId, 40);
  if (itemId) {
    const quantity = Number(p.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > LIMIT.QUANTITY) {
      return { price: null, estimateCents: null, description: "", error: "quantity_invalid" };
    }
    const item = ((route?.items || []) as PriceItem[]).find((row) => row.id === itemId);
    if (!item) {
      // Taken off the list since the customer looked: it becomes "ask me"
      // (today's prices rule) rather than refusing the request.
      const label = text(p.label, LIMIT.LABEL);
      return {
        price: null,
        estimateCents: null,
        description: label ? `${quantity} × ${label}` : "",
        error: "",
      };
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
        excessPerLbCents: item.includedLb > 0 ? excessRateCents(route, item.categoryId) : null,
        perLbCents: null,
        weightLb: null,
      },
      estimateCents: item.priceCents * quantity,
      description: quantity > 1 ? `${quantity} × ${item.label}` : item.label,
      error: "",
    };
  }
  if (categoryId && p.weightLb !== undefined && p.weightLb !== null && p.weightLb !== "") {
    if (!CATEGORY_IDS.includes(categoryId)) {
      return { price: null, estimateCents: null, description: "", error: "category_invalid" };
    }
    const weightLb = tenth(p.weightLb);
    if (!(weightLb >= 0.1 && weightLb <= LIMIT.WEIGHT_LB)) {
      return { price: null, estimateCents: null, description: "", error: "weight_invalid" };
    }
    const rate = route?.perLbCents?.[categoryId];
    const label = (CATEGORIES.find((c) => c.id === categoryId) as PriceCategory).en;
    if (!Number.isInteger(rate) || rate <= 0) {
      return {
        price: null,
        estimateCents: null,
        description: `${label} · ${weightLb} lb`,
        error: "",
      };
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
    const barrel = ctx.barrelPriceCents;
    const cents = Number.isInteger(barrel) && (barrel as number) > 0 ? (barrel as number) : null;
    return {
      price: cents
        ? {
            source: "barrel",
            itemId: "",
            label: "Barrel",
            categoryId: "",
            quantity: 1,
            unitCents: cents,
            includedLb: 0,
            excessPerLbCents: null,
            perLbCents: null,
            weightLb: null,
          }
        : null,
      estimateCents: cents,
      description: "",
      error: "",
    };
  }
  return { price: null, estimateCents: null, description: "", error: "" };
}

/**
 * The price once the counter scale has spoken. Fixed items without an
 * included weight never change; "up to X lb" items add the extra pounds at
 * the excess rate; by-the-pound pieces are rate x weight. Null when the
 * extra weight has no rate (staff type the price).
 */
export function counterPriceCents(price: unknown, weighedLb: unknown): number | null {
  if (!isObject(price)) return null;
  const pr = price as Loose;
  const weight = tenth(weighedLb);
  if (pr.source === "per_lb") {
    if (!(weight > 0)) return null;
    return Math.round(pr.perLbCents * weight);
  }
  if (pr.source === "barrel") return pr.unitCents;
  if (pr.source !== "item") return null;
  const base = pr.unitCents * pr.quantity;
  if (!(pr.includedLb > 0)) return base;
  if (!(weight >= 0)) return null;
  const extra = Math.round((weight - pr.includedLb * pr.quantity) * 10) / 10;
  if (extra <= 0) return base;
  if (!Number.isInteger(pr.excessPerLbCents)) return null;
  return base + Math.round(extra * pr.excessPerLbCents);
}

/** Prices a customer's whole basket against one business's route. */
export function priceBasket(
  route: Loose,
  pieces: unknown,
  ctx: { barrelPriceCents?: number | null; pickupFeeCents?: number | null } = {},
): BasketResult {
  const list: unknown[] = Array.isArray(pieces) ? pieces : [];
  const errors: string[] = [];
  const rows = list.map((piece) => {
    const result = pricePiece(route, piece, ctx);
    if (result.error && !errors.includes(result.error)) {
      errors.push(result.error);
    }
    return result;
  });
  const priced = rows.filter((r) => Number.isInteger(r.estimateCents));
  const pricedCents = priced.reduce((sum, r) => sum + (r.estimateCents as number), 0);
  const feeRaw = ctx.pickupFeeCents;
  const fee = Number.isInteger(feeRaw) && (feeRaw as number) > 0 ? (feeRaw as number) : 0;
  const unpricedCount = rows.length - priced.length;
  const allPriced = rows.length > 0 && unpricedCount === 0;
  return {
    pieces: rows,
    pricedCents: pricedCents + fee,
    unpricedCount,
    allPriced,
    totalCents: allPriced ? pricedCents + fee : null,
    weighsAtCounter: rows.some(
      (r) => r.price && (r.price.source === "per_lb" || (r.price.source === "item" && r.price.includedLb > 0)),
    ),
    errors,
  };
}

/**
 * Re-prices the stored pieces of an open request at today's list (owner
 * decision 10). Only pieces priced from the list (item / per pound) move; a
 * piece whose item left the list keeps its price; barrels and "ask me"
 * pieces are left alone.
 */
export function repricePieces<P extends Record<string, Loose>>(
  pieces: P[],
  route: Loose,
): RepriceResult<P> {
  const list: P[] = Array.isArray(pieces) ? pieces : [];
  let changed = false;
  let wentUp = false;
  const cents = new Map<string, number>();
  const next = list.map((piece) => {
    const source = piece?.price?.source;
    if (source !== "item" && source !== "per_lb") return piece;
    const again = pricePiece(
      route,
      source === "item"
        ? { priceItemId: piece.price.itemId, quantity: piece.price.quantity }
        : { categoryId: piece.price.categoryId, weightLb: piece.price.weightLb },
    );
    if (!again.price || !Number.isInteger(again.estimateCents)) return piece;
    const before = Number.isInteger(piece.estimateCents) ? (piece.estimateCents as number) : null;
    if (before === again.estimateCents && JSON.stringify(piece.price) === JSON.stringify(again.price)) {
      return piece;
    }
    changed = true;
    if (before === null || (again.estimateCents as number) > before) wentUp = true;
    cents.set(piece.id, again.estimateCents as number);
    return { ...piece, price: again.price, estimateCents: again.estimateCents };
  });
  return { pieces: next, changed, wentUp, cents };
}

// ---------------------------------------------------------------------------
// Next departure (owner decision 5).
// ---------------------------------------------------------------------------

/** Whether "YYYY-MM-DD" is a real calendar day. */
export function dateKeyValid(key: unknown): boolean {
  if (!DATE_KEY.test(String(key || ""))) return false;
  const [y, m, d] = (key as string).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "YYYY-MM-DD" plus `days`. */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "mon".."sun" for "YYYY-MM-DD". */
export function weekdayOf(key: string): WeekDayKey {
  const [y, m, d] = key.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return WEEK_DAYS[(js + 6) % 7];
}

/** The next day the schedule leaves, from `todayKey` (inclusive); "" when none. */
export function nextScheduledDate(departure: unknown, todayKey: string): string {
  if (!isObject(departure) || !dateKeyValid(todayKey)) return "";
  const dep = departure as Loose;
  const days: string[] = Array.isArray(dep.weekdays) ? dep.weekdays : [];
  if (!days.length) return "";
  const every = Number(dep.everyWeeks || 1);
  const anchor = every > 1 && dateKeyValid(dep.anchorDate) ? (dep.anchorDate as string) : "";
  // Monday of the anchor week; a week counts when it is a multiple of
  // `every` weeks from it.
  const mondayOf = (key: string) => addDays(key, -WEEK_DAYS.indexOf(weekdayOf(key)));
  const anchorMonday = anchor ? mondayOf(anchor) : "";
  for (let i = 0; i < 7 * Math.max(1, every) + 7; i++) {
    const key = addDays(todayKey, i);
    if (!days.includes(weekdayOf(key))) continue;
    if (anchorMonday) {
      const weeks = Math.round((Date.parse(mondayOf(key)) - Date.parse(anchorMonday)) / (7 * DAY_MS));
      if (((weeks % every) + every) % every !== 0) continue;
    }
    return key;
  }
  return "";
}

/**
 * What the comparison row says about the next departure. A planned date on a
 * container/flight wins over the schedule; a planned date that passed with
 * the shipment still not gone says "Departure date not confirmed".
 */
export function nextDeparture(input: {
  departure?: unknown;
  planned?: { dateKey: string; departed?: boolean }[] | null;
  todayKey: string;
}): NextDepartureResult {
  const { departure, planned, todayKey } = input;
  const list = (Array.isArray(planned) ? planned : []).filter(
    (p) => p && dateKeyValid(p.dateKey) && !p.departed,
  );
  const upcoming = list
    .filter((p) => p.dateKey >= todayKey)
    .map((p) => p.dateKey)
    .sort();
  if (upcoming.length) {
    return { dateKey: upcoming[0], source: "planned", approximate: false };
  }
  if (list.some((p) => p.dateKey < todayKey)) {
    return { dateKey: "", source: "unconfirmed", approximate: false };
  }
  const key = nextScheduledDate(departure, todayKey);
  if (key) {
    return {
      dateKey: key,
      source: "schedule",
      approximate: Number((departure as Loose)?.everyWeeks || 1) > 1,
    };
  }
  return { dateKey: "", source: "none", approximate: false };
}

// ---------------------------------------------------------------------------
// The comparison list (owner decisions 1 and 3).
// ---------------------------------------------------------------------------

/**
 * Orders the businesses a customer compares. best (default): every piece
 * priced first, then fewest left to quote, then lowest total, then rating,
 * then name; price: the same without rating; rating: highest first, unrated
 * last; soonest: earliest next departure first, none last.
 */
export function rankOptions<O extends RankOption>(options: O[], sort = "best"): O[] {
  const list = Array.isArray(options) ? options.slice() : [];
  const MAX = Number.MAX_SAFE_INTEGER;
  const total = (o: O) => (Number.isInteger(o.totalCents) ? (o.totalCents as number) : MAX);
  const partial = (o: O) => (Number.isInteger(o.pricedCents) ? (o.pricedCents as number) : MAX);
  const rating = (o: O) =>
    Number.isFinite(o.rating) && (o.reviewCount || 0) > 0 ? (o.rating as number) : -1;
  const departure = (o: O) => o.departureKey || "9999-99-99";
  const left = (o: O) => (Number.isInteger(o.unpricedCount) ? (o.unpricedCount as number) : MAX);
  const name = (a: O, b: O) =>
    String(a.businessName || "").localeCompare(String(b.businessName || "")) ||
    String(a.businessId).localeCompare(String(b.businessId));
  const by: Record<string, (a: O, b: O) => number> = {
    best: (a, b) =>
      Number(!!b.allPriced) - Number(!!a.allPriced) ||
      left(a) - left(b) ||
      (a.allPriced ? total(a) - total(b) : partial(a) - partial(b)) ||
      rating(b) - rating(a) ||
      name(a, b),
    price: (a, b) =>
      Number(!!b.allPriced) - Number(!!a.allPriced) ||
      left(a) - left(b) ||
      (a.allPriced ? total(a) - total(b) : partial(a) - partial(b)) ||
      name(a, b),
    rating: (a, b) =>
      rating(b) - rating(a) || (b.reviewCount || 0) - (a.reviewCount || 0) || name(a, b),
    soonest: (a, b) =>
      departure(a).localeCompare(departure(b)) || total(a) - total(b) || name(a, b),
  };
  return list.sort(by[(SORTS as readonly string[]).includes(sort) ? sort : "best"]);
}

/**
 * Where a request came from (owner decision 4): "laawol" when the customer
 * found the business on Laawol, "business" when they used its own link/QR.
 */
export function foundVia(value: unknown): "laawol" | "business" {
  return text(value, 20) === "business" ? "business" : "laawol";
}

/**
 * The customer's "Send a package" flow, as pure rules (docs/PACKAGE_PRICE_LIST.md
 * §6): country, Sea or Air, the items (built from what the businesses that ship
 * there price), how it reaches the business, the comparison with each
 * business's total, the drop-off or pickup time, and the payload.
 *
 * Pure: no Firebase, no React, no clock except what callers pass.
 * `package-price-list.ts` prices a basket the way the server does; the server
 * (functions/package_requests.js) stays the authority, so everything here only
 * lets a form say what is wrong, and what it will cost, before sending.
 *
 * Copy: sentences built from data (dates, money, hours, counts) are produced
 * here in the page's language and rendered `data-no-translate`; static
 * strings live in the components and french-dom.ts.
 */

import {
  CATEGORIES,
  LIMIT as PRICE_LIMIT,
  SIZE_PRESETS,
  priceBasket,
  rankOptions,
  type BasketResult,
  type NextDepartureResult,
  type PiecePrice,
  type PriceMode,
} from "./package-price-list.ts";
import {
  DEFAULT_TIME_ZONE,
  PICKUP_WINDOW_LABELS,
  REQUEST_LIMITS,
  addDaysToKey,
  dateKeyValid,
  dayIsOpen,
  e164,
  moneyText,
  pickableDays,
  plannedDayText,
  selectedLocation,
  todayKeyIn,
  weekdayOfKey,
  type Handoff,
  type Lang,
  type PhotoDraft,
  type PickupWindow,
  type PublicPiecePrice,
  type PublicRequest,
  type RequestOption,
  type WeekHours,
} from "./package-requests.ts";

export type ShipMode = PriceMode;
export const SHIP_MODES: readonly ShipMode[] = ["sea", "air"];
export type SortKey = "best" | "price" | "rating" | "soonest";
export const SORT_KEYS: readonly SortKey[] = ["best", "price", "rating", "soonest"];

const text = (value: unknown, max = 200): string => String(value ?? "").trim().slice(0, max);

// ---------------------------------------------------------------------------
// Which businesses ship there, and by which mode.
// ---------------------------------------------------------------------------

/** The options for one country that can carry by `mode` (Air only where a business flies). */
export function modeOptions(options: readonly RequestOption[], countryId: string, mode: ShipMode): RequestOption[] {
  return options
    .filter((option) => option.country.id === countryId)
    .filter((option) => (mode === "air" ? option.shipsByAir === true : true))
    .sort((a, b) => a.businessName.localeCompare(b.businessName));
}

/** Whether any business offers Air to a country. */
export function airOffered(options: readonly RequestOption[], countryId: string): boolean {
  return modeOptions(options, countryId, "air").length > 0;
}

// ---------------------------------------------------------------------------
// The item catalog: what the businesses that ship there price.
// ---------------------------------------------------------------------------

export type ItemEntry = {
  key: string;
  label: string;
  categoryId: string;
  /** The smallest and largest "up to X lb each" among businesses (0 = no weight limit). */
  minIncludedLb: number;
  maxIncludedLb: number;
};

export type Catalog = {
  items: ItemEntry[];
  /** Categories priced per pound by at least one business, in the shared order. */
  categories: string[];
  /** A barrel at the destination's barrel price (sea only). */
  barrel: boolean;
};

const CATEGORY_ORDER = new Map<string, number>(CATEGORIES.map((category, index) => [category.id, index]));

export function itemKey(categoryId: string, label: string): string {
  return `${categoryId}|${text(label, 60).toLowerCase()}`;
}

export function categoryLabel(categoryId: string, lang: Lang): string {
  const category = CATEGORIES.find((row) => row.id === categoryId);
  return category ? category[lang === "fr" ? "fr" : "en"] : categoryId;
}

/** Items from `routes[mode].items` by name and category across businesses, plus per-pound categories and the barrel. */
export function buildCatalog(options: readonly RequestOption[], mode: ShipMode): Catalog {
  const items = new Map<string, ItemEntry>();
  const categories = new Set<string>();
  for (const option of options) {
    const route = option.routes?.[mode] ?? null;
    for (const item of route?.items ?? []) {
      if (!CATEGORY_ORDER.has(item.categoryId)) continue;
      const key = itemKey(item.categoryId, item.label);
      const included = Number(item.includedLb) > 0 ? Number(item.includedLb) : 0;
      const known = items.get(key);
      if (known) {
        known.minIncludedLb = Math.min(known.minIncludedLb, included);
        known.maxIncludedLb = Math.max(known.maxIncludedLb, included);
        // "Phone" and "phone" are one item: show the capitalised spelling.
        if (/^\p{Ll}/u.test(known.label) && /^\p{Lu}/u.test(item.label)) known.label = text(item.label, 60);
      } else {
        items.set(key, { key, label: text(item.label, 60), categoryId: item.categoryId, minIncludedLb: included, maxIncludedLb: included });
      }
    }
    for (const [categoryId, cents] of Object.entries(route?.perLbCents ?? {})) {
      if (CATEGORY_ORDER.has(categoryId) && Number(cents) > 0) categories.add(categoryId);
    }
  }
  const order = (id: string) => CATEGORY_ORDER.get(id) ?? 99;
  return {
    items: [...items.values()].sort((a, b) => order(a.categoryId) - order(b.categoryId) || a.label.localeCompare(b.label)),
    categories: [...categories].sort((a, b) => order(a) - order(b)),
    barrel: mode === "sea" && options.some((option) => Number(option.barrelPriceCents) > 0),
  };
}

/** "up to 2 lb each" for an item some business limits by weight, else "". */
export function includedLbText(entry: Pick<ItemEntry, "minIncludedLb" | "maxIncludedLb">, lang: Lang): string {
  const lo = entry.minIncludedLb;
  const hi = entry.maxIncludedLb;
  if (!(hi > 0)) return "";
  const range = lo > 0 && lo !== hi ? `${lo}–${hi}` : String(hi);
  // A business with no limit beside one with a limit: say the limit, not a promise.
  return lang === "fr" ? `jusqu’à ${range} lb chacun` : `up to ${range} lb each`;
}

// ---------------------------------------------------------------------------
// The basket the customer builds.
// ---------------------------------------------------------------------------

export type BasketLine =
  | { key: string; type: "item"; catalogKey: string; label: string; categoryId: string; quantity: number }
  | { key: string; type: "barrel"; quantity: number }
  | { key: string; type: "weight"; categoryId: string; weightLb: string; sizePreset: string }
  | { key: string; type: "other"; kind: "box" | "other"; description: string; photos: PhotoDraft[] };

let lineSerial = 0;
export function newLineKey(): string {
  lineSerial += 1;
  return `line-${Date.now()}-${lineSerial}`;
}

export function itemQuantity(lines: readonly BasketLine[], catalogKey: string): number {
  const line = lines.find((row) => row.type === "item" && row.catalogKey === catalogKey);
  return line && line.type === "item" ? line.quantity : 0;
}

/** Sets how many of an item (0 removes it); never above the server's 50. */
export function setItemQuantity(lines: readonly BasketLine[], entry: Pick<ItemEntry, "key" | "label" | "categoryId">, quantity: number): BasketLine[] {
  const n = Math.max(0, Math.min(PRICE_LIMIT.QUANTITY, Math.floor(Number(quantity) || 0)));
  const rest = lines.filter((row) => !(row.type === "item" && row.catalogKey === entry.key));
  if (n === 0) return rest;
  const own = lines.find((row) => row.type === "item" && row.catalogKey === entry.key);
  const next: BasketLine = { key: own?.key ?? newLineKey(), type: "item", catalogKey: entry.key, label: entry.label, categoryId: entry.categoryId, quantity: n };
  return own ? lines.map((row) => (row === own ? next : row)) : [...rest, next];
}

export function barrelQuantity(lines: readonly BasketLine[]): number {
  const line = lines.find((row) => row.type === "barrel");
  return line && line.type === "barrel" ? line.quantity : 0;
}

export function setBarrelQuantity(lines: readonly BasketLine[], quantity: number): BasketLine[] {
  const n = Math.max(0, Math.min(REQUEST_LIMITS.pieces, Math.floor(Number(quantity) || 0)));
  const own = lines.find((row) => row.type === "barrel");
  if (n === 0) return lines.filter((row) => row.type !== "barrel");
  if (own) return lines.map((row) => (row === own ? { ...row, quantity: n } : row));
  return [...lines, { key: newLineKey(), type: "barrel", quantity: n }];
}

export function addWeightLine(lines: readonly BasketLine[], categoryId: string): BasketLine[] {
  return [...lines, { key: newLineKey(), type: "weight", categoryId, weightLb: "", sizePreset: "" }];
}

export function addOtherLine(lines: readonly BasketLine[]): BasketLine[] {
  return [...lines, { key: newLineKey(), type: "other", kind: "box", description: "", photos: [] }];
}

/** A size button: fills the pounds with the preset's weight (still editable). */
export function applySizePreset(line: Extract<BasketLine, { type: "weight" }>, presetId: string): Extract<BasketLine, { type: "weight" }> {
  const preset = SIZE_PRESETS.find((row) => row.id === presetId);
  return preset ? { ...line, sizePreset: preset.id, weightLb: String(preset.lb) } : line;
}

/** Typing a weight by hand drops the size preset unless it still says the same number. */
export function typeWeight(line: Extract<BasketLine, { type: "weight" }>, typed: string): Extract<BasketLine, { type: "weight" }> {
  const preset = SIZE_PRESETS.find((row) => row.id === line.sizePreset);
  return { ...line, weightLb: typed, sizePreset: preset && String(preset.lb) === typed.trim() ? preset.id : "" };
}

/** Pounds as typed ("10", "10,5") to a tenth, or null outside the server's 0.1 to 2,000. */
export function readWeight(typed: string): number | null {
  const raw = text(typed, 12).replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const lb = Math.round(Number(raw) * 10) / 10;
  return lb >= 0.1 && lb <= PRICE_LIMIT.WEIGHT_LB ? lb : null;
}

/** How many physical pieces the basket is: a barrel each, one for any other line (an item's quantity is one piece). */
export function pieceCount(lines: readonly BasketLine[]): number {
  return lines.reduce((sum, line) => sum + (line.type === "barrel" ? line.quantity : 1), 0);
}

export function photosStillUploading(lines: readonly BasketLine[]): boolean {
  return lines.some((line) => line.type === "other" && line.photos.some((photo) => photo.status === "uploading"));
}

/** What is wrong with the items step, as the server's codes. */
export function itemsProblems(lines: readonly BasketLine[]): string[] {
  const errors: string[] = [];
  const add = (code: string) => {
    if (!errors.includes(code)) errors.push(code);
  };
  if (lines.length === 0) add("pieces_required");
  if (pieceCount(lines) > REQUEST_LIMITS.pieces) add("too_many_pieces");
  for (const line of lines) {
    if (line.type === "item" && !(line.quantity >= 1 && line.quantity <= PRICE_LIMIT.QUANTITY)) add("quantity_invalid");
    if (line.type === "weight" && readWeight(line.weightLb) === null) add("weight_invalid");
    if (line.type === "other") {
      if (!line.description.trim()) add("piece_description_required");
      if (line.description.trim().length > REQUEST_LIMITS.description) add("text_too_long");
      if (line.photos.length > REQUEST_LIMITS.photosPerPiece) add("too_many_photos");
      if (line.photos.some((photo) => photo.status === "error")) add("photo_invalid");
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The pieces a business is asked to price, and what it answers.
// ---------------------------------------------------------------------------

export type SendPiece = {
  priceItemId?: string;
  quantity?: number;
  label?: string;
  categoryId?: string;
  weightLb?: number;
  sizePreset?: string;
  kind?: "barrel" | "box" | "other";
  description?: string;
  photoPaths?: string[];
};

/**
 * The basket as one business's pieces (the `submitPackageRequest` shape):
 * an item it prices goes by its own item id; one it does not price waits for
 * a staff estimate (a described piece), as the server treats it.
 */
export function piecesFor(lines: readonly BasketLine[], option: RequestOption, mode: ShipMode): SendPiece[] {
  const route = option.routes?.[mode] ?? null;
  const pieces: SendPiece[] = [];
  for (const line of lines) {
    if (line.type === "item") {
      const item = (route?.items ?? []).find((row) => itemKey(row.categoryId, row.label) === line.catalogKey);
      pieces.push(item
        ? { priceItemId: item.id, quantity: line.quantity, label: item.label }
        : { kind: "other", description: `${line.quantity} × ${line.label}`.slice(0, REQUEST_LIMITS.description) });
    } else if (line.type === "barrel") {
      for (let i = 0; i < line.quantity; i++) pieces.push({ kind: "barrel" });
    } else if (line.type === "weight") {
      const weightLb = readWeight(line.weightLb);
      pieces.push(weightLb === null
        ? { kind: "other", description: categoryLabel(line.categoryId, "en") }
        : { categoryId: line.categoryId, weightLb, ...(line.sizePreset ? { sizePreset: line.sizePreset } : {}) });
    } else {
      pieces.push({
        kind: line.kind,
        description: line.description.trim(),
        photoPaths: line.photos.filter((photo) => photo.status === "ready" && photo.path).map((photo) => photo.path),
      });
    }
  }
  return pieces;
}

/** The basket priced at one business's list (today's prices, as the server will). */
export function basketFor(option: RequestOption, lines: readonly BasketLine[], mode: ShipMode, pickupFeeCents: number | null = null): BasketResult {
  return priceBasket(option.routes?.[mode] ?? null, piecesFor(lines, option, mode), {
    barrelPriceCents: option.barrelPriceCents,
    pickupFeeCents,
  });
}

// ---------------------------------------------------------------------------
// The comparison.
// ---------------------------------------------------------------------------

/** One answer of `listPackageRequestOptions {action: "pickup_quote"}`. */
export type PickupQuote = {
  businessId: string;
  available: boolean;
  priced: boolean;
  feeCents: number | null;
  distanceMiles: number | null;
  borough: string;
  reason: string;
};

export type CompareRow = {
  businessId: string;
  businessName: string;
  option: RequestOption;
  allPriced: boolean;
  /** Pieces still to quote, counting a pickup fee the business sets itself. */
  unpricedCount: number;
  /** Pieces of the basket the list could not price. */
  piecesToQuote: number;
  totalCents: number | null;
  pricedCents: number;
  weighsAtCounter: boolean;
  pickupFeeCents: number | null;
  pickupToQuote: boolean;
  /** The business picks up, but not at the address. */
  blocked: boolean;
  picksUp: boolean;
  coversLoss: boolean;
  rating: number | null;
  reviewCount: number;
  departure: NextDepartureResult;
  departureKey: string;
};

const NO_DEPARTURE: NextDepartureResult = { dateKey: "", source: "none", approximate: false };

/** One row per business that ships there and takes the goods the chosen way. */
export function compareRows(
  options: readonly RequestOption[],
  input: { countryId: string; mode: ShipMode; lines: readonly BasketLine[]; handoff: Handoff; quotes: readonly PickupQuote[] },
): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const option of modeOptions(options, input.countryId, input.mode)) {
    if (input.handoff === "bring_in" && !option.bringIn.available) continue;
    if (input.handoff === "collect" && !option.collect.available) continue;
    const quote = input.handoff === "collect" ? input.quotes.find((row) => row.businessId === option.businessId) ?? null : null;
    const blocked = input.handoff === "collect" && quote !== null && !quote.available;
    const feeKnown = input.handoff === "collect" && quote !== null && quote.available && quote.priced && Number.isInteger(quote.feeCents);
    const pickupFeeCents = feeKnown ? (quote?.feeCents as number) : null;
    const pickupToQuote = input.handoff === "collect" && !blocked && !feeKnown;
    const basket = basketFor(option, input.lines, input.mode, pickupFeeCents);
    const allPriced = basket.allPriced && !pickupToQuote;
    const departure = option.departures?.[input.mode] ?? NO_DEPARTURE;
    rows.push({
      businessId: option.businessId,
      businessName: option.businessName,
      option,
      allPriced,
      unpricedCount: basket.unpricedCount + (pickupToQuote ? 1 : 0),
      piecesToQuote: basket.unpricedCount,
      totalCents: allPriced ? basket.totalCents : null,
      pricedCents: basket.pricedCents,
      weighsAtCounter: basket.weighsAtCounter,
      pickupFeeCents,
      pickupToQuote,
      blocked,
      picksUp: option.collect.available,
      coversLoss: option.coversLoss === true,
      rating: typeof option.rating === "number" && Number(option.reviewCount) > 0 ? option.rating : null,
      reviewCount: Number(option.reviewCount) > 0 ? Number(option.reviewCount) : 0,
      departure,
      departureKey: departure.dateKey,
    });
  }
  return rows;
}

export type RowFilters = { picksUp: boolean; coversLoss: boolean; rated: boolean };
export const NO_FILTERS: RowFilters = { picksUp: false, coversLoss: false, rated: false };

/** The rows a customer sees: filtered, ranked by `sort`; a business that cannot pick up there goes last. */
export function visibleRows(rows: readonly CompareRow[], sort: SortKey, filters: RowFilters): { shown: CompareRow[]; blocked: CompareRow[] } {
  const kept = rows.filter((row) =>
    (!filters.picksUp || row.picksUp) &&
    (!filters.coversLoss || row.coversLoss) &&
    (!filters.rated || (row.rating !== null && row.reviewCount > 0)));
  return {
    shown: rankOptions(kept.filter((row) => !row.blocked), sort),
    blocked: kept.filter((row) => row.blocked).sort((a, b) => a.businessName.localeCompare(b.businessName)),
  };
}

// ---------------------------------------------------------------------------
// Words for a row (built from data, in the page's language).
// ---------------------------------------------------------------------------

/** "3 pieces" / "3 colis". */
export function piecesCountText(count: number, lang: Lang): string {
  return lang === "fr" ? `${count} colis` : `${count} ${count === 1 ? "piece" : "pieces"}`;
}

/** "3 businesses ship there" / "3 entreprises expédient vers cette destination". */
export function businessesCountText(count: number, lang: Lang): string {
  if (lang === "fr") return `${count} ${count === 1 ? "entreprise expédie" : "entreprises expédient"} vers cette destination`;
  return `${count} ${count === 1 ? "business ships" : "businesses ship"} there`;
}

/** "$140.00", "about $140.00", "$100.00 + 1 to quote", "Price on request". */
export function totalText(
  row: Pick<CompareRow, "allPriced" | "totalCents" | "pricedCents" | "piecesToQuote" | "pickupToQuote" | "weighsAtCounter">,
  lang: Lang,
): string {
  const fr = lang === "fr";
  const money = moneyText(row.allPriced && row.totalCents !== null ? row.totalCents : row.pricedCents, lang);
  const lead = row.weighsAtCounter ? (fr ? `environ ${money}` : `about ${money}`) : money;
  if (row.allPriced) return lead;
  const nothingPriced = row.pricedCents <= 0 && row.piecesToQuote > 0;
  const parts: string[] = [];
  if (!nothingPriced) parts.push(lead);
  if (row.piecesToQuote > 0) {
    parts.push(nothingPriced ? (fr ? "Prix sur demande" : "Price on request") : fr ? `${row.piecesToQuote} à estimer` : `${row.piecesToQuote} to quote`);
  }
  if (row.pickupToQuote) parts.push(fr ? "frais de collecte à confirmer" : "pickup fee to quote");
  return parts.join(" + ");
}

function monthDayText(key: string, lang: Lang): string {
  if (!dateKeyValid(key)) return "";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Next flight: Fri, Nov 7" / "Next container: around Nov 22" / "Departure date not confirmed" / "" when none. */
export function departureText(departure: NextDepartureResult, mode: ShipMode, lang: Lang): string {
  const fr = lang === "fr";
  if (departure.source === "unconfirmed") return fr ? "Date de départ non confirmée" : "Departure date not confirmed";
  if (!departure.dateKey || (departure.source !== "planned" && departure.source !== "schedule")) return "";
  const lead = mode === "air" ? (fr ? "Prochain vol : " : "Next flight: ") : fr ? "Prochain conteneur : " : "Next container: ";
  if (departure.approximate) return `${lead}${fr ? "vers le " : "around "}${monthDayText(departure.dateKey, lang)}`;
  return `${lead}${plannedDayText(departure.dateKey, lang)}`;
}

/** "★ 4.6 (23)". */
export function ratingText(rating: number | null, reviewCount: number): string {
  return rating === null || reviewCount <= 0 ? "" : `★ ${rating.toFixed(1)} (${reviewCount})`;
}

/** "Pickup fee $12.00" / "Pickup fee to quote" for a row of a pickup comparison. */
export function pickupFeeText(row: Pick<CompareRow, "pickupFeeCents" | "pickupToQuote">, lang: Lang): string {
  if (row.pickupFeeCents !== null) return moneyText(row.pickupFeeCents, lang);
  return row.pickupToQuote ? (lang === "fr" ? "à confirmer" : "to quote") : "";
}

// ---------------------------------------------------------------------------
// Drop-off and pickup times: a day and a window of up to two hours.
// ---------------------------------------------------------------------------

/** A pickup may be asked between 07:00 and 21:00 (the server's PICKUP_DAY). */
export const PICKUP_HOURS = { from: "07:00", to: "21:00" } as const;
export const WINDOW_MIN_MINUTES = 30;
export const WINDOW_MAX_MINUTES = 120;

export type WindowSlot = { value: string; from: string; to: string };

export function minutesOf(hhmm: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function windowValue(from: string, to: string): string {
  return `${from}-${to}`;
}

export function parseWindow(value: string | { from: string; to: string } | null | undefined): { from: string; to: string } | null {
  let from = "";
  let to = "";
  if (typeof value === "string") [from, to] = value.split("-").map((part) => part.trim());
  else if (value) ({ from, to } = value);
  return Number.isFinite(minutesOf(from)) && Number.isFinite(minutesOf(to)) ? { from, to } : null;
}

/** The server's window rule: 30 minutes to 2 hours, inside the day's hours. */
export function windowFits(value: string | { from: string; to: string }, day: { from: string; to: string } | null | undefined): boolean {
  const window = parseWindow(value);
  if (!window || !day) return false;
  const a = minutesOf(window.from);
  const b = minutesOf(window.to);
  const open = minutesOf(day.from);
  const close = minutesOf(day.to);
  if (![open, close].every(Number.isFinite)) return false;
  return b - a >= WINDOW_MIN_MINUTES && b - a <= WINDOW_MAX_MINUTES && a >= open && b <= close;
}

/**
 * The two-hour windows a day offers: hourly starts from opening to closing
 * minus two hours (the last one ends at closing), or the one shorter window
 * when the hours are short. `afterMinutes` hides windows already over today.
 */
export function windowSlots(day: { from: string; to: string } | null | undefined, afterMinutes = -1): WindowSlot[] {
  const open = minutesOf(day?.from ?? "");
  const close = minutesOf(day?.to ?? "");
  if (!Number.isFinite(open) || !Number.isFinite(close) || close - open < WINDOW_MIN_MINUTES) return [];
  const starts: number[] = [];
  if (close - open <= WINDOW_MAX_MINUTES) {
    starts.push(open);
  } else {
    for (let s = open; s + WINDOW_MAX_MINUTES <= close; s += 60) starts.push(s);
    if (starts[starts.length - 1] !== close - WINDOW_MAX_MINUTES) starts.push(close - WINDOW_MAX_MINUTES);
  }
  return starts
    .map((s) => ({ from: clock(s), to: clock(Math.min(close, s + WINDOW_MAX_MINUTES)) }))
    .filter((slot) => minutesOf(slot.to) > afterMinutes)
    .map((slot) => ({ ...slot, value: windowValue(slot.from, slot.to) }));
}

/** Minutes after midnight in a zone (to hide today's windows already over). */
export function nowMinutesIn(zone: string, nowMs = Date.now()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone || DEFAULT_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowMs));
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1;
  } catch {
    return -1;
  }
}

/** "2–4 PM", "11 AM–1 PM", "2:30–4:30 PM" / "14 h–16 h". */
export function windowText(value: string | { from: string; to: string } | null | undefined, lang: Lang): string {
  const window = parseWindow(value);
  if (!window) return "";
  const a = minutesOf(window.from);
  const b = minutesOf(window.to);
  if (lang === "fr") {
    const fr = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`;
    return `${fr(a)}–${fr(b)}`;
  }
  const hm = (m: number) => {
    const h = Math.floor(m / 60) % 12 === 0 ? 12 : Math.floor(m / 60) % 12;
    return `${h}${m % 60 ? `:${String(m % 60).padStart(2, "0")}` : ""}`;
  };
  const half = (m: number) => (m < 12 * 60 ? "AM" : "PM");
  return half(a) === half(b) ? `${hm(a)}–${hm(b)} ${half(b)}` : `${hm(a)} ${half(a)}–${hm(b)} ${half(b)}`;
}

/** A pickup's window as the request stores it: a timed one ("14:00-16:00") or an old "morning". */
export function pickupWindowText(raw: string, lang: Lang): string {
  const timed = windowText(raw, lang);
  if (timed) return timed;
  const known = raw as PickupWindow;
  if (!(known in PICKUP_WINDOW_LABELS)) return "";
  const french: Record<PickupWindow, string> = { morning: "Matin", afternoon: "Après-midi", evening: "Soir" };
  return lang === "fr" ? french[known] : PICKUP_WINDOW_LABELS[known];
}

export type DayChoice = { key: string; open: boolean; label: string };

/** Every day a customer may pick (today to +60 in the zone): a drop-off day is open or shown closed. */
export function dayChoices(hours: WeekHours | null | undefined, zone: string, lang: Lang, nowMs = Date.now(), alwaysOpen = false): DayChoice[] {
  const { min, max } = pickableDays(zone, nowMs);
  const out: DayChoice[] = [];
  for (let key = min; key <= max; key = addDaysToKey(key, 1)) {
    const open = alwaysOpen || dayIsOpen(hours, key);
    out.push({ key, open, label: `${plannedDayText(key, lang)}${open ? "" : lang === "fr" ? " — fermé" : " — closed"}` });
  }
  return out;
}

/** The windows offered on a drop-off day (the location's hours) or a pickup day (07:00-21:00); today's past windows are hidden. */
export function windowsForDay(
  input: { handoff: Handoff; hours: WeekHours | null | undefined; dateKey: string; zone: string },
  nowMs = Date.now(),
): WindowSlot[] {
  if (!dateKeyValid(input.dateKey)) return [];
  const day = input.handoff === "collect"
    ? PICKUP_HOURS
    : input.hours?.[weekdayOfKey(input.dateKey)]?.open === true ? input.hours[weekdayOfKey(input.dateKey)] : null;
  const today = todayKeyIn(input.zone, nowMs);
  return windowSlots(day, input.dateKey === today ? nowMinutesIn(input.zone, nowMs) : -1);
}

// ---------------------------------------------------------------------------
// The form's draft and its problems.
// ---------------------------------------------------------------------------

export type SendDraft = {
  countryId: string;
  shipMode: ShipMode;
  lines: BasketLine[];
  handoff: Handoff | "";
  pickupAddress: string;
  businessId: string;
  locationId: string;
  plannedDate: string;
  /** "HH:MM-HH:MM". */
  plannedWindow: string;
  pickupDate: string;
  pickupWindow: string;
  pickupNote: string;
  senderName: string;
  senderPhone: string;
  receiverName: string;
  receiverPhone: string;
};

export function emptySendDraft(sender: { name?: string; phone?: string } = {}): SendDraft {
  return {
    countryId: "",
    shipMode: "sea",
    lines: [],
    handoff: "",
    pickupAddress: "",
    businessId: "",
    locationId: "",
    plannedDate: "",
    plannedWindow: "",
    pickupDate: "",
    pickupWindow: "",
    pickupNote: "",
    senderName: sender.name ?? "",
    senderPhone: sender.phone ?? "",
    receiverName: "",
    receiverPhone: "",
  };
}

/** The first answers again: another country or mode starts the basket over. */
export function chooseCountry(draft: SendDraft, countryId: string, onlyBusinessId = ""): SendDraft {
  return { ...emptySendDraft({ name: draft.senderName, phone: draft.senderPhone }), receiverName: draft.receiverName, receiverPhone: draft.receiverPhone, countryId, businessId: onlyBusinessId };
}

export function chooseMode(draft: SendDraft, mode: ShipMode, onlyBusinessId = ""): SendDraft {
  return mode === draft.shipMode ? draft : { ...chooseCountry(draft, draft.countryId, onlyBusinessId), shipMode: mode };
}

/**
 * Choosing how the goods reach the business: the other answer's fields are
 * cleared (guardrails §4 rule 3 - never submit an address for a drop-off),
 * and so is the business, whose price depended on the answer.
 */
export function chooseHandoff(draft: SendDraft, handoff: Handoff, onlyBusinessId = ""): SendDraft {
  if (draft.handoff === handoff) return draft;
  return {
    ...draft,
    handoff,
    businessId: onlyBusinessId,
    locationId: "",
    plannedDate: "",
    plannedWindow: "",
    pickupAddress: handoff === "collect" ? draft.pickupAddress : "",
    pickupDate: "",
    pickupWindow: "",
    pickupNote: "",
  };
}

export function handoffProblems(draft: Pick<SendDraft, "handoff" | "pickupAddress">): string[] {
  const errors: string[] = [];
  if (draft.handoff !== "bring_in" && draft.handoff !== "collect") errors.push("handoff_invalid");
  if (draft.handoff === "collect") {
    if (!draft.pickupAddress.trim()) errors.push("pickup_address_required");
    else if (draft.pickupAddress.trim().length > REQUEST_LIMITS.address) errors.push("text_too_long");
  }
  return errors;
}

/** When the goods come: the day and window, as the server will check them. */
export function whenProblems(draft: SendDraft, option: RequestOption | null, nowMs = Date.now()): string[] {
  const errors: string[] = [];
  const zone = option?.timeZone || DEFAULT_TIME_ZONE;
  const { min, max } = pickableDays(zone, nowMs);
  const inRange = (key: string) => dateKeyValid(key) && key >= min && key <= max;
  if (draft.handoff === "bring_in") {
    const location = selectedLocation(option, draft);
    if (!location) errors.push("location_invalid");
    if (!inRange(draft.plannedDate)) errors.push("planned_date_invalid");
    else if (location && !dayIsOpen(location.hours, draft.plannedDate)) errors.push("planned_day_closed");
    else if (location && !windowFits(draft.plannedWindow, location.hours?.[weekdayOfKey(draft.plannedDate)])) errors.push("window_invalid");
  } else if (draft.handoff === "collect") {
    if (!inRange(draft.pickupDate)) errors.push("pickup_date_invalid");
    if (!windowFits(draft.pickupWindow, PICKUP_HOURS)) errors.push("pickup_window_invalid");
    if (draft.pickupNote.trim().length > REQUEST_LIMITS.note) errors.push("text_too_long");
  } else {
    errors.push("handoff_invalid");
  }
  return errors;
}

export function peopleProblems(draft: Pick<SendDraft, "senderName" | "senderPhone" | "receiverName" | "receiverPhone">): string[] {
  const errors: string[] = [];
  if (!draft.senderName.trim()) errors.push("sender_name_required");
  if (!e164(draft.senderPhone)) errors.push("sender_phone_invalid");
  if (!draft.receiverName.trim()) errors.push("receiver_name_required");
  if (!e164(draft.receiverPhone)) errors.push("receiver_phone_invalid");
  if (draft.senderName.trim().length > REQUEST_LIMITS.name || draft.receiverName.trim().length > REQUEST_LIMITS.name) errors.push("text_too_long");
  return errors;
}

// ---------------------------------------------------------------------------
// What is sent.
// ---------------------------------------------------------------------------

/** The `listPackageRequestOptions` pickup quote call. */
export function pickupQuotePayload(address: string, options: readonly RequestOption[], countryId: string, mode: ShipMode) {
  return {
    action: "pickup_quote" as const,
    address: address.trim().slice(0, REQUEST_LIMITS.address),
    businessIds: modeOptions(options, countryId, mode).filter((option) => option.collect.available).map((option) => option.businessId).slice(0, 20),
  };
}

/** The submitPackageRequest payload (docs/PACKAGE_PRICE_LIST.md §4). */
export function submitPayload(
  draft: SendDraft,
  option: RequestOption,
  extra: { lang: Lang; idempotencyKey: string; viaBusiness: boolean },
) {
  const location = selectedLocation(option, draft);
  const window = parseWindow(draft.plannedWindow);
  return {
    businessId: option.businessId,
    destinationCountryId: option.country.id,
    handoff: draft.handoff,
    shipMode: draft.shipMode,
    channel: "web" as const,
    foundVia: extra.viaBusiness ? ("business" as const) : ("laawol" as const),
    ...(draft.handoff === "bring_in"
      ? {
          locationId: location?.id ?? draft.locationId,
          plannedDate: draft.plannedDate,
          ...(window ? { plannedWindow: window } : {}),
        }
      : {
          pickup: {
            address: draft.pickupAddress.trim(),
            date: draft.pickupDate,
            window: draft.pickupWindow,
            note: draft.pickupNote.trim(),
          },
        }),
    sender: { name: draft.senderName.trim(), phoneE164: e164(draft.senderPhone) },
    receiver: { name: draft.receiverName.trim(), phoneE164: e164(draft.receiverPhone) },
    pieces: piecesFor(draft.lines, option, draft.shipMode),
    language: extra.lang,
    idempotencyKey: extra.idempotencyKey,
  };
}

// ---------------------------------------------------------------------------
// The sent screen.
// ---------------------------------------------------------------------------

/**
 * "Thu, Nov 6, 2–4 PM": a day and a window, US month-first and 12-hour in
 * English. Just the day when the window is missing (an older request).
 */
export function whenText(dateKey: string, window: string | { from: string; to: string } | null | undefined, lang: Lang): string {
  const day = plannedDayText(dateKey, lang);
  const time = typeof window === "string" ? pickupWindowText(window, lang) : windowText(window, lang);
  return [day, time].filter(Boolean).join(", ");
}

export type SentView = { title: string; plan: string; totalLine: string; payNote: string };

/**
 * What the sent screen says. A request priced in full is "confirmed": the
 * customer is all set, with the day, window and place. One with pieces to
 * quote waits for the business's price on WhatsApp.
 */
export function sentView(
  input: {
    status: string;
    handoff: Handoff;
    businessName: string;
    when: string;
    place: string;
    totalCents: number | null;
    weighs: boolean;
  },
  lang: Lang,
): SentView {
  const fr = lang === "fr";
  const bring = input.handoff === "bring_in";
  const confirmed = input.status === "confirmed";
  const place = input.place ? (fr ? ` à ${input.place}` : ` to ${input.place}`) : "";
  const at = input.place ? (fr ? ` à ${input.place}` : ` at ${input.place}`) : "";
  const plan = bring
    ? fr ? `Vous l’apportez ${input.when}${place}.` : `You bring it ${input.when}${place}.`
    : fr ? `${input.businessName} vient le chercher ${input.when}${at}.` : `${input.businessName} picks it up ${input.when}${at}.`;
  const title = confirmed
    ? bring
      ? fr ? `Tout est prêt — apportez-le ${input.when}${place}` : `You’re all set — bring it ${input.when}${place}`
      : fr ? `Tout est prêt — ${input.businessName} vient le chercher ${input.when}${at}` : `You’re all set — ${input.businessName} will pick it up ${input.when}${at}`
    : fr ? `${input.businessName} vous enverra sur WhatsApp le prix des articles à estimer` : `${input.businessName} will send the price for the items to quote on WhatsApp`;
  const totalLine = confirmed && input.totalCents !== null
    ? (input.weighs ? (fr ? `Total : environ ${moneyText(input.totalCents, lang)}` : `Total: about ${moneyText(input.totalCents, lang)}`) : fr ? `Total : ${moneyText(input.totalCents, lang)}` : `Total: ${moneyText(input.totalCents, lang)}`)
    : "";
  const moment = bring ? (fr ? "au dépôt" : "when you drop it off") : fr ? "à la collecte" : "when it is picked up";
  const payNote = fr
    ? `Vous payez ${moment}${input.weighs ? " ; le prix final est fixé au comptoir (articles pesés)." : "."}`
    : `Pay ${moment}${input.weighs ? "; the final price is set at the counter (weighed items)." : "."}`;
  return { title, plan: confirmed ? "" : plan, totalLine, payNote };
}

// ---------------------------------------------------------------------------
// The /e/<token> page: how a piece was priced, and a new time.
// ---------------------------------------------------------------------------

/** "2 × $40.00 · up to 2 lb each" / "$6.00 per lb × 50 lb, weighed at drop-off" / "". */
export function priceExplanation(price: PublicPiecePrice | PiecePrice | null | undefined, lang: Lang): string {
  if (!price) return "";
  const fr = lang === "fr";
  const money = (cents: number | null) => moneyText(cents ?? 0, lang);
  if (price.source === "item") {
    const each = price.quantity > 1 ? `${price.quantity} × ${money(price.unitCents)}` : money(price.unitCents);
    const limit = price.includedLb > 0 ? (fr ? ` · jusqu’à ${price.includedLb} lb chacun, le surplus est facturé au comptoir` : ` · up to ${price.includedLb} lb each, extra weight is charged at the counter`) : "";
    return `${each}${limit}`;
  }
  if (price.source === "per_lb") {
    const weight = price.weightLb ? `${price.weightLb} lb` : "";
    return fr
      ? `${money(price.perLbCents)} la lb${weight ? ` × ${weight}` : ""}, pesé au dépôt`
      : `${money(price.perLbCents)} per lb${weight ? ` × ${weight}` : ""}, weighed at drop-off`;
  }
  if (price.source === "barrel") return fr ? "Prix du baril" : "Barrel price";
  return "";
}

/** What the list priced a piece at (before any weighing at the counter), or null. */
export function listPriceCents(price: PublicPiecePrice | PiecePrice | null | undefined): number | null {
  if (!price) return null;
  if (price.source === "item" && price.unitCents !== null) return price.unitCents * (price.quantity || 1);
  if (price.source === "per_lb" && price.perLbCents !== null && price.weightLb) return Math.round(price.perLbCents * price.weightLb);
  if (price.source === "barrel" && price.unitCents !== null) return price.unitCents;
  return null;
}

/** Whether the /e page may offer "Pick a new time": an open drop-off with its location's hours. */
export function canReschedule(request: Pick<PublicRequest, "status" | "handoff" | "location">): boolean {
  return (
    request.handoff === "bring_in" &&
    ["new", "estimate_sent", "confirmed"].includes(request.status) &&
    Boolean(request.location?.hours)
  );
}

export function reschedulePayload(token: string, plannedDate: string, plannedWindow: string) {
  const window = parseWindow(plannedWindow);
  return { token, action: "reschedule" as const, plannedDate, plannedWindow: window ?? { from: "", to: "" } };
}

/** The plan a request page shows: "Thu, Nov 6, 2–4 PM" for a drop-off, the pickup day and window for a collection. */
export function requestPlanText(request: Pick<PublicRequest, "handoff" | "plannedDate" | "plannedWindow" | "pickup">, lang: Lang): string {
  if (request.handoff === "collect") return request.pickup?.date ? whenText(request.pickup.date, request.pickup.window, lang) : "";
  return request.plannedDate ? whenText(request.plannedDate, request.plannedWindow, lang) : "";
}

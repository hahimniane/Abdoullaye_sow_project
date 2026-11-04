// The business side of price lists (docs/PACKAGE_PRICE_LIST.md): the editor's
// drafts (dollars and weights as typed), the payload the server takes, how a
// refusal reads, the history list, "Coming today" and the Received weigh-in.
//
// Pure: no Firebase, no React. business-price-list.test.ts runs it. The
// rules themselves (validation, counter prices) are package-price-list.ts,
// the shared mirror of the server's package_price_list.js.

import { centsToInput } from "./invoice-ledger.ts";
import { readMoneyInput } from "./money-input.ts";
import {
  BOX_PRICED_IDS,
  CATEGORIES,
  LIMIT,
  MODES,
  PRICE_LIST_MESSAGES,
  WEEK_DAYS,
  counterPriceCents,
  dateKeyValid,
  validatePriceList,
  type PiecePrice,
  type PriceMode,
  type Route,
  type RoutePair,
  type RoutesMap,
  type WeekDayKey,
} from "./package-price-list.ts";

export type Lang = "en" | "fr";
type Row = Record<string, unknown>;

const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const asRow = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {});

// ---------------------------------------------------------------------------
// Drafts.
// ---------------------------------------------------------------------------

export type ItemDraft = {
  /** React's key for the row; never sent. */
  key: string;
  /** The stored id ("" for a new item: the server makes it from the name). */
  id: string;
  label: string;
  categoryId: string;
  /** US dollars as typed. */
  price: string;
  /** Pounds as typed; blank = the price covers any weight. */
  includedLb: string;
};

export type DepartureDraft = {
  days: WeekDayKey[];
  /** "1".."8" as typed. */
  everyWeeks: string;
  anchorDate: string;
};

export type RouteDraft = {
  items: ItemDraft[];
  /** Dollars per pound as typed, by category id. */
  rates: Record<string, string>;
  /** Dollars per box size as typed (Sea only): small, medium, large. Extra large is always quoted. */
  boxPrices: Record<string, string>;
  departure: DepartureDraft;
};

export type CountryDraft = Record<PriceMode, RouteDraft>;
export type ListDraft = Record<string, CountryDraft>;

let serial = 0;
export function newItemDraft(): ItemDraft {
  serial += 1;
  return { key: `price-item-${serial}`, id: "", label: "", categoryId: "general", price: "", includedLb: "" };
}

export function emptyRouteDraft(): RouteDraft {
  return { items: [], rates: {}, boxPrices: {}, departure: { days: [], everyWeeks: "1", anchorDate: "" } };
}

/** Dollars as the field shows them: "40", "12.50" (a French reader types a comma, which the reader accepts). */
export function dollarsInput(cents: unknown, lang: Lang = "en"): string {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return "";
  const value = centsToInput(n);
  return lang === "fr" ? value.replace(".", ",") : value;
}

/** A stored route as the editor holds it. */
export function routeDraftFrom(route: unknown, lang: Lang = "en"): RouteDraft {
  const r = asRow(route);
  const items = (Array.isArray(r.items) ? r.items : []).map((raw) => {
    const item = asRow(raw);
    const lb = Number(item.includedLb);
    return {
      ...newItemDraft(),
      id: text(item.id, 44),
      label: text(item.label, LIMIT.LABEL),
      categoryId: text(item.categoryId, 40) || "general",
      price: dollarsInput(item.priceCents, lang),
      includedLb: Number.isFinite(lb) && lb > 0 ? String(lb) : "",
    };
  });
  const rates: Record<string, string> = {};
  for (const [categoryId, cents] of Object.entries(asRow(r.perLbCents))) {
    const typed = dollarsInput(cents, lang);
    if (typed) rates[categoryId] = typed;
  }
  const boxPrices: Record<string, string> = {};
  for (const [sizeId, cents] of Object.entries(asRow(r.boxPricesCents))) {
    const typed = dollarsInput(cents, lang);
    if (typed && (BOX_PRICED_IDS as readonly string[]).includes(sizeId)) boxPrices[sizeId] = typed;
  }
  const dep = asRow(r.departure);
  const days = (Array.isArray(dep.weekdays) ? dep.weekdays : []).filter((d): d is WeekDayKey =>
    (WEEK_DAYS as readonly string[]).includes(String(d)),
  );
  return {
    items,
    rates,
    boxPrices,
    departure: {
      days: WEEK_DAYS.filter((d) => days.includes(d)),
      everyWeeks: String(Number(dep.everyWeeks) >= 1 ? Number(dep.everyWeeks) : 1),
      anchorDate: dateKeyValid(dep.anchorDate) ? String(dep.anchorDate) : "",
    },
  };
}

/** The stored routes as one draft per country (an unpriced mode is an empty draft). */
export function listDraftFrom(routes: unknown, countryIds: readonly string[], lang: Lang = "en"): ListDraft {
  const map = asRow(routes);
  const out: ListDraft = {};
  for (const id of countryIds) {
    const pair = asRow(map[id]);
    out[id] = { sea: routeDraftFrom(pair.sea, lang), air: routeDraftFrom(pair.air, lang) };
  }
  return out;
}

function itemIsBlank(item: ItemDraft): boolean {
  return !item.label.trim() && !item.price.trim() && !item.includedLb.trim();
}

/**
 * One route as the server's `validateRoute` reads it. A row nobody typed in
 * is dropped, not refused. A price that does not read as money goes as 0, so
 * the server's own `price_invalid` (also checked here first) names it.
 */
export function routePayload(draft: RouteDraft, mode: PriceMode = "sea"): Row | null {
  const items = draft.items
    .filter((item) => !itemIsBlank(item))
    .map((item) => {
      const price = readMoneyInput(item.price);
      const includedTyped = item.includedLb.trim().replace(",", ".");
      return {
        ...(item.id ? { id: item.id } : {}),
        label: item.label.trim(),
        categoryId: item.categoryId,
        priceCents: price.cents ?? 0,
        includedLb: includedTyped === "" ? 0 : Number(includedTyped),
      };
    });
  const perLbCents: Record<string, number> = {};
  for (const [categoryId, typed] of Object.entries(draft.rates)) {
    if (!typed.trim()) continue;
    const cents = readMoneyInput(typed).cents;
    perLbCents[categoryId] = cents ?? 0;
  }
  // Box sizes are Sea only; a typed price that does not read goes as 0 so the server names it.
  const boxPricesCents: Record<string, number> = {};
  if (mode === "sea") {
    for (const [sizeId, typed] of Object.entries(draft.boxPrices ?? {})) {
      if (!typed.trim()) continue;
      boxPricesCents[sizeId] = readMoneyInput(typed).cents ?? 0;
    }
  }
  const weeks = Number(draft.departure.everyWeeks);
  const departure = draft.departure.days.length
    ? {
        weekdays: [...draft.departure.days],
        everyWeeks: Number.isFinite(weeks) ? weeks : 0,
        anchorDate: draft.departure.anchorDate,
      }
    : null;
  const hasBoxes = Object.keys(boxPricesCents).length > 0;
  if (items.length === 0 && Object.keys(perLbCents).length === 0 && !hasBoxes && !departure) return null;
  return { items, perLbCents, ...(hasBoxes ? { boxPricesCents } : {}), departure };
}

/** Whether a country's mode holds nothing yet. */
export function routeDraftIsEmpty(draft: RouteDraft, mode: PriceMode = "sea"): boolean {
  return routePayload(draft, mode) === null;
}

/** The whole map the server takes: every country, only its priced modes. */
export function listPayload(draft: ListDraft): { routes: Record<string, Row> } {
  const routes: Record<string, Row> = {};
  for (const [countryId, pair] of Object.entries(draft)) {
    const out: Row = {};
    for (const mode of MODES) {
      const route = routePayload(pair[mode], mode);
      if (route) out[mode] = route;
    }
    if (Object.keys(out).length) routes[countryId] = out;
  }
  return { routes };
}

/** The first thing wrong with the draft, as the server would say it ("" when fine). */
export function listProblem(draft: ListDraft): string {
  const payload = listPayload(draft);
  const { errors } = validatePriceList(payload, Object.keys(draft));
  return errors[0] ?? "";
}

/** A priced route's one-line summary: "3 items · 2 rates · Tue, Fri". */
export function routeSummary(route: unknown, lang: Lang = "en"): string {
  const r = asRow(route);
  const items = Array.isArray(r.items) ? r.items.length : 0;
  const rates = Object.keys(asRow(r.perLbCents)).length;
  const boxes = Object.keys(asRow(r.boxPricesCents)).length;
  const days = Array.isArray(asRow(r.departure).weekdays) ? (asRow(r.departure).weekdays as string[]) : [];
  const parts: string[] = [];
  if (items) parts.push(lang === "fr" ? `${items} article${items > 1 ? "s" : ""}` : `${items} item${items > 1 ? "s" : ""}`);
  if (rates) parts.push(lang === "fr" ? `${rates} tarif${rates > 1 ? "s" : ""} au lb` : `${rates} per-lb rate${rates > 1 ? "s" : ""}`);
  if (boxes) parts.push(lang === "fr" ? `${boxes} taille${boxes > 1 ? "s" : ""} de carton` : `${boxes} box size${boxes > 1 ? "s" : ""}`);
  if (days.length) parts.push(days.map((d) => weekdayShort(d as WeekDayKey, lang)).join(", "));
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------------

const WEEKDAY_SHORT: Record<Lang, Record<WeekDayKey, string>> = {
  en: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
  fr: { mon: "lun.", tue: "mar.", wed: "mer.", thu: "jeu.", fri: "ven.", sat: "sam.", sun: "dim." },
};

export function weekdayShort(day: WeekDayKey, lang: Lang = "en"): string {
  return WEEKDAY_SHORT[lang === "fr" ? "fr" : "en"][day] ?? day;
}

/** The departure cadence: "Every week" / "Every 3 weeks" (French "Chaque semaine" / "Toutes les 3 semaines"). */
export function weeksText(weeks: number, lang: Lang = "en"): string {
  if (lang === "fr") return weeks === 1 ? "Chaque semaine" : `Toutes les ${weeks} semaines`;
  return weeks === 1 ? "Every week" : `Every ${weeks} weeks`;
}

export function categoryLabel(categoryId: string, lang: Lang = "en"): string {
  const category = CATEGORIES.find((c) => c.id === categoryId);
  return category ? category[lang === "fr" ? "fr" : "en"] : categoryId;
}

/** Why a save failed, as a sentence (the server's reasons, EN; french-dom.ts has the French). */
export function priceListMessage(reason: string): string {
  return PRICE_LIST_MESSAGES[reason] ?? "";
}

export const PRICE_LIST_GENERIC_ERROR = "Something went wrong. Try again.";
export const PRICE_LIST_NETWORK_ERROR = "We could not reach Laawol. Check your connection and try again.";

/** A callable's failure as a sentence: its price-list reason, else a generic one. */
export function priceListFailure(error: unknown): { reason: string; message: string } {
  const record = asRow(error);
  const details = asRow(record.details);
  const reasons = Array.isArray(details.reasons) ? details.reasons.map((r) => text(r, 60)).filter(Boolean) : [];
  const reason = text(details.reason, 60) || reasons[0] || "";
  const code = text(record.code, 60);
  const message =
    priceListMessage(reason) ||
    (code === "functions/permission-denied"
      ? "Only the business owner can change the price list."
      : code === "functions/unavailable" || code === "functions/deadline-exceeded"
        ? PRICE_LIST_NETWORK_ERROR
        : PRICE_LIST_GENERIC_ERROR);
  return { reason, message };
}

// ---------------------------------------------------------------------------
// The stored list: banner and history.
// ---------------------------------------------------------------------------

export type PriceListView = {
  routes: RoutesMap;
  needsCheck: boolean;
  updatedAtMs: number;
  updatedByName: string;
  updatedByLaawol: boolean;
  checkedAtMs: number;
};

export function priceListView(doc: unknown): PriceListView {
  const d = asRow(doc);
  const routes: RoutesMap = {};
  for (const [countryId, pair] of Object.entries(asRow(d.routes))) {
    const p = asRow(pair);
    const out: RoutePair = {};
    for (const mode of MODES) {
      const route = asRow(p[mode]);
      if (Array.isArray(route.items) || Object.keys(asRow(route.perLbCents)).length || Object.keys(asRow(route.boxPricesCents)).length || route.departure) {
        out[mode] = route as unknown as Route;
      }
    }
    if (Object.keys(out).length) routes[countryId] = out;
  }
  return {
    routes,
    needsCheck: d.needsCheck === true,
    updatedAtMs: Number(d.updatedAtMs) || 0,
    updatedByName: text(d.updatedByName, 80),
    updatedByLaawol: d.updatedByLaawol === true,
    checkedAtMs: Number(d.checkedAtMs) || 0,
  };
}

export type PriceListHistoryRow = {
  atMs: number;
  byName: string;
  byLaawol: boolean;
  action: "saved" | "checked";
  countries: string[];
};

/** Who changed the list, newest first. */
export function priceListHistory(doc: unknown): PriceListHistoryRow[] {
  const list = Array.isArray(asRow(doc).history) ? (asRow(doc).history as unknown[]) : [];
  return list
    .map((raw) => {
      const h = asRow(raw);
      return {
        atMs: Number(h.atMs) || 0,
        byName: text(h.byName, 80),
        byLaawol: h.byLaawol === true,
        action: (h.action === "checked" ? "checked" : "saved") as "saved" | "checked",
        countries: (Array.isArray(h.countries) ? h.countries : []).map((c) => text(c, 60)).filter(Boolean),
      };
    })
    .filter((row) => row.atMs > 0)
    .sort((a, b) => b.atMs - a.atMs);
}

// ---------------------------------------------------------------------------
// Coming today (Shipping > Waiting).
// ---------------------------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type DropWindow = { from: string; to: string };

/** A request's `plannedWindow`, or null when it has none. */
export function plannedWindowOf(value: unknown): DropWindow | null {
  const w = asRow(value);
  const from = text(w.from, 5);
  const to = text(w.to, 5);
  return HHMM.test(from) && HHMM.test(to) ? { from, to } : null;
}

function clock12(hhmm: string): { hour: number; minutes: string; pm: boolean } {
  const [h, m] = hhmm.split(":").map(Number);
  return { hour: h % 12 === 0 ? 12 : h % 12, minutes: String(m).padStart(2, "0"), pm: h >= 12 };
}

/**
 * The window as people read it: "2:00–4:00 PM" (one AM/PM when both ends
 * share it, "11:00 AM–1:00 PM" when not); French "14 h–16 h", "14 h 30–16 h 30".
 */
export function windowText(window: DropWindow | null, lang: Lang = "en"): string {
  if (!window) return "";
  if (lang === "fr") {
    const part = (hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
    };
    return `${part(window.from)}–${part(window.to)}`;
  }
  const a = clock12(window.from);
  const b = clock12(window.to);
  const left = `${a.hour}:${a.minutes}`;
  const right = `${b.hour}:${b.minutes} ${b.pm ? "PM" : "AM"}`;
  return a.pm === b.pm ? `${left}–${right}` : `${left} ${a.pm ? "PM" : "AM"}–${right}`;
}

/**
 * The confirmed bring-in requests planned for today (in the business's zone),
 * soonest window first. A request with no window sorts after the ones that
 * have one. Works on the open-requests rows already loaded: no new query.
 */
export function comingToday(rows: readonly Row[], todayKey: string): Row[] {
  const key = (row: Row) => plannedWindowOf(row.plannedWindow)?.from ?? "99:99";
  return rows
    .filter(
      (row) =>
        text(row.status, 40) === "confirmed" &&
        text(row.handoff, 20) === "bring_in" &&
        text(row.plannedDate, 10) === todayKey,
    )
    .sort((a, b) => key(a).localeCompare(key(b)) || text(a.id, 60).localeCompare(text(b.id, 60)));
}

// ---------------------------------------------------------------------------
// Containers: the planned departure.
// ---------------------------------------------------------------------------

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function weekdayOfKey(key: string): WeekDayKey {
  const [y, m, d] = key.split("-").map(Number);
  return WEEK_DAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

/** "Fri, Nov 14" / "ven. 14 nov." for a "YYYY-MM-DD" day; "" when not one. */
export function plannedDayShort(key: string, lang: Lang = "en"): string {
  if (!dateKeyValid(key)) return "";
  const [, m, d] = key.split("-").map(Number);
  const day = weekdayShort(weekdayOfKey(key), lang);
  return lang === "fr" ? `${day} ${d} ${MONTHS_FR[m - 1]}` : `${day}, ${MONTHS_EN[m - 1]} ${d}`;
}

/** The container card's line: "Planned to leave Fri, Nov 14" / "Départ prévu ven. 14 nov."; "" when none. */
export function plannedDepartureText(key: unknown, lang: Lang = "en"): string {
  const day = plannedDayShort(text(key, 10), lang);
  if (!day) return "";
  return lang === "fr" ? `Départ prévu ${day}` : `Planned to leave ${day}`;
}

// ---------------------------------------------------------------------------
// Received: weigh a priced piece.
// ---------------------------------------------------------------------------

/** The price snapshot a request piece carries (`pieces[].price`), or null. */
export function piecePriceOf(piece: unknown): PiecePrice | null {
  const price = asRow(asRow(piece).price);
  const source = text(price.source, 20);
  return source === "item" || source === "per_lb" || source === "barrel" ? (price as unknown as PiecePrice) : null;
}

/** Whether the counter scale decides this piece's price: by the pound, or "up to X lb" each. */
export function pieceNeedsWeight(price: PiecePrice | null): boolean {
  if (!price) return false;
  return price.source === "per_lb" || (price.source === "item" && Number(price.includedLb) > 0);
}

/** A typed weight in pounds, or null when it is not one ("52,5" works). */
export function readWeightLb(typed: string): number | null {
  const raw = text(typed, 12).replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Math.round(Number(raw) * 10) / 10;
  return n > 0 && n <= LIMIT.WEIGHT_LB ? n : null;
}

/**
 * What the price field takes once the piece is weighed: the counter price in
 * dollars as typed, or null when the weight is not readable or the extra
 * pounds have no rate (staff type the price).
 */
export function weighedPriceInput(price: PiecePrice | null, typedWeight: string, lang: Lang = "en"): string | null {
  const weight = readWeightLb(typedWeight);
  if (!price || weight === null) return null;
  const cents = counterPriceCents(price, weight);
  return cents === null ? null : dollarsInput(cents, lang) || "0";
}

/** What the weigh-in line says the price is based on: "Phone · $40 covers up to 2 lb, then $4.50/lb". */
export function priceBasisText(price: PiecePrice | null, lang: Lang = "en"): string {
  if (!price) return "";
  const money = (cents: number | null) => (cents && cents > 0 ? `$${dollarsInput(cents, lang)}` : "");
  if (price.source === "per_lb") {
    return lang === "fr" ? `${money(price.perLbCents)} le lb` : `${money(price.perLbCents)}/lb`;
  }
  if (price.source !== "item") return "";
  const base = money(price.unitCents);
  if (!(Number(price.includedLb) > 0)) return base;
  const unit = lang === "fr" ? `${base} couvre jusqu’à ${price.includedLb} lb` : `${base} covers up to ${price.includedLb} lb`;
  const extra = money(price.excessPerLbCents);
  if (!extra) return unit;
  return lang === "fr" ? `${unit}, puis ${extra}/lb` : `${unit}, then ${extra}/lb`;
}

// ---------------------------------------------------------------------------
// Volume: "Found on Laawol".
// ---------------------------------------------------------------------------

/** A rollup's Laawol lines as the tile and table read them (older rollups have none: 0). */
export function laawolLinesOf(numbers: { laawolLines?: unknown } | null | undefined): number {
  return Math.max(0, Math.round(Number(numbers?.laawolLines) || 0));
}

/**
 * Sales history, console side: a shop's sales by Day / Week / Month / Year
 * (or any range), what they add up to, how that compares with the period
 * before, a chart, the breakdowns (store, seller, payment method, products,
 * brands, categories) and a "what happened" timeline of sales, voids, credit
 * payments and stock changes.
 *
 * Pure: the screen reads three bounded queries (sales, credit payments and
 * stock movements whose `createdAt` falls in the period, the previous
 * period's sales for the comparison) and everything is worked out here.
 * Periods are calendar days in the business's zone (America/New_York unless
 * the business stores another `timeZone`), weeks start on Sunday, and a day
 * is midnight to midnight in that zone - 23 or 25 hours on the days the clocks
 * change. `inventory-history.test.ts` pins all of it, DST edges included.
 */

import { INVOICE_PAYMENT_METHOD_LABELS, type InvoicePaymentMethod } from "./invoice-ledger.ts";
import { inventorySaleFromRow, productDisplayName, saleStoreId, storeNameIndex, type InventorySale, type InventoryStore } from "./inventory.ts";

type Lang = "en" | "fr";
type Row = Record<string, unknown>;

export const HISTORY_ZONE = "America/New_York";
const DATE_KEY = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const DAY_MS = 86_400_000;
/** A custom range longer than this is charted by month instead of by day. */
const DAILY_CHART_MAX_DAYS = 62;
/** The longest custom range offered (two years). */
export const MAX_CUSTOM_DAYS = 731;

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function text(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

function nonNegative(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function millisOf(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    const v = value as { toMillis?: () => number; seconds?: number };
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

// ---------------------------------------------------------------------------
// Calendar days ("YYYY-MM-DD"), counted as plain dates.
// ---------------------------------------------------------------------------

export function isDayKey(value: unknown): boolean {
  const match = DATE_KEY.exec(String(value ?? ""));
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(key: string, days: number): string {
  return utcToKey(keyToUtc(key) + days * DAY_MS);
}

/** 0 = Sunday. */
export function weekdayOf(key: string): number {
  return new Date(keyToUtc(key)).getUTCDay();
}

function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

function addMonths(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return utcToKey(date.getTime());
}

function monthEnd(key: string): string {
  return addDays(addMonths(monthStart(key), 1), -1);
}

export function daysInclusive(startKey: string, endKey: string): number {
  return Math.round((keyToUtc(endKey) - keyToUtc(startKey)) / DAY_MS) + 1;
}

// ---------------------------------------------------------------------------
// Periods.
// ---------------------------------------------------------------------------

export type HistoryKind = "day" | "week" | "month" | "year" | "custom";

export const HISTORY_KINDS: readonly Exclude<HistoryKind, "custom">[] = ["day", "week", "month", "year"];

export const HISTORY_KIND_LABELS: Record<HistoryKind, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
  custom: "Custom range",
};

/** Both ends included. */
export type HistoryPeriod = { kind: HistoryKind; startKey: string; endKey: string };

/** The Day / Week (Sunday to Saturday) / Month / Year holding `anchorKey`. */
export function periodFor(kind: Exclude<HistoryKind, "custom">, anchorKey: string): HistoryPeriod {
  const anchor = isDayKey(anchorKey) ? anchorKey : "1970-01-01";
  if (kind === "day") return { kind, startKey: anchor, endKey: anchor };
  if (kind === "week") {
    const start = addDays(anchor, -weekdayOf(anchor));
    return { kind, startKey: start, endKey: addDays(start, 6) };
  }
  if (kind === "month") return { kind, startKey: monthStart(anchor), endKey: monthEnd(anchor) };
  const year = anchor.slice(0, 4);
  return { kind, startKey: `${year}-01-01`, endKey: `${year}-12-31` };
}

/** A range picked on the calendar: the ends in order, at most MAX_CUSTOM_DAYS long (the start moves up). */
export function customPeriod(fromKey: string, toKey: string): HistoryPeriod | null {
  if (!isDayKey(fromKey) || !isDayKey(toKey)) return null;
  let [start, end] = fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];
  if (daysInclusive(start, end) > MAX_CUSTOM_DAYS) start = addDays(end, -(MAX_CUSTOM_DAYS - 1));
  return { kind: "custom", startKey: start, endKey: end };
}

/** The period before (-1) or after (+1): a custom range moves by its own length. */
export function shiftPeriod(period: HistoryPeriod, direction: 1 | -1): HistoryPeriod {
  if (period.kind === "custom") {
    const length = daysInclusive(period.startKey, period.endKey);
    return { kind: "custom", startKey: addDays(period.startKey, direction * length), endKey: addDays(period.endKey, direction * length) };
  }
  if (period.kind === "day") return periodFor("day", addDays(period.startKey, direction));
  if (period.kind === "week") return periodFor("week", addDays(period.startKey, direction * 7));
  if (period.kind === "month") return periodFor("month", addMonths(period.startKey, direction));
  return periodFor("year", `${Number(period.startKey.slice(0, 4)) + direction}-01-01`);
}

/** The period compared against: the one just before. */
export function previousPeriod(period: HistoryPeriod): HistoryPeriod {
  return shiftPeriod(period, -1);
}

/** Next is offered only while the period ends before today (nothing is sold in the future). */
export function canGoNext(period: HistoryPeriod, todayKey: string): boolean {
  return period.endKey < todayKey;
}

export function periodContainsToday(period: HistoryPeriod, todayKey: string): boolean {
  return period.startKey <= todayKey && todayKey <= period.endKey;
}

// ---------------------------------------------------------------------------
// Time zones.
// ---------------------------------------------------------------------------

/** A zone the browser knows, else "". */
function validZone(value: unknown): string {
  const zone = text(value, 80);
  if (!zone) return "";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "";
  }
}

/** The zone the history is read in: the business's own `timeZone` when it stores a valid one, else New York. */
export function historyZone(business: unknown): string {
  return validZone(asRow(business).timeZone) || HISTORY_ZONE;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function localParts(ms: number, zone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ms));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: pick("year"), month: pick("month"), day: pick("day"), hour: pick("hour") % 24, minute: pick("minute"), second: pick("second") };
}

/** Local time minus UTC at that instant, in ms. */
export function zoneOffsetMs(ms: number, zone: string): number {
  const p = localParts(ms, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The first instant of a calendar day in a zone (twice through the offset: it can change that night). */
export function startOfDayMs(key: string, zone: string): number {
  const midnight = keyToUtc(key);
  let start = midnight - zoneOffsetMs(midnight, zone);
  start = midnight - zoneOffsetMs(start, zone);
  return start;
}

/** The period as instants: from its first day's midnight to (not including) the midnight after its last day. */
export function periodBounds(period: HistoryPeriod, zone: string): { startMs: number; endMs: number } {
  return { startMs: startOfDayMs(period.startKey, zone), endMs: startOfDayMs(addDays(period.endKey, 1), zone) };
}

/** The calendar day an instant falls on in a zone. */
export function dayKeyOf(ms: number, zone: string): string {
  const p = localParts(ms, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function hourOf(ms: number, zone: string): number {
  return localParts(ms, zone).hour;
}

// ---------------------------------------------------------------------------
// Chart buckets.
// ---------------------------------------------------------------------------

export type HistoryGranularity = "hour" | "day" | "month";

export function granularityFor(period: HistoryPeriod): HistoryGranularity {
  if (period.kind === "day") return "hour";
  if (period.kind === "year") return "month";
  if (period.kind === "custom") {
    const days = daysInclusive(period.startKey, period.endKey);
    if (days === 1) return "hour";
    return days > DAILY_CHART_MAX_DAYS ? "month" : "day";
  }
  return "day";
}

export type HistoryBucket = {
  /** "07" for an hour, "2026-10-16" for a day, "2026-10" for a month. */
  key: string;
  totalCents: number;
  paidNowCents: number;
  creditCents: number;
  count: number;
};

/** Every bucket of the period, empty ones included, in order. */
export function emptyBuckets(period: HistoryPeriod): HistoryBucket[] {
  const granularity = granularityFor(period);
  const keys: string[] = [];
  if (granularity === "hour") {
    for (let h = 0; h < 24; h += 1) keys.push(String(h).padStart(2, "0"));
  } else if (granularity === "day") {
    for (let key = period.startKey; key <= period.endKey; key = addDays(key, 1)) keys.push(key);
  } else {
    for (let key = monthStart(period.startKey); key <= period.endKey; key = addMonths(key, 1)) keys.push(key.slice(0, 7));
  }
  return keys.map((key) => ({ key, totalCents: 0, paidNowCents: 0, creditCents: 0, count: 0 }));
}

/** A bucket's axis label: "9 AM" / "9 h", "Sun 12" / "dim. 12", "12", "Jan" / "janv.". */
export function bucketLabel(key: string, granularity: HistoryGranularity, period: HistoryPeriod, lang: Lang = "en"): string {
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  if (granularity === "hour") {
    const hour = Number(key);
    if (lang === "fr") return `${hour} h`;
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelve} ${hour < 12 ? "AM" : "PM"}`;
  }
  if (granularity === "month") {
    const [y, m] = key.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, 1));
    const sameYear = period.startKey.slice(0, 4) === period.endKey.slice(0, 4);
    return new Intl.DateTimeFormat(locale, { month: "short", ...(sameYear ? {} : { year: "2-digit" }), timeZone: "UTC" }).format(date);
  }
  const date = new Date(keyToUtc(key));
  if (period.kind === "week") {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
    return `${weekday} ${date.getUTCDate()}`;
  }
  if (period.kind === "month") return String(date.getUTCDate());
  return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone: "UTC" }).format(date);
}

// ---------------------------------------------------------------------------
// What a period adds up to.
// ---------------------------------------------------------------------------

export type HistoryKpis = {
  totalCents: number;
  count: number;
  items: number;
  averageCents: number;
  paidNowCents: number;
  creditCents: number;
  /** Revenue minus cost over the lines whose cost is known. */
  profitCents: number;
  /** Lines sold with no cost entered (left out of the profit). */
  linesWithoutCost: number;
  /** Any line had a known cost (else there is no profit to show). */
  profitKnown: boolean;
  voidedCount: number;
  voidedCents: number;
};

export type HistoryShare = { key: string; name: string; totalCents: number; count: number; quantity: number };

export type HistoryMethodShare = { method: string; label: string; cents: number; count: number };

export type HistoryAggregate = {
  kpis: HistoryKpis;
  buckets: HistoryBucket[];
  granularity: HistoryGranularity;
  byStore: HistoryShare[];
  bySeller: HistoryShare[];
  byMethod: HistoryMethodShare[];
  topProducts: HistoryShare[];
  topBrands: HistoryShare[];
  topCategories: HistoryShare[];
};

export const ON_CREDIT_METHOD = "credit";
export const UNCATEGORIZED_KEY = "__none__";
export const NO_BRAND_KEY = "__none__";
const TOP_PRODUCTS = 10;
const TOP_GROUPS = 5;

function bump(map: Map<string, HistoryShare>, key: string, name: string, cents: number, quantity: number, countOne: boolean) {
  const entry = map.get(key) ?? { key, name, totalCents: 0, count: 0, quantity: 0 };
  entry.totalCents += cents;
  entry.quantity += quantity;
  if (countOne) entry.count += 1;
  if (!entry.name && name) entry.name = name;
  map.set(key, entry);
}

const byMoney = (a: HistoryShare, b: HistoryShare) =>
  b.totalCents - a.totalCents || b.quantity - a.quantity || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);

/**
 * Everything the history screen shows about a period's sales. Voided sales
 * are left out of every figure (they are counted in `voidedCount`), and so is
 * anything outside the period's bounds.
 */
export function aggregateHistory({ rows, period, zone, stores = [] }: {
  rows: readonly unknown[];
  period: HistoryPeriod;
  zone: string;
  stores?: readonly InventoryStore[];
}): HistoryAggregate {
  const { startMs, endMs } = periodBounds(period, zone);
  const granularity = granularityFor(period);
  const buckets = emptyBuckets(period);
  const bucketAt = new Map(buckets.map((bucket, index) => [bucket.key, index]));
  const storeNames = storeNameIndex([...stores]);
  const kpis: HistoryKpis = {
    totalCents: 0, count: 0, items: 0, averageCents: 0, paidNowCents: 0, creditCents: 0,
    profitCents: 0, linesWithoutCost: 0, profitKnown: false, voidedCount: 0, voidedCents: 0,
  };
  const storesMap = new Map<string, HistoryShare>();
  const sellers = new Map<string, HistoryShare>();
  const methods = new Map<string, HistoryMethodShare>();
  const products = new Map<string, HistoryShare>();
  const brands = new Map<string, HistoryShare>();
  const categories = new Map<string, HistoryShare>();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = asRow(raw);
    const sale = inventorySaleFromRow(row);
    const at = millisOf(sale.createdAt);
    if (!sale.id || at < startMs || at >= endMs) continue;
    if (sale.voided) {
      kpis.voidedCount += 1;
      kpis.voidedCents += sale.totalCents;
      continue;
    }
    kpis.count += 1;
    kpis.totalCents += sale.totalCents;
    kpis.items += sale.itemCount;
    kpis.paidNowCents += sale.paidNowCents;
    kpis.creditCents += sale.creditCents;
    const key = granularity === "hour" ? String(hourOf(at, zone)).padStart(2, "0")
      : granularity === "day" ? dayKeyOf(at, zone) : dayKeyOf(at, zone).slice(0, 7);
    const index = bucketAt.get(key);
    if (index !== undefined) {
      const bucket = buckets[index];
      bucket.totalCents += sale.totalCents;
      bucket.paidNowCents += sale.paidNowCents;
      bucket.creditCents += sale.creditCents;
      bucket.count += 1;
    }
    const storeId = stores.length > 0 ? saleStoreId(sale, [...stores]) : sale.storeId;
    bump(storesMap, storeId || "", sale.storeName || storeNames.get(storeId) || "", sale.totalCents, sale.itemCount, true);
    bump(sellers, sale.soldByStaffId, "", sale.totalCents, sale.itemCount, true);
    if (sale.paidNowCents > 0) {
      const method = sale.paymentMethod || "other";
      const entry = methods.get(method) ?? { method, label: methodLabel(method), cents: 0, count: 0 };
      entry.cents += sale.paidNowCents;
      entry.count += 1;
      methods.set(method, entry);
    }
    if (sale.creditCents > 0) {
      const entry = methods.get(ON_CREDIT_METHOD) ?? { method: ON_CREDIT_METHOD, label: "On credit", cents: 0, count: 0 };
      entry.cents += sale.creditCents;
      entry.count += 1;
      methods.set(ON_CREDIT_METHOD, entry);
    }
    const rawLines = Array.isArray(row.lines) ? row.lines.map(asRow) : [];
    sale.lines.forEach((line, i) => {
      const extra = rawLines[i] ?? {};
      const cents = line.lineTotalCents;
      bump(products, line.itemId || `line-${i}`, productDisplayName(line), cents, line.quantity, false);
      const brandKey = line.brandId || (line.brand ? `name:${line.brand.toLowerCase()}` : NO_BRAND_KEY);
      bump(brands, brandKey, line.brand, cents, line.quantity, false);
      const categoryName = text(extra.category, 60);
      const categoryKey = text(extra.categoryId) || (categoryName ? `name:${categoryName.toLowerCase()}` : UNCATEGORIZED_KEY);
      bump(categories, categoryKey, categoryName, cents, line.quantity, false);
      if (line.costCents === null) {
        kpis.linesWithoutCost += 1;
      } else {
        kpis.profitKnown = true;
        kpis.profitCents += cents - line.costCents * line.quantity;
      }
    });
  }
  kpis.averageCents = kpis.count > 0 ? Math.round(kpis.totalCents / kpis.count) : 0;
  return {
    kpis,
    buckets,
    granularity,
    byStore: [...storesMap.values()].sort(byMoney),
    bySeller: [...sellers.values()].sort(byMoney),
    byMethod: [...methods.values()].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label)),
    topProducts: [...products.values()].sort((a, b) => b.quantity - a.quantity || byMoney(a, b)).slice(0, TOP_PRODUCTS),
    topBrands: [...brands.values()].sort(byMoney).slice(0, TOP_GROUPS),
    topCategories: [...categories.values()].sort(byMoney).slice(0, TOP_GROUPS),
  };
}

function methodLabel(method: string): string {
  return method in INVOICE_PAYMENT_METHOD_LABELS ? INVOICE_PAYMENT_METHOD_LABELS[method as InvoicePaymentMethod] : method;
}

/** The change from the previous period, in whole percent; null when there is nothing to compare with. */
export function changePercent(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

/** "+12%" / "+12 %", "−8%", "0%"; "—" when there is nothing to compare with. */
export function changeText(percent: number | null, lang: Lang = "en"): string {
  if (percent === null) return "—";
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `${sign}${Math.abs(percent)}${lang === "fr" ? " %" : "%"}`;
}

export function changeTone(percent: number | null): "up" | "down" | "flat" {
  if (percent === null || percent === 0) return "flat";
  return percent > 0 ? "up" : "down";
}

// ---------------------------------------------------------------------------
// What happened: the timeline.
// ---------------------------------------------------------------------------

export type TimelineKind = "sale" | "void" | "credit_payment" | "credit_reverted" | "stock";

export type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  atMs: number;
  /** The sale it is about (sales, voids, credit payments); "" for a stock change. */
  saleId: string;
  /** The sale's store, or the movement's. */
  storeId: string;
  amountCents: number;
  /** Who did it: seller, voider, who received the money, who changed the count. */
  staffId: string;
  /** A sale: was it voided since (the marker on the sale row). */
  voided: boolean;
  /** A sale: what was put on credit. */
  creditCents: number;
  /** A sale or a credit payment: the customer of the credit. */
  customerName: string;
  /** A sale: its first products. A stock change: the product. */
  title: string;
  /** A stock change: the movement type and the signed change. */
  movementType: string;
  delta: number;
  itemId: string;
  method: string;
  note: string;
  /** A stock change from a store transfer (v5): its code, and the other store. "" otherwise. */
  transferCode: string;
  counterpartStoreId: string;
};

export type TimelineDay = { dateKey: string; events: TimelineEvent[] };

const STOCK_TYPES = new Set([
  "initial", "add", "set", "transfer_in", "transfer_out",
  // v5 store transfers: sent, received, cancelled (back in stock), returned, written off.
  "transfer_sent", "transfer_received", "transfer_cancelled", "transfer_returned", "transfer_written_off",
]);

function blankEvent(partial: Partial<TimelineEvent> & Pick<TimelineEvent, "id" | "kind" | "atMs">): TimelineEvent {
  return {
    saleId: "", storeId: "", amountCents: 0, staffId: "", voided: false, creditCents: 0, customerName: "",
    title: "", movementType: "", delta: 0, itemId: "", method: "", note: "", transferCode: "", counterpartStoreId: "", ...partial,
  };
}

/**
 * The period's events, newest day first and newest first within a day: each
 * sale (a voided one keeps its row, marked, plus a void row when it was voided
 * in the period), each credit payment (and its revert), and each stock change
 * other than a sale or a void (those are the sale rows already). Product
 * names for stock changes come from `itemName`; sales carry their own.
 */
export function historyTimeline({ sales = [], payments = [], movements = [], period, zone, itemName = () => "", saleCustomer = () => "" }: {
  sales?: readonly unknown[];
  payments?: readonly unknown[];
  movements?: readonly unknown[];
  period: HistoryPeriod;
  zone: string;
  itemName?: (itemId: string) => string;
  /** The customer of a credit sale by its id, for payments on sales outside the period. */
  saleCustomer?: (saleId: string) => string;
}): TimelineDay[] {
  const { startMs, endMs } = periodBounds(period, zone);
  const inside = (ms: number) => ms >= startMs && ms < endMs;
  const events: TimelineEvent[] = [];
  const customers = new Map<string, string>();
  for (const raw of sales) {
    const sale: InventorySale = inventorySaleFromRow(raw);
    if (!sale.id) continue;
    if (sale.credit) customers.set(sale.id, sale.credit.customerName);
    const at = millisOf(sale.createdAt);
    if (inside(at)) {
      const names = sale.lines.map((line) => productDisplayName(line)).filter(Boolean);
      events.push(blankEvent({
        id: `sale:${sale.id}`, kind: "sale", atMs: at, saleId: sale.id, storeId: sale.storeId,
        amountCents: sale.totalCents, staffId: sale.soldByStaffId, voided: sale.voided,
        creditCents: sale.creditCents, customerName: sale.credit?.customerName ?? "",
        title: names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : ""),
        method: sale.paymentMethod,
      }));
    }
    const voidedAt = millisOf(sale.voidedAt);
    if (sale.voided && voidedAt && inside(voidedAt)) {
      events.push(blankEvent({
        id: `void:${sale.id}`, kind: "void", atMs: voidedAt, saleId: sale.id, storeId: sale.storeId,
        amountCents: sale.totalCents, staffId: sale.voidedByStaffId, note: sale.voidReason,
      }));
    }
  }
  for (const raw of payments) {
    const row = asRow(raw);
    const id = text(row.id);
    if (!id) continue;
    const saleId = text(row.saleId);
    const customer = customers.get(saleId) || saleCustomer(saleId);
    const at = millisOf(row.createdAt);
    if (inside(at)) {
      events.push(blankEvent({
        id: `pay:${id}`, kind: "credit_payment", atMs: at, saleId, storeId: text(row.storeId),
        amountCents: nonNegative(row.amountCents), staffId: text(row.receivedByStaffId), method: text(row.method, 40),
        customerName: customer, note: text(row.note), voided: row.reverted === true,
      }));
    }
    const revertedAt = millisOf(row.revertedAt);
    if (row.reverted === true && revertedAt && inside(revertedAt)) {
      events.push(blankEvent({
        id: `revert:${id}`, kind: "credit_reverted", atMs: revertedAt, saleId, storeId: text(row.storeId),
        amountCents: nonNegative(row.amountCents), staffId: text(row.revertedByStaffId), customerName: customer,
      }));
    }
  }
  for (const raw of movements) {
    const row = asRow(raw);
    const id = text(row.id);
    const type = text(row.type, 40);
    if (!id || !STOCK_TYPES.has(type)) continue;
    const at = millisOf(row.createdAt);
    if (!inside(at)) continue;
    const itemId = text(row.itemId);
    events.push(blankEvent({
      id: `move:${id}`, kind: "stock", atMs: at, storeId: text(row.storeId), staffId: text(row.byStaffId),
      movementType: type, delta: Math.round(Number(row.delta) || 0), itemId, title: itemName(itemId), note: text(row.note),
      transferCode: text(row.transferCode, 40), counterpartStoreId: text(row.counterpartStoreId),
    }));
  }
  events.sort((a, b) => b.atMs - a.atMs || a.id.localeCompare(b.id));
  const days: TimelineDay[] = [];
  for (const event of events) {
    const dateKey = dayKeyOf(event.atMs, zone);
    const last = days[days.length - 1];
    if (last && last.dateKey === dateKey) last.events.push(event);
    else days.push({ dateKey, events: [event] });
  }
  return days;
}

// ---------------------------------------------------------------------------
// Sentences with dates or numbers in them, per language.
// ---------------------------------------------------------------------------

function dayDate(key: string): Date {
  return new Date(keyToUtc(key));
}

/** The period as a title: "Fri, Oct 16, 2026", "Oct 11 – 17, 2026", "October 2026", "2026", "Oct 1 – Nov 15, 2026". */
export function periodTitle(period: HistoryPeriod, lang: Lang = "en"): string {
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  const fmt = (key: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(dayDate(key));
  if (period.kind === "day" || period.startKey === period.endKey) {
    return fmt(period.startKey, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  if (period.kind === "month") return fmt(period.startKey, { month: "long", year: "numeric" });
  if (period.kind === "year") return period.startKey.slice(0, 4);
  const sameYear = period.startKey.slice(0, 4) === period.endKey.slice(0, 4);
  const start = fmt(period.startKey, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  const end = fmt(period.endKey, { month: "short", day: "numeric", year: "numeric" });
  return `${start} – ${end}`;
}

/** A timeline day's heading: "Friday, Oct 16" / "vendredi 16 oct.", with the year when it is not this year. */
export function timelineDayTitle(key: string, todayKey: string, lang: Lang = "en"): string {
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  if (key === todayKey) return lang === "fr" ? "Aujourd’hui" : "Today";
  if (isDayKey(todayKey) && key === addDays(todayKey, -1)) return lang === "fr" ? "Hier" : "Yesterday";
  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4);
  return new Intl.DateTimeFormat(locale, {
    weekday: "long", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC",
  }).format(dayDate(key));
}

/** "3:05 PM" / "15:05" in the business's zone. */
export function timeText(ms: number, zone: string, lang: Lang = "en"): string {
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(ms));
}

/** "vs Oct 10 – 16, 2026" / "par rapport à ...". */
export function comparedWithText(period: HistoryPeriod, lang: Lang = "en"): string {
  return `${lang === "fr" ? "par rapport à" : "vs"} ${periodTitle(period, lang)}`;
}

/** "12 sales" / "12 ventes". */
export function salesCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count <= 1 ? "vente" : "ventes"}`;
  return `${count} ${count === 1 ? "sale" : "sales"}`;
}

/** "2 voided ($30.00)" built by the caller; this is the count part: "2 voided" / "2 annulées". */
export function voidedCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count <= 1 ? "annulée" : "annulées"}`;
  return `${count} voided`;
}

/** "Profit leaves out 3 lines with no cost" / "Le bénéfice exclut 3 lignes sans coût". */
export function linesWithoutCostText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `Le bénéfice exclut ${count} ${count <= 1 ? "ligne" : "lignes"} sans coût`;
  return `Profit leaves out ${count} ${count === 1 ? "line" : "lines"} with no cost`;
}

/** "+5" / "−2" / "0": a stock change. */
export function signedDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return "0";
}

/** "Showing the newest 2,000 sales of this period" / "Affichage des 2 000 ventes les plus récentes de cette période". */
export function cappedText(count: number, lang: Lang = "en"): string {
  return lang === "fr"
    ? `Affichage des ${count.toLocaleString("fr-FR")} ventes les plus récentes de cette période`
    : `Showing the newest ${count.toLocaleString("en-US")} sales of this period`;
}

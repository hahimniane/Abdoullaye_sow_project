// Platform-wide commission roll-up for the admin Finance page.
//
// The Finance list has always shown gross, customer-facing amounts. That is
// what the customer paid, not what the platform kept, so the owner could read
// "visible amount $4,356.00" and still not know what the business had earned.
// This module answers the four questions that number does not: how much
// commission has been collected, how much is still expected, where it came
// from, and how it moved over time.
//
// Three rules decide where a record's money lands, and they are the whole
// point of this file:
//
//   1. The platform's cut is `platformFeeAmount` from business-earnings.ts —
//      an explicit fee in cents, else in dollars, else a rate on the gross.
//      That precedence lives in one place; this module imports it.
//   2. Money is EARNED only once the customer actually paid. A computed fee
//      on an unpaid record is expected revenue, not revenue.
//   3. Direct/Zelle records are never billed by the platform, so they produce
//      no commission at all — not earned, not pending. They are reported as
//      "not commissionable" rather than dropped, so the owner is not left
//      hunting for money that was never the platform's to take.
//
// Nothing here throws: the source documents are real, messy Firestore data
// with missing dates, absent fee fields and numbers stored as strings.

import {
  EARNINGS_SERVICE_LABELS,
  earningsLineItems,
  platformFeeAmount,
  type EarningsRecordInput,
} from "./business-earnings.ts";
import { asDate } from "./format.ts";
import type { FirestoreRow } from "@/types/admin";

/** Every money figure this module reports, in whole cents. */
export type PlatformEarningsBucket = {
  /** Commission the platform has actually collected. */
  earnedCents: number;
  /** Commission computed on records the customer has not paid yet. */
  pendingCents: number;
  /** Customer-facing volume behind those records, plus non-commissionable volume. */
  grossCents: number;
  /** Gross recorded on records the platform never bills (direct/Zelle). */
  notCommissionableCents: number;
  /** Gross on cancelled, failed or refunded records — money that will not arrive. */
  voidCents: number;
  /** Billable lines counted, including non-commissionable and void ones. */
  records: number;
};

export type PlatformEarningsBusinessRow = PlatformEarningsBucket & {
  /** The business document id, or "" when the record names no business. */
  businessId: string;
  /**
   * What this row is grouped by, and the value to focus a summary on. Records
   * that name no business id still group by name, so "Unassigned business" is
   * a selectable row rather than an unfilterable one.
   */
  key: string;
  name: string;
};

export type PlatformEarningsServiceRow = PlatformEarningsBucket & {
  /** One of the ids in EARNINGS_SERVICE_LABELS. */
  serviceId: string;
  label: string;
};

export type PlatformEarningsPoint = {
  /** "YYYY-MM-DD" when daily, "YYYY-MM" when monthly. Stable and sortable. */
  key: string;
  /** Short display label, e.g. "Aug 6" or "Aug 2026". */
  label: string;
  /** Start of the bucket, ms since epoch (UTC). */
  startMs: number;
  earnedCents: number;
  pendingCents: number;
};

export type PlatformEarningsSeries = {
  granularity: "day" | "month";
  points: PlatformEarningsPoint[];
  /** Lines with no usable date; counted in the totals but absent from the points. */
  undatedRecords: number;
};

export type PlatformEarningsSummary = {
  totals: PlatformEarningsBucket;
  /** One row per business, richest first. */
  byBusiness: PlatformEarningsBusinessRow[];
  /** One row per service, richest first. */
  byService: PlatformEarningsServiceRow[];
  series: PlatformEarningsSeries;
};

/**
 * Narrows a summary to one business, one service, or one of each.
 *
 * An empty string means "not filtering on this", so a caller can pass its
 * selection state straight through without unwrapping it first.
 */
export type PlatformEarningsFocus = {
  /** A `PlatformEarningsBusinessRow.key`, not a raw document id. */
  businessKey?: string;
  serviceId?: string;
};

export type PlatformEarningsInput = Partial<EarningsRecordInput> & {
  businesses?: FirestoreRow[];
  /**
   * Restricts every figure to the matching lines. Callers that want both a
   * focused view and the full list to pick from should summarize twice - the
   * work is a pass over arrays already in memory, and it keeps this function
   * honest: everything it returns describes the same set of lines.
   */
  focus?: PlatformEarningsFocus;
};

/** Where a line's money belongs. */
export type CommissionState = "earned" | "pending" | "notCommissionable" | "void";

/** paymentStatus values that mean the customer's money actually arrived. */
const COLLECTED_STATUSES = new Set(["succeeded", "paid", "captured", "collected"]);

/**
 * Statuses that end a record without money — either it fell through
 * (cancelled, failed, refunded) or there was never anything to collect
 * ("not_required"). Counting these as "pending" would invent revenue the
 * platform will never collect, which is the same class of mistake as counting
 * gross as commission.
 */
const VOID_STATUSES = new Set([
  "failed",
  "cancelled",
  "canceled",
  "refunded",
  "reversed",
  "chargeback",
  "expired",
  "voided",
  "void",
  "not_required",
]);

/** Lifecycle statuses that stand in for "collected" when paymentStatus is absent. */
const COLLECTED_FALLBACK_STATUSES = new Set([
  ...COLLECTED_STATUSES,
  "completed",
  "released",
]);

/**
 * paymentMethod values that mean the customer paid the business off-platform.
 * "direct" is the one the parking flow writes; the rest are defensive, since
 * legacy rows spell the same idea several ways.
 */
const DIRECT_PAYMENT_METHODS = new Set([
  "direct",
  "cash",
  "zelle",
  "check",
  "offline",
  "manual",
]);

/** paymentStatus values that only ever appear on an off-platform collection. */
const OFF_PLATFORM_STATUSES = new Set([
  "collected_by_business",
  "awaiting_direct_payment",
]);

const UNASSIGNED_BUSINESS_NAME = "Unassigned business";

/** Longest span, in days, still worth charting one bar per day. */
const MAX_DAILY_SPAN_DAYS = 92;
/** Hard ceiling on chart bars, so one absurd date cannot render 600 columns. */
const MAX_POINTS = 240;

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_MS = 86_400_000;

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function emptyBucket(): PlatformEarningsBucket {
  return {
    earnedCents: 0,
    pendingCents: 0,
    grossCents: 0,
    notCommissionableCents: 0,
    voidCents: 0,
    records: 0,
  };
}

/** Dollars to whole cents, tolerant of NaN and of strings that snuck through. */
function toCents(dollars: unknown) {
  const amount = Number(dollars ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

/**
 * Whether the platform ever bills this record.
 *
 * Direct/Zelle parking is recorded so the lot has paper, but no Stripe object
 * exists and the server writes `platformFeeCents: 0`. Treating it as pending
 * commission would show the owner money that is not theirs.
 *
 * @param row The row a line's money is read from.
 * @return True when the platform takes no cut by design.
 */
export function isNonCommissionable(row: FirestoreRow) {
  if (row.platformBilled === false) return true;
  if (DIRECT_PAYMENT_METHODS.has(normalized(row.paymentMethod))) return true;
  if (normalized(row.payoutStatus) === "not_applicable") return true;
  if (OFF_PLATFORM_STATUSES.has(normalized(row.paymentStatus))) return true;
  return false;
}

/**
 * Where one line's commission belongs.
 *
 * paymentStatus is the authority — it is the only field that reports whether
 * the customer's money arrived. Records that carry none (older purchases, some
 * transports) fall back to their lifecycle status, which is the best signal
 * left; the alternative is calling every one of them pending forever.
 *
 * @param row The row a line's money is read from.
 * @return The bucket the line's commission belongs in.
 */
export function commissionState(row: FirestoreRow): CommissionState {
  if (isNonCommissionable(row)) return "notCommissionable";

  const paymentStatus = normalized(row.paymentStatus);
  if (paymentStatus) {
    if (COLLECTED_STATUSES.has(paymentStatus)) return "earned";
    if (VOID_STATUSES.has(paymentStatus)) return "void";
    return "pending";
  }

  const fallbacks = [row.purchaseStatus, row.payoutStatus, row.status]
    .map(normalized)
    .filter(Boolean);
  if (fallbacks.some((status) => COLLECTED_FALLBACK_STATUSES.has(status))) return "earned";
  if (fallbacks.some((status) => VOID_STATUSES.has(status))) return "void";
  return "pending";
}

/**
 * When a line's money happened. Paid dates win, because a chart of commission
 * over time should place revenue on the day it was collected, not the day the
 * order was opened. Unpaid lines fall through to their creation date.
 *
 * @param row The line's row.
 * @param source The stored document the line came from.
 * @return A date, or null when the record carries no usable one.
 */
function lineDate(row: FirestoreRow, source: FirestoreRow): Date | null {
  const fields = [
    "paidAt",
    "paymentCompletedAt",
    "balancePaidAt",
    "collectedAt",
    "completedAt",
    "createdAt",
    "submittedAt",
    "requestedAt",
    "updatedAt",
  ];
  for (const field of fields) {
    const date = asDate(row[field]) ?? asDate(source[field]);
    if (date && Number.isFinite(date.getTime())) return date;
  }
  return null;
}

/** Index of businesses by id and by name, mirroring belongsToBusiness in the console. */
function businessIndex(businesses: FirestoreRow[] | undefined) {
  const byId = new Map<string, FirestoreRow>();
  const byName = new Map<string, FirestoreRow>();
  if (!Array.isArray(businesses)) return { byId, byName };
  for (const business of businesses) {
    if (!business || typeof business !== "object") continue;
    const id = normalized(business.id);
    const name = normalized(business.name);
    if (id && !byId.has(id)) byId.set(id, business);
    if (name && !byName.has(name)) byName.set(name, business);
  }
  return { byId, byName };
}

function resolveBusiness(
  row: FirestoreRow,
  source: FirestoreRow,
  index: ReturnType<typeof businessIndex>,
) {
  const rawId = String(row.businessId ?? source.businessId ?? "").trim();
  const rawName = String(row.businessName ?? source.businessName ?? "").trim();
  const match =
    index.byId.get(rawId.toLowerCase()) ?? index.byName.get(rawName.toLowerCase());
  const id = rawId || String(match?.id ?? "").trim();
  const name =
    rawName || String(match?.name ?? "").trim() || (id ? id : UNASSIGNED_BUSINESS_NAME);
  return { id, name };
}

function addToBucket(bucket: PlatformEarningsBucket, state: CommissionState, grossCents: number, feeCents: number) {
  bucket.records += 1;
  if (state === "earned") {
    bucket.earnedCents += feeCents;
    bucket.grossCents += grossCents;
    return;
  }
  if (state === "pending") {
    bucket.pendingCents += feeCents;
    bucket.grossCents += grossCents;
    return;
  }
  if (state === "notCommissionable") {
    bucket.notCommissionableCents += grossCents;
    bucket.grossCents += grossCents;
    return;
  }
  bucket.voidCents += grossCents;
}

function startOfUtcDay(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function startOfUtcMonth(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function dayKey(ms: number) {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function monthKey(ms: number) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dayLabel(ms: number) {
  const date = new Date(ms);
  return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function monthLabel(ms: number) {
  const date = new Date(ms);
  return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

type DatedLine = { ms: number; state: CommissionState; feeCents: number };

/**
 * Contiguous buckets across the records' own range, so a gap in trading reads
 * as a gap rather than closing up and implying steady revenue.
 */
function buildSeries(lines: DatedLine[], undatedRecords: number): PlatformEarningsSeries {
  if (lines.length === 0) {
    return { granularity: "day", points: [], undatedRecords };
  }

  const first = Math.min(...lines.map((line) => line.ms));
  const last = Math.max(...lines.map((line) => line.ms));
  const spanDays = Math.floor((startOfUtcDay(new Date(last)) - startOfUtcDay(new Date(first))) / DAY_MS);
  const granularity: "day" | "month" = spanDays > MAX_DAILY_SPAN_DAYS ? "month" : "day";

  const buckets = new Map<string, PlatformEarningsPoint>();
  const addPoint = (startMs: number) => {
    const key = granularity === "day" ? dayKey(startMs) : monthKey(startMs);
    if (buckets.has(key)) return;
    buckets.set(key, {
      key,
      label: granularity === "day" ? dayLabel(startMs) : monthLabel(startMs),
      startMs,
      earnedCents: 0,
      pendingCents: 0,
    });
  };

  // Seed the whole range so empty periods still get a (zero) column.
  if (granularity === "day") {
    for (let ms = startOfUtcDay(new Date(first)); ms <= startOfUtcDay(new Date(last)); ms += DAY_MS) {
      addPoint(ms);
      if (buckets.size >= MAX_POINTS) break;
    }
  } else {
    const start = new Date(startOfUtcMonth(new Date(first)));
    const end = startOfUtcMonth(new Date(last));
    let cursor = start.getTime();
    while (cursor <= end && buckets.size < MAX_POINTS) {
      addPoint(cursor);
      const at = new Date(cursor);
      cursor = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1);
    }
  }

  for (const line of lines) {
    if (line.state !== "earned" && line.state !== "pending") continue;
    const date = new Date(line.ms);
    const startMs = granularity === "day" ? startOfUtcDay(date) : startOfUtcMonth(date);
    addPoint(startMs);
    const point = buckets.get(granularity === "day" ? dayKey(startMs) : monthKey(startMs));
    if (!point) continue;
    if (line.state === "earned") point.earnedCents += line.feeCents;
    else point.pendingCents += line.feeCents;
  }

  const points = Array.from(buckets.values()).sort((a, b) => a.startMs - b.startMs);
  // If a stray 1970 date blew the range open, keep the recent end of it.
  return {
    granularity,
    points: points.length > MAX_POINTS ? points.slice(points.length - MAX_POINTS) : points,
    undatedRecords,
  };
}

function sortRows<T extends PlatformEarningsBucket & { name?: string; label?: string }>(rows: T[]) {
  return rows.sort((a, b) => {
    if (b.earnedCents !== a.earnedCents) return b.earnedCents - a.earnedCents;
    if (b.pendingCents !== a.pendingCents) return b.pendingCents - a.pendingCents;
    if (b.grossCents !== a.grossCents) return b.grossCents - a.grossCents;
    return String(a.name ?? a.label ?? "").localeCompare(String(b.name ?? b.label ?? ""));
  });
}

/**
 * Rolls every finance record the admin console already holds into the
 * platform's own books.
 *
 * The per-business and per-service rows partition the same set of lines, so
 * each column of either breakdown sums back to the matching total. That is the
 * invariant the Finance page depends on: if the two disagree, the page is
 * telling the owner two different stories about one pot of money.
 *
 * @param input The loaded record arrays, plus the business list for names.
 * @return Totals, breakdowns and a time series. Never throws.
 */
export function summarizePlatformEarnings(
  input: PlatformEarningsInput = {},
): PlatformEarningsSummary {
  const totals = emptyBucket();
  const businessBuckets = new Map<string, PlatformEarningsBusinessRow>();
  const serviceBuckets = new Map<string, PlatformEarningsServiceRow>();
  const datedLines: DatedLine[] = [];
  let undatedRecords = 0;

  const index = businessIndex(input.businesses);
  const items = earningsLineItems(input);
  const focusBusinessKey = String(input.focus?.businessKey ?? "").trim();
  const focusServiceId = String(input.focus?.serviceId ?? "").trim();

  for (const item of items) {
    const grossCents = toCents(item.gross);
    if (grossCents <= 0) continue;

    const business = resolveBusiness(item.row, item.source, index);
    const businessKey = business.id || `name:${business.name.toLowerCase()}`;
    if (focusBusinessKey && businessKey !== focusBusinessKey) continue;
    if (focusServiceId && item.serviceId !== focusServiceId) continue;

    const state = commissionState(item.row);
    const feeCents =
      state === "notCommissionable" || state === "void"
        ? 0
        : Math.max(0, Math.min(grossCents, toCents(platformFeeAmount(item.row, item.gross))));

    addToBucket(totals, state, grossCents, feeCents);

    let businessRow = businessBuckets.get(businessKey);
    if (!businessRow) {
      businessRow = {
        businessId: business.id,
        key: businessKey,
        name: business.name,
        ...emptyBucket(),
      };
      businessBuckets.set(businessKey, businessRow);
    }
    addToBucket(businessRow, state, grossCents, feeCents);

    let serviceRow = serviceBuckets.get(item.serviceId);
    if (!serviceRow) {
      serviceRow = {
        serviceId: item.serviceId,
        label: EARNINGS_SERVICE_LABELS[item.serviceId] ?? item.serviceId,
        ...emptyBucket(),
      };
      serviceBuckets.set(item.serviceId, serviceRow);
    }
    addToBucket(serviceRow, state, grossCents, feeCents);

    const date = lineDate(item.row, item.source);
    if (date) datedLines.push({ ms: date.getTime(), state, feeCents });
    else undatedRecords += 1;
  }

  return {
    totals,
    byBusiness: sortRows(Array.from(businessBuckets.values())),
    byService: sortRows(Array.from(serviceBuckets.values())),
    series: buildSeries(datedLines, undatedRecords),
  };
}

/** Cents to dollars, for handing figures to formatMoney. */
export function centsToDollars(cents: number) {
  const amount = Number(cents);
  return Number.isFinite(amount) ? amount / 100 : 0;
}

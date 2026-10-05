/**
 * The admin Today tab and Finance commission figures - the pure half.
 *
 * The admin console used to count Today's figures and add up the platform's
 * commission from listeners capped at 150-1000 documents with no order, so
 * past the cap every figure covered a random subset. The figures now come
 * from the server over every record (`getAdminOverview` and
 * `getPlatformEarnings` in my_flutter_app/functions/console_totals.js); this
 * module turns those answers into what the screen shows.
 *
 * Preview mode (local, no Firebase) builds the same shapes from its small,
 * complete sample data with the same rules as the server, so the screen has
 * one code path.
 *
 * Nothing here imports Firebase or React, so it is unit-tested in node.
 */

import {
  summarizePlatformEarnings,
  type PlatformEarningsBusinessRow,
  type PlatformEarningsFocus,
  type PlatformEarningsInput,
  type PlatformEarningsServiceRow,
  type PlatformEarningsSummary,
} from "./platform-earnings.ts";
import type { FirestoreRow } from "@/types/admin";

/** How many of the newest open records each Today queue list reads. */
export const TODAY_RECENT_LIMIT = 10;

/**
 * The statuses getAdminOverview counts - a mirror of ADMIN_STATUS_VOCABULARY
 * in console_totals.js (a test holds the two together). Anything outside the
 * list is counted under "other", so the buckets always add up to the total.
 */
export const ADMIN_STATUS_VOCABULARY = Object.freeze({
  businesses: ["pending", "approved", "suspended", "changes_requested", "rejected"],
  cars: ["active", "inactive", "reserved", "sold"],
  barrelShipments: ["pending_payment", "pending", "in_transit", "ready_for_pickup", "completed", "cancelled"],
  freightShipments: ["pending_payment", "pending", "in_transit", "ready_for_pickup", "completed", "cancelled"],
  carPurchases: ["pending", "viewing_scheduled", "reserved", "completed", "cancelled", "no_show", "refunded", "forfeited"],
  roles: ["admin", "businessOwner", "staff", "customer"],
} as const);

export type StatusTotals = { total: number; counts: Record<string, number> };

/** What getAdminOverview answers. */
export type AdminOverviewResponse = {
  users: StatusTotals;
  businesses: StatusTotals;
  cars: StatusTotals;
  barrelShipments: StatusTotals;
  freightShipments: StatusTotals;
  purchases: StatusTotals;
  applications: { total: number; pending: number };
  missingProfiles: number;
  computedAtMs?: number;
};

/** Every figure the Today tab shows. */
export type AdminTodayMetrics = {
  pendingBusinesses: number;
  approvedBusinesses: number;
  businessTotal: number;
  missingProfiles: number;
  activeListings: number;
  listingTotal: number;
  pendingShipments: number;
  shipmentTotal: number;
  pendingFreight: number;
  freightTotal: number;
  pendingPurchases: number;
  purchaseTotal: number;
  pendingApplications: number;
  applicationTotal: number;
  /** Businesses and applications awaiting a decision. */
  needsReview: number;
  /** Every open item the "Needs your attention" queue stands for. */
  totalOpen: number;
  roles: { admin: number; businessOwner: number; staff: number; customer: number };
  /** Status -> count, zero buckets left out (for the charts). */
  businessStatuses: Record<string, number>;
  carStatuses: Record<string, number>;
  shipmentStatuses: Record<string, number>;
  purchaseStatuses: Record<string, number>;
};

function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function totalsOf(value: unknown): { total: number; counts: Record<string, number> } {
  const source = (value && typeof value === "object" ? value : {}) as Partial<StatusTotals>;
  const counts: Record<string, number> = {};
  const raw = source.counts && typeof source.counts === "object" ? source.counts : {};
  for (const [key, n] of Object.entries(raw)) counts[key] = count(n);
  return { total: count(source.total), counts };
}

/** The buckets that hold something - an empty bucket says nothing on a chart. */
export function nonZeroCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    const n = count(value);
    if (n > 0) out[key] = n;
  }
  return out;
}

/**
 * The Today figures from a getAdminOverview answer. `null` (not loaded yet,
 * or failed) gives zeros, never NaN; a malformed field reads as zero.
 */
export function adminTodayMetrics(overview: AdminOverviewResponse | null | undefined): AdminTodayMetrics {
  const users = totalsOf(overview?.users);
  const businesses = totalsOf(overview?.businesses);
  const cars = totalsOf(overview?.cars);
  const barrels = totalsOf(overview?.barrelShipments);
  const freight = totalsOf(overview?.freightShipments);
  const purchases = totalsOf(overview?.purchases);
  const pendingBusinesses = businesses.counts.pending ?? 0;
  const pendingApplications = count(overview?.applications?.pending);
  const pendingPurchases = purchases.counts.pending ?? 0;
  const pendingShipments = barrels.counts.pending ?? 0;
  const pendingFreight = freight.counts.pending ?? 0;
  const needsReview = pendingBusinesses + pendingApplications;
  return {
    pendingBusinesses,
    approvedBusinesses: businesses.counts.approved ?? 0,
    businessTotal: businesses.total,
    missingProfiles: count(overview?.missingProfiles),
    activeListings: cars.counts.active ?? 0,
    listingTotal: cars.total,
    pendingShipments,
    shipmentTotal: barrels.total,
    pendingFreight,
    freightTotal: freight.total,
    pendingPurchases,
    purchaseTotal: purchases.total,
    pendingApplications,
    applicationTotal: count(overview?.applications?.total),
    needsReview,
    totalOpen: needsReview + pendingPurchases + pendingShipments + pendingFreight,
    roles: {
      admin: users.counts.admin ?? 0,
      businessOwner: users.counts.businessOwner ?? 0,
      staff: users.counts.staff ?? 0,
      customer: users.counts.customer ?? 0,
    },
    businessStatuses: nonZeroCounts(businesses.counts),
    carStatuses: nonZeroCounts(cars.counts),
    shipmentStatuses: nonZeroCounts(barrels.counts),
    purchaseStatuses: nonZeroCounts(purchases.counts),
  };
}

function statusTotals(rows: readonly FirestoreRow[], field: string, vocabulary: readonly string[]): StatusTotals {
  const counts: Record<string, number> = Object.fromEntries(vocabulary.map((value) => [value, 0]));
  let other = 0;
  for (const row of rows) {
    const value = String(row[field] ?? "");
    if (value in counts) counts[value] += 1;
    else other += 1;
  }
  return { total: rows.length, counts: other > 0 ? { ...counts, other } : counts };
}

/**
 * A getAdminOverview-shaped answer from complete rows, counted the way the
 * server counts (an exact status match; anything else is "other"). Only for
 * preview mode, whose sample data is small and complete - never for live
 * listeners, which are paged.
 */
export function adminOverviewFromRows(input: {
  users?: readonly FirestoreRow[];
  businesses?: readonly FirestoreRow[];
  cars?: readonly FirestoreRow[];
  barrelShipments?: readonly FirestoreRow[];
  freightShipments?: readonly FirestoreRow[];
  purchases?: readonly FirestoreRow[];
  applications?: readonly FirestoreRow[];
}): AdminOverviewResponse {
  const vocab = ADMIN_STATUS_VOCABULARY;
  const businesses = input.businesses ?? [];
  const realBusinesses = businesses.filter((row) => row._inferred !== true);
  const applications = input.applications ?? [];
  return {
    users: statusTotals(input.users ?? [], "role", vocab.roles),
    businesses: statusTotals(realBusinesses, "status", vocab.businesses),
    cars: statusTotals(input.cars ?? [], "status", vocab.cars),
    barrelShipments: statusTotals(input.barrelShipments ?? [], "status", vocab.barrelShipments),
    freightShipments: statusTotals(input.freightShipments ?? [], "status", vocab.freightShipments),
    purchases: statusTotals(input.purchases ?? [], "purchaseStatus", vocab.carPurchases),
    applications: {
      total: applications.length,
      pending: applications.filter((row) => row.status === "pending").length,
    },
    missingProfiles: businesses.length - realBusinesses.length,
  };
}

/** What getPlatformEarnings answers (the parts the Finance tab reads). */
export type PlatformEarningsResponse = {
  summary: PlatformEarningsSummary;
  focused: PlatformEarningsSummary;
  businessRows: PlatformEarningsBusinessRow[];
  serviceRows: PlatformEarningsServiceRow[];
  complete?: boolean;
  computedAtMs?: number;
};

/** The payload getPlatformEarnings takes for a focus (empty = everything). */
export function platformEarningsPayload(focus: PlatformEarningsFocus): { focus: { businessKey: string; serviceId: string } } {
  return {
    focus: {
      businessKey: String(focus.businessKey ?? "").trim(),
      serviceId: String(focus.serviceId ?? "").trim(),
    },
  };
}

/**
 * The getPlatformEarnings answer worked out locally - the same cross-filter
 * the callable applies (the business list narrowed by the service picked,
 * the service list by the business picked). Preview mode only.
 */
export function localPlatformEarnings(
  records: Omit<PlatformEarningsInput, "focus">,
  focus: PlatformEarningsFocus,
): PlatformEarningsResponse {
  const { focus: { businessKey, serviceId } } = platformEarningsPayload(focus);
  const summary = summarizePlatformEarnings(records);
  return {
    summary,
    focused: businessKey || serviceId
      ? summarizePlatformEarnings({ ...records, focus: { businessKey, serviceId } })
      : summary,
    businessRows: serviceId
      ? summarizePlatformEarnings({ ...records, focus: { serviceId } }).byBusiness
      : summary.byBusiness,
    serviceRows: businessKey
      ? summarizePlatformEarnings({ ...records, focus: { businessKey } }).byService
      : summary.byService,
    complete: true,
  };
}

/** An earnings answer with nothing in it, for before the first one arrives. */
export function emptyPlatformEarnings(): PlatformEarningsResponse {
  const summary = summarizePlatformEarnings({});
  return { summary, focused: summary, businessRows: [], serviceRows: [] };
}

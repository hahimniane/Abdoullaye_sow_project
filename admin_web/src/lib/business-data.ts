"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, query, where } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { DEFAULT_PAGE_SIZE, type QueryFilterSpec } from "@/lib/paged-query";
import { usePagedQuery, type PagedRows } from "@/lib/use-paged-query";
import type { FirestoreRow } from "@/types/admin";

export type BusinessRowsResult = PagedRows;

/**
 * How a business-scoped list is read.
 *
 * A list is either PAGED - ordered (newest `createdAt` first unless told
 * otherwise) and walked with "Load more" - or COMPLETE (`pageSize: null`),
 * which is only for lists bounded by nature: a business's staff, its
 * activity types, its open containers. A cap without an order is never an
 * option: Firestore answers it with a random subset.
 */
export type BusinessCollectionOptions = {
  /** Rows per page, or null for every matching row. Default 50. */
  pageSize?: number | null;
  /** The field the pages walk. Default "createdAt" (paged lists only). A
   * document without this field is not returned by an ordered query, so
   * pick one every writer stamps. */
  orderBy?: string;
  direction?: "asc" | "desc";
  /** Filters beside businessId - narrow in the query, not after it. */
  where?: readonly QueryFilterSpec[];
  /** "activity" (default) re-sorts loaded rows by their latest update;
   * "query" keeps the query's own order. */
  sort?: "activity" | "query";
};

function timestampMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "object") {
    const candidate = value as {
      seconds?: unknown;
      nanoseconds?: unknown;
      toDate?: unknown;
      toMillis?: unknown;
    };
    if (typeof candidate.toMillis === "function") {
      const millis = candidate.toMillis() as unknown;
      return typeof millis === "number" && Number.isFinite(millis) ? millis : 0;
    }
    if (typeof candidate.toDate === "function") {
      const date = candidate.toDate() as unknown;
      return date instanceof Date ? date.getTime() : 0;
    }
    if (typeof candidate.seconds === "number") {
      const nanos =
        typeof candidate.nanoseconds === "number" ? candidate.nanoseconds : 0;
      return candidate.seconds * 1000 + Math.floor(nanos / 1000000);
    }
  }
  return 0;
}

function activityMs(row: FirestoreRow): number {
  return Math.max(timestampMs(row.updatedAt), timestampMs(row.createdAt));
}

export function sortByActivityDesc(rows: FirestoreRow[]): FirestoreRow[] {
  return [...rows].sort((a, b) => {
    const dateCompare = activityMs(b) - activityMs(a);
    if (dateCompare !== 0) return dateCompare;
    return a.id.localeCompare(b.id);
  });
}

/**
 * A business's documents in a top-level collection, scoped by businessId,
 * live, and either paged in order or complete (see the options).
 */
export function useBusinessCollection(
  name: string,
  businessId: string,
  enabled: boolean,
  options: BusinessCollectionOptions = {},
): BusinessRowsResult {
  const scopedBusinessId = businessId.trim();
  const pageSize = options.pageSize === undefined ? DEFAULT_PAGE_SIZE : options.pageSize;
  const order = pageSize != null || options.orderBy
    ? { field: options.orderBy ?? "createdAt", direction: options.direction ?? "desc" }
    : null;
  const result = usePagedQuery({
    source: scopedBusinessId ? { path: [name] } : null,
    filters: [["businessId", "==", scopedBusinessId], ...(options.where ?? [])],
    orderBy: order,
    pageSize,
    enabled: enabled && Boolean(scopedBusinessId),
  });
  const sortMode = options.sort ?? "activity";
  const rows = useMemo(
    () => (sortMode === "activity" ? sortByActivityDesc(result.rows) : result.rows),
    [result.rows, sortMode],
  );
  return { ...result, rows };
}

/**
 * Whether a business has any document in `name` - one document read (plus
 * changes to it), never the collection. For "does this tab have anything to
 * show", which used to subscribe to every car the business ever listed.
 */
export function useBusinessHasRecords(name: string, businessId: string, enabled: boolean): {
  hasRecords: boolean;
  loading: boolean;
} {
  const scopedBusinessId = businessId.trim();
  const active = enabled && Boolean(scopedBusinessId);
  const [state, setState] = useState<{ key: string; hasRecords: boolean }>({ key: "", hasRecords: false });
  const key = `${name}|${scopedBusinessId}`;
  useEffect(() => {
    if (!active) return undefined;
    // Existence only: any one matching document answers the question, so no
    // order is needed (and none is asked of an index).
    return onSnapshot(
      query(collection(db, name), where("businessId", "==", scopedBusinessId), limit(1)),
      (snapshot) => setState({ key, hasRecords: !snapshot.empty }),
      () => setState({ key, hasRecords: false }),
    );
  }, [active, key, name, scopedBusinessId]);
  // An unanswered probe reads as "nothing yet" rather than spinning: the tab
  // it gates simply appears once the answer arrives.
  return { hasRecords: active && state.key === key && state.hasRecords, loading: active && state.key !== key };
}

/**
 * One document, live - the record a detail view is open on, so it stays on
 * screen even when it leaves the filtered page it was picked from.
 */
export function useLiveDoc(name: string, id: string, enabled: boolean): FirestoreRow | null {
  const [state, setState] = useState<{ key: string; row: FirestoreRow | null }>({ key: "", row: null });
  const key = `${name}/${id}`;
  const active = enabled && Boolean(id);
  useEffect(() => {
    if (!active) return undefined;
    return onSnapshot(
      doc(db, name, id),
      (snap) => setState({ key, row: snap.exists() ? { id: snap.id, _path: snap.ref.path, ...snap.data() } : null }),
      () => setState({ key, row: null }),
    );
  }, [active, id, key, name]);
  return active && state.key === key ? state.row : null;
}

/** Midnight UTC of today: a stay whose end is before it has ended. */
export function startOfUtcDayMs(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * The stays still running - in the lot, reserved, or open-ended - complete
 * and live. Bounded by the lot's capacity, so read whole: every stay whose
 * `occupancyEndMs` (its leave date, or "never" for an open-ended stay; the
 * server keeps it on every write) is today or later. That is exactly the
 * stays businessParkingEndLabel does not call "Ended".
 */
export function useActiveParkedCars(businessId: string, enabled: boolean): BusinessRowsResult {
  const todayMs = startOfUtcDayMs();
  return useBusinessCollection("parkedCars", businessId, enabled, {
    pageSize: null,
    where: [["occupancyEndMs", ">=", todayMs]],
  });
}

/** A business's team. Bounded by nature, so read whole. */
export function useBusinessStaff(businessId: string, enabled: boolean): BusinessRowsResult {
  return useBusinessCollection("users", businessId, enabled, { pageSize: null });
}

function useBusinessSubcollection(
  subcollection: string,
  businessId: string,
  enabled: boolean,
  options: { pageSize: number | null; orderBy?: string },
): BusinessRowsResult {
  const scopedBusinessId = businessId.trim();
  const result = usePagedQuery({
    source: scopedBusinessId ? { path: ["businesses", scopedBusinessId, subcollection] } : null,
    orderBy: options.pageSize != null || options.orderBy
      ? { field: options.orderBy ?? "createdAt", direction: "desc" }
      : null,
    pageSize: options.pageSize,
    enabled: enabled && Boolean(scopedBusinessId),
    rowExtra: () => ({ businessId: scopedBusinessId }),
  });
  const rows = useMemo(() => sortByActivityDesc(result.rows), [result.rows]);
  return { ...result, rows };
}

/** The countries a business serves: a short list, read whole. */
export function useBusinessDestinations(businessId: string, enabled: boolean): BusinessRowsResult {
  return useBusinessSubcollection("destinationCountries", businessId, enabled, { pageSize: null });
}

/** Reviews grow without bound: newest first, paged. */
export function useBusinessReviews(businessId: string, enabled: boolean): BusinessRowsResult {
  return useBusinessSubcollection("reviews", businessId, enabled, { pageSize: DEFAULT_PAGE_SIZE });
}

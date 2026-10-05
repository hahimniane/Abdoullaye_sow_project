"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getCountFromServer, limit, onSnapshot, query, where } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { buildVinPlacementIndex, type VinPlacement } from "@/lib/container-manifest";
import {
  DEFAULT_PAGE_SIZE,
  businessCollectionPlan,
  mergePages,
  type BusinessCollectionOptions,
} from "@/lib/paged-query";
import { parkingMonthQueryPlan } from "@/lib/parking-month-statement";
import { useDocsWhereIn, usePagedQuery, type PagedRows } from "@/lib/use-paged-query";
import type { FirestoreRow } from "@/types/admin";

export type BusinessRowsResult = PagedRows;

export type { BusinessCollectionOptions };

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
  const plan = businessCollectionPlan(scopedBusinessId, options);
  const result = usePagedQuery({
    source: scopedBusinessId ? { path: [name] } : null,
    filters: plan.filters,
    orderBy: plan.orderBy,
    pageSize: plan.pageSize,
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

/**
 * The stays that have ended - history that only grows - most recently ended
 * first, a page at a time. Together with useActiveParkedCars this is every
 * stay exactly once (the two split on the same `occupancyEndMs` boundary).
 */
export function useParkedCarHistory(businessId: string, enabled: boolean): BusinessRowsResult {
  const todayMs = startOfUtcDayMs();
  return useBusinessCollection("parkedCars", businessId, enabled, {
    pageSize: DEFAULT_PAGE_SIZE,
    orderBy: "occupancyEndMs",
    direction: "desc",
    where: [["occupancyEndMs", "<", todayMs]],
    sort: "query",
  });
}

/** Open container statuses: a car on an arrived box is no longer "placed". */
export const OPEN_CONTAINER_STATUSES = ["loading", "shipped"] as const;

/**
 * Which open container each VIN is on, for the "In MSKU1234567" badge under a
 * parked car or a ledger job. Reads only the open containers (few, read
 * whole) and their lines (batched `in` by container id) - never the
 * business's whole loading history, which the badge ignores anyway
 * (buildVinPlacementIndex skips arrived boxes).
 */
export function useOpenContainerPlacements(businessId: string, enabled: boolean): {
  placements: Map<string, VinPlacement>;
  loading: boolean;
  error: string;
} {
  const open = useBusinessCollection("containers", businessId, enabled, {
    pageSize: null,
    where: [["status", "in", [...OPEN_CONTAINER_STATUSES]]],
    sort: "query",
  });
  const containerIds = useMemo(() => open.rows.map((row) => String(row.id)), [open.rows]);
  const lines = useDocsWhereIn({
    collection: "containerLines",
    field: "containerId",
    values: containerIds,
    filters: [["businessId", "==", businessId.trim()]],
    enabled: enabled && Boolean(businessId.trim()),
  });
  const placements = useMemo(
    () => buildVinPlacementIndex(lines.rows, open.rows),
    [lines.rows, open.rows],
  );
  return { placements, loading: open.loading || lines.loading, error: open.error || lines.error };
}

/**
 * What one month's parking bills are built from, live: the four narrow reads
 * of parkingMonthQueryPlan (the server's month-end notice makes the same
 * ones), each complete and bounded by the month. A payment recorded on a car
 * flips its bill by itself, as it always did.
 */
export function useParkingMonthInputs(businessId: string, monthKey: string, enabled: boolean): {
  cars: FirestoreRow[];
  activities: FirestoreRow[];
  loading: boolean;
  error: string;
} {
  const plan = parkingMonthQueryPlan(monthKey);
  const active = enabled && plan !== null;
  const complete = { pageSize: null, sort: "query" } as const;
  const cars = useBusinessCollection("parkedCars", businessId, active, {
    ...complete,
    where: plan?.cars.where ?? [],
  });
  const inMonth = useBusinessCollection("lotActivities", businessId, active, {
    ...complete,
    where: plan?.inMonth.where ?? [],
    orderBy: "activityDate",
    direction: "desc",
  });
  const unsettled = useBusinessCollection("lotActivities", businessId, active, {
    ...complete,
    where: plan?.unsettled.where ?? [],
  });
  const undated = useBusinessCollection("lotActivities", businessId, active, {
    ...complete,
    where: plan?.undated.where ?? [],
  });
  const activities = useMemo(
    () => mergePages([inMonth.rows, unsettled.rows, undated.rows]),
    [inMonth.rows, unsettled.rows, undated.rows],
  );
  return {
    cars: cars.rows,
    activities,
    loading: cars.loading || inMonth.loading || unsettled.loading || undated.loading,
    error: cars.error || inMonth.error || unsettled.error || undated.error,
  };
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

/** A business's office locations: a short list, read whole. */
export function useBusinessOfficeLocations(businessId: string, enabled: boolean): BusinessRowsResult {
  return useBusinessSubcollection("officeLocations", businessId, enabled, { pageSize: null });
}

/** Reviews grow without bound: newest first, paged. */
export function useBusinessReviews(businessId: string, enabled: boolean): BusinessRowsResult {
  return useBusinessSubcollection("reviews", businessId, enabled, { pageSize: DEFAULT_PAGE_SIZE });
}

/**
 * How many of a business's documents carry each value of `field` - a count
 * aggregation per value (one index-entry read per 1,000 matches), never a
 * read of the documents. null until answered, and null again if it fails, so
 * a count is never a guess. Asked once per distinct set of values.
 */
export function useBusinessCountsByValue(
  name: string,
  businessId: string,
  field: string,
  values: readonly string[],
  enabled: boolean,
): Map<string, number | null> {
  const scopedBusinessId = businessId.trim();
  const wanted = useMemo(
    () => Array.from(new Set(values.filter(Boolean))).sort(),
    // Compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values.join("\u0000")],
  );
  const key = JSON.stringify([name, scopedBusinessId, field, wanted]);
  const [state, setState] = useState<{ key: string; counts: Map<string, number | null> }>(
    { key: "", counts: new Map() },
  );
  useEffect(() => {
    if (!enabled || !scopedBusinessId || wanted.length === 0) return undefined;
    let cancelled = false;
    void Promise.all(wanted.map(async (value) => {
      try {
        const snap = await getCountFromServer(query(
          collection(db, name),
          where("businessId", "==", scopedBusinessId),
          where(field, "==", value),
        ));
        return [value, snap.data().count] as const;
      } catch {
        return [value, null] as const;
      }
    })).then((entries) => {
      if (!cancelled) setState({ key, counts: new Map(entries) });
    });
    return () => {
      cancelled = true;
    };
    // `key` carries every input by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return state.key === key ? state.counts : new Map();
}

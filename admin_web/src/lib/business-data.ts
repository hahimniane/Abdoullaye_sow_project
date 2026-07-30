"use client";

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { FirestoreRow } from "@/types/admin";

export type BusinessRowsResult = {
  rows: FirestoreRow[];
  loading: boolean;
  error: string;
  refresh: () => void;
};

const DEFAULT_MAX_ROWS = 150;

function rowFromSnapshot(
  item: QueryDocumentSnapshot<DocumentData>,
  extra: Record<string, unknown> = {},
): FirestoreRow {
  return {
    id: item.id,
    _path: item.ref.path,
    ...extra,
    ...item.data(),
  };
}

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

function sortByActivityDesc(rows: FirestoreRow[]): FirestoreRow[] {
  return [...rows].sort((a, b) => {
    const dateCompare = activityMs(b) - activityMs(a);
    if (dateCompare !== 0) return dateCompare;
    return a.id.localeCompare(b.id);
  });
}

export function useBusinessCollection(
  name: string,
  businessId: string,
  enabled: boolean,
  max: number | null = DEFAULT_MAX_ROWS,
): BusinessRowsResult {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const scopedBusinessId = businessId.trim();
    if (!enabled || !scopedBusinessId) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }

    const constraints: QueryConstraint[] = [
      where("businessId", "==", scopedBusinessId),
    ];
    if (max != null) {
      constraints.push(limit(max));
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      query(collection(db, name), ...constraints),
      (snapshot) => {
        setRows(
          sortByActivityDesc(snapshot.docs.map((item) => rowFromSnapshot(item))),
        );
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        setRows([]);
        setError(snapshotError.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [businessId, enabled, max, name, refreshToken]);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  return { rows, loading, error, refresh };
}

export function useBusinessStaff(
  businessId: string,
  enabled: boolean,
  max = DEFAULT_MAX_ROWS,
): BusinessRowsResult {
  return useBusinessCollection("users", businessId, enabled, max);
}

function useBusinessSubcollection(
  subcollection: string,
  businessId: string,
  enabled: boolean,
  max: number,
): BusinessRowsResult {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const scopedBusinessId = businessId.trim();
    if (!enabled || !scopedBusinessId) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      query(
        collection(db, "businesses", scopedBusinessId, subcollection),
        limit(max),
      ),
      (snapshot) => {
        setRows(
          sortByActivityDesc(
            snapshot.docs.map((item) =>
              rowFromSnapshot(item, { businessId: scopedBusinessId }),
            ),
          ),
        );
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        setRows([]);
        setError(snapshotError.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [businessId, enabled, max, refreshToken, subcollection]);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  return { rows, loading, error, refresh };
}

export function useBusinessDestinations(
  businessId: string,
  enabled: boolean,
  max = DEFAULT_MAX_ROWS,
): BusinessRowsResult {
  return useBusinessSubcollection("destinationCountries", businessId, enabled, max);
}

export function useBusinessReviews(
  businessId: string,
  enabled: boolean,
  max = DEFAULT_MAX_ROWS,
): BusinessRowsResult {
  return useBusinessSubcollection("reviews", businessId, enabled, max);
}

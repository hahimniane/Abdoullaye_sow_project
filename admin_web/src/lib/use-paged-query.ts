"use client";

// Ordered, cursor-paged Firestore lists - the React half. The plan (which
// window each page listens to, how pages merge) is pure and tested in
// paged-query.ts; this file only turns it into listeners.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  collectionGroup,
  endAt,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  hasMorePages,
  inBatches,
  mergePages,
  pageWindows,
  querySpecKey,
  sameWindow,
  type PageWindow,
  type QueryFilterSpec,
  type QueryOrderSpec,
} from "@/lib/paged-query";
import type { FirestoreRow } from "@/types/admin";

type Snapshot = QueryDocumentSnapshot<DocumentData>;

/** Where the documents live: a collection path, or a collection group. */
export type PagedQuerySource =
  | { path: readonly string[] }
  | { group: string };

export type PagedQuerySpec = {
  /** null disables the query (rows empty, not loading). */
  source: PagedQuerySource | null;
  filters?: readonly QueryFilterSpec[];
  /** Required whenever pageSize is a number: a cap without an order is a
   * random subset. */
  orderBy?: QueryOrderSpec | null;
  /** Page size, or null for every matching document in one listener. */
  pageSize: number | null;
  enabled: boolean;
  /** Extra fields stamped on each row (e.g. the parent business id). */
  rowExtra?: (snapshot: Snapshot) => Record<string, unknown>;
};

export type PagedRows = {
  rows: FirestoreRow[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
};

/** Long enough for a slow network, short enough that a spinner never sticks. */
export const PAGED_QUERY_TIMEOUT_MS = 20000;
export const PAGED_QUERY_TIMEOUT_MESSAGE =
  "This list is taking longer than usual to load. Check your connection and try again.";

const NO_CURSORS: Snapshot[] = [];

function rowFrom(snapshot: Snapshot, extra: Record<string, unknown>): FirestoreRow {
  return { id: snapshot.id, _path: snapshot.ref.path, ...extra, ...snapshot.data() };
}

function baseQuery(source: PagedQuerySource) {
  if ("group" in source) return collectionGroup(db, source.group);
  const [first, ...rest] = source.path;
  return collection(db, first, ...rest);
}

type Listener = { window: PageWindow<Snapshot>; unsubscribe: () => void };

type PageState = { key: string; pages: (FirestoreRow[] | undefined)[]; counts: number[] };

export function usePagedQuery(spec: PagedQuerySpec): PagedRows {
  const { source, filters, orderBy: order, pageSize, enabled, rowExtra } = spec;
  if (pageSize != null && !order) {
    throw new Error("usePagedQuery: a capped query needs an orderBy.");
  }
  const [refreshToken, setRefreshToken] = useState(0);
  const active = Boolean(enabled && source);
  const key = useMemo(
    () => `${querySpecKey({ source, filters, orderBy: order, pageSize })}#${refreshToken}`,
    // The spec is compared by value: callers build it inline every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(source), JSON.stringify(filters ?? []), order?.field, order?.direction, pageSize, refreshToken],
  );
  const [cursorState, setCursorState] = useState<{ key: string; cursors: Snapshot[] }>({ key: "", cursors: [] });
  const cursors = cursorState.key === key ? cursorState.cursors : NO_CURSORS;
  const [pageState, setPageState] = useState<PageState>({ key: "", pages: [], counts: [] });
  const [status, setStatus] = useState<{ key: string; loading: boolean; loadingMore: boolean; error: string }>(
    { key: "", loading: false, loadingMore: false, error: "" },
  );
  const listeners = useRef<{ key: string; entries: Listener[] }>({ key: "", entries: [] });
  const lastDocs = useRef<{ key: string; docs: (Snapshot | undefined)[] }>({ key: "", docs: [] });
  const extraRef = useRef(rowExtra);
  extraRef.current = rowExtra;

  // Tear everything down when the component goes away.
  useEffect(() => () => {
    listeners.current.entries.forEach((entry) => entry.unsubscribe());
    listeners.current = { key: "", entries: [] };
  }, []);

  useEffect(() => {
    const registry = listeners.current;
    if (!active || !source) {
      registry.entries.forEach((entry) => entry.unsubscribe());
      listeners.current = { key: "", entries: [] };
      return;
    }
    if (registry.key !== key) {
      registry.entries.forEach((entry) => entry.unsubscribe());
      registry.entries = [];
      registry.key = key;
      lastDocs.current = { key, docs: [] };
      setPageState({ key, pages: [], counts: [] });
      setStatus({ key, loading: true, loadingMore: false, error: "" });
    }
    const windows = pageWindows(cursors, pageSize);
    windows.forEach((window, index) => {
      const existing = registry.entries[index];
      if (existing && sameWindow(existing.window, window)) return;
      existing?.unsubscribe();
      const constraints: QueryConstraint[] = (filters ?? []).map(([field, op, value]) => where(field, op, value));
      if (order) constraints.push(orderBy(order.field, order.direction ?? "asc"));
      if (window.after) constraints.push(startAfter(window.after));
      if (window.through) constraints.push(endAt(window.through));
      if (window.limit != null) constraints.push(limit(window.limit));
      const unsubscribe = onSnapshot(
        query(baseQuery(source), ...constraints),
        (snapshot) => {
          if (listeners.current.key !== key) return;
          const docs = snapshot.docs;
          lastDocs.current.docs[index] = docs[docs.length - 1];
          const extra = extraRef.current;
          const rows = docs.map((item) => rowFrom(item, extra ? extra(item) : {}));
          setPageState((prev) => {
            const base = prev.key === key ? prev : { key, pages: [], counts: [] };
            const pages = base.pages.slice();
            const counts = base.counts.slice();
            pages[index] = rows;
            counts[index] = docs.length;
            return { key, pages, counts };
          });
          setStatus((prev) => (prev.key === key
            ? { ...prev, loading: index === 0 ? false : prev.loading, loadingMore: false, error: "" }
            : prev));
        },
        (snapshotError) => {
          if (listeners.current.key !== key) return;
          setStatus((prev) => (prev.key === key
            ? { ...prev, loading: false, loadingMore: false, error: snapshotError.message }
            : prev));
        },
      );
      registry.entries[index] = { window, unsubscribe };
    });
    registry.entries.slice(windows.length).forEach((entry) => entry.unsubscribe());
    registry.entries.length = windows.length;
    // `filters`, `order` and `source` are captured by value through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, cursors, pageSize]);

  // Every loading state resolves: a listener that never answers (offline,
  // a stalled network) gives way to a message instead of a spinner.
  const waiting = status.key === key && (status.loading || status.loadingMore);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = window.setTimeout(() => {
      setStatus((prev) => (prev.key === key && (prev.loading || prev.loadingMore)
        ? { key, loading: false, loadingMore: false, error: PAGED_QUERY_TIMEOUT_MESSAGE }
        : prev));
    }, PAGED_QUERY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [key, waiting]);

  const pages = pageState.key === key && active ? pageState.pages : [];
  const counts = pageState.key === key && active ? pageState.counts : [];
  const rows = useMemo(() => mergePages(pages), [pages]);
  const lastIndex = cursors.length;
  const current = status.key === key && active ? status : { loading: active, loadingMore: false, error: "" };
  const hasMore = active && pages[lastIndex] !== undefined && hasMorePages(counts[lastIndex], pageSize);

  const loadMore = useCallback(() => {
    if (!hasMore || current.loadingMore) return;
    const cursor = lastDocs.current.key === key ? lastDocs.current.docs[lastIndex] : undefined;
    if (!cursor) return;
    setStatus((prev) => (prev.key === key ? { ...prev, loadingMore: true } : prev));
    setCursorState({ key, cursors: [...cursors, cursor] });
  }, [cursors, current.loadingMore, hasMore, key, lastIndex]);

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  return {
    rows,
    loading: current.loading,
    loadingMore: current.loadingMore,
    error: current.error,
    hasMore,
    loadMore,
    refresh,
  };
}

/**
 * Live documents whose `field` is one of `values`, in Firestore `in`
 * batches of 30, plus fixed equality filters (the business scope the rules
 * need). For joins against a known, bounded id list - the lines of the open
 * containers, this business's quotes on the requests on screen - so a panel
 * never subscribes to a whole collection to look up a few rows.
 */
export function useDocsWhereIn(spec: {
  collection: string;
  field: string;
  values: readonly string[];
  filters?: readonly QueryFilterSpec[];
  enabled: boolean;
}): { rows: FirestoreRow[]; loading: boolean; error: string } {
  const { collection: name, field, values, filters, enabled } = spec;
  const sortedValues = useMemo(
    () => Array.from(new Set(values.filter(Boolean))).sort(),
    // Compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values.join("\u0000")],
  );
  const key = JSON.stringify([name, field, sortedValues, filters ?? [], enabled]);
  const [state, setState] = useState<{ key: string; batches: (FirestoreRow[] | undefined)[]; error: string }>(
    { key: "", batches: [], error: "" },
  );

  useEffect(() => {
    if (!enabled || sortedValues.length === 0) return undefined;
    const batches = inBatches(sortedValues);
    setState({ key, batches: batches.map(() => undefined), error: "" });
    const unsubscribes = batches.map((batch, index) => onSnapshot(
      query(
        collection(db, name),
        ...(filters ?? []).map(([f, op, value]) => where(f, op, value)),
        where(field, "in", batch),
      ),
      (snapshot) => {
        const rows = snapshot.docs.map((item) => rowFrom(item, {}));
        setState((prev) => {
          const base = prev.key === key ? prev : { key, batches: batches.map(() => undefined), error: "" };
          const next = base.batches.slice();
          next[index] = rows;
          return { key, batches: next, error: "" };
        });
      },
      (error) => setState((prev) => ({ key, batches: prev.key === key ? prev.batches : [], error: error.message })),
    ));
    return () => unsubscribes.forEach((stop) => stop());
    // `key` carries every input by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A join that never answers must not hold a spinner: give up after the
  // same budget as the paged lists.
  const [timedOut, setTimedOut] = useState("");
  const pending = enabled && sortedValues.length > 0 &&
    (state.key !== key || state.batches.some((batch) => batch === undefined)) && !state.error;
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setTimeout(() => setTimedOut(key), PAGED_QUERY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [key, pending]);

  const rows = useMemo(
    () => (state.key === key ? mergePages(state.batches) : []),
    [key, state],
  );
  if (!enabled || sortedValues.length === 0) return { rows: [], loading: false, error: "" };
  return {
    rows,
    loading: pending && timedOut !== key,
    error: state.key === key ? state.error : timedOut === key ? PAGED_QUERY_TIMEOUT_MESSAGE : "",
  };
}

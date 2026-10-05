"use client";

// Totals the server works out over every record (my_flutter_app/functions/
// console_totals.js). Lists in the consoles are paged, so a figure added up
// from the rows on screen would only cover the pages loaded so far; these
// hooks ask the callable instead.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";

export const SERVER_TOTALS_TIMEOUT_MS = 60000;
export const SERVER_TOTALS_FAILED = "Totals could not be loaded. Try again.";
export const SERVER_TOTALS_SLOW =
  "Totals are taking longer than usual. Try again in a moment.";

export type ServerTotals<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  /** Ask again; `force` asks the server to skip a cached answer. */
  refresh: (force?: boolean) => void;
};

/**
 * Calls `name` with `payload` whenever the payload (or `reloadKey`) changes.
 * `payload: null` disables the call. Every path - answer, failure, or no
 * answer at all - leaves `loading` false.
 */
export function useServerTotals<T>(
  name: string,
  payload: Record<string, unknown> | null,
  reloadKey: unknown = 0,
): ServerTotals<T> {
  const payloadKey = payload ? JSON.stringify(payload) : "";
  const key = payloadKey ? `${name}|${payloadKey}|${JSON.stringify(reloadKey)}` : "";
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean; error: string }>(
    { key: "", data: null, loading: false, error: "" },
  );
  const [force, setForce] = useState(0);
  const forceRef = useRef(false);

  useEffect(() => {
    if (!key) return undefined;
    let settled = false;
    const refresh = forceRef.current;
    forceRef.current = false;
    setState((prev) => ({ key, data: prev.key === key || prev.data ? prev.data : null, loading: true, error: "" }));
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setState((prev) => (prev.key === key ? { ...prev, loading: false, error: SERVER_TOTALS_SLOW } : prev));
    }, SERVER_TOTALS_TIMEOUT_MS);
    httpsCallable(functions, name)({ ...JSON.parse(payloadKey), ...(refresh ? { refresh: true } : {}) })
      .then((response) => {
        if (settled) return;
        settled = true;
        setState((prev) => (prev.key === key
          ? { key, data: (response.data ?? null) as T, loading: false, error: "" }
          : prev));
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        setState((prev) => (prev.key === key ? { ...prev, loading: false, error: SERVER_TOTALS_FAILED } : prev));
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      settled = true;
      window.clearTimeout(timer);
    };
    // `key` carries the payload by value; `force` re-runs it on demand.
  }, [key, force, name, payloadKey]);

  const refresh = useCallback((forceServer = false) => {
    forceRef.current = forceServer;
    setForce((value) => value + 1);
  }, []);

  const current = state.key === key;
  return useMemo(() => ({
    // A previous answer stays on screen while the next one loads, so a
    // changed filter does not blank the board.
    data: key ? state.data : null,
    loading: Boolean(key) && (!current || state.loading),
    error: current ? state.error : "",
    refresh,
  }), [current, key, refresh, state.data, state.error, state.loading]);
}

/** The viewer's IANA zone, so the server dates legacy rows as this screen does. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

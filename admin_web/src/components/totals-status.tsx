"use client";

import { RefreshCw } from "lucide-react";

import { formatDateTime } from "@/lib/format";

/**
 * The line under a server-computed scoreboard: when the figures were worked
 * out, a way to ask again, and what went wrong if they could not be. Totals
 * come from the server over every record (the lists are paged), and a busy
 * screen may be shown an answer a few minutes old, so the time is always
 * said rather than implied.
 */
export function TotalsStatus({
  computedAtMs,
  loading,
  error,
  complete = true,
  onRefresh,
}: {
  computedAtMs?: number | null;
  loading: boolean;
  error: string;
  complete?: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="totals-status" aria-live="polite">
      {error ? (
        <span className="totals-status-error">{error}</span>
      ) : loading && !computedAtMs ? (
        <span>Counting the totals…</span>
      ) : computedAtMs ? (
        <span>
          <span>Totals as of</span>{" "}
          <span data-no-translate>{formatDateTime(computedAtMs)}</span>
        </span>
      ) : null}
      {!complete && !error && (
        <span className="totals-status-error">Some records are still being counted. Refresh in a moment.</span>
      )}
      <button
        aria-busy={loading}
        className="ghost-button compact"
        disabled={loading}
        onClick={onRefresh}
        type="button"
      >
        {/* A failed count is never a dead end: the same button retries. */}
        <RefreshCw size={14} /> {loading ? "Loading…" : error ? "Retry" : "Refresh"}
      </button>
    </div>
  );
}

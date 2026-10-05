/**
 * When publicCatalog/services is bumped, every open customer tab re-asks the
 * catalog callables. Without a spread, one business toggling a service made
 * every open tab hit the backend in the same second. Each tab now waits a
 * random 0-30 s first; the initial load stays immediate.
 *
 * Pure - no React, no Firebase - so the timing is unit-tested in node.
 */

export const CATALOG_REFETCH_MAX_JITTER_MS = 30_000;

/**
 * How long to wait before re-fetching after a catalog bump.
 *
 * @param random A source in [0, 1), Math.random by default.
 * @return Whole milliseconds in 0..CATALOG_REFETCH_MAX_JITTER_MS.
 */
export function catalogRefetchDelayMs(random: () => number = Math.random): number {
  const value = Number(random());
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return CATALOG_REFETCH_MAX_JITTER_MS;
  return Math.floor(value * (CATALOG_REFETCH_MAX_JITTER_MS + 1));
}

export type CatalogBumpScheduler = {
  /** Call on every publicCatalog/services snapshot. */
  onSignal: () => void;
  /** Call on unmount: a pending re-fetch never fires afterwards. */
  dispose: () => void;
};

/**
 * Turns catalog-version snapshots into jittered re-fetches.
 *
 * The first snapshot only delivers the current value (the initial load
 * already covers it) and is skipped. A later bump schedules one re-fetch
 * after `delayMs()`. A bump that arrives while one is already pending joins
 * it: that re-fetch will read the newest catalog anyway, and re-arming the
 * timer would let a stream of bumps postpone the refresh forever.
 */
export function createCatalogBumpScheduler(options: {
  refetch: () => void;
  delayMs?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): CatalogBumpScheduler {
  const delayMs = options.delayMs ?? (() => catalogRefetchDelayMs());
  const setTimer = options.setTimer ??
    ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms));
  const clearTimer = options.clearTimer ??
    ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  let first = true;
  let disposed = false;
  let pending: { handle: unknown } | null = null;

  return {
    onSignal() {
      if (disposed) return;
      if (first) {
        first = false;
        return;
      }
      if (pending) return;
      const entry: { handle: unknown } = { handle: null };
      pending = entry;
      entry.handle = setTimer(() => {
        if (pending === entry) pending = null;
        if (!disposed) options.refetch();
      }, delayMs());
    },
    dispose() {
      disposed = true;
      if (pending) clearTimer(pending.handle);
      pending = null;
    },
  };
}

/**
 * The businesses behind "Send a package" (`listPackageRequestOptions`),
 * loaded as early and as rarely as possible (owner, 11/11/2026: the page took
 * ~5 s, "customers aren't patient").
 *
 * - The router starts the call the moment the URL asks for a package page,
 *   in parallel with downloading the form's code (`prefetchPackageOptions`).
 *   The form then picks up the same request instead of starting its own.
 * - The last answer is kept on the device. A returning customer sees the
 *   countries at once while a fresh answer replaces it in the background.
 *
 * The cache only ever shortens the wait: the form still loads fresh data,
 * and prices are confirmed again when the customer asks for them.
 */

/** How long a kept answer may be shown while the fresh one loads. */
export const PACKAGE_OPTIONS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const KEY_PREFIX = "laawol.packageOptions.v1.";

export type PackageOptionsAnswer = { business: unknown; options: unknown[] };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function keyFor(slug: string) {
  return KEY_PREFIX + (String(slug || "").trim().toLowerCase() || "all");
}

/** Whether a stored value is a usable answer: the shape the form reads. */
export function validPackageAnswer(value: unknown): value is PackageOptionsAnswer {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.options) && v.options.length > 0 &&
    v.options.every((o) => o && typeof o === "object" &&
      typeof (o as { country?: { id?: unknown } }).country?.id === "string");
}

/** The kept answer for this link, or null when there is none, it is too old, or unreadable. */
export function readCachedPackageOptions(
  storage: Storage | null | undefined,
  slug: string,
  nowMs: number,
): PackageOptionsAnswer | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyFor(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { atMs?: unknown; data?: unknown };
    const atMs = Number(parsed?.atMs);
    if (!Number.isFinite(atMs) || nowMs - atMs > PACKAGE_OPTIONS_MAX_AGE_MS || atMs > nowMs + 60_000) return null;
    return validPackageAnswer(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Keeps a fresh answer on the device (best effort: full or blocked storage is ignored). */
export function writeCachedPackageOptions(
  storage: Storage | null | undefined,
  slug: string,
  data: unknown,
  nowMs: number,
) {
  if (!storage || !validPackageAnswer(data)) return;
  try {
    storage.setItem(keyFor(slug), JSON.stringify({ atMs: nowMs, data }));
  } catch {
    // Private mode or a full disk: the page just loads without the shortcut.
  }
}

/** The browser's localStorage, or null where it is blocked. */
export function deviceStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// One request in flight per link, shared by the router's prefetch and the form.
const inFlight = new Map<string, Promise<PackageOptionsAnswer>>();

/**
 * The fresh answer for a link. A request already started (by the prefetch)
 * is reused once; after it settles the next call asks again, so "Try again"
 * really retries. A fresh answer is kept on the device.
 */
export function loadPackageOptions(
  slug: string,
  fetcher: (data: Record<string, unknown>) => Promise<PackageOptionsAnswer>,
): Promise<PackageOptionsAnswer> {
  const key = keyFor(slug);
  const pending = inFlight.get(key);
  if (pending) {
    inFlight.delete(key);
    return pending;
  }
  return startPackageOptions(slug, fetcher, false);
}

function startPackageOptions(
  slug: string,
  fetcher: (data: Record<string, unknown>) => Promise<PackageOptionsAnswer>,
  keep: boolean,
): Promise<PackageOptionsAnswer> {
  const key = keyFor(slug);
  const request = fetcher(slug ? { slug } : {}).then((data) => {
    writeCachedPackageOptions(deviceStorage(), slug, data, Date.now());
    return data;
  });
  if (keep) {
    inFlight.set(key, request);
    // A prefetch nobody picks up must not keep an old answer forever.
    request.catch(() => undefined).finally(() => {
      setTimeout(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      }, 60_000);
    });
  }
  return request;
}

/** Starts the request early (the router, before the form's code has arrived). */
export function prefetchPackageOptions(
  slug: string,
  fetcher: (data: Record<string, unknown>) => Promise<PackageOptionsAnswer>,
) {
  if (inFlight.has(keyFor(slug))) return;
  startPackageOptions(slug, fetcher, true).catch(() => undefined);
}

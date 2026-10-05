/**
 * Whether this browser can keep the Firestore cache on disk.
 *
 * Pure (takes the global object) so it is unit-tested without a browser.
 * Anything short of a usable `indexedDB` - missing, or a getter that throws,
 * as some locked-down and private profiles do - means the memory cache.
 */
export function firestoreCacheChoice(scope: unknown): "persistent" | "memory" {
  try {
    const candidate = (scope as { indexedDB?: unknown } | null | undefined)?.indexedDB;
    if (!candidate || typeof (candidate as { open?: unknown }).open !== "function") return "memory";
    return "persistent";
  } catch {
    return "memory";
  }
}

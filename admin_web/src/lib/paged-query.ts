/**
 * Ordered, cursor-paged Firestore lists - the pure half.
 *
 * Every console list used to be `where(businessId) + limit(N)` with no
 * order. Firestore answers that with the first N documents by document id,
 * which is a random subset: past N, new records silently went missing and
 * every total computed from the rows was wrong. A capped list is now always
 * ordered (newest first, by default), and "Load more" walks it with cursors.
 *
 * Live pages without gaps: the newest page listens with `limit(pageSize)`.
 * When the reader asks for more, that page is pinned to end AT its last
 * document (no limit) and the next page starts AFTER it. A record created
 * later lands on the first page instead of pushing its last row off into a
 * gap no page covers, and every loaded row stays live. Each "Load more"
 * re-listens one page (the one being pinned) - nothing else re-reads.
 *
 * Nothing here imports Firebase, so the plan is unit-tested in node.
 */

export const DEFAULT_PAGE_SIZE = 50;

export type QueryFilterOp =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not-in"
  | "array-contains"
  | "array-contains-any";

/** [field, operator, value] - the arguments of one `where`. */
export type QueryFilterSpec = readonly [field: string, op: QueryFilterOp, value: unknown];

export type QueryOrderSpec = { field: string; direction?: "asc" | "desc" };

/** One page's bounds: start after `after`, end at `through`, cap at `limit`. */
export type PageWindow<C> = { after: C | null; through: C | null; limit: number | null };

/**
 * The window each loaded page listens to.
 *
 * `cursors[i]` is the last document page `i` held when page `i + 1` was
 * requested. Page 0 starts at the top; every page but the last is pinned to
 * its cursor; only the last page carries a limit.
 *
 * @param cursors One per "Load more" so far.
 * @param pageSize The page size, or null for one uncapped window.
 * @return The windows, first page first.
 */
export function pageWindows<C>(cursors: readonly C[], pageSize: number | null): PageWindow<C>[] {
  if (pageSize == null) return [{ after: null, through: null, limit: null }];
  const windows: PageWindow<C>[] = [];
  for (let i = 0; i <= cursors.length; i += 1) {
    const through = i < cursors.length ? cursors[i] : null;
    windows.push({
      after: i === 0 ? null : cursors[i - 1],
      through,
      limit: through === null ? pageSize : null,
    });
  }
  return windows;
}

/** Whether two windows listen to the same thing (so a listener is kept). */
export function sameWindow<C>(a: PageWindow<C> | undefined, b: PageWindow<C>): boolean {
  return Boolean(a) && a!.after === b.after && a!.through === b.through && a!.limit === b.limit;
}

/**
 * The pages, in order, as one list. A record can sit in two pages for the
 * instant between a reorder and the next snapshot; it is listed once.
 */
export function mergePages<T extends { id: string; _path?: unknown }>(
  pages: readonly (readonly T[] | undefined)[],
): T[] {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const page of pages) {
    for (const row of page ?? []) {
      const key = typeof row._path === "string" && row._path ? row._path : row.id;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

/** A full last page means there may be more behind it. */
export function hasMorePages(lastPageCount: number | undefined, pageSize: number | null): boolean {
  return pageSize != null && (lastPageCount ?? 0) >= pageSize;
}

/**
 * The identity of a query: two specs with the same key listen to the same
 * documents. Values are primitives or arrays of them, so JSON is exact.
 */
export function querySpecKey(spec: {
  source: unknown;
  filters?: readonly QueryFilterSpec[];
  orderBy?: QueryOrderSpec | null;
  pageSize?: number | null;
}): string {
  return JSON.stringify([
    spec.source ?? null,
    spec.filters ?? [],
    spec.orderBy ? [spec.orderBy.field, spec.orderBy.direction ?? "asc"] : null,
    spec.pageSize ?? null,
  ]);
}

/** Split values for Firestore `in` queries (at most 30 values each). */
export function inBatches<T>(values: readonly T[], size = 30): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

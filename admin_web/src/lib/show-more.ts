/**
 * "Show more" paging for long lists that are already in memory (the admin
 * finance ledger, a business's invoices). Rendering every row of a list that
 * grows without bound is what makes a panel slow to open; 50 at a time keeps
 * the first paint small and the rest one click away.
 *
 * The page resets whenever `resetKey` changes (new filters or search), so a
 * narrowed list never opens scrolled 300 rows deep.
 */
export const SHOW_MORE_STEP = 50;

export type ShowMoreState = { key: string; limit: number };

export function initialShowMore(resetKey: string): ShowMoreState {
  return { key: resetKey, limit: SHOW_MORE_STEP };
}

/** The limit in force for `resetKey`: the stored one, or a fresh first page. */
export function showMoreLimit(state: ShowMoreState, resetKey: string): number {
  return state.key === resetKey ? state.limit : SHOW_MORE_STEP;
}

export function showMoreNext(state: ShowMoreState, resetKey: string): ShowMoreState {
  return { key: resetKey, limit: showMoreLimit(state, resetKey) + SHOW_MORE_STEP };
}

export function showMoreSlice<T>(rows: readonly T[], limit: number) {
  const shown = rows.length > limit ? rows.slice(0, limit) : rows;
  return { shown, remaining: Math.max(0, rows.length - shown.length) };
}

"use client";

import { useMemo, useState } from "react";

import {
  initialShowMore,
  showMoreLimit,
  showMoreNext,
  showMoreSlice,
} from "@/lib/show-more";

/** The first page of `rows`, and a way to reveal the next 50. Changing
 * `resetKey` (filters, search) starts again from the first page. */
export function useShowMore<T>(rows: readonly T[], resetKey: string) {
  const [state, setState] = useState(() => initialShowMore(resetKey));
  const limit = showMoreLimit(state, resetKey);
  const { shown, remaining } = useMemo(() => showMoreSlice(rows, limit), [rows, limit]);
  return {
    shown,
    remaining,
    showMore: () => setState((current) => showMoreNext(current, resetKey)),
  };
}

export function ShowMoreButton({
  remaining,
  onClick,
}: {
  remaining: number;
  onClick: () => void;
}) {
  if (remaining <= 0) return null;
  return (
    <div className="show-more-row">
      <button className="secondary-button compact" onClick={onClick} type="button">
        Show more
      </button>
    </div>
  );
}

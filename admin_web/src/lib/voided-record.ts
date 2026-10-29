// A voided record - a lot activity, a purchase, an expense line, a parked
// car - is never deleted: it stays on the list, struck through, with who
// voided it and why, and drops out of every total. These are the pure rules
// the lists share, so a parked car and an activity read the same way.

type Row = Record<string, unknown> | null | undefined;

/** True when the record was voided (the server writes `voided: true`). */
export function isVoidedRecord(row: Row): boolean {
  return Boolean(row) && (row as Record<string, unknown>).voided === true;
}

/**
 * The same rows with the voided ones moved to the end, in their own order.
 * A voided record is history: it stays visible, but never above live work.
 */
export function voidedLast<T>(rows: readonly T[]): T[] {
  const live: T[] = [];
  const voided: T[] = [];
  for (const row of rows) {
    (isVoidedRecord(row as Row) ? voided : live).push(row);
  }
  return voided.length === 0 ? (rows as T[]) : [...live, ...voided];
}

/** The pieces of the "Voided · reason · by · date" line. */
export type VoidedNoteParts = {
  /** What the person typed, verbatim (user data: never translated). */
  reason: string;
  /** The staff uid that voided it, for the caller to name. */
  byStaffId: string;
  /** When it was voided, as stored (Timestamp / Date / string). */
  at: unknown;
};

/** What a voided record carries about its voiding. */
export function voidedNoteParts(row: Row): VoidedNoteParts {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    reason: String(r.voidReason ?? "").trim(),
    byStaffId: String(r.voidedByStaffId ?? "").trim(),
    at: r.voidedAt ?? null,
  };
}

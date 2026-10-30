import { BUSINESS_ACCOUNT_RECEIVER, businessAccountName } from "./staff-balances.ts";

/**
 * uid -> the name a business's panels show for one of its own people.
 *
 * Built once per staff list (useMemo) and read per row. The panels used to run
 * `staff.rows.find(...)` inside every table row, which is O(rows x staff) per
 * render - the per-node cost the guardrails forbid.
 */
export function staffNameIndex(
  rows: readonly Record<string, unknown>[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (!id || index.has(id)) continue;
    const name = [row.fullName, row.name, row.email]
      .map((value) => String(value ?? "").trim())
      .find(Boolean);
    if (name) index.set(id, name);
  }
  return index;
}

/**
 * The name for `id`, or "" when this business cannot name that person. The
 * Business account (money paid straight to the business, docs/STAFF_BALANCES.md)
 * is named too, in the page's language - a payment received by it reads
 * "Received by Business account", never as an unknown person.
 */
export function staffNameFrom(index: ReadonlyMap<string, string>, id: unknown): string {
  const key = String(id ?? "").trim();
  if (key === BUSINESS_ACCOUNT_RECEIVER) return businessAccountName();
  return key ? index.get(key) ?? "" : "";
}

/** The business's people as `{id, name}` choices for a "Received by" select, in the index's order. */
export function staffOptionsFrom(index: ReadonlyMap<string, string>): { id: string; name: string }[] {
  return Array.from(index, ([id, name]) => ({ id, name }));
}

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

/** The name for `id`, or "" when this business cannot name that person. */
export function staffNameFrom(index: ReadonlyMap<string, string>, id: unknown): string {
  const key = String(id ?? "").trim();
  return key ? index.get(key) ?? "" : "";
}

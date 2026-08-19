/**
 * What a lost parcel pays back - the business's table, not the sender's
 * claim.
 *
 * Mirror of my_flutter_app/functions/freight_payback.js (the authority) and
 * my_flutter_app/lib/utils/freight_payback.dart. All three clients must
 * price the same item identically; the server re-prices everything anyway,
 * so a drifted mirror shows a wrong number for exactly as long as it takes
 * the callable to answer with the right one.
 */

export const PLATFORM_MAX_PAYBACK = 10000;
export const MAX_ITEMS_PER_CATEGORY = 30;
export const MAX_ITEM_LABEL_LENGTH = 60;

export type PaybackItem = {
  id: string;
  label: string;
  paybackAmount: number;
};

export type PaybackCategoryEntry = {
  items: PaybackItem[];
  otherPaybackAmount: number;
};

export type PaybackTable = Record<string, PaybackCategoryEntry>;

/** Starter rows for the editor. Amounts are the business's job, not ours. */
export const STANDARD_FREIGHT_ITEMS: Record<
  string,
  ReadonlyArray<{id: string; label: string}>
> = {
  electronics: [
    {id: "iphone", label: "iPhone"},
    {id: "samsung-phone", label: "Samsung phone"},
    {id: "other-phone", label: "Other phone"},
    {id: "laptop", label: "Laptop"},
    {id: "tablet", label: "Tablet"},
    {id: "tv", label: "Television"},
    {id: "game-console", label: "Game console"},
  ],
  cosmetics: [
    {id: "perfume", label: "Perfume"},
    {id: "hair-products", label: "Hair products"},
  ],
  fragile: [{id: "dishes", label: "Dishes and glassware"}],
};

export type PaybackLookup = {
  listed: boolean;
  paybackAmount: number;
  source: "item" | "other" | null;
  label?: string;
};

/**
 * The payback row for an item: exact row first, then the category's
 * catch-all. Unlisted is a routing answer - it sends the booking to the
 * quote-request path instead of instant booking.
 */
export function freightPaybackFor({
  table,
  categoryId,
  itemId,
}: {
  table: unknown;
  categoryId: string;
  itemId?: string;
}): PaybackLookup {
  const record =
    table && typeof table === "object"
      ? (table as Record<string, unknown>)[String(categoryId || "").trim()]
      : undefined;
  if (!record || typeof record !== "object") {
    return {listed: false, paybackAmount: 0, source: null};
  }
  const entry = record as {items?: unknown; otherPaybackAmount?: unknown};
  const wanted = String(itemId || "").trim();
  if (wanted && Array.isArray(entry.items)) {
    const row = entry.items.find(
      (item) => (item as PaybackItem | undefined)?.id === wanted,
    ) as PaybackItem | undefined;
    if (row) {
      return {
        listed: true,
        paybackAmount: Number(row.paybackAmount) || 0,
        source: "item",
        label: String(row.label || ""),
      };
    }
  }
  const other = Number(entry.otherPaybackAmount) || 0;
  if (other > 0) return {listed: true, paybackAmount: other, source: "other"};
  return {listed: false, paybackAmount: 0, source: null};
}

/**
 * The coverage fee for a payback amount under the business's rate - the
 * only arithmetic a client is trusted to preview.
 */
export function coverageFeeCentsFor(
  paybackAmount: number,
  ratePct: number,
): number {
  const paybackCents = Math.round((Number(paybackAmount) || 0) * 100);
  const rate = Number(ratePct) || 0;
  if (paybackCents <= 0 || rate <= 0) return 0;
  return Math.round(paybackCents * (rate / 100));
}

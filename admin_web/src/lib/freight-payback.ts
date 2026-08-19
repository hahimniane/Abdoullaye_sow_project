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

/** The funnel's synthetic id for "something not on anyone's list". */
export const OTHER_ITEM_ID = "__other";

type ProviderLike = {
  freightPaybackTable?: unknown;
};

function providerTable(option: ProviderLike): Record<string, unknown> | null {
  const table = option?.freightPaybackTable;
  if (!table || typeof table !== "object") return null;
  return Object.keys(table as object).length > 0
    ? (table as Record<string, unknown>)
    : null;
}

/**
 * The item choices for a category, across every provider serving the route.
 *
 * The funnel asks what the customer is sending BEFORE showing businesses, so
 * the choices are the union of every provider's rows - one provider listing
 * "iPhone" is enough for it to be pickable. "Something else" appears when any
 * provider would still take an unlisted item: a category catch-all, or a
 * business with no table at all (which carries anything).
 */
export function freightItemChoicesFor(
  options: ReadonlyArray<ProviderLike>,
  categoryId: string,
): Array<{id: string; label: string}> {
  const seen = new Map<string, string>();
  let anyCatchAll = false;
  for (const option of options) {
    const table = providerTable(option);
    if (!table) {
      anyCatchAll = true;
      continue;
    }
    const entry = table[String(categoryId || "").trim()] as
      | {items?: unknown; otherPaybackAmount?: unknown}
      | undefined;
    if (!entry || typeof entry !== "object") continue;
    for (const raw of Array.isArray(entry.items) ? entry.items : []) {
      const row = raw as {id?: unknown; label?: unknown};
      const id = String(row?.id || "").trim();
      const label = String(row?.label || "").trim();
      if (id && label && !seen.has(id)) seen.set(id, label);
    }
    if ((Number(entry.otherPaybackAmount) || 0) > 0) anyCatchAll = true;
  }
  const choices = [...seen.entries()].map(([id, label]) => ({id, label}));
  choices.sort((a, b) => a.label.localeCompare(b.label));
  if (anyCatchAll) {
    choices.push({id: OTHER_ITEM_ID, label: "Something else"});
  }
  return choices;
}

/**
 * Whether one provider can instant-book this item.
 *
 * A provider with no table carries anything (it prices by declared value);
 * a provider with a table qualifies through the exact row or its category
 * catch-all - the same resolution the server prices with.
 */
export function providerQualifiesForItem(
  option: ProviderLike,
  categoryId: string,
  itemId: string,
): boolean {
  const table = providerTable(option);
  if (!table) return true;
  return freightPaybackFor({
    table,
    categoryId,
    itemId: itemId === OTHER_ITEM_ID ? "" : itemId,
  }).listed;
}

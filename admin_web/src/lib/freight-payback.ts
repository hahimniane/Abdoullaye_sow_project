/**
 * What a lost parcel pays back - the business's table, not the sender's
 * claim. A covering business owes the whole published amount; the customer
 * is charged nothing for that promise, because the item was already priced
 * for what it is worth to carry.
 *
 * The same table says what each thing costs to carry: one row answers both
 * questions, so the price and the promise can never come from different
 * places.
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

/** A single parcel priced above this belongs with a freight forwarder. */
export const MAX_ITEM_FLAT_PRICE = 10000;

/** Past this an "allowance" is really a by-weight parcel wearing a hat. */
export const MAX_INCLUDED_KG = 200;

/** The same band a category multiplier lives in, for the same reasons. */
export const MIN_WEIGHT_FACTOR = 0.5;
export const MAX_WEIGHT_FACTOR = 10;

/**
 * How one row is priced. A set price for a known object, or the route's
 * per-kg rate for goods that vary. The business picks per row because only
 * it knows which of its goods are which.
 */
export type FreightPricingMode = "flat" | "per_kg";

export type PaybackItem = {
  id: string;
  label: string;
  paybackAmount: number;
  pricingMode?: FreightPricingMode;
  flatPrice?: number;
  includedKg?: number;
  weightFactor?: number;
};

export type PaybackCategoryEntry = {
  items: PaybackItem[];
  otherPaybackAmount: number;
  otherPricingMode?: FreightPricingMode;
  otherFlatPrice?: number;
  otherIncludedKg?: number;
  otherWeightFactor?: number;
};

export type PaybackTable = Record<string, PaybackCategoryEntry>;

/**
 * Why a payback table would not save, in the business's own words.
 *
 * Mirrors the map the callable answers with, so a refusal reads the same
 * whether this console caught it or the server did.
 */
export const FREIGHT_PAYBACK_ERRORS: Record<string, string> = {
  table_invalid: "Those payback settings are not valid",
  category_invalid: "One of the categories is not valid",
  too_many_items: "A category can hold at most 30 items",
  item_invalid: "Every item needs a name",
  item_duplicated: "Two items in one category share the same id",
  payback_out_of_range: "Payback amounts must be between $0 and $10,000",
  pricing_mode_invalid: "Say whether an item has a set price or is priced by weight",
  flat_price_out_of_range: "A set price must be between $0.01 and $10,000",
  included_kg_out_of_range: "An included weight must be between 0 and 200 kg",
  weight_factor_out_of_range: "A weight factor must be between 0.5 and 10",
};

export function freightPaybackErrorMessage(code: unknown): string {
  const key = String(code || "");
  return FREIGHT_PAYBACK_ERRORS[key] ?? FREIGHT_PAYBACK_ERRORS.table_invalid;
}

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

export type FreightItemPricing = {
  mode: FreightPricingMode;
  flatPrice: number;
  includedKg: number;
  weightFactor: number;
  needsWeightAtBooking: boolean;
  weighsAtDropOff: boolean;
  source: "item" | "other" | null;
};

/**
 * How to charge for one item: a set price, or by weight.
 *
 * Resolves in the same order the payback does - the exact row, then the
 * category catch-all - so the price and the promise always come from the
 * same place. A row that names no pricing falls through to the category
 * multiplier, which is how every booking is priced today and how a business
 * that has never opened this editor keeps charging what it charges.
 */
export function freightItemPricing({
  table,
  categoryId,
  itemId,
  categoryMultiplier = 1,
}: {
  table: unknown;
  categoryId: string;
  itemId?: string;
  categoryMultiplier?: number;
}): FreightItemPricing {
  const record =
    table && typeof table === "object"
      ? (table as Record<string, unknown>)[String(categoryId || "").trim()]
      : undefined;
  const byWeight = (
    weightFactor: number,
    source: "item" | "other" | null,
  ): FreightItemPricing => ({
    mode: "per_kg",
    flatPrice: 0,
    includedKg: 0,
    weightFactor,
    needsWeightAtBooking: true,
    weighsAtDropOff: true,
    source,
  });
  if (!record || typeof record !== "object") {
    return byWeight(categoryMultiplier, null);
  }
  const entry = record as PaybackCategoryEntry;

  const wanted = String(itemId || "").trim();
  const row = wanted
    ? (Array.isArray(entry.items) ? entry.items : []).find(
        (item) => (item as PaybackItem | undefined)?.id === wanted,
      )
    : undefined;
  const read = (
    source: "item" | "other",
    mode: unknown,
    flat: unknown,
    included: unknown,
    factor: unknown,
  ): FreightItemPricing => {
    if (mode === "flat") {
      const includedKg = Number(included) || 0;
      return {
        mode: "flat",
        flatPrice: Number(flat) || 0,
        includedKg,
        weightFactor: 0,
        // The customer is never asked to guess the weight of a known
        // object. They pick "iPhone 16", see the price, and that is the
        // transaction.
        needsWeightAtBooking: false,
        // But the business still puts it on the scale when the price covers
        // only so much: a phone in a carton packed out with shoes is not the
        // parcel that was priced. No allowance means the price covers it
        // however heavy it is, and nothing is weighed at all.
        weighsAtDropOff: includedKg > 0,
        source,
      };
    }
    const resolved = Number(factor);
    return byWeight(
      Number.isFinite(resolved) && resolved > 0 ? resolved : categoryMultiplier,
      source,
    );
  };

  if (row && row.pricingMode) {
    return read(
      "item",
      row.pricingMode,
      row.flatPrice,
      row.includedKg,
      row.weightFactor,
    );
  }
  if (entry.otherPricingMode) {
    return read(
      "other",
      entry.otherPricingMode,
      entry.otherFlatPrice,
      entry.otherIncludedKg,
      entry.otherWeightFactor,
    );
  }
  return byWeight(categoryMultiplier, row ? "item" : null);
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
 * A provider with no table carries anything; a provider with a table
 * qualifies through the exact row or its category catch-all - the same
 * resolution the server prices with.
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

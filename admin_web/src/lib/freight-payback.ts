/**
 * What a business carries, and what it charges for each of those things.
 *
 * The list is the catalogue: the rows here are what a customer picks from,
 * and each one says how this business prices that thing. An item it has not
 * listed, or has listed and not priced, becomes a request the business
 * answers rather than something bookable on the spot.
 *
 * There is no amount attached to losing a parcel. A business either makes
 * good on one or it does not - the single flag in the coverage policy - and
 * publishing a figure per item invited exactly the haggling the design was
 * meant to remove. Cover is never charged for either way: a business prices
 * each item for what it is worth to carry, so the risk is already inside
 * what it charges.
 *
 * Mirror of my_flutter_app/functions/freight_payback.js (the authority) and
 * my_flutter_app/lib/utils/freight_payback.dart. All three clients must
 * price the same item identically; the server re-prices everything anyway,
 * so a drifted mirror shows a wrong number for exactly as long as it takes
 * the callable to answer with the right one.
 */

export const MAX_ITEMS_PER_CATEGORY = 30;
export const MAX_ITEM_LABEL_LENGTH = 60;

/** A single parcel priced above this belongs with a freight forwarder. */
export const MAX_ITEM_FLAT_PRICE = 10000;

/** Past this an "allowance" is really a by-weight parcel wearing a hat. */
export const MAX_INCLUDED_KG = 200;

/**
 * How one row is priced. A set price for a known object, or the route's
 * per-kg rate for goods that vary. The business picks per row because only
 * it knows which of its goods are which.
 */
export type FreightPricingMode = "flat" | "per_kg";

export type PaybackItem = {
  id: string;
  label: string;
  pricingMode?: FreightPricingMode;
  flatPrice?: number;
  includedKg?: number;
};

export type PaybackCategoryEntry = {
  items: PaybackItem[];
  otherPricingMode?: FreightPricingMode;
  otherFlatPrice?: number;
  otherIncludedKg?: number;
};

export type PaybackTable = Record<string, PaybackCategoryEntry>;

/**
 * Why a catalogue would not save, in the business's own words.
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
  pricing_mode_invalid: "Say whether an item has a set price or is priced by weight",
  flat_price_out_of_range: "A set price must be between $0.01 and $10,000",
  included_kg_out_of_range: "An included weight must be between 0 and 200 kg",
};

export function freightPaybackErrorMessage(code: unknown): string {
  const key = String(code || "");
  return FREIGHT_PAYBACK_ERRORS[key] ?? FREIGHT_PAYBACK_ERRORS.table_invalid;
}

/** Starter rows for the editor. Pricing is the business's job, not ours. */
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
  source: "item" | "other" | null;
  label?: string;
};

/**
 * Whether this business lists the item at all: exact row first, then the
 * category's catch-all.
 *
 * Listing is a routing answer, not a promise - it decides whether a customer
 * books on the spot or asks this business for a price. What is owed on a lost
 * parcel is not per-item: it is the one cover flag on the business.
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
    return {listed: false, source: null};
  }
  const entry = record as {items?: unknown; otherPricingMode?: unknown};
  const wanted = String(itemId || "").trim();
  if (wanted && Array.isArray(entry.items)) {
    const row = entry.items.find(
      (item) => (item as PaybackItem | undefined)?.id === wanted,
    ) as PaybackItem | undefined;
    if (row) {
      return {listed: true, source: "item", label: String(row.label || "")};
    }
  }
  // The category's catch-all covers anything else in it, when the business
  // has priced one. Having a mode is what makes it a row at all.
  if (entry.otherPricingMode) return {listed: true, source: "other"};
  return {listed: false, source: null};
}

export type FreightItemPricing = {
  /** Whether the business named a price for this at all. */
  priced: boolean;
  mode: FreightPricingMode | null;
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
 * Resolves in the same order the listing does - the exact row, then the
 * category catch-all - so what a customer can pick and what it costs always
 * come from the same place. A row nobody priced answers `priced: false`, and
 * the customer is sent to ask this business for a number instead of being
 * quoted one it never chose.
 */
export function freightItemPricing({
  table,
  categoryId,
  itemId,
}: {
  table: unknown;
  categoryId: string;
  itemId?: string;
}): FreightItemPricing {
  const record =
    table && typeof table === "object"
      ? (table as Record<string, unknown>)[String(categoryId || "").trim()]
      : undefined;
  // A price nobody set is not a price to guess at. Every other answer here
  // is a number the business typed; this one is the absence of one, and it
  // routes the booking to a request rather than to a checkout.
  const unpriced: FreightItemPricing = {
    priced: false,
    mode: null,
    flatPrice: 0,
    includedKg: 0,
    weightFactor: 0,
    needsWeightAtBooking: false,
    weighsAtDropOff: false,
    source: null,
  };
  if (!record || typeof record !== "object") return unpriced;
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
  ): FreightItemPricing => {
    if (mode === "flat") {
      const includedKg = Number(included) || 0;
      return {
        priced: true,
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
    // By weight is this business's own per-kg rate for the route, plain.
    // There is no factor on top: a unitless number was something an owner
    // had to reason about rather than a price it could state.
    return {
      priced: true,
      mode: "per_kg",
      flatPrice: 0,
      includedKg: 0,
      weightFactor: 1,
      needsWeightAtBooking: true,
      weighsAtDropOff: true,
      source,
    };
  };

  if (row) {
    // A listed row that states no pricing has never been quoted by this
    // business. It asks for a price rather than inheriting one from the
    // catch-all, which is for things nobody listed.
    return row.pricingMode
      ? read("item", row.pricingMode, row.flatPrice, row.includedKg)
      : unpriced;
  }
  if (entry.otherPricingMode) {
    return read(
      "other",
      entry.otherPricingMode,
      entry.otherFlatPrice,
      entry.otherIncludedKg,
    );
  }
  return unpriced;
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
 * "iPhone" is enough for it to be pickable. "Something else" is always last,
 * because a parcel nobody has a row for is exactly what the price-request
 * path exists to answer.
 */
export function freightItemChoicesFor(
  options: ReadonlyArray<ProviderLike>,
  categoryId: string,
): Array<{id: string; label: string}> {
  const seen = new Map<string, string>();
  for (const option of options) {
    const table = providerTable(option);
    if (!table) continue;
    const entry = table[String(categoryId || "").trim()] as
      | {items?: unknown}
      | undefined;
    if (!entry || typeof entry !== "object") continue;
    for (const raw of Array.isArray(entry.items) ? entry.items : []) {
      const row = raw as {id?: unknown; label?: unknown};
      const id = String(row?.id || "").trim();
      const label = String(row?.label || "").trim();
      if (id && label && !seen.has(id)) seen.set(id, label);
    }
  }
  const choices = [...seen.entries()].map(([id, label]) => ({id, label}));
  choices.sort((a, b) => a.label.localeCompare(b.label));
  choices.push({id: OTHER_ITEM_ID, label: "Something else"});
  return choices;
}

/**
 * Whether one provider can book this item on the spot.
 *
 * Two conditions, and both are the server's: the item resolves to a listed
 * row (exact row, then the category catch-all) AND that same row names a
 * price. A provider that lists an item without pricing it, or that has no
 * table at all, answers the request path instead - it has a number to give,
 * it has simply never given it.
 */
export function providerQualifiesForItem(
  option: ProviderLike,
  categoryId: string,
  itemId: string,
): boolean {
  const table = providerTable(option);
  if (!table) return false;
  const resolved = itemId === OTHER_ITEM_ID ? "" : itemId;
  if (!freightPaybackFor({table, categoryId, itemId: resolved}).listed) {
    return false;
  }
  return freightItemPricing({table, categoryId, itemId: resolved}).priced;
}

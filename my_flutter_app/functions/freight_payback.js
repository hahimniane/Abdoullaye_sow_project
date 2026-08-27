/**
 * What a business carries, and what it charges for each of those things.
 *
 * The list is the catalogue: the rows here are what a customer picks from,
 * and each one says how this business prices that thing. An item the
 * business has not listed, or has listed and not priced, is not something
 * it can be booked for - it becomes a request the business answers.
 *
 * There is no amount attached to losing a parcel. A business either makes
 * good on one or it does not - the single flag in freight_coverage.js - and
 * publishing a figure per item invited exactly the haggling the whole
 * design was meant to remove. Nothing is charged for cover either way: a
 * business prices each item for what it is worth to carry, so the risk is
 * already inside what it charges.
 *
 * Mirrored by admin_web/src/lib/freight-payback.ts and
 * my_flutter_app/lib/utils/freight_payback.dart - all three clients must
 * price the same item identically.
 */

/** A business drowning customers in choices is its own failure mode. */
const MAX_ITEMS_PER_CATEGORY = 30;
const MAX_ITEM_LABEL_LENGTH = 60;

/**
 * Starter rows a business can adopt and reprice. Curated so the customer
 * picker shows the things this trade actually ships - not a taxonomy.
 * Suggestions only: every amount here is 0 until the business prices it.
 */
const STANDARD_FREIGHT_ITEMS = Object.freeze({
  electronics: Object.freeze([
    {id: "iphone", label: "iPhone"},
    {id: "samsung-phone", label: "Samsung phone"},
    {id: "other-phone", label: "Other phone"},
    {id: "laptop", label: "Laptop"},
    {id: "tablet", label: "Tablet"},
    {id: "tv", label: "Television"},
    {id: "game-console", label: "Game console"},
  ]),
  cosmetics: Object.freeze([
    {id: "perfume", label: "Perfume"},
    {id: "hair-products", label: "Hair products"},
  ]),
  fragile: Object.freeze([
    {id: "dishes", label: "Dishes and glassware"},
  ]),
});

/** A single parcel priced above this belongs with a freight forwarder. */
const MAX_ITEM_FLAT_PRICE = 10000;

/** Past this an "allowance" is really a by-weight parcel wearing a hat. */
const MAX_INCLUDED_KG = 200;

/**
 * How one row is priced, cleaned.
 *
 * Two ways, and the business picks per row because only it knows which of
 * its goods are which. An iPhone 16 is always the same phone - known size,
 * known weight - so it gets one price and never sees a scale. A bag of
 * clothes is different every time, so it is weighed, and the existing
 * weigh-and-confirm settlement runs exactly as before.
 *
 * A row with no pricing at all is not an error and not a price: it is a
 * row this business has never quoted, and it goes to a price request. It
 * used to inherit its category's multiplier, which meant the platform
 * charging a number nobody at that business had chosen.
 *
 * @param {object} source The item row, or the category entry for "other".
 * @param {string} [scope] "other" to read the category catch-all's keys.
 * @return {object} {ok, pricing} or {ok: false, error}.
 */
function cleanItemPricing(source, scope) {
  const prefix = scope === "other" ? "other" : "";
  const key = (name) => prefix ?
    prefix + name[0].toUpperCase() + name.slice(1) :
    name;
  const rawMode = String(source?.[key("pricingMode")] || "").trim();
  if (!rawMode) return {ok: true, pricing: {}};
  if (rawMode !== "flat" && rawMode !== "per_kg") {
    return {ok: false, error: "pricing_mode_invalid"};
  }
  if (rawMode === "flat") {
    const price = Number(source?.[key("flatPrice")]);
    if (!Number.isFinite(price) || price <= 0 ||
        price > MAX_ITEM_FLAT_PRICE) {
      return {ok: false, error: "flat_price_out_of_range"};
    }
    // What the set price covers by weight. A phone in its retail box with a
    // charger weighs several times a bare phone, and without an allowance
    // the business eats that difference and stops offering set prices.
    // Blank means the price covers the parcel however heavy it is, which is
    // the right answer for a business that does not want to think about it.
    const rawIncluded = source?.[key("includedKg")];
    const blank = rawIncluded === undefined || rawIncluded === null ||
      rawIncluded === "";
    const includedKg = blank ? 0 : Number(rawIncluded);
    if (!blank &&
        (!Number.isFinite(includedKg) || includedKg < 0 ||
          includedKg > MAX_INCLUDED_KG)) {
      return {ok: false, error: "included_kg_out_of_range"};
    }
    return {
      ok: true,
      pricing: {
        [key("pricingMode")]: "flat",
        [key("flatPrice")]: Math.round(price * 100) / 100,
        ...(includedKg > 0 && {
          [key("includedKg")]: Math.round(includedKg * 1000) / 1000,
        }),
      },
    };
  }
  // By weight means this business's own per-kg rate for the route, and
  // nothing else. A per-row factor was the category multiplier wearing a
  // different hat: a number with no unit that a business had to reason
  // about rather than a price it could state.
  return {ok: true, pricing: {[key("pricingMode")]: "per_kg"}};
}

/**
 * Validates the payback table a business is trying to save.
 *
 * Shape: {categoryId: {items: [{id, label, pricingMode, ...}]}}. Refuses
 * rather than clamps - a business that types an impossible price must be
 * told, not silently saved at a number it never chose.
 *
 * @param {object} table The table being saved.
 * @return {object} {ok, table} cleaned, or {ok: false, error, categoryId}.
 */
function validateFreightPaybackTable(table) {
  if (table === null || table === undefined) {
    return {ok: true, table: {}};
  }
  if (typeof table !== "object" || Array.isArray(table)) {
    return {ok: false, error: "table_invalid"};
  }
  const cleaned = {};
  for (const [categoryId, entry] of Object.entries(table)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return {ok: false, error: "category_invalid", categoryId};
    }
    const items = Array.isArray(entry.items) ? entry.items : [];
    if (items.length > MAX_ITEMS_PER_CATEGORY) {
      return {ok: false, error: "too_many_items", categoryId};
    }
    const cleanedItems = [];
    const seen = new Set();
    for (const item of items) {
      const id = String(item?.id || "").trim().toLowerCase()
          .replace(/[^a-z0-9-]/g, "-").slice(0, 60);
      const label = String(item?.label || "").trim()
          .slice(0, MAX_ITEM_LABEL_LENGTH);
      if (!id || !label) {
        return {ok: false, error: "item_invalid", categoryId};
      }
      if (seen.has(id)) {
        return {ok: false, error: "item_duplicated", categoryId};
      }
      seen.add(id);
      const pricing = cleanItemPricing(item);
      if (!pricing.ok) {
        return {ok: false, error: pricing.error, categoryId};
      }
      cleanedItems.push({id, label, ...pricing.pricing});
    }
    const otherPricing = cleanItemPricing(entry, "other");
    if (!otherPricing.ok) {
      return {ok: false, error: otherPricing.error, categoryId};
    }
    cleaned[categoryId] = {items: cleanedItems, ...otherPricing.pricing};
  }
  return {ok: true, table: cleaned};
}

/**
 * Whether this business lists the item at all.
 *
 * Listing is a routing answer, not a promise: a row it has is a row a
 * customer can pick, and anything else becomes a request. What the business
 * owes on a lost parcel is not per-item and never was a number here - it is
 * the one cover flag in freight_coverage.js.
 *
 * @param {object} params Inputs.
 * @param {object} params.table The business's saved catalogue.
 * @param {string} params.categoryId The category being shipped.
 * @param {string} [params.itemId] The item row, when one was picked.
 * @return {object} {listed, source: "item"|"other"|null, label}.
 */
function freightPaybackFor({table, categoryId, itemId}) {
  const entry = table && typeof table === "object" ?
    table[String(categoryId || "").trim()] :
    undefined;
  if (!entry) return {listed: false, source: null};
  const wanted = String(itemId || "").trim();
  if (wanted) {
    const row = (Array.isArray(entry.items) ? entry.items : [])
        .find((item) => item?.id === wanted);
    if (row) {
      return {listed: true, source: "item", label: String(row.label || "")};
    }
  }
  // The category's catch-all covers anything else in it, when the business
  // has priced one.
  if (entry.otherPricingMode) return {listed: true, source: "other"};
  return {listed: false, source: null};
}

/**
 * How to charge for one item: a set price, or by weight.
 *
 * Resolves in the same order the payback does - the exact row, then the
 * category catch-all - so the price and the promise always come from the
 * same place. A row that names no pricing falls through to the category
 * multiplier, which is how every booking is priced today and how a client
 * that has never heard of item pricing keeps working.
 *
 * @param {object} params Inputs.
 * @param {object} params.table The business's saved payback table.
 * @param {string} params.categoryId The category being shipped.
 * @param {string} [params.itemId] The item row, when one was picked.
 * @return {object} {priced, mode, flatPrice, includedKg, weightFactor,
 *   needsWeightAtBooking, weighsAtDropOff, source}.
 */
function freightItemPricing({table, categoryId, itemId}) {
  const entry = table && typeof table === "object" ?
    table[String(categoryId || "").trim()] :
    undefined;
  // Nothing to charge from. A price nobody set is not a price to guess at:
  // the booking becomes a request the business answers with a number, which
  // is the only honest thing to do with an item it has never quoted.
  const unpriced = {
    priced: false,
    mode: null,
    flatPrice: 0,
    includedKg: 0,
    weightFactor: 0,
    needsWeightAtBooking: false,
    weighsAtDropOff: false,
    source: null,
  };
  if (!entry) return unpriced;

  const wanted = String(itemId || "").trim();
  const row = wanted ?
    (Array.isArray(entry.items) ? entry.items : [])
        .find((item) => item?.id === wanted) :
    undefined;
  const read = (source, mode, flat, included) => {
    if (mode === "flat") {
      const includedKg = Number(included) || 0;
      return {
        priced: true,
        mode: "flat",
        flatPrice: Number(flat) || 0,
        includedKg,
        weightFactor: 0,
        // The customer is never asked to guess the weight of a known
        // object. They pick "iPhone 16", see the price, and that is it.
        needsWeightAtBooking: false,
        // The counter still weighs it when the price covers only so much:
        // a phone in a carton packed out with shoes is not the parcel that
        // was priced. No allowance means nothing is weighed at all.
        weighsAtDropOff: includedKg > 0,
        source,
      };
    }
    // By weight is this business's own per-kg rate for the route, plain.
    // There is no factor to apply: a unitless multiplier was a number the
    // business had to reason about instead of a price it could state.
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
    // A listed row that names no pricing has never been quoted by this
    // business. It goes to a price request rather than inheriting a number
    // from its category or from the catch-all.
    return row.pricingMode ?
      read("item", row.pricingMode, row.flatPrice, row.includedKg) :
      unpriced;
  }
  if (entry.otherPricingMode) {
    return read(
        "other", entry.otherPricingMode, entry.otherFlatPrice,
        entry.otherIncludedKg,
    );
  }
  return unpriced;
}

/**
 * Whether this parcel is covered, for the shipment record.
 *
 * One question with one answer. There is no amount: a business that covers
 * makes good on the parcel, and one that does not says so before the
 * customer chooses it. Cover is never charged for.
 *
 * @param {object} params Inputs.
 * @param {object} params.business The business document.
 * @param {object} params.policy The coverage policy resolved from it.
 * @param {string} params.categoryId The category being shipped.
 * @param {string} [params.itemId] The item row, when one was picked.
 * @return {object} {ok} with the cover answer, or {ok: false, error}.
 */
function quoteFreightItemCoverage({business, policy, categoryId, itemId}) {
  const listing = freightPaybackFor({
    table: business?.freightPaybackTable,
    categoryId,
    itemId,
  });
  if (!listing.listed) {
    return {ok: false, error: "item_not_listed", listing};
  }
  return {
    ok: true,
    covered: policy.coversLoss === true,
    // Cover costs the customer nothing: the business already priced this
    // item for what it is worth to carry.
    coverageFeeCents: 0,
    coverageFee: 0,
  };
}

module.exports = {
  MAX_ITEM_FLAT_PRICE,
  MAX_INCLUDED_KG,
  freightItemPricing,
  MAX_ITEMS_PER_CATEGORY,
  MAX_ITEM_LABEL_LENGTH,
  STANDARD_FREIGHT_ITEMS,
  freightPaybackFor,
  quoteFreightItemCoverage,
  validateFreightPaybackTable,
};

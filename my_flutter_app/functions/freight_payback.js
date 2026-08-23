/**
 * What a lost parcel pays back - decided by the BUSINESS, per item type.
 *
 * The declared-value model asked the sender what the parcel was worth, and
 * the first real freight partner refused it on sight: the sender's number is
 * a lie in whichever direction pays them. An iPhone "worth $300" at booking
 * becomes "worth $1,000" the day it goes missing.
 *
 * So the number moves to the side that carries the risk. The business
 * publishes a payback table - phones: iPhone $400, Samsung $250, other $100
 * - and the customer's only input is WHAT the item is, confirmed by staff at
 * the same counter where the weight is already verified. Neither side can
 * move the number after something goes wrong, which is exactly when people
 * start lying.
 *
 * The table is a promise, not a price. Cover costs the customer nothing:
 * this business already charges for this item according to what it is worth
 * to carry, so the risk is inside the shipping rate. Whether the promise is
 * kept at all is the one flag in freight_coverage.js, and a business that
 * keeps it pays the full published amount. A snapshot of the row is written
 * onto the shipment so a claim argued weeks later is judged on the terms in
 * force when the parcel was handed over.
 *
 * Mirrored by admin_web/src/lib/freight-payback.ts and
 * my_flutter_app/lib/utils/freight_payback.dart - all three clients must
 * price the same item identically.
 */

const {PLATFORM_MAX_DECLARED_VALUE} = require("./freight_coverage");

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

function cleanAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (amount > PLATFORM_MAX_DECLARED_VALUE) return null;
  return Math.round(amount * 100) / 100;
}

/** A single parcel priced above this belongs with a freight forwarder. */
const MAX_ITEM_FLAT_PRICE = 10000;

/** Past this an "allowance" is really a by-weight parcel wearing a hat. */
const MAX_INCLUDED_KG = 200;

/** The same band a category multiplier lives in, for the same reasons. */
const MIN_WEIGHT_FACTOR = 0.5;
const MAX_WEIGHT_FACTOR = 10;

/**
 * How one row is priced, cleaned.
 *
 * Two ways, and the business picks per row because only it knows which of
 * its goods are which. An iPhone 16 is always the same phone - known size,
 * known weight - so it gets one price and never sees a scale. A bag of
 * clothes is different every time, so it is weighed, and the existing
 * weigh-and-confirm settlement runs exactly as before.
 *
 * A row with no pricing at all is not an error: it is every row saved
 * before this existed, and it keeps being priced by its category's
 * multiplier so no live price moves the day this ships.
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
  const raw = source?.[key("weightFactor")];
  // Absent factor on a by-weight row means "whatever this category
  // charges", which is what every row does today.
  if (raw === undefined || raw === null || raw === "") {
    return {ok: true, pricing: {[key("pricingMode")]: "per_kg"}};
  }
  const factor = Number(raw);
  if (!Number.isFinite(factor) ||
      factor < MIN_WEIGHT_FACTOR || factor > MAX_WEIGHT_FACTOR) {
    return {ok: false, error: "weight_factor_out_of_range"};
  }
  return {
    ok: true,
    pricing: {
      [key("pricingMode")]: "per_kg",
      [key("weightFactor")]: Math.round(factor * 1000) / 1000,
    },
  };
}

/**
 * Validates the payback table a business is trying to save.
 *
 * Shape: {categoryId: {items: [{id, label, paybackAmount}],
 * otherPaybackAmount}}. Refuses rather than clamps - a business that types
 * $50,000 must be told the ceiling, not silently saved at $10,000 and left
 * believing it promised more.
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
      const paybackAmount = cleanAmount(item?.paybackAmount);
      if (paybackAmount === null) {
        return {ok: false, error: "payback_out_of_range", categoryId};
      }
      const pricing = cleanItemPricing(item);
      if (!pricing.ok) {
        return {ok: false, error: pricing.error, categoryId};
      }
      cleanedItems.push({id, label, paybackAmount, ...pricing.pricing});
    }
    const otherPaybackAmount = cleanAmount(entry.otherPaybackAmount ?? 0);
    if (otherPaybackAmount === null) {
      return {ok: false, error: "payback_out_of_range", categoryId};
    }
    const otherPricing = cleanItemPricing(entry, "other");
    if (!otherPricing.ok) {
      return {ok: false, error: otherPricing.error, categoryId};
    }
    cleaned[categoryId] = {
      items: cleanedItems,
      otherPaybackAmount,
      ...otherPricing.pricing,
    };
  }
  return {ok: true, table: cleaned};
}

/**
 * The payback row for an item, or why there is none.
 *
 * Resolution order: the exact item row, then the category's "other" amount.
 * A missing row is a real answer - it is what routes the booking to the
 * quote-request path instead of instant booking.
 *
 * @param {object} params Inputs.
 * @param {object} params.table The business's saved payback table.
 * @param {string} params.categoryId The category being shipped.
 * @param {string} [params.itemId] The item row, when one was picked.
 * @return {object} {listed, paybackAmount, source: "item"|"other"|null}.
 */
function freightPaybackFor({table, categoryId, itemId}) {
  const entry = table && typeof table === "object" ?
    table[String(categoryId || "").trim()] :
    undefined;
  if (!entry) return {listed: false, paybackAmount: 0, source: null};
  const wanted = String(itemId || "").trim();
  if (wanted) {
    const row = (Array.isArray(entry.items) ? entry.items : [])
        .find((item) => item?.id === wanted);
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
  if (other > 0) {
    return {listed: true, paybackAmount: other, source: "other"};
  }
  return {listed: false, paybackAmount: 0, source: null};
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
 * @param {number} [params.categoryMultiplier] The category's own factor,
 *   used when a row states no pricing of its own.
 * @return {object} {mode, flatPrice, includedKg, weightFactor,
 *   needsWeightAtBooking, weighsAtDropOff, source}.
 */
function freightItemPricing({
  table,
  categoryId,
  itemId,
  categoryMultiplier = 1,
}) {
  const entry = table && typeof table === "object" ?
    table[String(categoryId || "").trim()] :
    undefined;
  const byWeight = (weightFactor, source) => ({
    mode: "per_kg",
    flatPrice: 0,
    includedKg: 0,
    weightFactor,
    needsWeightAtBooking: true,
    weighsAtDropOff: true,
    source,
  });
  if (!entry) return byWeight(categoryMultiplier, null);

  const wanted = String(itemId || "").trim();
  const row = wanted ?
    (Array.isArray(entry.items) ? entry.items : [])
        .find((item) => item?.id === wanted) :
    undefined;
  const read = (source, mode, flat, included, factor) => {
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
        // But the business still puts it on the scale when the price
        // covers only so much: a phone in a carton packed out with shoes
        // is not the parcel that was priced, and without this the business
        // absorbs the packaging and stops offering set prices. No
        // allowance means the price covers it however heavy it is, and
        // nothing is weighed at all.
        weighsAtDropOff: includedKg > 0,
        source,
      };
    }
    const resolved = Number(factor);
    return byWeight(
        Number.isFinite(resolved) && resolved > 0 ?
          resolved :
          categoryMultiplier,
        source,
    );
  };

  if (row) {
    // A listed row that states no pricing is one saved before pricing
    // existed. It keeps the category multiplier it has always been charged
    // at - NOT the catch-all's price, which is for things nobody listed and
    // would silently reprice every legacy row the day this shipped.
    return row.pricingMode ?
      read(
          "item", row.pricingMode, row.flatPrice, row.includedKg,
          row.weightFactor,
      ) :
      byWeight(categoryMultiplier, "item");
  }
  if (entry.otherPricingMode) {
    return read(
        "other", entry.otherPricingMode, entry.otherFlatPrice,
        entry.otherIncludedKg, entry.otherWeightFactor,
    );
  }
  return byWeight(categoryMultiplier, null);
}

/**
 * Prices coverage for a picked item against the business's own table.
 *
 * The shape mirrors quoteFreightCoverage so the shipment creator can write
 * the same snapshot fields whichever path priced it - but the amount is the
 * business's, and a zero-payback row is carried-but-not-covered, exactly
 * like the old uncovered path.
 *
 * @param {object} params Inputs.
 * @param {object} params.business The business document.
 * @param {object} params.policy The coverage policy already resolved from it.
 * @param {string} params.categoryId The category being shipped.
 * @param {string} [params.itemId] The item row, when one was picked.
 * @return {object} {ok} with fee/cap/payback, or {ok: false, error}.
 */
function quoteFreightItemCoverage({business, policy, categoryId, itemId}) {
  const payback = freightPaybackFor({
    table: business?.freightPaybackTable,
    categoryId,
    itemId,
  });
  if (!payback.listed) {
    return {ok: false, error: "item_not_listed", payback};
  }
  const paybackCents = Math.round(payback.paybackAmount * 100);
  const covered = policy.coversLoss === true && paybackCents > 0;
  return {
    ok: true,
    covered,
    paybackAmount: payback.paybackAmount,
    paybackAmountCents: paybackCents,
    // Cover costs the customer nothing. The business priced this item for
    // what it is worth to carry, so the risk is already in the shipping
    // rate - charging a percentage on top billed the same risk twice.
    coverageFeeCents: 0,
    coverageFee: 0,
    // Covered means the FULL published payback, not a proportion of it.
    payoutCapCents: covered ? paybackCents : 0,
    paybackSource: payback.source,
  };
}

module.exports = {
  MAX_ITEM_FLAT_PRICE,
  MAX_INCLUDED_KG,
  MIN_WEIGHT_FACTOR,
  MAX_WEIGHT_FACTOR,
  freightItemPricing,
  MAX_ITEMS_PER_CATEGORY,
  MAX_ITEM_LABEL_LENGTH,
  STANDARD_FREIGHT_ITEMS,
  freightPaybackFor,
  quoteFreightItemCoverage,
  validateFreightPaybackTable,
};

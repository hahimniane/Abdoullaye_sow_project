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
      cleanedItems.push({id, label, paybackAmount});
    }
    const otherPaybackAmount = cleanAmount(entry.otherPaybackAmount ?? 0);
    if (otherPaybackAmount === null) {
      return {ok: false, error: "payback_out_of_range", categoryId};
    }
    cleaned[categoryId] = {items: cleanedItems, otherPaybackAmount};
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
  MAX_ITEMS_PER_CATEGORY,
  MAX_ITEM_LABEL_LENGTH,
  STANDARD_FREIGHT_ITEMS,
  freightPaybackFor,
  quoteFreightItemCoverage,
  validateFreightPaybackTable,
};

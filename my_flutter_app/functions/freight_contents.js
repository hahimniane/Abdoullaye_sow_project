/**
 * What is inside one box, as a list instead of a single pick.
 *
 * A real parcel holds a phone AND four kilos of clothes, and those price in
 * different currencies: the phone per unit, the clothes per kilo. A form
 * that allows one answer forces every mixed box into a misdeclaration, and
 * whichever lie the customer picks decides who eats the loss.
 *
 * The declaration stores FACTS - items, counts, a weighed remainder, the
 * whole box's weight - and never a price. Each business reads those facts
 * through its own catalogue: one that prices phones per unit sees
 * "your price x 2", one that weighs everything sees the total weight. The
 * platform owns the vocabulary (categories and standard items, same as the
 * payback table) so a request means the same thing to every business asked.
 *
 * Mirrored by admin_web/src/lib/freight-contents.ts and
 * my_flutter_app/lib/utils/freight_contents.dart - all three must read a
 * declaration identically.
 */

const {STANDARD_CATEGORY_IDS} = require("./freight_categories");
const {freightItemPricing} = require("./freight_payback");

/** More lines than this is an inventory, not a parcel. */
const MAX_CONTENT_ITEMS = 10;
/** Nobody ships a hundred phones in one carton through this flow. */
const MAX_ITEM_QUANTITY = 99;
const MAX_CONTENT_LABEL_LENGTH = 60;
/** Matches the booking weight ceiling in the payment intent. */
const MAX_CONTENT_WEIGHT_KG = 100000;

function cleanWeight(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (parsed > MAX_CONTENT_WEIGHT_KG) return NaN;
  return Math.round(parsed * 1000) / 1000;
}

/**
 * One declared box, cleaned, or the reason it cannot be read.
 *
 * Absent contents are not an error: a request made of prose alone is the
 * shape every client sent before this existed, and it must keep working.
 *
 * @param {object} raw The payload's contents fields.
 * @return {object} {ok, contents|null} or {ok: false, error}.
 */
function validateFreightContents(raw) {
  const itemsRaw = raw?.contentsItems;
  const otherKgRaw = raw?.otherGoodsKg;
  const totalKgRaw = raw?.totalWeightKg;
  const declared = Array.isArray(itemsRaw) && itemsRaw.length > 0;
  const weighed = Number(otherKgRaw) > 0;
  if (!declared && !weighed) return {ok: true, contents: null};

  const items = [];
  if (declared) {
    if (itemsRaw.length > MAX_CONTENT_ITEMS) {
      return {ok: false, error: "contents_too_many_items"};
    }
    for (const raw of itemsRaw) {
      const categoryId = String(raw?.categoryId || "").trim();
      if (!STANDARD_CATEGORY_IDS.includes(categoryId)) {
        return {ok: false, error: "contents_category_invalid"};
      }
      const label = String(raw?.label || "").trim();
      if (!label || label.length > MAX_CONTENT_LABEL_LENGTH) {
        return {ok: false, error: "contents_label_invalid"};
      }
      const quantity = Number(raw?.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 ||
          quantity > MAX_ITEM_QUANTITY) {
        return {ok: false, error: "contents_quantity_invalid"};
      }
      const itemId = String(raw?.itemId || "").trim().slice(0, 60);
      items.push({categoryId, itemId, label, quantity});
    }
  }

  const otherGoodsKg = cleanWeight(otherKgRaw);
  if (Number.isNaN(otherGoodsKg)) {
    return {ok: false, error: "contents_weight_invalid"};
  }
  const otherCategoryId = String(raw?.otherCategoryId || "").trim();
  if (otherGoodsKg > 0 && otherCategoryId &&
      !STANDARD_CATEGORY_IDS.includes(otherCategoryId)) {
    return {ok: false, error: "contents_category_invalid"};
  }
  const totalWeightKg = cleanWeight(totalKgRaw);
  if (Number.isNaN(totalWeightKg)) {
    return {ok: false, error: "contents_weight_invalid"};
  }

  return {
    ok: true,
    contents: {
      items,
      otherGoodsKg,
      otherCategoryId: otherGoodsKg > 0 ?
        (otherCategoryId || "general") :
        "",
      totalWeightKg,
    },
  };
}

/**
 * A declared box priced through ONE business's catalogue.
 *
 * The rule the customer was shown at booking: every listed item must carry
 * a set price from this business, and everything else rides in one weighed
 * bucket. An item this business weighs belongs in the bucket's kilos, and
 * an item it never priced makes the whole box a price request - pricing it
 * here would invent a number nobody set.
 *
 * The sums feed the machinery unchanged: calculateFreightSettlement already
 * takes flatPriceCents and includedKg as totals, so a manifest settles by
 * the same formula as a single set-price item.
 *
 * @param {object} params Inputs.
 * @param {object} params.table The business's freightPaybackTable.
 * @param {number} params.ratePerKgCents This route+mode's per-kg rate.
 * @param {Function} params.multiplierFor categoryId -> category multiplier.
 * @param {object} params.contents A validated declaration.
 * @return {object} {ok, lines, flatCents, includedKg, weighedKg,
 *   weighedCents, estimateCents} or {ok: false, error, itemLabel}.
 */
function priceFreightContents({table, ratePerKgCents, multiplierFor,
  contents}) {
  const rate = Number(ratePerKgCents);
  if (!Number.isSafeInteger(rate) || rate <= 0) {
    return {ok: false, error: "route_rate_missing"};
  }
  const lines = [];
  let flatCents = 0;
  let includedKg = 0;
  for (const item of contents.items) {
    const pricing = freightItemPricing({
      table,
      categoryId: item.categoryId,
      itemId: item.itemId,
    });
    if (!pricing.priced) {
      return {ok: false, error: "contents_item_unpriced",
        itemLabel: item.label};
    }
    if (pricing.mode !== "flat") {
      // This business weighs that item; its kilos belong in the bucket.
      return {ok: false, error: "contents_item_weighed",
        itemLabel: item.label};
    }
    const lineCents = Math.round(pricing.flatPrice * 100) * item.quantity;
    const lineIncludedKg = pricing.includedKg * item.quantity;
    flatCents += lineCents;
    includedKg += lineIncludedKg;
    lines.push({
      categoryId: item.categoryId,
      itemId: item.itemId,
      label: item.label,
      quantity: item.quantity,
      unitPriceCents: Math.round(pricing.flatPrice * 100),
      lineCents,
      includedKg: lineIncludedKg,
    });
  }
  const weighedKg = contents.otherGoodsKg;
  const multiplier = weighedKg > 0 ?
    Number(multiplierFor(contents.otherCategoryId)) || 1 :
    1;
  const weighedCents = weighedKg > 0 ?
    Math.round(weighedKg * rate * multiplier) :
    0;
  if (flatCents + weighedCents <= 0) {
    return {ok: false, error: "contents_empty"};
  }
  return {
    ok: true,
    lines,
    flatCents,
    includedKg: Math.round(includedKg * 1000) / 1000,
    weighedKg,
    weighedCategoryMultiplier: multiplier,
    weighedCents,
    estimateCents: flatCents + weighedCents,
  };
}

/**
 * One line saying what is in the box, for a notification or a list row.
 *
 * @param {object} contents A validated declaration.
 * @return {string} e.g. "2 x iPhone, 1 x Laptop + 4 kg other goods".
 */
function freightContentsSummary(contents) {
  if (!contents) return "";
  const parts = contents.items.map(
      (item) => `${item.quantity} x ${item.label}`,
  );
  if (contents.otherGoodsKg > 0) {
    parts.push(`${contents.otherGoodsKg} kg other goods`);
  }
  return parts.join(", ");
}

module.exports = {
  MAX_CONTENT_ITEMS,
  MAX_ITEM_QUANTITY,
  MAX_CONTENT_LABEL_LENGTH,
  validateFreightContents,
  freightContentsSummary,
  priceFreightContents,
};

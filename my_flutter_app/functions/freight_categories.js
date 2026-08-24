/**
 * What is in the parcel, and what that does to the price.
 *
 * Freight was priced on weight alone, so a kilo of phones and a kilo of cloth
 * cost the same. They are not the same: if a parcel goes missing, one of them
 * is a great deal more expensive to make good. Categories let a business
 * charge more for the things that would cost it more to replace.
 *
 * The split is deliberate. The **platform owns the list**, the **business owns
 * the price**. If every business invented its own categories, a customer
 * holding a phone would face "Electronics" at one business, "Appareils" at
 * another and "Fragile" at a third, with no way to compare a quote. So the
 * standard rows are the same everywhere and cannot be renamed or removed; a
 * business sets what each one is worth to it, and may add extras of its own
 * for things the standard list genuinely misses.
 *
 * A category is how a customer finds what they are sending. It carries no
 * price: what a thing costs is set on the item row, by the business
 * and mode. Nothing about that rate changes, which is what makes this safe to
 * ship: a business that sets nothing keeps today's prices exactly.
 */

/**
 * The rows every business has, in the order a customer sees them.
 *
 * Defaults are starting points, not policy - a business overrides whatever it
 * disagrees with. "general" is first because it is the honest answer for most
 * parcels and nobody should have to hunt for it.
 */
const STANDARD_FREIGHT_CATEGORIES = Object.freeze([
  {
    id: "general",
    label: "General goods",
    hint: "Household items, gifts, anything not listed below",
    defaultMultiplier: 1,
  },
  {
    id: "clothing",
    label: "Clothes and fabric",
    hint: "Clothing, shoes, cloth, bedding",
    defaultMultiplier: 1,
  },
  {
    id: "food",
    label: "Food",
    hint: "Dry and packaged food only",
    defaultMultiplier: 1,
  },
  {
    id: "documents",
    label: "Documents",
    hint: "Papers, certificates, printed matter",
    defaultMultiplier: 1,
  },
  {
    id: "cosmetics",
    label: "Cosmetics and liquids",
    hint: "Creams, perfumes, hair products",
    defaultMultiplier: 1,
  },
  {
    id: "electronics",
    label: "Electronics",
    hint: "Phones, laptops, tablets, chargers",
    defaultMultiplier: 1,
  },
  {
    id: "fragile",
    label: "Fragile items",
    hint: "Glass, ceramics, anything breakable",
    defaultMultiplier: 1,
  },
]);

const STANDARD_CATEGORY_IDS = Object.freeze(
    STANDARD_FREIGHT_CATEGORIES.map((category) => category.id),
);

/**
 * Nothing outside this band. A typo should not make a parcel free or absurd.
 */
const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 10;

/** A business may not drown the customer in choices. */
const MAX_CUSTOM_CATEGORIES = 6;

/**
 * Coerces a stored multiplier into something usable.
 *
 * Anything unreadable falls back to 1 rather than throwing: a bad value in one
 * business's settings must not stop a customer getting a quote, and 1 is
 * exactly what the price was before categories existed.
 *
 * @param {*} value Whatever was stored.
 * @param {number} fallback Value to use when it cannot be read.
 * @return {number} A multiplier inside the allowed band.
 */
function normalizeMultiplier(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, parsed));
}

/**
 * Trims and bounds a business's own category, or rejects it.
 *
 * @param {object} raw Candidate category from a business's settings.
 * @return {object|null} A usable category, or null when it cannot be one.
 */
function normalizeCustomCategory(raw) {
  const id = String(raw?.id || "").trim().toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
  const label = String(raw?.label || "").trim().slice(0, 60);
  if (!id || !label) return null;
  // A business cannot shadow a standard row: that is the shared vocabulary
  // the customer compares businesses with.
  if (STANDARD_CATEGORY_IDS.includes(id)) return null;
  return {
    id,
    label,
    hint: String(raw?.hint || "").trim().slice(0, 120),
    multiplier: normalizeMultiplier(raw?.multiplier),
    custom: true,
  };
}

/**
 * The categories a customer picks from for one business, priced.
 *
 * Standard rows always appear, in platform order, carrying this business's
 * multiplier where it set one. Its own categories follow.
 *
 * @param {object} business The business document.
 * @return {Array<object>} Categories with a resolved multiplier each.
 */
function freightCategoriesForBusiness(business) {
  const overrides = business?.freightCategoryRates &&
    typeof business.freightCategoryRates === "object" ?
    business.freightCategoryRates : {};
  const standard = STANDARD_FREIGHT_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    hint: category.hint,
    multiplier: normalizeMultiplier(
        overrides[category.id],
        category.defaultMultiplier,
    ),
    custom: false,
  }));
  const extras = Array.isArray(business?.freightCustomCategories) ?
    business.freightCustomCategories : [];
  const seen = new Set(STANDARD_CATEGORY_IDS);
  const custom = [];
  for (const raw of extras) {
    const category = normalizeCustomCategory(raw);
    if (!category || seen.has(category.id)) continue;
    seen.add(category.id);
    custom.push(category);
    if (custom.length >= MAX_CUSTOM_CATEGORIES) break;
  }
  return [...standard, ...custom];
}

/**
 * The multiplier to charge for a chosen category.
 *
 * An unknown or missing category resolves to 1 - the price freight had before
 * this existed - so an older app that sends no category still gets a correct
 * quote rather than an error.
 *
 * @param {object} business The business document.
 * @param {string} categoryId What the customer chose.
 * @return {number} The multiplier to apply to the per-kg rate.
 */
function freightCategoryMultiplier(business, categoryId) {
  const id = String(categoryId || "").trim().toLowerCase();
  if (!id) return 1;
  const match = freightCategoriesForBusiness(business)
      .find((category) => category.id === id);
  return match ? match.multiplier : 1;
}

/**
 * Validates what a business is trying to save.
 *
 * @param {object} params Settings being saved.
 * @param {object} [params.rates] Standard-category overrides.
 * @param {Array<object>} [params.custom] The business's own categories.
 * @return {object} {ok} plus an {error} code, or the cleaned values.
 */
function validateFreightCategorySettings({rates = {}, custom = []} = {}) {
  if (rates && typeof rates !== "object") {
    return {ok: false, error: "rates_invalid"};
  }
  for (const [id, value] of Object.entries(rates || {})) {
    if (!STANDARD_CATEGORY_IDS.includes(id)) {
      return {ok: false, error: "unknown_category"};
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) ||
        parsed < MIN_MULTIPLIER || parsed > MAX_MULTIPLIER) {
      return {ok: false, error: "multiplier_out_of_range"};
    }
  }
  if (!Array.isArray(custom)) return {ok: false, error: "custom_invalid"};
  if (custom.length > MAX_CUSTOM_CATEGORIES) {
    return {ok: false, error: "too_many_categories"};
  }
  const cleaned = [];
  const seen = new Set();
  for (const raw of custom) {
    const category = normalizeCustomCategory(raw);
    if (!category) return {ok: false, error: "custom_category_invalid"};
    if (seen.has(category.id)) return {ok: false, error: "duplicate_category"};
    seen.add(category.id);
    cleaned.push(category);
  }
  return {ok: true, rates: {...rates}, custom: cleaned};
}

module.exports = {
  STANDARD_FREIGHT_CATEGORIES,
  STANDARD_CATEGORY_IDS,
  MIN_MULTIPLIER,
  MAX_MULTIPLIER,
  MAX_CUSTOM_CATEGORIES,
  normalizeMultiplier,
  normalizeCustomCategory,
  freightCategoriesForBusiness,
  freightCategoryMultiplier,
  validateFreightCategorySettings,
};

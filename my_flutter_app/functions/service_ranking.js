/**
 * Ordering the businesses a customer is choosing between, for any service.
 *
 * Sorts, not filters. A filter removes options; with two or three businesses on
 * a route, filtering to "cheapest" would hide the alternative - including the
 * one that stands behind the parcel. Sorting shows everything, best first.
 *
 * Four rules shaped this, all learned from the data rather than assumed:
 *
 * 1. **Cheapest means the real quote.** Category multipliers and coverage fees
 *    move the total, so a business cheaper per kilo can be dearer for a phone.
 *    Ranking on the headline rate would name the wrong winner.
 * 2. **Missing data sinks, never ties.** Only some businesses have stated a
 *    delivery estimate. One that has not said how long it takes must never
 *    appear fastest by accident, so blank sorts last rather than as zero.
 * 3. **Ties break deterministically.** With few businesses ties are the norm,
 *    and without a stable secondary key the list reshuffles on every load and
 *    looks broken.
 * 4. **A service only offers the sorts it can answer.** Car transport is
 *    priced by bid, so it has no price to compare until after the customer has
 *    committed; only freight has a loss policy. Offering a control a service
 *    cannot honour is worse than offering none.
 *
 * SERVICE_SORTS below is the single declaration of which sorts each service
 * supports - the clients derive their controls from it rather than each
 * keeping a list. See docs/UI-CONVENTIONS.md rule 3.
 */

const {
  freightCoveragePolicy,
  quoteFreightCoverage,
} = require("./freight_coverage");
const {BAYESIAN_PRIOR_MEAN} = require("./business_review");

/**
 * Re-shapes an option's resolved coverage back into the settings shape the
 * coverage module reads, so one implementation prices cover everywhere.
 *
 * @param {object} option A business option row.
 * @return {object} Coverage settings for freight_coverage.js.
 */
function coverageSettings(option) {
  return {
    freightCoverageEnabled: option?.freightCoverage?.coversLoss,
    freightCoverageRatePct: option?.freightCoverage?.ratePct,
    freightMaxDeclaredValue: option?.freightCoverage?.maxDeclaredValue,
  };
}

/** Every way a customer can order the businesses on offer. */
const SERVICE_SORTS = Object.freeze([
  "cheapest",
  "coverage",
  "fastest",
  "rated",
]);

/**
 * Which of those each service can actually answer.
 *
 * Derived from what the data holds, not from what would be nice:
 *
 * - **carTransport** is priced by bid after the request is reviewed, so there
 *   is no price to compare and no stated transit time.
 * - **carSales** compares cars, not businesses; the listing carries the price.
 * - **coverage** exists only on freight - `freightCoverageEnabled` is the one
 *   loss policy in the platform.
 * - **rated** works everywhere, because every business carries a review score.
 *
 * A service left with a single sort gets no control at all: one choice is not
 * a choice.
 */
const SERVICE_SORTS_BY_SERVICE = Object.freeze({
  barrelShipping: Object.freeze(["cheapest", "fastest", "rated"]),
  sharedBarrels: Object.freeze(["cheapest", "fastest", "rated"]),
  freight: Object.freeze(["cheapest", "coverage", "fastest", "rated"]),
  carParking: Object.freeze(["cheapest", "rated"]),
  carTransport: Object.freeze(["rated"]),
  carSales: Object.freeze(["rated"]),
});

/** The order used when the customer has not chosen one. */
const DEFAULT_SERVICE_SORT = "cheapest";

/**
 * The sorts a service offers, in the order they should be shown.
 *
 * @param {string} service A business service id.
 * @return {Array<string>} Supported sorts, empty for an unknown service.
 */
function sortsForService(service) {
  return SERVICE_SORTS_BY_SERVICE[service] || [];
}

/**
 * The sort to start on for a service, which is not always "cheapest" - car
 * transport has no price to be cheapest by.
 *
 * @param {string} service A business service id.
 * @return {string} A sort this service supports, or "" when it offers none.
 */
function defaultSortForService(service) {
  const sorts = sortsForService(service);
  if (sorts.length === 0) return "";
  return sorts.includes(DEFAULT_SERVICE_SORT) ? DEFAULT_SERVICE_SORT : sorts[0];
}

/**
 * Below this many options a sort control is noise: there is nothing to order.
 * Clients use it to decide whether to show the control at all, so it lives
 * here rather than being guessed separately on each client.
 */
const MIN_OPTIONS_FOR_SORT = 3;

/** Sorting value for "no answer", chosen so it always sorts last. */
const UNKNOWN = Number.POSITIVE_INFINITY;

/**
 * The multiplier this business charges for a chosen category.
 *
 * @param {object} option A business option row.
 * @param {string} [categoryId] The category the customer picked.
 * @return {number} The multiplier, or 1 when unknown - which is what the
 *     price was before categories existed.
 */
function freightCategoryMultiplierFor(option, categoryId) {
  const id = String(categoryId || "").trim().toLowerCase();
  if (!id) return 1;
  const rows = Array.isArray(option?.freightCategories) ?
    option.freightCategories :
    [];
  const match = rows.find((row) => String(row?.id || "") === id);
  const multiplier = Number(match?.multiplier);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

/**
 * What one business would charge for this exact parcel.
 *
 * @param {object} params Inputs.
 * @param {object} params.option A business option row.
 * @param {number} params.weightKg Parcel weight.
 * @param {string} params.mode "air" or "sea".
 * @param {string} [params.itemCategoryId] Chosen category.
 * @param {number} [params.declaredValue] Declared value, if any.
 * @return {number} Total in cents, or UNKNOWN when it cannot be priced.
 */
function freightOptionTotalCents({
  option,
  weightKg,
  mode,
  itemCategoryId,
  declaredValue,
}) {
  const ratePerKg = Number(
      mode === "sea" ?
        option?.country?.freightSeaPricePerKg :
        option?.country?.freightAirPricePerKg,
  );
  const kg = Number(weightKg);
  if (!Number.isFinite(ratePerKg) || ratePerKg <= 0) return UNKNOWN;
  if (!Number.isFinite(kg) || kg <= 0) return UNKNOWN;

  // Taken from the resolved list the options response already carries, which
  // has each category's final multiplier for this business. Rebuilding it from
  // raw settings would be wrong twice over: those fields are not sent, and a
  // business's own categories only exist in the resolved form.
  const multiplier = freightCategoryMultiplierFor(option, itemCategoryId);
  const shippingCents = Math.round(kg * ratePerKg * multiplier * 100);

  // Priced through the same quote the booking will use, so the order of the
  // list and the bill can never disagree. A declared value this business will
  // not accept sinks the option rather than making it look cheapest: ranking a
  // business first when it would refuse the parcel sends the customer to a
  // dead end.
  const quote = quoteFreightCoverage({
    business: coverageSettings(option),
    declaredValue,
  });
  if (!quote.ok) return UNKNOWN;
  return shippingCents + quote.coverageFeeCents;
}

/**
 * How good a business's loss policy is, as a sortable rank.
 *
 * The rule, stated rather than left to intuition: a business that covers loss
 * beats one that does not; among those that do, a higher ceiling beats a lower
 * one; and at the same ceiling, the cheaper rate wins. "No stated ceiling"
 * counts as the highest, because that business has set no limit on what it
 * will carry.
 *
 * @param {object} option A business option row.
 * @return {Array<number>} Comparable key, lower is better.
 */
function freightCoverageRank(option) {
  const policy = freightCoveragePolicy(coverageSettings(option));
  if (!policy.coversLoss) return [1, 0, 0];
  const ceiling = policy.maxDeclaredValue > 0 ?
    policy.maxDeclaredValue :
    Number.MAX_SAFE_INTEGER;
  return [0, -ceiling, policy.ratePct];
}

/**
 * Compares two arrays of numbers element by element.
 *
 * @param {Array<number>} a First key.
 * @param {Array<number>} b Second key.
 * @return {number} Negative when a sorts first.
 */
function compareKeys(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * How well reviewed a business is, as a sortable value.
 *
 * Uses the Bayesian-damped score the platform already computes, so a business
 * with one five-star review does not outrank an established one. An unrated
 * business sits at the prior rather than at zero, which is why this sort is
 * meaningful before anyone has been reviewed: it says "no reason to prefer
 * either", not "this one is terrible".
 *
 * @param {object} option A business option row.
 * @return {number} Negated score, so lower sorts first like every other key.
 */
function ratingRank(option) {
  const score = Number(option?.reviewWeightedScore);
  // A business that has never been reviewed has no aggregate at all - the
  // fields are only written when a review lands, so the score arrives absent
  // rather than as the prior. Reading that as zero sank every new business to
  // the bottom of "best rated", which is the opposite of what the damping is
  // for. Verified against live data: business_2 had no review fields and
  // ranked last behind a business rated 3.5.
  if (!Number.isFinite(score) || score <= 0) return -BAYESIAN_PRIOR_MEAN;
  return -score;
}

/**
 * Which delivery estimate applies to a service.
 *
 * @param {string} service A business service id.
 * @param {string} [mode] "air" or "sea", for freight only.
 * @return {string} The field prefix, or "" when the service states no time.
 */
function estimatePrefix(service, mode) {
  if (service === "freight") {
    return mode === "sea" ? "freightSea" : "freightAir";
  }
  // Shared barrels ride in the same containers as a solo barrel, so they
  // inherit the barrel estimate rather than carrying one of their own.
  if (service === "barrelShipping" || service === "sharedBarrels") {
    return "barrelShipping";
  }
  return "";
}

/**
 * How long a business says this service takes - the near end of its estimate.
 *
 * Read from the delivery estimate, never from `*DepartureDays`: that field
 * holds weekday names ("monday", "thursday"), the days a shipment leaves.
 *
 * @param {object} option A business option row.
 * @param {string} service A business service id.
 * @param {string} [mode] "air" or "sea", for freight only.
 * @return {number} Days, or UNKNOWN when the business has not said.
 */
function serviceOptionDays(option, service, mode) {
  const prefix = estimatePrefix(service, mode);
  if (!prefix) return UNKNOWN;
  const days = Number(option?.country?.[`${prefix}DeliveryEstimateMinDays`]);
  // Nothing set is not "zero days" - a business that never stated a time must
  // not rank fastest for a promise it never made.
  return Number.isFinite(days) && days > 0 ? days : UNKNOWN;
}

/**
 * How fast a business is, as a sortable key.
 *
 * Ranks on the near end of the estimate first, then the far end: between
 * "2-3 days" and "2-15 days" the customer means the first, and only the upper
 * bound tells them apart.
 *
 * @param {object} option A business option row.
 * @param {string} service A business service id.
 * @param {string} [mode] "air" or "sea", for freight only.
 * @return {Array<number>} Comparable key, lower is better.
 */
function serviceSpeedRank(option, service, mode) {
  const min = serviceOptionDays(option, service, mode);
  if (min === UNKNOWN) return [UNKNOWN, UNKNOWN];
  const prefix = estimatePrefix(service, mode);
  const max = Number(option?.country?.[`${prefix}DeliveryEstimateMaxDays`]);
  return [min, Number.isFinite(max) && max >= min ? max : min];
}

/**
 * What this business charges for what the customer described.
 *
 * Each service prices differently, and two of them do not price up front at
 * all: car transport is quoted by bid after review, and car sales put the
 * price on the listing rather than the business. Both return UNKNOWN, which is
 * why neither offers a "cheapest" sort in the first place.
 *
 * @param {object} params Inputs.
 * @param {object} params.option A business option row.
 * @param {string} params.service A business service id.
 * @param {string} [params.mode] "air" or "sea", for freight only.
 * @param {number} [params.weightKg] Parcel weight, freight only.
 * @param {string} [params.itemCategoryId] Chosen category, freight only.
 * @param {number} [params.declaredValue] Declared value, freight only.
 * @param {number} [params.quantity] Barrels or shares, barrel services only.
 * @param {string} [params.term] "daily", "weekly" or "monthly", parking only.
 * @param {number} [params.units] How many of that term, parking only.
 * @return {number} Total in cents, or UNKNOWN when it cannot be priced.
 */
function serviceOptionTotalCents({
  option,
  service,
  mode,
  weightKg,
  itemCategoryId,
  declaredValue,
  quantity,
  term,
  units,
}) {
  if (service === "freight") {
    return freightOptionTotalCents({
      option, weightKg, mode, itemCategoryId, declaredValue,
    });
  }

  if (service === "barrelShipping") {
    const price = Number(option?.country?.barrelShippingPrice);
    if (!Number.isFinite(price) || price <= 0) return UNKNOWN;
    return Math.round(price * positiveCount(quantity) * 100);
  }

  if (service === "sharedBarrels") {
    const price = Number(option?.pricePerShare);
    if (!Number.isFinite(price) || price <= 0) return UNKNOWN;
    return Math.round(price * positiveCount(quantity) * 100);
  }

  if (service === "carParking") {
    // The search already priced these dates, so prefer its total: it accounts
    // for the minimum stay and whichever rate actually applies, which a rate
    // times a count does not. The rate is the fallback for a stale row that
    // was priced before dates were entered.
    const estimated = Number(option?.estimatedTotal);
    if (Number.isFinite(estimated) && estimated > 0) {
      return Math.round(estimated * 100);
    }
    const field = term === "monthly" ?
      "monthlyRate" :
      term === "weekly" ? "weeklyRate" : "dailyRate";
    const rate = Number(option?.[field]);
    if (!Number.isFinite(rate) || rate <= 0) return UNKNOWN;
    return Math.round(rate * positiveCount(units) * 100);
  }

  return UNKNOWN;
}

/**
 * A count that defaults to one, so a price is comparable before the customer
 * has said how many they want.
 *
 * @param {unknown} value A quantity.
 * @return {number} The quantity, or 1.
 */
function positiveCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

/**
 * Orders the businesses on offer for one service.
 *
 * @param {object} params Inputs, as for serviceOptionTotalCents, plus:
 * @param {Array<object>} params.options Business option rows.
 * @param {string} params.service A business service id.
 * @param {string} [params.sort] One of the sorts this service supports.
 * @return {Array<object>} A new array, best first.
 */
function sortServiceOptions({options, service, sort, ...inputs}) {
  const rows = Array.isArray(options) ? [...options] : [];
  const supported = sortsForService(service);
  // An unsupported sort falls back rather than throwing: a stale client, or a
  // customer switching services with a sort still selected, should get a sane
  // order instead of an error.
  const chosen = supported.includes(sort) ?
    sort :
    defaultSortForService(service);

  const keyed = rows.map((option, index) => {
    const total = serviceOptionTotalCents({option, service, ...inputs});
    const speed = serviceSpeedRank(option, service, inputs.mode);
    const rating = ratingRank(option);
    let key;
    if (chosen === "coverage") {
      key = [...freightCoverageRank(option), total, rating];
    } else if (chosen === "fastest") {
      key = [...speed, total, rating];
    } else if (chosen === "rated") {
      key = [rating, total, ...speed];
    } else {
      key = [total, ...speed, rating];
    }
    return {option, key, index, businessId: String(option?.businessId || "")};
  });

  keyed.sort((a, b) => {
    const byKey = compareKeys(a.key, b.key);
    if (byKey !== 0) return byKey;
    // Ties are the norm at this size. Break them on something stable so the
    // list does not reshuffle between loads and read as broken.
    if (a.businessId !== b.businessId) {
      return a.businessId < b.businessId ? -1 : 1;
    }
    return a.index - b.index;
  });
  return keyed.map((entry) => entry.option);
}

/**
 * Whether a sort control is worth showing at all.
 *
 * Two conditions, and both matter: there has to be enough to order, and the
 * service has to offer more than one way to order it. Car transport can only
 * be sorted by rating, and a control with a single choice is not a control.
 *
 * @param {Array<object>} options Business option rows.
 * @param {string} service A business service id.
 * @return {boolean} True once a control would help.
 */
function shouldOfferServiceSort(options, service) {
  if (!Array.isArray(options) || options.length < MIN_OPTIONS_FOR_SORT) {
    return false;
  }
  return sortsForService(service).length > 1;
}

module.exports = {
  SERVICE_SORTS,
  SERVICE_SORTS_BY_SERVICE,
  DEFAULT_SERVICE_SORT,
  MIN_OPTIONS_FOR_SORT,
  UNKNOWN_SORT_VALUE: UNKNOWN,
  sortsForService,
  defaultSortForService,
  ratingRank,
  serviceOptionDays,
  serviceSpeedRank,
  serviceOptionTotalCents,
  freightOptionTotalCents,
  freightCoverageRank,
  sortServiceOptions,
  shouldOfferServiceSort,
};

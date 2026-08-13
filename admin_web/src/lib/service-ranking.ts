/**
 * Ordering the businesses a customer is choosing between, for any service.
 *
 * Mirrors `functions/service_ranking.js`. Keep the two in step: the rules are
 * stated there in full, and the tests on both sides encode the same cases.
 *
 * Sorts, not filters. With two or three businesses on a route, filtering to
 * "cheapest" would hide the alternative - including the one that stands behind
 * the parcel. Sorting shows everything, best first.
 *
 * SERVICE_SORTS_BY_SERVICE is the single declaration of which sorts each
 * service supports; the controls derive from it rather than each screen
 * keeping its own list. See docs/UI-CONVENTIONS.md rule 3.
 */

import {
  freightCategoryMultiplier,
  freightCategoryOptionsFrom,
  freightCategoryPricing,
  freightCoveragePolicyFrom,
  quoteFreightCoverage,
} from "./freight-categories.ts";

export const SERVICE_SORTS = [
  "cheapest",
  "coverage",
  "fastest",
  "rated",
] as const;

export type ServiceSort = (typeof SERVICE_SORTS)[number];

/**
 * Which sorts each service can actually answer.
 *
 * Derived from what the data holds, not from what would be nice: car
 * transport is priced by bid after review, car sales put the price on the
 * listing rather than the business, and freight is the only service with a
 * loss policy. Rating works everywhere.
 */
export const SERVICE_SORTS_BY_SERVICE: Record<string, readonly ServiceSort[]> =
  {
    barrelShipping: ["cheapest", "fastest", "rated"],
    sharedBarrels: ["cheapest", "fastest", "rated"],
    freight: ["cheapest", "coverage", "fastest", "rated"],
    carParking: ["cheapest", "rated"],
    carTransport: ["rated"],
    carSales: ["rated"],
  };

export const DEFAULT_SERVICE_SORT: ServiceSort = "cheapest";

/**
 * The rating an unreviewed business is treated as having. Mirrors
 * BAYESIAN_PRIOR_MEAN in functions/business_review.js, which is what the
 * platform damps every real score towards.
 */
export const BAYESIAN_PRIOR_MEAN = 3.8;

/**
 * Below this many options a sort control is noise: there is nothing to order.
 */
export const MIN_OPTIONS_FOR_SORT = 3;

/** Sorting value for "no answer", chosen so it always sorts last. */
export const UNKNOWN_SORT_VALUE = Number.POSITIVE_INFINITY;

export const SERVICE_SORT_LABELS: Record<ServiceSort, string> = {
  cheapest: "Cheapest",
  coverage: "Best cover",
  fastest: "Fastest",
  rated: "Best rated",
};

export type RankableServiceOption = {
  businessId?: string;
  reviewWeightedScore?: unknown;
  freightCategories?: unknown;
  freightCoverage?: unknown;
  /** Shared barrels price a share; parking prices a term. */
  pricePerShare?: unknown;
  estimatedTotal?: unknown;
  dailyRate?: unknown;
  weeklyRate?: unknown;
  monthlyRate?: unknown;
  country?: {
    barrelShippingPrice?: unknown;
    freightAirPricePerKg?: unknown;
    freightSeaPricePerKg?: unknown;
    barrelShippingDeliveryEstimateMinDays?: unknown;
    barrelShippingDeliveryEstimateMaxDays?: unknown;
    freightAirDeliveryEstimateMinDays?: unknown;
    freightAirDeliveryEstimateMaxDays?: unknown;
    freightSeaDeliveryEstimateMinDays?: unknown;
    freightSeaDeliveryEstimateMaxDays?: unknown;
  };
};

export type ServiceSortInputs = {
  service: string;
  sort?: string;
  /** Freight. */
  mode?: "air" | "sea";
  weightKg?: unknown;
  itemCategoryId?: string;
  declaredValue?: unknown;
  /** Barrels and shares. */
  quantity?: unknown;
  /** Parking. */
  term?: "daily" | "weekly" | "monthly";
  units?: unknown;
};

/** The sorts a service offers, in the order they should be shown. */
export function sortsForService(service: string): readonly ServiceSort[] {
  return SERVICE_SORTS_BY_SERVICE[service] ?? [];
}

/**
 * The sort to start on, which is not always "cheapest" - car transport has no
 * price to be cheapest by.
 */
export function defaultSortForService(service: string): ServiceSort | "" {
  const sorts = sortsForService(service);
  if (sorts.length === 0) return "";
  return sorts.includes(DEFAULT_SERVICE_SORT) ? DEFAULT_SERVICE_SORT : sorts[0];
}

/**
 * How well reviewed a business is, negated so lower sorts first like every
 * other key.
 *
 * The score is Bayesian-damped by the platform, so an unrated business sits at
 * the prior rather than at zero. Sinking the unrated would punish every new
 * business; this sort says "no reason to prefer either", not "terrible".
 */
export function ratingRank(option: RankableServiceOption): number {
  const score = Number(option.reviewWeightedScore);
  // A business that has never been reviewed has no aggregate at all - the
  // fields are only written when a review lands, so the score arrives absent
  // rather than as the prior. Reading that as zero sank every new business to
  // the bottom of "best rated", which is the opposite of what the damping is
  // for. Verified against live data: business_2 had no review fields and
  // ranked last behind a business rated 3.5.
  if (!Number.isFinite(score) || score <= 0) return -BAYESIAN_PRIOR_MEAN;
  return -score;
}

function positiveCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

/** Which delivery estimate applies to a service. */
function estimatePrefix(service: string, mode?: "air" | "sea"): string {
  if (service === "freight") {
    return mode === "sea" ? "freightSea" : "freightAir";
  }
  // Shared barrels ride in the same containers as a solo barrel.
  if (service === "barrelShipping" || service === "sharedBarrels") {
    return "barrelShipping";
  }
  return "";
}

/**
 * How long a business says this service takes - the near end of its estimate.
 *
 * Read from the delivery estimate, never from `*DepartureDays`: that field
 * holds weekday names ("monday", "thursday"), not a duration.
 */
export function serviceOptionDays(
  option: RankableServiceOption,
  service: string,
  mode?: "air" | "sea",
): number {
  const prefix = estimatePrefix(service, mode);
  if (!prefix) return UNKNOWN_SORT_VALUE;
  const country = option.country as Record<string, unknown> | undefined;
  const days = Number(country?.[`${prefix}DeliveryEstimateMinDays`]);
  // Nothing set is not "zero days".
  return Number.isFinite(days) && days > 0 ? days : UNKNOWN_SORT_VALUE;
}

function serviceSpeedRank(
  option: RankableServiceOption,
  service: string,
  mode?: "air" | "sea",
): number[] {
  const min = serviceOptionDays(option, service, mode);
  if (min === UNKNOWN_SORT_VALUE) {
    return [UNKNOWN_SORT_VALUE, UNKNOWN_SORT_VALUE];
  }
  const country = option.country as Record<string, unknown> | undefined;
  const max = Number(
    country?.[`${estimatePrefix(service, mode)}DeliveryEstimateMaxDays`],
  );
  // Between "2-3 days" and "2-15 days" the customer means the first, and only
  // the upper bound tells them apart.
  return [min, Number.isFinite(max) && max >= min ? max : min];
}

function freightTotal(
  option: RankableServiceOption,
  { weightKg, mode, itemCategoryId, declaredValue }: ServiceSortInputs,
): number {
  const ratePerKg = Number(
    mode === "sea"
      ? option.country?.freightSeaPricePerKg
      : option.country?.freightAirPricePerKg,
  );
  if (!Number.isFinite(ratePerKg) || ratePerKg <= 0) return UNKNOWN_SORT_VALUE;

  // The resolved list the callable sends, which already has this business's
  // own multipliers - including any category it invented itself.
  const categories = freightCategoryOptionsFrom(option.freightCategories);
  const pricing = freightCategoryPricing({
    baseRatePerKg: ratePerKg,
    weightKg,
    multiplier: freightCategoryMultiplier(categories, itemCategoryId ?? ""),
  });
  if (!pricing) return UNKNOWN_SORT_VALUE;

  const coverage = quoteFreightCoverage({
    policy: freightCoveragePolicyFrom(option.freightCoverage),
    declaredValue,
  });
  // A declared value this business will not accept does not make it cheapest.
  // Its own refusal is shown on the card; ranking it first would be a lie.
  if (!coverage.ok) return UNKNOWN_SORT_VALUE;

  return pricing.shippingSubtotal + coverage.coverageFee;
}

/**
 * What this business charges for what the customer described.
 *
 * Car transport is quoted by bid and a car's price is on the listing, so both
 * return unknown - which is why neither offers a "cheapest" sort at all.
 */
export function serviceOptionTotal(
  option: RankableServiceOption,
  inputs: ServiceSortInputs,
): number {
  const { service, quantity, term, units } = inputs;

  if (service === "freight") return freightTotal(option, inputs);

  if (service === "barrelShipping") {
    const price = Number(option.country?.barrelShippingPrice);
    if (!Number.isFinite(price) || price <= 0) return UNKNOWN_SORT_VALUE;
    return price * positiveCount(quantity);
  }

  if (service === "sharedBarrels") {
    const price = Number(option.pricePerShare);
    if (!Number.isFinite(price) || price <= 0) return UNKNOWN_SORT_VALUE;
    return price * positiveCount(quantity);
  }

  if (service === "carParking") {
    // The search already priced these dates, so prefer its total: it accounts
    // for the minimum stay and whichever rate actually applies, which a rate
    // times a count does not.
    const estimated = Number(option.estimatedTotal);
    if (Number.isFinite(estimated) && estimated > 0) return estimated;
    const rate = Number(
      term === "monthly"
        ? option.monthlyRate
        : term === "weekly"
          ? option.weeklyRate
          : option.dailyRate,
    );
    if (!Number.isFinite(rate) || rate <= 0) return UNKNOWN_SORT_VALUE;
    return rate * positiveCount(units);
  }

  return UNKNOWN_SORT_VALUE;
}

function compareKeys(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/** Orders the businesses on offer. Returns a new array, best first. */
export function sortServiceOptions<T extends RankableServiceOption>(
  options: readonly T[],
  inputs: ServiceSortInputs,
): T[] {
  const supported = sortsForService(inputs.service);
  // An unsupported sort falls back rather than throwing: a customer switching
  // services with a sort still selected should get a sane order, not an error.
  const chosen = supported.includes(inputs.sort as ServiceSort)
    ? (inputs.sort as ServiceSort)
    : defaultSortForService(inputs.service);

  return [...options]
    .map((option, index) => {
      const total = serviceOptionTotal(option, inputs);
      const speed = serviceSpeedRank(option, inputs.service, inputs.mode);
      const rating = ratingRank(option);
      const key =
        chosen === "coverage"
          ? [...freightCoverageRank(option), total, rating]
          : chosen === "fastest"
            ? [...speed, total, rating]
            : chosen === "rated"
              ? [rating, total, ...speed]
              : [total, ...speed, rating];
      return { option, key, index, businessId: String(option.businessId ?? "") };
    })
    .sort((a, b) => {
      const byKey = compareKeys(a.key, b.key);
      if (byKey !== 0) return byKey;
      // Ties are the norm at this size. Break them on something stable so the
      // list does not reshuffle between loads and read as broken.
      if (a.businessId !== b.businessId) {
        return a.businessId < b.businessId ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.option);
}

/**
 * How good a business's loss policy is, as a sortable key.
 *
 * Covers loss beats does not; higher ceiling beats lower; at the same ceiling
 * the cheaper rate wins. No stated ceiling counts as the highest, because that
 * business has set no limit on what it will carry.
 */
export function freightCoverageRank(option: RankableServiceOption): number[] {
  const policy = freightCoveragePolicyFrom(option.freightCoverage);
  if (!policy?.coversLoss) return [1, 0, 0];
  const ceiling =
    policy.maxDeclaredValue > 0
      ? policy.maxDeclaredValue
      : Number.MAX_SAFE_INTEGER;
  return [0, -ceiling, policy.ratePct];
}

/**
 * Whether a sort control is worth showing at all.
 *
 * Two conditions: enough options to order, and more than one way to order
 * them. Car transport can only be sorted by rating, and a control with a
 * single choice is not a control.
 */
export function shouldOfferServiceSort(
  options: readonly unknown[],
  service: string,
): boolean {
  if (options.length < MIN_OPTIONS_FOR_SORT) return false;
  return sortsForService(service).length > 1;
}

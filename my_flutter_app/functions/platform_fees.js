"use strict";

// How much of a charge the platform keeps, resolved in one place.
//
// Three levels, most specific first:
//   1. this business's rate FOR THIS SERVICE  (businesses/{id}
//      .servicePlatformFeePct[<key>]) - "parking is 5% for this lot, but
//      their freight stays at the usual rate"
//   2. this business's rate for everything    (businesses/{id}.platformFeePct)
//   3. the platform's rate for this service   (shipmentPricing/serviceFees)
//
// The keys are the same `<service>PlatformFeePct` names the pricing document
// already uses, deliberately: no translation table to drift, and a service
// that falls back to another (shared barrels -> barrels) gets the same
// ordering at every level for free.
//
// An out-of-range or unparseable value is IGNORED rather than applied, at
// every level. A typo in an override must fall through to the next level, not
// charge a customer 400% - so validation refuses rather than clamps.

const DEFAULT_PLATFORM_SERVICE_FEE_PCT = 0.1;

/**
 * A percentage the system is willing to charge, or null.
 * @param {*} raw The stored value.
 * @return {?number} A fraction in [0, 1), or null when unusable.
 */
function usablePct(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const pct = Number(raw);
  // >= 1 is refused, not clamped: a rate of 1 leaves the business nothing,
  // and anything above it is certainly a typo (5 meaning "5%", say).
  if (!Number.isFinite(pct) || pct < 0 || pct >= 1) return null;
  return pct;
}

/**
 * Level 1 - this business's rate for this specific service.
 * @param {?Object} business The business document.
 * @param {!Array<string>} keys Service keys, most specific first.
 * @return {?number} The rate, or null when the business has none.
 */
function businessServicePlatformFeePct(business, keys = []) {
  const overrides = business?.servicePlatformFeePct;
  if (!overrides || typeof overrides !== "object") return null;
  for (const key of keys) {
    const pct = usablePct(overrides[key]);
    if (pct !== null) return pct;
  }
  return null;
}

/**
 * Level 2 - this business's rate for everything it sells.
 * @param {?Object} business The business document.
 * @return {?number} The rate, or null.
 */
function businessPlatformFeePctFromBusiness(business) {
  return usablePct(
      business?.platformFeePct ?? business?.platformCommissionPct,
  );
}

/**
 * Level 3 - the platform's own rate for this service.
 * @param {?Object} pricingDoc The shipmentPricing/serviceFees document.
 * @param {!Array<string>} keys Service keys, most specific first.
 * @return {number} A rate; 0 when nothing usable is configured.
 */
function servicePlatformFeePctFromPricing(pricingDoc, keys = []) {
  // Deliberately mirrors the original resolution, including two quirks worth
  // stating: the FIRST key that is present wins even if its value turns out
  // to be unusable (an admin who set it meant to set it, so a typo reads as
  // zero rather than silently charging the next service's rate), while an
  // explicit null is treated as "not set" and does fall through.
  let raw;
  for (const key of keys) {
    if (pricingDoc?.[key] !== undefined) {
      raw = pricingDoc[key];
      break;
    }
  }
  if (raw === undefined || raw === null) {
    raw = pricingDoc?.platformFeePct ??
      process.env.PLATFORM_SERVICE_FEE_PCT ??
      DEFAULT_PLATFORM_SERVICE_FEE_PCT;
  }
  const pct = usablePct(raw);
  return pct === null ? 0 : pct;
}

/**
 * The rate to charge, and which level decided it.
 *
 * The `source` is not decoration: an admin looking at a fee needs to know
 * whether they are seeing an override or an inherited default, or they will
 * "fix" a rate in the wrong place.
 *
 * @param {?Object} pricingDoc The shipmentPricing/serviceFees document.
 * @param {?Object} business The business document.
 * @param {!Array<string>} keys Service keys, most specific first.
 * @return {{pct: number, source: string, key: string}} The resolution.
 */
function resolvePlatformFeePct(pricingDoc, business, keys = []) {
  const overrides = business?.servicePlatformFeePct;
  if (overrides && typeof overrides === "object") {
    for (const key of keys) {
      const pct = usablePct(overrides[key]);
      if (pct !== null) return {pct, source: "business_service", key};
    }
  }
  const businessWide = businessPlatformFeePctFromBusiness(business);
  if (businessWide !== null) {
    return {pct: businessWide, source: "business", key: ""};
  }
  return {
    pct: servicePlatformFeePctFromPricing(pricingDoc, keys),
    source: "platform",
    key: keys[0] || "",
  };
}

/**
 * The rate to charge.
 * @param {?Object} pricingDoc The shipmentPricing/serviceFees document.
 * @param {?Object} business The business document.
 * @param {!Array<string>} keys Service keys, most specific first.
 * @return {number} The fraction of the charge the platform keeps.
 */
function servicePlatformFeePctForBusiness(pricingDoc, business, keys = []) {
  return resolvePlatformFeePct(pricingDoc, business, keys).pct;
}

module.exports = {
  DEFAULT_PLATFORM_SERVICE_FEE_PCT,
  usablePct,
  businessServicePlatformFeePct,
  businessPlatformFeePctFromBusiness,
  servicePlatformFeePctFromPricing,
  resolvePlatformFeePct,
  servicePlatformFeePctForBusiness,
};

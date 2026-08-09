/**
 * What a parcel is worth, and who stands behind it.
 *
 * Weight does not tell you what is in the box and neither does the category:
 * an iPhone 17 and a five-year-old Samsung are the same category and the same
 * weight, and seven times apart in what it costs to make good. Only the sender
 * knows, so the sender is asked.
 *
 * The rule that makes the answer honest is that **the declared value is also
 * the cap on the payout**. Understate it to save a few dollars and you have
 * capped your own compensation. Nothing has to be checked or appraised up
 * front, which is what makes this workable for a small operator.
 *
 * The platform is not the insurer here - the business pays the customer back.
 * So a business sets its own policy, the customer sees it before choosing, and
 * the platform's job is to record what was agreed. A snapshot of the policy is
 * written onto the shipment for that reason: settings change, and a claim
 * argued six weeks later has to be judged on the terms that were in force when
 * the parcel was handed over, not on today's.
 */

/** Coverage priced above this would be a business nobody should be running. */
const MAX_COVERAGE_RATE_PCT = 10;

/**
 * Ceiling on what any business may accept, whatever it sets. A single parcel
 * worth more than this belongs with a real freight forwarder.
 */
const PLATFORM_MAX_DECLARED_VALUE = 10000;

/** Below this the question is not worth asking. */
const DECLARATION_THRESHOLD = 200;

/**
 * Reads a business's coverage policy, with safe answers when it has set
 * nothing.
 *
 * A business that has never touched these settings covers nothing and accepts
 * anything, which is exactly how freight behaved before this existed.
 *
 * @param {object} business The business document.
 * @return {object} The policy in force.
 */
function freightCoveragePolicy(business) {
  const enabled = business?.freightCoverageEnabled === true;
  const rawRate = Number(business?.freightCoverageRatePct);
  const ratePct = Number.isFinite(rawRate) && rawRate > 0 ?
    Math.min(MAX_COVERAGE_RATE_PCT, rawRate) :
    0;
  const rawMax = Number(business?.freightMaxDeclaredValue);
  const maxDeclaredValue = Number.isFinite(rawMax) && rawMax > 0 ?
    Math.min(PLATFORM_MAX_DECLARED_VALUE, rawMax) :
    0;
  return {
    // Covering nothing at a rate of zero is not coverage, whatever the flag
    // says: a business that ticks the box but never sets a rate would other-
    // wise appear to the customer as though it were standing behind the parcel.
    coversLoss: enabled && ratePct > 0,
    ratePct,
    // 0 means "no stated ceiling", which is honest rather than unlimited: it
    // is what every business looked like before this existed.
    maxDeclaredValue,
    declarationThreshold: DECLARATION_THRESHOLD,
  };
}

/**
 * Prices a declared value against a business's policy.
 *
 * @param {object} params Inputs.
 * @param {object} params.business The business document.
 * @param {*} params.declaredValue What the customer said it is worth.
 * @return {object} {ok} plus an {error} code, or the fee, cap and policy.
 */
function quoteFreightCoverage({business, declaredValue}) {
  const policy = freightCoveragePolicy(business);
  const raw = Number(declaredValue);
  const declared = Number.isFinite(raw) && raw > 0 ? raw : 0;

  if (declared <= 0) {
    // Nothing declared: no fee, no cover, and no cap to argue about later.
    return {
      ok: true,
      declaredValue: 0,
      declaredValueCents: 0,
      coverageFee: 0,
      coverageFeeCents: 0,
      covered: false,
      payoutCapCents: 0,
      policy,
    };
  }

  // The ceiling applies whether or not the business sells coverage: it is a
  // statement about what it is willing to carry, not about what it insures.
  if (policy.maxDeclaredValue > 0 && declared > policy.maxDeclaredValue) {
    return {ok: false, error: "above_max_declared_value", policy};
  }
  if (declared > PLATFORM_MAX_DECLARED_VALUE) {
    return {ok: false, error: "above_platform_maximum", policy};
  }

  if (!policy.coversLoss) {
    // The value is still recorded - it is what the business agreed to carry -
    // but nothing is charged and nothing is promised.
    return {
      ok: true,
      declaredValue: declared,
      declaredValueCents: Math.round(declared * 100),
      coverageFee: 0,
      coverageFeeCents: 0,
      covered: false,
      payoutCapCents: 0,
      policy,
    };
  }

  const coverageFeeCents = Math.round(declared * (policy.ratePct / 100) * 100);
  return {
    ok: true,
    declaredValue: declared,
    declaredValueCents: Math.round(declared * 100),
    coverageFee: coverageFeeCents / 100,
    coverageFeeCents,
    covered: true,
    // The promise, in the same units as the money. Capped at what was
    // declared, which is the whole reason the declaration can be trusted.
    payoutCapCents: Math.round(declared * 100),
    policy,
  };
}

/**
 * Validates a policy a business is trying to save.
 *
 * @param {object} params Settings being saved.
 * @param {boolean} [params.coversLoss] Whether it pays for lost parcels.
 * @param {*} [params.ratePct] Coverage price as a percent of declared value.
 * @param {*} [params.maxDeclaredValue] Most it will carry, 0 for no ceiling.
 * @return {object} {ok} plus an {error} code, or the cleaned settings.
 */
function validateFreightCoverageSettings({
  coversLoss = false,
  ratePct = 0,
  maxDeclaredValue = 0,
} = {}) {
  const rate = Number(ratePct);
  const max = Number(maxDeclaredValue);
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_COVERAGE_RATE_PCT) {
    return {ok: false, error: "rate_out_of_range"};
  }
  if (!Number.isFinite(max) || max < 0 || max > PLATFORM_MAX_DECLARED_VALUE) {
    return {ok: false, error: "max_out_of_range"};
  }
  if (coversLoss === true && rate <= 0) {
    // Promising cover at no price is how a business ends up owing money it
    // never collected for.
    return {ok: false, error: "rate_required_when_covering"};
  }
  return {
    ok: true,
    freightCoverageEnabled: coversLoss === true,
    freightCoverageRatePct: rate,
    freightMaxDeclaredValue: max,
  };
}

module.exports = {
  MAX_COVERAGE_RATE_PCT,
  PLATFORM_MAX_DECLARED_VALUE,
  DECLARATION_THRESHOLD,
  freightCoveragePolicy,
  quoteFreightCoverage,
  validateFreightCoverageSettings,
};

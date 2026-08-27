/**
 * Who stands behind a lost parcel.
 *
 * There is no charge for this and no percentage. A business prices each item
 * it carries according to what that item is worth to carry - which is the
 * whole reason freight is priced per item rather than per kilo - so the risk
 * is already inside the shipping rate. Bolting a separate "coverage fee" on
 * top charged the customer twice for the same thing.
 *
 * So the policy is one question: does this business make good on a parcel
 * it loses? Yes or no, and that is the whole of it. No rate, no proportion,
 * no deductible, and no figure per item - publishing an amount only ever
 * gave both sides a number to argue over on the worst day. A business that
 * does not cover says so plainly before the customer chooses it.
 *
 * The customer is never asked what the parcel is worth either. A sender's
 * own valuation was always a guess or an incentive, and pricing off it made
 * the honest customer subsidise the optimistic one.
 *
 * The platform is not the insurer - the business pays the customer back. A
 * snapshot of the policy is written onto the shipment because settings
 * change, and a claim argued six weeks later has to be judged on the terms
 * in force when the parcel was handed over, not on today's.
 */

/**
 * Ceiling on what any business may promise per parcel, whatever it sets. A
 * single parcel worth more than this belongs with a real freight forwarder.
 */
const PLATFORM_MAX_DECLARED_VALUE = 10000;

/**
 * Reads a business's coverage policy, with safe answers when it has set
 * nothing.
 *
 * A business that has never touched these settings covers nothing, which is
 * exactly how freight behaved before this existed.
 *
 * @param {object} business The business document.
 * @return {object} The policy in force.
 */
function freightCoveragePolicy(business) {
  return {
    // One flag, one meaning. There is no rate to qualify it with any more:
    // a business either makes good on a lost parcel or it does not.
    coversLoss: business?.freightCoverageEnabled === true,
  };
}

/**
 * What a shipment records about cover, for a client that still sends a
 * declared value.
 *
 * App builds predating the item picker ask the sender what the parcel is
 * worth. Those builds are still in customers' hands, so the number is still
 * accepted and recorded - but it never sets a price and never sets a
 * promise. Cover is the business's one flag either way, so the same parcel
 * is covered the same whichever build booked it.
 *
 * @param {object} params Inputs.
 * @param {object} params.business The business document.
 * @param {*} params.declaredValue What a legacy client said it is worth.
 * @return {object} {ok} plus the recorded value and the policy.
 */
function quoteFreightCoverage({business, declaredValue}) {
  const policy = freightCoveragePolicy(business);
  const raw = Number(declaredValue);
  const declared = Number.isFinite(raw) && raw > 0 ? raw : 0;

  if (declared > PLATFORM_MAX_DECLARED_VALUE) {
    return {ok: false, error: "above_platform_maximum", policy};
  }

  return {
    ok: true,
    declaredValue: declared,
    declaredValueCents: Math.round(declared * 100),
    // Nothing is ever charged for cover.
    coverageFee: 0,
    coverageFeeCents: 0,
    covered: false,
    policy,
  };
}

/**
 * Validates a policy a business is trying to save.
 *
 * One question now: does this business pay for a parcel it loses? The rate
 * and the declared-value ceiling are gone - there is no fee to set, and the
 * business's own item list already says what it will and will not carry.
 *
 * @param {object} params Settings being saved.
 * @param {boolean} [params.coversLoss] Whether it pays for lost parcels.
 * @return {object} {ok} plus the cleaned settings.
 */
function validateFreightCoverageSettings({coversLoss = false} = {}) {
  return {
    ok: true,
    freightCoverageEnabled: coversLoss === true,
    // Retired, and zeroed on every save so a business that once set a rate
    // stops carrying a number nothing reads.
    freightCoverageRatePct: 0,
    freightMaxDeclaredValue: 0,
  };
}

module.exports = {
  PLATFORM_MAX_DECLARED_VALUE,
  freightCoveragePolicy,
  quoteFreightCoverage,
  validateFreightCoverageSettings,
};

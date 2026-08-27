/**
 * Asking a business what it charges for something it has not priced.
 *
 * Every freight price is a number the business chose: an item row it set, or
 * nothing. There is no category multiplier standing in, and no platform
 * default filling the gap - a price nobody chose was being charged to real
 * customers, and it came from a config file rather than from the business.
 *
 * So the gap has to lead somewhere. A customer who picks something no
 * business has priced does not get a guess and does not get a dead end;
 * they describe the parcel, the businesses that serve that route answer
 * with a price, and the customer picks one. It is the same shape as a
 * transport quote (functions/index.js, createTransportRequest), because it
 * is the same problem: the price cannot be known until the side carrying
 * the goods says what it is.
 *
 * The one thing this adds over transport is cover. A freight quote says
 * whether the business makes good on the parcel if it loses it, because the
 * customer is choosing between businesses on that as well as on price. It
 * is a yes or a no, never an amount - a figure per parcel invites the
 * haggling the rest of this design exists to avoid.
 */

/** A request nobody answers in a week is a request the customer forgot. */
const FREIGHT_QUOTE_WINDOW_DAYS = 7;

/** Fanning out beyond this is a route with a data problem, not a market. */
const MAX_FREIGHT_QUOTE_PROVIDERS = 400;

/** A quote above this belongs with a real freight forwarder. */
const MAX_FREIGHT_QUOTE_CENTS = 100000000;

const FREIGHT_QUOTE_STATUS = Object.freeze({
  COLLECTING: "collecting",
  SELECTED: "selected",
  CANCELLED: "cancelled",
});

const FREIGHT_QUOTE_ERRORS = Object.freeze({
  amount_invalid: "Enter what you charge to send this",
  amount_out_of_range: "That price is outside what this platform handles",
  covers_invalid: "Say whether you cover this parcel if it is lost",
  terms_too_long: "Keep the note under 1000 characters",
  description_required: "Describe what is being sent",
  description_too_long: "Keep the description under 2000 characters",
});

const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_TERMS_LENGTH = 1000;

/**
 * What a customer must say for a business to be able to price it.
 *
 * Deliberately little: the whole point is that this is the parcel nobody
 * has a row for, so demanding a taxonomy would be asking the customer to
 * answer the question they came here because they could not answer.
 *
 * @param {object} raw The request payload.
 * @return {object} {ok, request} cleaned, or {ok: false, error}.
 */
function validateFreightQuoteRequest(raw) {
  const description = String(raw?.description || "").trim();
  if (!description) return {ok: false, error: "description_required"};
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {ok: false, error: "description_too_long"};
  }
  const weightKg = Number(raw?.weightKg);
  return {
    ok: true,
    request: {
      description,
      // Optional on purpose: a customer who knows the weight helps the
      // business quote faster, and one who does not is exactly who this
      // path exists for.
      weightKg: Number.isFinite(weightKg) && weightKg > 0 ?
        Math.round(weightKg * 1000) / 1000 :
        0,
      itemCategoryId: String(raw?.itemCategoryId || "").trim(),
      itemLabel: String(raw?.itemLabel || "").trim().slice(0, 120),
    },
  };
}

/**
 * What a business is offering, cleaned.
 *
 * Cover is stated per quote rather than read from the business's standing
 * policy, because this is a parcel that policy was never written for - the
 * whole reason the request exists. A business that will not stand behind
 * this particular one says so, and the customer sees that beside the price.
 *
 * @param {object} raw The quote payload.
 * @return {object} {ok, quote} cleaned, or {ok: false, error}.
 */
function validateFreightQuote(raw) {
  const amountCents = Number(raw?.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return {ok: false, error: "amount_invalid"};
  }
  if (amountCents > MAX_FREIGHT_QUOTE_CENTS) {
    return {ok: false, error: "amount_out_of_range"};
  }
  const terms = String(raw?.terms || "").trim();
  if (terms.length > MAX_TERMS_LENGTH) {
    return {ok: false, error: "terms_too_long"};
  }
  return {
    ok: true,
    quote: {
      amountCents,
      // Free, and the business's own promise: it either makes good on this
      // parcel or it does not, and it says which here.
      coversLoss: raw?.coversLoss === true,
      terms,
    },
  };
}

/**
 * A deterministic id for one business's answer to one request, so a second
 * submission revises the first rather than stacking another quote beside
 * it. Mirrors transportMarketplaceDocumentId.
 *
 * @param {string} requestId The request.
 * @param {string} businessId The business answering it.
 * @return {string} The document id.
 */
function freightQuoteDocumentId(requestId, businessId) {
  return `${requestId}__${businessId}`;
}

module.exports = {
  FREIGHT_QUOTE_ERRORS,
  FREIGHT_QUOTE_STATUS,
  FREIGHT_QUOTE_WINDOW_DAYS,
  MAX_FREIGHT_QUOTE_CENTS,
  MAX_FREIGHT_QUOTE_PROVIDERS,
  freightQuoteDocumentId,
  validateFreightQuote,
  validateFreightQuoteRequest,
};

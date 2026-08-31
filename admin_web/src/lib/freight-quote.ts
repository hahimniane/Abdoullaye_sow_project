/**
 * Asking a business what it charges for something it has not priced.
 *
 * Every freight price is a number the business chose: an item row it set, or
 * nothing. Where there is nothing, the customer describes the parcel, the
 * businesses that serve that route answer with a price, and the customer
 * picks one - the same shape as a car-transport quote, because it is the same
 * problem. The price cannot be known until the side carrying the goods says
 * what it is.
 *
 * The one thing this adds over transport is cover. A freight quote says
 * whether the business makes good on the parcel if it loses it, because the
 * customer is choosing between businesses on that as well as on price. It is
 * a yes or a no, never an amount - a figure per parcel invites the haggling
 * the rest of this design exists to avoid.
 *
 * Mirror of my_flutter_app/functions/freight_quote.js (the authority). The
 * server re-validates everything; these functions exist so the screen refuses
 * what the callable would refuse, in the same words.
 */

import { freightCoverageComparisonLine } from "./freight-categories.ts";

/** A request nobody answers in a week is a request the customer forgot. */
export const FREIGHT_QUOTE_WINDOW_DAYS = 7;

/** A quote above this belongs with a real freight forwarder. */
export const MAX_FREIGHT_QUOTE_CENTS = 100000000;

export const MAX_FREIGHT_QUOTE_DESCRIPTION_LENGTH = 2000;
export const MAX_FREIGHT_QUOTE_TERMS_LENGTH = 1000;

export const FREIGHT_QUOTE_STATUS = {
  COLLECTING: "collecting",
  SELECTED: "selected",
  CANCELLED: "cancelled",
} as const;

export const FREIGHT_QUOTE_ERRORS: Record<string, string> = {
  amount_invalid: "Enter what you charge to send this",
  amount_out_of_range: "That price is outside what this platform handles",
  covers_invalid: "Say whether you cover this parcel if it is lost",
  terms_too_long: "Keep the note under 1000 characters",
  description_required: "Describe what is being sent",
  description_too_long: "Keep the description under 2000 characters",
};

export function freightQuoteErrorMessage(code: unknown): string {
  const key = String(code || "");
  return FREIGHT_QUOTE_ERRORS[key] ?? "That request could not be read";
}

export type FreightQuoteRequestPayload = {
  destinationCountryId: string;
  mode: "air" | "sea";
  description: string;
  weightKg: number;
  itemCategoryId: string;
  itemLabel: string;
};

/**
 * What a customer must say for a business to be able to price it.
 *
 * Deliberately little: this is the parcel nobody has a row for, so demanding
 * a taxonomy would be asking the customer to answer the question they came
 * here because they could not answer.
 */
export function validateFreightQuoteRequest(raw: {
  destinationCountryId?: string;
  mode?: string;
  description?: string;
  weightKg?: unknown;
  itemCategoryId?: string;
  itemLabel?: string;
  hasContents?: boolean;
}):
  | {ok: true; request: FreightQuoteRequestPayload}
  | {ok: false; error: string} {
  const description = String(raw?.description ?? "").trim();
  // A declared contents list IS the description; prose becomes optional
  // nuance. Mirrors functions/freight_quote.js.
  if (!description && !raw?.hasContents) {
    return {ok: false, error: "description_required"};
  }
  if (description.length > MAX_FREIGHT_QUOTE_DESCRIPTION_LENGTH) {
    return {ok: false, error: "description_too_long"};
  }
  const weightKg = Number(raw?.weightKg);
  return {
    ok: true,
    request: {
      destinationCountryId: String(raw?.destinationCountryId ?? "").trim(),
      mode: raw?.mode === "sea" ? "sea" : "air",
      description,
      // Optional on purpose: a customer who knows the weight helps the
      // business quote faster, and one who does not is exactly who this path
      // exists for.
      weightKg:
        Number.isFinite(weightKg) && weightKg > 0
          ? Math.round(weightKg * 1000) / 1000
          : 0,
      itemCategoryId: String(raw?.itemCategoryId ?? "").trim(),
      itemLabel: String(raw?.itemLabel ?? "").trim().slice(0, 120),
    },
  };
}

export type FreightQuotePayload = {
  amountCents: number;
  coversLoss: boolean;
  terms: string;
};

/**
 * What a business is offering, cleaned.
 *
 * Cover is stated per quote rather than read from the business's standing
 * policy, because this is a parcel that policy was never written for - the
 * whole reason the request exists. A business that will not stand behind this
 * particular one says so, and the customer sees that beside the price.
 */
export function validateFreightQuote(raw: {
  amountCents?: unknown;
  coversLoss?: unknown;
  terms?: unknown;
}): {ok: true; quote: FreightQuotePayload} | {ok: false; error: string} {
  const amountCents = Number(raw?.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return {ok: false, error: "amount_invalid"};
  }
  if (amountCents > MAX_FREIGHT_QUOTE_CENTS) {
    return {ok: false, error: "amount_out_of_range"};
  }
  const terms = String(raw?.terms ?? "").trim();
  if (terms.length > MAX_FREIGHT_QUOTE_TERMS_LENGTH) {
    return {ok: false, error: "terms_too_long"};
  }
  return {
    ok: true,
    quote: {
      amountCents,
      // Free, and the business's own promise: it either makes good on this
      // parcel or it does not, and it says which here. Anything that is not
      // an explicit yes is a no, exactly as the callable reads it.
      coversLoss: raw?.coversLoss === true,
      terms,
    },
  };
}

/**
 * One business's answer to one request, so a second submission revises the
 * first rather than stacking another price beside it.
 */
export function freightQuoteDocumentId(
  requestId: string,
  businessId: string,
): string {
  return `${requestId}__${businessId}`;
}

/**
 * What a quote promises if the parcel never arrives, in the sentence the
 * customer reads on the card beside the price.
 *
 * Deliberately the same two sentences a published item's card uses: cover is
 * one question with one answer wherever a customer meets it, and reading two
 * different phrasings for the same promise is how a customer starts believing
 * they are two different promises.
 */
export function freightQuoteCoverageLine(coversLoss: unknown): string {
  return freightCoverageComparisonLine({coversLoss: coversLoss === true});
}

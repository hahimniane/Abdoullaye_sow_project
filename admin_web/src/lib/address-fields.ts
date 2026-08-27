// AUTO-PORTED from my_flutter_app/functions/address_components.js — the
// server module that splits a Google Places result into named parts and
// composes them back into one line. Keep the composition rules identical on
// all three surfaces (functions, admin_web, my_flutter_app/lib): the composed
// line is what the pricing and checkout callables receive, so a client that
// composes differently prices differently.
//
// Mobile twin: my_flutter_app/lib/models/structured_address.dart

export type StructuredAddress = {
  streetLine: string;
  /** Apartment / unit / suite. Always optional, never dropped. */
  apartment: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export const EMPTY_STRUCTURED_ADDRESS: StructuredAddress = {
  streetLine: "",
  apartment: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
};

/** Trims and collapses inner whitespace so composed lines carry no padding. */
export function cleanAddressPart(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Composes the named parts into the single line the pricing and checkout
 * callables accept. The apartment sits directly after the street line, which
 * is where a courier expects it and where Google's geocoder ignores it rather
 * than failing on it. Missing parts are skipped, so a customer who typed only
 * a street still gets a usable line.
 */
export function composeAddressLine(
  parts: Partial<StructuredAddress> | null | undefined,
): string {
  const source = parts ?? {};
  const streetLine = cleanAddressPart(source.streetLine);
  const apartment = cleanAddressPart(source.apartment);
  const city = cleanAddressPart(source.city);
  const state = cleanAddressPart(source.state);
  const postalCode = cleanAddressPart(source.postalCode);
  const country = cleanAddressPart(source.country);
  // State and ZIP are one segment ("NY 11201"); they read as a single field on
  // an envelope and splitting them produces "NY, 11201".
  const region = [state, postalCode].filter(Boolean).join(" ");
  return [streetLine, apartment, city, region, country]
    .filter(Boolean)
    .join(", ");
}

/**
 * A pickup address is usable once it has a street line plus something that
 * locates it. The apartment is never part of this test — it is optional by
 * design, and requiring it is how the field would start getting faked.
 */
export function structuredAddressIsComplete(
  parts: Partial<StructuredAddress> | null | undefined,
): boolean {
  const source = parts ?? {};
  if (!cleanAddressPart(source.streetLine)) return false;
  return Boolean(
    cleanAddressPart(source.city) ||
      cleanAddressPart(source.postalCode) ||
      cleanAddressPart(source.state),
  );
}

type SuggestionParts = {
  description?: string;
  formattedAddress?: string;
  streetLine?: string;
  apartment?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  postalCode?: string;
  country?: string;
  borough?: string;
};

/**
 * Turns a `suggestPickupAddresses` result into the form's named fields.
 *
 * An apartment the customer already typed is kept: Google autocompletes
 * buildings, not units, so its `subpremise` is nearly always empty and letting
 * it win would silently erase the unit number — the exact bug this replaces.
 *
 * Older server revisions return only `description`/`formattedAddress`. Those
 * fall back to the whole line in the street field, which the customer can then
 * edit, rather than producing an empty form.
 */
export function structuredAddressFromSuggestion(
  suggestion: SuggestionParts | null | undefined,
  current: Partial<StructuredAddress> = {},
): StructuredAddress {
  const source = suggestion ?? {};
  const streetLine =
    cleanAddressPart(source.streetLine) ||
    cleanAddressPart(source.formattedAddress) ||
    cleanAddressPart(source.description);
  return {
    streetLine,
    apartment:
      cleanAddressPart(current.apartment) || cleanAddressPart(source.apartment),
    city: cleanAddressPart(source.city) || cleanAddressPart(source.borough),
    // The abbreviation is what belongs on an envelope and in the state box.
    state: cleanAddressPart(source.stateCode) || cleanAddressPart(source.state),
    postalCode: cleanAddressPart(source.postalCode),
    country: cleanAddressPart(source.country),
  };
}

/**
 * Wraps a free-typed line as a structured address. The customer is never
 * forced to accept a suggestion, so whatever they typed becomes the street
 * line untouched and the other fields stay theirs to fill in.
 */
export function structuredAddressFromLine(
  line: string,
  current: Partial<StructuredAddress> = {},
): StructuredAddress {
  return {
    ...EMPTY_STRUCTURED_ADDRESS,
    ...current,
    streetLine: line,
  };
}

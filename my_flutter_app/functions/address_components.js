"use strict";

/**
 * Structured address components (docs/PLAN-2026-08-backlog.md item 1).
 *
 * Address autocomplete used to hand the client one opaque string, so the
 * customer could not correct a single part of it and an apartment/unit number
 * was silently dropped whenever Google did not return a `subpremise` - which
 * is most of the time, because Places autocompletes buildings, not units.
 *
 * This module turns a Google Places `address_components` array into the named
 * parts a form actually needs (street line, apartment, city, state, postal
 * code, country) and composes those parts back into the single line the
 * pricing/geocoding callables still take. It is pure: no network, no
 * Firestore, no Google client. Callers keep the fetching.
 *
 * Composition is deliberately the inverse of parsing for the parts we know:
 * `composeAddressLine(addressComponentsFromPlace(place))` reproduces a usable
 * address, and composing an already-composed value is stable, so a client may
 * recompose on every keystroke.
 */

/**
 * Trims a value and collapses inner whitespace so composed lines never carry
 * stray padding from a form field.
 *
 * @param {*} value Raw value.
 * @return {string} Cleaned string, "" when absent.
 */
function cleanPart(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Finds the first component matching any of the requested Google types, in
 * the order given (order is the priority: `locality` before `postal_town`).
 *
 * @param {!Array<!Object>} components Google `address_components`.
 * @param {!Array<string>} types Component types, most specific first.
 * @return {?Object} The matching component, or null.
 */
function findComponent(components, types) {
  const list = Array.isArray(components) ? components : [];
  for (const type of types) {
    const match = list.find(
        (component) =>
          Array.isArray(component?.types) && component.types.includes(type),
    );
    if (match) return match;
  }
  return null;
}

/**
 * Reads the long form of the first matching component.
 *
 * @param {!Array<!Object>} components Google `address_components`.
 * @param {!Array<string>} types Component types, most specific first.
 * @return {string} Long name, or "".
 */
function componentLongName(components, types) {
  return cleanPart(findComponent(components, types)?.long_name);
}

/**
 * Reads the short form of the first matching component, falling back to the
 * long form when Google omits the abbreviation.
 *
 * @param {!Array<!Object>} components Google `address_components`.
 * @param {!Array<string>} types Component types, most specific first.
 * @return {string} Short name, or "".
 */
function componentShortName(components, types) {
  const component = findComponent(components, types);
  if (!component) return "";
  return cleanPart(component.short_name) || cleanPart(component.long_name);
}

// A city is whichever of these Google supplies. `locality` is the normal
// answer; `postal_town` is how the UK and parts of Scandinavia express it;
// the sublocality/administrative fallbacks keep New York boroughs and small
// unincorporated places from resolving to an empty city field.
const CITY_TYPES = Object.freeze([
  "locality",
  "postal_town",
  "sublocality_level_1",
  "sublocality",
  "administrative_area_level_3",
  "neighborhood",
]);

/**
 * Splits a Google place into the named address parts a form can bind to.
 *
 * Every value is a string ("" when Google did not supply it) so a client can
 * drop the result straight into text controllers without null handling. In
 * particular `apartment` is almost always "" - that is expected, and is why
 * the customer gets their own optional apartment field.
 *
 * @param {*} place A Places details `result` (or anything shaped like one).
 * @return {{
 *   streetNumber: string,
 *   route: string,
 *   streetLine: string,
 *   apartment: string,
 *   city: string,
 *   state: string,
 *   stateCode: string,
 *   postalCode: string,
 *   country: string,
 *   countryCode: string,
 * }} Structured components.
 */
function addressComponentsFromPlace(place) {
  const components = Array.isArray(place?.address_components) ?
    place.address_components :
    [];
  const streetNumber = componentLongName(components, ["street_number"]);
  const route = componentLongName(components, ["route"]);
  const postalCodeComponent = findComponent(components, ["postal_code"]);
  // Google returns "11201-1234" as long_name for a ZIP+4; the short form is
  // the 5-digit code the customer recognises and the one pricing keys off.
  const postalCode =
    cleanPart(postalCodeComponent?.short_name) ||
    cleanPart(postalCodeComponent?.long_name);

  return {
    streetNumber,
    route,
    streetLine: [streetNumber, route].filter(Boolean).join(" "),
    apartment: componentLongName(components, ["subpremise"]),
    city: componentLongName(components, CITY_TYPES),
    state: componentLongName(components, ["administrative_area_level_1"]),
    stateCode: componentShortName(components, ["administrative_area_level_1"]),
    postalCode,
    country: componentLongName(components, ["country"]),
    countryCode: componentShortName(components, ["country"]),
  };
}

/**
 * Composes the named parts back into the one-line address the pricing and
 * geocoding callables accept.
 *
 * The apartment sits directly after the street line, which is where a courier
 * expects it and where Google's geocoder ignores it rather than failing on
 * it. Missing parts are skipped instead of leaving empty ", ," gaps, so a
 * customer who typed only a street still gets a usable line.
 *
 * @param {{
 *   streetLine: (string|undefined),
 *   apartment: (string|undefined),
 *   city: (string|undefined),
 *   state: (string|undefined),
 *   stateCode: (string|undefined),
 *   postalCode: (string|undefined),
 *   country: (string|undefined),
 * }} parts Named address parts.
 * @return {string} Single-line address.
 */
function composeAddressLine(parts) {
  const source = parts || {};
  const streetLine = cleanPart(source.streetLine);
  const apartment = cleanPart(source.apartment);
  const city = cleanPart(source.city);
  // The abbreviation is what belongs on an envelope and what the customer
  // sees in the state box ("NY 11201", not "New York 11201"). Outside the US
  // Google's short form is usually the same as the long one, so this costs
  // nothing there.
  const state = cleanPart(source.stateCode) || cleanPart(source.state);
  const postalCode = cleanPart(source.postalCode);
  const country = cleanPart(source.country);
  // State and ZIP are one segment ("NY 11201"); they read as a single field
  // on an envelope and splitting them produces "NY, 11201", which geocodes
  // less reliably.
  const region = [state, postalCode].filter(Boolean).join(" ");
  return [streetLine, apartment, city, region, country]
      .filter(Boolean)
      .join(", ");
}

/**
 * Whether the parts describe an address complete enough to price a pickup:
 * a street line plus something that locates it. Apartment is never required.
 *
 * @param {*} parts Named address parts.
 * @return {boolean} True when the address is usable.
 */
function addressLineIsComplete(parts) {
  const source = parts || {};
  if (!cleanPart(source.streetLine)) return false;
  return Boolean(
      cleanPart(source.city) ||
      cleanPart(source.postalCode) ||
      cleanPart(source.state) ||
      cleanPart(source.stateCode),
  );
}

module.exports = {
  addressComponentsFromPlace,
  addressLineIsComplete,
  cleanPart,
  composeAddressLine,
  findComponent,
};

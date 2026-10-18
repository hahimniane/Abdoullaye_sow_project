"use strict";

/**
 * Where a customer collects their goods in a destination country.
 *
 * Each business destination (businesses/{id}/destinationCountries/{country})
 * may carry three optional fields the owner sets in the console or the app:
 *
 *   pickupCity     "Conakry"
 *   pickupAddress  "Madina, near the market"
 *   pickupPhone    "+224620000000" (E.164: a plus, the country code, digits)
 *
 * They are written only by the `setDestinationPickup` callable, which runs
 * `validateDestinationPickup`; the ready-for-pickup WhatsApp message reads
 * them through `pickupDetails`, which re-checks the phone so a value that
 * reached the record some other way never goes out unchecked.
 *
 * Pure: no Firestore, no network.
 */

const {composeHeadquartersAddress} = require("./business_address");

const PICKUP_LIMITS = Object.freeze({
  pickupCity: 80,
  pickupAddress: 200,
  pickupPhone: 20,
});

const PICKUP_FIELDS = Object.freeze(Object.keys(PICKUP_LIMITS));

// What the clients format and the server drops.
const PHONE_FORMATTING = /[\s().-]/g;
// E.164, the form WhatsApp and the shared phone pickers store.
const E164 = /^\+[1-9]\d{7,14}$/;

const oneLine = (value) => String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();

/**
 * @param {*} value A typed or stored phone.
 * @return {string} The E.164 form, or "" when it is not one.
 */
function e164Phone(value) {
  const compact = oneLine(value).replace(PHONE_FORMATTING, "");
  return E164.test(compact) ? compact : "";
}

/**
 * Checks and tidies what an owner typed. Blank fields are allowed (they
 * clear the stored value).
 *
 * @param {object} input {pickupCity, pickupAddress, pickupPhone}.
 * @return {{value: object, errors: string[]}} The stored form of each field
 *   ("" for blank), and the refusal codes: pickup_city_too_long,
 *   pickup_address_too_long, pickup_phone_invalid, pickup_field_invalid.
 */
function validateDestinationPickup(input) {
  const data = input && typeof input === "object" ? input : {};
  const errors = [];
  const value = {};
  for (const field of PICKUP_FIELDS) {
    const raw = data[field];
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      errors.push("pickup_field_invalid");
      value[field] = "";
      continue;
    }
    value[field] = oneLine(raw);
  }
  if (value.pickupCity.length > PICKUP_LIMITS.pickupCity) {
    errors.push("pickup_city_too_long");
  }
  if (value.pickupAddress.length > PICKUP_LIMITS.pickupAddress) {
    errors.push("pickup_address_too_long");
  }
  if (value.pickupPhone) {
    const phone = e164Phone(value.pickupPhone);
    if (!phone) errors.push("pickup_phone_invalid");
    else value.pickupPhone = phone;
  }
  return {value, errors: [...new Set(errors)]};
}

const PICKUP_MESSAGES = Object.freeze({
  pickup_city_too_long:
    `The pickup city can be at most ${PICKUP_LIMITS.pickupCity} characters.`,
  pickup_address_too_long:
    "The pickup address can be at most " +
    `${PICKUP_LIMITS.pickupAddress} characters.`,
  pickup_phone_invalid:
    "The pickup phone needs its country code, like +224 620 00 00 00.",
  pickup_field_invalid: "The pickup details must be text.",
});

/**
 * "Conakry, Guinea" - the city when the owner gave one, then the country;
 * whichever of the two is known.
 *
 * @param {string} city The pickup city.
 * @param {string} country The country's name, in the reader's language.
 * @return {string} The place, or "".
 */
function pickupPlace(city, country) {
  const cityName = oneLine(city);
  const countryName = oneLine(country);
  if (cityName && countryName &&
      cityName.toLowerCase() !== countryName.toLowerCase()) {
    return `${cityName}, ${countryName}`;
  }
  return cityName || countryName;
}

/**
 * The address and phone the ready-for-pickup message gives: the
 * destination's own, else the business's address and phone.
 *
 * @param {object|null} destination The destinationCountries record.
 * @param {object|null} business The business record.
 * @return {{city: string, address: string, phone: string}} "" for unknown.
 */
function pickupDetails(destination, business) {
  const dst = destination && typeof destination === "object" ?
    destination : {};
  const biz = business && typeof business === "object" ? business : {};
  const address = oneLine(dst.pickupAddress).slice(0,
      PICKUP_LIMITS.pickupAddress) ||
    oneLine(composeHeadquartersAddress(biz)) ||
    oneLine(biz.address);
  const phone = e164Phone(dst.pickupPhone) || oneLine(biz.phone);
  return {
    city: oneLine(dst.pickupCity).slice(0, PICKUP_LIMITS.pickupCity),
    address,
    phone,
  };
}

module.exports = {
  PICKUP_LIMITS,
  PICKUP_FIELDS,
  PICKUP_MESSAGES,
  e164Phone,
  validateDestinationPickup,
  pickupPlace,
  pickupDetails,
};

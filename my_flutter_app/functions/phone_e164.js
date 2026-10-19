"use strict";

/**
 * Phone numbers as accounts know them: strict E.164 (docs/PHONE_ACCOUNTS.md
 * §2). Pure - no Firestore, no network.
 *
 * Staff still type local numbers (phone_number.js accepts them, and old app
 * versions saved them). A local number is turned into E.164 only when it
 * clearly fits the business's own country's numbering plan; anything else is
 * reported as `needs_country_code` and left for staff to fix - never guessed,
 * because a guessed number signs a stranger into someone's packages.
 */

const {
  CALLING_CODE_BY_COUNTRY,
  CALLING_CODES,
} = require("./calling_code_catalog");

const STATUS = Object.freeze({
  OK: "ok",
  EMPTY: "empty",
  INVALID: "invalid",
  NEEDS_COUNTRY_CODE: "needs_country_code",
});

// The formatting people type around a number. "(0)" is handled as a trunk
// prefix below, so brackets are simply dropped here.
const FORMATTING = /[\s().\-/\u00a0]/g;

/**
 * Curated numbering plans: the countries Laawol's businesses work in and
 * ship to, with the national significant number's exact shape. `trunk` is
 * the domestic prefix ("0" in France); `trunkRequired` means a local number
 * is only recognised with it (nine bare digits are not clearly French).
 * A country not listed here is never guessed for a local number, and an
 * international number for it is only length-checked.
 */
const NANP = Object.freeze({
  national: /^[2-9]\d{2}[2-9]\d{6}$/, trunk: "1", trunkRequired: false,
});
const PLANS = Object.freeze({
  GN: {national: /^[36]\d{8}$/},
  SN: {national: /^[37]\d{8}$/},
  ML: {national: /^[2-9]\d{7}$/},
  CI: {national: /^(01|05|07|21|25|27)\d{8}$/},
  CM: {national: /^[26]\d{8}$/},
  BF: {national: /^[2-7]\d{7}$/},
  NE: {national: /^[2-9]\d{7}$/},
  TG: {national: /^[2-9]\d{7}$/},
  BJ: {national: /^01\d{8}$/},
  GM: {national: /^[2-9]\d{6}$/},
  FR: {national: /^[1-9]\d{8}$/, trunk: "0", trunkRequired: true},
  GB: {national: /^[1-9]\d{9}$/, trunk: "0", trunkRequired: true},
  GH: {national: /^[235]\d{8}$/, trunk: "0", trunkRequired: true},
  NG: {national: /^[789][01]\d{8}$/, trunk: "0", trunkRequired: true},
  SL: {national: /^[2-9]\d{7}$/, trunk: "0", trunkRequired: true},
});

/**
 * @param {string} iso ISO-3166 alpha-2.
 * @return {object|null} {callingCode, national, trunk, trunkRequired}.
 */
function planFor(iso) {
  const code = String(iso || "").trim().toUpperCase();
  const callingCode = CALLING_CODE_BY_COUNTRY[code];
  if (!callingCode) return null;
  if (callingCode === "1") return {callingCode, ...NANP};
  const plan = PLANS[code];
  return plan ? {callingCode, trunk: "", trunkRequired: false, ...plan} :
    null;
}

// One plan per calling code, for checking an international number. "1" is
// NANP whichever +1 country; the others are one country each.
const PLAN_BY_CALLING_CODE = Object.freeze(Object.fromEntries([
  ["1", {callingCode: "1", ...NANP}],
  ...Object.keys(PLANS).map((iso) => [CALLING_CODE_BY_COUNTRY[iso],
    planFor(iso)]),
]));

const CALLING_CODE_SET = new Set(CALLING_CODES);

/**
 * @param {string} digits A number's digits after the international prefix.
 * @return {string} Its calling code (codes are prefix-free), or "".
 */
function callingCodeOf(digits) {
  for (const length of [1, 2, 3]) {
    const candidate = digits.slice(0, length);
    if (CALLING_CODE_SET.has(candidate)) return candidate;
  }
  return "";
}

/**
 * @param {string} national Digits after the country code / as typed.
 * @param {object} plan A plan.
 * @param {boolean} international Whether a country code preceded it.
 * @return {string} The national significant number, or "" when it does not
 *   fit the plan.
 */
function nationalFit(national, plan, international) {
  if (plan.trunk && national.startsWith(plan.trunk)) {
    const stripped = national.slice(plan.trunk.length);
    // "+33 (0)6 ..." and "06 ..." both carry the trunk prefix.
    if (plan.national.test(stripped)) return stripped;
  }
  if (plan.national.test(national) &&
      (international || !plan.trunkRequired)) {
    return national;
  }
  return "";
}

/**
 * The one E.164 rule (docs/PHONE_ACCOUNTS.md §2).
 *
 * @param {*} raw The number as stored.
 * @param {{regionIso: (string|undefined)}} options regionIso is the
 *   business's country, used only for a number with no country code.
 * @return {{status: string, e164: string}} e164 is "" unless status is ok.
 */
function toE164(raw, options = {}) {
  const typed = String(raw ?? "").trim();
  if (!typed) return {status: STATUS.EMPTY, e164: ""};
  if (/[A-Za-z]/.test(typed)) return {status: STATUS.INVALID, e164: ""};
  const compact = typed.replace(FORMATTING, "");
  if (!/^\+?\d+$/.test(compact)) return {status: STATUS.INVALID, e164: ""};
  const international = compact.startsWith("+") || compact.startsWith("00");
  if (international) {
    const digits = compact.replace(/^\+|^00/, "");
    if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
      return {status: STATUS.INVALID, e164: ""};
    }
    const callingCode = callingCodeOf(digits);
    if (!callingCode) return {status: STATUS.INVALID, e164: ""};
    const plan = PLAN_BY_CALLING_CODE[callingCode];
    const rest = digits.slice(callingCode.length);
    if (!plan) {
      return rest.length >= 4 ?
        {status: STATUS.OK, e164: `+${digits}`} :
        {status: STATUS.INVALID, e164: ""};
    }
    const national = nationalFit(rest, plan, true);
    return national ?
      {status: STATUS.OK, e164: `+${callingCode}${national}`} :
      {status: STATUS.INVALID, e164: ""};
  }
  const digits = compact;
  if (digits.length < 6 || digits.length > 15) {
    return {status: STATUS.INVALID, e164: ""};
  }
  const plan = planFor(options.regionIso);
  const national = plan ? nationalFit(digits, plan, false) : "";
  return national ?
    {status: STATUS.OK, e164: `+${plan.callingCode}${national}`} :
    {status: STATUS.NEEDS_COUNTRY_CODE, e164: ""};
}

/**
 * @param {*} value Anything.
 * @return {string} A strict E.164 number, or "".
 */
function strictE164(value) {
  const typed = String(value ?? "").trim();
  if (!typed.startsWith("+")) return "";
  const parsed = toE164(typed);
  return parsed.status === STATUS.OK ? parsed.e164 : "";
}

/**
 * @param {*} value Anything.
 * @return {string} Its digits.
 */
function digitsOf(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Whether a record's raw phone field still is this E.164 number - checked
 * when a record is read, so a number staff changed leaves the old account at
 * once, before the derived field is re-stamped.
 *
 * @param {*} raw The record's raw phone field.
 * @param {string} e164 The account's number.
 * @return {boolean} True when the raw digits (leading zeros dropped) are the
 *   tail of the E.164 digits, seven or more of them.
 */
function sameNumber(raw, e164) {
  const tail = digitsOf(raw).replace(/^0+/, "");
  const full = digitsOf(e164);
  return tail.length >= 7 && full.length >= tail.length && full.endsWith(tail);
}

// Calling codes whose people read French first.
const FRENCH_CALLING_CODES = Object.freeze([
  "33", "221", "223", "224", "225", "226", "227", "228", "229", "235", "236",
  "237", "241", "242", "243", "253", "257", "261", "262", "269", "509", "590",
  "594", "596",
]);

/**
 * The language of a sign-in code message.
 *
 * @param {string} e164 The number.
 * @param {*} preferredLanguage The profile's language, if any.
 * @return {"en"|"fr"} The language.
 */
function loginLanguage(e164, preferredLanguage) {
  const profile = String(preferredLanguage || "").trim().toLowerCase();
  if (profile === "fr") return "fr";
  if (profile === "en") return "en";
  const digits = digitsOf(e164);
  return FRENCH_CALLING_CODES.some((code) => digits.startsWith(code) &&
    callingCodeOf(digits) === code) ? "fr" : "en";
}

/**
 * The only part of a number shown to someone holding a tracking code.
 *
 * @param {*} e164 The number.
 * @return {string} Its last two digits, or "".
 */
function lastTwo(e164) {
  const digits = digitsOf(e164);
  return digits.length >= 8 ? digits.slice(-2) : "";
}

/**
 * @param {*} countryName A business's country as stored ("United States").
 * @param {Array<{name: string, code: string}>} countries ALL_COUNTRIES.
 * @return {string} Its ISO code, or "".
 */
function regionIsoForCountry(countryName, countries) {
  const wanted = String(countryName || "").trim().toLowerCase();
  if (!wanted) return "";
  if (/^[a-z]{2}$/.test(wanted)) return wanted.toUpperCase();
  const match = (countries || []).find((country) =>
    String(country.name || "").toLowerCase() === wanted ||
    String(country.id || "").toLowerCase() === wanted);
  return match ? String(match.code || "").toUpperCase() : "";
}

module.exports = {
  STATUS,
  FRENCH_CALLING_CODES,
  callingCodeOf,
  digitsOf,
  lastTwo,
  loginLanguage,
  planFor,
  regionIsoForCountry,
  sameNumber,
  strictE164,
  toE164,
};

/**
 * The one phone-number rule the backend uses.
 *
 * Lifted out of index.js so modules that need it - guest bookings, saved
 * recipients - share the rule instead of each carrying a slightly different
 * regex. Deliberately not E.164: customers type local numbers, and rejecting
 * a reachable number because it lacks a country code helps nobody.
 */

/** Formatting a caller typed is theirs to type and ours to drop. */
const FORMATTING = /[\s().-]/g;

/**
 * @param {*} value raw phone input
 * @return {boolean} whether it is 7 to 15 digits, optionally led by a plus
 */
function isValidPhoneNumber(value) {
  const raw = String(value || "").trim();
  if (!raw || /[A-Za-z]/.test(raw)) return false;
  const normalized = raw.replace(FORMATTING, "");
  if (!/^\+?\d+$/.test(normalized)) return false;
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * @param {*} value raw phone input
 * @return {string} the number with formatting dropped, plus preserved, or ""
 */
function normalizePhoneNumber(value) {
  if (!isValidPhoneNumber(value)) return "";
  return String(value).trim().replace(FORMATTING, "");
}

/**
 * Digits only, for matching two spellings of the same number.
 *
 * @param {*} value raw phone input
 * @return {string} the digits
 */
function normalizePhoneAlias(value) {
  return String(value || "").replace(/\D/g, "");
}

/** E.164: a plus, a non-zero country code, 8 to 15 digits in all. */
const E164 = /^\+[1-9]\d{7,14}$/;

/** A North American number: area code and exchange never start 0 or 1. */
const NANP_TEN = /^[2-9]\d{2}[2-9]\d{6}$/;
const NANP_ELEVEN = /^1[2-9]\d{2}[2-9]\d{6}$/;

/**
 * The number to hand an SMS provider, or "" when we cannot tell where it is.
 *
 * Unlike isValidPhoneNumber this is strict on purpose. Local numbers are fine
 * to store, but a text needs a country, and guessing one sends a Conakry
 * customer's receipt to a stranger in the US. So: an international number is
 * used as typed, a clear US/Canada number gets its +1, anything else is
 * skipped.
 *
 * @param {*} value raw phone input
 * @return {string} an E.164 number, or "" when the country is unknown
 */
function smsDestination(value) {
  const normalized = String(value || "").trim().replace(FORMATTING, "");
  if (E164.test(normalized)) return normalized;
  if (NANP_TEN.test(normalized)) return `+1${normalized}`;
  if (NANP_ELEVEN.test(normalized)) return `+${normalized}`;
  return "";
}

module.exports = {
  isValidPhoneNumber,
  normalizePhoneAlias,
  normalizePhoneNumber,
  smsDestination,
};

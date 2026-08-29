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

module.exports = {
  isValidPhoneNumber,
  normalizePhoneAlias,
  normalizePhoneNumber,
};

"use strict";

/**
 * Customer-facing tracking codes.
 *
 * The original format was `${prefix}-${base36 timestamp}-${random6}`, which
 * produced 18-character codes like BS-MS9TTES1-OMVYTL. The middle segment
 * only encoded creation time - information the customer already sees as a
 * date - while making the code too long to read over the phone or copy from
 * a receipt without mistakes.
 *
 * The short format keeps the service prefix (BS, FR, TR, PK, BP) because
 * support and businesses use it to tell services apart at a glance, and
 * follows it with six characters from a deliberately restricted alphabet.
 *
 * Alphabet choices, both aimed at people reading codes aloud or typing them:
 *   - no 0/O, 1/I/L - the classic misread pairs
 *   - no vowels at all, so a code can never spell a real (or offensive) word
 *
 * 28 symbols over 6 positions is 481 million combinations per service. The
 * caller still checks Firestore for a collision before using a code, so the
 * space only needs to make collisions rare, not impossible.
 */

const TRACKING_ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";
const TRACKING_CODE_LENGTH = 6;

/**
 * Builds one candidate code. Randomness is injected so tests can be
 * deterministic and so callers can supply a crypto-grade source.
 *
 * @param {string} prefix Service prefix, e.g. "BS".
 * @param {function(number): number} randomInt Returns an int in [0, max).
 * @return {string} A code such as "BS-K7M4P2".
 */
function buildTrackingCode(prefix, randomInt) {
  const clean = String(prefix || "").trim().toUpperCase();
  if (!clean) throw new Error("tracking prefix is required");
  let body = "";
  for (let i = 0; i < TRACKING_CODE_LENGTH; i++) {
    body += TRACKING_ALPHABET[randomInt(TRACKING_ALPHABET.length)];
  }
  return `${clean}-${body}`;
}

/**
 * Normalizes anything a human might type back into canonical form, so
 * "bs k7m4p2", "BS-K7M4P2" and "bsk7m4p2" all resolve to the same code.
 *
 * @param {string} input Raw user input.
 * @return {string} Canonical code, or "" when nothing usable was supplied.
 */
function normalizeTrackingCode(input) {
  const stripped = String(input || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  if (!stripped) return "";
  // Legacy codes carry two segments and a base36 timestamp; leave anything
  // that is not exactly prefix + short body alone so old codes still match.
  const body = `[${TRACKING_ALPHABET}]{${TRACKING_CODE_LENGTH}}`;
  const match = stripped.match(new RegExp(`^([A-Z]{2})(${body})$`));
  return match ? `${match[1]}-${match[2]}` : stripped;
}

module.exports = {
  TRACKING_ALPHABET,
  TRACKING_CODE_LENGTH,
  buildTrackingCode,
  normalizeTrackingCode,
};

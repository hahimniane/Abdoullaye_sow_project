"use strict";

/**
 * Business cards (docs/BUSINESS_CARDS.md): the rules with no Firestore in
 * them. Every business and each person on its team has one card. A card is
 * a short code; the code is what the printed QR carries, so it never changes
 * and says nothing by itself. What the card shows is read fresh on every
 * scan: the person's name and own number, the business's name and number,
 * and how the business chose its card to look.
 *
 * A card never carries an email, a role, a permission or a uid: the person
 * holding a printed card hands it to strangers.
 */

// The tracking alphabet (tracking_code.js): no 0/O, 1/I/L, and no vowels, so
// a code is easy to read aloud and can never spell a word.
const CARD_ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";
// 28^8 is 378 billion codes. A code opens a name and a phone number, so it
// is long enough that guessing one is hopeless under the scan rate limit.
const CARD_CODE_LENGTH = 8;
const CARD_CODE_PATTERN = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{8}$/;
/** What a printed QR opens. Never change it: printed cards are forever. */
const CARD_LINK_BASE = "https://laawoldigital.com/c/";

/** How a card is drawn. The web owns the drawings (lib/business-card.ts). */
const CARD_STYLES = Object.freeze(["classic", "signature"]);
/** The business's main color: fixed keys, each checked for contrast. */
const CARD_COLORS = Object.freeze(["laawol", "teal", "indigo", "forest",
  "burgundy", "saffron", "charcoal", "ocean", "plum", "navy"]);
/** The second color of the signature card. */
const CARD_ACCENTS = Object.freeze(["red", "amber", "teal", "blue"]);
/** A stock picture on the signature card. */
const CARD_PHOTOS = Object.freeze(["none", "car"]);

const CARD_TAGLINE_MAX = 60;
const CARD_SERVICE_MAX = 40;
const CARD_SERVICES_MAX = 6;

const DEFAULT_CARD_SETTINGS = Object.freeze({
  style: "classic",
  color: "laawol",
  accent: "red",
  photo: "none",
  tagline: "",
  services: Object.freeze([]),
});

/**
 * One candidate code. Randomness is injected so tests are deterministic.
 *
 * @param {function(number): number} randomInt Returns an int in [0, max).
 * @return {string} A code such as "K7M4P2XB".
 */
function buildCardCode(randomInt) {
  let code = "";
  for (let i = 0; i < CARD_CODE_LENGTH; i++) {
    code += CARD_ALPHABET[randomInt(CARD_ALPHABET.length)];
  }
  return code;
}

/**
 * A code as typed or scanned, in the stored form.
 *
 * @param {*} input The raw value.
 * @return {string} The code, "" when it is not one.
 */
function normalizeCardCode(input) {
  const code = String(input || "").trim().toUpperCase();
  return CARD_CODE_PATTERN.test(code) ? code : "";
}

const oneLine = (value, max) => String(value == null ? "" : value)
    .replace(/\s+/g, " ").trim().slice(0, max);

const pick = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;

/**
 * The stored settings with defaults for anything absent or damaged. Reading
 * never throws: a card must open even if the document was edited by hand.
 *
 * @param {*} raw `businesses/{id}.card`.
 * @return {object} Complete settings.
 */
function normalizeCardSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const services = (Array.isArray(source.services) ? source.services : [])
      .map((line) => oneLine(line, CARD_SERVICE_MAX)).filter(Boolean)
      .slice(0, CARD_SERVICES_MAX);
  return {
    style: pick(source.style, CARD_STYLES, DEFAULT_CARD_SETTINGS.style),
    color: pick(source.color, CARD_COLORS, DEFAULT_CARD_SETTINGS.color),
    accent: pick(source.accent, CARD_ACCENTS, DEFAULT_CARD_SETTINGS.accent),
    photo: pick(source.photo, CARD_PHOTOS, DEFAULT_CARD_SETTINGS.photo),
    tagline: oneLine(source.tagline, CARD_TAGLINE_MAX),
    services,
  };
}

/**
 * What an owner sent, checked. Unlike a read, a save says what is wrong.
 *
 * @param {*} raw The submitted settings.
 * @return {{settings: object, errors: string[]}} Clean settings and codes.
 */
function cleanCardSettingsInput(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const errors = [];
  const check = (key, allowed) => {
    if (source[key] !== undefined && !allowed.includes(source[key])) {
      errors.push(`${key}_invalid`);
    }
  };
  check("style", CARD_STYLES);
  check("color", CARD_COLORS);
  check("accent", CARD_ACCENTS);
  check("photo", CARD_PHOTOS);
  if (String(source.tagline == null ? "" : source.tagline).trim().length >
      CARD_TAGLINE_MAX) {
    errors.push("tagline_too_long");
  }
  const lines = Array.isArray(source.services) ? source.services : [];
  if (source.services !== undefined && !Array.isArray(source.services)) {
    errors.push("services_invalid");
  }
  const written = lines.map((line) => String(line == null ? "" : line)
      .replace(/\s+/g, " ").trim()).filter(Boolean);
  if (written.length > CARD_SERVICES_MAX) errors.push("services_too_many");
  if (written.some((line) => line.length > CARD_SERVICE_MAX)) {
    errors.push("service_too_long");
  }
  return {settings: normalizeCardSettings(source), errors};
}

/**
 * The name a card prints. Never the email: a card is handed to strangers.
 *
 * @param {object} user A `users/{uid}` document's data.
 * @return {string} The name, "" when none.
 */
function cardPersonName(user) {
  return [user?.fullName, user?.displayName]
      .map((value) => oneLine(value, 80)).find(Boolean) || "";
}

/**
 * The person's own number.
 *
 * @param {object} user A `users/{uid}` document's data.
 * @return {string} The phone, "" when none.
 */
function cardPersonPhone(user) {
  return [user?.phone, user?.normalizedPhone, user?.phoneInvite?.phoneE164,
    user?.phoneNumber].map((value) => oneLine(value, 40)).find(Boolean) || "";
}

/**
 * Whether a person is on a business's team today. A card whose person has
 * left shows the business alone.
 *
 * @param {object} user A `users/{uid}` document's data, or null.
 * @param {string} businessId The business.
 * @param {string} ownerUid The business's owner.
 * @param {string} uid The person.
 * @return {boolean} True for the owner and for current staff.
 */
function isTeamMember(user, businessId, ownerUid, uid) {
  if (!user) return false;
  if (uid && uid === ownerUid) return true;
  return (user.role === "staff" || user.role === "businessOwner") &&
    String(user.businessId || "") === businessId;
}

/**
 * The business half of a card: only what a customer may see.
 *
 * @param {string} businessId The business.
 * @param {object} business A `businesses/{id}` document's data.
 * @param {string[]} services Its switched-on services.
 * @return {object} The allowlisted fields.
 */
function cardBusiness(businessId, business, services) {
  const b = business || {};
  return {
    businessId,
    name: oneLine(b.name, 80),
    phone: oneLine(b.phone, 40),
    website: oneLine(b.website, 120),
    addressLine1: oneLine(b.addressLine1, 120),
    city: oneLine(b.city, 60),
    state: oneLine(b.state, 40),
    postalCode: oneLine(b.postalCode, 20),
    logoUrl: oneLine(b.profileImageUrl, 600),
    requestSlug: oneLine(b.requestSlug, 60),
    services: Array.isArray(services) ? services : [],
  };
}

/**
 * Everything the public page of one card may show.
 *
 * @param {object} input Code, business, its id and services, and the
 *     person (null when the card is the business's own or the person left).
 * @return {object} The card.
 */
function publicCard({code, businessId, business, services, user}) {
  const name = user ? cardPersonName(user) : "";
  return {
    code,
    link: CARD_LINK_BASE + code,
    person: user && name ?
      {name, phone: cardPersonPhone(user)} : null,
    business: cardBusiness(businessId, business, services),
    settings: normalizeCardSettings(business?.card),
  };
}

module.exports = {
  CARD_ACCENTS,
  CARD_ALPHABET,
  CARD_CODE_LENGTH,
  CARD_CODE_PATTERN,
  CARD_COLORS,
  CARD_LINK_BASE,
  CARD_PHOTOS,
  CARD_SERVICE_MAX,
  CARD_SERVICES_MAX,
  CARD_STYLES,
  CARD_TAGLINE_MAX,
  DEFAULT_CARD_SETTINGS,
  buildCardCode,
  cardBusiness,
  cardPersonName,
  cardPersonPhone,
  cleanCardSettingsInput,
  isTeamMember,
  normalizeCardCode,
  normalizeCardSettings,
  publicCard,
};

/**
 * Contact details for a customer who books without an account.
 *
 * A guest signs in anonymously, so Firebase Auth holds no email and no phone
 * for them. Everything the business and the platform would normally read off
 * the user record has to travel with the booking instead, and it has to be
 * there: a shipment nobody can be reached about is not a shipment.
 */

const {normalizePhoneNumber} = require("./phone_number");

const EMAIL_MAX = 254;
const NAME_MAX = 120;
const PHONE_MAX = 32;

/**
 * Deliberately permissive. This is a routing check for a receipt, not an
 * attempt to decide which addresses exist - the confirmation email either
 * arrives or it does not, and that is the real test.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * @param {*} value raw input
 * @param {number} max longest string to keep
 * @return {string} the trimmed, capped string
 */
function cleanField(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

/**
 * The backend's one phone rule, applied to a guest's number.
 *
 * @param {*} value raw phone input
 * @return {string} the normalized number, or "" when it is not a phone number
 */
function normalizeGuestPhone(value) {
  return normalizePhoneNumber(cleanField(value, PHONE_MAX * 2)).slice(
      0, PHONE_MAX,
  );
}

/**
 * @param {*} value raw email input
 * @return {string} the lowercased address, or "" when it is not one
 */
function normalizeGuestEmail(value) {
  const email = cleanField(value, EMAIL_MAX).toLowerCase();
  return EMAIL_SHAPE.test(email) ? email : "";
}

/**
 * Reads the guest block off a callable payload.
 *
 * Reports either the parsed contact or the first field that failed, so the
 * client can point at that field rather than saying "check your details".
 *
 * @param {*} raw the guest block off a callable payload
 * @return {object} the parsed contact, or the field that failed
 */
function parseGuestContact(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {ok: false, error: "guest_contact_missing"};
  }
  const name = cleanField(raw.name, NAME_MAX);
  if (!name) return {ok: false, error: "guest_name_missing"};

  const email = normalizeGuestEmail(raw.email);
  if (!email) return {ok: false, error: "guest_email_invalid"};

  const phone = normalizeGuestPhone(raw.phone);
  if (!phone) return {ok: false, error: "guest_phone_invalid"};

  return {ok: true, contact: {name, email, phone}};
}

/**
 * True when the caller holds an anonymous Firebase session.
 *
 * The provider list is the authority rather than the absence of an email: a
 * real account can be mid-verification and still have none, and treating that
 * caller as a guest would quietly detach their booking from their account.
 *
 * @param {*} auth the callable request's auth
 * @return {boolean} whether the caller holds an anonymous session
 */
function isAnonymousCaller(auth) {
  if (!auth) return false;
  const provider = auth.token?.firebase?.sign_in_provider;
  if (provider) return provider === "anonymous";
  return Array.isArray(auth.token?.firebase?.identities) &&
    auth.token.firebase.identities.length === 0;
}

/**
 * Decides the identity fields a booking is written with.
 *
 * A signed-in customer keeps the account's own email even when a guest block
 * rides along on the payload, so a stale or spoofed block can never rewrite
 * where a real customer's receipts go.
 *
 * @param {object} input the caller and the payload
 * @return {object} the identity fields, or the field that failed
 */
function resolveBookingContact({auth, userRecord, guest}) {
  const anonymous = isAnonymousCaller(auth);
  if (!anonymous) {
    return {
      ok: true,
      identity: {
        isGuest: false,
        customerEmail: userRecord?.email || "",
        customerName: userRecord?.displayName || "",
        customerPhone: userRecord?.phoneNumber || "",
      },
    };
  }
  const parsed = parseGuestContact(guest);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    identity: {
      isGuest: true,
      customerEmail: parsed.contact.email,
      customerName: parsed.contact.name,
      customerPhone: parsed.contact.phone,
      guestEmail: parsed.contact.email,
    },
  };
}

/**
 * The key a guest's rate limit counts against.
 *
 * Never the uid: an anonymous caller mints a fresh one whenever it likes, so
 * counting per-uid would cap nobody. The email is what a guest has to reuse
 * to receive their booking, and the IP backs it up when the email varies.
 *
 * @param {object} input the guest's email and address
 * @return {string[]} the keys the limit counts against
 */
function guestRateLimitKeys({email, ip}) {
  const keys = [];
  const address = normalizeGuestEmail(email);
  if (address) keys.push(`email:${address}`);
  const host = cleanField(ip, 64);
  if (host) keys.push(`ip:${host}`);
  return keys;
}

/**
 * The contact a guest gave on an earlier booking.
 *
 * An anonymous session outlives the app that created it - Firebase keeps it
 * in the keychain - while anything the client held in memory does not. A
 * guest coming back to a second booking is therefore still anonymous and no
 * longer carrying their details, and demanding them again from a screen that
 * does not ask is a dead end. Their first booking already wrote them to
 * their profile, so read them from there.
 *
 * @param {object} profile the caller's users/{uid} document
 * @return {object} the identity fields, or null when there is nothing stored
 */
function storedGuestIdentity(profile) {
  if (!profile || profile.isGuest !== true) return null;
  const email = normalizeGuestEmail(profile.email);
  const name = cleanField(profile.fullName, NAME_MAX);
  if (!email || !name) return null;
  return {
    isGuest: true,
    customerEmail: email,
    customerName: name,
    customerPhone: normalizeGuestPhone(profile.phone),
    guestEmail: email,
  };
}

module.exports = {
  storedGuestIdentity,
  guestRateLimitKeys,
  isAnonymousCaller,
  normalizeGuestEmail,
  normalizeGuestPhone,
  parseGuestContact,
  resolveBookingContact,
};

"use strict";

/**
 * Remembered recipients (docs/PLAN-2026-08-backlog.md #7).
 *
 * When a customer sends a barrel, a parcel or a car to someone, that person
 * is worth remembering: the next shipment should be completable from the
 * name alone. This module decides what a saved recipient looks like and how
 * two sends collapse onto the same person - it does no Firestore work, so it
 * can be tested exhaustively without an emulator.
 *
 * Identity is the phone number, not the name: people spell names
 * inconsistently ("Amadou", "amadou d.") but a phone number is exact. A
 * recipient with no usable phone is not remembered at all rather than
 * guessed at.
 */

/** Services a saved recipient can come from. */
const RECIPIENT_SOURCES = Object.freeze([
  "barrel",
  "freight",
  "carTransport",
]);

/**
 * Digits-only form of a phone number, used as the identity key.
 *
 * @param {*} value Raw phone as typed.
 * @return {string} Digits only, empty when there is nothing usable.
 */
function recipientPhoneKey(value) {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Trims and length-caps a free-text field.
 *
 * @param {*} value Raw value.
 * @param {number} maxLength Maximum characters kept.
 * @return {string} Cleaned text.
 */
function cleanRecipientText(value, maxLength) {
  return String(value === undefined || value === null ? "" : value)
      .trim()
      .slice(0, maxLength);
}

/**
 * Builds the document id and stored shape for a recipient a customer just
 * sent to, or null when there is not enough to remember.
 *
 * The id is deliberately the phone key: sending to the same number twice
 * updates one record instead of growing a list of near-duplicates.
 *
 * @param {{receiverName: *, receiverPhone: *, destinationCountryId: *,
 *   destinationCountryName: (*|undefined), address: (*|undefined),
 *   receiverPhoneIsWhatsappOnly: (*|undefined), source: string}} input What
 *   the shipment knows about the recipient.
 * @return {?{id: string, data: !Object}} The record to upsert, or null when
 *   the recipient cannot be identified.
 */
function buildSavedRecipient(input) {
  const phoneKey = recipientPhoneKey(input && input.receiverPhone);
  const name = cleanRecipientText(input && input.receiverName, 160);
  // No phone means no reliable identity, and a nameless entry helps nobody.
  if (!phoneKey || !name) return null;
  if (!RECIPIENT_SOURCES.includes(input.source)) return null;

  const data = {
    name,
    phone: cleanRecipientText(input.receiverPhone, 40),
    phoneKey,
    countryId: cleanRecipientText(input.destinationCountryId, 80),
    countryName: cleanRecipientText(input.destinationCountryName, 120),
    address: cleanRecipientText(input.address, 500),
    whatsappOnly: input.receiverPhoneIsWhatsappOnly === true,
    lastSource: input.source,
  };
  return {id: phoneKey, data};
}

/**
 * Merges a new send into what is already stored for that recipient.
 *
 * Later sends win for details the customer just confirmed, but a previously
 * known value is never replaced by a blank one - re-sending without an
 * address must not erase the address already on file.
 *
 * @param {?Object} existing Stored recipient, if any.
 * @param {!Object} incoming Fresh record from buildSavedRecipient.
 * @return {!Object} The merged record to write.
 */
function mergeSavedRecipient(existing, incoming) {
  const previous = existing && typeof existing === "object" ? existing : {};
  const merged = {...previous};
  Object.keys(incoming).forEach((key) => {
    const value = incoming[key];
    if (typeof value === "string" && value === "") return;
    merged[key] = value;
  });
  merged.useCount = Number(previous.useCount || 0) + 1;
  return merged;
}

module.exports = {
  RECIPIENT_SOURCES,
  recipientPhoneKey,
  buildSavedRecipient,
  mergeSavedRecipient,
};

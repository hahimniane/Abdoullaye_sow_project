"use strict";

/**
 * Customer edits to an open car transport request.
 *
 * Car transport is a quote marketplace: a business never "accepts" a request,
 * it quotes, and the customer picks a quote. So the edit window closes when
 * the CUSTOMER selects a quote (quoteStatus leaves "collecting"), because that
 * is the moment a price is committed.
 *
 * Two classes of field, because businesses price against what the request
 * says:
 *
 *   CONTACT   - phone, notes, dates, pickup address. Changing these cannot
 *               make a quote wrong, so quotes in hand survive.
 *   QUOTED    - vehicle, pickup area, transport method, operability, and the
 *               destination country. Changing any of these means every quote
 *               already given was priced for a different job, so those quotes
 *               are voided and businesses are asked again.
 *
 * Destination is the sharpest case: eligibility is derived from the
 * destination country, so a change there can move the request to an entirely
 * different set of businesses. Rather than blocking it, the request is
 * re-matched and only businesses that serve the new country ever see it.
 */

const CONTACT_FIELDS = Object.freeze([
  "customerPhone",
  "notes",
  "pickupAddress",
  "preferredDate",
  "flexibleDates",
]);

const QUOTED_FIELDS = Object.freeze([
  "carMake",
  "carModel",
  "carYear",
  "pickupArea",
  "vehicleOperable",
  "requestedTransportMethod",
  "destinationCountryId",
]);

const EDITABLE_FIELDS = Object.freeze([...CONTACT_FIELDS, ...QUOTED_FIELDS]);

/**
 * Values that mean "not provided" and so should not overwrite anything.
 *
 * @param {*} value Candidate value from the client.
 * @return {boolean} True when the value should be ignored.
 */
function isAbsent(value) {
  return value === undefined || value === null;
}

/**
 * Compares a requested patch against the stored request and reports what may
 * be written, whether quotes must be voided, and whether the request has to be
 * re-matched to a new set of businesses.
 *
 * Pure so the decision can be tested without Firestore.
 *
 * @param {!Object} current Stored transport request data.
 * @param {!Object} patch Raw fields supplied by the client.
 * @return {{changes: !Object, changedQuotedFields: !Array<string>,
 *   requoteRequired: boolean, destinationChanged: boolean,
 *   rejected: !Array<string>}} The classified edit.
 */
function classifyTransportEdit(current, patch) {
  const source = patch && typeof patch === "object" ? patch : {};
  const changes = {};
  const rejected = [];
  const changedQuotedFields = [];

  Object.keys(source).forEach((key) => {
    if (!EDITABLE_FIELDS.includes(key)) {
      // Price, status, businessId and friends are never customer-writable;
      // report them rather than silently dropping them.
      rejected.push(key);
      return;
    }
    const next = source[key];
    if (isAbsent(next)) return;
    const before = current ? current[key] : undefined;
    if (equalish(before, next)) return;
    changes[key] = next;
    if (QUOTED_FIELDS.includes(key)) changedQuotedFields.push(key);
  });

  return {
    changes,
    rejected,
    changedQuotedFields,
    requoteRequired: changedQuotedFields.length > 0,
    destinationChanged: changedQuotedFields.includes("destinationCountryId"),
  };
}

/**
 * Loose equality so a client echoing "2019" for a stored 2019, or a trailing
 * space in an address, is not treated as an edit that voids every quote.
 *
 * @param {*} a Stored value.
 * @param {*} b Incoming value.
 * @return {boolean} True when the two mean the same thing.
 */
function equalish(a, b) {
  if (a === b) return true;
  if (typeof a === "boolean" || typeof b === "boolean") {
    return Boolean(a) === Boolean(b);
  }
  if (isAbsent(a) && String(b).trim() === "") return true;
  return String(a === undefined ? "" : a).trim() ===
    String(b === undefined ? "" : b).trim();
}

module.exports = {
  CONTACT_FIELDS,
  QUOTED_FIELDS,
  EDITABLE_FIELDS,
  classifyTransportEdit,
};

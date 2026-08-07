"use strict";

/**
 * The car-transport fulfilment state machine, in one place.
 *
 * A transport job can arrive here two ways:
 *
 *   MARKETPLACE (flowVersion 2) - the customer asked for quotes, businesses
 *       bid, the customer selected one. Ownership is `selectedBusinessId`, and
 *       `businessId` is stamped to the same value when the quote is selected.
 *
 *   LEGACY (no flowVersion, or 1) - a business (or an operations admin) typed
 *       the job into its own console/app. There is no quote, no bidding, and so
 *       no `selectedBusinessId` to check. The only owner a legacy record has
 *       ever had is `businessId`, which is exactly what `firestore.rules`
 *       gates the direct read/write on:
 *
 *           allow update: if isLegacyTransportRecord(resource.data) &&
 *             request.resource.data.businessId == resource.data.businessId &&
 *             (hasAdminCapability(uid, 'operations') ||
 *              canManageBusinessSection(uid, resource.data.businessId,
 *                                       'transport'));
 *
 *       So `businessId === the caller's business` is not a new rule invented
 *       here - it is the rule the database already enforced for the direct
 *       write this callable replaces.
 *
 * Before this module the callable refused every legacy record, and the web
 * console worked around the refusal by writing `transportRequests` directly -
 * skipping the transition table AND the container-number gate. Accepting legacy
 * records here is what lets that fallback be deleted, so there is exactly one
 * implementation of "where may this job go next".
 *
 * Everything below is pure: no Firestore, no HttpsError. The callable maps the
 * returned codes onto HttpsError, and `test/transport-fulfillment.test.js`
 * drives the decisions directly.
 */

const {validateContainerNumber} = require("./shipment_tracking");

/** Every status the transport state machine produces. */
const TRANSPORT_FULFILLMENT_STATUSES = Object.freeze([
  "pending",
  "scheduled",
  "in_transit",
  "delivered",
  "cancelled",
]);

/**
 * Where a job may go from where it is.
 *
 * `delivered` and `cancelled` are terminal and map to an empty list rather than
 * being absent, so "known but finished" and "not one of ours" stay different
 * answers. `pending` is a legal place to BE and never a legal destination,
 * which is why it is a key here but not in
 * {@link TRANSPORT_FULFILLMENT_DESTINATIONS}.
 */
const TRANSPORT_FULFILLMENT_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["scheduled", "in_transit", "cancelled"]),
  scheduled: Object.freeze(["in_transit", "cancelled"]),
  in_transit: Object.freeze(["delivered"]),
  delivered: Object.freeze([]),
  cancelled: Object.freeze([]),
});

/** The statuses a caller may ask for. Never `pending`. */
const TRANSPORT_FULFILLMENT_DESTINATIONS = Object.freeze([
  "scheduled",
  "in_transit",
  "delivered",
  "cancelled",
]);

/**
 * Whether this record went through the quote marketplace.
 *
 * The same test `firestore.rules` uses (`isLegacyTransportRecord`), inverted:
 * a record is legacy unless `flowVersion` is exactly 2.
 *
 * @param {object} requestData The transportRequests document data.
 * @return {boolean} True for a marketplace (flowVersion 2) record.
 */
function isMarketplaceTransportRecord(requestData) {
  return Number((requestData || {}).flowVersion || 1) === 2;
}

/**
 * The status the table is indexed by.
 *
 * `fulfillmentStatus` when it has one, `status` otherwise - JS truthiness, so
 * an EMPTY `fulfillmentStatus` falls through rather than reading as a job with
 * no status at all.
 *
 * @param {object} requestData The transportRequests document data.
 * @return {string} The current fulfilment status, verbatim.
 */
function transportFulfillmentCurrentStatus(requestData) {
  const row = requestData || {};
  return String(row.fulfillmentStatus || row.status || "");
}

/**
 * The legal next statuses, in the table's own order.
 *
 * An unrecognised status - `active`, `in_progress`, `completed`, `sold`,
 * `reserved`, `inactive`, anything else the admin path can write onto this
 * document - yields an empty list rather than a guess.
 *
 * @param {string} currentStatus Where the job is now.
 * @return {string[]} The statuses it may move to.
 */
function transportFulfillmentNextStatuses(currentStatus) {
  return TRANSPORT_FULFILLMENT_TRANSITIONS[currentStatus] || [];
}

/**
 * Whether moving to this status needs a container number.
 *
 * @param {string} nextStatus The requested destination.
 * @return {boolean} True when a container number is required.
 */
function transportFulfillmentRequiresContainer(nextStatus) {
  return nextStatus === "in_transit";
}

/**
 * Whether the caller's business owns this job, and why not.
 *
 * Marketplace: the business must be the one whose quote was selected, and the
 * record must actually be at the selected stage - a request still collecting
 * quotes has no carrier to move it.
 *
 * Legacy: the record's own `businessId`, which is the only ownership a legacy
 * record carries and the one `firestore.rules` already enforces.
 *
 * @param {object} requestData The transportRequests document data.
 * @param {string} businessId The caller's verified business id.
 * @return {?{code: string, message: string}} Null when the caller may proceed.
 */
function transportFulfillmentOwnershipError(requestData, businessId) {
  const row = requestData || {};
  const owner = String(businessId || "").trim();
  if (!owner) {
    return {
      code: "permission-denied",
      message: "Business transport manager access required",
    };
  }
  if (isMarketplaceTransportRecord(row)) {
    if (row.quoteStatus !== "selected") {
      return {
        code: "failed-precondition",
        message: "This is not a selected marketplace transport request",
      };
    }
    if (row.selectedBusinessId !== owner || row.businessId !== owner) {
      return {
        code: "permission-denied",
        message: "Only the selected transport business can update this request",
      };
    }
    return null;
  }
  // Legacy. No quote was ever selected, so `selectedBusinessId` does not exist
  // and requiring it would refuse every one of these records - which is the
  // bug that made the console write Firestore directly in the first place.
  if (String(row.businessId || "").trim() !== owner) {
    return {
      code: "permission-denied",
      message: "Only the assigned transport business can update this request",
    };
  }
  return null;
}

/**
 * The whole decision for one status change: ownership, transition, container.
 *
 * Identical for marketplace and legacy records apart from the ownership check,
 * which is the point - the transition table and the container gate are applied
 * once, to both.
 *
 * @param {object} params Decision inputs.
 * @param {object} params.requestData The transportRequests document data.
 * @param {string} params.businessId The caller's verified business id.
 * @param {string} params.nextStatus The requested destination status.
 * @param {*} params.submittedContainerNumber What the caller just sent, if any.
 * @return {{error: ?object, previousStatus: string, alreadyUpdated: boolean,
 *   containerNumber: string, containerChanged: boolean}} The outcome.
 */
function classifyTransportFulfillmentChange({
  requestData,
  businessId,
  nextStatus,
  submittedContainerNumber,
}) {
  const row = requestData || {};
  const status = String(nextStatus || "").trim().toLowerCase();
  const currentStatus = transportFulfillmentCurrentStatus(row);
  const refuse = (code, message, details) => ({
    error: {code, message, ...(details ? {details} : {})},
    previousStatus: currentStatus,
    alreadyUpdated: false,
    containerNumber: "",
    containerChanged: false,
  });

  if (!TRANSPORT_FULFILLMENT_DESTINATIONS.includes(status)) {
    return refuse("invalid-argument", "Transport status is invalid");
  }

  const ownership = transportFulfillmentOwnershipError(row, businessId);
  if (ownership) return refuse(ownership.code, ownership.message);

  // Two people tapping the same status is a success, not a refusal - and it
  // must not be mistaken for an illegal transition.
  if (currentStatus === status) {
    return {
      error: null,
      previousStatus: currentStatus,
      alreadyUpdated: true,
      containerNumber: "",
      containerChanged: false,
    };
  }

  if (!transportFulfillmentNextStatuses(currentStatus).includes(status)) {
    return refuse(
        "failed-precondition",
        `Transport cannot move from ${currentStatus} to ${status}`,
    );
  }

  // A car in transit is in a container, and the customer's next question is
  // always "where is it". Without an identifier there is nothing to answer
  // with and nothing to hand the carrier tracking API, so the number is
  // required at the moment the job starts moving - not left optional to be
  // filled in later, or never.
  const existingContainer = validateContainerNumber(row.containerNumber);
  const submittedContainer = validateContainerNumber(submittedContainerNumber);
  const containerNumber = submittedContainer || existingContainer;
  if (transportFulfillmentRequiresContainer(status) && !containerNumber) {
    return refuse(
        "failed-precondition",
        "Add the container number before marking this transport in transit",
        {reason: "container_number_required"},
    );
  }

  return {
    error: null,
    previousStatus: currentStatus,
    alreadyUpdated: false,
    containerNumber,
    containerChanged: Boolean(
        containerNumber && containerNumber !== existingContainer,
    ),
  };
}

module.exports = {
  TRANSPORT_FULFILLMENT_STATUSES,
  TRANSPORT_FULFILLMENT_TRANSITIONS,
  TRANSPORT_FULFILLMENT_DESTINATIONS,
  classifyTransportFulfillmentChange,
  isMarketplaceTransportRecord,
  transportFulfillmentCurrentStatus,
  transportFulfillmentNextStatuses,
  transportFulfillmentOwnershipError,
  transportFulfillmentRequiresContainer,
};

"use strict";

// Which business permission section gates staff writes for each trackable
// shipment collection - mirrors canManageBusinessSection's section names
// already used by BarrelsPanel/FreightPanel in the web console.
const TRACKING_SECTION_BY_COLLECTION = {
  barrelShipments: "barrels",
  freightShipments: "freight",
  // Cars move in containers on the same vessels, so a transport job gets the
  // same carrier tracking and milestone feed as a barrel or sea freight load.
  transportRequests: "transport",
};

function cleanText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

function validateMilestoneSubmission({label, description, location}) {
  const missing = [];
  const cleanLabel = cleanText(label, 120);
  if (!cleanLabel) missing.push("a short update label");
  return {
    missing,
    label: cleanLabel,
    description: cleanText(description, 500),
    location: cleanText(location, 160),
  };
}

function validateContainerNumber(value) {
  const cleaned = cleanText(value, 40).toUpperCase();
  return cleaned.length >= 4 ? cleaned : "";
}

// ISO 6346 container numbers are 4 letters (owner code) + 7 digits. Anything
// else (booking numbers, bills of lading) has no universal format, so it
// falls back to "bill_of_lading" - Terminal49's own docs use that as the
// general-purpose request type.
function inferRequestType(number) {
  const cleaned = cleanText(number, 40).toUpperCase();
  return /^[A-Z]{4}\d{7}$/.test(cleaned) ?
    "container_number" :
    "bill_of_lading";
}

// Terminal49's container.current_status values -> our own shipment status
// enum. `null` means "don't touch our status field" (e.g. a fresh tracking
// request that hasn't produced a real milestone yet).
const CONTAINER_STATUS_TO_SHIPMENT_STATUS = {
  new: null,
  on_ship: "in_transit",
  grounded: "in_transit",
  available: "ready_for_pickup",
  not_available: "in_transit",
  awaiting_inland_transfer: "in_transit",
  on_rail: "in_transit",
  off_dock: "in_transit",
  picked_up: "completed",
  delivered: "completed",
  empty_returned: "completed",
};

const CONTAINER_STATUS_LABEL = {
  new: "Tracking request received",
  on_ship: "Loaded on vessel",
  grounded: "Discharged at terminal",
  available: "Available for pickup",
  not_available: "Held at terminal",
  awaiting_inland_transfer: "Awaiting inland transfer",
  on_rail: "On rail",
  off_dock: "Left the terminal",
  picked_up: "Picked up",
  delivered: "Delivered",
  empty_returned: "Empty container returned",
};

// Builds the customer-visible milestone for a container's current_status, or
// null if the status is unrecognized (new statuses Terminal49 adds later
// fail closed instead of writing a garbled event).
function milestoneForContainerStatus(currentStatus) {
  const label = CONTAINER_STATUS_LABEL[currentStatus];
  if (!label) return null;
  return {
    label,
    shipmentStatus: CONTAINER_STATUS_TO_SHIPMENT_STATUS[currentStatus] || null,
  };
}

// Deterministic Firestore doc id so re-polling the same unchanged status
// never creates a duplicate trackingEvents entry. Firestore doc ids can't
// contain "/", which container numbers never do, but we strip defensively.
function carrierEventDocId(containerNumber, currentStatus) {
  const safeContainer = cleanText(containerNumber, 40)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  const safeStatus = cleanText(currentStatus, 60).replace(/[^a-z0-9_]/g, "");
  return `carrier_${safeContainer}_${safeStatus}`;
}

// Parses a Terminal49 POST /tracking_requests JSON:API response into the
// fields we persist on the shipment doc.
function parseTrackingRequestResponse(json) {
  const data = json && json.data;
  if (!data || typeof data !== "object") return null;
  const attributes = data.attributes || {};
  const trackedObject =
    (data.relationships &&
      data.relationships.tracked_object &&
      data.relationships.tracked_object.data) ||
    null;
  return {
    id: cleanText(data.id, 100),
    status: cleanText(attributes.status, 40),
    failedReason: cleanText(attributes.failed_reason, 500),
    trackedObjectId: trackedObject ? cleanText(trackedObject.id, 100) : "",
    trackedObjectType: trackedObject ? cleanText(trackedObject.type, 40) : "",
  };
}

// Parses a Terminal49 GET /shipments/{id}?include=containers JSON:API
// response into a flat list of {id, number, currentStatus}.
function parseContainersFromIncluded(json) {
  const included = Array.isArray(json && json.included) ? json.included : [];
  return included
      .filter((item) => item && item.type === "container")
      .map((item) => {
        const attributes = item.attributes || {};
        return {
          id: cleanText(item.id, 100),
          number: cleanText(attributes.number, 40).toUpperCase(),
          currentStatus: cleanText(attributes.current_status, 60),
        };
      })
      .filter((container) => container.number && container.currentStatus);
}

module.exports = {
  TRACKING_SECTION_BY_COLLECTION,
  cleanText,
  validateMilestoneSubmission,
  validateContainerNumber,
  inferRequestType,
  CONTAINER_STATUS_TO_SHIPMENT_STATUS,
  CONTAINER_STATUS_LABEL,
  milestoneForContainerStatus,
  carrierEventDocId,
  parseTrackingRequestResponse,
  parseContainersFromIncluded,
};

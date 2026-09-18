"use strict";

/**
 * Containers - what a business loaded into a shipping box, recorded by the
 * business itself rather than assembled from customer requests.
 *
 * The pure half: validation, the state machine, and the rules the loading
 * list lives by. Every Firestore and Stripe call stays with the caller in
 * `index.js`, as `lot_ledger.js` does. The console's `container-manifest.ts`
 * and the app's `container_manifest.dart` are deliberate mirrors of this file;
 * a rule that changes here changes there.
 *
 * A container starts as a working name ("Sailing 3 Oct, box 2") because the
 * shipping line sends the number after the box is half full; the number is
 * added when known and is checked against ISO 6346 so it can be tracked
 * later. A line is a car (VIN first), barrels (a count, per customer), or
 * anything else (a description and a quantity). Every line says whose it is:
 * a customer, or the business's own stock - a car bought to sell abroad has
 * no customer and must not be made to invent one.
 *
 * Money is deliberately absent. What a customer owes for a car in a box is a
 * ledger activity; a line here says only that the car went.
 */

const CONTAINER_STATUS = Object.freeze({
  LOADING: "loading",
  SHIPPED: "shipped",
  ARRIVED: "arrived",
});
const CONTAINER_STATUSES = Object.freeze(Object.values(CONTAINER_STATUS));

const CONTAINER_LINE_KINDS = Object.freeze(["car", "barrels", "other"]);
const CONTAINER_OWNER_KINDS = Object.freeze(["customer", "stock"]);

// ISO 6346: four letters (owner code) and seven digits. Booking numbers and
// bills of lading have no universal shape, so they live in their own field
// and are never mistaken for a container number.
const ISO_CONTAINER_NUMBER = /^[A-Z]{4}\d{7}$/;

const MAX_TEXT = 200;
const MAX_LABEL = 120;
const MAX_NOTE = 500;
const MAX_VIN = 17;
const MIN_VIN = 6;
const MAX_QUANTITY = 999;

const text = (value, max = MAX_TEXT) =>
  String(value ?? "").trim().slice(0, max);
const positiveInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

// -------------------------------------------------------------------------
// The container.
// -------------------------------------------------------------------------

/**
 * @param {object} input Raw callable data.
 * @return {string[]} Error codes, every problem at once.
 */
function validateContainer(input) {
  const errors = [];
  if (!text(input?.label, MAX_LABEL)) errors.push("container_label_required");
  const number = text(input?.containerNumber, 20).toUpperCase();
  if (number && !ISO_CONTAINER_NUMBER.test(number)) {
    errors.push("container_number_invalid");
  }
  return errors;
}

/**
 * @param {object} input Validated callable data.
 * @return {object} The fields a business may set on a container.
 */
function containerRecord(input) {
  return {
    label: text(input.label, MAX_LABEL),
    containerNumber: text(input.containerNumber, 20).toUpperCase(),
    bookingReference: text(input.bookingReference, 60).toUpperCase(),
    destinationCountryId: text(input.destinationCountryId, 60),
    destinationCountryName: text(input.destinationCountryName, MAX_LABEL),
    notes: text(input.notes, MAX_NOTE),
  };
}

/**
 * Whether the container may move from its current state to the next one.
 * Forward only: a shipped box does not come back to the yard, and an arrived
 * one is closed. Shipping needs a destination and something on board - a
 * box that sailed empty to nowhere is a mistake, not a record.
 *
 * @param {object} current The stored container.
 * @param {string} nextStatus The requested status.
 * @param {number} lineCount Lines on the container.
 * @return {string|null} A refusal code, or null when allowed.
 */
function containerTransitionRefusal(current, nextStatus, lineCount) {
  const row = current && typeof current === "object" ? current : {};
  const from = text(row.status, 20) || CONTAINER_STATUS.LOADING;
  const to = text(nextStatus, 20);
  if (!CONTAINER_STATUSES.includes(to)) {
    return "container_status_invalid";
  }
  if (from === CONTAINER_STATUS.LOADING && to === CONTAINER_STATUS.SHIPPED) {
    if (!text(row.destinationCountryId, 60)) return "destination_required";
    if (positiveInt(lineCount) <= 0) return "container_empty";
    return null;
  }
  if (from === CONTAINER_STATUS.SHIPPED && to === CONTAINER_STATUS.ARRIVED) {
    return null;
  }
  return "container_transition_invalid";
}

/**
 * Which fields an edit may still change. Once shipped, the list and its
 * identity are the record of what was declared; only the notes stay open, so
 * a correction after sailing is written beside the record, not into it.
 *
 * @param {object} current The stored container.
 * @return {boolean} True when structural fields may change.
 */
function containerIsOpen(current) {
  const row = current && typeof current === "object" ? current : {};
  return (text(row.status, 20) || CONTAINER_STATUS.LOADING) ===
    CONTAINER_STATUS.LOADING;
}

/**
 * @param {object} current The stored container.
 * @param {number} lineCount Lines on it.
 * @return {string|null} Why it cannot be deleted, or null.
 */
function containerDeleteRefusal(current, lineCount) {
  if (!containerIsOpen(current)) return "container_locked";
  if (positiveInt(lineCount) > 0) return "container_has_lines";
  return null;
}

// -------------------------------------------------------------------------
// A line on the list.
// -------------------------------------------------------------------------

/**
 * @param {object} input Raw callable data.
 * @return {string[]} Error codes.
 */
function validateContainerLine(input) {
  const errors = [];
  const kind = text(input?.kind, 20);
  if (!CONTAINER_LINE_KINDS.includes(kind)) errors.push("line_kind_invalid");

  if (kind === "car") {
    const vin = text(input?.vinNumber, MAX_VIN).toUpperCase();
    if (vin.length < MIN_VIN) errors.push("vin_required");
  } else if (kind === "barrels") {
    if (positiveInt(input?.quantity) <= 0) errors.push("quantity_required");
  } else if (kind === "other") {
    if (!text(input?.description, MAX_LABEL)) {
      errors.push("description_required");
    }
    if (positiveInt(input?.quantity) <= 0) errors.push("quantity_required");
  }

  const owner = text(input?.ownerKind, 20);
  if (!CONTAINER_OWNER_KINDS.includes(owner)) {
    errors.push("owner_kind_invalid");
  }
  // A customer's line has to say who; the business's own stock has no one to
  // name, and asking for a name there is how fictional customers get typed.
  if (owner === "customer" && !text(input?.customerName, MAX_LABEL)) {
    errors.push("customer_name_required");
  }
  return errors;
}

/**
 * @param {object} input Validated callable data.
 * @param {object} opts { containerId, containerStatus, addedByStaffId }.
 * @return {object} The line body.
 */
function containerLineRecord(input, opts = {}) {
  const kind = text(input.kind, 20);
  const owner = text(input.ownerKind, 20);
  const isCar = kind === "car";
  const customer = owner === "customer";
  return {
    containerId: text(opts.containerId, MAX_LABEL),
    // Denormalised so "is this car already on an open container" is one
    // query on lines, not a read of every container.
    containerStatus:
      text(opts.containerStatus, 20) || CONTAINER_STATUS.LOADING,
    kind,
    vinNumber: isCar ? text(input.vinNumber, MAX_VIN).toUpperCase() : "",
    carMake: isCar ? text(input.carMake, 80) : "",
    carModel: isCar ? text(input.carModel, 80) : "",
    carYear: isCar ? text(input.carYear, 8) : "",
    quantity: isCar ? 1 : Math.min(MAX_QUANTITY, positiveInt(input.quantity)),
    description: kind === "other" ? text(input.description, MAX_LABEL) : "",
    ownerKind: owner,
    customerName: customer ? text(input.customerName, MAX_LABEL) : "",
    customerPhone: customer ? text(input.customerPhone, 40) : "",
    addedByStaffId: text(opts.addedByStaffId, MAX_LABEL),
  };
}

/**
 * The open container already holding this VIN, if any. A car on two loading
 * lists is a mistake every time; the caller refuses and names the container.
 *
 * @param {object[]} lines Existing lines for the business with this VIN.
 * @param {string} [ignoreContainerId] The container being added to (a move
 *   from it is fine).
 * @return {string} The conflicting container id, or "".
 */
function openContainerHoldingVin(lines, ignoreContainerId = "") {
  for (const line of Array.isArray(lines) ? lines : []) {
    const row = line && typeof line === "object" ? line : {};
    if (text(row.kind, 20) !== "car") continue;
    if (text(row.containerStatus, 20) === CONTAINER_STATUS.ARRIVED) continue;
    const id = text(row.containerId, MAX_LABEL);
    if (id && id !== text(ignoreContainerId, MAX_LABEL)) return id;
  }
  return "";
}

/**
 * The summary a container carries so a list of them can be scanned without
 * loading every line. Barrels count by quantity; cars and other by line.
 *
 * @param {object[]} lines The container's lines.
 * @return {{lineCount: number, carCount: number, barrelCount: number,
 *   otherCount: number}} The tallies.
 */
function containerCounts(lines) {
  const out = {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0};
  for (const line of Array.isArray(lines) ? lines : []) {
    const row = line && typeof line === "object" ? line : {};
    out.lineCount += 1;
    const kind = text(row.kind, 20);
    if (kind === "car") out.carCount += 1;
    else if (kind === "barrels") out.barrelCount += positiveInt(row.quantity);
    else out.otherCount += positiveInt(row.quantity) || 1;
  }
  return out;
}

const CONTAINER_MESSAGES = Object.freeze({
  container_label_required: "Give the container a name to find it by.",
  container_number_invalid:
    "A container number is four letters and seven digits, like MSKU1234567. " +
    "Booking numbers and bills of lading go in the reference field.",
  container_status_invalid: "That is not a state a container can be in.",
  container_transition_invalid:
    "A container only moves forward: loading, then shipped, then arrived.",
  destination_required: "Choose where this container is going before it ships.",
  container_empty: "Nothing is on this container yet, so it can't ship.",
  container_locked:
    "This container has shipped. Its list is the record of what went; add a " +
    "note instead of changing it.",
  container_has_lines:
    "This container has lines on it. Remove them first, or leave it.",
  container_not_found: "Container not found.",
  line_not_found: "That line is no longer on the container.",
  line_kind_invalid:
    "Say what this line is: a car, barrels, or something else.",
  vin_required: "Enter the VIN.",
  quantity_required: "Enter how many.",
  description_required: "Say what it is.",
  owner_kind_invalid: "Say whose this is: a customer, or your own stock.",
  customer_name_required: "Enter the customer's name.",
  vin_already_loaded:
    "This car is already on another container that hasn't arrived.",
  move_target_not_loading:
    "You can only move a line to a container that is still loading.",
});

module.exports = {
  CONTAINER_STATUS,
  CONTAINER_STATUSES,
  CONTAINER_LINE_KINDS,
  CONTAINER_OWNER_KINDS,
  ISO_CONTAINER_NUMBER,
  CONTAINER_MESSAGES,
  validateContainer,
  containerRecord,
  containerTransitionRefusal,
  containerIsOpen,
  containerDeleteRefusal,
  validateContainerLine,
  containerLineRecord,
  openContainerHoldingVin,
  containerCounts,
};

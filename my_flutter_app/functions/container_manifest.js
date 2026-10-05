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

// Formatting a person typed is theirs to type and ours to drop.
const PHONE_FORMATTING = /[\s().-]/g;
// The full international form, +<country code><number>. WhatsApp can only
// reach a number written this way; a local "622 11 22 33" is a number for a
// person to dial, not one a message can be sent to.
const INTERNATIONAL_PHONE = /^\+[1-9]\d{7,14}$/;

const text = (value, max = MAX_TEXT) =>
  String(value ?? "").trim().slice(0, max);
/**
 * A phone as stored: formatting dropped, the leading plus kept. Anything that
 * is not 7-15 digits is returned as typed so the validator can name it.
 *
 * @param {*} value Raw input.
 * @return {string} The stored form.
 */
const phone = (value) => {
  const raw = text(value, 40);
  const compact = raw.replace(PHONE_FORMATTING, "");
  return /^\+?\d{7,15}$/.test(compact) ? compact : raw;
};

/**
 * @param {*} value A stored or typed phone.
 * @return {boolean} Whether it is a reachable international number.
 */
function isInternationalPhone(value) {
  return INTERNATIONAL_PHONE.test(phone(value));
}

/**
 * Empty is fine (nobody to reach); anything else must look like a phone.
 * Local numbers are still accepted - older app versions send them - but only
 * an international one can be messaged, and the form says so.
 *
 * @param {*} value Raw input.
 * @return {boolean} Whether it may be stored.
 */
function phoneAcceptable(value) {
  const stored = phone(value);
  if (!stored) return true;
  return /^\+?\d{7,15}$/.test(stored);
}

/**
 * A switch that is on unless it was explicitly turned off.
 *
 * @param {*} value Raw input.
 * @return {boolean} The switch.
 */
const onUnlessOff = (value) => value !== false && value !== "false";

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
  const number = text(input?.containerNumber, 20).toUpperCase();
  // The working name is for the box that has no number yet. Once the
  // shipping line has given a container or booking number, that is what
  // everyone calls it, and inventing a name on top is a chore.
  if (!text(input?.label, MAX_LABEL) && !number &&
      !text(input?.bookingReference, 60)) {
    errors.push("container_label_required");
  }
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
  errors.push(...contactPhoneErrors(input, owner));
  return errors;
}

/**
 * @param {object} input Raw contact fields.
 * @param {string} owner The line's owner kind.
 * @return {string[]} Phone error codes.
 */
function contactPhoneErrors(input, owner) {
  const errors = [];
  if (owner === "customer" && !phoneAcceptable(input?.customerPhone)) {
    errors.push("customer_phone_invalid");
  }
  if (!phoneAcceptable(input?.receiverPhone)) {
    errors.push("receiver_phone_invalid");
  }
  return errors;
}

/**
 * The contact half of a line: who it belongs to, who collects it, and
 * whether each of them hears about it. Shared by adding a line and by
 * correcting its contacts later.
 *
 * @param {object} input Raw contact fields.
 * @param {string} owner The line's owner kind.
 * @return {object} The contact fields as stored.
 */
function containerLineContacts(input, owner) {
  const customer = owner === "customer";
  const customerPhone = customer ? phone(input.customerPhone) : "";
  const receiverPhone = phone(input.receiverPhone);
  return {
    customerName: customer ? text(input.customerName, MAX_LABEL) : "",
    customerPhone,
    // Who collects it at the other end - the name written on the barrel.
    // Usually not the customer who handed it in here, sometimes nobody
    // named yet; either owner kind may have one (stock goes to an agent).
    receiverName: text(input.receiverName, MAX_LABEL),
    receiverPhone,
    // Both people hear about the shipment unless staff switch one off.
    // There is nobody to tell without a number, so the switch follows it.
    notifyCustomer: Boolean(customerPhone) && onUnlessOff(input.notifyCustomer),
    notifyReceiver: Boolean(receiverPhone) && onUnlessOff(input.notifyReceiver),
  };
}

/**
 * Checks a contact correction against the line it changes. Names and phones
 * may be corrected at any point - a wrong number is useless after sailing
 * too - but a customer's line keeps a customer name.
 *
 * @param {object} input Raw contact fields.
 * @param {object} current The stored line.
 * @return {string[]} Error codes.
 */
function validateContainerLineContacts(input, current) {
  const owner = text(current?.ownerKind, 20);
  const merged = {...(current || {}), ...(input || {})};
  const errors = [];
  if (owner === "customer" && !text(merged.customerName, MAX_LABEL)) {
    errors.push("customer_name_required");
  }
  errors.push(...contactPhoneErrors(merged, owner));
  return errors;
}

/**
 * @param {object} input Validated contact fields.
 * @param {object} current The stored line.
 * @return {object} The contact fields to write.
 */
function containerLineContactsUpdate(input, current) {
  const owner = text(current?.ownerKind, 20);
  return containerLineContacts({...(current || {}), ...(input || {})}, owner);
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
    ...containerLineContacts(input, owner),
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

/**
 * What one line adds to (sign 1) or takes from (sign -1) its container's
 * tallies, so adding, removing or moving a line is an increment rather than a
 * re-read of every line on the box. Only the non-zero keys are returned.
 *
 * @param {object} line The line.
 * @param {number} sign 1 or -1.
 * @return {object} e.g. {lineCount: 1, barrelCount: 3}.
 */
function containerCountsDelta(line, sign = 1) {
  const step = sign < 0 ? -1 : 1;
  const out = {};
  for (const [key, value] of Object.entries(containerCounts([line]))) {
    if (value) out[key] = value * step;
  }
  return out;
}

// -------------------------------------------------------------------------
// Server-side bookkeeping: the VIN lock, first-write-wins fields, and the
// repair of a status change that only half landed. Not mirrored on the
// clients - they never write these.
// -------------------------------------------------------------------------

/**
 * The one document every add of a VIN must take inside its transaction, so
 * two quick adds of the same car cannot both pass a "not loaded yet" query.
 *
 * @param {string} businessId The business.
 * @param {string} vin The VIN as typed.
 * @return {string} A Firestore document id, or "" when either is empty.
 */
function containerVinLockId(businessId, vin) {
  const business = text(businessId, MAX_LABEL).replace(/[^A-Za-z0-9_-]/g, "");
  const car = text(vin, MAX_VIN).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return business && car ? `${business}_${car}` : "";
}

/**
 * Whether a VIN lock still holds, judged by the line it names rather than by
 * the lock alone: a lock whose line was removed, re-used for another VIN, or
 * whose container arrived is stale and may be taken over. So a release that
 * never happened (a crash, a line removed before locks existed) can never
 * block a car for good.
 *
 * @param {object|null} lock The containerVinLocks document.
 * @param {object|null} line The line the lock names, or null if gone.
 * @return {string} The container holding the car, or "" when free.
 */
function vinLockHolder(lock, line) {
  if (!lock || typeof lock !== "object") return "";
  if (!line || typeof line !== "object") return "";
  const lockVin = text(lock.vinNumber, MAX_VIN).toUpperCase();
  if (text(line.vinNumber, MAX_VIN).toUpperCase() !== lockVin) return "";
  if (text(line.businessId, MAX_LABEL) !== text(lock.businessId, MAX_LABEL)) {
    return "";
  }
  return openContainerHoldingVin([line]);
}

/**
 * First write wins: a value already stored is kept and returned; only an
 * empty field takes the candidate. Read inside a transaction, this is what
 * stops two callers giving one line two tracking codes, or one container two
 * document tokens.
 *
 * @param {*} current The stored value.
 * @param {string} candidate The value to store if nothing is.
 * @return {{value: string, write: boolean}} The value to use, and whether it
 *   must be written.
 */
function keepExisting(current, candidate) {
  const stored = text(current, 200);
  if (stored) return {value: stored, write: false};
  return {value: text(candidate, 200), write: true};
}

/**
 * Asking for the status a container already has is a repair, not a mistake:
 * an earlier attempt may have moved the container and failed before its
 * lines, its codes, or its timeline moment were written.
 *
 * @param {object} current The stored container.
 * @param {string} nextStatus The requested status.
 * @return {boolean} True when the request repeats a status already reached.
 */
function containerStatusIsRepeat(current, nextStatus) {
  const from = text(current?.status, 20) || CONTAINER_STATUS.LOADING;
  const to = text(nextStatus, 20);
  return from === to && to !== CONTAINER_STATUS.LOADING &&
    CONTAINER_STATUSES.includes(to);
}

/**
 * @param {object[]} lines The container's lines.
 * @param {string} status The container's status.
 * @return {boolean} Whether any line has not caught up: a different status,
 *   or no tracking code.
 */
function linesLagStatus(lines, status) {
  return (Array.isArray(lines) ? lines : []).some((line) => {
    const row = line && typeof line === "object" ? line : {};
    return text(row.containerStatus, 20) !== text(status, 20) ||
      !text(row.trackingCode, 40);
  });
}

/**
 * Splits a list into groups, for batches (500 writes at most) and for a few
 * lines worked on at once instead of one after another.
 *
 * @param {Array} items The list.
 * @param {number} size The most per group.
 * @return {Array[]} The groups, in order.
 */
function inGroups(items, size) {
  const list = Array.isArray(items) ? items : [];
  const step = Math.max(1, Math.floor(Number(size) || 1));
  const out = [];
  for (let i = 0; i < list.length; i += step) out.push(list.slice(i, i + step));
  return out;
}

const CONTAINER_MESSAGES = Object.freeze({
  container_label_required:
    "Give the container a working name, or its container or booking number.",
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
  customer_phone_invalid:
    "The customer's phone doesn't look like a phone number.",
  receiver_phone_invalid:
    "The receiver's phone doesn't look like a phone number.",
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
  validateContainerLineContacts,
  containerLineContactsUpdate,
  isInternationalPhone,
  openContainerHoldingVin,
  containerCounts,
  containerCountsDelta,
  containerVinLockId,
  vinLockHolder,
  keepExisting,
  containerStatusIsRepeat,
  linesLagStatus,
  inGroups,
};

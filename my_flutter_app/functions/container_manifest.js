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
 * A line can also exist before any container does: a package dropped off at
 * the counter waits (`containerId: ""`, `containerStatus: "waiting"`) and is
 * added to a container later, once staff know which one. It keeps its code,
 * its label and its VIN lock through the wait. Each line names where it is
 * going, and a line only ever rides a container going to the same place.
 *
 * The price of a package and what has been paid for it live in
 * `container_payments.js`; a line here carries the numbers, not the rules of
 * paying. What a customer owes for a car bought through the business is still
 * a ledger activity.
 */

const {
  paidCentsOf,
  priceErrors,
  linePriceRecord,
} = require("./container_payments");

const CONTAINER_STATUS = Object.freeze({
  LOADING: "loading",
  SHIPPED: "shipped",
  ARRIVED: "arrived",
});
const CONTAINER_STATUSES = Object.freeze(Object.values(CONTAINER_STATUS));

// A line that has no container yet. It is a state of the line, not of a
// container, so it stays out of CONTAINER_STATUSES: nothing may ship "waiting".
const LINE_STATUS_WAITING = "waiting";
// What a VIN conflict names when the car is held by a waiting line rather than
// by a container. Container ids are Firestore auto ids, never this word.
const WAITING_HOLDER = "waiting";
const MAX_LINE_IDS = 100;
// Inches. A 40 ft container is 480 in long; anything bigger is a typo.
const MAX_DIMENSION_IN = 600;

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
 * @param {number} [paidCents] What the stored line has had paid, read by the
 *   server - never taken from the request.
 * @return {string[]} Error codes.
 */
function validateContainerLine(input, paidCents = 0) {
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
  errors.push(...sizeErrors(input));
  errors.push(...priceErrors(input?.priceCents, paidCents));
  return errors;
}

/**
 * One side of a package, in inches.
 *
 * @param {*} value Raw input.
 * @return {boolean} Whether anything was typed.
 */
const dimensionGiven = (value) =>
  value !== null && value !== undefined && String(value).trim() !== "";

/**
 * @param {*} value Raw input.
 * @return {number|null} Inches to two decimals, or null when empty or not a
 *   usable length (the validator names that case).
 */
function dimensionOf(value) {
  if (!dimensionGiven(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_DIMENSION_IN) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Size is length x width x height or nothing: two sides of a box cannot be
 * turned into a volume or printed on a label.
 *
 * @param {object} input Raw line fields.
 * @return {string[]} Error codes.
 */
function sizeErrors(input) {
  const sides = [input?.lengthIn, input?.widthIn, input?.heightIn];
  if (!sides.some(dimensionGiven)) return [];
  return sides.every((side) => dimensionOf(side) !== null) ?
    [] : ["size_invalid"];
}

/**
 * @param {object} line A stored or requested line.
 * @return {number|null} Cubic feet (inches cubed over 1728) to two decimals,
 *   or null when the size is not complete.
 */
function lineVolumeCubicFeet(line) {
  const row = line && typeof line === "object" ? line : {};
  const sides = [row.lengthIn, row.widthIn, row.heightIn].map(dimensionOf);
  if (sides.some((side) => side === null)) return null;
  return Math.round(sides[0] * sides[1] * sides[2] / 1728 * 100) / 100;
}

/**
 * @param {object} line A stored or requested line.
 * @return {string} "40 × 30 × 20 in", or "" when the size is not complete.
 */
function lineSizeText(line) {
  const row = line && typeof line === "object" ? line : {};
  const sides = [row.lengthIn, row.widthIn, row.heightIn].map(dimensionOf);
  if (sides.some((side) => side === null)) return "";
  return `${sides.join(" × ")} in`;
}

/**
 * A package dropped off before any container is chosen. Everything a line
 * needs, plus the two things a waiting package cannot do without: a
 * customer (stock is not "dropped off") and a destination, because the
 * destination is what decides which containers it may go in.
 *
 * @param {object} input Raw callable data.
 * @return {string[]} Error codes, every problem at once.
 */
function validateWaitingPackage(input) {
  const errors = validateContainerLine(input);
  if (CONTAINER_OWNER_KINDS.includes(text(input?.ownerKind, 20)) &&
      text(input?.ownerKind, 20) !== "customer") {
    errors.push("owner_kind_invalid");
  }
  if (!text(input?.destinationCountryId, 60)) {
    errors.push("package_destination_required");
  }
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
    // Where it is going. A line only rides a container going to the same
    // place (destinationMismatch); older lines carry none and ride anywhere.
    destinationCountryId: text(input.destinationCountryId, 60),
    destinationCountryName: text(input.destinationCountryName, MAX_LABEL),
    lengthIn: dimensionOf(input.lengthIn),
    widthIn: dimensionOf(input.widthIn),
    heightIn: dimensionOf(input.heightIn),
    ...linePriceRecord(input),
    // What has been paid is the server's to keep (the sum of the payments
    // that were not reverted), never something a request can set.
    paidCents: 0,
    addedByStaffId: text(opts.addedByStaffId, MAX_LABEL),
  };
}

/**
 * The open container already holding this VIN, if any. A car on two loading
 * lists is a mistake every time; the caller refuses and names the container.
 * A car waiting for a container holds its VIN just the same, and is named
 * WAITING_HOLDER since there is no container to name.
 *
 * @param {object[]} lines Existing lines for the business with this VIN.
 * @param {string} [ignoreContainerId] The container being added to (a move
 *   from it is fine).
 * @return {string} The conflicting container id (or WAITING_HOLDER), or "".
 */
function openContainerHoldingVin(lines, ignoreContainerId = "") {
  for (const line of Array.isArray(lines) ? lines : []) {
    const row = line && typeof line === "object" ? line : {};
    if (text(row.kind, 20) !== "car") continue;
    if (text(row.containerStatus, 20) === CONTAINER_STATUS.ARRIVED) continue;
    const id = text(row.containerId, MAX_LABEL);
    if (!id && lineIsWaiting(row)) return WAITING_HOLDER;
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

/**
 * @param {object} line A stored line.
 * @return {boolean} Whether it was dropped off and has no container yet.
 */
function lineIsWaiting(line) {
  const row = line && typeof line === "object" ? line : {};
  return text(row.containerStatus, 20) === LINE_STATUS_WAITING &&
    !text(row.containerId, MAX_LABEL);
}

/**
 * Whether a line may ride a container: both must be going to the same
 * place. A line that never named a destination (loaded before they existed)
 * rides anywhere; a line that did needs a container that has decided too.
 *
 * @param {object} line The line, stored or as it would become.
 * @param {object} container The container.
 * @return {string|null} A refusal code, or null when allowed.
 */
function destinationMismatch(line, container) {
  const wanted = text(line?.destinationCountryId, 60);
  if (!wanted) return null;
  const going = text(container?.destinationCountryId, 60);
  if (!going) return "container_destination_required";
  return going === wanted ? null : "destination_mismatch";
}

/**
 * @param {*} lineIds Raw ids from a callable.
 * @return {{ids: string[], errors: string[]}} The distinct ids, in order,
 *   and `line_ids_invalid` when there are none, too many, or a non-text one.
 */
function cleanLineIds(lineIds) {
  const raw = Array.isArray(lineIds) ? lineIds : [];
  const ids = [...new Set(raw.map((id) => text(id, MAX_LABEL)))]
      .filter(Boolean);
  const bad = raw.length === 0 || ids.length === 0 ||
    raw.length > MAX_LINE_IDS || raw.some((id) => typeof id !== "string" ||
      !text(id, MAX_LABEL));
  return {ids: bad ? [] : ids, errors: bad ? ["line_ids_invalid"] : []};
}

/**
 * Whether a set of waiting lines may go onto a container, all or none. The
 * first thing wrong, by how basic it is, wins, and every line that has it is
 * named so the screen can mark each row.
 *
 * @param {object} container The container.
 * @param {object[]} entries The requested lines as read, {id, line}, line
 *   null when gone, in the order asked.
 * @param {string} businessId The business asking.
 * @return {object|null} The refusal {code, lineIds}, or null.
 */
function containerAssignRefusal(container, entries, businessId) {
  if (!containerIsOpen(container)) {
    return {code: "container_locked", lineIds: []};
  }
  const rows = (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: text(entry?.id, MAX_LABEL),
    line: entry?.line && typeof entry.line === "object" ? entry.line : null,
  }));
  const named = (pick) => rows.filter(pick).map((row) => row.id);
  const gone = named(({line}) =>
    !line || text(line.businessId, MAX_LABEL) !== text(businessId, MAX_LABEL));
  if (gone.length > 0) return {code: "line_not_found", lineIds: gone};
  const notWaiting = named(({line}) => !lineIsWaiting(line));
  if (notWaiting.length > 0) {
    return {code: "line_not_waiting", lineIds: notWaiting};
  }
  const refusals = rows.map((row) => ({
    id: row.id, code: destinationMismatch(row.line, container)}));
  for (const code of ["container_destination_required",
    "destination_mismatch"]) {
    const ids = refusals.filter((r) => r.code === code).map((r) => r.id);
    if (ids.length > 0) return {code, lineIds: ids};
  }
  return null;
}

/**
 * What many lines add to (sign 1) or take from (sign -1) one container's
 * tallies, summed so a whole batch is one increment.
 *
 * @param {object[]} lines The lines.
 * @param {number} sign 1 or -1.
 * @return {object} e.g. {lineCount: 3, barrelCount: 8}; non-zero keys only.
 */
function containerLinesCountsDelta(lines, sign = 1) {
  const out = {};
  for (const line of Array.isArray(lines) ? lines : []) {
    for (const [key, value] of Object.entries(
        containerCountsDelta(line, sign))) {
      out[key] = (out[key] || 0) + value;
    }
  }
  for (const key of Object.keys(out)) if (!out[key]) delete out[key];
  return out;
}

// -------------------------------------------------------------------------
// Editing a line after it was added.
//
// A line has two halves. Its contacts - who it belongs to by name and phone,
// who collects it, who hears about it - stay correctable in every state: a
// wrong number matters most once the box has sailed. What the line IS - its
// kind, the car, the count, the description, and whether it is a customer's
// or the business's own - is the record of what went, so it changes only
// while the container is still loading, like adding, moving or removing a
// line. One rule set serves both the full edit and the contacts-only one.
// -------------------------------------------------------------------------

const LINE_CONTACT_FIELDS = Object.freeze([
  "customerName", "customerPhone", "receiverName", "receiverPhone",
  "notifyCustomer", "notifyReceiver",
]);
// What the line IS, including where it goes and how big it is. Editable while
// it waits and while its container is loading.
const LINE_SUBSTANCE_FIELDS = Object.freeze([
  "kind", "vinNumber", "carMake", "carModel", "carYear", "quantity",
  "description", "ownerKind", "destinationCountryId",
  "destinationCountryName", "lengthIn", "widthIn", "heightIn",
]);
// What the customer owes. Correctable in every state, like the contacts: a
// price is agreed or changed after the box has sailed as often as before.
const LINE_PRICE_FIELDS = Object.freeze(["priceCents", "payOnArrival"]);
const LINE_EDIT_FIELDS = Object.freeze(
    [...LINE_SUBSTANCE_FIELDS, ...LINE_PRICE_FIELDS, ...LINE_CONTACT_FIELDS]);

// How the history names a field, instead of its Firestore key.
const CONTACT_FIELD_LABELS = Object.freeze({
  customerName: "customer's name",
  customerPhone: "customer's phone",
  receiverName: "receiver's name",
  receiverPhone: "receiver's phone",
  notifyCustomer: "customer's WhatsApp updates",
  notifyReceiver: "receiver's WhatsApp updates",
});
const LINE_FIELD_LABELS = Object.freeze({
  kind: "kind",
  vinNumber: "VIN",
  carMake: "make",
  carModel: "model",
  carYear: "year",
  quantity: "quantity",
  description: "description",
  ownerKind: "owner",
  destinationCountryId: "destination",
  destinationCountryName: "destination",
  lengthIn: "size",
  widthIn: "size",
  heightIn: "size",
  priceCents: "price",
  payOnArrival: "pay on arrival",
  ...CONTACT_FIELD_LABELS,
});

/**
 * "1 barrel", "3 barrels" - the history reads like a sentence.
 *
 * @param {*} quantity The count.
 * @return {string} The phrase.
 */
function barrelsLabel(quantity) {
  const n = Number(quantity) || 0;
  return `${n} barrel${n === 1 ? "" : "s"}`;
}

/**
 * What a line is, as the history says it: "car 1HG…", "3 barrels",
 * "2 × tires".
 *
 * @param {object} line The line.
 * @return {string} The phrase.
 */
function containerLineWhat(line) {
  const row = line && typeof line === "object" ? line : {};
  const kind = text(row.kind, 20);
  if (kind === "car") {
    return `car ${text(row.vinNumber, MAX_VIN).toUpperCase()}`;
  }
  if (kind === "barrels") return barrelsLabel(positiveInt(row.quantity));
  return `${positiveInt(row.quantity)} × ${text(row.description, MAX_LABEL)}`;
}

/**
 * The editable fields of a line as the server would store them, so a stored
 * line and a requested one compare like for like (a legacy line with no
 * WhatsApp switch reads as switched on, a car always counts one).
 *
 * @param {object} line A stored or requested line.
 * @return {object} The editable fields.
 */
function containerLineEditable(line) {
  const record = containerLineRecord(line && typeof line === "object" ?
    line : {});
  const out = {};
  for (const key of LINE_EDIT_FIELDS) out[key] = record[key];
  return out;
}

/**
 * What a requested edit would make the line. In contacts-only mode only the
 * contact half is taken from the request, against the line's own owner kind;
 * otherwise the request is a whole line, any field it leaves out kept from
 * the stored one.
 *
 * @param {object} current The stored line.
 * @param {object} input The requested line, or contacts.
 * @param {boolean} contactsOnly Whether only contacts may change.
 * @return {object} The editable fields after the edit.
 */
function containerLineEditTarget(current, input, contactsOnly) {
  const row = current && typeof current === "object" ? current : {};
  const asked = input && typeof input === "object" ? input : {};
  if (contactsOnly) {
    return {
      ...containerLineEditable(row),
      ...containerLineContactsUpdate(asked, row),
    };
  }
  return containerLineEditable({...row, ...asked});
}

/**
 * Error codes for a requested edit, every problem at once: the contacts
 * rules for a contacts-only edit, the whole-line rules otherwise.
 *
 * @param {object} current The stored line.
 * @param {object} input The requested line, or contacts.
 * @param {boolean} contactsOnly Whether only contacts may change.
 * @return {string[]} Error codes.
 */
function validateContainerLineEdit(current, input, contactsOnly) {
  const row = current && typeof current === "object" ? current : {};
  const asked = input && typeof input === "object" ? input : {};
  if (contactsOnly) return validateContainerLineContacts(asked, row);
  // What was paid is the stored amount, whatever the request claims.
  return validateContainerLine({...row, ...asked}, paidCentsOf(row.paidCents));
}

/**
 * The fields an edit changes, compared as stored.
 *
 * @param {object} current The stored line.
 * @param {object} next The editable fields after the edit.
 * @return {string[]} Field keys, in a fixed order.
 */
function containerLineEditChanges(current, next) {
  const before = containerLineEditable(current);
  const after = next && typeof next === "object" ? next : {};
  return LINE_EDIT_FIELDS.filter((key) =>
    String(before[key] ?? "") !== String(after[key] ?? ""));
}

/**
 * @param {string[]} changes Changed field keys.
 * @return {boolean} Whether only the contact half changed.
 */
function lineEditIsContactsOnly(changes) {
  return (Array.isArray(changes) ? changes : [])
      .every((key) => LINE_CONTACT_FIELDS.includes(key));
}

/**
 * Whether an edit may land on a line in this container. Contacts and the
 * price may change in every state; anything else only while the box is
 * loading, the same as adding, moving or removing a line. A waiting line has
 * no container (null), which is as open as a loading one.
 *
 * @param {object|null} container The line's container, null while waiting.
 * @param {string[]} changes Changed field keys.
 * @return {string|null} A refusal code, or null when allowed.
 */
function containerLineEditRefusal(container, changes) {
  const always = [...LINE_CONTACT_FIELDS, ...LINE_PRICE_FIELDS];
  if ((Array.isArray(changes) ? changes : [])
      .every((key) => always.includes(key))) {
    return null;
  }
  return containerIsOpen(container) ? null : "container_locked";
}

/**
 * The VIN locks an edit hands over: the car the line no longer is lets its
 * lock go, the car it now is takes one. Unchanged (same car, or never a car)
 * hands over nothing.
 *
 * @param {object} current The stored line.
 * @param {object} next The editable fields after the edit.
 * @return {{releaseVin: string, takeVin: string}} VINs, "" for none.
 */
function containerLineVinHandover(current, next) {
  const vinOf = (line) => {
    const row = line && typeof line === "object" ? line : {};
    if (text(row.kind, 20) !== "car") return "";
    return text(row.vinNumber, MAX_VIN).toUpperCase();
  };
  const before = vinOf(containerLineEditable(current));
  const after = vinOf(next);
  if (before === after) return {releaseVin: "", takeVin: ""};
  return {releaseVin: before, takeVin: after};
}

/**
 * What an edit does to its container's tallies: the old line's share taken
 * away and the new one's added. Only the non-zero keys are returned, so an
 * edit that leaves the counts alone writes none.
 *
 * @param {object} current The stored line.
 * @param {object} next The editable fields after the edit.
 * @return {object} e.g. {barrelCount: 2}.
 */
function containerLineEditCountsDelta(current, next) {
  const out = {};
  const add = (delta) => {
    for (const [key, value] of Object.entries(delta)) {
      out[key] = (out[key] || 0) + value;
    }
  };
  add(containerCountsDelta(current, -1));
  add(containerCountsDelta(next, 1));
  for (const key of Object.keys(out)) if (!out[key]) delete out[key];
  return out;
}

/**
 * The fields an edit names in the history. A new kind says "kind" rather
 * than listing every car field it emptied; a new owner says "owner" rather
 * than the customer fields that came or went with it.
 *
 * @param {string[]} changes Changed field keys.
 * @return {string[]} Labels, in order, without repeats.
 */
function containerLineEditLabels(changes) {
  const list = Array.isArray(changes) ? changes : [];
  const kindDependent = ["vinNumber", "carMake", "carModel", "carYear",
    "quantity", "description"];
  const ownerDependent = ["customerName", "customerPhone", "notifyCustomer"];
  const shown = list.filter((key) =>
    !(list.includes("kind") && kindDependent.includes(key)) &&
    !(list.includes("ownerKind") && ownerDependent.includes(key)));
  return [...new Set(shown.map((key) => LINE_FIELD_LABELS[key] || key))];
}

/**
 * The history entry for an edit. A contacts-only change keeps the sentence
 * it always had ("Changed receiver's phone for Fatou"); anything else says
 * what the line is now and was before: "Edited 5 barrels (was 3 barrels):
 * quantity for Fatou".
 *
 * @param {object} current The stored line.
 * @param {object} next The editable fields after the edit.
 * @param {string[]} changes Changed field keys.
 * @return {{action: string, summary: string}} The audit action and sentence.
 */
function containerLineEditAudit(current, next, changes) {
  const after = next && typeof next === "object" ? next : {};
  const labels = containerLineEditLabels(changes).join(", ");
  const name = text(after.customerName, MAX_LABEL);
  if (lineEditIsContactsOnly(changes)) {
    return {
      action: "line_contacts_edited",
      summary: `Changed ${labels}` + (name ? ` for ${name}` : ""),
    };
  }
  const now = containerLineWhat(after);
  const was = containerLineWhat(containerLineEditable(current));
  const whose = text(after.ownerKind, 20) === "stock" ?
    " (business stock)" : (name ? ` for ${name}` : "");
  return {
    action: "line_edited",
    summary: `Edited ${now}` + (was !== now ? ` (was ${was})` : "") +
      `: ${labels}${whose}`,
  };
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
  vin_already_waiting: "This car is already waiting for a container.",
  move_target_not_loading:
    "You can only move a line to a container that is still loading.",
  package_destination_required: "Choose where this package is going.",
  destination_mismatch:
    "A package can only go on a container headed to the same country.",
  container_destination_required:
    "Choose where this container is going before adding packages to it.",
  size_invalid:
    "Enter the length, width and height in inches, or leave all three empty.",
  line_not_waiting: "That package is already on a container.",
  line_is_waiting:
    "This package is waiting for a container. Add it to one from the " +
    "waiting list.",
  line_not_in_container: "That package is not on a container.",
  line_ids_invalid: "Choose between 1 and 100 packages.",
  line_has_payments:
    "Payments are recorded for this package. Revert them first.",
  price_invalid: "Enter the price in dollars, more than zero.",
  price_below_paid: "The price can't be less than what has been paid.",
  price_required: "Set a price before recording a payment.",
  amount_required: "Enter the amount received.",
  amount_too_large: "That amount is larger than a package can carry.",
  payment_method_invalid: "Say how the payment arrived.",
  payment_exceeds_balance: "That is more than what is still owed.",
  payment_not_found: "That payment no longer exists.",
  payment_already_reverted: "That payment was already reverted.",
});

module.exports = {
  LINE_STATUS_WAITING,
  WAITING_HOLDER,
  MAX_LINE_IDS,
  MAX_DIMENSION_IN,
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
  validateWaitingPackage,
  dimensionOf,
  lineVolumeCubicFeet,
  lineSizeText,
  lineIsWaiting,
  destinationMismatch,
  cleanLineIds,
  containerAssignRefusal,
  containerLinesCountsDelta,
  containerLineRecord,
  validateContainerLineContacts,
  containerLineContactsUpdate,
  isInternationalPhone,
  openContainerHoldingVin,
  containerCounts,
  containerCountsDelta,
  LINE_CONTACT_FIELDS,
  LINE_SUBSTANCE_FIELDS,
  LINE_PRICE_FIELDS,
  LINE_EDIT_FIELDS,
  CONTACT_FIELD_LABELS,
  LINE_FIELD_LABELS,
  barrelsLabel,
  containerLineWhat,
  containerLineEditable,
  containerLineEditTarget,
  validateContainerLineEdit,
  containerLineEditChanges,
  lineEditIsContactsOnly,
  containerLineEditRefusal,
  containerLineVinHandover,
  containerLineEditCountsDelta,
  containerLineEditLabels,
  containerLineEditAudit,
  containerVinLockId,
  vinLockHolder,
  keepExisting,
  containerStatusIsRepeat,
  linesLagStatus,
  inGroups,
};

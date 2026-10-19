"use strict";

const {normalizeTrackingCode} = require("./tracking_code");
const {oceanCarrierName} = require("./ocean_carrier_catalog");
const {lastTwo, strictE164} = require("./phone_e164");
const {
  groupRootId,
  lineCounts,
  lineGroupSummary,
} = require("./line_pieces");

const GUEST_TRACKING_COLLECTIONS = Object.freeze([
  Object.freeze({name: "barrelShipments", prefix: "BS", service: "barrel"}),
  Object.freeze({name: "freightShipments", prefix: "FR", service: "freight"}),
  Object.freeze({
    name: "transportRequests", prefix: "TR", service: "transport",
  }),
  Object.freeze({name: "parkedCars", prefix: "PK", service: "parking"}),
  Object.freeze({name: "barrelPools", prefix: "BP", service: "shared_barrel"}),
  Object.freeze({
    name: "freightQuoteRequests", prefix: "FQ", service: "freight_quote",
  }),
  // Goods a business loaded into its own container for a customer. The code
  // is printed on the package label and sent with every status message.
  Object.freeze({name: "containerLines", prefix: "CL", service: "container"}),
]);

// A package dropped off before any container is chosen has a stage of its
// own: it is received, and nothing is booked onto a box yet. The screens map
// the stage to its words (and French) the way they do every other stage.
const WAITING_STAGE = "waiting_container";
const WAITING_STAGE_LABEL = "Received, waiting for a container";

// A container line follows its box: received into it, at sea, landed.
const CONTAINER_STAGE_BY_STATUS = Object.freeze({
  waiting: WAITING_STAGE,
  loading: "booked",
  shipped: "in_transit",
  arrived: "arrived",
});

const PUBLIC_STAGE_BY_STATUS = Object.freeze({
  // Not "booked": nothing is booked until it is paid for, and telling the
  // customer otherwise leaves them waiting on a shipment that will never
  // move while the business waits on a payment that never came.
  pending_payment: "awaiting_payment",
  awaiting_weight_confirmation: "booked",
  awaiting_balance_payment: "awaiting_payment",
  settlement_processing: "booked",
  quote_requested: "booked",
  pending: "booked",
  requested: "booked",
  open: "booked",
  collecting_quotes: "booked",
  quoted: "booked",
  accepted: "booked",
  reserved: "booked",
  scheduled: "in_transit",
  vehicle_received: "in_transit",
  parked: "in_transit",
  active: "in_transit",
  sealed: "in_transit",
  in_transit: "in_transit",
  ready_for_pickup: "arrived",
  available: "arrived",
  completed: "delivered",
  delivered: "delivered",
  cancelled: "cancelled",
  canceled: "cancelled",
});

function cleanText(value, maxLength = 80) {
  return String(value || "").trim().slice(0, maxLength);
}

/**
 * Candidate stored forms for one human-entered Laawol tracking reference.
 *
 * New codes use `BS-K7M4P2`; older server codes used
 * `BS-MS9TTES1-OMVYTL`, and a few legacy mobile records omitted separators.
 * The lookup remains exact in Firestore, but accepts those human formatting
 * differences without scanning a collection client-side.
 *
 * @param {unknown} input Raw callable input.
 * @return {string[]} Exact values safe to use in an `in` query.
 */
function guestTrackingCandidates(input) {
  const raw = cleanText(input).toUpperCase();
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  if (compact.length < 6 || compact.length > 40) return [];

  const candidates = new Set([raw, compact, normalizeTrackingCode(raw)]);
  const legacyServer = compact.match(/^([A-Z]{2})([A-Z0-9]{8})([A-Z0-9]{6})$/);
  if (legacyServer) {
    candidates.add(`${legacyServer[1]}-${legacyServer[2]}-${legacyServer[3]}`);
  }
  return [...candidates]
      .map((value) => cleanText(value, 60))
      .filter(Boolean)
      .slice(0, 10);
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

// Once a container line's box has sailed, the page the WhatsApp button
// opens names the ship's details a customer can follow on the shipping
// line's own site. Before sailing the box can still change, so nothing.
const CONTAINER_SHIPPING_STAGES = Object.freeze(["in_transit", "arrived"]);

/**
 * The shipping details of a container line's box, for the public page:
 * the shipping line, the container number and the booking number, each
 * only when known. Nothing else of the container crosses (no label, notes,
 * price, people or business), and nothing at all before it has shipped.
 *
 * @param {string} stage The line's public stage.
 * @param {object|null} container The line's container.
 * @return {object|null} {shippingLine?, containerNumber?, bookingNumber?},
 *   or null when there is nothing to show.
 */
function publicContainerShipping(stage, container) {
  if (!CONTAINER_SHIPPING_STAGES.includes(stage)) return null;
  if (!container || typeof container !== "object") return null;
  const shippingLine = oceanCarrierName(container.carrierScac);
  const containerNumber = cleanText(
      container.containerNumber || container.trackedContainerNumber, 20)
      .toUpperCase();
  const bookingNumber = cleanText(container.bookingReference, 60)
      .toUpperCase();
  const shipping = {
    ...(shippingLine ? {shippingLine} : {}),
    ...(containerNumber ? {containerNumber} : {}),
    ...(bookingNumber ? {bookingNumber} : {}),
  };
  return Object.keys(shipping).length ? shipping : null;
}

/**
 * What the public page shows of a container line's group: every part of the
 * package (its code, stage, pieces and price - a part may sail while the
 * rest waits) and, for the whole group, the final price (and the pickup fee
 * inside it), what was paid and what is still owed (payments live on the
 * root). Nothing about the people.
 *
 * @param {object} line The line that was looked up.
 * @param {object|null} group lineGroupSummary of its group, or null (the
 *   line alone).
 * @param {string} id The line's id.
 * @return {object} {pieceCount, parts, payment: {priceCents,
 *   pickupFeeCents, paidCents, balanceCents}}.
 */
function publicContainerGroup(line, group, id) {
  const summary = group && Array.isArray(group.parts) && group.parts.length ?
    group : lineGroupSummary([{id, line}], groupRootId(line, id));
  const stageOf = (status) => CONTAINER_STAGE_BY_STATUS[
      cleanText(status, 60).toLowerCase()] || "booked";
  return {
    pieceCount: lineCounts(line).pieceCount,
    parts: summary.parts.map((part) => ({
      trackingCode: cleanText(part.trackingCode, 60),
      stage: stageOf(part.containerStatus),
      pieceCount: part.pieceCount,
      priceCents: part.priceCents,
    })),
    payment: {
      priceCents: summary.priceCents,
      // The pickup fee inside priceCents, so the page itemises it.
      pickupFeeCents: summary.pickupFeeCents || 0,
      paidCents: summary.paidCents,
      balanceCents: summary.balanceCents,
    },
  };
}

/**
 * Who may sign in from this record's page (docs/PHONE_ACCOUNTS.md §10): the
 * role and the LAST TWO digits of each valid number on it - never more. The
 * page offers "Sign in as the number ending in ••35" and the server, not the
 * page, sends the code to the number.
 *
 * @param {object} row The stored record.
 * @return {Array<{role: string, lastTwo: string}>} One per number.
 */
function signInHints(row) {
  const hints = [];
  const sender = strictE164(row.customerPhoneE164) ||
    strictE164(row.customerPhone);
  const receiver = strictE164(row.receiverPhoneE164) ||
    strictE164(row.receiverPhone);
  if (sender) hints.push({role: "sender", lastTwo: lastTwo(sender)});
  if (receiver && receiver !== sender) {
    hints.push({role: "receiver", lastTwo: lastTwo(receiver)});
  }
  return hints;
}

function publicGuestTrackingRecord({id, service, data, container = null,
  group = null}) {
  const row = data || {};
  const status = service === "transport" ?
    cleanText(row.fulfillmentStatus || row.status, 60).toLowerCase() :
    service === "container" ?
      cleanText(row.containerStatus, 60).toLowerCase() :
      cleanText(row.status, 60).toLowerCase();
  const stage = (service === "container" ?
    CONTAINER_STAGE_BY_STATUS[status] :
    PUBLIC_STAGE_BY_STATUS[status]) || "booked";
  const shipping = service === "container" ?
    publicContainerShipping(stage, container) : null;
  return {
    trackingCode: cleanText(row.trackingCode || id, 60),
    service,
    stage,
    // How many businesses have answered a price request - a count, never a
    // price. The customer holding the code learns answers are waiting and
    // proves the email they gave to see them; anyone else learns a number.
    ...(service === "freight_quote" ? {
      quoteCount: Number.isFinite(Number(row.quoteCount)) ?
        Math.max(0, Math.trunc(Number(row.quoteCount))) :
        0,
      quoteStatus: cleanText(row.quoteStatus, 30).toLowerCase(),
    } : {}),
    ...(shipping ? {shipping} : {}),
    ...(service === "container" ?
      publicContainerGroup(row, group, id) : {}),
    ...(signInHints(row).length ? {signIn: signInHints(row)} : {}),
    updatedAtMs: Math.max(
        timestampMillis(row.updatedAt),
        timestampMillis(row.createdAt),
    ),
  };
}

/**
 * A container line's box, read only once it has sailed (the only time the
 * public page shows anything of it) and only when it is the same
 * business's box.
 *
 * @param {!FirebaseFirestore.Firestore} db Admin Firestore instance.
 * @param {object} line The containerLines row.
 * @return {!Promise<?Object>} The container's data, or null.
 */
async function shippedContainerOf(db, line) {
  const containerId = cleanText(line?.containerId, 128);
  const stage = CONTAINER_STAGE_BY_STATUS[
      cleanText(line?.containerStatus, 60).toLowerCase()];
  if (!containerId || containerId.includes("/") ||
      !CONTAINER_SHIPPING_STAGES.includes(stage)) {
    return null;
  }
  const doc = await db.collection("containers").doc(containerId).get();
  const container = doc.exists ? doc.data() || {} : null;
  if (!container ||
      cleanText(container.businessId, 128) !==
        cleanText(line.businessId, 128)) {
    return null;
  }
  return container;
}

/**
 * The group a container line belongs to - itself and every part split from
 * the same root, one business's only - as lineGroupSummary reads it. A line
 * never split is a group of one and costs no read.
 *
 * @param {!FirebaseFirestore.Firestore} db Admin Firestore instance.
 * @param {string} id The line's id.
 * @param {object} line The line.
 * @return {!Promise<?Object>} The summary.
 */
async function containerLineGroup(db, id, line) {
  const rootId = groupRootId(line, id);
  const businessId = cleanText(line?.businessId, 128);
  if (!cleanText(line?.rootLineId, 200) || !businessId ||
      rootId.includes("/")) {
    return lineGroupSummary([{id, line}], rootId);
  }
  const [parts, rootDoc] = await Promise.all([
    db.collection("containerLines")
        .where("businessId", "==", businessId)
        .where("rootLineId", "==", rootId)
        .limit(100)
        .get(),
    db.collection("containerLines").doc(rootId).get(),
  ]);
  const entries = parts.docs.map((d) => ({id: d.id, line: d.data() || {}}));
  if (rootDoc.exists &&
      cleanText(rootDoc.data()?.businessId, 128) === businessId &&
      !entries.some((entry) => entry.id === rootId)) {
    entries.push({id: rootId, line: {...rootDoc.data(), rootLineId: rootId}});
  }
  if (!entries.some((entry) => entry.id === id)) entries.push({id, line});
  return lineGroupSummary(entries, rootId);
}

/**
 * Finds one exact booking reference without ever returning a Firestore row.
 * Prefixes make cross-collection collisions extremely unlikely; collection
 * order is stable so a legacy collision still resolves deterministically.
 *
 * @param {!FirebaseFirestore.Firestore} db Admin Firestore instance.
 * @param {string[]} candidates Exact tracking-code candidates.
 * @return {!Promise<?Object>} Sanitized public record, or null.
 */
async function findGuestTrackingRecord(db, candidates) {
  const found = await findTrackingDocument(db, candidates);
  if (!found) return null;
  const container = found.service === "container";
  return publicGuestTrackingRecord({
    id: found.id,
    service: found.service,
    data: found.data,
    container: container ? await shippedContainerOf(db, found.data) : null,
    group: container ? await containerLineGroup(db, found.id, found.data) :
      null,
  });
}

/**
 * The one stored record a tracking reference names, as the server reads
 * it (never returned to a client): {collection, service, id, data}, or
 * null when nothing or more than one record matches.
 *
 * @param {!FirebaseFirestore.Firestore} db Admin Firestore instance.
 * @param {string[]|string} input Candidates, or a raw code.
 * @return {!Promise<?Object>} The record.
 */
async function findTrackingDocument(db, input) {
  const candidates = Array.isArray(input) ? input :
    guestTrackingCandidates(input);
  if (!candidates.length) return null;
  const prefix = candidates[0]?.replace(/[^A-Z0-9]/g, "").slice(0, 2) || "";
  const routed = GUEST_TRACKING_COLLECTIONS.filter(
      (config) => config.prefix === prefix,
  );
  const collections = routed.length ? routed : GUEST_TRACKING_COLLECTIONS;
  let match = null;
  for (const config of collections) {
    const snapshot = await db.collection(config.name)
        .where("trackingCode", "in", candidates)
        .limit(2)
        .get();
    if (snapshot.empty) continue;
    if (snapshot.docs.length !== 1 || match !== null) return null;
    const document = snapshot.docs[0];
    match = {collection: config.name, service: config.service,
      id: document.id, data: document.data() || {}};
  }
  return match;
}

module.exports = {
  GUEST_TRACKING_COLLECTIONS,
  PUBLIC_STAGE_BY_STATUS,
  CONTAINER_STAGE_BY_STATUS,
  CONTAINER_SHIPPING_STAGES,
  publicContainerShipping,
  shippedContainerOf,
  containerLineGroup,
  publicContainerGroup,
  WAITING_STAGE,
  WAITING_STAGE_LABEL,
  findGuestTrackingRecord,
  findTrackingDocument,
  signInHints,
  guestTrackingCandidates,
  publicGuestTrackingRecord,
  timestampMillis,
};

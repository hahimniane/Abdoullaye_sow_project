"use strict";

const {normalizeTrackingCode} = require("./tracking_code");

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
]);

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

function publicGuestTrackingRecord({id, service, data}) {
  const row = data || {};
  const status = service === "transport" ?
    cleanText(row.fulfillmentStatus || row.status, 60).toLowerCase() :
    cleanText(row.status, 60).toLowerCase();
  const stage = PUBLIC_STAGE_BY_STATUS[status] || "booked";
  return {
    trackingCode: cleanText(row.trackingCode || id, 60),
    service,
    stage,
    updatedAtMs: Math.max(
        timestampMillis(row.updatedAt),
        timestampMillis(row.createdAt),
    ),
  };
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
    match = publicGuestTrackingRecord({
      id: document.id,
      service: config.service,
      data: document.data(),
    });
  }
  return match;
}

module.exports = {
  GUEST_TRACKING_COLLECTIONS,
  PUBLIC_STAGE_BY_STATUS,
  findGuestTrackingRecord,
  guestTrackingCandidates,
  publicGuestTrackingRecord,
  timestampMillis,
};

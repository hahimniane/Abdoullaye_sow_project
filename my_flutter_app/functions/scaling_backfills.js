"use strict";

// One-time (and safely repeatable) backfills for the fields the scaling
// fixes query on. Each runs two ways with the same code:
//   - lazily from the deployed functions, the first time a lot / job needs
//     the field, and then records a marker so it never scans again;
//   - up front by an operator: `npm run backfill:scaling -- --commit`
//     (scripts/backfill-scaling-fields.js; dry-run by default).
//
// Writes are guarded by the document's updateTime, so a backfill that read a
// row just before someone changed it can never overwrite the newer value -
// the write fails, is counted as `raced`, and the field's trigger or write
// site has already set the right value.

const {FieldValue, Timestamp, FieldPath} =
  require("firebase-admin/firestore");
const {
  OCCUPANCY_INDEX_VERSION,
  occupancyPatch,
} = require("./parking_occupancy");
const {carrierTrackingDonePatch} = require("./shipment_tracking");
const {
  PENDING_VIEWING_STATUSES,
  legacyRespondByAtMs,
} = require("./car_viewing");
const {drainPages, mapWithConcurrency} = require("./scheduled_sweep");

/** Marker documents live here; client rules deny the whole collection. */
const BACKFILL_MARKERS = "scalingBackfills";

const CARRIER_TRACKING_DONE_MARKER = "carrierTrackingDone_v1";
const VIEWING_RESPOND_BY_MARKER = "viewingRespondBy_v1";

function parkingOccupancyMarkerId(businessId) {
  return `parkingOccupancy_v${OCCUPANCY_INDEX_VERSION}_${businessId}`;
}

// FAILED_PRECONDITION (9): the row changed after we read it. NOT_FOUND (5):
// it was deleted. Neither needs this backfill any more.
function isBenignRace(error) {
  return error?.code === 9 || error?.code === 5 ||
    error?.code === "failed-precondition" || error?.code === "not-found";
}

/**
 * Applies `patchFor` to every document a paged query returns.
 *
 * @param {object} args
 * @param {function(*): object} args.query Builds the query for a cursor.
 * @param {function(object): object|null} args.patchFor Patch or null.
 * @param {boolean} args.commit False = count only.
 * @param {number} args.deadlineMs Stop starting pages after this.
 * @param {number} [args.pageSize]
 * @return {Promise<object>} {scanned, updated, raced, failed, complete}.
 */
async function patchQuery({query, patchFor, commit, deadlineMs,
  pageSize = 300}) {
  const stats = {scanned: 0, updated: 0, raced: 0, failed: 0};
  const result = await drainPages({
    pageSize,
    deadlineMs,
    fetchPage: async (cursor) => {
      let q = query().orderBy(FieldPath.documentId()).limit(pageSize);
      if (cursor) q = q.startAfter(cursor);
      return (await q.get()).docs;
    },
    processPage: async (docs) => {
      stats.scanned += docs.length;
      const work = docs
          .map((doc) => ({doc, patch: patchFor(doc.data() || {})}))
          .filter((item) => item.patch);
      if (!commit) {
        stats.updated += work.length;
        return;
      }
      const results = await mapWithConcurrency(work, 20, ({doc, patch}) =>
        doc.ref.update(patch, {lastUpdateTime: doc.updateTime}));
      results.forEach((outcome) => {
        if (outcome.status === "fulfilled") stats.updated += 1;
        else if (isBenignRace(outcome.reason)) stats.raced += 1;
        else stats.failed += 1;
      });
    },
  });
  return {...stats, complete: result.exhausted && stats.failed === 0};
}

async function markerExists(db, id) {
  const snapshot = await db.collection(BACKFILL_MARKERS).doc(id).get();
  return snapshot.exists;
}

async function writeMarker(db, id, stats) {
  await db.collection(BACKFILL_MARKERS).doc(id).set({
    completedAt: FieldValue.serverTimestamp(),
    scanned: stats.scanned,
    updated: stats.updated,
  });
}

/**
 * Stamps occupancyEndMs on one lot's parkedCars and records the marker that
 * lets availability trust the occupancy query for that lot.
 *
 * @param {object} db Firestore.
 * @param {string} businessId The lot.
 * @param {object} [options] {commit=true, deadlineMs}.
 * @return {Promise<object>} Stats plus `complete`.
 */
async function backfillParkingOccupancy(db, businessId, {commit = true,
  deadlineMs = Date.now() + 5 * 60 * 1000} = {}) {
  const stats = await patchQuery({
    query: () => db.collection("parkedCars")
        .where("businessId", "==", businessId),
    patchFor: occupancyPatch,
    commit,
    deadlineMs,
  });
  if (commit && stats.complete) {
    await writeMarker(db, parkingOccupancyMarkerId(businessId), stats);
  }
  return stats;
}

// Per-instance memo: a lot that is backfilled stays backfilled (the marker
// is never removed, and every new or changed row is stamped by its write
// site or the syncParkedCarOccupancy trigger), so it is read once.
const occupancyReady = new Set();

/**
 * Makes sure a lot's rows carry occupancyEndMs before anything relies on the
 * occupancy query for it. Cheap after the first call per instance.
 *
 * @param {object} db Firestore.
 * @param {string} businessId The lot.
 * @param {object} [options] {deadlineMs} for the backfill, if one runs.
 * @return {Promise<void>}
 */
async function ensureParkingOccupancyIndexed(db, businessId,
    {deadlineMs} = {}) {
  if (!businessId || occupancyReady.has(businessId)) return;
  if (await markerExists(db, parkingOccupancyMarkerId(businessId))) {
    occupancyReady.add(businessId);
    return;
  }
  const stats = await backfillParkingOccupancy(db, businessId, {
    commit: true,
    ...(deadlineMs && {deadlineMs}),
  });
  if (!stats.complete) {
    // Fail closed: counting availability off a half-indexed lot could
    // over-book it. The caller surfaces this; the next call resumes.
    const error = new Error("parking occupancy backfill incomplete");
    error.code = "occupancy-backfill-incomplete";
    error.stats = stats;
    throw error;
  }
  occupancyReady.add(businessId);
}

/**
 * Stamps carrierTrackingDone on every carrier-tracked shipment that lacks
 * the right value, collection by collection, then records the marker.
 *
 * @param {object} db Firestore.
 * @param {Array<string>} collections Shipment collections.
 * @param {object} [options] {commit=true, deadlineMs, force}.
 * @return {Promise<object>} {complete, byCollection}.
 */
async function backfillCarrierTrackingDone(db, collections, {commit = true,
  deadlineMs = Date.now() + 5 * 60 * 1000, force = false} = {}) {
  if (!force && commit &&
      await markerExists(db, CARRIER_TRACKING_DONE_MARKER)) {
    return {complete: true, skipped: true, byCollection: {}};
  }
  const byCollection = {};
  let complete = true;
  for (const collection of collections) {
    const stats = await patchQuery({
      query: () => db.collection(collection)
          .where("trackingProvider", "==", "carrier_api"),
      patchFor: carrierTrackingDonePatch,
      commit,
      deadlineMs,
    });
    byCollection[collection] = stats;
    if (!stats.complete) {
      complete = false;
      break;
    }
  }
  if (commit && complete) {
    const total = Object.values(byCollection).reduce((sum, s) => ({
      scanned: sum.scanned + s.scanned, updated: sum.updated + s.updated,
    }), {scanned: 0, updated: 0});
    await writeMarker(db, CARRIER_TRACKING_DONE_MARKER, total);
  }
  return {complete, byCollection};
}

function viewingRespondByPatch(purchase, nowMs = Date.now()) {
  const ms = legacyRespondByAtMs({
    purchaseStatus: purchase.purchaseStatus,
    respondByAtMs: purchase.respondByAt?.toMillis?.() ?? null,
  }, nowMs);
  return ms === null ? null : {respondByAt: Timestamp.fromMillis(ms)};
}

/**
 * Gives pending viewing proposals with no respondByAt the deadline the
 * sweep already treated them as having (overdue), so it can query by it.
 *
 * @param {object} db Firestore.
 * @param {object} [options] {commit=true, deadlineMs, force}.
 * @return {Promise<object>} Stats plus `complete`.
 */
async function backfillViewingRespondBy(db, {commit = true,
  deadlineMs = Date.now() + 2 * 60 * 1000, force = false} = {}) {
  if (!force && commit && await markerExists(db, VIEWING_RESPOND_BY_MARKER)) {
    return {complete: true, skipped: true};
  }
  const stats = await patchQuery({
    query: () => db.collection("carPurchases")
        .where("purchaseStatus", "in", PENDING_VIEWING_STATUSES),
    patchFor: viewingRespondByPatch,
    commit,
    deadlineMs,
  });
  if (commit && stats.complete) {
    await writeMarker(db, VIEWING_RESPOND_BY_MARKER, stats);
  }
  return stats;
}

module.exports = {
  BACKFILL_MARKERS,
  CARRIER_TRACKING_DONE_MARKER,
  VIEWING_RESPOND_BY_MARKER,
  backfillCarrierTrackingDone,
  backfillParkingOccupancy,
  backfillViewingRespondBy,
  ensureParkingOccupancyIndexed,
  isBenignRace,
  parkingOccupancyMarkerId,
  patchQuery,
  viewingRespondByPatch,
};

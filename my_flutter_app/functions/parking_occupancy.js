"use strict";

// Which parked cars occupy a space, and for how long. Pure so the rule can
// be unit-tested; index.js feeds it Firestore rows.

/**
 * `status` values that make a parkedCars row hold a space. A status outside
 * this set (cancelled, released, completed) frees it.
 */
const ACTIVE_PARKING_STATUSES = Object.freeze([
  "pending_payment",
  "requested",
  "reserved",
  "vehicle_received",
  "parked",
  "scheduled_for_transport",
  "active",
]);

const ACTIVE_STATUS_SET = new Set(ACTIVE_PARKING_STATUSES);

function toDate(value) {
  if (!value) return null;
  // A Date is used as-is: round-tripping it through String() drops the
  // milliseconds, and the occupancy query compares exact milliseconds.
  const parsed = value instanceof Date ? value :
    typeof value.toDate === "function" ?
      value.toDate() : new Date(String(value));
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ?
    parsed : null;
}

/**
 * Whether a row's stay overlaps [start, end].
 *
 * A row with no leave date is an OPEN-ENDED stay: the car is on the lot from
 * its arrival until someone closes the stay. It keeps occupying its space for
 * every day after it arrived, not just the arrival day. (Collapsing a missing
 * end to the start date made every open-ended car vanish from the count the
 * day after it arrived, so the lot over-booked.)
 *
 * @param {object} row A parkedCars document.
 * @param {Date} start Window start.
 * @param {Date} end Window end.
 * @return {boolean} True when the stay overlaps the window.
 */
function parkingRangeOverlaps(row, start, end) {
  const rowStart = toDate(row?.parkingDate);
  if (!rowStart) return false;
  const rowEnd = toDate(row?.parkingEndDate);
  // The WINDOW can be open-ended too: recording an open-ended walk-up asks
  // "is there a space from today onward", with no end date at all.
  const windowEnd = toDate(end);
  const windowStart = toDate(start) || windowEnd || new Date();
  const startsBeforeWindowEnds =
    !windowEnd || rowStart.getTime() <= windowEnd.getTime();
  if (!rowEnd) return startsBeforeWindowEnds;
  return rowEnd.getTime() >= windowStart.getTime() && startsBeforeWindowEnds;
}

function isActiveParkingRow(row) {
  return ACTIVE_STATUS_SET.has(String(row?.status || "reserved"));
}

function intOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/**
 * Free spaces for a window: total minus blocked minus every active stay
 * that overlaps it.
 *
 * @param {object} args business, reservations, start, end.
 * @return {number} Spaces available, never negative.
 */
function parkingAvailability({business, reservations, start, end}) {
  const totalSpaces = intOrZero(business?.parkingTotalSpaces);
  const blockedSpaces = intOrZero(business?.parkingBlockedSpaces);
  const overlapping = (reservations || []).filter((row) =>
    isActiveParkingRow(row) && parkingRangeOverlaps(row, start, end),
  ).length;
  return Math.max(0, totalSpaces - blockedSpaces - overlapping);
}

// ---------------------------------------------------------------------------
// Occupancy index: which rows a query must read.
//
// Availability used to read the newest 1000 parkedCars of a lot (by arrival)
// and count the overlapping ones. A car that arrived before the newest 1000
// and never left - an open-ended stay from long ago - fell out of the read and
// stopped holding its space, so the lot over-booked; and every search paid
// 1000 reads per lot.
//
// Each row now carries `occupancyEndMs`: the last millisecond it can hold a
// space (its leave date, or OPEN_ENDED_OCCUPANCY_END_MS when it has none).
// A stay can only overlap a window if it ends on or after the window starts,
// so `occupancyEndMs >= windowStartMs` is a superset of every row that
// parkingRangeOverlaps can count, and the start side is filtered in code.
//
// The field is date-only on purpose: the month-end bill also reads stays that
// have since been released, and status is filtered in code by both readers.
// ---------------------------------------------------------------------------

/** The latest instant a JS Date can hold; stands in for "never leaves". */
const OPEN_ENDED_OCCUPANCY_END_MS = 8640000000000000;

/** Rows with no arrival date never hold a space or appear on a bill. */
const NO_OCCUPANCY_END_MS = 0;

/** Bumped when the rule below changes, so stale backfills re-run. */
const OCCUPANCY_INDEX_VERSION = 1;

/**
 * The value a parkedCars row must store in `occupancyEndMs`.
 *
 * @param {object} row A parkedCars document (or the fields being written).
 * @return {number} Milliseconds; never NaN.
 */
function occupancyEndMs(row) {
  const start = toDate(row?.parkingDate);
  if (!start) return NO_OCCUPANCY_END_MS;
  const end = toDate(row?.parkingEndDate);
  if (!end) return OPEN_ENDED_OCCUPANCY_END_MS;
  return end.getTime();
}

/**
 * The lower bound for `occupancyEndMs` when asking about [start, end] - the
 * same window start parkingRangeOverlaps compares against, so the query and
 * the in-code check can never disagree.
 *
 * @param {*} start Window start (Date, Timestamp, ISO string or empty).
 * @param {*} end Window end (may be empty for an open-ended window).
 * @param {Date} [now] Fallback when the window has neither.
 * @return {number} Milliseconds.
 */
function occupancyWindowStartMs(start, end, now = new Date()) {
  const windowStart = toDate(start) || toDate(end) || now;
  return windowStart.getTime();
}

/**
 * What the occupancy query returns, applied to in-memory rows. Mirrors
 * `where("occupancyEndMs", ">=", windowStartMs)`: a row without the field is
 * not returned, exactly as Firestore would skip it.
 *
 * @param {object[]} rows parkedCars rows (with stored occupancyEndMs).
 * @param {*} start Window start.
 * @param {*} end Window end.
 * @return {object[]} The rows the query would read.
 */
function occupancyQueryRows(rows, start, end) {
  const floor = occupancyWindowStartMs(start, end);
  return (rows || []).filter((row) =>
    typeof row?.occupancyEndMs === "number" && row.occupancyEndMs >= floor,
  );
}

/**
 * The patch a row needs so its stored index matches its dates, or null
 * when it already does. Idempotent: applying the patch makes it return null.
 *
 * @param {object} row A parkedCars document.
 * @return {{occupancyEndMs: number}|null} The patch.
 */
function occupancyPatch(row) {
  const desired = occupancyEndMs(row);
  return row?.occupancyEndMs === desired ? null : {occupancyEndMs: desired};
}

module.exports = {
  ACTIVE_PARKING_STATUSES,
  NO_OCCUPANCY_END_MS,
  OCCUPANCY_INDEX_VERSION,
  OPEN_ENDED_OCCUPANCY_END_MS,
  isActiveParkingRow,
  occupancyEndMs,
  occupancyPatch,
  occupancyQueryRows,
  occupancyWindowStartMs,
  parkingRangeOverlaps,
  parkingAvailability,
};

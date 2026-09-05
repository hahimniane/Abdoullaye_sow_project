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
  const parsed = typeof value.toDate === "function" ?
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

module.exports = {
  ACTIVE_PARKING_STATUSES,
  isActiveParkingRow,
  parkingRangeOverlaps,
  parkingAvailability,
};

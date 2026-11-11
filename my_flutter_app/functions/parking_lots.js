"use strict";

// Several parking lots for one business (docs/PARKING_LOTS.md). Pure, so the
// rules can be unit-tested; index.js feeds it Firestore rows.
//
// A lot is only WHERE a car stands: prices, bills, invoices and money
// messages are the business's, whatever the lot. Each lot has its own
// spaces, and the business's `parkingTotalSpaces` / `parkingBlockedSpaces`
// are kept as the sum over its open lots, so everything that already reads
// those two numbers (the customer search, Today, the totals) keeps working.
//
// A business that never set lots up has none stored: its cars carry no
// `parkingLotId` and are read as standing in its first lot (mainLotId), the
// one the first conversion creates from the business's own parking settings.

const {isActiveParkingRow, parkingRangeOverlaps} =
  require("./parking_occupancy");

const MAX_LOTS = 20;
const MAX_LOT_NAME = 60;
const MAX_LOT_SPACES = 100000;
const DEFAULT_MAIN_LOT_NAME = "Lot 1";

const LOT_MESSAGES = Object.freeze({
  lot_name_required: "Give the lot a name.",
  lot_name_taken: "Another lot already has that name.",
  lot_spaces_invalid: "Enter how many spaces the lot has, zero or more.",
  lot_blocked_invalid:
    "Blocked spaces must be zero or more, and no more than the lot has.",
  lot_not_found: "That lot was not found. Refresh and try again.",
  lot_closed: "That lot is closed. Choose another lot.",
  lot_full: "That lot is full. Choose another lot.",
  lot_has_cars:
    "There are still cars in that lot. Move them to another lot first.",
  lot_last_open: "A business that parks cars needs at least one open lot.",
  lot_limit: "That is the most lots a business can have.",
});

function text(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function wholeNumber(value) {
  if (value === undefined || value === null || value === "") return NaN;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * @param {string} businessId The business.
 * @return {string} The id of its first lot: the one its existing cars stand
 *   in, and the one a car with no `parkingLotId` is read as standing in.
 */
function mainLotId(businessId) {
  return `${text(businessId, 180)}_main`;
}

/**
 * @param {object} lot A parkingLots row.
 * @return {boolean} Whether cars can be parked in it (absent means open).
 */
function lotIsOpen(lot) {
  return Boolean(lot) && lot.active !== false;
}

/**
 * The lot a car stands in. A car parked before lots existed, and one the
 * old phone app parked, carries none: it is in the business's first lot.
 *
 * @param {object} car A parkedCars row.
 * @param {string} businessId The car's business.
 * @return {string} The lot id.
 */
function lotIdOfCar(car, businessId) {
  return text(car?.parkingLotId, 200) ||
    mainLotId(businessId || car?.businessId);
}

/**
 * What the owner typed for a lot, cleaned, and what is wrong with it.
 *
 * @param {object} raw {name, addressLine1, city, state, zipCode,
 *   totalSpaces, blockedSpaces, active}.
 * @param {{lots: object[], lotId: string}} [context] The business's other
 *   lots (for the name check) and the lot being edited.
 * @return {{value: object, errors: string[]}} The stored fields and the
 *   LOT_MESSAGES codes.
 */
function normalizeLot(raw, context = {}) {
  const row = raw && typeof raw === "object" ? raw : {};
  const errors = [];
  const name = text(row.name, MAX_LOT_NAME);
  if (!name) errors.push("lot_name_required");
  const taken = (context.lots || []).some((lot) =>
    String(lot?.id || "") !== String(context.lotId || "") &&
    text(lot?.name, MAX_LOT_NAME).toLowerCase() === name.toLowerCase());
  if (name && taken) errors.push("lot_name_taken");
  const totalSpaces = wholeNumber(row.totalSpaces);
  if (!(totalSpaces >= 0 && totalSpaces <= MAX_LOT_SPACES)) {
    errors.push("lot_spaces_invalid");
  }
  const blockedSpaces = row.blockedSpaces === undefined ||
    row.blockedSpaces === null || row.blockedSpaces === "" ?
    0 : wholeNumber(row.blockedSpaces);
  if (!(blockedSpaces >= 0) ||
      (Number.isInteger(totalSpaces) && blockedSpaces > totalSpaces)) {
    errors.push("lot_blocked_invalid");
  }
  return {
    value: {
      name,
      addressLine1: text(row.addressLine1, 200),
      city: text(row.city, 120),
      state: text(row.state, 80),
      zipCode: text(row.zipCode, 20),
      totalSpaces: Number.isInteger(totalSpaces) ? totalSpaces : 0,
      blockedSpaces: Number.isInteger(blockedSpaces) ? blockedSpaces : 0,
      active: row.active !== false,
    },
    errors,
  };
}

/**
 * The first lot of a business that had none: its own parking settings,
 * under the default name. Every car it already has stands here.
 *
 * @param {object} business The business record.
 * @return {object} The lot's stored fields (no ids, no timestamps).
 */
function mainLotFromBusiness(business) {
  const row = business && typeof business === "object" ? business : {};
  const total = wholeNumber(row.parkingTotalSpaces);
  const blocked = wholeNumber(row.parkingBlockedSpaces);
  const totalSpaces = total >= 0 ? Math.min(total, MAX_LOT_SPACES) : 0;
  return {
    name: DEFAULT_MAIN_LOT_NAME,
    // Blank: the lot stands at the business's own parking address, and
    // follows it when the owner corrects that address.
    addressLine1: "",
    city: "",
    state: "",
    zipCode: "",
    totalSpaces,
    blockedSpaces: blocked >= 0 ? Math.min(blocked, totalSpaces) : 0,
    active: true,
    isMain: true,
  };
}

/**
 * The business's two space numbers: the sum over its open lots. Kept on
 * the business record so the customer search and the totals read one
 * combined figure, as they always did.
 *
 * @param {object[]} lots The business's parkingLots rows.
 * @return {{parkingTotalSpaces: number, parkingBlockedSpaces: number}} The
 *   sums.
 */
function businessSpaceTotals(lots) {
  let total = 0;
  let blocked = 0;
  for (const lot of lots || []) {
    if (!lotIsOpen(lot)) continue;
    total += Math.max(0, wholeNumber(lot.totalSpaces) || 0);
    blocked += Math.max(0, wholeNumber(lot.blockedSpaces) || 0);
  }
  return {parkingTotalSpaces: total, parkingBlockedSpaces: blocked};
}

/**
 * The cars that hold a space in one lot during [start, end].
 *
 * @param {object} args {lotId, businessId, reservations, start, end,
 *   exceptCarId (a car being moved or edited never competes with itself)}.
 * @return {number} How many.
 */
function lotOccupancy({lotId, businessId, reservations, start, end,
  exceptCarId = ""}) {
  return (reservations || []).filter((row) =>
    (!exceptCarId || String(row?.id || "") !== String(exceptCarId)) &&
    isActiveParkingRow(row) && parkingRangeOverlaps(row, start, end) &&
    lotIdOfCar(row, businessId) === lotId,
  ).length;
}

/**
 * Free spaces in one lot for a window: its spaces minus the blocked ones
 * minus every active stay in it that overlaps the window.
 *
 * @param {object} args {lot, businessId, reservations, start, end,
 *   exceptCarId}.
 * @return {number} Spaces free, never negative; zero for a closed lot.
 */
function lotAvailability(args) {
  const lot = args?.lot;
  if (!lotIsOpen(lot)) return 0;
  const total = Math.max(0, wholeNumber(lot.totalSpaces) || 0);
  const blocked = Math.max(0, wholeNumber(lot.blockedSpaces) || 0);
  return Math.max(0, total - blocked - lotOccupancy({
    lotId: String(lot.id || ""), businessId: args.businessId,
    reservations: args.reservations, start: args.start, end: args.end,
    exceptCarId: args.exceptCarId,
  }));
}

/**
 * Open lots in the order staff see them: by `sortOrder`, the first lot
 * before the others, then by name.
 *
 * @param {object[]} lots parkingLots rows.
 * @return {object[]} The open ones, sorted.
 */
function openLots(lots) {
  return (lots || []).filter(lotIsOpen).sort((a, b) =>
    (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
    (b.isMain === true) - (a.isMain === true) ||
    text(a.name, MAX_LOT_NAME).localeCompare(text(b.name, MAX_LOT_NAME)));
}

/**
 * The lot a staff member's new car goes into: the one they chose; else the
 * one they used last, when it is still open; else the business's first open
 * lot. (The website and the new app always send a choice; the old app sends
 * none.) A chosen lot that is unknown or closed is refused, never swapped.
 *
 * @param {object} args {lots, requestedLotId, lastLotId}.
 * @return {{lot: (object|null), refusal: string}} The lot, or why not.
 */
function resolveEntryLot({lots, requestedLotId, lastLotId}) {
  const wanted = text(requestedLotId, 200);
  if (wanted) {
    const lot = (lots || []).find((row) => String(row?.id || "") === wanted);
    if (!lot) return {lot: null, refusal: "lot_not_found"};
    if (!lotIsOpen(lot)) return {lot: null, refusal: "lot_closed"};
    return {lot, refusal: ""};
  }
  const open = openLots(lots);
  const last = open.find((row) =>
    String(row.id || "") === text(lastLotId, 200));
  const lot = last || open[0] || null;
  return {lot, refusal: lot ? "" : "lot_not_found"};
}

/**
 * The lot an online booking goes into: the one the owner chose for
 * bookings when it has room, else the next open lot with room.
 *
 * @param {object} args {lots, bookingLotId, businessId, reservations,
 *   start, end}.
 * @return {object|null} The lot, or null when every lot is full.
 */
function pickBookingLot({lots, bookingLotId, businessId, reservations,
  start, end}) {
  const open = openLots(lots);
  const chosen = open.find((lot) =>
    String(lot.id || "") === text(bookingLotId, 200));
  const order = chosen ? [chosen, ...open.filter((l) => l !== chosen)] : open;
  return order.find((lot) => lotAvailability(
      {lot, businessId, reservations, start, end}) > 0) || null;
}

/**
 * Why a lot may not be closed: cars still stand in it, or it is the last
 * open one.
 *
 * @param {object} args {lot, lots, businessId, reservations, now}.
 * @return {string} A LOT_MESSAGES code, or "" to close it.
 */
function lotCloseRefusal({lot, lots, businessId, reservations, now}) {
  const others = (lots || []).filter((row) =>
    String(row?.id || "") !== String(lot?.id || "") && lotIsOpen(row));
  if (others.length === 0) return "lot_last_open";
  const cars = lotOccupancy({lotId: String(lot?.id || ""), businessId,
    reservations, start: now || new Date(), end: null});
  return cars > 0 ? "lot_has_cars" : "";
}

/**
 * Where a lot is: its own address when it has one, else the business's
 * parking address (then its office address), as a car record stores it.
 *
 * @param {object} lot A parkingLots row (or null).
 * @param {object} business The business record.
 * @return {{parkingAddress: string, parkingCity: string,
 *   parkingState: string}} The copied fields.
 */
function lotAddress(lot, business) {
  const own = text(lot?.addressLine1, 200);
  if (own) {
    return {
      parkingAddress: own,
      parkingCity: text(lot.city, 120),
      parkingState: text(lot.state, 80),
    };
  }
  return {
    parkingAddress: text(
        business?.parkingAddressLine1 || business?.addressLine1, 200),
    parkingCity: text(business?.parkingCity || business?.city, 120),
    parkingState: text(business?.parkingState || business?.state, 80),
  };
}

/**
 * The fields a car record carries about its lot. Written by the server on
 * create, on a booking and on a move; the name and address are copies, so
 * the customer's page and the receipt need no second read.
 *
 * @param {object} lot The lot.
 * @param {object} business The business record.
 * @return {object} {parkingLotId, parkingLotName, parkingAddress,
 *   parkingCity, parkingState}.
 */
function carLotFields(lot, business) {
  return {
    parkingLotId: String(lot?.id || ""),
    parkingLotName: text(lot?.name, MAX_LOT_NAME),
    ...lotAddress(lot, business),
  };
}

/**
 * The History line of a move.
 *
 * @param {string} fromName The lot it left.
 * @param {string} toName The lot it went to.
 * @return {string} "Moved from Lot 1 to Lot 2".
 */
function lotMoveSummary(fromName, toName) {
  return `Moved from ${text(fromName, MAX_LOT_NAME) || "its lot"} to ` +
    `${text(toName, MAX_LOT_NAME) || "another lot"}`;
}

module.exports = {
  DEFAULT_MAIN_LOT_NAME,
  LOT_MESSAGES,
  MAX_LOTS,
  MAX_LOT_NAME,
  businessSpaceTotals,
  carLotFields,
  lotAddress,
  lotAvailability,
  lotCloseRefusal,
  lotIdOfCar,
  lotIsOpen,
  lotMoveSummary,
  lotOccupancy,
  mainLotFromBusiness,
  mainLotId,
  normalizeLot,
  openLots,
  pickBookingLot,
  resolveEntryLot,
};

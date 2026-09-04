"use strict";

/**
 * Lot ledger — the authority for activity records, the activity catalogue,
 * and the expense ledger (design_handoff_lot_ledger).
 *
 * A deliberate mirror of the console's pure module,
 * `admin_web/src/lib/lot-ledger.ts`. It validates input and decides the
 * statuses each payment method produces; every Firestore and Stripe call
 * stays with the caller in `index.js`, as `business_parking_entry.js` does.
 *
 * The activity catalogue (`lotActivityTypes`) is per-business data, never a
 * hard-coded enum: the four Keren activities are seed rows, nothing more.
 * Repricing a type changes future entries only; a recorded `feeCents` is
 * never rewritten, and `activityTypeLabel` is denormalised at write time so
 * a later rename does not silently rewrite last quarter's entries.
 */

const LOT_ACTIVITY_PAYMENT_METHODS = Object.freeze([
  "payment_link",
  "direct",
]);
const LOT_CUSTOM_ACTIVITY_ID = "custom";

const LOT_DIRECT_METHODS = Object.freeze([
  "zelle",
  "cash",
  "cashapp",
  "venmo",
  "check",
  "card_in_person",
  "other",
]);

const LOT_AUCTION_HOUSES = Object.freeze([
  "ACV",
  "IAAI",
  "Copart",
  "Adesa",
  "Manheim",
  "Other",
]);

const LOT_EXPENSE_KINDS = Object.freeze(["fixed", "metered", "one_off"]);

const LOT_ACTIVITY_PAYMENT_STATUS = Object.freeze({
  SUCCEEDED: "succeeded",
  AWAITING_LINK: "awaiting_payment_link",
  AWAITING_DIRECT: "awaiting_direct_payment",
  CANCELLED: "cancelled",
});

const LOT_ACTIVITY_PAYMENT_TYPE = "lot_activity";
const DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS = 7500;

/**
 * The four activities a new lot business starts with (the Keren workbook).
 * Seed data, nothing more: a business renames, reprices, or adds its own from
 * here. Only "Title purchase at auction" needs the auction-house field.
 */
const LOT_ACTIVITY_SEED_TYPES = Object.freeze([
  {label: "Title purchase at auction", defaultFeeCents: 0,
    needsAuctionHouse: true, sortOrder: 0},
  {label: "Dispatch", defaultFeeCents: 0, needsAuctionHouse: false,
    sortOrder: 1},
  {label: "Reassignment", defaultFeeCents: 0, needsAuctionHouse: false,
    sortOrder: 2},
  {label: "Storage release", defaultFeeCents: 0, needsAuctionHouse: false,
    sortOrder: 3},
]);

const MAX_TEXT = 200;
const MAX_LABEL = 120;
const MAX_NOTE = 500;
const MAX_VIN = 17;

const text = (value, max = MAX_TEXT) =>
  String(value ?? "").trim().slice(0, max);
const intCents = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * @param {*} value Free text.
 * @return {string} A known off-platform method, or "other".
 */
function normalizeReceivedVia(value) {
  const v = text(value, 40).toLowerCase();
  return LOT_DIRECT_METHODS.includes(v) ? v : "other";
}

/**
 * @param {*} value Free text.
 * @return {string} A known auction house, or "".
 */
function normalizeAuctionHouse(value) {
  const v = text(value, 40);
  return LOT_AUCTION_HOUSES.includes(v) ? v : "";
}

// -------------------------------------------------------------------------
// Activity types (the catalogue).
// -------------------------------------------------------------------------

/**
 * @param {object} input Raw callable data.
 * @return {string[]} Error codes, every problem at once.
 */
function validateLotActivityType(input) {
  const errors = [];
  if (!text(input?.label, MAX_LABEL)) {
    errors.push("activity_type_label_required");
  }
  const fee = intCents(input?.defaultFeeCents);
  if (!Number.isFinite(fee) || fee < 0) {
    errors.push("activity_type_fee_invalid");
  }
  return errors;
}

/**
 * @param {object} input Validated callable data.
 * @return {object} The activity-type record body.
 */
function lotActivityTypeRecord(input) {
  const sortOrder = Number(input.sortOrder);
  return {
    label: text(input.label, MAX_LABEL),
    defaultFeeCents: Math.max(0, intCents(input.defaultFeeCents) || 0),
    needsAuctionHouse: input.needsAuctionHouse === true,
    active: input.active !== false,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
  };
}

// -------------------------------------------------------------------------
// A recorded activity.
// -------------------------------------------------------------------------

/**
 * @param {object} input Raw callable data.
 * @param {object} opts { knownTypeIds: string[] }.
 * @return {string[]} Error codes.
 */
function validateLotActivity(input, opts = {}) {
  const errors = [];
  const knownTypeIds = Array.isArray(opts.knownTypeIds) ?
    opts.knownTypeIds : [];

  const typeId = text(input?.activityTypeId, MAX_LABEL);
  const isCustom = typeId === LOT_CUSTOM_ACTIVITY_ID;
  if (!typeId || (!isCustom && !knownTypeIds.includes(typeId))) {
    errors.push("activity_type_invalid");
  }
  if (isCustom && !text(input?.customLabel, MAX_LABEL)) {
    errors.push("custom_label_required");
  }

  const fee = intCents(input?.feeCents);
  if (!Number.isFinite(fee) || fee < 0) errors.push("fee_required");
  if (!text(input?.activityDate, 60)) errors.push("activity_date_required");
  if (!text(input?.customerName)) errors.push("customer_name_required");
  if (!text(input?.vinNumber, MAX_VIN)) errors.push("vin_required");

  const method = text(input?.paymentMethod, 40);
  if (!LOT_ACTIVITY_PAYMENT_METHODS.includes(method)) {
    errors.push("payment_method_invalid");
  }

  const phone = text(input?.customerPhone, 40);
  const email = text(input?.customerEmail, 180).toLowerCase();
  if (method === "payment_link" && !phone && !email) {
    errors.push("payment_link_contact_required");
  }
  if (method === "direct" && !text(input?.receivedByStaffId, MAX_LABEL)) {
    errors.push("received_by_required");
  }

  return errors;
}

/**
 * The record body, minus the money the caller resolves (feeCents is
 * recomputed from the type unless overridden; label is denormalised).
 *
 * @param {object} input Validated callable data.
 * @param {object} opts Resolved fee, label, and staff ids.
 * @return {object} Fields to write, sans Stripe/status.
 */
function lotActivityRecord(input, opts) {
  const method = text(input.paymentMethod, 40);
  const typeId = text(input.activityTypeId, MAX_LABEL);
  const isCustom = typeId === LOT_CUSTOM_ACTIVITY_ID;
  const direct = method === "direct";
  return {
    activityTypeId: typeId,
    activityTypeLabel: text(opts.activityTypeLabel, MAX_LABEL),
    customLabel: isCustom ? text(input.customLabel, MAX_LABEL) : "",
    feeCents: Math.max(0, intCents(opts.feeCents) || 0),
    feeOverridden: opts.feeOverridden === true,
    customerName: text(input.customerName),
    customerPhone: text(input.customerPhone, 40),
    customerEmail: text(input.customerEmail, 180).toLowerCase(),
    carMake: text(input.carMake, 80),
    carModel: text(input.carModel, 80),
    carYear: text(input.carYear, 8),
    vinNumber: text(input.vinNumber, MAX_VIN).toUpperCase(),
    auctionHouse: normalizeAuctionHouse(input.auctionHouse),
    paymentMethod: method,
    receivedVia: direct ? normalizeReceivedVia(input.receivedVia) : "",
    receivedByStaffId: direct ?
      text(input.receivedByStaffId, MAX_LABEL) : "",
    recordedByStaffId: text(opts.recordedByStaffId, MAX_LABEL),
  };
}

/**
 * Which status a fresh entry lands in. A link waits for the website; money
 * taken off-platform is already in hand.
 *
 * @param {string} method payment_link | direct.
 * @return {{status: string, needsStripe: boolean}} The initial state.
 */
function lotActivityInitialStatus(method) {
  if (method === "direct") {
    return {status: LOT_ACTIVITY_PAYMENT_STATUS.SUCCEEDED, needsStripe: false};
  }
  return {
    status: LOT_ACTIVITY_PAYMENT_STATUS.AWAITING_LINK,
    needsStripe: true,
  };
}

// -------------------------------------------------------------------------
// Expenses.
// -------------------------------------------------------------------------

/**
 * @param {number} amountCents The purchase amount.
 * @param {number} thresholdCents The business's proof threshold.
 * @return {boolean} Whether a receipt is required.
 */
function expenseProofRequired(amountCents, thresholdCents) {
  const threshold = Number(thresholdCents) || 0;
  if (threshold <= 0) return false;
  return (Number(amountCents) || 0) >= threshold;
}

/**
 * @param {object} input Raw callable data.
 * @param {object} opts { thresholdCents, hasProof }.
 * @return {string[]} Error codes.
 */
function validateLotExpenseEntry(input, opts = {}) {
  const errors = [];
  const cents = intCents(input?.amountCents);
  if (!Number.isFinite(cents) || cents <= 0) {
    errors.push("expense_amount_required");
  }
  if (!text(input?.spentAt, 60)) errors.push("expense_date_required");
  if (!text(input?.paidByStaffId, MAX_LABEL)) {
    errors.push("expense_paid_by_required");
  }
  const threshold = Number.isFinite(Number(opts.thresholdCents)) ?
    Number(opts.thresholdCents) : DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS;
  if (
    Number.isFinite(cents) &&
    expenseProofRequired(cents, threshold) &&
    opts.hasProof !== true
  ) {
    errors.push("expense_proof_required");
  }
  return errors;
}

/**
 * @param {object} input Validated callable data.
 * @param {object} opts { recordedByStaffId, thresholdCents }.
 * @return {object} The expense-entry record body.
 */
function lotExpenseEntryRecord(input, opts) {
  const cents = Math.max(0, intCents(input.amountCents) || 0);
  const threshold = Number.isFinite(Number(opts.thresholdCents)) ?
    Number(opts.thresholdCents) : DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS;
  return {
    lineId: text(input.lineId, MAX_LABEL),
    month: text(input.month, 7),
    amountCents: cents,
    paidByStaffId: text(input.paidByStaffId, MAX_LABEL),
    recordedByStaffId: text(opts.recordedByStaffId, MAX_LABEL),
    note: text(input.note, MAX_NOTE),
    // Snapshot the rule at entry time so raising the threshold later does
    // not retroactively mark old entries non-compliant.
    proofRequired: expenseProofRequired(cents, threshold),
  };
}

/**
 * @param {object} input Raw callable data.
 * @return {string[]} Error codes.
 */
function validateLotExpenseLine(input) {
  const errors = [];
  if (!text(input?.label, MAX_LABEL)) {
    errors.push("expense_line_label_required");
  }
  const kind = text(input?.kind, 20);
  if (!LOT_EXPENSE_KINDS.includes(kind)) {
    errors.push("expense_line_kind_invalid");
  }
  return errors;
}

module.exports = {
  LOT_ACTIVITY_PAYMENT_METHODS,
  LOT_CUSTOM_ACTIVITY_ID,
  LOT_DIRECT_METHODS,
  LOT_AUCTION_HOUSES,
  LOT_EXPENSE_KINDS,
  LOT_ACTIVITY_PAYMENT_STATUS,
  LOT_ACTIVITY_PAYMENT_TYPE,
  DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS,
  LOT_ACTIVITY_SEED_TYPES,
  normalizeReceivedVia,
  normalizeAuctionHouse,
  validateLotActivityType,
  lotActivityTypeRecord,
  validateLotActivity,
  lotActivityRecord,
  lotActivityInitialStatus,
  expenseProofRequired,
  validateLotExpenseEntry,
  lotExpenseEntryRecord,
  validateLotExpenseLine,
};

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
    // Absent means yes, so every type written before this flag existed still
    // demands a VIN. Only a type that opts out records work with no car.
    needsVehicle: input.needsVehicle !== false,
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
  // A VIN identifies the car the job was done to. Work with no car - lending
  // an auction account, say - has none, and typing a 17-character placeholder
  // to clear this check is how the ledger fills up with fictional vehicles.
  // The type decides; absent means yes, so car work keeps the guard.
  if (opts.needsVehicle !== false && !text(input?.vinNumber, MAX_VIN)) {
    errors.push("vin_required");
  }

  const method = text(input?.paymentMethod, 40);
  if (!LOT_ACTIVITY_PAYMENT_METHODS.includes(method)) {
    errors.push("payment_method_invalid");
  }

  const phone = text(input?.customerPhone, 40);
  const email = text(input?.customerEmail, 180).toLowerCase();
  if (method === "payment_link" && !phone && !email) {
    errors.push("payment_link_contact_required");
  }
  // Money taken off-platform must say who held it - but only when it has
  // actually been received. An activity can be logged before the money comes
  // in (paymentReceived === false), and then there is no one to name yet.
  if (method === "direct" &&
      input?.paymentReceived !== false &&
      !text(input?.receivedByStaffId, MAX_LABEL)) {
    errors.push("received_by_required");
  }

  return errors;
}

/**
 * Whether a direct activity's fee is already in hand. Absent means yes, so a
 * record written before this flag existed still reads as paid.
 *
 * @param {object} input The callable data.
 * @return {boolean} True when the money has been received.
 */
function lotActivityDirectReceived(input) {
  return (input || {}).paymentReceived !== false;
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
  // Received fields are stored only when the money is actually in hand; a
  // direct activity logged as not-yet-paid carries none of them.
  const direct = method === "direct" && lotActivityDirectReceived(input);
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
 * @param {boolean} [received] For a direct activity, whether the money is
 *   already in hand. Absent means yes.
 * @return {{status: string, needsStripe: boolean}} The initial state.
 */
function lotActivityInitialStatus(method, received = true) {
  if (method === "direct") {
    // Direct money already in hand is settled; a direct activity logged before
    // the money arrives waits as awaiting-direct until it is marked received.
    return {
      status: received ?
        LOT_ACTIVITY_PAYMENT_STATUS.SUCCEEDED :
        LOT_ACTIVITY_PAYMENT_STATUS.AWAITING_DIRECT,
      needsStripe: false,
    };
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
 * Why an ordinary edit of a recorded activity must be refused, if it must.
 *
 * Money rules, not form rules:
 * - a voided row is history; record a new one instead of reviving it;
 * - a paid row's amount is what the customer actually paid, so it cannot be
 *   edited into a different number after the fact;
 * - how a row is paid changes only through the payment actions ("record as
 *   paid outside" / re-send the link), which cancel the other path. An edit
 *   that flips the method would skip those checks.
 *
 * @param {object} current The stored activity.
 * @param {object} changes The proposed edit (validated callable data).
 * @param {number} nextFeeCents The fee the edit would store.
 * @return {string|null} An error code, or null when the edit may proceed.
 */
function lotActivityEditRefusal(current, changes, nextFeeCents) {
  const row = current && typeof current === "object" ? current : {};
  if (row.voided === true) return "activity_voided";
  const currentMethod = text(row.paymentMethod, 40);
  const nextMethod = text(changes?.paymentMethod, 40);
  if (currentMethod && nextMethod && nextMethod !== currentMethod) {
    return "payment_method_locked";
  }
  const paid = text(row.paymentStatus, 40) ===
    LOT_ACTIVITY_PAYMENT_STATUS.SUCCEEDED;
  const currentFee = Math.max(0, intCents(row.feeCents) || 0);
  const nextFee = Math.max(0, intCents(nextFeeCents) || 0);
  if (paid && nextFee !== currentFee) return "paid_amount_locked";
  // A part-paid total may still move - they extend, or a fee is added - but
  // never below what has already been collected. A $1,000 job holding $350
  // cannot become a $40 job: that would owe the customer money, and this
  // platform has no way to give it back.
  const collected = lotActivityPaidCents(row);
  if (collected > 0 && nextFee < collected) return "below_amount_paid";
  return null;
}

// -------------------------------------------------------------------------
// Instalments.
//
// An activity's `feeCents` is what was agreed; `amountPaidCents` is what has
// actually arrived, across any number of payments in either direction - cash
// taken at the lot, or card taken on the customer's link. The two rails run
// against one balance and in any order, so the rail belongs to each payment
// rather than to the job.
//
// `paymentStatus` deliberately gains no "part paid" member: it still means
// settled or not, and part-paid is derived from the two numbers. A status
// enum that grows a middle value silently changes what every existing reader
// of `succeeded` believes.
// -------------------------------------------------------------------------

/**
 * Card fees are a percentage plus a fixed 30 cents, so tiny card payments
 * lose a large share of themselves - a dollar costs a third of a dollar to
 * collect. Cash has no floor: staff record whatever they were handed.
 */
const LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS = 2000;

const LOT_ACTIVITY_PAYMENT_SOURCES = Object.freeze(["cash", "card"]);

/**
 * What has actually been collected against an activity. Absent means nothing,
 * so a record written before instalments existed reads as unpaid unless its
 * status says otherwise.
 *
 * @param {object} row The stored activity.
 * @return {number} Cents collected so far.
 */
function lotActivityPaidCents(row) {
  const data = row && typeof row === "object" ? row : {};
  const stored = Math.max(0, intCents(data.amountPaidCents) || 0);
  if (stored > 0) return stored;
  // Settled before instalments existed: the whole fee was collected in one
  // go and no running total was ever written.
  if (text(data.paymentStatus, 40) ===
      LOT_ACTIVITY_PAYMENT_STATUS.SUCCEEDED) {
    return Math.max(0, intCents(data.feeCents) || 0);
  }
  return 0;
}

/**
 * @param {object} row The stored activity.
 * @return {number} Cents still owed, never below zero.
 */
function lotActivityRemainingCents(row) {
  const data = row && typeof row === "object" ? row : {};
  const fee = Math.max(0, intCents(data.feeCents) || 0);
  return Math.max(0, fee - lotActivityPaidCents(data));
}

/**
 * Money has arrived but the job is not settled. A voided job is never part
 * paid for display purposes - it is dead, and its balance is not chased.
 *
 * @param {object} row The stored activity.
 * @return {boolean} True when some but not all of the fee is in.
 */
function lotActivityPartlyPaid(row) {
  const data = row && typeof row === "object" ? row : {};
  if (data.voided === true) return false;
  const paid = lotActivityPaidCents(data);
  return paid > 0 && paid < Math.max(0, intCents(data.feeCents) || 0);
}

/**
 * Plan one instalment against an activity.
 *
 * Cash is clamped to the balance: staff typing more than is owed is a typo,
 * not a tip - the same call parking already makes. Card is never clamped,
 * because by the time this runs Stripe has already taken the money; an
 * overspill is reported as `overpaidCents` so it can be shown and settled
 * deliberately rather than silently kept or silently refunded.
 *
 * @param {{activity: !Object, amountCents: *, source: string}} params The
 *   stored activity, the amount offered, and which rail it came in on.
 * @return {{ok: boolean, reason: (string|undefined), appliedCents: number,
 *   overpaidCents: number, newPaidCents: number, remainingCents: number,
 *   fullyCovered: boolean}} The plan.
 */
function lotActivityPaymentPlan({activity, amountCents, source}) {
  const data = activity && typeof activity === "object" ? activity : {};
  const rail = LOT_ACTIVITY_PAYMENT_SOURCES.includes(text(source, 10)) ?
    text(source, 10) : "cash";

  if (data.voided === true) return lotPaymentRefusal("activity_voided");
  if (text(data.paymentStatus, 40) ===
      LOT_ACTIVITY_PAYMENT_STATUS.CANCELLED) {
    return lotPaymentRefusal("activity_cancelled");
  }

  const fee = Math.max(0, intCents(data.feeCents) || 0);
  if (fee <= 0) return lotPaymentRefusal("nothing_to_pay");

  const alreadyPaid = lotActivityPaidCents(data);
  const remaining = Math.max(0, fee - alreadyPaid);
  if (remaining <= 0) return lotPaymentRefusal("already_paid");

  let applied = Math.round(Number(amountCents));
  if (!Number.isFinite(applied) || applied <= 0) {
    return lotPaymentRefusal("no_amount");
  }
  if (rail === "card" && applied < LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS) {
    return lotPaymentRefusal("below_card_minimum");
  }

  let overpaid = 0;
  if (rail === "card") {
    overpaid = Math.max(0, applied - remaining);
    applied = Math.min(applied, remaining);
  } else {
    applied = Math.min(applied, remaining);
  }

  const newPaidCents = alreadyPaid + applied;
  return {
    ok: true,
    appliedCents: applied,
    overpaidCents: overpaid,
    newPaidCents,
    remainingCents: Math.max(0, fee - newPaidCents),
    fullyCovered: newPaidCents >= fee,
  };
}

/**
 * @param {string} reason Why the payment cannot be applied.
 * @return {object} A refusal in the plan's shape.
 */
function lotPaymentRefusal(reason) {
  return {ok: false, reason, appliedCents: 0, overpaidCents: 0,
    newPaidCents: 0, remainingCents: 0, fullyCovered: false};
}

/**
 * One instalment, as stored. Its own month key is the point: a job recorded
 * in September and paid in November is November's income, and a scoreboard
 * that reads the activity's month would never see it.
 *
 * @param {object} input The applied plan and its provenance.
 * @return {object} The payment record body.
 */
function lotActivityPaymentRecord(input) {
  const rail = LOT_ACTIVITY_PAYMENT_SOURCES.includes(text(input.source, 10)) ?
    text(input.source, 10) : "cash";
  return {
    businessId: text(input.businessId, MAX_LABEL),
    activityId: text(input.activityId, MAX_LABEL),
    amountCents: Math.max(0, intCents(input.amountCents) || 0),
    overpaidCents: Math.max(0, intCents(input.overpaidCents) || 0),
    source: rail,
    receivedVia: rail === "cash" ? normalizeReceivedVia(input.receivedVia) : "",
    receivedByStaffId: rail === "cash" ?
      text(input.receivedByStaffId, MAX_LABEL) : "",
    recordedByStaffId: text(input.recordedByStaffId, MAX_LABEL),
    paidAtMonth: text(input.paidAtMonth, 7),
    note: text(input.note, 300),
  };
}

/**
 * The payment fields an edit may never rewrite. Spread over the new record
 * so an edit keeps how (and by whom) the money was taken exactly as stored.
 *
 * @param {object} current The stored activity.
 * @return {object} paymentMethod/receivedVia/receivedByStaffId as stored.
 */
function lotActivityLockedPaymentFields(current) {
  const row = current && typeof current === "object" ? current : {};
  return {
    paymentMethod: text(row.paymentMethod, 40),
    receivedVia: text(row.receivedVia, 40),
    receivedByStaffId: text(row.receivedByStaffId, MAX_LABEL),
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
  lotActivityDirectReceived,
  lotActivityEditRefusal,
  lotActivityLockedPaymentFields,
  LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS,
  LOT_ACTIVITY_PAYMENT_SOURCES,
  lotActivityPaidCents,
  lotActivityRemainingCents,
  lotActivityPartlyPaid,
  lotActivityPaymentPlan,
  lotActivityPaymentRecord,
  expenseProofRequired,
  validateLotExpenseEntry,
  lotExpenseEntryRecord,
  validateLotExpenseLine,
};

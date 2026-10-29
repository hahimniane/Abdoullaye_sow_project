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

const crypto = require("node:crypto");

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
    // Stored as its key (upper case, no spaces) so the duplicate rule's
    // same-VIN lookup is one equality query.
    vinNumber: lotVinKey(text(input.vinNumber, 40)).slice(0, MAX_VIN),
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

// -------------------------------------------------------------------------
// The VIN duplicate rule (owner decision 2026-10-22).
//
// One car, one job, one customer: an active activity with the same VIN key,
// the same job key and the same customer is a mistake (a double tap, or the
// same job typed twice) and is refused outright. The same car and job for a
// DIFFERENT customer may be real - the car was sold on and the new owner had
// it done again - so it is allowed once someone confirms it, and the owner
// is told. Activities with no VIN are never checked. "Active" is what
// voidLotActivity leaves alive: `voided !== true` (a voided unpaid link also
// turns `cancelled`, but never without `voided`).
// -------------------------------------------------------------------------

/**
 * @param {*} value A VIN as typed or stored.
 * @return {string} Upper case with every space removed ("" for none).
 */
function lotVinKey(value) {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "");
}

/**
 * Which job an activity is: its type, or for a one-off what was typed.
 *
 * @param {object} activity activityTypeId / customLabel.
 * @return {string} The job key, "" when there is none.
 */
function lotJobKey(activity) {
  const row = activity && typeof activity === "object" ? activity : {};
  const typeId = text(row.activityTypeId, MAX_LABEL);
  if (!typeId) return "";
  if (typeId !== LOT_CUSTOM_ACTIVITY_ID) return typeId;
  const label = text(row.customLabel, MAX_LABEL).toLowerCase();
  return label ? `${LOT_CUSTOM_ACTIVITY_ID}:${label}` : "";
}

/**
 * @param {*} value A phone number as typed.
 * @return {string} Its digits.
 */
function lotPhoneDigits(value) {
  return String(value ?? "").replace(/\D+/g, "");
}

/**
 * @param {*} value A name as typed.
 * @return {string} Lower case with every space removed.
 */
function lotNameKey(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

/**
 * Whether two activities are for the same customer. When both carry a
 * phone, the phone decides (digits only; the last 10 when both have 10 or
 * more, so "+1 (201) 555-1234" is "2015551234"); otherwise the name does,
 * case- and space-insensitive. Two people who share a name but not a phone
 * stay two people.
 *
 * @param {object} a customerName / customerPhone.
 * @param {object} b customerName / customerPhone.
 * @return {boolean} True for the same customer.
 */
function lotSameCustomer(a, b) {
  const pa = lotPhoneDigits(a?.customerPhone);
  const pb = lotPhoneDigits(b?.customerPhone);
  if (pa && pb) {
    return pa.length >= 10 && pb.length >= 10 ?
      pa.slice(-10) === pb.slice(-10) : pa === pb;
  }
  const na = lotNameKey(a?.customerName);
  return Boolean(na) && na === lotNameKey(b?.customerName);
}

/**
 * The customer half of a lock id: the phone when there is one (its last 10
 * digits from 10 on), else the name. Two records with the same key are
 * always the same customer by lotSameCustomer; the converse is checked by
 * the same-VIN query, not the lock.
 *
 * @param {object} activity customerName / customerPhone.
 * @return {string} "p:<digits>", "n:<name>", or "".
 */
function lotCustomerMatchKey(activity) {
  const phone = lotPhoneDigits(activity?.customerPhone);
  if (phone) return `p:${phone.length >= 10 ? phone.slice(-10) : phone}`;
  const name = lotNameKey(activity?.customerName);
  return name ? `n:${name}` : "";
}

/**
 * @param {object} row A stored activity.
 * @return {boolean} True unless it was voided.
 */
function lotActivityActive(row) {
  return Boolean(row && typeof row === "object") && row.voided !== true;
}

/**
 * @param {string} value Any text.
 * @return {string} 16 hex characters of its SHA-256.
 */
function lotShortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex")
      .slice(0, 16);
}

/**
 * The lock document that makes the "same customer" refusal race-safe:
 * `lotVinJobLocks/{businessId}__{vin}__{job}__{customer}`. The job and the
 * customer are hashed - a one-off's label and a name are free text, and a
 * document id cannot hold "/".
 *
 * @param {string} businessId The business.
 * @param {object} activity The activity (as stored or about to be).
 * @return {string} The lock id, "" when the activity is never checked.
 */
function lotVinJobLockId(businessId, activity) {
  const biz = text(businessId, MAX_LABEL);
  const vinKey = lotVinKey(activity?.vinNumber);
  const jobKey = lotJobKey(activity);
  const customerKey = lotCustomerMatchKey(activity);
  if (!biz || !vinKey || !jobKey || !customerKey) return "";
  const vin = vinKey.replace(/[^A-Z0-9]/g, "_").slice(0, 40);
  return `${biz}__${vin}__${lotShortHash(jobKey)}__${
    lotShortHash(customerKey)}`;
}

/**
 * @param {object} activity The activity.
 * @return {string} "vinKey|jobKey|customerKey": what the rule depends on.
 */
function lotVinJobIdentity(activity) {
  return [lotVinKey(activity?.vinNumber), lotJobKey(activity),
    lotCustomerMatchKey(activity)].join("|");
}

/**
 * When an activity happened, in milliseconds. Reads a Firestore Timestamp,
 * a Date, an ISO string or a number.
 *
 * @param {*} value activityDate as stored.
 * @return {number} Milliseconds, or 0 when unknown.
 */
function lotDateMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * @param {object} a A stored activity.
 * @param {object} b Another.
 * @return {number} Oldest first; ties by id, so the order is stable.
 */
function byLotActivityDate(a, b) {
  const d = lotDateMs(a?.activityDate) - lotDateMs(b?.activityDate);
  if (d !== 0) return d;
  const x = String(a?.id ?? "");
  const y = String(b?.id ?? "");
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The candidate against the business's activities that share its VIN.
 *
 * @param {object} candidate The activity being created or edited.
 * @param {object[]} rows Stored activities (with `id`).
 * @param {{excludeId: (string|undefined)}} [opts] The activity itself, on
 *   an edit.
 * @return {{duplicate: ?object, repeats: object[]}} `duplicate`: an active
 *   one for the same customer (refused); `repeats`: active ones for other
 *   customers (allowed once confirmed), oldest first.
 */
function lotVinJobConflicts(candidate, rows, opts = {}) {
  const vinKey = lotVinKey(candidate?.vinNumber);
  const jobKey = lotJobKey(candidate);
  if (!vinKey || !jobKey) return {duplicate: null, repeats: []};
  const excludeId = text(opts.excludeId, MAX_LABEL);
  const seen = new Set();
  const same = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id ?? "");
    if (!lotActivityActive(row) || (excludeId && id === excludeId)) continue;
    if (seen.has(id)) continue;
    if (lotVinKey(row.vinNumber) !== vinKey) continue;
    if (lotJobKey(row) !== jobKey) continue;
    seen.add(id);
    same.push(row);
  }
  same.sort(byLotActivityDate);
  const duplicate = same.find((row) => lotSameCustomer(candidate, row)) ||
    null;
  return {duplicate, repeats: duplicate ? [] : same};
}

/**
 * What a record is called in a list or an alert: the type's label, or what
 * was typed for a one-off.
 *
 * @param {object} activity The activity.
 * @return {string} The job's name ("" when it has none).
 */
function lotJobLabel(activity) {
  const row = activity && typeof activity === "object" ? activity : {};
  const custom = text(row.activityTypeId, MAX_LABEL) === LOT_CUSTOM_ACTIVITY_ID;
  const typeLabel = text(row.activityTypeLabel, MAX_LABEL);
  const customLabel = text(row.customLabel, MAX_LABEL);
  return custom ? customLabel || typeLabel : typeLabel || customLabel;
}

/**
 * The business's possible duplicates: its active activities with a VIN,
 * grouped by VIN key + job key, every group of two or more. A group is
 * `sameCustomer` when any two of its records are for the same customer -
 * likely a mistake; otherwise every record is a different customer, which
 * may be a resale. Mistakes first, then the most recent group first.
 *
 * @param {object[]} rows Stored activities (with `id`).
 * @return {object[]} [{key, vinKey, jobKey, jobLabel, sameCustomer,
 *   activities}], each group's activities oldest first.
 */
function lotVinDuplicateGroups(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!lotActivityActive(row)) continue;
    const vinKey = lotVinKey(row.vinNumber);
    const jobKey = lotJobKey(row);
    if (!vinKey || !jobKey) continue;
    const key = `${vinKey}|${jobKey}`;
    if (!groups.has(key)) groups.set(key, {key, vinKey, jobKey, members: []});
    groups.get(key).members.push(row);
  }
  const out = [];
  for (const group of groups.values()) {
    if (group.members.length < 2) continue;
    const members = [...group.members].sort(byLotActivityDate);
    let sameCustomer = false;
    for (let i = 0; i < members.length && !sameCustomer; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (lotSameCustomer(members[i], members[j])) {
          sameCustomer = true;
          break;
        }
      }
    }
    out.push({
      key: group.key,
      vinKey: group.vinKey,
      jobKey: group.jobKey,
      jobLabel: lotJobLabel(members[members.length - 1]),
      sameCustomer,
      activities: members,
      latestMs: lotDateMs(members[members.length - 1].activityDate),
    });
  }
  out.sort((a, b) => (a.sameCustomer === b.sameCustomer ?
    b.latestMs - a.latestMs || (a.key < b.key ? -1 : 1) :
    a.sameCustomer ? -1 : 1));
  return out.map(({latestMs, ...group}) => group);
}

/** The fields a duplicate list reads (and the only ones the read selects). */
const LOT_DUPLICATE_FIELDS = Object.freeze([
  "activityTypeId", "activityTypeLabel", "customLabel", "vinNumber",
  "customerName", "customerPhone", "voided", "trackingCode", "activityDate",
  "feeCents", "amountPaidCents", "paymentStatus", "paymentMethod",
  "carYear", "carMake", "carModel",
]);

/**
 * One record of a duplicate group, as a callable answers it: plain JSON,
 * the activity's own field names, the date in milliseconds.
 *
 * @param {object} row A stored activity (with `id`).
 * @return {object} The record.
 */
function lotDuplicateMember(row) {
  return {
    id: String(row.id ?? ""),
    trackingCode: text(row.trackingCode, 40),
    activityDate: lotDateMs(row.activityDate) || null,
    activityTypeId: text(row.activityTypeId, MAX_LABEL),
    activityTypeLabel: text(row.activityTypeLabel, MAX_LABEL),
    customLabel: text(row.customLabel, MAX_LABEL),
    customerName: text(row.customerName),
    customerPhone: text(row.customerPhone, 40),
    vinNumber: lotVinKey(row.vinNumber),
    carYear: text(row.carYear, 8),
    carMake: text(row.carMake, 80),
    carModel: text(row.carModel, 80),
    feeCents: Math.max(0, intCents(row.feeCents) || 0),
    amountPaidCents: Math.max(0, intCents(row.amountPaidCents) || 0),
    paymentStatus: text(row.paymentStatus, 40),
    paymentMethod: text(row.paymentMethod, 40),
  };
}

/**
 * lotVinDuplicateGroups, as the clients receive it.
 *
 * @param {object[]} rows Stored activities (with `id`).
 * @return {object[]} The groups, each record as lotDuplicateMember.
 */
function lotVinDuplicateSummary(rows) {
  return lotVinDuplicateGroups(rows).map((group) => ({
    ...group,
    activities: group.activities.map(lotDuplicateMember),
  }));
}

/**
 * One earlier record, as a refusal's `details` name it.
 *
 * @param {object} row A stored activity (with `id`).
 * @return {object} {activityId, trackingCode, activityDate, customerName}.
 */
function lotVinJobExisting(row) {
  const ms = lotDateMs(row?.activityDate);
  return {
    activityId: String(row?.id ?? ""),
    trackingCode: text(row?.trackingCode, 40),
    activityDate: ms ? new Date(ms).toISOString() : "",
    customerName: text(row?.customerName),
  };
}

/**
 * The car an alert names: "2018 Toyota Camry" / "Toyota Camry 2018", or
 * "a car" / "une voiture" when the record names none.
 *
 * @param {object} activity The activity.
 * @param {"en"|"fr"} language The language.
 * @return {string} The car.
 */
function lotRepeatCarName(activity, language) {
  const year = text(activity?.carYear, 8);
  const name = [text(activity?.carMake, 80), text(activity?.carModel, 80)]
      .filter(Boolean).join(" ");
  if (language === "fr") {
    return [name, year].filter(Boolean).join(" ") || "une voiture";
  }
  return [year, name].filter(Boolean).join(" ") || "a car";
}

/**
 * The words of the owner's alert for a confirmed repeat: "A second
 * Dispatch was recorded for 2018 Toyota Camry · VIN …12345678 (LA-K7M4P2)
 * by Mamadou".
 *
 * @param {object} activity The new activity (as stored).
 * @param {string} actorName The first name of who recorded it.
 * @param {"en"|"fr"} language The owner's language.
 * @return {{title: string, body: string}} The copy.
 */
function lotRepeatAlertCopy(activity, actorName, language) {
  const fr = language === "fr";
  const job = lotJobLabel(activity) || (fr ? "travail" : "job");
  const vin = lotVinKey(activity?.vinNumber);
  const code = text(activity?.trackingCode, 40);
  const tail = `${vin ? ` · VIN …${vin.slice(-8)}` : ""}${
    code ? ` (${code})` : ""}`;
  const car = lotRepeatCarName(activity, fr ? "fr" : "en");
  const who = text(actorName, 120) || (fr ? "quelqu'un" : "someone");
  if (fr) {
    return {
      title: `Deuxième ${job} enregistré`,
      body: `Un deuxième ${job} a été enregistré pour ${car}${tail} ` +
        `par ${who}`,
    };
  }
  return {
    title: `Second ${job} recorded`,
    body: `A second ${job} was recorded for ${car}${tail} by ${who}`,
  };
}

// ---- Expense lines: void (a mistake) and stop (a bill that ended) ----
//
// Voiding a line mirrors voidLotActivity: the line stays on the record,
// struck through, and drops out of every month's totals - so it is refused
// while purchases still hang off it (a line voided as a mistake must never
// hide real money). Stopping is different: a real monthly bill ended, so the
// line keeps counting through its last month (`endMonth`, "yyyy-mm") and
// stops after it. Stopping only changes future months, so it can be undone.

/** Refusal reasons for the line actions, with the words the clients show. */
const LOT_EXPENSE_LINE_REFUSALS = Object.freeze({
  line_not_found: "Line not found",
  line_voided: "Already voided.",
  line_has_purchases: "Void this line's purchases first.",
  end_month_invalid: "Pick a valid month.",
  end_month_before_purchases: "This line has purchases after that month.",
  line_stopped: "This line stopped before that month.",
});

const LOT_MONTH_NAMES = Object.freeze(["January", "February", "March",
  "April", "May", "June", "July", "August", "September", "October",
  "November", "December"]);

/**
 * @param {*} value A month key.
 * @return {boolean} True for a real "yyyy-mm".
 */
function lotIsMonthKey(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? ""));
  return Boolean(match) && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

/**
 * @param {string} monthKey "yyyy-mm".
 * @return {string} "October 2026".
 */
function lotMonthLabel(monthKey) {
  if (!lotIsMonthKey(monthKey)) return String(monthKey ?? "");
  const [year, month] = String(monthKey).split("-");
  return `${LOT_MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/**
 * The last month a line counts, or "" when it runs on. A malformed stored
 * value is read as "runs on" (never silently drops real months).
 *
 * @param {object} line A lotExpenseLines document.
 * @return {string} "yyyy-mm" or "".
 */
function lotLineEndMonth(line) {
  const end = String(line?.endMonth ?? "").trim();
  return lotIsMonthKey(end) ? end : "";
}

/**
 * Whether a line counts in (and takes purchases for) a month: not voided,
 * and not a month after it stopped.
 *
 * @param {object} line A lotExpenseLines document.
 * @param {string} month "yyyy-mm".
 * @return {boolean} True when the line is live that month.
 */
function lotLineLiveIn(line, month) {
  if (!line || line.voided === true) return false;
  const end = lotLineEndMonth(line);
  return !end || !lotIsMonthKey(month) || month <= end;
}

/**
 * Whether a line may be voided.
 *
 * @param {{line: ?object, livePurchases: number}} input The stored line
 *   (null when missing) and how many non-voided purchases point at it.
 * @return {{ok: boolean, reason: string}} The decision.
 */
function lotLineVoidPlan({line, livePurchases}) {
  if (!line) return {ok: false, reason: "line_not_found"};
  if (line.voided === true) return {ok: false, reason: "line_voided"};
  if (Number(livePurchases) > 0) {
    return {ok: false, reason: "line_has_purchases"};
  }
  return {ok: true, reason: ""};
}

/**
 * What "Stop after this month" (or "Resume", with "") does to a line.
 *
 * @param {{line: ?object, endMonth: *, purchaseMonths: string[]}} input The
 *   stored line, the requested last month ("" resumes) and the months of
 *   its non-voided purchases.
 * @return {{ok: boolean, reason: string, endMonth: string,
 *   summary: string, changed: boolean}} The decision and its History line.
 */
function lotLineEndMonthPlan({line, endMonth, purchaseMonths}) {
  const refuse = (reason) => ({ok: false, reason, endMonth: "",
    summary: "", changed: false});
  if (!line) return refuse("line_not_found");
  if (line.voided === true) return refuse("line_voided");
  const wanted = String(endMonth ?? "").trim();
  if (wanted && !lotIsMonthKey(wanted)) return refuse("end_month_invalid");
  if (wanted && (purchaseMonths || []).some((m) =>
    lotIsMonthKey(m) && m > wanted)) {
    return refuse("end_month_before_purchases");
  }
  return {
    ok: true,
    reason: "",
    endMonth: wanted,
    summary: wanted ? `Stopped after ${lotMonthLabel(wanted)}` : "Resumed",
    changed: wanted !== lotLineEndMonth(line),
  };
}

module.exports = {
  LOT_EXPENSE_LINE_REFUSALS,
  lotIsMonthKey,
  lotMonthLabel,
  lotLineEndMonth,
  lotLineLiveIn,
  lotLineVoidPlan,
  lotLineEndMonthPlan,
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
  lotVinKey,
  lotJobKey,
  lotPhoneDigits,
  lotSameCustomer,
  lotCustomerMatchKey,
  lotActivityActive,
  lotVinJobLockId,
  lotVinJobIdentity,
  lotVinJobConflicts,
  lotJobLabel,
  lotVinDuplicateGroups,
  LOT_DUPLICATE_FIELDS,
  lotDuplicateMember,
  lotVinDuplicateSummary,
  lotVinJobExisting,
  lotRepeatAlertCopy,
};

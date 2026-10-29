"use strict";

/**
 * The server side of "staff expenses come off their parking bill"
 * (docs/STAFF_EXPENSE_CREDIT.md §2, §4): who may link, what a repayment
 * record looks like, the refusals, and the month-end push's netted owing.
 *
 * Pure: no Firestore, no clock. The arithmetic itself lives in
 * staff_expense_credit.js (shared with the console and the app); this file
 * only calls it.
 */

const {netStaffExpenses} = require("./staff_expense_credit");

const REPAYMENT_METHODS = Object.freeze(["cash", "zelle", "check", "other"]);
const MAX_REPAYMENT_CENTS = 100000000;

const STAFF_CREDIT_MESSAGES = Object.freeze({
  link_owner_only: "Only the owner can link a staff member to a parking bill.",
  staff_not_member: "This person is not on this business's staff.",
  link_customer_invalid: "Choose the parking customer to link.",
  repayment_amount_invalid: "Enter how much was paid back.",
  repayment_exceeds_credit:
    "That is more than the business owes this staff member for expenses.",
  repayment_method_invalid: "Choose how it was paid back.",
  repayment_date_invalid: "Choose the date it was paid back (not a later day).",
  repayment_not_found: "This payback was not found.",
  repayment_voided: "This payback is already voided.",
  staff_action_invalid: "Unknown action.",
});

const REFUSAL_KIND = Object.freeze({
  link_owner_only: "permission-denied",
  staff_not_member: "failed-precondition",
  link_customer_invalid: "invalid-argument",
  repayment_amount_invalid: "invalid-argument",
  repayment_exceeds_credit: "failed-precondition",
  repayment_method_invalid: "invalid-argument",
  repayment_date_invalid: "invalid-argument",
  repayment_not_found: "not-found",
  repayment_voided: "failed-precondition",
  staff_action_invalid: "invalid-argument",
});

const STAFF_ACTIONS = Object.freeze([
  "link_staff_parking",
  "record_staff_repayment",
  "void_staff_repayment",
]);

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * @param {string} code A refusal code.
 * @return {object} `{kind, message}` for an HttpsError.
 */
function staffCreditRefusal(code) {
  return {
    kind: REFUSAL_KIND[code] || "failed-precondition",
    message: STAFF_CREDIT_MESSAGES[code] || code,
  };
}

/**
 * Whether a user profile is staff (or the owner) of the business - the same
 * test canManageBusiness makes, without the platform-admin pass.
 *
 * @param {object} user `users/{uid}` data.
 * @param {string} businessId The business.
 * @return {boolean} A member.
 */
function isBusinessMember(user, businessId) {
  return Boolean(businessId) && Boolean(user) &&
    (user.role === "staff" || user.role === "businessOwner") &&
    user.businessId === businessId;
}

/**
 * The `staffParkingLinks.{staffId}` value, or null to unlink.
 *
 * @param {object} data The request: customerKey, customerName,
 *   customerPhone.
 * @param {object} ctx `{uid, nowMs}`.
 * @return {object} `{link}` (null = unlink) or `{refusal}`.
 */
function staffParkingLinkRecord(data, ctx) {
  const customerKey = text(data?.customerKey, 200);
  if (!customerKey) return {link: null};
  // The key month-end bills group by (parkingCustomerKey): phone or name.
  if (!/^(phone|name):\S/.test(customerKey)) {
    return {refusal: "link_customer_invalid"};
  }
  return {link: {
    customerKey,
    customerName: text(data?.customerName, 120),
    customerPhone: text(data?.customerPhone, 40),
    linkedAtMs: Number(ctx?.nowMs) || 0,
    linkedByUid: text(ctx?.uid, 128),
  }};
}

/**
 * @param {*} value Cents as sent.
 * @return {?number} Whole cents 1..MAX, or null.
 */
function cleanRepaymentCents(value) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 1 && value <= MAX_REPAYMENT_CENTS ? value : null;
}

/**
 * Why a repayment cannot be recorded, or "".
 *
 * @param {object} input `{amountCents, method, creditCents}`; creditCents is
 *   the staff member's staffCredits(...).creditCents for the current month.
 * @return {string} A refusal code or "".
 */
function repaymentRefusal(input) {
  const amount = cleanRepaymentCents(input?.amountCents);
  if (amount === null) return "repayment_amount_invalid";
  if (!REPAYMENT_METHODS.includes(text(input?.method, 20))) {
    return "repayment_method_invalid";
  }
  if (amount > Math.max(0, Number(input?.creditCents) || 0)) {
    return "repayment_exceeds_credit";
  }
  return "";
}

/**
 * Why a repayment cannot be voided, or "".
 *
 * @param {?object} current The stored row (null when missing).
 * @param {string} businessId The business the caller acts for.
 * @return {string} A refusal code or "".
 */
function repaymentVoidRefusal(current, businessId) {
  if (!current || String(current.businessId || "") !== businessId) {
    return "repayment_not_found";
  }
  if (current.voided === true) return "repayment_voided";
  return "";
}

/**
 * The paid-back day as "yyyy-mm-dd", checked against today.
 *
 * @param {*} paidAt What was sent ("yyyy-mm-dd" or an ISO time), or empty.
 * @param {string} todayKey Today, "yyyy-mm-dd" in the business's zone.
 * @return {?string} The day, or null when it is invalid or later than today.
 */
function repaymentDayKey(paidAt, todayKey) {
  const raw = text(paidAt, 60);
  if (!raw) return todayKey;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (!match) return null;
  const day = match[1];
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== day) {
    return null;
  }
  return day <= todayKey ? day : null;
}

/**
 * The `staffExpenseRepayments` row (without its timestamps).
 *
 * @param {object} data The request.
 * @param {object} ctx `{businessId, uid, dayKey}`.
 * @return {object} The row; `month` is the yyyy-mm of the paid-back day,
 *   the way an expense's month is the yyyy-mm of its date.
 */
function repaymentRecord(data, ctx) {
  return {
    businessId: text(ctx?.businessId, 160),
    staffId: text(data?.staffId, 128),
    amountCents: cleanRepaymentCents(data?.amountCents) || 0,
    month: text(ctx?.dayKey, 10).slice(0, 7),
    method: text(data?.method, 20),
    givenByStaffId: text(data?.givenByStaffId, 128) || text(ctx?.uid, 128),
    note: text(data?.note, 300),
    voided: false,
    voidedAt: null,
    voidedByUid: "",
    recordedByUid: text(ctx?.uid, 128),
  };
}

/**
 * The month-end push's owing numbers after staff expenses: how many
 * customers still owe and how much. No links means nothing to net.
 *
 * @param {object[]} customers parkingMonthSummary(...).customers.
 * @param {?object} ctx `{entries, repayments, links, monthKey}`, or null.
 * @return {object} `{customersOwing, dueCents, expenseCreditCents}`.
 */
function monthEndOwing(customers, ctx) {
  const list = Array.isArray(customers) ? customers : [];
  const linked = ctx && ctx.links && Object.keys(ctx.links).length > 0;
  const netted = linked ? netStaffExpenses(list, ctx) : null;
  const rows = netted ? netted.customers : list;
  const owing = rows.filter((c) => Number(c.dueCents) > 0);
  return {
    customersOwing: owing.length,
    dueCents: owing.reduce((s, c) => s + Number(c.dueCents), 0),
    expenseCreditCents: netted ? netted.expenseCreditCents : 0,
  };
}

module.exports = {
  REPAYMENT_METHODS,
  STAFF_ACTIONS,
  STAFF_CREDIT_MESSAGES,
  cleanRepaymentCents,
  isBusinessMember,
  monthEndOwing,
  repaymentDayKey,
  repaymentRecord,
  repaymentRefusal,
  repaymentVoidRefusal,
  staffCreditRefusal,
  staffParkingLinkRecord,
};

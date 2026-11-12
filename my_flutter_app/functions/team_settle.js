"use strict";

/**
 * "I paid everything": a team member settles their month at once
 * (docs/TEAM_SETTLE.md).
 *
 * A team member's Month end card is a STATEMENT (docs/PARKING_INVOICES.md
 * section 6): parking and jobs, less their expenses, plus the cash they hold
 * for the business = "Owes the business $X". One action pays it. The payer
 * picks what it is for - everything (the cash they hold first, then their own
 * parking and jobs), only the cash, or only the parking - and the amount and
 * the split are FROZEN when they press the button. It counts only once the
 * receiver (the owner, someone with Full access, or the Business account)
 * confirms: the cash part is then written as a confirmed hand-over from the
 * member and the parking part as a payment on the member's month bill, both
 * tagged with the settlement, and one Undo takes both off.
 *
 * Pure: no Firestore, no clock. Mirrored by the console's `team-settle.ts`;
 * `test/fixtures/team-settle-cases.json` is run by both.
 */

const {BUSINESS_ACCOUNT_RECEIVER, HANDOVER_METHODS} =
  require("./staff_balances");

const SETTLE_SCOPE = Object.freeze({
  EVERYTHING: "everything",
  CASH: "cash",
  PARKING: "parking",
});
const SCOPES = Object.freeze(Object.values(SETTLE_SCOPE));

const SETTLE_STATUS = Object.freeze({
  PENDING: "pending",
  CONFIRMED: "confirmed",
  DECLINED: "declined",
  UNDONE: "undone",
});

const SETTLE_ACTIONS = Object.freeze([
  "team_settle_request",
  "team_settle_confirm",
  "team_settle_decline",
  "team_settle_undo",
  "team_payback",
]);

const MAX_SETTLE_CENTS = 100000000;
const MAX_NOTE = 300;
// The ways a pay-back can be made (staffExpenseRepayments' own list).
const PAYBACK_METHODS = Object.freeze(["cash", "zelle", "check", "other"]);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const REFUSAL = Object.freeze({
  NO_AMOUNT: "team_settle_no_amount",
  MORE_THAN_OWED: "team_settle_more_than_owed",
  NOTHING_OWED: "team_settle_nothing_owed",
  SCOPE_INVALID: "team_settle_scope_invalid",
  METHOD_INVALID: "team_settle_method_invalid",
  MONTH_INVALID: "team_settle_month_invalid",
  NO_STATEMENT: "team_settle_no_statement",
  RECEIVER_INVALID: "team_settle_receiver_invalid",
  NOT_OWN: "team_settle_not_own",
  NOT_FOUND: "team_settle_not_found",
  NOT_RECEIVER: "team_settle_not_receiver",
  NOT_PENDING: "team_settle_not_pending",
  NOT_UNDOABLE: "team_settle_not_undoable",
  BILL_CHANGED: "team_settle_bill_changed",
  OWNER_ONLY: "team_settle_owner_only",
  PAYBACK_NOT_OWED: "team_payback_not_owed",
  PAYBACK_MORE_THAN_OWED: "team_payback_more_than_owed",
  ACTION_INVALID: "team_settle_action_invalid",
});

const MESSAGES = Object.freeze({
  [REFUSAL.NO_AMOUNT]: "Enter how much was paid.",
  [REFUSAL.MORE_THAN_OWED]: "That is more than this statement asks for. " +
    "Pay what is owed, or pick what it is for.",
  [REFUSAL.NOTHING_OWED]: "Nothing is owed for that. Pick something else.",
  [REFUSAL.SCOPE_INVALID]: "Choose what the payment is for: everything, " +
    "only the cash, or only the parking.",
  [REFUSAL.METHOD_INVALID]: "Choose how the money was paid.",
  [REFUSAL.MONTH_INVALID]: "Pick a month that has started (yyyy-mm).",
  [REFUSAL.NO_STATEMENT]: "This person has no statement for this month.",
  [REFUSAL.RECEIVER_INVALID]: "Choose the owner, someone with Full access, " +
    "or the Business account.",
  [REFUSAL.NOT_OWN]: "You can only say you paid for yourself. Ask the " +
    "owner to record it for someone else.",
  [REFUSAL.NOT_FOUND]: "This payment was not found.",
  [REFUSAL.NOT_RECEIVER]: "Only the person who received this money can " +
    "answer it.",
  [REFUSAL.NOT_PENDING]: "This payment was already answered.",
  [REFUSAL.NOT_UNDOABLE]: "This payment is already undone or declined.",
  [REFUSAL.BILL_CHANGED]: "The parking bill changed since it was filed, so " +
    "it cannot be confirmed as it was. Decline it and ask for a new one.",
  [REFUSAL.OWNER_ONLY]: "Only the owner or someone with Full access can do " +
    "this.",
  [REFUSAL.PAYBACK_NOT_OWED]: "The business does not owe this person " +
    "anything for this month.",
  [REFUSAL.PAYBACK_MORE_THAN_OWED]: "That is more than the business owes " +
    "this person.",
  [REFUSAL.ACTION_INVALID]: "Unknown action.",
});

const REFUSAL_KIND = Object.freeze({
  [REFUSAL.NO_AMOUNT]: "invalid-argument",
  [REFUSAL.MORE_THAN_OWED]: "failed-precondition",
  [REFUSAL.NOTHING_OWED]: "failed-precondition",
  [REFUSAL.SCOPE_INVALID]: "invalid-argument",
  [REFUSAL.METHOD_INVALID]: "invalid-argument",
  [REFUSAL.MONTH_INVALID]: "invalid-argument",
  [REFUSAL.NO_STATEMENT]: "failed-precondition",
  [REFUSAL.RECEIVER_INVALID]: "failed-precondition",
  [REFUSAL.NOT_OWN]: "permission-denied",
  [REFUSAL.NOT_FOUND]: "not-found",
  [REFUSAL.NOT_RECEIVER]: "permission-denied",
  [REFUSAL.NOT_PENDING]: "failed-precondition",
  [REFUSAL.NOT_UNDOABLE]: "failed-precondition",
  [REFUSAL.BILL_CHANGED]: "failed-precondition",
  [REFUSAL.OWNER_ONLY]: "permission-denied",
  [REFUSAL.PAYBACK_NOT_OWED]: "failed-precondition",
  [REFUSAL.PAYBACK_MORE_THAN_OWED]: "failed-precondition",
  [REFUSAL.ACTION_INVALID]: "invalid-argument",
});

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const whole = (value) => Math.round(Number(value) || 0);

/**
 * @param {string} code A refusal code.
 * @return {{kind: string, message: string}} For an HttpsError.
 */
function teamSettleRefusal(code) {
  return {
    kind: REFUSAL_KIND[code] || "failed-precondition",
    message: MESSAGES[code] || code,
  };
}

/**
 * What a statement can be paid on, per kind of money.
 *
 *   owes = parking and jobs - expenses + cash held
 *
 * Parking can take what the member's bill still owes after their expenses;
 * expenses beyond the bill are a credit that cuts the cash they owe, so
 * "everything" never asks for more than the statement's own number.
 *
 * @param {object} statement A staff_statement.js statement
 *   `{parkingJobsCents, expenseCents, cashHeldCents}`.
 * @return {{parkingDueCents: number, cashDueCents: number}} Both >= 0.
 */
function settleLimits(statement) {
  const parking = whole(statement?.parkingJobsCents);
  const expense = Math.max(0, whole(statement?.expenseCents));
  const cash = whole(statement?.cashHeldCents);
  const parkingDueCents = Math.max(0, parking - expense);
  const credit = Math.max(0, expense - parking);
  return {parkingDueCents, cashDueCents: Math.max(0, cash - credit)};
}

/**
 * How one amount is split for the scope the payer chose.
 *
 *   everything: the cash they hold first, then their own parking and jobs
 *   cash:       only the cash (at most what they hold)
 *   parking:    only the parking and jobs (at most what the bill owes)
 *
 * @param {object} input `{statement, cashHeldCents, parkingDueCents,
 *   amountCents, scope}`. `cashHeldCents` / `parkingDueCents` default to
 *   settleLimits(statement).
 * @return {{ok: boolean, reason: string, cashCents: number,
 *   parkingCents: number, leftCents: number}} `leftCents` is what the
 *   statement still asks for after the amount (all kinds). Refused: `reason`
 *   is a REFUSAL value and the cents are 0.
 */
function teamSettlePlan(input) {
  const limits = settleLimits(input?.statement);
  const cashDue = Number.isFinite(Number(input?.cashHeldCents)) &&
    input?.cashHeldCents !== undefined && input?.cashHeldCents !== null ?
    Math.max(0, whole(input.cashHeldCents)) : limits.cashDueCents;
  const parkingDue = Number.isFinite(Number(input?.parkingDueCents)) &&
    input?.parkingDueCents !== undefined && input?.parkingDueCents !== null ?
    Math.max(0, whole(input.parkingDueCents)) : limits.parkingDueCents;
  const total = cashDue + parkingDue;
  const refuse = (reason) => ({ok: false, reason, cashCents: 0,
    parkingCents: 0, leftCents: total});
  const scope = text(input?.scope, 20);
  if (!SCOPES.includes(scope)) return refuse(REFUSAL.SCOPE_INVALID);
  const allowed = scope === SETTLE_SCOPE.CASH ? cashDue :
    scope === SETTLE_SCOPE.PARKING ? parkingDue : total;
  if (allowed <= 0) return refuse(REFUSAL.NOTHING_OWED);
  const raw = input?.amountCents;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 ||
      raw > MAX_SETTLE_CENTS) {
    return refuse(REFUSAL.NO_AMOUNT);
  }
  if (raw > allowed) return refuse(REFUSAL.MORE_THAN_OWED);
  let cashCents = 0;
  let parkingCents = 0;
  if (scope === SETTLE_SCOPE.CASH) {
    cashCents = raw;
  } else if (scope === SETTLE_SCOPE.PARKING) {
    parkingCents = raw;
  } else {
    cashCents = Math.min(raw, cashDue);
    parkingCents = Math.min(raw - cashCents, parkingDue);
  }
  return {ok: true, reason: "", cashCents, parkingCents,
    leftCents: Math.max(0, total - raw)};
}

/**
 * What the statement defaults to: the full number it asks for ("Owes the
 * business $X"), everything.
 *
 * @param {object} statement A staff statement.
 * @return {number} Whole cents, 0 when nothing is owed.
 */
function defaultSettleCents(statement) {
  const {parkingDueCents, cashDueCents} = settleLimits(statement);
  return parkingDueCents + cashDueCents;
}

/**
 * Whether a receiver id may be named (the person check is the callable's:
 * the owner, or someone with Full access; here only the shape).
 *
 * @param {*} id A `receiverId`.
 * @return {boolean} A plain id or the Business account.
 */
function receiverIdShapeOk(id) {
  const value = text(id, 128);
  return Boolean(value) && !value.includes("/");
}

/**
 * Why a request cannot be filed, from the request alone.
 *
 * @param {object} data `{monthKey, method, scope, receiverId}`.
 * @return {string} A refusal code or "".
 */
function requestRefusal(data) {
  if (!MONTH.test(text(data?.monthKey, 7))) return REFUSAL.MONTH_INVALID;
  if (!SCOPES.includes(text(data?.scope, 20))) return REFUSAL.SCOPE_INVALID;
  if (!HANDOVER_METHODS.includes(text(data?.method, 20))) {
    return REFUSAL.METHOD_INVALID;
  }
  if (!receiverIdShapeOk(data?.receiverId)) return REFUSAL.RECEIVER_INVALID;
  return "";
}

/**
 * The `staffMonthSettlements` row (without its timestamps).
 *
 * @param {object} data `{businessId, staffId, monthKey, amountCents, scope,
 *   method, note, receiverId}`.
 * @param {object} plan teamSettlePlan's answer (ok).
 * @param {object} ctx `{uid, statementOwedCents, nowMs}`.
 * @return {object} The row, status pending (a receiver who files it
 *   themselves confirms it in the same call).
 */
function settlementRecord(data, plan, ctx) {
  const nowMs = whole(ctx?.nowMs);
  return {
    businessId: text(data?.businessId, 160),
    staffId: text(data?.staffId, 128),
    monthKey: text(data?.monthKey, 7),
    amountCents: plan.cashCents + plan.parkingCents,
    scope: text(data?.scope, 20),
    cashCents: plan.cashCents,
    parkingCents: plan.parkingCents,
    // The statement's number when the button was pressed (frozen).
    statementOwedCents: whole(ctx?.statementOwedCents),
    receiverId: text(data?.receiverId, 128),
    method: text(data?.method, 20),
    note: text(data?.note, MAX_NOTE),
    status: SETTLE_STATUS.PENDING,
    requestedAtMs: nowMs,
    requestedByUid: text(ctx?.uid, 128),
    confirmedAtMs: 0,
    confirmedByUid: "",
    declinedAtMs: 0,
    declinedByUid: "",
    declineNote: "",
    undoneAtMs: 0,
    undoneByUid: "",
    handoverId: "",
    billPaymentId: "",
  };
}

/**
 * Whether a stored settlement is this business's.
 *
 * @param {?object} row The stored row.
 * @param {string} businessId The business the caller acts for.
 * @return {boolean} True when it exists and belongs to the business.
 */
function settlementIsOf(row, businessId) {
  return Boolean(row) && text(row.businessId, 160) === text(businessId, 160);
}

/**
 * Why the caller may not confirm or decline a settlement, or "". Only the
 * receiver answers; the Business account's receiver is the owner (or someone
 * with Full access, or a platform admin). Whoever answers must themselves be
 * one of those: an ordinary staff member never receives a settlement.
 *
 * @param {?object} row The stored row.
 * @param {object} ctx `{uid, businessId, isReceiverRole}` -
 *   `isReceiverRole` is owner / Full access / platform admin.
 * @return {string} A refusal code or "".
 */
function settlementAnswerRefusal(row, ctx) {
  if (!settlementIsOf(row, ctx?.businessId)) return REFUSAL.NOT_FOUND;
  const receiverId = text(row.receiverId, 128);
  const named = receiverId === BUSINESS_ACCOUNT_RECEIVER ||
    receiverId === text(ctx?.uid, 128);
  if (!named || ctx?.isReceiverRole !== true) return REFUSAL.NOT_RECEIVER;
  if (text(row.status, 20) !== SETTLE_STATUS.PENDING) {
    return REFUSAL.NOT_PENDING;
  }
  return "";
}

/**
 * Why a settlement cannot be undone, or "": any staff member of the business
 * may undo one that waits or counts; never twice, never a declined one.
 *
 * @param {?object} row The stored row.
 * @param {string} businessId The business.
 * @return {string} A refusal code or "".
 */
function settlementUndoRefusal(row, businessId) {
  if (!settlementIsOf(row, businessId)) return REFUSAL.NOT_FOUND;
  const status = text(row.status, 20);
  const undoable = status === SETTLE_STATUS.PENDING ||
    status === SETTLE_STATUS.CONFIRMED;
  return undoable ? "" : REFUSAL.NOT_UNDOABLE;
}

/**
 * Why "Paid them back" is refused, or "".
 *
 * @param {object} input `{owesCents (signed statement number), amountCents,
 *   method}`.
 * @return {string} A refusal code or "".
 */
function paybackRefusal(input) {
  const owes = whole(input?.owesCents);
  if (owes >= 0) return REFUSAL.PAYBACK_NOT_OWED;
  if (!PAYBACK_METHODS.includes(text(input?.method, 20))) {
    return REFUSAL.METHOD_INVALID;
  }
  const raw = input?.amountCents;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 ||
      raw > MAX_SETTLE_CENTS) {
    return REFUSAL.NO_AMOUNT;
  }
  return raw > -owes ? REFUSAL.PAYBACK_MORE_THAN_OWED : "";
}

/**
 * The last day of a month, or today when the month has not ended: the day a
 * pay-back counts on, so it lands in the month it settles.
 *
 * @param {string} monthKey "yyyy-mm".
 * @param {string} todayKey "yyyy-mm-dd".
 * @return {string} "yyyy-mm-dd".
 */
function paybackDay(monthKey, todayKey) {
  const [year, month] = text(monthKey, 7).split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return last < todayKey ? last : todayKey;
}

const money = (cents) => `$${(Math.abs(whole(cents)) / 100).toLocaleString(
    "en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

/**
 * The push texts of the settle flow.
 *
 * @param {string} kind "request" | "confirmed" | "declined" | "payback".
 * @param {object} v `{name, amountCents, monthText, note}`.
 * @return {{title: string, body: string}} The push.
 */
function settlePushText(kind, v) {
  const name = text(v?.name, 80) || "A team member";
  const amount = money(v?.amountCents);
  const month = text(v?.monthText, 40);
  if (kind === "request") {
    return {title: "Confirm a payment",
      body: `${name} says he paid you ${amount} for ${month} - confirm`};
  }
  if (kind === "confirmed") {
    return {title: "Payment confirmed",
      body: `Your ${amount} for ${month} was confirmed. Thank you!`};
  }
  if (kind === "declined") {
    const note = text(v?.note, 120);
    return {title: "Payment not confirmed",
      body: `Your ${amount} for ${month} was not confirmed` +
        `${note ? `: ${note}` : "."}`};
  }
  return {title: "You were paid back",
    body: `The business paid you back ${amount} for ${month}.`};
}

module.exports = {
  MAX_SETTLE_CENTS,
  MESSAGES,
  PAYBACK_METHODS,
  REFUSAL,
  SCOPES,
  SETTLE_ACTIONS,
  SETTLE_SCOPE,
  SETTLE_STATUS,
  defaultSettleCents,
  paybackDay,
  paybackRefusal,
  requestRefusal,
  settleLimits,
  settlePushText,
  settlementAnswerRefusal,
  settlementIsOf,
  settlementRecord,
  settlementUndoRefusal,
  teamSettlePlan,
  teamSettleRefusal,
};

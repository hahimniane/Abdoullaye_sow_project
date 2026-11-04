"use strict";

/**
 * Pay now on package requests (docs/PACKAGE_BOX_SIZES_PAY_NOW.md §3): the
 * pure rules. When a request may be paid by card, what its `payNow` record
 * says, the weekly payout arithmetic for the businesses Laawol collects for,
 * refund checks, the ledger rows, and the money / date words the WhatsApp
 * templates carry. No Firestore, no Stripe, no clock: the glue is
 * package_pay_now_handlers.js.
 *
 * Money is whole cents (USD). Dates are US style; weeks are Monday to Sunday
 * in America/New_York.
 */

const TIME_ZONE = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;

// Stripe's own ceiling for one charge.
const MAX_PAY_CENTS = 99999999;
// What Stripe charges Laawol when a card payment is disputed.
const DISPUTE_FEE_CENTS = 1500;

const PAYMENT_TYPE = "package_request_pay";

const STATUS = Object.freeze({
  OPEN: "open",
  PAID: "paid",
  PARTLY_REFUNDED: "partly_refunded",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
});

const CHARGE_TYPE = Object.freeze({DIRECT: "direct", PLATFORM: "platform"});

const LEDGER_TYPE = Object.freeze({
  PAYMENT: "payment",
  STRIPE_FEE: "stripe_fee",
  REFUND: "refund",
  CHARGEBACK: "chargeback",
  DISPUTE_FEE: "dispute_fee",
  BILL_OFFSET: "bill_offset",
  PAYOUT: "payout",
  TO_BILL: "to_bill",
});
const LEDGER_TYPES = Object.freeze(Object.values(LEDGER_TYPE));

const PAYOUT_STATUS = Object.freeze({
  OPEN: "open", DUE: "due", PAID: "paid", NOTHING: "nothing"});
const PAYOUT_METHODS = Object.freeze(["zelle", "bank", "other"]);

// How a payment of the week is told to the owner (one word for both
// languages: the template carries a single method value).
const PAYOUT_METHOD_WORDS = Object.freeze({
  zelle: "Zelle",
  bank: "Bank transfer / Virement",
  other: "Other / Autre",
});

const MAX_REFERENCE = 120;
const MAX_REASON = 300;
const MAX_MESSAGES = 20;

// Refusals of the staff actions.
const REASON = Object.freeze({
  PAY_NOT_PAID: "pay_not_paid",
  REFUND_TOO_MUCH: "refund_too_much",
  REFUND_INVALID: "refund_invalid",
  NOT_ALLOWED: "not_allowed",
  PAY_NOT_FOUND: "pay_not_found",
  PAY_NOT_OPEN: "pay_not_open",
  WEEK_INVALID: "week_invalid",
  WEEK_NOT_OVER: "week_not_over",
  WEEK_EMPTY: "week_empty",
  WEEK_ALREADY_PAID: "week_already_paid",
  METHOD_INVALID: "method_invalid",
  REFERENCE_TOO_LONG: "reference_too_long",
  REASON_TOO_LONG: "reason_too_long",
  BUSINESS_REQUIRED: "business_required",
  PAY_NOW_CHANGED: "pay_now_changed",
});

const MESSAGES = Object.freeze({
  [REASON.PAY_NOT_PAID]: "This request has no online payment to refund.",
  [REASON.REFUND_TOO_MUCH]:
    "That is more than the customer paid and has not been refunded yet.",
  [REASON.REFUND_INVALID]: "Enter a refund amount in dollars and cents.",
  [REASON.NOT_ALLOWED]: "You are not allowed to do that.",
  [REASON.PAY_NOT_FOUND]: "There is no online payment on this request.",
  [REASON.PAY_NOT_OPEN]:
    "The pay link is not open: the price is not final or the link was " +
    "cancelled.",
  [REASON.WEEK_INVALID]: "Pick a week that starts on a Monday.",
  [REASON.WEEK_NOT_OVER]: "That week is not over yet.",
  [REASON.WEEK_EMPTY]: "Nothing was collected or refunded that week.",
  [REASON.WEEK_ALREADY_PAID]: "That week is already paid out.",
  [REASON.METHOD_INVALID]: "Say how it was sent: Zelle, bank or other.",
  [REASON.REFERENCE_TOO_LONG]: "The reference is too long.",
  [REASON.REASON_TOO_LONG]: "The reason is too long.",
  [REASON.BUSINESS_REQUIRED]: "Say which business.",
  [REASON.PAY_NOW_CHANGED]:
    "The online payment on this request just changed. Look at it again.",
});

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const whole = (value) => Number.isInteger(value) ? value : 0;

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * @param {*} value Anything.
 * @return {number} A non-negative whole number of cents, else 0.
 */
function cents(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// Settings.
// ---------------------------------------------------------------------------

/**
 * The switch as stored: `payNow`, else the older card switch
 * (`cardBarrelBooking`) it extends (decision 6: one switch).
 *
 * @param {object} business The business document.
 * @return {{payNow: boolean}} The setting.
 */
function payNowSettingsOf(business) {
  const raw = isObject(business?.packageRequestSettings) ?
    business.packageRequestSettings : {};
  return {payNow: raw.payNow === undefined || raw.payNow === null ?
    raw.cardBarrelBooking === true : raw.payNow === true};
}

/**
 * What a settings save writes for the one switch: a save that names `payNow`
 * sets it; an older client that only knows `cardBarrelBooking` sets both from
 * that. Both fields always hold the same value.
 *
 * @param {object} data The callable's data.
 * @return {boolean} The new value.
 */
function payNowFromInput(data) {
  const input = isObject(data) ? data : {};
  return input.payNow !== undefined && input.payNow !== null ?
    input.payNow === true : input.cardBarrelBooking === true;
}

/**
 * @param {object} business The business document.
 * @return {"direct"|"platform"} What a charge would be today: a direct
 *   charge on the business's own Stripe account when it is connected and
 *   payouts are on, else a platform charge (no application fee either way).
 */
function chargeTypeOf(business) {
  return Boolean(business?.stripeAccountId) &&
    business.payoutsEnabled === true ? CHARGE_TYPE.DIRECT :
    CHARGE_TYPE.PLATFORM;
}

// ---------------------------------------------------------------------------
// When a link exists.
// ---------------------------------------------------------------------------

/**
 * Whether the total is final (exact), and if not why.
 *
 * @param {object} request A stored request.
 * @return {string} "" when exact, else unpriced_piece, weighed_at_counter
 *   or pickup_fee_unknown.
 */
function inexactReason(request) {
  const estimate = isObject(request?.estimate) ? request.estimate : {};
  const pieces = Array.isArray(request?.pieces) ? request.pieces : [];
  const rows = new Map((Array.isArray(estimate.pieces) ? estimate.pieces : [])
      .map((row) => [text(row?.id, 20), row?.cents]));
  for (const piece of pieces) {
    const row = rows.get(text(piece?.id, 20));
    if (!Number.isInteger(row) || row < 0) return "unpriced_piece";
  }
  if (pieces.length === 0) return "unpriced_piece";
  // A person's estimate (auto: false) names every piece's price and the
  // customer agreed to it. An estimate the price list wrote is exact only
  // when no piece waits for the counter's scale.
  if (estimate.auto !== false) {
    for (const piece of pieces) {
      const price = piece?.price;
      if (!isObject(price)) continue;
      if (price.source === "per_lb" ||
          (price.source === "item" && Number(price.includedLb) > 0)) {
        return "weighed_at_counter";
      }
    }
  }
  if (request?.handoff === "collect") {
    const known = Number.isInteger(estimate.pickupFeeCents) &&
      (estimate.auto === false || Number.isInteger(request?.pickup?.feeCents));
    if (!known) return "pickup_fee_unknown";
  }
  return "";
}

/**
 * Whether a request may be paid by card now.
 *
 * @param {object} request A stored request.
 * @param {object} settings {payNow} (payNowSettingsOf); an older
 *   requestSettingsOf answer works too (its cardBarrelBooking is the switch).
 * @return {{payable: boolean, amountCents: number, reason: string}} Payable
 *   when the switch is on, the request is open and confirmed, the card order
 *   flow is not in use, and the total is exact; `reason` says why not.
 */
function payNowState(request, settings) {
  const req = isObject(request) ? request : {};
  const total = Number(req.estimate?.totalCents);
  const amountCents = Number.isInteger(total) && total > 0 ? total : 0;
  const on = isObject(settings) && (settings.payNow === undefined ?
    settings.cardBarrelBooking === true : settings.payNow === true);
  const refuse = (reason) => ({payable: false, amountCents, reason});
  if (!on) return refuse("pay_now_off");
  if (text(req.payment?.timing, 20) === "card") return refuse("card_order");
  if (text(req.status, 40) !== "confirmed" || Number(req.closedAtMs) > 0) {
    return refuse("request_not_open");
  }
  if (!isObject(req.estimate)) return refuse("no_total");
  if (amountCents <= 0) return refuse("no_total");
  if (amountCents > MAX_PAY_CENTS) return refuse("amount_too_large");
  const inexact = inexactReason(req);
  if (inexact) return refuse(inexact);
  return {payable: true, amountCents, reason: ""};
}

/**
 * @param {object} payNow A stored payNow.
 * @return {number} What the customer paid and keeps paid (paid - refunded);
 *   0 when nothing was paid.
 */
function netPaidCents(payNow) {
  const pay = isObject(payNow) ? payNow : {};
  if (![STATUS.PAID, STATUS.PARTLY_REFUNDED, STATUS.REFUNDED]
      .includes(pay.status)) {
    return 0;
  }
  return Math.max(0, cents(pay.paidCents) - cents(pay.refundedCents));
}

// Requests that ended without the package being received.
const CLOSED_UNRECEIVED = Object.freeze(["declined", "customer_declined",
  "cancelled", "expired"]);

/**
 * Money in the request's total against money already paid online: the
 * difference when the total moved after payment.
 *
 * @param {object} request A stored request.
 * @return {{balanceDueCents: number, refundDueCents: number}} Balance due at
 *   the counter (total up) or refund to give (total down); both 0 when even.
 */
function payNowBalances(request) {
  const pay = isObject(request?.payNow) ? request.payNow : null;
  const none = {balanceDueCents: 0, refundDueCents: 0};
  if (!pay || ![STATUS.PAID, STATUS.PARTLY_REFUNDED, STATUS.REFUNDED]
      .includes(pay.status)) {
    return none;
  }
  const net = netPaidCents(pay);
  const status = text(request?.status, 40);
  // A request that ended without being received: all of it goes back.
  if (CLOSED_UNRECEIVED.includes(status)) {
    return {balanceDueCents: 0, refundDueCents: net};
  }
  // Received: the counter took the rest, so only an overpayment is left.
  if (status === "received") {
    return Number.isInteger(pay.receivedTotalCents) ?
      {balanceDueCents: 0, refundDueCents:
        Math.max(0, net - pay.receivedTotalCents)} : none;
  }
  const total = cents(request?.estimate?.totalCents);
  if (total <= 0) return none;
  return {
    balanceDueCents: Math.max(0, total - net),
    refundDueCents: Math.max(0, net - total),
  };
}

/**
 * What to do with a request's payNow after something changed (confirmed,
 * repriced, received, closed, the switch moved).
 *
 * @param {object} request The stored request (with its payNow, if any).
 * @param {object} settings payNowSettingsOf.
 * @return {{action: string, amountCents: number, notify: boolean,
 *   balanceDueCents: number, refundDueCents: number}} action: none | open
 *   (create, change the amount, or reopen) | cancel | balances.
 */
function payNowPlan(request, settings) {
  const state = payNowState(request, settings);
  const pay = isObject(request?.payNow) ? request.payNow : null;
  const none = {action: "none", amountCents: 0, notify: false,
    balanceDueCents: 0, refundDueCents: 0};
  if (!pay) {
    return state.payable ?
      {...none, action: "open", amountCents: state.amountCents,
        notify: true} : none;
  }
  if ([STATUS.PAID, STATUS.PARTLY_REFUNDED, STATUS.REFUNDED]
      .includes(pay.status)) {
    const balances = payNowBalances(request);
    const same = cents(pay.balanceDueCents) === balances.balanceDueCents &&
      cents(pay.refundDueCents) === balances.refundDueCents;
    return same ? none : {...none, action: "balances", ...balances};
  }
  if (state.payable) {
    // Open and the same amount: nothing to say. A new amount, or a link
    // that was cancelled and is payable again, is one new message.
    if (pay.status === STATUS.OPEN && cents(pay.amountCents) ===
        state.amountCents) {
      return none;
    }
    return {...none, action: "open", amountCents: state.amountCents,
      notify: true};
  }
  return pay.status === STATUS.CANCELLED ? none :
    {...none, action: "cancel"};
}

/**
 * A fresh payNow record.
 *
 * @param {object} args {token, linkUrl, amountCents, chargeType,
 *   connectedAccountId, nowMs}.
 * @return {object} The stored record.
 */
function newPayNow(args) {
  return {
    status: STATUS.OPEN,
    token: text(args.token, 100),
    linkUrl: text(args.linkUrl, 300),
    amountCents: cents(args.amountCents),
    chargeType: args.chargeType === CHARGE_TYPE.DIRECT ?
      CHARGE_TYPE.DIRECT : CHARGE_TYPE.PLATFORM,
    connectedAccountId: text(args.connectedAccountId, 80),
    checkoutSessionId: "",
    paymentIntentId: "",
    chargeId: "",
    mintCount: 0,
    sessionExpiredAtMs: 0,
    paidAtMs: 0,
    paidCents: 0,
    stripeFeeCents: 0,
    refundedCents: 0,
    refunds: [],
    messages: [],
    balanceDueCents: 0,
    refundDueCents: 0,
    createdAtMs: whole(args.nowMs),
    updatedAtMs: whole(args.nowMs),
  };
}

/**
 * The payNow after a plan.
 *
 * @param {?object} existing The stored payNow, or null.
 * @param {object} plan payNowPlan's answer.
 * @param {object} ctx newPayNow's args (used for a first record).
 * @return {object} The record to store.
 */
function applyPlan(existing, plan, ctx) {
  const nowMs = whole(ctx.nowMs);
  if (plan.action === "open") {
    if (!isObject(existing)) {
      return newPayNow({...ctx, amountCents:
      plan.amountCents});
    }
    return {...existing, status: STATUS.OPEN, amountCents: plan.amountCents,
      sessionExpiredAtMs: 0, updatedAtMs: nowMs};
  }
  if (plan.action === "cancel") {
    return {...existing, status: STATUS.CANCELLED, updatedAtMs: nowMs};
  }
  if (plan.action === "balances") {
    return {...existing, balanceDueCents: plan.balanceDueCents,
      refundDueCents: plan.refundDueCents, updatedAtMs: nowMs};
  }
  return existing;
}

/**
 * What a request closing does to its link: an unpaid one is cancelled; a
 * paid one stays, and when the request ended without being received (the
 * `status` it closes with) all of it is owed back, so staff get the refund
 * prompt.
 *
 * @param {object} request The request before it closes.
 * @param {number} nowMs Now.
 * @param {string} [status] The status it closes with (declined, cancelled,
 *   expired, customer_declined); "" at Received.
 * @return {object} {} or {payNow} to merge into the closing write.
 */
function closePatch(request, nowMs, status = "") {
  const pay = request?.payNow;
  if (!isObject(pay)) return {};
  if (pay.status === STATUS.OPEN) {
    return {payNow: {...pay, status: STATUS.CANCELLED,
      updatedAtMs: whole(nowMs)}};
  }
  if (CLOSED_UNRECEIVED.includes(text(status, 40)) && netPaidCents(pay) > 0) {
    return {payNow: {...pay, balanceDueCents: 0,
      refundDueCents: netPaidCents(pay), updatedAtMs: whole(nowMs)}};
  }
  return {};
}

/**
 * The payNow of a request at Received, when it was paid: it remembers the
 * line payment, and what the online payment is against the received price -
 * an overpayment is owed back (the refund prompt).
 *
 * @param {object} payNow The stored payNow.
 * @param {object} args {linePaymentId, lineId, totalCents (the line's price,
 *   null when unpriced), nowMs}.
 * @return {object} The payNow to store.
 */
function receivedPayNow(payNow, args) {
  const total = Number.isInteger(args.totalCents) ? args.totalCents : null;
  return {...payNow,
    linePaymentId: text(args.linePaymentId, 128),
    receivedLineId: text(args.lineId, 128),
    receivedTotalCents: total,
    balanceDueCents: 0,
    refundDueCents: total === null ? 0 :
      Math.max(0, netPaidCents(payNow) - total),
    updatedAtMs: whole(args.nowMs)};
}

/**
 * What a payment that arrives is: expected (the link is open on a confirmed
 * request) or stray (the request closed, was received, or its link was
 * cancelled - a Checkout Session the customer already had open). A stray
 * payment is refunded in full, never recorded.
 *
 * @param {object} request The stored request.
 * @return {string} "" when expected, else request_closed or link_not_open.
 */
function strayPaymentReason(request) {
  const pay = isObject(request?.payNow) ? request.payNow : null;
  if (text(request?.status, 40) !== "confirmed" ||
      Number(request?.closedAtMs) > 0) {
    return "request_closed";
  }
  return pay && pay.status === STATUS.OPEN ? "" : "link_not_open";
}

/**
 * The line payment left after a refund after Received. The line was only
 * ever credited with the price, so a refund of an overpayment (paid more
 * than the price) takes nothing off it: the credit is capped at what the
 * customer still has paid.
 *
 * @param {number} linePaymentCents The credit on the line before.
 * @param {object} payNow The payNow after the refund is applied.
 * @return {number} The credit that stays on the line.
 */
function lineCreditAfterRefund(linePaymentCents, payNow) {
  return Math.min(cents(linePaymentCents), netPaidCents(payNow));
}

/**
 * The customer's page (getPackageRequestByToken): never the Stripe ids, the
 * token or the connected account.
 *
 * @param {?object} payNow A stored payNow.
 * @return {?object} {status, amountCents, linkUrl, paidCents, refundedCents,
 *   balanceDueCents} or null.
 */
function publicPayNow(payNow) {
  if (!isObject(payNow)) return null;
  const open = payNow.status === STATUS.OPEN;
  return {
    status: text(payNow.status, 30),
    amountCents: cents(payNow.amountCents),
    linkUrl: open ? text(payNow.linkUrl, 300) : "",
    paidCents: cents(payNow.paidCents),
    refundedCents: cents(payNow.refundedCents),
    balanceDueCents: cents(payNow.balanceDueCents),
  };
}

// ---------------------------------------------------------------------------
// Refunds.
// ---------------------------------------------------------------------------

/**
 * Whether a refund may be made.
 *
 * @param {?object} payNow The stored payNow.
 * @param {*} amountCents What staff typed.
 * @param {*} reason Why (optional).
 * @return {{ok: boolean, reason: string, amountCents: number,
 *   remainingCents: number, note: string}} reason is a REASON code when
 *   refused.
 */
function refundDecision(payNow, amountCents, reason = "") {
  const pay = isObject(payNow) ? payNow : null;
  const note = text(reason, MAX_REASON + 1);
  const refuse = (code, remaining = 0) => ({ok: false, reason: code,
    amountCents: 0, remainingCents: remaining, note: ""});
  if (!pay || ![STATUS.PAID, STATUS.PARTLY_REFUNDED].includes(pay.status)) {
    return refuse(REASON.PAY_NOT_PAID);
  }
  const remaining = Math.max(0, cents(pay.paidCents) -
    cents(pay.refundedCents));
  if (note.length > MAX_REASON) {
    return refuse(REASON.REASON_TOO_LONG, remaining);
  }
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    return refuse(REASON.REFUND_INVALID, remaining);
  }
  if (amountCents > remaining) {
    return refuse(REASON.REFUND_TOO_MUCH, remaining);
  }
  return {ok: true, reason: "", amountCents, remainingCents: remaining,
    note};
}

/**
 * The payNow after a refund went through.
 *
 * @param {object} payNow The stored payNow.
 * @param {object} refund {atMs, amountCents, byUid, byName, reason,
 *   refundId}.
 * @return {object} The new record; status partly_refunded or refunded.
 */
function applyRefund(payNow, refund) {
  const refunds = [...(Array.isArray(payNow.refunds) ? payNow.refunds : []),
    {atMs: whole(refund.atMs), amountCents: cents(refund.amountCents),
      byUid: text(refund.byUid, 128), byName: text(refund.byName, 120),
      reason: text(refund.reason, MAX_REASON),
      refundId: text(refund.refundId, 80)}];
  const refundedCents = cents(payNow.refundedCents) +
    cents(refund.amountCents);
  return {...payNow, refunds, refundedCents,
    status: refundedCents >= cents(payNow.paidCents) ? STATUS.REFUNDED :
      STATUS.PARTLY_REFUNDED,
    updatedAtMs: whole(refund.atMs)};
}

/**
 * @param {object[]} messages The stored messages.
 * @param {object} entry {atMs, amountCents, channel, ok, kind, error}.
 * @return {object[]} With the entry added, the oldest dropped past 20.
 */
function appendMessage(messages, entry) {
  const list = Array.isArray(messages) ? messages : [];
  return [...list, {
    atMs: whole(entry.atMs),
    amountCents: cents(entry.amountCents),
    channel: entry.channel === "session" ? "session" : "template",
    ok: entry.ok === true,
    kind: text(entry.kind, 20) || "link",
    ...(entry.error ? {error: text(entry.error, 200)} : {}),
  }].slice(-MAX_MESSAGES);
}

// ---------------------------------------------------------------------------
// Weeks (Monday to Sunday, America/New_York).
// ---------------------------------------------------------------------------

const zoneFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hourCycle: "h23", weekday: "short",
});

/**
 * @param {number} ms An instant.
 * @return {{year: number, month: number, day: number, hour: number,
 *   weekday: number}} New York's calendar at that instant (weekday 0 =
 *   Monday).
 */
function zonedParts(ms) {
  const parts = Object.fromEntries(zoneFormat.formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        .indexOf(parts.weekday),
  };
}

const dayKeyOf = (utcMs) => new Date(utcMs).toISOString().slice(0, 10);

/**
 * @param {number} ms An instant.
 * @return {string} The Monday ("YYYY-MM-DD") of the New York week it is in.
 */
function weekKeyFor(ms) {
  const p = zonedParts(Number(ms));
  const localMidnightUtc = Date.UTC(p.year, p.month - 1, p.day);
  return dayKeyOf(localMidnightUtc - p.weekday * DAY_MS);
}

/**
 * @param {number} ms An instant.
 * @return {string} The New York calendar day ("YYYY-MM-DD") it is in.
 */
function zonedDayKey(ms) {
  const p = zonedParts(Number(ms));
  return dayKeyOf(Date.UTC(p.year, p.month - 1, p.day));
}

/**
 * @param {*} key A candidate week key.
 * @return {boolean} Whether it is a Monday written "YYYY-MM-DD".
 */
function weekKeyValid(key) {
  const value = text(key, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const utc = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(utc) && dayKeyOf(utc) === value &&
    new Date(utc).getUTCDay() === 1;
}

/**
 * @param {string} weekKey A Monday.
 * @param {number} days Days to add.
 * @return {string} The day key.
 */
function addDays(weekKey, days) {
  return dayKeyOf(Date.parse(`${weekKey}T00:00:00Z`) + days * DAY_MS);
}

/**
 * @param {string} dayKey "YYYY-MM-DD".
 * @return {number} The instant New York's midnight starts that day (the
 *   day is 23 to 25 hours long around the clock change; midnight itself is
 *   never skipped).
 */
function zonedMidnightMs(dayKey) {
  const base = Date.parse(`${dayKey}T00:00:00Z`);
  // New York is UTC-5 or UTC-4: midnight there is 05:00Z or 04:00Z.
  for (const hours of [4, 5]) {
    const candidate = base + hours * 60 * 60 * 1000;
    const p = zonedParts(candidate);
    if (p.hour === 0 && Date.UTC(p.year, p.month - 1, p.day) === base) {
      return candidate;
    }
  }
  return base + 5 * 60 * 60 * 1000;
}

/**
 * @param {string} weekKey A Monday.
 * @return {{startKey: string, endKey: string, payoutKey: string,
 *   startMs: number, endMs: number}} The week; `endMs` is the instant the
 *   next Monday begins (the week is over from then on), `payoutKey` that
 *   Monday.
 */
function weekRange(weekKey) {
  const payoutKey = addDays(weekKey, 7);
  return {startKey: weekKey, endKey: addDays(weekKey, 6), payoutKey,
    startMs: zonedMidnightMs(weekKey), endMs: zonedMidnightMs(payoutKey)};
}

// ---------------------------------------------------------------------------
// The ledger and the weekly payout.
// ---------------------------------------------------------------------------

/**
 * One ledger row. Signed: positive means Laawol owes the business more.
 *
 * @param {object} args {businessId, requestId, requestCode, type,
 *   amountCents, atMs, byUid, byName, note, weekKey (optional: a week that
 *   was already paid moves the row into the current one)}.
 * @return {object} The row.
 */
function ledgerRow(args) {
  const amount = Number(args.amountCents);
  if (!LEDGER_TYPES.includes(args.type) || !Number.isInteger(amount)) {
    throw new Error(`Bad ledger row: ${args.type} ${args.amountCents}`);
  }
  return {
    businessId: text(args.businessId, 128),
    requestId: text(args.requestId, 128),
    requestCode: text(args.requestCode, 20),
    type: args.type,
    amountCents: amount,
    weekKey: weekKeyValid(args.weekKey) ? args.weekKey :
      weekKeyFor(args.atMs),
    atMs: whole(args.atMs),
    byUid: text(args.byUid, 128),
    byName: text(args.byName, 120),
    note: text(args.note, MAX_REASON),
  };
}

/**
 * The rows of a payment on a platform charge: the money in, then Stripe's
 * fee out. Ids are fixed so a replayed event writes the same rows.
 *
 * @param {object} args {businessId, requestId, requestCode, paidCents,
 *   stripeFeeCents, atMs, weekKey?}.
 * @return {Array<{id: string, row: object}>} The rows.
 */
function paymentRows(args) {
  const base = {businessId: args.businessId, requestId: args.requestId,
    requestCode: args.requestCode, atMs: args.atMs, weekKey: args.weekKey,
    byUid: "", byName: ""};
  const rows = [{id: `${args.requestId}_payment`, row: ledgerRow({...base,
    type: LEDGER_TYPE.PAYMENT, amountCents: cents(args.paidCents),
    note: "Paid online by card"})}];
  if (cents(args.stripeFeeCents) > 0) {
    rows.push({id: `${args.requestId}_fee`, row: ledgerRow({...base,
      type: LEDGER_TYPE.STRIPE_FEE,
      amountCents: -cents(args.stripeFeeCents), note: "Stripe card fee"})});
  }
  return rows;
}

/**
 * @param {object} args {businessId, requestId, requestCode, refundId,
 *   amountCents, atMs, byUid, byName, note, weekKey?}.
 * @return {{id: string, row: object}} The refund's row.
 */
function refundRow(args) {
  return {id: `${args.requestId}_refund_${text(args.refundId, 60)}`,
    row: ledgerRow({...args, type: LEDGER_TYPE.REFUND,
      amountCents: -cents(args.amountCents)})};
}

/**
 * A card dispute: the amount goes back to the cardholder and Stripe charges
 * its dispute fee.
 *
 * @param {object} args {businessId, requestId, requestCode, disputeId,
 *   amountCents, atMs, weekKey?}.
 * @return {Array<{id: string, row: object}>} The two rows.
 */
function disputeRows(args) {
  const base = {businessId: args.businessId, requestId: args.requestId,
    requestCode: args.requestCode, atMs: args.atMs, weekKey: args.weekKey,
    byUid: "", byName: ""};
  const id = text(args.disputeId, 80);
  return [
    {id: `${args.requestId}_dispute_${id}`, row: ledgerRow({...base,
      type: LEDGER_TYPE.CHARGEBACK, amountCents: -cents(args.amountCents),
      note: "Card dispute"})},
    {id: `${args.requestId}_dispute_${id}_fee`, row: ledgerRow({...base,
      type: LEDGER_TYPE.DISPUTE_FEE, amountCents: -DISPUTE_FEE_CENTS,
      note: "Stripe dispute fee"})},
  ];
}

/**
 * A dispute Laawol won: the amount comes back to the business.
 *
 * @param {object} args disputeRows' args.
 * @return {{id: string, row: object}} The row.
 */
function disputeWonRow(args) {
  return {id: `${args.requestId}_dispute_${text(args.disputeId, 80)}_won`,
    row: ledgerRow({businessId: args.businessId, requestId: args.requestId,
      requestCode: args.requestCode, atMs: args.atMs, weekKey: args.weekKey,
      type: LEDGER_TYPE.CHARGEBACK, amountCents: cents(args.amountCents),
      note: "Card dispute won"})};
}

/**
 * What one week's rows come to, and what a payout would do.
 *
 * @param {object[]} rows The week's ledger rows (any order).
 * @param {object} [options] {unpaidBillCents: the business's unpaid Laawol
 *   bill to take out of this week}.
 * @return {object} {collectedCents, feesCents, refundsCents,
 *   chargebacksCents, beforeBillCents, billOffsetCents, netCents,
 *   toBillCents, payoutCents, lines}. Fees, refunds and chargebacks are
 *   positive amounts taken off; a won dispute lowers chargebacks.
 *   `billOffsetCents` is what the bill takes (never more than the week
 *   brought), `toBillCents` is the shortfall a negative week puts on the
 *   bill, `payoutCents` is what Laawol sends, and `netCents` is the week's
 *   result after the bill (negative = business owes).
 */
function summarizeWeek(rows, options = {}) {
  const list = Array.isArray(rows) ? rows.filter(isObject) : [];
  const sum = (types) => list.filter((row) => types.includes(row.type))
      .reduce((total, row) => total + whole(row.amountCents), 0);
  const collectedCents = sum([LEDGER_TYPE.PAYMENT]);
  const feesCents = 0 - sum([LEDGER_TYPE.STRIPE_FEE]);
  const refundsCents = 0 - sum([LEDGER_TYPE.REFUND]);
  const chargebacksCents = 0 - sum([LEDGER_TYPE.CHARGEBACK,
    LEDGER_TYPE.DISPUTE_FEE]);
  const beforeBillCents = collectedCents - feesCents - refundsCents -
    chargebacksCents;
  const unpaidBill = cents(options.unpaidBillCents);
  const recordedOffset = 0 - sum([LEDGER_TYPE.BILL_OFFSET]);
  const billOffsetCents = recordedOffset > 0 ? recordedOffset :
    Math.min(unpaidBill, Math.max(0, beforeBillCents));
  const toBillCents = beforeBillCents < 0 ? -beforeBillCents : 0;
  const netCents = beforeBillCents - billOffsetCents;
  return {
    collectedCents, feesCents, refundsCents, chargebacksCents,
    beforeBillCents, billOffsetCents, netCents, toBillCents,
    payoutCents: Math.max(0, netCents),
    lines: list.length,
  };
}

/**
 * The state of a week.
 *
 * @param {object} args {weekKey, nowMs, summary (summarizeWeek), paid
 *   (the week was paid out), rows (count)}.
 * @return {string} open (still running) | due | paid | nothing.
 */
function weekStatus(args) {
  if (args.paid === true) return PAYOUT_STATUS.PAID;
  if (!(Number(args.rows) > 0)) return PAYOUT_STATUS.NOTHING;
  if (Number(args.nowMs) < weekRange(args.weekKey).endMs) {
    return PAYOUT_STATUS.OPEN;
  }
  const s = args.summary;
  return s.beforeBillCents === 0 && s.billOffsetCents === 0 ?
    PAYOUT_STATUS.NOTHING : PAYOUT_STATUS.DUE;
}

/**
 * Spreads a business's unpaid Laawol bill over its unpaid weeks, oldest
 * first, the way payouts will take it: a week takes what it can (never more
 * than it brought); a negative week adds its shortfall to the bill for the
 * weeks after it.
 *
 * @param {Array<{weekKey: string, beforeBillCents: number}>} weeks Unpaid
 *   weeks.
 * @param {number} unpaidBillCents The bill today.
 * @return {Map<string, number>} The offset each week would take.
 */
function planOffsets(weeks, unpaidBillCents) {
  let remaining = cents(unpaidBillCents);
  const out = new Map();
  const ordered = [...weeks].sort((a, b) =>
    String(a.weekKey).localeCompare(String(b.weekKey)));
  for (const week of ordered) {
    const before = whole(week.beforeBillCents);
    if (before < 0) {
      remaining += -before;
      out.set(week.weekKey, 0);
      continue;
    }
    const take = Math.min(remaining, before);
    remaining -= take;
    out.set(week.weekKey, take);
  }
  return out;
}

/**
 * What a payout action must do, from the week's rows and the live bill.
 *
 * @param {object[]} rows The week's rows (no payout rows yet).
 * @param {number} unpaidBillCents Unpaid Laawol bill today.
 * @return {object} summarizeWeek's answer, with `kind`: payout (money goes
 *   out), bill_only (everything went to the bill), to_bill (a negative week
 *   goes onto the bill) or empty.
 */
function payoutPlan(rows, unpaidBillCents) {
  const summary = summarizeWeek(rows.filter((row) => ![
    LEDGER_TYPE.BILL_OFFSET, LEDGER_TYPE.PAYOUT, LEDGER_TYPE.TO_BILL,
  ].includes(row.type)), {unpaidBillCents});
  let kind = "empty";
  if (summary.beforeBillCents < 0) kind = "to_bill";
  else if (summary.payoutCents > 0) kind = "payout";
  else if (summary.billOffsetCents > 0) kind = "bill_only";
  return {...summary, kind};
}

/**
 * The rows a payout writes.
 *
 * @param {object} args {businessId, weekKey, plan (payoutPlan), atMs,
 *   byUid, byName, method, reference}.
 * @return {Array<{id: string, row: object}>} bill_offset, payout, to_bill
 *   as the plan needs them.
 */
function payoutRows(args) {
  const base = {businessId: args.businessId, requestId: "", requestCode: "",
    atMs: args.atMs, weekKey: args.weekKey, byUid: args.byUid,
    byName: args.byName};
  const id = `${args.businessId}_${args.weekKey}`;
  const rows = [];
  const plan = args.plan;
  if (plan.billOffsetCents > 0) {
    rows.push({id: `${id}_offset`, row: ledgerRow({...base,
      type: LEDGER_TYPE.BILL_OFFSET, amountCents: -plan.billOffsetCents,
      note: "Taken out for the Laawol bill"})});
  }
  if (plan.payoutCents > 0) {
    rows.push({id: `${id}_payout`, row: ledgerRow({...base,
      type: LEDGER_TYPE.PAYOUT, amountCents: -plan.payoutCents,
      note: [text(args.method, 20), text(args.reference, MAX_REFERENCE)]
          .filter(Boolean).join(" ")})});
  }
  if (plan.toBillCents > 0) {
    rows.push({id: `${id}_to_bill`, row: ledgerRow({...base,
      type: LEDGER_TYPE.TO_BILL, amountCents: plan.toBillCents,
      note: "Negative week put on the Laawol bill"})});
  }
  return rows;
}

/**
 * Validates a "Paid out" action.
 *
 * @param {object} data {businessId, weekKey, method, reference}.
 * @param {number} nowMs Now.
 * @return {{errors: string[], method: string, reference: string,
 *   weekKey: string}} The cleaned input and every problem (method is only
 *   required when money goes out, which the handler decides).
 */
function cleanPayoutInput(data, nowMs) {
  const input = isObject(data) ? data : {};
  const errors = [];
  const weekKey = text(input.weekKey, 10);
  if (!weekKeyValid(weekKey)) errors.push(REASON.WEEK_INVALID);
  else if (Number(nowMs) < weekRange(weekKey).endMs) {
    errors.push(REASON.WEEK_NOT_OVER);
  }
  const method = text(input.method, 20).toLowerCase();
  const reference = text(input.reference, MAX_REFERENCE + 1);
  if (reference.length > MAX_REFERENCE) {
    errors.push(REASON.REFERENCE_TOO_LONG);
  }
  return {errors, weekKey, method: PAYOUT_METHODS.includes(method) ?
    method : "", reference: reference.slice(0, MAX_REFERENCE)};
}

// ---------------------------------------------------------------------------
// Words: money, dates and the WhatsApp bodies.
// ---------------------------------------------------------------------------

const MONTHS_EN = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
const MONTHS_FR = Object.freeze(["janv.", "févr.", "mars", "avr.", "mai",
  "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]);

/**
 * @param {number} value Whole cents.
 * @return {string} "$130.00" (thousands with commas).
 */
function moneyEn(value) {
  const n = Math.round(Number(value) || 0);
  const dollars = Math.trunc(Math.abs(n) / 100)
      .toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}$${dollars}.${String(Math.abs(n) % 100)
      .padStart(2, "0")}`;
}

/**
 * @param {number} value Whole cents.
 * @return {string} "130,00 $" (a plain space between thousands).
 */
function moneyFr(value) {
  const n = Math.round(Number(value) || 0);
  const dollars = Math.trunc(Math.abs(n) / 100)
      .toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n < 0 ? "-" : ""}${dollars},${String(Math.abs(n) % 100)
      .padStart(2, "0")} $`;
}

/**
 * @param {string} dayKey "YYYY-MM-DD".
 * @param {"en"|"fr"} language The words.
 * @return {string} "Nov 2, 2026" / "2 nov. 2026"; "" for no day.
 */
function dateText(dayKey, language) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(dayKey, 10));
  if (!match) return "";
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (month < 0 || month > 11) return "";
  return language === "fr" ?
    `${day === 1 ? "1er" : day} ${MONTHS_FR[month]} ${match[1]}` :
    `${MONTHS_EN[month]} ${day}, ${match[1]}`;
}

const TEMPLATE_LANGUAGE = "en";
const TEMPLATE = Object.freeze({
  PAY_NOW: "package_pay_now_2lang",
  PAYOUT: "pay_now_payout_2lang",
});

const param = (value) => ({type: "text", text: text(value, 200)
    .replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ") || "-"});

/**
 * The pay link template: {{1}} name, {{2}} business, {{3}} amount EN, {{4}}
 * business, {{5}} amount FR, {{6}} request code; the URL button
 * https://laawoldigital.com/p?t={{1}} carries the pay token.
 *
 * @param {object} args {phone, name, business, amountCents, code, token}.
 * @return {object} The /messages body.
 */
function payNowTemplateMessage(args) {
  return {
    messaging_product: "whatsapp",
    to: String(args.phone ?? "").replace(/\D/g, ""),
    type: "template",
    template: {
      name: TEMPLATE.PAY_NOW,
      language: {code: TEMPLATE_LANGUAGE},
      components: [
        {type: "body", parameters: [
          param(args.name), param(args.business),
          param(moneyEn(args.amountCents)), param(args.business),
          param(moneyFr(args.amountCents)), param(args.code),
        ]},
        {type: "button", sub_type: "url", index: "0",
          parameters: [param(args.token)]},
      ],
    },
  };
}

/**
 * The pay link as a session message (inside the customer's 24-hour window),
 * with a button, for the days the template is not approved yet.
 *
 * @param {object} args {phone, name, business, amountCents, code, url,
 *   language}.
 * @return {object} The /messages body.
 */
function payNowSessionMessage(args) {
  const fr = args.language === "fr";
  const name = text(args.name, 60);
  const body = fr ?
    `Bonjour ${name}, votre envoi ${text(args.code, 20)} chez ` +
      `${text(args.business, 80)} coûte ${moneyFr(args.amountCents)}. ` +
      "Vous pouvez payer par carte maintenant, ou au comptoir." :
    `Hi ${name}, your shipment ${text(args.code, 20)} with ` +
      `${text(args.business, 80)} is ${moneyEn(args.amountCents)}. You can ` +
      "pay by card now, or at the counter.";
  return {
    messaging_product: "whatsapp",
    to: String(args.phone ?? "").replace(/\D/g, ""),
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: {text: body.slice(0, 1000)},
      action: {name: "cta_url", parameters: {
        display_text: fr ? "Payer maintenant" : "Pay now",
        url: text(args.url, 500)}},
    },
  };
}

/**
 * The customer's refund notice (a plain message, inside the 24-hour window).
 *
 * @param {object} args {phone, name, business, code, amountCents, language}.
 * @return {object} The /messages body.
 */
function refundTextMessage(args) {
  const fr = args.language === "fr";
  const body = fr ?
    `Bonjour ${text(args.name, 60)}, ${text(args.business, 80)} vous a ` +
      `remboursé ${moneyFr(args.amountCents)} pour l'envoi ` +
      `${text(args.code, 20)}. Il apparaît sur votre carte sous quelques ` +
      "jours." :
    `Hi ${text(args.name, 60)}, ${text(args.business, 80)} refunded ` +
      `${moneyEn(args.amountCents)} for shipment ${text(args.code, 20)}. ` +
      "It shows on your card in a few days.";
  return {
    messaging_product: "whatsapp",
    to: String(args.phone ?? "").replace(/\D/g, ""),
    type: "text",
    text: {body, preview_url: false},
  };
}

/**
 * The weekly payout receipt: {{1}} name, {{2}} amount EN, {{3}} week EN
 * (the Monday), {{4}} amount FR, {{5}} week FR, {{6}} method.
 *
 * @param {object} args {phone, name, amountCents, weekKey, method}.
 * @return {object} The /messages body.
 */
function payoutTemplateMessage(args) {
  return {
    messaging_product: "whatsapp",
    to: String(args.phone ?? "").replace(/\D/g, ""),
    type: "template",
    template: {
      name: TEMPLATE.PAYOUT,
      language: {code: TEMPLATE_LANGUAGE},
      components: [{type: "body", parameters: [
        param(args.name),
        param(moneyEn(args.amountCents)),
        param(dateText(args.weekKey, "en")),
        param(moneyFr(args.amountCents)),
        param(dateText(args.weekKey, "fr")),
        param(PAYOUT_METHOD_WORDS[args.method] || PAYOUT_METHOD_WORDS.other),
      ]}],
    },
  };
}

/**
 * The staff's push when a customer pays online.
 *
 * @param {object} request The request.
 * @param {number} paidCents What was paid.
 * @param {"en"|"fr"} language The reader.
 * @return {{title: string, body: string}} The words.
 */
function paidNotificationText(request, paidCents, language) {
  const fr = language === "fr";
  const who = text(request?.sender?.name, 60) ||
    (fr ? "Un client" : "A customer");
  const code = text(request?.code, 20);
  return {
    title: fr ? "Payé en ligne" : "Paid online",
    body: [who, fr ? moneyFr(paidCents) : moneyEn(paidCents), code]
        .filter(Boolean).join(" · "),
  };
}

/**
 * The staff's push when a payment arrived on a request that could no longer
 * take it and was refunded at once.
 *
 * @param {object} request The request.
 * @param {number} paidCents What the card was charged.
 * @param {"en"|"fr"} language The reader.
 * @return {{title: string, body: string}} The words.
 */
function strayNotificationText(request, paidCents, language) {
  const fr = language === "fr";
  const who = text(request?.sender?.name, 60) ||
    (fr ? "Un client" : "A customer");
  return {
    title: fr ? "Paiement en ligne remboursé" : "Online payment refunded",
    body: [who, fr ? moneyFr(paidCents) : moneyEn(paidCents),
      text(request?.code, 20), fr ? "demande déjà close" :
        "request no longer open"].filter(Boolean).join(" · "),
  };
}

/**
 * The staff's push when a refund was made in the Stripe dashboard.
 *
 * @param {object} request The request.
 * @param {number} refundedCents The refund.
 * @param {"en"|"fr"} language The reader.
 * @return {{title: string, body: string}} The words.
 */
function refundNotificationText(request, refundedCents, language) {
  const fr = language === "fr";
  const who = text(request?.sender?.name, 60) ||
    (fr ? "Un client" : "A customer");
  return {
    title: fr ? "Remboursement en ligne" : "Online refund",
    body: [who, fr ? moneyFr(refundedCents) : moneyEn(refundedCents),
      text(request?.code, 20)].filter(Boolean).join(" · "),
  };
}

module.exports = {
  TIME_ZONE,
  MAX_PAY_CENTS,
  DISPUTE_FEE_CENTS,
  PAYMENT_TYPE,
  STATUS,
  CHARGE_TYPE,
  LEDGER_TYPE,
  LEDGER_TYPES,
  PAYOUT_STATUS,
  PAYOUT_METHODS,
  REASON,
  MESSAGES,
  TEMPLATE,
  payNowSettingsOf,
  payNowFromInput,
  chargeTypeOf,
  payNowState,
  netPaidCents,
  payNowBalances,
  payNowPlan,
  newPayNow,
  applyPlan,
  closePatch,
  strayPaymentReason,
  receivedPayNow,
  lineCreditAfterRefund,
  publicPayNow,
  refundDecision,
  applyRefund,
  appendMessage,
  weekKeyFor,
  zonedDayKey,
  weekKeyValid,
  weekRange,
  addDays,
  zonedMidnightMs,
  ledgerRow,
  paymentRows,
  refundRow,
  disputeRows,
  disputeWonRow,
  summarizeWeek,
  weekStatus,
  planOffsets,
  payoutPlan,
  payoutRows,
  cleanPayoutInput,
  moneyEn,
  moneyFr,
  dateText,
  payNowTemplateMessage,
  payNowSessionMessage,
  refundTextMessage,
  payoutTemplateMessage,
  paidNotificationText,
  strayNotificationText,
  refundNotificationText,
};

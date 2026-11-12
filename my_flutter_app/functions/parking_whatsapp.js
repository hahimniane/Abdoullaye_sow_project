"use strict";

/**
 * Parking customers on WhatsApp (docs/PARKING_WHATSAPP.md): the pure rules.
 *
 * The person a car is parked under hears from the lot on WhatsApp once when
 * the car is parked, and a receipt with a PDF for every payment. This module
 * decides WHO is told WHAT (from the parkedCars write and the business's
 * switch), names the rows that make each message happen once, and writes
 * every value a template carries. index.js does the reads, the sends and
 * the writes; nothing here touches Firestore, Storage or the network.
 */

const crypto = require("node:crypto");

const {
  dayKeyOf,
  dayNumber,
  mostUsedName,
  parkingBalanceNow,
  paymentCents,
} = require("./parking_month_statement");
const {
  isInternationalPhone,
  phoneWithBusinessCountry,
} = require("./container_manifest");
const {PARKING_TEMPLATE} = require("./whatsapp_templates");
const {billPaymentFor} = require("./parking_bill_payment");

const KIND = Object.freeze({
  PARKED: "parked",
  INVOICE: "invoice",
  RECEIPT: "receipt",
  WELCOME: "welcome",
  // One receipt for a payment on a whole month bill
  // (docs/PARKING_BILL_PAYMENTS.md), instead of one per car it touched.
  BILL_RECEIPT: "bill_receipt",
  // The car left (docs/PARKING_LEFT_WHATSAPP.md): its invoice or receipt.
  LEFT: "left",
});

const STATUS = Object.freeze({
  QUEUED: "queued",
  SENT: "sent",
  FAILED: "failed",
  STOPPED: "stopped",
  SKIPPED: "skipped",
});

// Refusals of updateBusinessParkingEntry's WhatsApp actions.
const REFUSAL = Object.freeze({
  OFF: "parking_whatsapp_off",
  WELCOME_OWNER_ONLY: "welcome_owner_only",
  SWITCH_OWNER_ONLY: "parking_whatsapp_owner_only",
  // The "Send on WhatsApp" button (docs/PARKING_LEFT_WHATSAPP.md §2).
  CAR_NOT_MESSAGEABLE: "car_not_messageable",
  NO_PHONE: "no_phone",
  NEEDS_COUNTRY_CODE: "needs_country_code",
  SEND_LIMIT: "send_limit",
});

const REFUSAL_MESSAGE = Object.freeze({
  [REFUSAL.OFF]: "Parking messages on WhatsApp are switched off for this " +
    "business. Turn them on first.",
  [REFUSAL.WELCOME_OWNER_ONLY]: "Only the business owner can send the " +
    "welcome message to current customers.",
  [REFUSAL.SWITCH_OWNER_ONLY]: "Only the business owner can switch parking " +
    "messages on WhatsApp on or off.",
  [REFUSAL.CAR_NOT_MESSAGEABLE]: "This car's customer can't be messaged (a " +
    "team member's car, a voided car, or an online booking).",
  [REFUSAL.NO_PHONE]: "Add the customer's WhatsApp number first.",
  [REFUSAL.NEEDS_COUNTRY_CODE]: "Add the country code to the number.",
  [REFUSAL.SEND_LIMIT]: "This car's message was sent 5 times today. Try " +
    "again tomorrow.",
});

// The most "Send on WhatsApp" presses one car takes in a day.
const MANUAL_SENDS_PER_DAY = 5;

// One call may message this many numbers (sequential sends).
const WELCOME_MAX_PER_CALL = 300;

const MONTHS_EN = Object.freeze([
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
]);
const MONTHS_FR = Object.freeze([
  "janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre",
]);

// Short months, for the "left on" date: "Nov 9, 2026" / "9 nov. 2026".
const MONTHS_SHORT_EN = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);
const MONTHS_SHORT_FR = Object.freeze([
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
]);

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * @param {*} value A Timestamp, Date, {seconds}, number or ISO string.
 * @return {number} Epoch milliseconds, 0 when it is none of those.
 */
function msOf(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const seconds = Number(value.seconds ?? value._seconds);
  if (Number.isFinite(seconds)) {
    const nanos = Number(value.nanoseconds ?? value._nanoseconds) || 0;
    return seconds * 1000 + Math.floor(nanos / 1e6);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * @param {object} business A businesses document.
 * @return {boolean} Whether the owner switched parking messages on.
 */
function parkingWhatsAppEnabled(business) {
  return business?.parkingWhatsApp?.enabled === true;
}

/**
 * @param {object} business A businesses document.
 * @return {number} When the switch was turned on (0 when unknown).
 */
function parkingWhatsAppEnabledAtMs(business) {
  return Math.max(0, Math.round(
      Number(business?.parkingWhatsApp?.enabledAtMs) || 0));
}

/**
 * Whether a parked car is one this feature speaks about: a car the lot
 * entered itself (a customer's own online reservation has not arrived
 * yet and already has Stripe's receipt), not voided and not cancelled.
 *
 * @param {object} car A parkedCars document.
 * @return {boolean} True for a car whose customer is messaged.
 */
function carIsMessageable(car) {
  if (!car || typeof car !== "object") return false;
  if (car.voided === true || text(car.status, 40) === "cancelled") {
    return false;
  }
  // A team member's own car: settled in Staff balances, never messaged as
  // a customer (docs/PARKING_TEAM_CARS.md).
  if (text(car.forStaffId, 128)) return false;
  return text(car.source, 40) === "business" ||
    car.enteredByBusiness === true;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const SETTLED_STATUSES = Object.freeze(["paid", "succeeded"]);

const isSettled = (car) =>
  SETTLED_STATUSES.includes(text(car?.paymentStatus, 40));

/**
 * The id a payment goes by: its own `id` when the writer gave it one,
 * otherwise derived from what identifies it - nothing records one today, so
 * every `parkingPayments` entry gets `p_` + the first 20 hex digits of
 * sha1("businessId|carId|amountCents|receivedAtMs"). The same payment
 * always has the same id, so a duplicate trigger delivery makes the same
 * row (and `.create()` refuses the second).
 *
 * @param {{businessId: string, carId: string, payment: object}} args The
 *   car and one entry of its `parkingPayments`.
 * @return {string} A document-id-safe id.
 */
function paymentIdOf({businessId, carId, payment}) {
  const own = text(payment?.id, 60);
  if (/^[A-Za-z0-9_-]{1,60}$/.test(own)) return own;
  const key = [text(businessId, 200), text(carId, 200),
    paymentCents(payment), msOf(payment?.at)].join("|");
  return `p_${crypto.createHash("sha1").update(key).digest("hex")
      .slice(0, 20)}`;
}

/**
 * The payments on a car that count: not reverted, with an amount.
 *
 * @param {{businessId: string, carId: string, car: object}} args The car.
 * @return {Array<object>} `{id, amountCents, receivedVia,
 *   receivedByStaffId, atMs, number}` in the order recorded; `number` is
 *   the receipt's position (1-based).
 */
function livePayments({businessId, carId, car}) {
  const list = Array.isArray(car?.parkingPayments) ? car.parkingPayments : [];
  const out = [];
  for (const payment of list) {
    if (!payment || typeof payment !== "object" ||
        payment.reverted === true || paymentCents(payment) <= 0) continue;
    out.push({
      id: paymentIdOf({businessId, carId, payment}),
      amountCents: paymentCents(payment),
      receivedVia: text(payment.receivedVia, 40).toLowerCase(),
      receivedByStaffId: text(payment.receivedByStaffId, 180),
      atMs: msOf(payment.at),
      number: out.length + 1,
    });
  }
  return out;
}

/**
 * What a settle-in-full came to: the recorded total, else - for a stay
 * priced as a whole - its amount due, else what the stay has run up.
 *
 * @param {object} car A parkedCars document.
 * @param {Date} now The moment.
 * @return {number} Cents.
 */
function settledCents(car, now) {
  const recorded = Math.max(0, Math.round(Number(car?.amountPaidCents) || 0));
  if (recorded > 0) return recorded;
  // An agreed discount is not money: a car it settles was paid only the
  // rest (docs/PARKING_DISCOUNT.md).
  const discount = Math.max(0,
      Math.round(Number(car?.parkingDiscountCents) || 0));
  const due = Math.max(0, Math.round(
      Number(car?.amountDueCents ?? car?.totalCostCents) || 0));
  if (car?.parkingEndDate && due > 0) return Math.max(0, due - discount);
  const accrued = parkingBalanceNow({...car, parkingPayments: []}, now)
      ?.accruedCents || 0;
  return Math.max(0, accrued - discount);
}

/**
 * The payments one write added to a car.
 *
 * A part payment appends to `parkingPayments`. The other ways a car gets
 * paid (marked paid in full, a payment link paid through Stripe, a payment
 * link recorded as received) flip `paymentStatus` to paid / succeeded
 * without an entry: that is one payment too, for what it added to the
 * total, identified by the moment it was received. A car just created, or
 * one with a payment reverted, adds none.
 *
 * @param {{businessId: string, carId: string, before: ?object,
 *   after: object, eventMs: number, now: Date}} args The write.
 * @return {Array<object>} Each as livePayments gives it; `synthetic: true`
 *   for one with no entry.
 */
function newPayments({businessId, carId, before, after, eventMs, now}) {
  if (!before || !after) return [];
  const known = new Set((Array.isArray(before.parkingPayments) ?
    before.parkingPayments : []).map((payment) =>
    paymentIdOf({businessId, carId, payment})));
  // A month bill payment's car parts are announced once, by the bill
  // payment's own receipt - not one receipt per car, and not as a car
  // just settled either (docs/PARKING_BILL_PAYMENTS.md).
  const added = (Array.isArray(after.parkingPayments) ?
    after.parkingPayments : []).filter((payment) => payment &&
    typeof payment === "object" &&
    !known.has(paymentIdOf({businessId, carId, payment})));
  if (added.some((payment) => text(payment.billPaymentId, 80))) return [];
  const live = livePayments({businessId, carId, car: after});
  const fresh = live.filter((payment) => !known.has(payment.id));
  if (fresh.length > 0) return fresh;
  if (!isSettled(after) || isSettled(before)) return [];
  const settled = settledCents(after, now) -
    Math.max(0, Math.round(Number(before.amountPaidCents) || 0));
  if (settled <= 0) return [];
  const atMs = msOf(after.directPaymentReceivedAt) || msOf(after.paidAt) ||
    msOf(after.lastPaymentAt) || Math.round(Number(eventMs) || 0);
  const via = text(after.directPaymentMethod, 40).toLowerCase() ||
    (text(after.paymentMethod, 40) === "payment_link" ? "card_link" :
      "online");
  const synthetic = {amountCents: settled, at: atMs};
  return [{
    id: paymentIdOf({businessId, carId, payment: synthetic}),
    amountCents: settled,
    receivedVia: via,
    receivedByStaffId: text(after.receivedByStaffId, 180),
    atMs,
    number: live.length + 1,
    synthetic: true,
  }];
}

/**
 * The end day of a car's stay.
 *
 * @param {object} car A parkedCars document.
 * @return {?number} The day number (parkingBalanceNow's count), or null for
 *   a stay with no end date.
 */
function endDayOf(car) {
  return dayNumber(car?.parkingEndDate);
}

/**
 * Whether a car has left: it has an end day and that day is today or
 * earlier (the rule behind the "car left" message and the button).
 *
 * @param {object} car A parkedCars document.
 * @param {Date} now The moment.
 * @return {boolean} True once the car has left.
 */
function carHasLeft(car, now) {
  const end = endDayOf(car);
  const today = dayNumber(now);
  return end !== null && today !== null && end <= today;
}

/**
 * The "car left" message one write calls for: the write set the end date
 * or moved it to another day, and that day is today or earlier. A future
 * end date sends nothing yet (staff use the button once the car has
 * actually left); a car just created is covered by its "parked" message.
 *
 * @param {?object} before The car before the write.
 * @param {object} after The car after the write.
 * @param {Date} now The moment.
 * @return {?{endDayKey: string}} The day it left, or null.
 */
function leftPlan(before, after, now) {
  if (!before || !carHasLeft(after, now)) return null;
  const end = endDayOf(after);
  if (end === endDayOf(before)) return null;
  return {endDayKey: dayKeyOf(end)};
}

/**
 * What one parkedCars write calls for, before the business is read.
 *
 * @param {{businessId: string, carId: string, before: ?object,
 *   after: ?object, eventMs: number, now: Date}} args The write.
 * @return {{parked: boolean, receipts: Array<object>, left: ?object,
 *   phoneChanged: boolean}} A `parked` message for a car just created; one
 *   receipt per payment just added; a `left` message (see leftPlan) when
 *   the car was just marked as left; `phoneChanged` when the customer's
 *   number is another one (phoneFixPlan decides what to resend once the
 *   business is read).
 */
function plannedMessages({businessId, carId, before, after, eventMs, now}) {
  const none = {parked: false, receipts: [], left: null,
    phoneChanged: false};
  if (!after || !carIsMessageable(after)) return none;
  if (!before) return {...none, parked: true};
  return {
    parked: false,
    receipts: newPayments({businessId, carId, before, after, eventMs, now}),
    left: leftPlan(before, after, now),
    phoneChanged: phoneDigits(after.customerPhone).length > 0 &&
      phoneDigits(before.customerPhone) !== phoneDigits(after.customerPhone),
  };
}

/**
 * Whether the business's switch lets a write's messages go: on, and on
 * before the write happened (a car or payment from before it was switched
 * on is not announced).
 *
 * @param {object} business A businesses document.
 * @param {number} eventMs When the write happened (0: unknown).
 * @return {boolean} True to send.
 */
function switchAllows(business, eventMs) {
  if (!parkingWhatsAppEnabled(business)) return false;
  const since = parkingWhatsAppEnabledAtMs(business);
  const at = Math.round(Number(eventMs) || 0);
  return !(since > 0 && at > 0 && at < since);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const phoneDigits = (phone) => text(phone, 40).replace(/\D/g, "");

/**
 * @param {string} kind A KIND.
 * @param {object} args {carId, paymentId, businessId, phone, endDayKey}:
 *   what the row is about (`endDayKey` for a `left` message).
 * @return {string} The parkingMessages document id.
 */
function messageRowId(kind, {carId, paymentId, businessId, phone,
  endDayKey}) {
  if (kind === KIND.PARKED) return `${carId}_parked`;
  if (kind === KIND.LEFT) return `${carId}_left_${endDayKey}`;
  if (kind === KIND.RECEIPT) return `${carId}_pay_${paymentId}`;
  if (kind === KIND.BILL_RECEIPT) return `bill_${paymentId}`;
  return `welcome_${businessId}_${phoneDigits(phone)}`;
}

/**
 * @param {string} carId The parked car.
 * @param {number} epochMs When staff pressed Send on WhatsApp.
 * @return {string} The row of one manual send.
 */
function manualRowId(carId, epochMs) {
  return `${carId}_manual_${Math.round(Number(epochMs) || 0)}`;
}

/**
 * @param {string} carId The parked car.
 * @param {string} phone The new number, in any format.
 * @return {string} The row of the resend to a corrected number: one per
 *   new number.
 */
function phoneRowId(carId, phone) {
  return `${carId}_phone_${phoneDigits(phone)}`;
}

/**
 * The number to message for a car.
 *
 * @param {object} car A parkedCars document.
 * @param {object} business A businesses document (its country).
 * @return {{phone: string, error: string}} The number, or why there is none
 *   (`no_phone`, `needs_country_code`).
 */
function reachablePhone(car, business) {
  const raw = text(car?.customerPhone, 40);
  if (!raw) return {phone: "", error: "no_phone"};
  const phone = phoneWithBusinessCountry(raw, business?.country);
  if (!isInternationalPhone(phone)) {
    return {phone: "", error: "needs_country_code"};
  }
  return {phone, error: ""};
}

/**
 * What to resend when staff correct a car's phone number
 * (docs/PARKING_LEFT_WHATSAPP.md §3): the car's current message, to the new
 * number, once per number. Nothing when the number is only written another
 * way, when the new one cannot be reached, or when the car is one the lot
 * does not message.
 *
 * @param {{carId: string, before: ?object, after: object, business: object,
 *   now: Date}} args The write, and the business it belongs to.
 * @return {?{kind: string, phone: string, rowId: string,
 *   endDayKey: string}} `kind` is `left` for a car that has left, else
 *   `parked`; null for nothing to send.
 */
function phoneFixPlan({carId, before, after, business, now}) {
  if (!before || !after || !carIsMessageable(after)) return null;
  const next = reachablePhone(after, business);
  if (!next.phone) return null;
  const previous = reachablePhone(before, business);
  if (previous.phone &&
      phoneDigits(previous.phone) === phoneDigits(next.phone)) return null;
  const left = carHasLeft(after, now);
  return {
    kind: left ? KIND.LEFT : KIND.PARKED,
    phone: next.phone,
    rowId: phoneRowId(carId, next.phone),
    endDayKey: left ? dayKeyOf(endDayOf(after)) : "",
  };
}

/**
 * The day a moment falls on in a time zone.
 *
 * @param {number} ms Epoch milliseconds.
 * @param {string} zone IANA zone ("America/New_York").
 * @return {string} "YYYY-MM-DD" ("" for no moment).
 */
function localDayKey(ms, zone) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "";
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {timeZone: zone ||
      "America/New_York", year: "numeric", month: "2-digit",
    day: "2-digit"}).formatToParts(new Date(value));
  } catch (error) {
    return dayKeyOf(dayNumber(new Date(value)));
  }
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Whether a car has used up today's presses of "Send on WhatsApp".
 *
 * @param {Array<object>} rows The car's parkingMessages rows.
 * @param {number} nowMs The moment.
 * @param {string} zone The business's time zone.
 * @return {boolean} True at five manual sends in the business's day.
 */
function manualSendLimitReached(rows, nowMs, zone) {
  const today = localDayKey(nowMs, zone);
  const used = (Array.isArray(rows) ? rows : []).filter((row) =>
    row?.manual === true &&
    localDayKey(msOf(row.atMs) || msOf(row.createdAt), zone) === today);
  return used.length >= MANUAL_SENDS_PER_DAY;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * @param {number} cents Whole cents.
 * @return {string} "$1,234.50".
 */
function moneyEn(cents) {
  const n = Math.round(Number(cents) || 0);
  const whole = Math.trunc(Math.abs(n) / 100).toLocaleString("en-US");
  return `${n < 0 ? "-" : ""}$${whole}.${String(Math.abs(n) % 100)
      .padStart(2, "0")}`;
}

/**
 * @param {number} cents Whole cents.
 * @return {string} "1 234,50 $" (a plain space between thousands).
 */
function moneyFr(cents) {
  const n = Math.round(Number(cents) || 0);
  const whole = String(Math.trunc(Math.abs(n) / 100))
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n < 0 ? "-" : ""}${whole},${String(Math.abs(n) % 100)
      .padStart(2, "0")} $`;
}

/**
 * @param {number} cents The daily rate.
 * @return {string} "$12.00 a day".
 */
const rateEn = (cents) => `${moneyEn(cents)} a day`;

/**
 * @param {number} cents The daily rate.
 * @return {string} "12,00 $ par jour".
 */
const rateFr = (cents) => `${moneyFr(cents)} par jour`;

/**
 * @param {string} key "YYYY-MM-DD".
 * @param {"en"|"fr"} language The words.
 * @return {string} "October 29, 2026" / "29 octobre 2026"; "" for no day.
 */
function dayText(key, language) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(key, 10));
  if (!match) return "";
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return language === "fr" ?
    `${day === 1 ? "1er" : day} ${MONTHS_FR[month]} ${match[1]}` :
    `${MONTHS_EN[month]} ${day}, ${match[1]}`;
}

/**
 * A day the short way: "Nov 9, 2026" / "9 nov. 2026" (the car-left
 * message's date).
 *
 * @param {string} key "YYYY-MM-DD".
 * @param {"en"|"fr"} language The words.
 * @return {string} "" for no day.
 */
function dayTextShort(key, language) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(key, 10));
  if (!match) return "";
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return language === "fr" ?
    `${day === 1 ? "1er" : day} ${MONTHS_SHORT_FR[month]} ${match[1]}` :
    `${MONTHS_SHORT_EN[month]} ${day}, ${match[1]}`;
}

/**
 * @param {number} days How long the stay was.
 * @param {"en"|"fr"} language The words.
 * @return {string} "1 day" / "12 days", "1 jour" / "12 jours".
 */
function daysText(days, language) {
  const n = Math.max(0, Math.round(Number(days) || 0));
  if (language === "fr") return `${n} ${n === 1 ? "jour" : "jours"}`;
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * @param {object} car A parkedCars document.
 * @return {string} "2014 Toyota Corolla".
 */
function carLabel(car) {
  return [car?.carYear, car?.carMake, car?.carModel]
      .map((v) => text(v, 80)).filter(Boolean).join(" ");
}

/**
 * Several cars as one phrase that fits a template parameter: all of them up
 * to three, otherwise the first two and how many more.
 *
 * @param {string[]} labels The cars, as carLabel gives them.
 * @param {"en"|"fr"} language The words.
 * @return {string} "A, B and C" / "A, B and 3 more" / "A, B et 3 autres".
 */
function carsPhrase(labels, language) {
  const list = (Array.isArray(labels) ? labels : []).filter(Boolean);
  const fr = language === "fr";
  const and = fr ? "et" : "and";
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length <= 3) {
    return `${list.slice(0, -1).join(", ")} ${and} ${list[list.length - 1]}`;
  }
  const more = list.length - 2;
  return `${list[0]}, ${list[1]} ${and} ${more} ${fr ? "autres" : "more"}`;
}

/**
 * @param {object} balance parkingBalanceNow's answer.
 * @param {"en"|"fr"} language The words.
 * @return {string} "Balance owed: $45.00" / "Paid in full" and French.
 */
function balanceLine(balance, language) {
  const fr = language === "fr";
  if (balance?.paidInFull) return fr ? "Payé en totalité" : "Paid in full";
  const cents = balance?.balanceCents || 0;
  return fr ? `Solde à payer : ${moneyFr(cents)}` :
    `Balance owed: ${moneyEn(cents)}`;
}

// ---------------------------------------------------------------------------
// Template values
// ---------------------------------------------------------------------------

/**
 * @param {object} car A parkedCars document.
 * @param {object} business A businesses document.
 * @return {object} The values every parking template shares.
 */
function commonValues(car, business) {
  return {
    name: text(car?.customerName, 60) || text(car?.ownerName, 60),
    business: text(car?.businessName, 80) || text(business?.name, 80),
    businessPhone: text(business?.phone, 40),
    trackingCode: text(car?.trackingCode, 40),
  };
}

/**
 * The values of `parking_parked_2lang`.
 *
 * @param {object} car A parkedCars document.
 * @param {object} business A businesses document.
 * @param {Date} now The moment (for the balance's day).
 * @return {object} By VARIABLE name.
 */
function parkedValues(car, business, now) {
  const balance = parkingBalanceNow(car, now) || {};
  const since = balance.sinceDayKey ||
    dayKeyOf(dayNumber(car?.parkingDate) ?? dayNumber(now));
  return {
    ...commonValues(car, business),
    carEn: carLabel(car), carFr: carLabel(car),
    parkedOnEn: dayText(since, "en"), parkedOnFr: dayText(since, "fr"),
    rateEn: rateEn(balance.dailyRateCents || 0),
    rateFr: rateFr(balance.dailyRateCents || 0),
  };
}

/**
 * The values of `parking_receipt_2lang`.
 *
 * @param {object} car A parkedCars document.
 * @param {object} business A businesses document.
 * @param {{amountCents: number}} payment The payment.
 * @param {object} balance parkingBalanceNow's answer.
 * @return {object} By VARIABLE name (without the document header).
 */
function receiptValues(car, business, payment, balance) {
  return {
    ...commonValues(car, business),
    amountEn: moneyEn(payment.amountCents),
    amountFr: moneyFr(payment.amountCents),
    carEn: carLabel(car), carFr: carLabel(car),
    paidTotalEn: moneyEn(balance.paidCents),
    paidTotalFr: moneyFr(balance.paidCents),
    balanceEn: balanceLine(balance, "en"),
    balanceFr: balanceLine(balance, "fr"),
  };
}

/**
 * The values of `parking_receipt_2lang` for a month bill payment: the
 * amount, what it paid ("2014 Toyota Corolla, 2016 RAV4 and 2 more"), what
 * was paid toward the bill, and what the whole bill still owes.
 *
 * @param {object} payment The parkingBillPayments document.
 * @param {object} business A businesses document.
 * @return {object} By VARIABLE name (without the document header).
 */
function billReceiptValues(payment, business) {
  const parts = Array.isArray(payment?.parts) ? payment.parts : [];
  const left = Math.max(0, Math.round(Number(payment?.leftCents) || 0));
  const balance = {paidInFull: left === 0, balanceCents: left};
  const code = parts.map((p) => text(p?.trackingCode, 40)).find(Boolean) ||
    "";
  // "I paid everything" (docs/TEAM_SETTLE.md): the amount is the whole
  // settlement - the parking paid plus the cash handed over with it.
  const cash = Math.max(0, Math.round(Number(payment?.settleCashCents) || 0));
  const total = (Number(payment?.amountCents) || 0) + cash;
  return {
    name: text(payment?.customerName, 60),
    business: text(business?.name, 80),
    businessPhone: text(business?.phone, 40),
    trackingCode: code,
    amountEn: moneyEn(total),
    amountFr: moneyFr(total),
    carEn: billPaymentFor(parts, "en") +
      (cash > 0 ? " and cash held for the business" : ""),
    carFr: billPaymentFor(parts, "fr") +
      (cash > 0 ? " et espèces détenues pour l'entreprise" : ""),
    paidTotalEn: moneyEn(payment?.billPaidCents),
    paidTotalFr: moneyFr(payment?.billPaidCents),
    balanceEn: balanceLine(balance, "en"),
    balanceFr: balanceLine(balance, "fr"),
  };
}

/**
 * The last line of the car-left message: what is owed and how to pay, or
 * that it is paid.
 *
 * @param {object} balance parkingBalanceNow's answer.
 * @param {string} instructions The owner's "how to pay" text ("" for none).
 * @param {"en"|"fr"} language The words.
 * @return {string} "Balance due: $45.00. How to pay: ..." / "Paid in full.
 *   Thank you!" and French.
 */
function closingLine(balance, instructions, language) {
  const fr = language === "fr";
  const owed = Math.max(0, Math.round(Number(balance?.balanceCents) || 0));
  if (owed === 0) {
    return fr ? "Payé en totalité. Merci !" : "Paid in full. Thank you!";
  }
  const how = text(instructions, 300);
  return fr ?
    `Solde à payer : ${moneyFr(owed)}.${how ? ` Comment payer : ${how}` : ""}` :
    `Balance due: ${moneyEn(owed)}.${how ? ` How to pay: ${how}` : ""}`;
}

/**
 * The values of `parking_left_2lang` (docs/PARKING_LEFT_WHATSAPP.md §1).
 * The numbers are parkingBalanceNow's: days, what the stay ran up, what was
 * paid, what is owed.
 *
 * @param {object} car A parkedCars document.
 * @param {object} business A businesses document.
 * @param {Date} now The moment.
 * @return {object} By VARIABLE name (without the document header).
 */
function leftValues(car, business, now) {
  const balance = parkingBalanceNow(car, now) || {};
  const how = text(business?.paymentInstructions, 300);
  return {
    ...commonValues(car, business),
    carEn: carLabel(car), carFr: carLabel(car),
    leftOnEn: dayTextShort(balance.leftDayKey, "en"),
    leftOnFr: dayTextShort(balance.leftDayKey, "fr"),
    daysEn: daysText(balance.days, "en"),
    daysFr: daysText(balance.days, "fr"),
    totalEn: moneyEn(balance.accruedCents),
    totalFr: moneyFr(balance.accruedCents),
    paidTotalEn: moneyEn(balance.paidCents),
    paidTotalFr: moneyFr(balance.paidCents),
    closingEn: closingLine(balance, how, "en"),
    closingFr: closingLine(balance, how, "fr"),
  };
}

// ---------------------------------------------------------------------------
// The welcome to cars already parked
// ---------------------------------------------------------------------------

/**
 * Whether a car is on the lot today: arrived, not left, not voided or
 * cancelled.
 *
 * @param {object} car A parkedCars document.
 * @param {Date} now The moment.
 * @return {boolean} True for a car still parked.
 */
function carIsParkedNow(car, now) {
  if (!car || car.voided === true || text(car.status, 40) === "cancelled") {
    return false;
  }
  const balance = parkingBalanceNow(car, now);
  if (!balance || !balance.stillParked) return false;
  const start = dayNumber(car.parkingDate);
  return start !== null && start <= dayNumber(now);
}

/**
 * Everyone currently parked, grouped by phone number - one welcome each.
 *
 * @param {{cars: Array<object>, business: object, welcomed: Set<string>,
 *   now: Date}} args The business's parkedCars documents (each with its
 *   `id`), the business, the digits of every number already sent a
 *   `parked` or `welcome` message, and the moment.
 * @return {{recipients: Array<object>, skipped: Array<object>}}
 *   Recipients, `{phone, name, cars: [{id, label, trackingCode}],
 *   alreadyWelcomed, trackingCode}` (the track code is that of the most
 *   recently parked car); and the numbers that cannot be messaged with why.
 */
function welcomeRecipients({cars, business, welcomed, now}) {
  const groups = new Map();
  const skipped = new Map();
  for (const car of Array.isArray(cars) ? cars : []) {
    if (!carIsParkedNow(car, now)) continue;
    // Team members' own cars are not welcomed as customers.
    if (text(car.forStaffId, 128)) continue;
    const reach = reachablePhone(car, business);
    const entry = {id: text(car.id, 200), label: carLabel(car),
      trackingCode: text(car.trackingCode, 40),
      parkedMs: msOf(car.parkingDate), name: text(car.customerName, 120)};
    if (!reach.phone) {
      const key = reach.error === "no_phone" ? `none:${entry.id}` :
        `bad:${phoneDigits(car.customerPhone)}`;
      if (!skipped.has(key)) {
        skipped.set(key, {phone: text(car.customerPhone, 40), name: "",
          names: [], cars: [], reason: reach.error});
      }
      const group = skipped.get(key);
      group.names.push(entry.name);
      group.cars.push({id: entry.id, label: entry.label,
        trackingCode: entry.trackingCode});
      continue;
    }
    const key = phoneDigits(reach.phone);
    if (!groups.has(key)) groups.set(key, {phone: reach.phone, items: []});
    groups.get(key).items.push(entry);
  }
  const recipients = [];
  for (const [key, group] of groups) {
    const items = [...group.items].sort((a, b) =>
      b.parkedMs - a.parkedMs || a.label.localeCompare(b.label));
    recipients.push({
      phone: group.phone,
      name: mostUsedName(items.map((item) => item.name)),
      cars: items.map(({id, label, trackingCode}) =>
        ({id, label, trackingCode})),
      alreadyWelcomed: welcomed instanceof Set && welcomed.has(key),
      trackingCode: items[0].trackingCode,
    });
  }
  recipients.sort((a, b) => a.name.localeCompare(b.name) ||
    a.phone.localeCompare(b.phone));
  const skippedList = [...skipped.values()].map((group) => ({
    phone: group.phone,
    name: mostUsedName(group.names),
    cars: group.cars,
    reason: group.reason,
  }));
  return {recipients, skipped: skippedList};
}

/**
 * The values of `parking_welcome_2lang` for one recipient.
 *
 * @param {object} recipient One of welcomeRecipients' recipients.
 * @param {object} business A businesses document.
 * @return {object} By VARIABLE name.
 */
function welcomeValues(recipient, business) {
  const labels = recipient.cars.map((car) => car.label);
  return {
    name: recipient.name,
    business: text(business?.name, 80),
    businessPhone: text(business?.phone, 40),
    trackingCode: recipient.trackingCode,
    carsEn: carsPhrase(labels, "en"),
    carsFr: carsPhrase(labels, "fr"),
  };
}

module.exports = {
  billReceiptValues,
  KIND,
  STATUS,
  REFUSAL,
  REFUSAL_MESSAGE,
  MANUAL_SENDS_PER_DAY,
  WELCOME_MAX_PER_CALL,
  PARKING_TEMPLATE,
  balanceLine,
  carHasLeft,
  carIsMessageable,
  carIsParkedNow,
  carLabel,
  carsPhrase,
  closingLine,
  dayText,
  dayTextShort,
  daysText,
  endDayOf,
  isSettled,
  leftPlan,
  leftValues,
  livePayments,
  localDayKey,
  manualRowId,
  manualSendLimitReached,
  messageRowId,
  moneyEn,
  moneyFr,
  msOf,
  newPayments,
  parkedValues,
  parkingWhatsAppEnabled,
  parkingWhatsAppEnabledAtMs,
  paymentIdOf,
  phoneDigits,
  phoneFixPlan,
  phoneRowId,
  plannedMessages,
  rateEn,
  rateFr,
  reachablePhone,
  receiptValues,
  settledCents,
  switchAllows,
  welcomeRecipients,
  welcomeValues,
};

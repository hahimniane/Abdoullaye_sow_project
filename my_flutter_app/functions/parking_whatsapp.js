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

const KIND = Object.freeze({
  PARKED: "parked",
  RECEIPT: "receipt",
  WELCOME: "welcome",
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
});

const REFUSAL_MESSAGE = Object.freeze({
  [REFUSAL.OFF]: "Parking messages on WhatsApp are switched off for this " +
    "business. Turn them on first.",
  [REFUSAL.WELCOME_OWNER_ONLY]: "Only the business owner can send the " +
    "welcome message to current customers.",
  [REFUSAL.SWITCH_OWNER_ONLY]: "Only the business owner can switch parking " +
    "messages on WhatsApp on or off.",
});

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
  const due = Math.max(0, Math.round(
      Number(car?.amountDueCents ?? car?.totalCostCents) || 0));
  if (car?.parkingEndDate && due > 0) return due;
  return parkingBalanceNow({...car, parkingPayments: []}, now)
      ?.accruedCents || 0;
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
  const live = livePayments({businessId, carId, car: after});
  const fresh = live.filter((payment) => !known.has(payment.id));
  if (fresh.length > 0) return fresh;
  if (!isSettled(after) || isSettled(before)) return [];
  const added = settledCents(after, now) -
    Math.max(0, Math.round(Number(before.amountPaidCents) || 0));
  if (added <= 0) return [];
  const atMs = msOf(after.directPaymentReceivedAt) || msOf(after.paidAt) ||
    msOf(after.lastPaymentAt) || Math.round(Number(eventMs) || 0);
  const via = text(after.directPaymentMethod, 40).toLowerCase() ||
    (text(after.paymentMethod, 40) === "payment_link" ? "card_link" :
      "online");
  const synthetic = {amountCents: added, at: atMs};
  return [{
    id: paymentIdOf({businessId, carId, payment: synthetic}),
    amountCents: added,
    receivedVia: via,
    receivedByStaffId: text(after.receivedByStaffId, 180),
    atMs,
    number: live.length + 1,
    synthetic: true,
  }];
}

/**
 * What one parkedCars write calls for, before the business is read.
 *
 * @param {{businessId: string, carId: string, before: ?object,
 *   after: ?object, eventMs: number, now: Date}} args The write.
 * @return {{parked: boolean, receipts: Array<object>}} A `parked` message
 *   for a car just created; one receipt per payment just added.
 */
function plannedMessages({businessId, carId, before, after, eventMs, now}) {
  const none = {parked: false, receipts: []};
  if (!after || !carIsMessageable(after)) return none;
  if (!before) return {parked: true, receipts: []};
  return {parked: false, receipts: newPayments({
    businessId, carId, before, after, eventMs, now})};
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
 * @param {object} args {carId, paymentId, businessId, phone}: what the row
 *   is about.
 * @return {string} The parkingMessages document id.
 */
function messageRowId(kind, {carId, paymentId, businessId, phone}) {
  if (kind === KIND.PARKED) return `${carId}_parked`;
  if (kind === KIND.RECEIPT) return `${carId}_pay_${paymentId}`;
  return `welcome_${businessId}_${phoneDigits(phone)}`;
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
  KIND,
  STATUS,
  REFUSAL,
  REFUSAL_MESSAGE,
  WELCOME_MAX_PER_CALL,
  PARKING_TEMPLATE,
  balanceLine,
  carIsMessageable,
  carIsParkedNow,
  carLabel,
  carsPhrase,
  dayText,
  isSettled,
  livePayments,
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

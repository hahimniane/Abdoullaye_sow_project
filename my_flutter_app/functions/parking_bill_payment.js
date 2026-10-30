"use strict";

/**
 * Part of a month bill paid at once (docs/PARKING_BILL_PAYMENTS.md).
 *
 * Staff type ONE amount on a customer's Month end card. It pays the bill's
 * charges oldest first - money from before the month, then the month - each
 * part recorded on its car or activity exactly like a hand-recorded part
 * payment, all of them tied to one `parkingBillPayments` document so the
 * whole payment has one receipt and is undone as one. Never more than the
 * bill's recordable total: there is no parking credit balance.
 *
 * Pure: the server, the console (parking-bill-payment.ts) and the app
 * (parking_bill_payment.dart) give the same answers for
 * test/fixtures/parking-bill-payment-cases.json.
 */

const {itemsAfterCredit} = require("./staff_expense_credit");

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const cents = (value) => Math.max(0, Math.round(Number(value) || 0));

const BILL_PAYMENT_REFUSAL = Object.freeze({
  NO_AMOUNT: "bill_payment_no_amount",
  MORE_THAN_OWED: "bill_payment_more_than_owed",
  NOTHING_TO_PAY: "bill_payment_nothing_to_pay",
  CUSTOMER_NOT_FOUND: "bill_payment_customer_not_found",
  BILL_CHANGED: "bill_payment_bill_changed",
  RECEIVER_REQUIRED: "bill_payment_receiver_required",
  MONTH_INVALID: "bill_payment_month_invalid",
  NOT_FOUND: "bill_payment_not_found",
  ALREADY_UNDONE: "bill_payment_already_undone",
  SETTLED_SINCE: "bill_payment_settled_since",
  LEDGER_REQUIRED: "bill_payment_ledger_required",
});

const BILL_PAYMENT_MESSAGES = Object.freeze({
  [BILL_PAYMENT_REFUSAL.NO_AMOUNT]: "Enter the amount received.",
  [BILL_PAYMENT_REFUSAL.MORE_THAN_OWED]: "That is more than this bill " +
    "owes. Record what is owed and give the rest back.",
  [BILL_PAYMENT_REFUSAL.NOTHING_TO_PAY]: "Nothing on this bill can be " +
    "paid here.",
  [BILL_PAYMENT_REFUSAL.CUSTOMER_NOT_FOUND]: "This customer has no bill " +
    "for this month.",
  [BILL_PAYMENT_REFUSAL.BILL_CHANGED]: "The bill changed while you were " +
    "on it. Refresh and try again.",
  [BILL_PAYMENT_REFUSAL.RECEIVER_REQUIRED]: "Say who took the money so it " +
    "can be reconciled.",
  [BILL_PAYMENT_REFUSAL.MONTH_INVALID]: "Pick a month that has started.",
  [BILL_PAYMENT_REFUSAL.NOT_FOUND]: "This payment was not found.",
  [BILL_PAYMENT_REFUSAL.ALREADY_UNDONE]: "This payment was already undone.",
  [BILL_PAYMENT_REFUSAL.SETTLED_SINCE]: "A car or job in this payment was " +
    "marked paid in full afterwards. Undo that first.",
  [BILL_PAYMENT_REFUSAL.LEDGER_REQUIRED]: "This payment covers lot " +
    "activities: it needs the ledger permission.",
});

/**
 * The bill's charges that a payment recorded here can pay, oldest first:
 * first what is from before the month (cars that left earlier, the earlier
 * days of cars still on the bill, older activities), then the month's own
 * cars and activities - each group by date. Cars paid through Stripe are
 * not recordable here and are left out, as in Mark all paid. Linked staff's
 * expense credit covers the first items, as in Mark all paid.
 *
 * @param {object} customer A Month end customer (parkingMonthCustomers,
 *   after nettedCustomers when staff are linked).
 * @return {Array<object>} `{kind: "car"|"activity", id, label,
 *   trackingCode, dayKey, amountCents}`; a car may appear twice (its
 *   earlier days, then the month).
 */
function billPaymentItems(customer) {
  const c = customer || {};
  const before = [];
  const month = [];
  const car = (b, amountCents, dayKey, into) => {
    if (amountCents <= 0 || b.recordable !== true) return;
    into.push({kind: "car", id: text(b.id), label: text(b.vehicle) || "Car",
      trackingCode: text(b.trackingCode, 40), dayKey: text(dayKey, 10),
      amountCents});
  };
  for (const b of c.olderCars || []) {
    car(b, cents(b.dueCents), b.periodFrom, before);
  }
  for (const b of c.cars || []) {
    // A car on the bill owes its earlier days first, then the month's.
    const prior = Math.min(cents(b.priorUnpaidCents), cents(b.dueCents));
    car(b, prior, b.periodFrom, before);
    car(b, cents(b.dueCents) - prior, b.periodFrom, month);
  }
  const activity = (a, into) => {
    const amountCents = cents(a.dueCents);
    if (amountCents <= 0) return;
    into.push({kind: "activity", id: text(a.id),
      label: `${text(a.label) || "Activity"}` +
        `${text(a.vehicle) ? ` · ${text(a.vehicle)}` : ""}`,
      trackingCode: "", dayKey: text(a.date, 10), amountCents});
  };
  for (const a of c.olderActivities || []) activity(a, before);
  for (const a of c.activities || []) activity(a, month);
  const byDay = (a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ?
    1 : 0);
  // A stable sort keeps a car's earlier days ahead of its month.
  return itemsAfterCredit([...before.sort(byDay), ...month.sort(byDay)],
      cents(c.expenseCreditCents));
}

/**
 * What one amount pays on a customer's bill.
 *
 * @param {object} customer A Month end customer.
 * @param {number} amountCents The money received.
 * @return {{ok: boolean, reason: string, payableCents: number,
 *   parts: Array<object>, leftCents: number}} `parts` are the charges paid,
 *   in order, one per car or activity (a car's two items are one part):
 *   `{kind, id, label, trackingCode, amountCents, full}` - `full` when the
 *   part pays everything that charge owed. `leftCents` is what the whole
 *   bill still owes afterwards. Refused: `reason` set, `parts` empty.
 */
function billPaymentPlan(customer, amountCents) {
  const items = billPaymentItems(customer);
  const payableCents = items.reduce((s, x) => s + x.amountCents, 0);
  const dueCents = cents(customer?.dueCents);
  const amount = Math.round(Number(amountCents) || 0);
  const refuse = (reason) => ({ok: false, reason, payableCents, parts: [],
    leftCents: dueCents});
  if (payableCents <= 0) return refuse(BILL_PAYMENT_REFUSAL.NOTHING_TO_PAY);
  if (!(amount > 0)) return refuse(BILL_PAYMENT_REFUSAL.NO_AMOUNT);
  if (amount > payableCents) {
    return refuse(BILL_PAYMENT_REFUSAL.MORE_THAN_OWED);
  }
  const owed = new Map();
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    owed.set(key, (owed.get(key) || 0) + item.amountCents);
  }
  const parts = [];
  const index = new Map();
  let left = amount;
  for (const item of items) {
    if (left <= 0) break;
    const take = Math.min(left, item.amountCents);
    left -= take;
    const key = `${item.kind}:${item.id}`;
    if (index.has(key)) {
      parts[index.get(key)].amountCents += take;
    } else {
      index.set(key, parts.length);
      parts.push({kind: item.kind, id: item.id, label: item.label,
        trackingCode: item.trackingCode, amountCents: take});
    }
  }
  for (const part of parts) {
    part.full = part.amountCents >= owed.get(`${part.kind}:${part.id}`);
  }
  return {ok: true, reason: "", payableCents, parts,
    leftCents: Math.max(0, dueCents - amount)};
}

/**
 * "2014 Toyota Corolla, 2016 RAV4 and 2 more" - what a payment was for.
 *
 * @param {Array<object>} parts billPaymentPlan's parts.
 * @param {"en"|"fr"} language The words.
 * @return {string} At most two names, then a count.
 */
function billPaymentFor(parts, language = "en") {
  const names = [];
  for (const p of parts || []) {
    const name = text(p.label, 80);
    if (name && !names.includes(name)) names.push(name);
  }
  const fr = language === "fr";
  if (names.length === 0) return fr ? "stationnement" : "parking";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} ${fr ? "et" : "and"} ${names[1]}`;
  const more = names.length - 2;
  return `${names[0]}, ${names[1]} ${fr ? "et" : "and"} ${more} ` +
    `${fr ? (more === 1 ? "autre" : "autres") : "more"}`;
}

module.exports = {
  BILL_PAYMENT_MESSAGES,
  BILL_PAYMENT_REFUSAL,
  billPaymentFor,
  billPaymentItems,
  billPaymentPlan,
};

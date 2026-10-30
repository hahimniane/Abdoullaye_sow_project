"use strict";

/**
 * Monthly parking invoices on WhatsApp (docs/PARKING_INVOICES.md): the pure
 * rules.
 *
 * At the end of each month every parking customer of a business who owes
 * money (after staff expenses are netted off, docs/STAFF_EXPENSE_CREDIT.md)
 * or still has a car parked gets ONE invoice covering all their cars. This
 * module decides WHO gets one, what it is numbered, what the template says,
 * which month may be sent and when the automatic send is due, and names the
 * documents that make each invoice happen once. index.js does the reads, the
 * PDF, the sends and the writes; nothing here touches Firestore, Storage or
 * the network.
 */

const {
  dayKeyOf,
  dayNumber,
  monthLabel,
  parkingMonthCustomerPaid,
} = require("./parking_month_statement");
const {
  earlierExpenseCents,
  expenseLineLabels,
  monthExpenseLines,
  netStaffExpenses,
} = require("./staff_expense_credit");
const {
  moneyEn,
  moneyFr,
  msOf,
  phoneDigits,
  reachablePhone,
} = require("./parking_whatsapp");

const TIME_ZONE = "America/New_York";

// If nobody has sent a month's invoices by this day of the next month (New
// York), they go out by themselves.
const AUTO_SEND_DAY = 3;

// One call may message this many customers (sequential sends), and stops
// starting new ones after this long (the callable's limit is 300 s).
const INVOICES_MAX_PER_CALL = 300;
const INVOICES_CALL_BUDGET_MS = 240 * 1000;
// One hourly sweep spends at most this long on automatic sends; the rest is
// picked up by the next sweep.
const AUTO_SEND_BUDGET_MS = 120 * 1000;
// A run claimed as `sending` for longer than this is a send that died.
const SENDING_LEASE_MS = 10 * 60 * 1000;

const PAYMENT_INSTRUCTIONS_MAX = 300;

const RUN_STATUS = Object.freeze({
  READY: "ready",
  SENDING: "sending",
  SENT: "sent",
});

const REFUSAL = Object.freeze({
  OWNER_ONLY: "invoices_owner_only",
  MONTH_INVALID: "invoice_month_invalid",
  INSTRUCTIONS_INVALID: "payment_instructions_invalid",
  SENDING: "invoices_sending",
});

const REFUSAL_MESSAGE = Object.freeze({
  [REFUSAL.OWNER_ONLY]: "Only the business owner can set payment " +
    "instructions or review and send parking invoices.",
  [REFUSAL.MONTH_INVALID]: "Invoices can only be sent for the month that " +
    "just ended.",
  [REFUSAL.INSTRUCTIONS_INVALID]: "Payment instructions must be plain text " +
    `of at most ${PAYMENT_INSTRUCTIONS_MAX} characters.`,
  [REFUSAL.SENDING]: "These invoices are being sent right now. Check back " +
    "in a minute.",
});

const MONTHS_FR = Object.freeze([
  "janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre",
]);

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const cents = (value) => {
  const n = Math.round(Number(value) || 0);
  return n > 0 ? n : 0;
};

// ---------------------------------------------------------------------------
// Months and the calendar
// ---------------------------------------------------------------------------

/**
 * @param {Date} now The moment.
 * @return {{year: number, month: number, day: number}} The calendar day in
 *   New York (month 1-12).
 */
function newYorkDay(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now instanceof Date ? now : new Date(now));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return {year: get("year"), month: get("month"), day: get("day")};
}

/**
 * The month that just ended, the only one invoices may be sent for.
 *
 * @param {Date} now The moment.
 * @return {string} "YYYY-MM" of the month before the current New York month.
 */
function justEndedMonthKey(now) {
  const {year, month} = newYorkDay(now);
  const prev = new Date(Date.UTC(year, month - 2, 1));
  return prev.toISOString().slice(0, 7);
}

/**
 * @param {*} monthKey What the caller sent.
 * @param {Date} now The moment.
 * @return {boolean} True only for the month that just ended.
 */
function invoiceMonthAllowed(monthKey, now) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text(monthKey, 7)) &&
    text(monthKey, 7) === justEndedMonthKey(now);
}

/**
 * @param {Date} now The moment.
 * @return {boolean} Whether it is the 3rd (New York) or later in the month,
 *   when invoices nobody sent go out by themselves.
 */
function autoSendDue(now) {
  return newYorkDay(now).day >= AUTO_SEND_DAY;
}

/**
 * @param {string} monthKey "YYYY-MM".
 * @return {string} "October 2026".
 */
function monthTextEn(monthKey) {
  return monthLabel(monthKey);
}

/**
 * @param {string} monthKey "YYYY-MM".
 * @return {string} "octobre 2026".
 */
function monthTextFr(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(text(monthKey, 7));
  if (!match || !MONTHS_FR[Number(match[2]) - 1]) return text(monthKey, 7);
  return `${MONTHS_FR[Number(match[2]) - 1]} ${match[1]}`;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * @param {string} businessId The business.
 * @param {string} monthKey "YYYY-MM".
 * @return {string} The parkingInvoiceRuns document id.
 */
function runId(businessId, monthKey) {
  return `${businessId}_${monthKey}`;
}

/**
 * @param {string} businessId The business.
 * @param {string} monthKey "YYYY-MM".
 * @param {string} phone The customer's number.
 * @return {string} The parkingMessages document id: one per customer per
 *   month.
 */
function messageRowId(businessId, monthKey, phone) {
  return `invoice_${businessId}_${monthKey}_${phoneDigits(phone)}`;
}

/**
 * @param {string} businessId The business.
 * @param {string} monthKey "YYYY-MM".
 * @param {string} phone The customer's number.
 * @return {string} Where the invoice PDF is kept in Storage (server only).
 */
function storagePath(businessId, monthKey, phone) {
  return `parkingInvoices/${businessId}/${monthKey}/${phoneDigits(phone)}.pdf`;
}

/**
 * The owner's "how to pay" text.
 *
 * @param {*} value What was sent.
 * @return {{ok: boolean, text: string}} The cleaned text (empty clears it),
 *   or not ok when it is not a string of at most 300 characters.
 */
function cleanPaymentInstructions(value) {
  if (value === null || value === undefined) return {ok: true, text: ""};
  if (typeof value !== "string") return {ok: false, text: ""};
  const cleaned = value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  return cleaned.length <= PAYMENT_INSTRUCTIONS_MAX ?
    {ok: true, text: cleaned} : {ok: false, text: ""};
}

// ---------------------------------------------------------------------------
// Who gets an invoice
// ---------------------------------------------------------------------------

/**
 * The month's customers with their linked staff's lot expenses taken off
 * (the server twin of the console's `withStaffExpenseCredit`): each gains
 * `expenseLines`, `earlierExpenseCents`, and netStaffExpenses' fields. With
 * no credit the customers come back as they were.
 *
 * @param {object[]} customers parkingMonthSummary(...).customers.
 * @param {string} monthKey "YYYY-MM".
 * @param {?object} credit `{entries, repayments, links, staffNames, lines}`
 *   or null. `entries` carry `spentAt` (a Timestamp) or `spentAtMs`.
 * @return {object[]} The customers, most owed first.
 */
function nettedCustomers(customers, monthKey, credit) {
  const list = Array.isArray(customers) ? customers : [];
  if (!credit) return list;
  const names = credit.staffNames || {};
  const entries = (credit.entries || []).map((e) => ({
    ...e, spentAtMs: Number(e.spentAtMs) || msOf(e.spentAt)}));
  const net = netStaffExpenses(list, {
    entries,
    repayments: credit.repayments || [],
    links: credit.links || {},
    monthKey,
    staffNames: names,
  });
  const labels = expenseLineLabels(credit.lines || []);
  return net.customers.map((c) => {
    const expenseLines = monthExpenseLines(entries, monthKey,
        c.linkedStaffIds, labels).map((l) => {
      const day = l.spentAtMs > 0 ? dayNumber(new Date(l.spentAtMs)) : null;
      return {
        id: l.id,
        date: day === null ? "" : dayKeyOf(day),
        label: l.label,
        amountCents: l.amountCents,
        staffName: text(names[l.staffId], 120),
      };
    });
    return {
      ...c,
      expenseLines,
      earlierExpenseCents: earlierExpenseCents(c.expenseCreditCents,
          expenseLines),
      owes: c.dueCents > 0,
      paid: parkingMonthCustomerPaid(c),
    };
  }).sort((a, b) => b.dueCents - a.dueCents ||
    a.customerName.localeCompare(b.customerName));
}

/**
 * Invoice numbers for the month's customers: INV-{YYYYMM}-{last 4 digits of
 * the phone}-{n}. `n` tells apart customers whose numbers end in the same
 * four digits (1, 2, ... in phone order), so a number is unique in a
 * business's month and does not move when others pay.
 *
 * @param {object[]} customers The month's customers (all of them, not just
 *   those who get an invoice).
 * @param {string} monthKey "YYYY-MM".
 * @return {Map<string, string>} Customer key to invoice number; customers
 *   with no phone digits have none.
 */
function invoiceNumbers(customers, monthKey) {
  const groups = new Map();
  for (const c of Array.isArray(customers) ? customers : []) {
    const digits = text(c?.key).startsWith("phone:") ?
      text(c.key).slice(6) : "";
    if (!digits) continue;
    const last4 = digits.slice(-4);
    if (!groups.has(last4)) groups.set(last4, []);
    groups.get(last4).push(c.key);
  }
  const out = new Map();
  for (const [last4, keys] of groups) {
    [...new Set(keys)].sort().forEach((key, index) => {
      out.set(key, invoiceNumber(monthKey, last4, index + 1));
    });
  }
  return out;
}

/**
 * @param {string} monthKey "YYYY-MM".
 * @param {string} last4 The last four digits of the customer's phone.
 * @param {number} n Tells apart numbers that end the same (1-based).
 * @return {string} "INV-202610-1234-1".
 */
function invoiceNumber(monthKey, last4, n = 1) {
  const month = text(monthKey, 7).replace("-", "");
  const tail = text(last4, 20).replace(/\D/g, "").slice(-4).padStart(4, "0");
  return `INV-${month}-${tail}-${Math.max(1, Math.round(Number(n) || 1))}`;
}

/**
 * @param {object} customer A month-end customer.
 * @return {object[]} Its cars, the car to point the Track button at first:
 *   still parked, then latest arrival.
 */
function carsByRecency(customer) {
  return [...(customer?.cars || [])].sort((a, b) =>
    Number(b.stillParked === true) - Number(a.stillParked === true) ||
    text(b.periodFrom).localeCompare(text(a.periodFrom)) ||
    text(a.id).localeCompare(text(b.id)));
}

/**
 * Who gets an invoice for the month, from the month-end summary.
 *
 * A customer gets ONE invoice when they owe money after staff expenses
 * (`dueCents > 0`) or any of their cars is still parked at the end of the
 * month. A customer who left and paid up gets none. Voided and cancelled
 * cars are not in the summary, so they are never billed. Customers with no
 * number the WhatsApp can reach are listed apart, with why.
 *
 * @param {object} summary parkingMonthSummary(...).
 * @param {?object} staffCredit `{entries, repayments, links, staffNames,
 *   lines}` for the month, or null (nothing to net).
 * @param {Date} now The moment (the invoice's date).
 * @param {object} [options] `{business}` (its country reads local numbers),
 *   `sent` (a Set of phone digits already sent this month's invoice).
 * @return {{monthKey: string, issuedMs: number, recipients: object[],
 *   skipped: object[], totalDueCents: number}} Recipients: `{key, phone,
 *   phoneDigits, name, invoiceNumber, cars: [{id, label, vinNumber,
 *   trackingCode, stillParked}], totalDueCents, stillParked, trackingCode,
 *   alreadySent, customer}`; `customer` is the netted month-end customer the
 *   PDF is drawn from.
 */
function invoiceRecipients(summary, staffCredit, now = new Date(),
    options = {}) {
  const monthKey = text(summary?.monthKey, 7);
  const customers = nettedCustomers(summary?.customers, monthKey, staffCredit);
  const numbers = invoiceNumbers(customers, monthKey);
  const sent = options.sent instanceof Set ? options.sent : new Set();
  const recipients = [];
  const skipped = [];
  for (const c of customers) {
    const stillParked = (c.cars || []).some((b) => b.stillParked === true);
    const due = cents(c.dueCents);
    if (due <= 0 && !stillParked) continue;
    const ordered = carsByRecency(c);
    const named = ordered.map((b) => ({
      id: text(b.id, 200),
      label: text(b.vehicle, 120) || "Car",
      vinNumber: text(b.vinNumber, 17),
      trackingCode: text(b.trackingCode, 40),
      stillParked: b.stillParked === true,
    }));
    const trackingCode = named.find((b) => b.trackingCode)?.trackingCode ||
      text((c.olderCars || []).find((b) => text(b.trackingCode))
          ?.trackingCode, 40) ||
      text([...(c.activities || []), ...(c.olderActivities || [])]
          .find((a) => text(a.trackingCode))?.trackingCode, 40);
    const reach = reachablePhone({customerPhone: c.customerPhone},
        options.business);
    const base = {
      key: c.key,
      name: text(c.customerName, 120),
      cars: named,
      totalDueCents: due,
      stillParked,
    };
    if (!reach.phone) {
      skipped.push({...base, phone: text(c.customerPhone, 40),
        reason: reach.error});
      continue;
    }
    const digits = phoneDigits(reach.phone);
    recipients.push({
      ...base,
      phone: reach.phone,
      phoneDigits: digits,
      invoiceNumber: numbers.get(c.key) ||
        invoiceNumber(monthKey, digits, 1),
      trackingCode,
      alreadySent: sent.has(digits),
      customer: c,
    });
  }
  recipients.sort((a, b) => b.totalDueCents - a.totalDueCents ||
    a.name.localeCompare(b.name) || a.phoneDigits.localeCompare(b.phoneDigits));
  return {
    monthKey,
    issuedMs: (now instanceof Date ? now : new Date(now)).getTime(),
    recipients,
    skipped,
    totalDueCents: recipients.reduce((s, r) => s + r.totalDueCents, 0),
  };
}

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

/**
 * The values of `parking_invoice_2lang` for one recipient, by VARIABLE name
 * (the document header's link and file name are added by the sender).
 *
 * @param {object} recipient One of invoiceRecipients' recipients.
 * @param {object} business A businesses document.
 * @return {object} Values for parkingTemplateMessage.
 */
function invoiceMessageValues(recipient, business) {
  const monthKey = text(recipient?.customer?.monthKey, 7) ||
    monthKeyFromNumber(recipient?.invoiceNumber);
  const due = cents(recipient?.totalDueCents);
  return {
    name: text(recipient?.name, 60),
    business: text(business?.name, 80),
    businessPhone: text(business?.phone, 40),
    trackingCode: text(recipient?.trackingCode, 40),
    monthEn: monthTextEn(monthKey),
    monthFr: monthTextFr(monthKey),
    dueEn: moneyEn(due),
    dueFr: moneyFr(due),
    paymentInstructions: text(business?.paymentInstructions,
        PAYMENT_INSTRUCTIONS_MAX),
  };
}

/**
 * @param {string} number "INV-202610-1234-1".
 * @return {string} "2026-10" ("" when it is not an invoice number).
 */
function monthKeyFromNumber(number) {
  const match = /^INV-(\d{4})(\d{2})-/.exec(text(number, 40));
  return match ? `${match[1]}-${match[2]}` : "";
}

/**
 * The file name of the PDF the message carries.
 *
 * @param {string} invoiceNo The invoice number.
 * @return {string} "Invoice INV-202610-1234-1.pdf".
 */
function invoiceFilename(invoiceNo) {
  return `Invoice ${text(invoiceNo, 40)}.pdf`.replace(/["\\\r\n]/g, "");
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * The `parkingInvoiceRuns` document a month's invoices start as: `ready`,
 * waiting for the owner (or the 3rd).
 *
 * @param {{businessId: string, monthKey: string, recipients: number,
 *   totalDueCents: number, nowMs: number, documentToken: string}} args The
 *   month's numbers and the secret its PDF links are signed with.
 * @return {object} The run, without server timestamps.
 */
function newRun(args) {
  return {
    businessId: text(args.businessId, 180),
    monthKey: text(args.monthKey, 7),
    status: RUN_STATUS.READY,
    preparedAtMs: Math.round(Number(args.nowMs) || 0),
    sentAtMs: 0,
    sentBy: "",
    recipients: Math.max(0, Math.round(Number(args.recipients) || 0)),
    totalDueCents: cents(args.totalDueCents),
    sent: 0,
    failed: 0,
    skipped: 0,
    documentToken: text(args.documentToken, 80),
  };
}

/**
 * Whether a run may be claimed for sending now.
 *
 * @param {?object} run The stored run (null: none yet).
 * @param {number} nowMs The moment.
 * @return {boolean} False while another send holds a fresh claim.
 */
function runClaimable(run, nowMs) {
  if (!run || run.status !== RUN_STATUS.SENDING) return true;
  return nowMs - (Number(run.sendingAtMs) || 0) >= SENDING_LEASE_MS;
}

/**
 * What a month's message rows add up to.
 *
 * @param {object[]} rows The month's `invoice` parkingMessages rows.
 * @return {{sent: number, failed: number, stopped: number,
 *   queued: number}} Counts by status (stopped customers count as failed
 *   for the run's own `failed`, but are told apart here).
 */
function tallyRows(rows) {
  const tally = {sent: 0, failed: 0, stopped: 0, queued: 0};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.status === "sent") tally.sent += 1;
    else if (row?.status === "stopped") tally.stopped += 1;
    else if (row?.status === "failed") tally.failed += 1;
    else if (row?.status === "queued") tally.queued += 1;
  }
  return tally;
}

/**
 * The push text to the owner on the 1st: "{Month}'s invoices are ready: N
 * customers, $X. Review and send." Empty when nothing is to be sent.
 *
 * @param {string} monthKey "YYYY-MM".
 * @param {number} count Customers who get an invoice.
 * @param {number} dueCents What they owe in all.
 * @return {string} The sentence ("" for no invoices).
 */
function invoicesReadyText(monthKey, count, dueCents) {
  const n = Math.max(0, Math.round(Number(count) || 0));
  if (n === 0) return "";
  const month = monthTextEn(monthKey).split(" ")[0];
  return `${month}'s invoices are ready: ${n} customer${n === 1 ? "" : "s"}` +
    `, ${moneyEn(cents(dueCents))}. Review and send.`;
}

module.exports = {
  AUTO_SEND_BUDGET_MS,
  AUTO_SEND_DAY,
  INVOICES_CALL_BUDGET_MS,
  INVOICES_MAX_PER_CALL,
  PAYMENT_INSTRUCTIONS_MAX,
  REFUSAL,
  REFUSAL_MESSAGE,
  RUN_STATUS,
  SENDING_LEASE_MS,
  TIME_ZONE,
  autoSendDue,
  carsByRecency,
  cleanPaymentInstructions,
  invoiceFilename,
  invoiceMessageValues,
  invoiceMonthAllowed,
  invoiceNumber,
  invoiceNumbers,
  invoiceRecipients,
  invoicesReadyText,
  justEndedMonthKey,
  messageRowId,
  monthTextEn,
  monthTextFr,
  nettedCustomers,
  newRun,
  newYorkDay,
  runClaimable,
  runId,
  storagePath,
  tallyRows,
};

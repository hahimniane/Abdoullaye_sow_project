"use strict";

/**
 * Invoices and receipts a business writes by hand: what it sold to someone,
 * whether or not the thing exists anywhere else on the platform, and what
 * has been paid against it so far.
 *
 * One invoice is one open tab with a customer: lines go on it as they are
 * sold, payments come off it as they arrive, and the paper - sent as a PDF
 * from the console or the app - is whatever the tab reads at that moment.
 * It is an Invoice while money is owed and a Receipt once it is not.
 *
 * Pure: no Firestore, no clock unless one is passed in. Mirrored by
 * `admin_web/src/lib/invoice-ledger.ts` and `lib/services/invoice_ledger.dart`.
 */

const INVOICE_STATUS = Object.freeze({OPEN: "open", PAID: "paid"});
const INVOICE_STATUSES = Object.freeze(
    [INVOICE_STATUS.OPEN, INVOICE_STATUS.PAID]);

// How a hand-recorded payment arrived. Same vocabulary as a ledger
// activity's direct payment, so "received via" reads the same everywhere.
const INVOICE_PAYMENT_METHODS = Object.freeze([
  "cash", "zelle", "cashapp", "venmo", "check", "card_in_person", "other",
]);

const MAX_TEXT = 200;
const MAX_NOTES = 1000;
const MAX_VIN = 17;
const MAX_QUANTITY = 10000;
// A single line or payment above this is a typo, not a sale.
const MAX_CENTS = 100000000;

const INVOICE_MESSAGES = Object.freeze({
  title_required: "Give the invoice a short title (what it is for).",
  customer_name_required: "Say who the invoice is for.",
  issued_on_invalid: "The invoice date is not a real date.",
  due_on_invalid: "The due date is not a real date.",
  due_before_issued: "The due date is before the invoice date.",
  description_required: "Say what the line is.",
  quantity_required: "Enter how many (at least one).",
  unit_price_invalid: "Enter the price for one.",
  amount_too_large: "That amount is larger than an invoice can carry.",
  vin_invalid: "A VIN is 17 letters and digits.",
  amount_required: "Enter the amount received.",
  payment_method_invalid: "Say how the payment arrived.",
  paid_on_invalid: "The payment date is not a real date.",
  payment_exceeds_balance: "That is more than what is still owed.",
  invoice_not_found: "That invoice no longer exists.",
  line_not_found: "That line no longer exists.",
  payment_not_found: "That payment no longer exists.",
  payment_already_reverted: "That payment was already reverted.",
  invoice_has_lines: "Remove the lines and payments before deleting.",
});

const text = (value, max = MAX_TEXT) =>
  String(value ?? "").trim().slice(0, max);

const positiveInt = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const cents = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * "YYYY-MM-DD" or "" - dates on an invoice are calendar days the business
 * typed, with no clock or zone behind them.
 *
 * @param {*} value A day string, Date, or Timestamp.
 * @return {string} The day, or "" when unusable.
 */
function dayKey(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (!match) return "";
    const probe = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    if (Number.isNaN(probe.getTime())) return "";
    const day = probe.toISOString().slice(0, 10);
    return day === `${match[1]}-${match[2]}-${match[3]}` ? day : "";
  }
  const date = typeof value.toDate === "function" ? value.toDate() :
    new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

// -------------------------------------------------------------------------
// The invoice itself.
// -------------------------------------------------------------------------

/**
 * @param {object} input Raw callable data.
 * @return {string[]} Error codes, empty when the invoice may be saved.
 */
function validateInvoice(input) {
  const errors = [];
  if (!text(input?.title)) errors.push("title_required");
  if (!text(input?.customerName)) errors.push("customer_name_required");
  const issued = text(input?.issuedOn, 40);
  const issuedDay = dayKey(issued);
  if (issued && !issuedDay) errors.push("issued_on_invalid");
  const due = text(input?.dueOn, 40);
  const dueDay = dayKey(due);
  if (due && !dueDay) errors.push("due_on_invalid");
  if (issuedDay && dueDay && dueDay < issuedDay) {
    errors.push("due_before_issued");
  }
  return errors;
}

/**
 * @param {object} input Validated callable data.
 * @param {string} [today] "YYYY-MM-DD" for a missing invoice date.
 * @return {object} The fields the invoice stores from what was typed.
 */
function invoiceRecord(input, today = "") {
  return {
    title: text(input.title),
    customerName: text(input.customerName),
    customerPhone: text(input.customerPhone, 40),
    customerEmail: text(input.customerEmail, 180),
    issuedOn: dayKey(input.issuedOn) || dayKey(today),
    dueOn: dayKey(input.dueOn),
    notes: text(input.notes, MAX_NOTES),
  };
}

// -------------------------------------------------------------------------
// Lines.
// -------------------------------------------------------------------------

/**
 * @param {object} input Raw callable data.
 * @return {string[]} Error codes.
 */
function validateInvoiceLine(input) {
  const errors = [];
  if (!text(input?.description)) errors.push("description_required");
  const quantity = positiveInt(input?.quantity);
  if (quantity <= 0) errors.push("quantity_required");
  const unit = cents(input?.unitPriceCents);
  if (!Number.isFinite(unit) || unit < 0) errors.push("unit_price_invalid");
  if (Number.isFinite(unit) && unit >= 0 &&
      Math.min(quantity, MAX_QUANTITY) * unit > MAX_CENTS) {
    errors.push("amount_too_large");
  }
  const vin = text(input?.vinNumber, 40).toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  if (vin && vin.length !== MAX_VIN) errors.push("vin_invalid");
  return errors;
}

/**
 * @param {object} input Validated callable data.
 * @return {object} The line body: amount is worked out here, never typed.
 */
function invoiceLineRecord(input) {
  const quantity = Math.min(MAX_QUANTITY, positiveInt(input.quantity));
  const unitPriceCents = Math.max(0, cents(input.unitPriceCents) || 0);
  return {
    description: text(input.description),
    quantity,
    unitPriceCents,
    amountCents: quantity * unitPriceCents,
    vinNumber: text(input.vinNumber, 40).toUpperCase()
        .replace(/[^A-Z0-9]/g, "").slice(0, MAX_VIN),
  };
}

// -------------------------------------------------------------------------
// Payments.
// -------------------------------------------------------------------------

/**
 * @param {object} input Raw callable data.
 * @param {number} balanceCents What the invoice still carries.
 * @return {string[]} Error codes.
 */
function validateInvoicePayment(input, balanceCents) {
  const errors = [];
  const amount = cents(input?.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) errors.push("amount_required");
  else if (amount > MAX_CENTS) errors.push("amount_too_large");
  // Paying more than is owed is a typo nine times in ten; the tenth time
  // the business adds the line first, then records the money.
  else if (amount > Math.max(0, Number(balanceCents) || 0)) {
    errors.push("payment_exceeds_balance");
  }
  if (!INVOICE_PAYMENT_METHODS.includes(text(input?.method, 40))) {
    errors.push("payment_method_invalid");
  }
  const paidOn = text(input?.paidOn, 40);
  if (paidOn && !dayKey(paidOn)) errors.push("paid_on_invalid");
  return errors;
}

/**
 * @param {object} input Validated callable data.
 * @param {string} [today] "YYYY-MM-DD" for a missing payment date.
 * @return {object} The payment body.
 */
function invoicePaymentRecord(input, today = "") {
  return {
    amountCents: cents(input.amountCents),
    method: text(input.method, 40),
    paidOn: dayKey(input.paidOn) || dayKey(today),
    note: text(input.note),
    reverted: false,
  };
}

// -------------------------------------------------------------------------
// What the invoice adds up to.
// -------------------------------------------------------------------------

/**
 * @param {object[]} lines The invoice's lines.
 * @param {object[]} payments Its payments, reverted ones included.
 * @return {object} Totals and the status they imply.
 */
function invoiceTotals(lines, payments) {
  const rows = Array.isArray(lines) ? lines : [];
  const paid = (Array.isArray(payments) ? payments : [])
      .filter((p) => p && p.reverted !== true);
  const totalCents = rows.reduce(
      (sum, l) => sum + Math.max(0, cents(l?.amountCents) || 0), 0);
  const paidCents = paid.reduce(
      (sum, p) => sum + Math.max(0, cents(p?.amountCents) || 0), 0);
  const balanceCents = Math.max(0, totalCents - paidCents);
  return {
    totalCents,
    paidCents,
    balanceCents,
    lineCount: rows.length,
    paymentCount: paid.length,
    // An empty invoice is still open: nothing is owed, but nothing is
    // settled either, and "paid" on a blank page is a lie.
    status: rows.length > 0 && balanceCents === 0 ?
      INVOICE_STATUS.PAID : INVOICE_STATUS.OPEN,
  };
}

/**
 * Overdue is a fact about an open invoice with a due day behind today.
 *
 * @param {object} invoice The stored invoice.
 * @param {string} today "YYYY-MM-DD".
 * @return {boolean} Whether it is overdue.
 */
function invoiceIsOverdue(invoice, today) {
  const due = dayKey(invoice?.dueOn);
  const open = String(invoice?.status || INVOICE_STATUS.OPEN) ===
    INVOICE_STATUS.OPEN;
  return open && Boolean(due) && Boolean(dayKey(today)) && due < dayKey(today);
}

/**
 * "INV-0007": the number the business and the customer both quote. Counted
 * per business, never reused, so a deleted invoice leaves a gap rather than
 * a second INV-0007.
 *
 * @param {number} counter The count after this invoice.
 * @return {string} The number.
 */
function invoiceNumber(counter) {
  return `INV-${String(Math.max(1, positiveInt(counter))).padStart(4, "0")}`;
}

/**
 * The document kind as the paper and the list say it.
 *
 * @param {object} invoice The stored invoice.
 * @return {string} "Receipt" once settled, else "Invoice".
 */
function invoiceKind(invoice) {
  return String(invoice?.status || "") === INVOICE_STATUS.PAID ?
    "Receipt" : "Invoice";
}

function moneyText(centsValue) {
  const n = Math.round(Number(centsValue) || 0);
  const whole = Math.trunc(Math.abs(n) / 100);
  const part = String(Math.abs(n) % 100).padStart(2, "0");
  return `${n < 0 ? "-" : ""}$${whole.toLocaleString("en-US")}.${part}`;
}

/**
 * The message pasted into WhatsApp beside the PDF: what it reads without
 * opening anything.
 *
 * @param {{invoice: object, lines: object[], payments: object[],
 *   businessName: string}} input The invoice and its rows.
 * @return {string} Plain text.
 */
function invoiceTextSummary({invoice, lines, payments, businessName}) {
  const inv = invoice || {};
  const totals = invoiceTotals(lines, payments);
  const out = [
    `${text(businessName) || "Invoice"} — ` +
      `${invoiceKind({...inv, status: totals.status})}` +
      `${text(inv.number, 20) ? ` ${text(inv.number, 20)}` : ""}`,
    `${text(inv.title)}${inv.issuedOn ? ` · ${dayKey(inv.issuedOn)}` : ""}`,
    `For: ${text(inv.customerName) || "—"}`,
    "",
  ];
  for (const l of Array.isArray(lines) ? lines : []) {
    const q = positiveInt(l?.quantity) || 1;
    const each = q > 1 ? ` (${q} × ${moneyText(l?.unitPriceCents)})` : "";
    out.push(`${text(l?.description)}${each} — ${moneyText(l?.amountCents)}` +
      (text(l?.vinNumber, 17) ? `\nVIN ${text(l?.vinNumber, 17)}` : ""));
  }
  out.push("", `Total: ${moneyText(totals.totalCents)}`);
  if (totals.paidCents > 0) out.push(`Paid: -${moneyText(totals.paidCents)}`);
  out.push(totals.balanceCents > 0 ?
    `BALANCE DUE: ${moneyText(totals.balanceCents)}` +
      (dayKey(inv.dueOn) ? ` (due ${dayKey(inv.dueOn)})` : "") :
    "PAID IN FULL");
  return out.join("\n");
}

module.exports = {
  INVOICE_STATUS,
  INVOICE_STATUSES,
  INVOICE_PAYMENT_METHODS,
  INVOICE_MESSAGES,
  MAX_CENTS,
  dayKey,
  validateInvoice,
  invoiceRecord,
  validateInvoiceLine,
  invoiceLineRecord,
  validateInvoicePayment,
  invoicePaymentRecord,
  invoiceTotals,
  invoiceIsOverdue,
  invoiceNumber,
  invoiceKind,
  moneyText,
  invoiceTextSummary,
};

/**
 * Invoices and receipts a business writes by hand. Mirrors
 * `my_flutter_app/functions/invoice_ledger.js`: the same checks the server
 * runs, so the form refuses what the callable would refuse, and the same
 * totals, so the page never shows a number the server would not.
 */

export type InvoiceStatus = "open" | "paid";

export const INVOICE_PAYMENT_METHODS = [
  "cash", "zelle", "cashapp", "venmo", "check", "card_in_person", "other",
] as const;
export type InvoicePaymentMethod = (typeof INVOICE_PAYMENT_METHODS)[number];

export const INVOICE_PAYMENT_METHOD_LABELS: Record<InvoicePaymentMethod, string> = {
  cash: "Cash",
  zelle: "Zelle",
  cashapp: "Cash App",
  venmo: "Venmo",
  check: "Check",
  card_in_person: "Card in person",
  other: "Other",
};

const MAX_TEXT = 200;
const MAX_NOTES = 1000;
const MAX_VIN = 17;
const MAX_QUANTITY = 10000;
export const MAX_INVOICE_CENTS = 100000000;

export const INVOICE_MESSAGES = {
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
} as const;
export type InvoiceError = keyof typeof INVOICE_MESSAGES;

type Row = Record<string, unknown>;
const asRow = (value: unknown): Row =>
  value && typeof value === "object" ? (value as Row) : {};
const text = (value: unknown, max = MAX_TEXT) =>
  String(value ?? "").trim().slice(0, max);
const positiveInt = (value: unknown) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const cents = (value: unknown) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : NaN;
};

/** "YYYY-MM-DD" or "" — invoice dates are calendar days with no clock. */
export function invoiceDayKey(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (!match) return "";
    const probe = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    if (Number.isNaN(probe.getTime())) return "";
    const day = probe.toISOString().slice(0, 10);
    return day === `${match[1]}-${match[2]}-${match[3]}` ? day : "";
  }
  const withToDate = value as { toDate?: () => Date };
  const date = typeof withToDate.toDate === "function"
    ? withToDate.toDate()
    : new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function todayKey(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

export function invoiceMessage(codes: readonly string[]): string {
  return codes.map((c) => (c in INVOICE_MESSAGES ? INVOICE_MESSAGES[c as InvoiceError] : c)).join(" ");
}

// ---------------------------------------------------------------------------
// The invoice.
// ---------------------------------------------------------------------------

export type InvoiceDraft = {
  title: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  issuedOn: string;
  dueOn: string;
  notes: string;
};

export const emptyInvoiceDraft: InvoiceDraft = {
  title: "",
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  issuedOn: "",
  dueOn: "",
  notes: "",
};

export function invoiceDraftFromRow(row: Row): InvoiceDraft {
  return {
    title: text(row.title),
    customerName: text(row.customerName),
    customerPhone: text(row.customerPhone, 40),
    customerEmail: text(row.customerEmail, 180),
    issuedOn: invoiceDayKey(row.issuedOn),
    dueOn: invoiceDayKey(row.dueOn),
    notes: text(row.notes, MAX_NOTES),
  };
}

/** Same checks as the server's `validateInvoice`. */
export function validateInvoiceDraft(draft: InvoiceDraft): InvoiceError[] {
  const errors: InvoiceError[] = [];
  if (!text(draft.title)) errors.push("title_required");
  if (!text(draft.customerName)) errors.push("customer_name_required");
  const issued = text(draft.issuedOn, 40);
  const issuedDay = invoiceDayKey(issued);
  if (issued && !issuedDay) errors.push("issued_on_invalid");
  const due = text(draft.dueOn, 40);
  const dueDay = invoiceDayKey(due);
  if (due && !dueDay) errors.push("due_on_invalid");
  if (issuedDay && dueDay && dueDay < issuedDay) errors.push("due_before_issued");
  return errors;
}

export function invoicePayload(draft: InvoiceDraft) {
  return {
    title: text(draft.title),
    customerName: text(draft.customerName),
    customerPhone: text(draft.customerPhone, 40),
    customerEmail: text(draft.customerEmail, 180),
    issuedOn: invoiceDayKey(draft.issuedOn),
    dueOn: invoiceDayKey(draft.dueOn),
    notes: text(draft.notes, MAX_NOTES),
  };
}

// ---------------------------------------------------------------------------
// Lines.
// ---------------------------------------------------------------------------

export type InvoiceLineDraft = {
  description: string;
  /** As typed; defaults to one. */
  quantity: string;
  /** In dollars as typed; sent in cents. */
  unitPrice: string;
  vinNumber: string;
};

export const emptyInvoiceLineDraft: InvoiceLineDraft = {
  description: "",
  quantity: "1",
  unitPrice: "",
  vinNumber: "",
};

export function invoiceLineDraftFromRow(row: Row): InvoiceLineDraft {
  return {
    description: text(row.description),
    quantity: String(positiveInt(row.quantity) || 1),
    unitPrice: centsToInput(row.unitPriceCents),
    vinNumber: text(row.vinNumber, 40),
  };
}

export function dollarsToCents(value: string): number {
  const cleaned = String(value ?? "").replace(/[$,\s]/g, "");
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function centsToInput(value: unknown): string {
  const n = cents(value);
  if (!Number.isFinite(n)) return "";
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
}

/** Same checks as the server's `validateInvoiceLine`. */
export function validateInvoiceLineDraft(draft: InvoiceLineDraft): InvoiceError[] {
  const errors: InvoiceError[] = [];
  if (!text(draft.description)) errors.push("description_required");
  const quantity = positiveInt(draft.quantity);
  if (quantity <= 0) errors.push("quantity_required");
  const unit = dollarsToCents(draft.unitPrice);
  if (!Number.isFinite(unit) || unit < 0) errors.push("unit_price_invalid");
  if (Number.isFinite(unit) && unit >= 0 && Math.min(quantity, MAX_QUANTITY) * unit > MAX_INVOICE_CENTS) {
    errors.push("amount_too_large");
  }
  const vin = text(draft.vinNumber, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (vin && vin.length !== MAX_VIN) errors.push("vin_invalid");
  return errors;
}

export function invoiceLinePayload(draft: InvoiceLineDraft) {
  return {
    description: text(draft.description),
    quantity: Math.min(MAX_QUANTITY, positiveInt(draft.quantity) || 1),
    unitPriceCents: Math.max(0, dollarsToCents(draft.unitPrice) || 0),
    vinNumber: text(draft.vinNumber, 40).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX_VIN),
  };
}

// ---------------------------------------------------------------------------
// Payments.
// ---------------------------------------------------------------------------

export type InvoicePaymentDraft = {
  amount: string;
  method: InvoicePaymentMethod;
  paidOn: string;
  note: string;
  /** One of the invoice's line ids, or "" for the invoice as a whole. */
  forLineId: string;
};

export const emptyInvoicePaymentDraft: InvoicePaymentDraft = {
  amount: "",
  method: "cash",
  paidOn: "",
  note: "",
  forLineId: "",
};

/** Same checks as the server's `validateInvoicePayment`. */
export function validateInvoicePaymentDraft(draft: InvoicePaymentDraft, balanceCents: number): InvoiceError[] {
  const errors: InvoiceError[] = [];
  const amount = dollarsToCents(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push("amount_required");
  else if (amount > MAX_INVOICE_CENTS) errors.push("amount_too_large");
  else if (amount > Math.max(0, Number(balanceCents) || 0)) errors.push("payment_exceeds_balance");
  if (!(INVOICE_PAYMENT_METHODS as readonly string[]).includes(text(draft.method, 40))) {
    errors.push("payment_method_invalid");
  }
  const paidOn = text(draft.paidOn, 40);
  if (paidOn && !invoiceDayKey(paidOn)) errors.push("paid_on_invalid");
  return errors;
}

export function invoicePaymentPayload(draft: InvoicePaymentDraft) {
  return {
    amountCents: dollarsToCents(draft.amount),
    method: text(draft.method, 40),
    paidOn: invoiceDayKey(draft.paidOn),
    note: text(draft.note),
    forLineId: text(draft.forLineId, 200),
  };
}

/** How a payment reads in a list or on the paper. Mirrors the server's. */
export function invoicePaymentLabel(payment: Row, methodLabel: (m: string) => string = (m) => m): string {
  return [
    invoiceDayKey(payment.paidOn),
    text(payment.method, 40) ? methodLabel(text(payment.method, 40)) : "",
    text(payment.forDescription) ? `for ${text(payment.forDescription)}` : "",
    text(payment.note),
  ].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// What it adds up to.
// ---------------------------------------------------------------------------

export type InvoiceTotals = {
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  lineCount: number;
  paymentCount: number;
  status: InvoiceStatus;
};

export function invoiceTotals(lines: readonly Row[], payments: readonly Row[]): InvoiceTotals {
  const paid = payments.filter((p) => p.reverted !== true);
  const totalCents = lines.reduce((sum, l) => sum + Math.max(0, cents(l.amountCents) || 0), 0);
  const paidCents = paid.reduce((sum, p) => sum + Math.max(0, cents(p.amountCents) || 0), 0);
  const balanceCents = Math.max(0, totalCents - paidCents);
  return {
    totalCents,
    paidCents,
    balanceCents,
    lineCount: lines.length,
    paymentCount: paid.length,
    status: lines.length > 0 && balanceCents === 0 ? "paid" : "open",
  };
}

export function invoiceStatus(row: Row): InvoiceStatus {
  return text(row.status, 20) === "paid" ? "paid" : "open";
}

export function invoiceIsOverdue(row: Row, today = todayKey()): boolean {
  const due = invoiceDayKey(row.dueOn);
  return invoiceStatus(row) === "open" && Boolean(due) && due < today;
}

/** "Receipt" once settled, else "Invoice". */
export function invoiceKind(row: Row): "Invoice" | "Receipt" {
  return invoiceStatus(row) === "paid" ? "Receipt" : "Invoice";
}

export function invoiceTitle(row: Row): string {
  const number = text(row.number, 20);
  const title = text(row.title);
  return [number, title].filter(Boolean).join(" · ") || "Invoice";
}

export function moneyText(value: unknown): string {
  const n = Math.round(Number(value) || 0);
  const whole = Math.trunc(Math.abs(n) / 100);
  const part = String(Math.abs(n) % 100).padStart(2, "0");
  return `${n < 0 ? "-" : ""}$${whole.toLocaleString("en-US")}.${part}`;
}

export type InvoiceFilter = "" | "open" | "paid" | "overdue";

export function filterInvoices(rows: readonly Row[], filter: InvoiceFilter, search: string, today = todayKey()): Row[] {
  const q = text(search, 120).toLowerCase();
  return rows.filter((row) => {
    if (filter === "open" && invoiceStatus(row) !== "open") return false;
    if (filter === "paid" && invoiceStatus(row) !== "paid") return false;
    if (filter === "overdue" && !invoiceIsOverdue(row, today)) return false;
    if (!q) return true;
    const hay = [row.number, row.title, row.customerName, row.customerPhone]
      .map((v) => text(v).toLowerCase()).join(" ");
    return hay.includes(q);
  });
}

/** Newest invoice date first, then by number, so today's work is on top. */
export function sortInvoices(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const byDay = invoiceDayKey(b.issuedOn).localeCompare(invoiceDayKey(a.issuedOn));
    if (byDay !== 0) return byDay;
    return text(b.number, 20).localeCompare(text(a.number, 20));
  });
}

/** The message pasted into WhatsApp beside the PDF. Mirrors the server's. */
export function invoiceTextSummary(input: {
  invoice: Row;
  lines: readonly Row[];
  payments: readonly Row[];
  businessName: string;
}): string {
  const inv = input.invoice;
  const totals = invoiceTotals(input.lines, input.payments);
  const number = text(inv.number, 20);
  const out = [
    `${text(input.businessName) || "Invoice"} — ${totals.status === "paid" ? "Receipt" : "Invoice"}${number ? ` ${number}` : ""}`,
    `${text(inv.title)}${invoiceDayKey(inv.issuedOn) ? ` · ${invoiceDayKey(inv.issuedOn)}` : ""}`,
    `For: ${text(inv.customerName) || "—"}`,
    "",
  ];
  for (const l of input.lines) {
    const q = positiveInt(l.quantity) || 1;
    const each = q > 1 ? ` (${q} × ${moneyText(l.unitPriceCents)})` : "";
    const vin = text(l.vinNumber, 17);
    out.push(`${text(l.description)}${each} — ${moneyText(l.amountCents)}${vin ? `\nVIN ${vin}` : ""}`);
  }
  out.push("", `Total: ${moneyText(totals.totalCents)}`);
  if (totals.paidCents > 0) {
    out.push(`Paid: -${moneyText(totals.paidCents)}`);
    for (const p of input.payments.filter((x) => x.reverted !== true)) {
      out.push(`  ${invoicePaymentLabel(p)} — ${moneyText(p.amountCents)}`);
    }
  }
  const due = invoiceDayKey(inv.dueOn);
  out.push(totals.balanceCents > 0
    ? `BALANCE DUE: ${moneyText(totals.balanceCents)}${due ? ` (due ${due})` : ""}`
    : "PAID IN FULL");
  return out.join("\n");
}

export function invoiceCallableFailure(error: unknown): string {
  const e = asRow(error);
  return text(e.message, 500) || "The change did not save.";
}

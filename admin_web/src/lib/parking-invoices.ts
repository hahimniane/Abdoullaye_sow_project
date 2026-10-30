/**
 * Monthly parking invoices on WhatsApp (docs/PARKING_INVOICES.md §3): the
 * pure side of the console - the payment instructions a business prints on
 * its invoices, the month-end "Send invoices" preview and its selection, the
 * server's refusals in words, and how a customer's invoice message reads.
 *
 * Pure: no React, no Firebase. `parking-invoices.test.ts` runs it under node.
 */

import { parkingMessageLine, parkingWhatsAppRefusalText, type Lang, type ParkingMessageLine } from "./parking-whatsapp.ts";
import { moneyText, parkingCustomerKey, shiftMonthKey } from "./parking-month-statement.ts";

type Row = Record<string, unknown>;

const text = (value: unknown, max = 300) => String(value ?? "").trim().slice(0, max);
const asRow = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const count = (n: unknown) => {
  const x = Math.trunc(Number(n));
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/** The preview reads the whole month's statement on the server: a little longer than a switch. */
export const PARKING_INVOICES_PREVIEW_TIMEOUT_MS = 60_000;
/** The send is sequential on the server (cap 300, stops at 240 s): the call waits a bit longer than that. */
export const PARKING_INVOICES_SEND_TIMEOUT_MS = 300_000;
/** How long the invoice messages of a month may load before the cards say nothing (loading always resolves). */
export const PARKING_INVOICE_MESSAGES_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Payment instructions: businesses/{id}.paymentInstructions (up to 300 characters)
// ---------------------------------------------------------------------------

export const PAYMENT_INSTRUCTIONS_MAX = 300;

/** What the business saved, as plain text (never more than the limit). */
export function paymentInstructionsOf(business: unknown): string {
  return String(asRow(business).paymentInstructions ?? "").trim().slice(0, PAYMENT_INSTRUCTIONS_MAX);
}

/** The request that saves the instructions. The server trims again and refuses over the limit. */
export function setPaymentInstructionsRequest(businessId: string, value: string) {
  return { businessId, action: "set_payment_instructions", text: String(value ?? "").trim() };
}

/** Whether a draft can be saved: it differs from what is saved and is within the limit. */
export function paymentInstructionsCanSave(draft: string, saved: string): boolean {
  const next = String(draft ?? "").trim();
  return next !== String(saved ?? "").trim() && next.length <= PAYMENT_INSTRUCTIONS_MAX;
}

// ---------------------------------------------------------------------------
// Which month may be invoiced: the month that just ended, New York time
// ---------------------------------------------------------------------------

/** "2026-11" for an instant, read on the New York calendar (the server's clock for the 1st and the 3rd). */
export function newYorkMonthKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

/** The month whose invoices may be sent now: the one before the current month in New York. */
export function invoiceMonthKey(now: Date = new Date()): string {
  return shiftMonthKey(newYorkMonthKey(now), -1);
}

/** The panel is offered only for the month just ended. */
export function invoicesOfferedFor(monthKey: string, now: Date = new Date()): boolean {
  return /^\d{4}-\d{2}$/.test(monthKey) && monthKey === invoiceMonthKey(now);
}

// ---------------------------------------------------------------------------
// Copy and refusals
// ---------------------------------------------------------------------------

export const PARKING_INVOICES_COPY = {
  paymentTitle: "Payment instructions",
  paymentHint: "Shown on monthly invoices, e.g. Pay at the office, or Zelle 347-555-0100 (Your business name).",
  paymentSave: "Save instructions",
  invoicesTitle: "Send invoices",
  invoicesLede:
    "Each customer gets one WhatsApp invoice with a PDF that covers all of their cars. " +
    "Look through the list, then send. If nobody has sent them by the 3rd, they go out automatically.",
  loading: "Loading invoices…",
  empty: "No customer needs an invoice for this month.",
  runNone: "Not prepared yet. The list shows who would get an invoice.",
  runSending: "Sending is in progress. Refresh in a minute to see the result.",
  alreadySent: "Already sent",
  stillParked: "Still parked",
  refresh: "Refresh",
  selectAll: "Select all",
  selectNone: "Select none",
  confirmText: "Send these invoices now? Customers get them on WhatsApp right away and this cannot be undone.",
  confirmYes: "Yes, send",
  cancel: "Cancel",
  remainingHint: "The send stopped to stay within its time limit. Send again to finish the rest.",
  invoiceMessage: "Monthly invoice",
  retry: "Retry",
  done: "Done",
} as const;

/** The server's refusals for this feature (HttpsError `details.reason`), in words. */
export const PARKING_INVOICES_REFUSALS: Record<string, string> = {
  invoices_owner_only: "Only the business owner can send invoices.",
  invoice_month_invalid: "Invoices can only be sent for the month that just ended.",
  payment_instructions_invalid: "Payment instructions can be at most 300 characters.",
};

/** The sentence for a callable's error: this feature's refusal, else the parking WhatsApp ones, else a generic one. Never the raw message. */
export function parkingInvoiceRefusalText(error: unknown): string {
  const reason = text(asRow(asRow(error).details).reason, 80);
  if (reason && PARKING_INVOICES_REFUSALS[reason]) return PARKING_INVOICES_REFUSALS[reason];
  return parkingWhatsAppRefusalText(error);
}

// ---------------------------------------------------------------------------
// The preview and the run
// ---------------------------------------------------------------------------

export type InvoiceCar = { id: string; label: string };
export type InvoiceRecipient = {
  phone: string;
  name: string;
  cars: InvoiceCar[];
  totalDueCents: number;
  stillParked: boolean;
  alreadySent: boolean;
};
export type InvoiceRunStatus = "ready" | "sending" | "sent";
export type InvoiceRun = {
  status: InvoiceRunStatus;
  preparedAtMs: number;
  sentAtMs: number;
  /** A user id, or "auto" when the 3rd sent them. */
  sentBy: string;
  recipients: number;
  totalDueCents: number;
  sent: number;
  failed: number;
  skipped: number;
};
export type InvoicePreview = { monthKey: string; run: InvoiceRun | null; recipients: InvoiceRecipient[] };

export function invoicesPreviewRequest(businessId: string, monthKey: string) {
  return { businessId, action: "invoices_preview", monthKey };
}

/** `phones` are the numbers ticked in the preview. */
export function invoicesSendRequest(businessId: string, monthKey: string, phones: readonly string[]) {
  return { businessId, action: "invoices_send", monthKey, phones: [...phones] };
}

function millisOf(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const v = value as { toMillis?: () => number; seconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return 0;
}

const RUN_STATUSES = new Set<string>(["ready", "sending", "sent"]);

function parseRun(value: unknown): InvoiceRun | null {
  if (!value || typeof value !== "object") return null;
  const row = asRow(value);
  const status = RUN_STATUSES.has(text(row.status, 20)) ? (text(row.status, 20) as InvoiceRunStatus) : "ready";
  return {
    status,
    preparedAtMs: millisOf(row.preparedAtMs),
    sentAtMs: millisOf(row.sentAtMs),
    sentBy: text(row.sentBy, 128),
    recipients: count(row.recipients),
    totalDueCents: Math.max(0, Math.round(Number(row.totalDueCents) || 0)),
    sent: count(row.sent),
    failed: count(row.failed),
    skipped: count(row.skipped),
  };
}

/**
 * The server's preview, defensively: a number appears once, a row without a
 * phone is dropped, every field is short text or a whole number.
 */
export function parseInvoicePreview(value: unknown): InvoicePreview {
  const root = asRow(value);
  const seen = new Set<string>();
  const recipients: InvoiceRecipient[] = [];
  const list = Array.isArray(root.recipients) ? root.recipients : [];
  for (const item of list.slice(0, 1000)) {
    const row = asRow(item);
    const phone = text(row.phone, 40);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    const cars = (Array.isArray(row.cars) ? row.cars : []).slice(0, 100).map((car) => {
      const c = asRow(car);
      return { id: text(c.id, 80), label: text(c.label, 120) };
    });
    recipients.push({
      phone,
      name: text(row.name, 120),
      cars,
      totalDueCents: Math.max(0, Math.round(Number(row.totalDueCents) || 0)),
      stillParked: row.stillParked === true,
      alreadySent: row.alreadySent === true,
    });
  }
  return { monthKey: text(root.monthKey, 7), run: parseRun(root.run), recipients };
}

/** Who is ticked when the list opens: everyone not sent yet. */
export function defaultInvoiceSelection(recipients: readonly InvoiceRecipient[]): string[] {
  return recipients.filter((r) => !r.alreadySent).map((r) => r.phone);
}

/** Select all ticks every number, sent or not (the owner may want to send one again). */
export function selectAllInvoices(recipients: readonly InvoiceRecipient[]): string[] {
  return recipients.map((r) => r.phone);
}

export type InvoiceResult = { sent: number; failed: number; skipped: number; remaining: number };

export function parseInvoiceResult(value: unknown): InvoiceResult {
  const row = asRow(value);
  return { sent: count(row.sent), failed: count(row.failed), skipped: count(row.skipped), remaining: count(row.remaining) };
}

/** "3 of 5 selected" / "3 sur 5 sélectionnés". */
export function invoiceSelectionText(selected: number, total: number, lang: Lang = "en"): string {
  return lang === "fr" ? `${selected} sur ${total} sélectionné${selected > 1 ? "s" : ""}` : `${selected} of ${total} selected`;
}

/** The send button: "Send to 3 customers" / "Envoyer à 3 clients". */
export function invoiceSendText(n: number, lang: Lang = "en"): string {
  return lang === "fr"
    ? `Envoyer à ${n} ${plural(n, "client", "clients")}`
    : `Send to ${n} ${plural(n, "customer", "customers")}`;
}

/** The result summary after sending: "5 sent · 1 failed · 2 still to send". */
export function invoiceResultText(result: InvoiceResult, lang: Lang = "en"): string {
  const parts: string[] = [];
  if (lang === "fr") {
    parts.push(`${result.sent} ${plural(result.sent, "facture envoyée", "factures envoyées")}`);
    if (result.skipped > 0) parts.push(`${result.skipped} ${plural(result.skipped, "ignorée", "ignorées")}`);
    if (result.failed > 0) parts.push(`${result.failed} ${plural(result.failed, "échec", "échecs")}`);
    if (result.remaining > 0) parts.push(`${result.remaining} ${plural(result.remaining, "reste à envoyer", "restent à envoyer")}`);
  } else {
    parts.push(`${result.sent} sent`);
    if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
    if (result.failed > 0) parts.push(`${result.failed} failed`);
    if (result.remaining > 0) parts.push(`${result.remaining} still to send`);
  }
  return parts.join(" · ");
}

/** "3 customers · $450.00" for the run's totals. */
export function invoiceTotalsText(recipients: number, totalDueCents: number, lang: Lang = "en"): string {
  const who = lang === "fr" ? `${recipients} ${plural(recipients, "client", "clients")}` : `${recipients} ${plural(recipients, "customer", "customers")}`;
  return `${who} · ${moneyText(totalDueCents)}`;
}

/**
 * The run's status line. `sentOn` is the date the run was sent, already
 * written the US way by the caller; `staffNames` turns a user id into a name.
 * Ready: "Ready to send: 3 customers · $450.00". Sent: "Sent Oct 3, 2026 by
 * Awa · 3 sent · 1 failed", or "... automatically" when the 3rd sent them.
 */
export function invoiceRunText(
  run: InvoiceRun | null,
  options: { lang?: Lang; sentOn?: string; staffNames?: Readonly<Record<string, string>> } = {},
): string {
  const lang = options.lang ?? "en";
  if (!run) return PARKING_INVOICES_COPY.runNone;
  if (run.status === "sending") return PARKING_INVOICES_COPY.runSending;
  if (run.status === "ready") {
    return `${lang === "fr" ? "Prêt à envoyer : " : "Ready to send: "}${invoiceTotalsText(run.recipients, run.totalDueCents, lang)}`;
  }
  const auto = run.sentBy === "auto";
  const name = auto ? "" : text(options.staffNames?.[run.sentBy], 120);
  const by = auto ? (lang === "fr" ? " automatiquement" : " automatically") : name ? (lang === "fr" ? ` par ${name}` : ` by ${name}`) : "";
  const when = options.sentOn ? ` ${options.sentOn}` : "";
  const head = lang === "fr" ? `Envoyées${when}${by}` : `Sent${when}${by}`;
  const counts = invoiceResultText({ sent: run.sent, failed: run.failed, skipped: run.skipped, remaining: 0 }, lang);
  return `${head} · ${counts}`;
}

// ---------------------------------------------------------------------------
// A customer's invoice message: parkingMessages where businessId == and
// kind == "invoice" and monthKey ==
// ---------------------------------------------------------------------------

/** The equality filters of the month's invoice messages query (no order, no limit: no composite index). */
export function invoiceMessagesFilters(businessId: string, monthKey: string): [string, "==", string][] {
  return [
    ["businessId", "==", businessId],
    ["kind", "==", "invoice"],
    ["monthKey", "==", monthKey],
  ];
}

/**
 * The invoice message of each customer, by the key the month-end cards use
 * (`phone:` plus the last ten digits). A row for another month is left out;
 * when a phone has several rows the newest wins.
 */
export function invoiceMessagesByCustomer(rows: readonly Row[], monthKey: string): Map<string, ParkingMessageLine> {
  const out = new Map<string, ParkingMessageLine>();
  for (const row of rows) {
    if (text(row.kind, 20) !== "invoice" || text(row.monthKey, 7) !== monthKey) continue;
    const line = parkingMessageLine(row);
    if (!line || !line.phone) continue;
    const key = parkingCustomerKey({ customerPhone: line.phone, customerName: "" });
    if (!key.startsWith("phone:")) continue;
    const current = out.get(key);
    if (!current || line.atMs >= current.atMs) out.set(key, line);
  }
  return out;
}

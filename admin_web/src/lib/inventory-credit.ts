/**
 * Credit sales, console side (docs/INVENTORY.md, "Credit sales and received
 * by (v4)"). A sale can leave part of its total (or all of it) owed by the
 * customer; one person of the business collects it; later payments are
 * recorded until it is paid, and a mistaken one is reverted, never erased.
 *
 * The callables are the authority (`recordInventoryCreditPayment`,
 * `revertInventoryCreditPayment`, `setInventoryCreditCollector`); this module
 * is the pure half the console's screens use: what a sale's credit chip says,
 * the open-credit list (sorted, filtered, grouped, totalled), the payment and
 * collector forms checked before the call, and the sentences with numbers in
 * them in both languages. No Firebase, no React: `inventory-credit.test.ts`
 * runs it in node.
 *
 * The console does not sell (staff sell in the app), so the "On credit" part
 * of the sale form lives in the app only.
 */

import { INVOICE_PAYMENT_METHODS, MAX_INVOICE_CENTS, centsToInput, moneyText } from "./invoice-ledger.ts";
import { readMoneyInput } from "./money-input.ts";
import {
  inventoryMethodLabel,
  inventorySaleFromRow,
  saleStoreId,
  storeNameIndex,
  type InventoryRefusal,
  type InventorySale,
  type InventorySaleSwitch,
  type InventoryStore,
} from "./inventory.ts";
import { packagePaymentEntries, type PackagePaymentDraft, type PackagePaymentEntry } from "./waiting-packages.ts";

type Lang = "en" | "fr";

const MAX_ID = 200;
const MAX_NOTE = 200;
const MAX_NAME = 120;
const DATE_KEY = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

function text(value: unknown, max = MAX_ID): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Due dates and "today" are read in the shops' zone, like the server's reminders. */
export const CREDIT_ZONE = "America/New_York";

/** The calendar day an instant falls on in a zone, "YYYY-MM-DD" (an unknown zone reads as New York). */
export function dateKeyInZone(ms: number, zone = CREDIT_ZONE): string {
  const format = (timeZone: string) => new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(zone || CREDIT_ZONE);
  } catch {
    parts = format(CREDIT_ZONE);
  }
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** Whether a value is a real calendar day "YYYY-MM-DD". */
export function isDateKey(value: unknown): boolean {
  const match = DATE_KEY.exec(String(value ?? "").trim());
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Whole days from one calendar day to another (positive when `to` is later). */
export function daysBetween(fromKey: string, toKey: string): number {
  if (!isDateKey(fromKey) || !isDateKey(toKey)) return 0;
  const at = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(toKey) - at(fromKey)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// A sale's credit, as a chip.
// ---------------------------------------------------------------------------

export type CreditChipStatus = "open" | "overdue" | "paid";

export const CREDIT_CHIP_LABELS: Record<CreditChipStatus, string> = {
  open: "Credit open",
  overdue: "Credit overdue",
  paid: "Credit paid",
};

export const CREDIT_CHIP_TONES: Record<CreditChipStatus, string> = {
  open: "warn",
  overdue: "warn",
  paid: "ok",
};

export type CreditChip = {
  status: CreditChipStatus;
  /** Still owed (0 once paid). */
  remainingCents: number;
  creditCents: number;
};

/** The chip a sale wears in the list: none for a normal or voided sale. Overdue = still owed after its due date. */
export function creditChip(sale: Pick<InventorySale, "voided" | "creditCents" | "creditRemainingCents" | "credit">, todayKey: string): CreditChip | null {
  if (sale.voided || sale.creditCents <= 0) return null;
  if (sale.creditRemainingCents <= 0) return { status: "paid", remainingCents: 0, creditCents: sale.creditCents };
  const due = sale.credit?.dueDate ?? "";
  const overdue = isDateKey(due) && isDateKey(todayKey) && due < todayKey;
  return { status: overdue ? "overdue" : "open", remainingCents: sale.creditRemainingCents, creditCents: sale.creditCents };
}

/** The chip's words with its amount: "Open $40.00" / "Crédit $40.00". */
export function creditChipText(chip: CreditChip, lang: Lang = "en"): string {
  if (chip.status === "paid") return lang === "fr" ? "Crédit payé" : "Credit paid";
  const money = moneyText(chip.remainingCents);
  if (chip.status === "overdue") return lang === "fr" ? `En retard ${money}` : `Overdue ${money}`;
  return lang === "fr" ? `Crédit ${money}` : `Open ${money}`;
}

// ---------------------------------------------------------------------------
// The sales list's credit filter.
// ---------------------------------------------------------------------------

export type SaleCreditFilter = "all" | "credit" | "open" | "paid";

export const SALE_CREDIT_FILTERS: readonly SaleCreditFilter[] = ["all", "credit", "open", "paid"];

export const SALE_CREDIT_FILTER_LABELS: Record<SaleCreditFilter, string> = {
  all: "All sales",
  credit: "On credit",
  open: "Credit still owed",
  paid: "Credit paid off",
};

export function saleMatchesCreditFilter(sale: Pick<InventorySale, "voided" | "creditCents" | "creditStatus">, filter: SaleCreditFilter): boolean {
  if (filter === "all") return true;
  if (sale.creditCents <= 0) return false;
  if (filter === "credit") return true;
  if (sale.voided) return false;
  return filter === "open" ? sale.creditStatus === "open" : sale.creditStatus === "paid";
}

// ---------------------------------------------------------------------------
// A later payment (Record payment) and its history.
// ---------------------------------------------------------------------------

/** The same form as a package payment: dollars as typed, how it came in, who held it, a note. */
export type CreditPaymentDraft = PackagePaymentDraft;

export function emptyCreditPaymentDraft(receivedByStaffId = ""): CreditPaymentDraft {
  return { amount: "", method: "cash", note: "", receivedByStaffId: text(receivedByStaffId) };
}

/** Every problem with a payment before it is sent; `remainingCents` is what the customer still owes. */
export function validateCreditPaymentDraft(draft: CreditPaymentDraft, remainingCents: number): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  const amount = readMoneyInput(draft.amount).cents;
  if (amount === null || amount <= 0 || amount > MAX_INVOICE_CENTS) errors.push("amount_invalid");
  else if (amount > Math.max(0, remainingCents)) errors.push("payment_exceeds_balance");
  if (!(INVOICE_PAYMENT_METHODS as readonly string[]).includes(text(draft.method, 40))) errors.push("payment_method_invalid");
  if (!text(draft.receivedByStaffId)) errors.push("received_by_invalid");
  return errors;
}

/** "Pay all that is owed": the amount field's text for the rest. */
export function wholeRemainingInput(remainingCents: number): string {
  return remainingCents > 0 ? centsToInput(remainingCents) : "";
}

/** The `recordInventoryCreditPayment` request. */
export function recordInventoryCreditPaymentRequest(businessId: string, saleId: string, draft: CreditPaymentDraft) {
  const note = text(draft.note, MAX_NOTE);
  return {
    businessId: text(businessId),
    saleId: text(saleId),
    amountCents: readMoneyInput(draft.amount).cents ?? 0,
    method: text(draft.method, 40),
    receivedByStaffId: text(draft.receivedByStaffId),
    ...(note ? { note } : {}),
  };
}

/** The `revertInventoryCreditPayment` request. */
export function revertInventoryCreditPaymentRequest(businessId: string, paymentId: string) {
  return { businessId: text(businessId), paymentId: text(paymentId) };
}

/** A sale's payments, newest first: the package payment reader, the rows have the same shape. */
export function creditPaymentEntries(rows: readonly unknown[]): PackagePaymentEntry[] {
  return packagePaymentEntries(rows);
}

/** What the live (not reverted) payments add up to. */
export function livePaymentsCents(entries: readonly Pick<PackagePaymentEntry, "amountCents" | "reverted">[]): number {
  return entries.filter((entry) => !entry.reverted).reduce((sum, entry) => sum + entry.amountCents, 0);
}

// ---------------------------------------------------------------------------
// Who collects, and by when (Change collector).
// ---------------------------------------------------------------------------

export type CollectorDraft = { collectorStaffId: string; dueDate: string };

export function collectorDraftFrom(sale: Pick<InventorySale, "credit">): CollectorDraft {
  return { collectorStaffId: sale.credit?.collectorStaffId ?? "", dueDate: sale.credit?.dueDate ?? "" };
}

export function validateCollectorDraft(draft: CollectorDraft, todayKey: string): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  if (!text(draft.collectorStaffId)) errors.push("collector_invalid");
  const due = text(draft.dueDate, 10);
  if (due && (!isDateKey(due) || (isDateKey(todayKey) && due < todayKey))) errors.push("due_date_invalid");
  return errors;
}

/** The `setInventoryCreditCollector` request: the due date always goes ("" removes it). */
export function setInventoryCreditCollectorRequest(businessId: string, saleId: string, draft: CollectorDraft) {
  return {
    businessId: text(businessId),
    saleId: text(saleId),
    collectorStaffId: text(draft.collectorStaffId),
    dueDate: text(draft.dueDate, 10),
  };
}

export function collectorDraftChanged(sale: Pick<InventorySale, "credit">, draft: CollectorDraft): boolean {
  const now = collectorDraftFrom(sale);
  return now.collectorStaffId !== text(draft.collectorStaffId) || now.dueDate !== text(draft.dueDate, 10);
}

// ---------------------------------------------------------------------------
// Credit owed: the open-credit list.
// ---------------------------------------------------------------------------

export type OpenCreditRow = {
  saleId: string;
  customerName: string;
  customerPhone: string;
  /** Two sales of one customer share it: the phone's digits, else the name in lower case. */
  customerKey: string;
  collectorStaffId: string;
  /** "" when there is none. */
  dueDate: string;
  overdue: boolean;
  /** Days past the due date (0 when not overdue). */
  daysOverdue: number;
  creditCents: number;
  paidCents: number;
  remainingCents: number;
  /** The store it counts under ("" for a business without stores). */
  storeId: string;
  storeName: string;
  createdAtMs: number;
  sale: InventorySale;
};

function millisOf(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "object" && value) {
    const v = value as { toMillis?: () => number; seconds?: number };
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function customerKeyOf(name: unknown, phone: unknown): string {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  if (digits.length >= 7) return `tel:${digits}`;
  return `name:${text(name, 120).toLowerCase().replace(/\s+/g, " ")}`;
}

/**
 * Oldest due first: sales with a due date by that date, then sales without
 * one by when they were made. Ties by sale id, so the order never jitters.
 */
export function compareOpenCredit(a: OpenCreditRow, b: OpenCreditRow): number {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return a.createdAtMs - b.createdAtMs || a.saleId.localeCompare(b.saleId);
}

/** The sales that still owe money, read from `inventorySales where creditStatus == "open"`, oldest due first. */
export function openCreditRows(rows: readonly unknown[], { stores = [], todayKey }: { stores?: readonly InventoryStore[]; todayKey: string }): OpenCreditRow[] {
  const names = storeNameIndex([...stores]);
  const out: OpenCreditRow[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const sale = inventorySaleFromRow(row);
    if (!sale.id || sale.voided || sale.creditStatus !== "open" || !sale.credit) continue;
    const due = sale.credit.dueDate;
    const daysOverdue = due && isDateKey(todayKey) ? Math.max(0, daysBetween(due, todayKey)) : 0;
    const storeId = stores.length > 0 ? saleStoreId(sale, [...stores]) : sale.storeId;
    out.push({
      saleId: sale.id,
      customerName: sale.credit.customerName,
      customerPhone: sale.credit.customerPhone,
      customerKey: customerKeyOf(sale.credit.customerName, sale.credit.customerPhone),
      collectorStaffId: sale.credit.collectorStaffId,
      dueDate: due,
      overdue: daysOverdue > 0,
      daysOverdue,
      creditCents: sale.creditCents,
      paidCents: sale.creditPaidCents,
      remainingCents: sale.creditRemainingCents,
      storeId,
      storeName: sale.storeName || names.get(storeId) || "",
      createdAtMs: millisOf(sale.createdAt),
      sale,
    });
  }
  return out.sort(compareOpenCredit);
}

export type OpenCreditFilter = {
  /** "" = everyone. */
  collectorStaffId?: string;
  /** "" = every store. */
  storeId?: string;
  overdueOnly?: boolean;
  /** Matches the customer's name or phone. */
  search?: string;
};

export function filterOpenCredit(rows: readonly OpenCreditRow[], filter: OpenCreditFilter): OpenCreditRow[] {
  const words = text(filter.search, 120).toLowerCase().split(/\s+/).filter(Boolean);
  const digits = text(filter.search, 120).replace(/[^0-9]/g, "");
  return rows.filter((row) => {
    if (filter.collectorStaffId && row.collectorStaffId !== filter.collectorStaffId) return false;
    if (filter.storeId && row.storeId !== filter.storeId) return false;
    if (filter.overdueOnly && !row.overdue) return false;
    if (words.length === 0) return true;
    const name = row.customerName.toLowerCase();
    if (words.every((word) => name.includes(word))) return true;
    return digits.length >= 3 && row.customerPhone.replace(/[^0-9]/g, "").includes(digits);
  });
}

export type CreditGroupBy = "none" | "customer" | "collector" | "store";

export const CREDIT_GROUP_LABELS: Record<CreditGroupBy, string> = {
  none: "Oldest due first",
  customer: "By customer",
  collector: "By collector",
  store: "By store",
};

export type OpenCreditTotals = {
  count: number;
  remainingCents: number;
  overdueCount: number;
  overdueCents: number;
  customers: number;
};

export function openCreditTotals(rows: readonly OpenCreditRow[]): OpenCreditTotals {
  const customers = new Set<string>();
  let remainingCents = 0;
  let overdueCount = 0;
  let overdueCents = 0;
  for (const row of rows) {
    customers.add(row.customerKey);
    remainingCents += row.remainingCents;
    if (row.overdue) {
      overdueCount += 1;
      overdueCents += row.remainingCents;
    }
  }
  return { count: rows.length, remainingCents, overdueCount, overdueCents, customers: customers.size };
}

export type OpenCreditGroup = {
  key: string;
  /** The customer's name, the collector's name or the store's name ("" when unknown). */
  label: string;
  /** The customer's phone, for a customer group. */
  detail: string;
  rows: OpenCreditRow[];
  totals: OpenCreditTotals;
};

/**
 * The rows grouped, each group in the order its oldest-due row came (the rows
 * arrive sorted, so the most urgent group leads). `none` is one group.
 */
export function groupOpenCredit(rows: readonly OpenCreditRow[], by: CreditGroupBy, nameOf: (staffId: string) => string = () => ""): OpenCreditGroup[] {
  if (by === "none") return [{ key: "all", label: "", detail: "", rows: [...rows], totals: openCreditTotals(rows) }];
  const groups = new Map<string, { label: string; detail: string; rows: OpenCreditRow[] }>();
  for (const row of rows) {
    const key = by === "customer" ? row.customerKey : by === "collector" ? row.collectorStaffId : row.storeId;
    const label = by === "customer" ? row.customerName : by === "collector" ? nameOf(row.collectorStaffId) : row.storeName;
    const entry = groups.get(key) ?? { label, detail: by === "customer" ? row.customerPhone : "", rows: [] };
    entry.rows.push(row);
    groups.set(key, entry);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group, totals: openCreditTotals(group.rows) }));
}

// ---------------------------------------------------------------------------
// Sentences with names or numbers in them, per language.
// ---------------------------------------------------------------------------

/** "Oct 14, 2026" / "14 oct. 2026": a calendar day read as that day. */
export function dayKeyText(key: string, lang: Lang = "en"): string {
  const match = DATE_KEY.exec(key);
  if (!match || !isDateKey(key)) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(date);
}

/** "Due Oct 14, 2026" / "Échéance le 14 oct. 2026"; "No due date" / "Sans échéance". */
export function dueDateText(key: string, lang: Lang = "en"): string {
  const day = dayKeyText(key, lang);
  if (!day) return lang === "fr" ? "Sans échéance" : "No due date";
  return lang === "fr" ? `Échéance le ${day}` : `Due ${day}`;
}

/** "3 days overdue" / "En retard de 3 jours". */
export function overdueDaysText(days: number, lang: Lang = "en"): string {
  if (lang === "fr") return `En retard de ${days} ${days === 1 ? "jour" : "jours"}`;
  return `${days} ${days === 1 ? "day" : "days"} overdue`;
}

/** "Fatou Bah owes $40.00" / "Fatou Bah doit $40.00". */
export function owesText(name: string, cents: number, lang: Lang = "en"): string {
  const who = name || (lang === "fr" ? "Le client" : "The customer");
  return lang === "fr" ? `${who} doit ${moneyText(cents)}` : `${who} owes ${moneyText(cents)}`;
}

/** "$10.00 paid of $40.00" / "$10.00 payés sur $40.00". */
export function paidOfText(paidCents: number, creditCents: number, lang: Lang = "en"): string {
  return lang === "fr"
    ? `${moneyText(paidCents)} payés sur ${moneyText(creditCents)}`
    : `${moneyText(paidCents)} paid of ${moneyText(creditCents)}`;
}

/** "Received by Anna" / "Reçu par Anna". */
export function receivedByText(name: string, lang: Lang = "en"): string {
  if (!name) return "";
  return lang === "fr" ? `Reçu par ${name}` : `Received by ${name}`;
}

/** "Collector: Anna" / "Encaissement : Anna"; no name, "No collector" / "Personne". */
export function collectorText(name: string, lang: Lang = "en"): string {
  if (lang === "fr") return name ? `Encaissement : ${name}` : "Encaissement : personne";
  return name ? `Collector: ${name}` : "Collector: nobody";
}

/** "3 sales on credit" / "3 ventes à crédit". */
export function creditSalesCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "vente" : "ventes"} à crédit`;
  return `${count} ${count === 1 ? "sale" : "sales"} on credit`;
}

/** "2 customers" / "2 clients". */
export function customerCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "client" : "clients"}`;
  return `${count} ${count === 1 ? "customer" : "customers"}`;
}

/** "Paid now $20.00 · on credit $40.00" / "Payé maintenant ... · à crédit ...". */
export function paidNowSplitText(paidNowCents: number, creditCents: number, lang: Lang = "en"): string {
  return lang === "fr"
    ? `Payé maintenant ${moneyText(paidNowCents)} · à crédit ${moneyText(creditCents)}`
    : `Paid now ${moneyText(paidNowCents)} · on credit ${moneyText(creditCents)}`;
}

/** "of which $40.00 on credit" / "dont $40.00 à crédit". */
export function ofWhichOnCreditText(creditCents: number, lang: Lang = "en"): string {
  return lang === "fr" ? `dont ${moneyText(creditCents)} à crédit` : `of which ${moneyText(creditCents)} on credit`;
}

/** "$25.00 still owed" / "$25.00 encore dus". */
export function stillOwedText(cents: number, lang: Lang = "en"): string {
  return lang === "fr" ? `${moneyText(cents)} encore dus` : `${moneyText(cents)} still owed`;
}

// ---------------------------------------------------------------------------
// Switching a recorded sale between paid and credit (v6, docs/INVENTORY.md).
// The callable `switchInventorySalePayment` is the authority; these are the
// forms checked before the call and the history line.
// ---------------------------------------------------------------------------

/** "Switch to credit" is offered on a sale paid in full, not voided, sold for something. */
export function canSwitchToCredit(sale: Pick<InventorySale, "voided" | "creditCents" | "totalCents">): boolean {
  return !sale.voided && sale.creditCents <= 0 && sale.totalCents > 0;
}

/** "Switch to paid" ("it was never credit") only while nothing was collected on the credit. */
export function canSwitchToPaid(sale: Pick<InventorySale, "voided" | "creditCents" | "creditPaidCents">): boolean {
  return !sale.voided && sale.creditCents > 0 && sale.creditPaidCents === 0;
}

/** The same questions as a credit sale at the counter, plus what was paid at the time. */
export type SwitchToCreditDraft = {
  /** Dollars as typed; blank is nothing paid at the time. */
  paidNow: string;
  customerName: string;
  /** As the country phone field writes it. */
  customerPhone: string;
  collectorStaffId: string;
  /** "YYYY-MM-DD" or "" for none. */
  dueDate: string;
};

export function emptySwitchToCreditDraft(): SwitchToCreditDraft {
  return { paidNow: "", customerName: "", customerPhone: "", collectorStaffId: "", dueDate: "" };
}

/** "+<digits>" from what the phone field holds; "" when it holds no more than a country code. */
export function creditPhoneOf(value: unknown): string {
  const raw = text(value, 40);
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length > 3 ? `+${digits}` : "";
}

/** What was paid at the time, in cents: 0 when blank, null when it cannot be read. */
export function switchPaidNowCents(draft: Pick<SwitchToCreditDraft, "paidNow">): number | null {
  if (!text(draft.paidNow)) return 0;
  const cents = readMoneyInput(draft.paidNow).cents;
  return cents === null || cents < 0 ? null : cents;
}

/** Every problem before the switch is sent, as the server's codes. */
export function validateSwitchToCreditDraft(draft: SwitchToCreditDraft, totalCents: number, todayKey: string): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  const paid = switchPaidNowCents(draft);
  if (paid === null || paid >= totalCents) errors.push("paid_now_invalid");
  if (!text(draft.customerName, MAX_NAME)) errors.push("credit_customer_required");
  const phone = creditPhoneOf(draft.customerPhone);
  if (phone && !/^\+[0-9]{7,15}$/.test(phone)) errors.push("customer_phone_invalid");
  if (!text(draft.collectorStaffId)) errors.push("collector_invalid");
  const due = text(draft.dueDate, 10);
  if (due && (!isDateKey(due) || (isDateKey(todayKey) && due < todayKey))) errors.push("due_date_invalid");
  return errors;
}

/** How the total splits once switched: paid at the time, and owed. */
export function switchSplit(draft: Pick<SwitchToCreditDraft, "paidNow">, totalCents: number): { paidNowCents: number; creditCents: number } {
  const paid = Math.min(Math.max(0, switchPaidNowCents(draft) ?? 0), totalCents);
  return { paidNowCents: paid, creditCents: totalCents - paid };
}

/** The `switchInventorySalePayment` request to credit. */
export function switchToCreditRequest(businessId: string, saleId: string, clientRequestId: string, draft: SwitchToCreditDraft) {
  return {
    businessId: text(businessId),
    saleId: text(saleId),
    clientRequestId: text(clientRequestId, 100),
    to: "credit" as const,
    credit: {
      paidNowCents: switchPaidNowCents(draft) ?? 0,
      customerName: text(draft.customerName, MAX_NAME),
      customerPhone: creditPhoneOf(draft.customerPhone),
      collectorStaffId: text(draft.collectorStaffId),
      dueDate: text(draft.dueDate, 10),
    },
  };
}

export type SwitchToPaidDraft = { method: string; receivedByStaffId: string };

/**
 * Switch to paid starts on the sale: its method (or, when it went to credit
 * with nothing paid, the one it had before), else cash; and who received
 * what was paid at the time.
 */
export function switchToPaidDraftFrom(sale: Pick<InventorySale, "paymentMethod" | "receivedByStaffId" | "paymentSwitches">): SwitchToPaidDraft {
  const methods = INVOICE_PAYMENT_METHODS as readonly string[];
  const before = [...sale.paymentSwitches].reverse().find((entry) => methods.includes(entry.fromPaymentMethod));
  const method = methods.includes(sale.paymentMethod) ? sale.paymentMethod : before?.fromPaymentMethod ?? "cash";
  return { method, receivedByStaffId: text(sale.receivedByStaffId) };
}

export function validateSwitchToPaidDraft(draft: SwitchToPaidDraft): InventoryRefusal[] {
  const errors: InventoryRefusal[] = [];
  if (!(INVOICE_PAYMENT_METHODS as readonly string[]).includes(text(draft.method, 40))) errors.push("payment_method_invalid");
  if (!text(draft.receivedByStaffId)) errors.push("received_by_invalid");
  return errors;
}

/** The `switchInventorySalePayment` request to paid. */
export function switchToPaidRequest(businessId: string, saleId: string, clientRequestId: string, draft: SwitchToPaidDraft) {
  return {
    businessId: text(businessId),
    saleId: text(saleId),
    clientRequestId: text(clientRequestId, 100),
    to: "paid" as const,
    paymentMethod: text(draft.method, 40),
    receivedByStaffId: text(draft.receivedByStaffId),
  };
}

/** What the answers are, so the same answers sent again reuse their request id (a retry). */
export function switchDraftKey(to: "credit" | "paid", draft: SwitchToCreditDraft | SwitchToPaidDraft): string {
  return `${to}|${JSON.stringify(draft)}`;
}

/**
 * One switch as the sale's history shows it (the words around a typed name,
 * so the screen renders it as is, in the reader's language):
 * "Switched to credit by Ama · Oct 20, 2026, 3:15 PM · $10.00 paid, $30.00 owed" /
 * "Passée à crédit par Ama · ... · $10.00 payés, $30.00 dus";
 * "Switched to paid by Ama · ... · $40.00 paid" (the screen adds the method,
 * `methodLabel`, which the dictionary translates).
 */
export function saleSwitchLineText(entry: InventorySaleSwitch, who: string, when: string, lang: Lang = "en"): { text: string; methodLabel: string } {
  const name = who || (lang === "fr" ? "Un membre de l’équipe" : "A team member");
  const at = when ? ` · ${when}` : "";
  if (entry.to === "credit") {
    return {
      text: lang === "fr"
        ? `Passée à crédit par ${name}${at} · ${moneyText(entry.toPaidNowCents)} payés, ${moneyText(entry.toCreditCents)} dus`
        : `Switched to credit by ${name}${at} · ${moneyText(entry.toPaidNowCents)} paid, ${moneyText(entry.toCreditCents)} owed`,
      methodLabel: "",
    };
  }
  return {
    text: lang === "fr"
      ? `Passée en payée par ${name}${at} · ${moneyText(entry.totalCents)} payés`
      : `Switched to paid by ${name}${at} · ${moneyText(entry.totalCents)} paid`,
    methodLabel: inventoryMethodLabel(entry.toPaymentMethod),
  };
}

/** The confirmation of Switch to credit, both languages. */
export function switchToCreditConfirmText(name: string, split: { paidNowCents: number; creditCents: number }, lang: Lang = "en"): string {
  return lang === "fr"
    ? `Passer cette vente à crédit ? ${name} devra ${moneyText(split.creditCents)}. ${moneyText(split.paidNowCents)} reste payé au moment de la vente. La personne qui encaisse est prévenue.`
    : `Put this sale on credit? ${name} will owe ${moneyText(split.creditCents)}. ${moneyText(split.paidNowCents)} stays paid at the time. The collector is told.`;
}

/** The confirmation of Switch to paid, both languages. */
export function switchToPaidConfirmText(totalCents: number, lang: Lang = "en"): string {
  return lang === "fr"
    ? `Marquer cette vente comme payée ? La totalité de ${moneyText(totalCents)} a été payée au moment de la vente. Plus personne ne doit rien dessus.`
    : `Mark this sale as paid? The whole ${moneyText(totalCents)} was paid at the time of the sale. Nobody owes anything on it any more.`;
}

/** "It was never credit: the whole $60.00 was paid at the time of the sale." */
export function neverCreditText(totalCents: number, lang: Lang = "en"): string {
  return lang === "fr"
    ? `Ce n’était pas un crédit : la totalité de ${moneyText(totalCents)} a été payée au moment de la vente.`
    : `It was never credit: the whole ${moneyText(totalCents)} was paid at the time of the sale.`;
}

/** The flash once switched: "Switched to credit: $40.00 owed." / "Switched to paid." */
export function switchedText(to: "credit" | "paid", creditCents: number, lang: Lang = "en"): string {
  if (to === "credit") {
    return lang === "fr" ? `Passée à crédit : ${moneyText(creditCents)} dus.` : `Switched to credit: ${moneyText(creditCents)} owed.`;
  }
  return lang === "fr" ? "Passée en payée." : "Switched to paid.";
}


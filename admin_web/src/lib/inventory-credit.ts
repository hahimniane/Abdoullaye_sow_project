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
  inventorySaleFromRow,
  saleStoreId,
  storeNameIndex,
  type InventoryRefusal,
  type InventorySale,
  type InventoryStore,
} from "./inventory.ts";
import { packagePaymentEntries, type PackagePaymentDraft, type PackagePaymentEntry } from "./waiting-packages.ts";

type Lang = "en" | "fr";

const MAX_ID = 200;
const MAX_NOTE = 200;
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

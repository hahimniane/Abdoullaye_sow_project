/**
 * The console's side of "staff expenses come off their parking bill"
 * (docs/STAFF_EXPENSE_CREDIT.md): the parking customers a staff member can
 * be linked to (with suggestions), the Paid back form's checks, and the
 * server's refusals in the console's words (French in french-dom.ts). Pure.
 * The arithmetic itself is staff-expense-credit.ts, the server's mirror.
 */

import { mostUsedName, parkingCustomerKey } from "./parking-month-statement.ts";

type Row = Record<string, unknown>;

const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const digitsOf = (value: unknown) => text(value, 40).replace(/\D+/g, "").slice(-10);

/** A parking customer as the link picker shows it. */
export type ParkingLinkCustomer = {
  /** parkingCustomerKey - the key month-end bills group by. */
  key: string;
  name: string;
  phone: string;
  cars: number;
};

/** The business's parking customers, one per parkingCustomerKey (the phone,
 * else the name), each with the name used most and how many cars. By name. */
export function parkingLinkCustomers(cars: readonly Row[]): ParkingLinkCustomer[] {
  const groups = new Map<string, { names: string[]; phone: string; ids: Set<string> }>();
  for (const row of cars) {
    if (text(row.status, 40) === "cancelled") continue;
    const customerName = text(row.customerName) || text(row.ownerName);
    const customerPhone = text(row.customerPhone, 40);
    if (!customerName && !customerPhone) continue;
    const key = parkingCustomerKey({ customerPhone, customerName });
    if (!groups.has(key)) groups.set(key, { names: [], phone: "", ids: new Set() });
    const g = groups.get(key)!;
    if (customerName) g.names.push(customerName);
    if (!g.phone && customerPhone) g.phone = customerPhone;
    g.ids.add(text(row.id) || `${g.ids.size}`);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, name: mostUsedName(g.names), phone: g.phone, cars: g.ids.size }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

const tokens = (name: unknown) =>
  text(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter((t) => t.length >= 2);

/**
 * How well a parking customer matches a staff member: the same phone (last
 * ten digits) beats everything; then names that share a word, case-insensitive
 * ("Abdoulaye Sow" and "Abd Sow" share "sow"), a word that starts the other
 * ("abd" / "abdoulaye") counting less. 0 = no match.
 */
export function parkingLinkScore(staff: { name: string; phone: string }, customer: ParkingLinkCustomer): number {
  let score = 0;
  const a = digitsOf(staff.phone);
  const b = digitsOf(customer.phone);
  if (a.length >= 7 && a === b) score += 100;
  const mine = tokens(staff.name);
  for (const theirs of tokens(customer.name)) {
    if (mine.includes(theirs)) score += 10;
    else if (theirs.length >= 3 && mine.some((m) => m.length >= 3 && (m.startsWith(theirs) || theirs.startsWith(m)))) score += 4;
  }
  return score;
}

/** The picker's list: suggestions first (best match first), then everyone by name. */
export function parkingLinkChoices(
  staff: { name: string; phone: string },
  customers: readonly ParkingLinkCustomer[],
  search = "",
): (ParkingLinkCustomer & { suggested: boolean })[] {
  const q = text(search).toLowerCase();
  const qDigits = q.replace(/\D+/g, "");
  const scored = customers
    .filter((c) => !q || c.name.toLowerCase().includes(q) || (qDigits.length >= 3 && digitsOf(c.phone).includes(qDigits)))
    .map((c) => ({ c, score: parkingLinkScore(staff, c) }));
  const suggested = scored.filter((x) => x.score > 0).sort((x, y) => y.score - x.score || x.c.name.localeCompare(y.c.name));
  const rest = scored.filter((x) => x.score <= 0);
  return [...suggested.map((x) => ({ ...x.c, suggested: true })), ...rest.map((x) => ({ ...x.c, suggested: false }))];
}

/** How the money was given back - the same words as everywhere money is received. */
export const STAFF_REPAYMENT_METHODS = [
  { value: "cash", label: "Cash payment" },
  { value: "zelle", label: "Zelle transfer" },
  { value: "check", label: "Paper check" },
  { value: "other", label: "Another method" },
] as const;
export type StaffRepaymentMethod = (typeof STAFF_REPAYMENT_METHODS)[number]["value"];

/** "12.34" / "$1,234.5" -> cents, or NaN when it is not an amount. */
export function dollarsToCents(value: string): number {
  const cleaned = text(value, 40).replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * 100);
}

export type StaffRepaymentDraft = {
  amount: string;
  method: string;
  givenByStaffId: string;
  note: string;
  /** "yyyy-mm-dd": the day the money was given (the server's `paidAt`). */
  paidAt: string;
};

/** Today in New York, "yyyy-mm-dd" - the day the server checks `paidAt` against. */
export function newYorkDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The day a Paid back is dated by default: today when the month on screen
 * is this month; for a month already over, its last day - so it settles
 * that month's report (and every later one), and the owner who pays back
 * September's expenses on October 1 sees September's line clear.
 */
export function defaultRepaymentDay(monthKey: string, todayKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(text(monthKey, 7));
  if (!match || monthKey >= todayKey.slice(0, 7)) return todayKey;
  const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0));
  return last.toISOString().slice(0, 10);
}

/** What is wrong with a Paid back before it is sent, or "" (the client cap: at most what is owed). */
export function staffRepaymentProblem(draft: StaffRepaymentDraft, owedCents: number, todayKey: string = newYorkDayKey()): string {
  const amountCents = dollarsToCents(draft.amount);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return STAFF_CREDIT_REFUSAL_COPY.repayment_amount_invalid;
  if (amountCents > owedCents) return STAFF_CREDIT_REFUSAL_COPY.repayment_exceeds_credit;
  if (!STAFF_REPAYMENT_METHODS.some((m) => m.value === draft.method)) return STAFF_CREDIT_REFUSAL_COPY.repayment_method_invalid;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.paidAt) || draft.paidAt > todayKey) return STAFF_CREDIT_REFUSAL_COPY.repayment_date_invalid;
  if (!text(draft.givenByStaffId, 128)) return "Say who gave the money.";
  return "";
}

/** The `record_staff_repayment` request (docs/STAFF_EXPENSE_CREDIT.md §4). */
export function staffRepaymentRequest(businessId: string, staffId: string, draft: StaffRepaymentDraft) {
  return {
    action: "record_staff_repayment",
    businessId,
    staffId,
    amountCents: dollarsToCents(draft.amount),
    method: draft.method,
    givenByStaffId: draft.givenByStaffId,
    note: text(draft.note, 300),
    paidAt: draft.paidAt,
  };
}

/** The `link_staff_parking` request; `null` unlinks (`customerKey: ""`). */
export function staffParkingLinkRequest(businessId: string, staffId: string, customer: ParkingLinkCustomer | null) {
  return {
    action: "link_staff_parking",
    businessId,
    staffId,
    customerKey: customer?.key ?? "",
    customerName: customer?.name ?? "",
    customerPhone: customer?.phone ?? "",
  };
}

/** A repayment's `paidAt` (a Timestamp at noon UTC of the day) in ms, 0 when unknown. */
function paidAtMs(r: Row): number {
  const v = r.paidAt as { toMillis?: () => number; toDate?: () => Date; seconds?: number } | string | number | null | undefined;
  if (!v) return 0;
  if (typeof v === "object" && typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "object" && typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  const n = new Date(v as string | number).getTime();
  return Number.isNaN(n) ? 0 : n;
}

/** The day a repayment was given, "yyyy-mm-dd", or "". */
export function repaymentDayKey(r: Row): string {
  const ms = paidAtMs(r);
  return ms > 0 ? new Date(ms).toISOString().slice(0, 10) : "";
}

/** This month's paid-back records that still count, newest first. */
export function monthStaffRepayments(repayments: readonly Row[], monthKey: string): Row[] {
  const ms = paidAtMs;
  return repayments
    .filter((r) => r.voided !== true && text(r.month, 7) === monthKey)
    .sort((a, b) => ms(b) - ms(a) || text(b.id).localeCompare(text(a.id)));
}

export type StaffCreditRefusal =
  | "staff_not_member"
  | "repayment_amount_invalid"
  | "repayment_exceeds_credit"
  | "repayment_not_found"
  | "repayment_voided"
  | "repayment_method_invalid"
  | "repayment_date_invalid"
  | "link_owner_only"
  | "link_customer_invalid"
  | "staff_action_invalid";

/**
 * The title of a lot-ledger change on Today: the staff-expense entries
 * (entityType staff_parking_link / staff_repayment) say what happened; every
 * other entry keeps the wording it always had.
 */
export function ledgerEventTitle(event: Row): string {
  const type = text(event.entityType, 60);
  const action = text(event.action, 40);
  if (type === "staff_parking_link") return action === "unlinked" ? "Parking bill unlinked" : "Parking bill linked";
  if (type === "staff_repayment") return action === "voided" ? "Staff payback voided" : "Staff paid back for expenses";
  if (action === "voided") return "Ledger entry voided";
  if (action === "paid") return "Ledger payment received";
  return "Ledger entry edited";
}

/** The server's refusals (docs/STAFF_EXPENSE_CREDIT.md §4) in the console's words. */
export const STAFF_CREDIT_REFUSAL_COPY: Record<StaffCreditRefusal | "permission_denied" | "unknown", string> = {
  staff_not_member: "That person is no longer on this business's team.",
  repayment_amount_invalid: "Enter an amount greater than $0.",
  repayment_exceeds_credit: "That is more than the business owes this person.",
  repayment_not_found: "That paid-back record no longer exists.",
  repayment_voided: "That paid-back record was already voided.",
  repayment_method_invalid: "Choose how the money was given.",
  repayment_date_invalid: "Choose the day it was paid back, today or earlier.",
  link_owner_only: "Only the business owner can link a parking bill.",
  link_customer_invalid: "Choose the parking customer to link.",
  staff_action_invalid: "This console is out of date. Reload the page and try again.",
  permission_denied: "Your account is not allowed to do this. Ask the business owner.",
  unknown: "It did not save. Check your connection and try again.",
};

/** A callable's rejection read for one of those codes: `details.reason`,
 * `details.code`, or the code in the message. Never the raw text. */
export function staffCreditRefusalText(error: unknown): string {
  const e = (error && typeof error === "object" ? error : {}) as Row;
  const details = (e.details && typeof e.details === "object" ? e.details : {}) as Row;
  const codes = Object.keys(STAFF_CREDIT_REFUSAL_COPY) as (keyof typeof STAFF_CREDIT_REFUSAL_COPY)[];
  const reasons = Array.isArray(details.reasons) ? details.reasons.map((r) => text(r, 80)) : [];
  const candidates = [text(details.reason, 80), ...reasons, text(details.code, 80), text(e.message, 400)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const hit = codes.find((code) => code !== "unknown" && code !== "permission_denied" && candidate === code) ??
      codes.find((code) => code !== "unknown" && code !== "permission_denied" && candidate.includes(code));
    if (hit) return STAFF_CREDIT_REFUSAL_COPY[hit];
  }
  if (/permission-denied$/.test(text(e.code, 80))) return STAFF_CREDIT_REFUSAL_COPY.permission_denied;
  return STAFF_CREDIT_REFUSAL_COPY.unknown;
}

/**
 * Part of a month bill paid at once (docs/PARKING_BILL_PAYMENTS.md) - the
 * console's mirror of the server's `parking_bill_payment.js` (and the app's
 * `parking_bill_payment.dart`). All three must give the same answers for
 * `functions/test/fixtures/parking-bill-payment-cases.json`.
 *
 * Staff type ONE amount on a customer's Month end card; it pays the bill's
 * charges oldest first (money from before the month, then the month), is kept
 * as one `parkingBillPayments` document with one receipt, and is undone as
 * one. Never more than the bill's recordable total: there is no parking
 * credit balance. Pure: no Firebase, no React.
 */

import { itemsAfterCredit } from "./staff-expense-credit.ts";

type Row = Record<string, unknown>;

const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const cents = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

export const BILL_PAYMENT_REFUSAL = Object.freeze({
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
} as const);

export type BillPaymentRefusal = (typeof BILL_PAYMENT_REFUSAL)[keyof typeof BILL_PAYMENT_REFUSAL];

/** The server's words for each refusal (French in french-dom.ts). */
export const BILL_PAYMENT_MESSAGES: Record<BillPaymentRefusal, string> = Object.freeze({
  [BILL_PAYMENT_REFUSAL.NO_AMOUNT]: "Enter the amount received.",
  [BILL_PAYMENT_REFUSAL.MORE_THAN_OWED]: "That is more than this bill owes. Record what is owed and give the rest back.",
  [BILL_PAYMENT_REFUSAL.NOTHING_TO_PAY]: "Nothing on this bill can be paid here.",
  [BILL_PAYMENT_REFUSAL.CUSTOMER_NOT_FOUND]: "This customer has no bill for this month.",
  [BILL_PAYMENT_REFUSAL.BILL_CHANGED]: "The bill changed while you were on it. Refresh and try again.",
  [BILL_PAYMENT_REFUSAL.RECEIVER_REQUIRED]: "Say who took the money so it can be reconciled.",
  [BILL_PAYMENT_REFUSAL.MONTH_INVALID]: "Pick a month that has started.",
  [BILL_PAYMENT_REFUSAL.NOT_FOUND]: "This payment was not found.",
  [BILL_PAYMENT_REFUSAL.ALREADY_UNDONE]: "This payment was already undone.",
  [BILL_PAYMENT_REFUSAL.SETTLED_SINCE]: "A car or job in this payment was marked paid in full afterwards. Undo that first.",
  [BILL_PAYMENT_REFUSAL.LEDGER_REQUIRED]: "This payment covers lot activities: it needs the ledger permission.",
});

/** What a callable's rejection says when it carries no reason of ours. */
export const BILL_PAYMENT_FALLBACK_MESSAGES = Object.freeze({
  permission_denied: "Your account is not allowed to do this. Ask the business owner.",
  unknown: "It did not save. Check your connection and try again.",
});

/** The parts of a Month end customer a payment is worked out from. */
export type BillPaymentCar = {
  id: string;
  vehicle?: string;
  trackingCode?: string;
  periodFrom?: string;
  dueCents?: number;
  priorUnpaidCents?: number;
  recordable?: boolean;
};
export type BillPaymentActivity = {
  id: string;
  label?: string;
  vehicle?: string;
  date?: string;
  dueCents?: number;
};
export type BillPaymentCustomer = {
  dueCents?: number;
  expenseCreditCents?: number;
  olderCars?: readonly BillPaymentCar[];
  cars?: readonly BillPaymentCar[];
  activities?: readonly BillPaymentActivity[];
  olderActivities?: readonly BillPaymentActivity[];
};

export type BillPaymentItem = {
  kind: "car" | "activity";
  id: string;
  label: string;
  trackingCode: string;
  dayKey: string;
  amountCents: number;
};

export type BillPaymentPart = {
  kind: "car" | "activity";
  id: string;
  label: string;
  trackingCode: string;
  amountCents: number;
  full: boolean;
};

export type BillPaymentPlan = {
  ok: boolean;
  reason: "" | BillPaymentRefusal;
  payableCents: number;
  parts: BillPaymentPart[];
  leftCents: number;
};

/**
 * The bill's charges a payment recorded here can pay, oldest first: what is
 * from before the month (cars that left earlier, the earlier days of cars
 * still on the bill, older activities), then the month's own cars and
 * activities - each group by date. Cars paid through Stripe are not
 * recordable here and are left out, as in Mark all paid. A linked staff
 * member's expense credit covers the first items (itemsAfterCredit).
 */
export function billPaymentItems(customer: BillPaymentCustomer | null | undefined): BillPaymentItem[] {
  const c = customer || {};
  const before: BillPaymentItem[] = [];
  const month: BillPaymentItem[] = [];
  const car = (b: BillPaymentCar, amountCents: number, dayKey: unknown, into: BillPaymentItem[]) => {
    if (amountCents <= 0 || b.recordable !== true) return;
    into.push({
      kind: "car", id: text(b.id), label: text(b.vehicle) || "Car",
      trackingCode: text(b.trackingCode, 40), dayKey: text(dayKey, 10), amountCents,
    });
  };
  for (const b of c.olderCars || []) car(b, cents(b.dueCents), b.periodFrom, before);
  for (const b of c.cars || []) {
    // A car on the bill owes its earlier days first, then the month's.
    const prior = Math.min(cents(b.priorUnpaidCents), cents(b.dueCents));
    car(b, prior, b.periodFrom, before);
    car(b, cents(b.dueCents) - prior, b.periodFrom, month);
  }
  const activity = (a: BillPaymentActivity, into: BillPaymentItem[]) => {
    const amountCents = cents(a.dueCents);
    if (amountCents <= 0) return;
    into.push({
      kind: "activity", id: text(a.id),
      label: `${text(a.label) || "Activity"}${text(a.vehicle) ? ` · ${text(a.vehicle)}` : ""}`,
      trackingCode: "", dayKey: text(a.date, 10), amountCents,
    });
  };
  for (const a of c.olderActivities || []) activity(a, before);
  for (const a of c.activities || []) activity(a, month);
  const byDay = (a: BillPaymentItem, b: BillPaymentItem) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0);
  // A stable sort (Array.prototype.sort is, in every engine we run) keeps a
  // car's earlier days ahead of its month.
  return itemsAfterCredit([...before.sort(byDay), ...month.sort(byDay)], cents(c.expenseCreditCents));
}

/**
 * What one amount pays on a customer's bill: `parts` are the charges paid,
 * in order, one per car or activity (a car's two items are one part); `full`
 * when the part pays everything that charge owed. `leftCents` is what the
 * whole bill still owes afterwards. Refused: `reason` set, `parts` empty.
 */
export function billPaymentPlan(customer: BillPaymentCustomer | null | undefined, amountCents: number): BillPaymentPlan {
  const items = billPaymentItems(customer);
  const payableCents = items.reduce((s, x) => s + x.amountCents, 0);
  const dueCents = cents(customer?.dueCents);
  const amount = Math.round(Number(amountCents) || 0);
  const refuse = (reason: BillPaymentRefusal): BillPaymentPlan => ({ ok: false, reason, payableCents, parts: [], leftCents: dueCents });
  if (payableCents <= 0) return refuse(BILL_PAYMENT_REFUSAL.NOTHING_TO_PAY);
  if (!(amount > 0)) return refuse(BILL_PAYMENT_REFUSAL.NO_AMOUNT);
  if (amount > payableCents) return refuse(BILL_PAYMENT_REFUSAL.MORE_THAN_OWED);
  const owed = new Map<string, number>();
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    owed.set(key, (owed.get(key) || 0) + item.amountCents);
  }
  const parts: Omit<BillPaymentPart, "full">[] = [];
  const index = new Map<string, number>();
  let left = amount;
  for (const item of items) {
    if (left <= 0) break;
    const take = Math.min(left, item.amountCents);
    left -= take;
    const key = `${item.kind}:${item.id}`;
    const at = index.get(key);
    if (at !== undefined) {
      parts[at].amountCents += take;
    } else {
      index.set(key, parts.length);
      parts.push({ kind: item.kind, id: item.id, label: item.label, trackingCode: item.trackingCode, amountCents: take });
    }
  }
  return {
    ok: true,
    reason: "",
    payableCents,
    parts: parts.map((p) => ({ ...p, full: p.amountCents >= (owed.get(`${p.kind}:${p.id}`) ?? 0) })),
    leftCents: Math.max(0, dueCents - amount),
  };
}

/** "A", "A and B", "A, B and 2 more" (French "A et B", "A, B et 1 autre",
 * "A, B et 2 autres") - what a payment was for. No part: "parking". */
export function billPaymentFor(parts: readonly { label?: unknown }[] | null | undefined, language: "en" | "fr" = "en"): string {
  const names: string[] = [];
  for (const p of parts || []) {
    const name = text(p?.label, 80);
    if (name && !names.includes(name)) names.push(name);
  }
  const fr = language === "fr";
  if (names.length === 0) return fr ? "stationnement" : "parking";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} ${fr ? "et" : "and"} ${names[1]}`;
  const more = names.length - 2;
  return `${names[0]}, ${names[1]} ${fr ? "et" : "and"} ${more} ${fr ? (more === 1 ? "autre" : "autres") : "more"}`;
}

// ---------------------------------------------------------------------------
// The callable's requests (updateBusinessParkingEntry).
// ---------------------------------------------------------------------------

export type BillPaymentRecordInput = {
  businessId: string;
  monthKey: string;
  customerKey: string;
  amountCents: number;
  receivedVia: string;
  receivedByStaffId: string;
  note?: string;
  /** The preview's `payableCents`: the server refuses if the bill moved. */
  expectedPayableCents: number;
};

/** The `bill_payment_record` request. */
export function billPaymentRecordRequest(input: BillPaymentRecordInput) {
  return {
    action: "bill_payment_record" as const,
    businessId: input.businessId,
    monthKey: input.monthKey,
    customerKey: input.customerKey,
    amountCents: Math.round(Number(input.amountCents) || 0),
    receivedVia: input.receivedVia,
    receivedByStaffId: input.receivedByStaffId,
    note: text(input.note, 300),
    expectedPayableCents: Math.round(Number(input.expectedPayableCents) || 0),
  };
}

/** The `bill_payment_undo` request. */
export function billPaymentUndoRequest(businessId: string, billPaymentId: string) {
  return { action: "bill_payment_undo" as const, businessId, billPaymentId };
}

/** A callable rejection in the console's words: `details.reason` when it is
 * one of ours, else permission-denied / unknown. Never the raw text. */
export function billPaymentRefusalText(error: unknown): string {
  const e = (error && typeof error === "object" ? error : {}) as Row;
  const details = (e.details && typeof e.details === "object" ? e.details : {}) as Row;
  const reason = text(details.reason, 80) as BillPaymentRefusal;
  if (Object.prototype.hasOwnProperty.call(BILL_PAYMENT_MESSAGES, reason)) return BILL_PAYMENT_MESSAGES[reason];
  if (/permission-denied$/.test(text(e.code, 80))) return BILL_PAYMENT_FALLBACK_MESSAGES.permission_denied;
  return BILL_PAYMENT_FALLBACK_MESSAGES.unknown;
}

// ---------------------------------------------------------------------------
// The month's recorded payments (`parkingBillPayments`).
// ---------------------------------------------------------------------------

export type BillPaymentRecord = {
  id: string;
  customerKey: string;
  amountCents: number;
  receivedVia: string;
  receivedByStaffId: string;
  note: string;
  parts: { label: string; amountCents: number; full: boolean }[];
  status: "recorded" | "undone";
  /** When it was recorded (ms), 0 when unknown. */
  atMs: number;
  /** When it was undone (ms); 0 while it stands. */
  undoneAtMs: number;
};

/** A stored payment in the shape the card shows. */
export function billPaymentRecord(row: Row): BillPaymentRecord {
  const parts = Array.isArray(row.parts) ? (row.parts as Row[]) : [];
  return {
    id: text(row.id, 128),
    customerKey: text(row.customerKey, 200),
    amountCents: cents(row.amountCents),
    receivedVia: text(row.receivedVia, 40),
    receivedByStaffId: text(row.receivedByStaffId, 128),
    note: text(row.note, 300),
    parts: parts.map((p) => ({ label: text(p?.label, 80), amountCents: cents(p?.amountCents), full: p?.full === true })),
    status: text(row.status, 20) === "undone" ? "undone" : "recorded",
    atMs: cents(row.atMs),
    undoneAtMs: cents(row.undoneAtMs),
  };
}

/** The month's payments grouped by customer, newest first within each. Built
 * once per data change; the card then just looks its customer up. */
export function billPaymentsByCustomer(rows: readonly Row[] | null | undefined): Map<string, BillPaymentRecord[]> {
  const out = new Map<string, BillPaymentRecord[]>();
  for (const row of rows || []) {
    const record = billPaymentRecord(row);
    if (!record.customerKey) continue;
    const list = out.get(record.customerKey);
    if (list) list.push(record);
    else out.set(record.customerKey, [record]);
  }
  for (const list of out.values()) list.sort((a, b) => b.atMs - a.atMs || a.id.localeCompare(b.id));
  return out;
}

/** One customer's payments from the month's list, newest first. */
export function billPaymentsForCustomer(rows: readonly Row[] | null | undefined, customerKey: string): BillPaymentRecord[] {
  return billPaymentsByCustomer(rows).get(customerKey) ?? [];
}

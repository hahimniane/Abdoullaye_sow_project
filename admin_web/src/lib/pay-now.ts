/**
 * Pay now on the web (docs/PACKAGE_BOX_SIZES_PAY_NOW.md section 3): the
 * optional card link on a package request, what the customer's request page
 * says about it, what the business sees (chip, Resend, Refund), the refund
 * form's checks, the settings switch, and the weekly payouts a business is
 * owed when Laawol collected for it.
 *
 * Pure: no React, no Firebase. The server decides everything that matters
 * (when a link exists, what a refund may be, who may pay out); this only says
 * what is wrong before sending and how a state reads. `pay-now.test.ts` runs
 * it. Words built from data (money, dates) are produced here in the page's
 * language and rendered `data-no-translate`; static strings live in the
 * components and french-dom.ts.
 */

import { moneyText as ledgerMoneyText } from "./invoice-ledger.ts";
import { readMoneyInput } from "./money-input.ts";

export type Lang = "en" | "fr";
type Row = Record<string, unknown>;

export type PayNowStatus = "open" | "paid" | "partly_refunded" | "refunded" | "cancelled";
export const PAY_NOW_STATUSES: readonly PayNowStatus[] = ["open", "paid", "partly_refunded", "refunded", "cancelled"];

const asRow = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {});
const text = (value: unknown, max = 200): string => String(value ?? "").trim().slice(0, max);
const wholeCents = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** The money text of the page's language ("$130.00" / "130,00 $"). */
export function money(cents: number, lang: Lang): string {
  return ledgerMoneyText(cents, lang);
}

/** A payment link only ever opens as https (never a script or data URL). */
export function safeLinkUrl(value: unknown): string {
  const raw = text(value, 500);
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// The customer's request page.
// ---------------------------------------------------------------------------

export type PublicPayNow = {
  status: PayNowStatus;
  amountCents: number;
  linkUrl: string;
  paidCents: number;
  refundedCents: number;
};

/** `getPackageRequestByToken`'s `payNow`, read defensively; null when there is none. */
export function publicPayNowOf(raw: unknown): PublicPayNow | null {
  const row = asRow(raw);
  const status = text(row.status, 20) as PayNowStatus;
  if (!PAY_NOW_STATUSES.includes(status)) return null;
  return {
    status,
    amountCents: wholeCents(row.amountCents),
    linkUrl: safeLinkUrl(row.linkUrl),
    paidCents: wholeCents(row.paidCents),
    refundedCents: wholeCents(row.refundedCents),
  };
}

export type CustomerPayView =
  | { kind: "none" }
  | { kind: "pay"; amountCents: number; linkUrl: string }
  | { kind: "paid"; paidCents: number; refundedCents: number; refunded: "none" | "part" | "all"; balanceCents: number };

/**
 * What the request page shows: an optional "Pay now $X" while the link is
 * open and the request is open; "Paid online $X" (with "Refunded $Y") once it
 * was paid; nothing for a cancelled link or a request that closed unpaid. A
 * total that rose after payment shows "Balance due at the counter".
 */
export function customerPayView(payNow: PublicPayNow | null, requestOpen: boolean, totalCents: number | null): CustomerPayView {
  if (!payNow) return { kind: "none" };
  if (payNow.status === "open") {
    return requestOpen && payNow.linkUrl && payNow.amountCents > 0 ? { kind: "pay", amountCents: payNow.amountCents, linkUrl: payNow.linkUrl } : { kind: "none" };
  }
  if (payNow.status === "cancelled") return { kind: "none" };
  const kept = Math.max(0, payNow.paidCents - payNow.refundedCents);
  const balance = requestOpen && totalCents !== null && totalCents > kept ? totalCents - kept : 0;
  const refunded = payNow.refundedCents <= 0 ? "none" : payNow.refundedCents >= payNow.paidCents ? "all" : "part";
  return { kind: "paid", paidCents: payNow.paidCents, refundedCents: payNow.refundedCents, refunded, balanceCents: payNow.refundedCents >= payNow.paidCents ? 0 : balance };
}

/** The sentence under "Paid online": "Paid online $130.00" and, once refunded, "Refunded $20.00". */
export function paidOnlineText(view: Extract<CustomerPayView, { kind: "paid" }>, lang: Lang): { paid: string; refunded: string } {
  const fr = lang === "fr";
  return {
    paid: fr ? `Payé en ligne ${money(view.paidCents, lang)}` : `Paid online ${money(view.paidCents, lang)}`,
    refunded: view.refundedCents > 0 ? (fr ? `Remboursé ${money(view.refundedCents, lang)}` : `Refunded ${money(view.refundedCents, lang)}`) : "",
  };
}

export function payNowButtonText(amountCents: number, lang: Lang): string {
  return lang === "fr" ? `Payer maintenant ${money(amountCents, lang)}` : `Pay now ${money(amountCents, lang)}`;
}

// ---------------------------------------------------------------------------
// The business's request.
// ---------------------------------------------------------------------------

export type PayNowRefund = { atMs: number; amountCents: number; byName: string; reason: string };

export type RequestPayNow = {
  status: PayNowStatus;
  amountCents: number;
  chargeType: "direct" | "platform" | "";
  paidCents: number;
  refundedCents: number;
  paidAtMs: number;
  linkUrl: string;
  refunds: PayNowRefund[];
  messages: number;
};

/** `packageRequests/{id}.payNow` as a console row carries it; null when no link was ever made. */
export function requestPayNowOf(row: unknown): RequestPayNow | null {
  const raw = asRow(asRow(row).payNow);
  const status = text(raw.status, 20) as PayNowStatus;
  if (!PAY_NOW_STATUSES.includes(status)) return null;
  const charge = text(raw.chargeType, 20);
  return {
    status,
    amountCents: wholeCents(raw.amountCents),
    chargeType: charge === "direct" || charge === "platform" ? charge : "",
    paidCents: wholeCents(raw.paidCents),
    refundedCents: wholeCents(raw.refundedCents),
    paidAtMs: Number(raw.paidAtMs) > 0 ? Number(raw.paidAtMs) : 0,
    linkUrl: safeLinkUrl(raw.linkUrl),
    refunds: (Array.isArray(raw.refunds) ? raw.refunds : []).map((entry) => {
      const refund = asRow(entry);
      return { atMs: Number(refund.atMs) > 0 ? Number(refund.atMs) : 0, amountCents: wholeCents(refund.amountCents), byName: text(refund.byName, 80), reason: text(refund.reason, 300) };
    }),
    messages: Array.isArray(raw.messages) ? raw.messages.length : 0,
  };
}

export type PayChip = { tone: "link" | "paid" | "refund" | "muted"; text: string };

/** The chip on a request: "Link sent", "Paid online $130.00", "Refunded $20.00", "Link cancelled". */
export function payChip(payNow: RequestPayNow | null, lang: Lang): PayChip | null {
  if (!payNow) return null;
  const fr = lang === "fr";
  switch (payNow.status) {
    case "open":
      return { tone: "link", text: fr ? `Lien envoyé ${money(payNow.amountCents, lang)}` : `Link sent ${money(payNow.amountCents, lang)}` };
    case "paid":
      return { tone: "paid", text: fr ? `Payé en ligne ${money(payNow.paidCents, lang)}` : `Paid online ${money(payNow.paidCents, lang)}` };
    case "partly_refunded":
      return { tone: "refund", text: fr ? `Payé en ligne ${money(payNow.paidCents, lang)} · remboursé ${money(payNow.refundedCents, lang)}` : `Paid online ${money(payNow.paidCents, lang)} · refunded ${money(payNow.refundedCents, lang)}` };
    case "refunded":
      return { tone: "refund", text: fr ? `Remboursé ${money(payNow.refundedCents || payNow.paidCents, lang)}` : `Refunded ${money(payNow.refundedCents || payNow.paidCents, lang)}` };
    default:
      return { tone: "muted", text: fr ? "Lien annulé" : "Link cancelled" };
  }
}

/** The most that can still be refunded. */
export function refundableCents(payNow: RequestPayNow | null): number {
  if (!payNow || (payNow.status !== "paid" && payNow.status !== "partly_refunded")) return 0;
  return Math.max(0, payNow.paidCents - payNow.refundedCents);
}

/** Resend only while the link is open: a paid or cancelled link has nothing to resend. */
export function canResend(payNow: RequestPayNow | null): boolean {
  return payNow?.status === "open" && payNow.linkUrl !== "";
}

/**
 * Who is offered Refund: the business owner, an admin, or staff holding the
 * void permission. The server decides again (`not_allowed`).
 */
export function mayRefund(viewer: { role?: unknown; businessPermissions?: unknown }): boolean {
  if (viewer.role === "businessOwner" || viewer.role === "admin") return true;
  // Same rule as the server (package_pay_now_handlers.js): staff need both
  // Shipping (containers) and Ledger.
  return viewer.role === "staff" && Array.isArray(viewer.businessPermissions) &&
    viewer.businessPermissions.includes("containers") && viewer.businessPermissions.includes("ledger");
}

export const REFUND_REASON_MAX = 300;

/**
 * The refund form: dollars as typed, up to what is left, and a reason. The
 * server's codes: refund_invalid (not an amount), refund_too_much, and
 * reason_required.
 */
export function refundProblems(input: { amount: string; reason: string; refundableCents: number }): { cents: number | null; problems: string[] } {
  const problems: string[] = [];
  const cents = readMoneyInput(input.amount).cents;
  if (cents === null || cents <= 0) problems.push("refund_invalid");
  else if (cents > input.refundableCents) problems.push("refund_too_much");
  if (!input.reason.trim()) problems.push("reason_required");
  if (input.reason.trim().length > REFUND_REASON_MAX) problems.push("text_too_long");
  return { cents: problems.length ? null : cents, problems };
}

export function refundPayload(businessId: string, requestId: string, amountCents: number, reason: string) {
  return { action: "pay_refund" as const, businessId, requestId, amountCents, reason: reason.trim() };
}

export function resendPayload(businessId: string, requestId: string) {
  return { action: "pay_resend" as const, businessId, requestId };
}

export const PAY_NOW_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  pay_not_paid: "This request was not paid online.",
  refund_too_much: "That is more than is left to refund.",
  refund_invalid: "Enter an amount to refund.",
  not_allowed: "Only the owner, an admin or staff who can void may do this.",
  reason_required: "Give a reason.",
  text_too_long: "The reason is too long.",
});

// ---------------------------------------------------------------------------
// The settings switch.
// ---------------------------------------------------------------------------

/** "Pay now" is on when `payNow` says so, else what the old card switch said. */
export function payNowOn(settings: unknown): boolean {
  const row = asRow(settings);
  return typeof row.payNow === "boolean" ? row.payNow : row.cardBarrelBooking === true;
}

/** Whether a charge would go straight to the business (Stripe connected, payouts enabled) or through Laawol. */
export function chargeTypeFor(business: unknown): "direct" | "platform" {
  const row = asRow(business);
  return text(row.stripeAccountId, 80) !== "" && row.payoutsEnabled === true ? "direct" : "platform";
}

// ---------------------------------------------------------------------------
// Weekly payouts (Laawol collected for a business without Stripe).
// ---------------------------------------------------------------------------

export const PAYOUT_METHODS = ["zelle", "bank", "other"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
export type PayoutStatus = "open" | "due" | "paid" | "nothing";
export type LedgerType = "payment" | "stripe_fee" | "refund" | "chargeback" | "dispute_fee" | "bill_offset" | "payout" | "to_bill";

export type PayoutLine = { id: string; type: LedgerType | ""; requestId: string; requestCode: string; amountCents: number; atMs: number; note: string };

export type PayoutWeek = {
  businessId: string;
  businessName: string;
  /** The Monday of the week, "YYYY-MM-DD" (America/New_York). */
  weekKey: string;
  collectedCents: number;
  feesCents: number;
  refundsCents: number;
  chargebacksCents: number;
  billOffsetCents: number;
  /** What Laawol owes the business for the week; negative goes onto the Laawol bill. */
  netCents: number;
  status: PayoutStatus;
  paidAtMs: number;
  paidByName: string;
  method: PayoutMethod | "";
  reference: string;
  lines: PayoutLine[];
};

const LEDGER_TYPES: readonly string[] = ["payment", "stripe_fee", "refund", "chargeback", "dispute_fee", "bill_offset", "payout", "to_bill"];
const signed = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) ? n : 0;
};

export function payoutWeeksOf(raw: unknown): { weeks: PayoutWeek[]; unpaidBillCents: number } {
  const row = asRow(raw);
  const weeks = (Array.isArray(row.weeks) ? row.weeks : [])
    .map((entry): PayoutWeek | null => {
      const week = asRow(entry);
      const weekKey = text(week.weekKey, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) return null;
      const status = text(week.status, 10) as PayoutStatus;
      const method = text(week.method, 10);
      return {
        businessId: text(week.businessId, 80),
        businessName: text(week.businessName, 120),
        weekKey,
        collectedCents: signed(week.collectedCents),
        feesCents: signed(week.feesCents),
        refundsCents: signed(week.refundsCents),
        chargebacksCents: signed(week.chargebacksCents),
        billOffsetCents: signed(week.billOffsetCents),
        netCents: signed(week.netCents),
        status: (["open", "due", "paid", "nothing"] as string[]).includes(status) ? status : "open",
        paidAtMs: Number(week.paidAtMs) > 0 ? Number(week.paidAtMs) : 0,
        paidByName: text(week.paidByName, 80),
        method: (PAYOUT_METHODS as readonly string[]).includes(method) ? (method as PayoutMethod) : "",
        reference: text(week.reference, 120),
        lines: (Array.isArray(week.lines) ? week.lines : []).map((l, index) => {
          const line = asRow(l);
          const type = text(line.type, 20);
          return {
            id: text(line.id, 80) || `${weekKey}-${index}`,
            type: LEDGER_TYPES.includes(type) ? (type as LedgerType) : "",
            requestId: text(line.requestId, 80),
            requestCode: text(line.requestCode, 20),
            amountCents: signed(line.amountCents),
            atMs: Number(line.atMs) > 0 ? Number(line.atMs) : 0,
            note: text(line.note, 300),
          };
        }),
      };
    })
    .filter((week): week is PayoutWeek => week !== null)
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey) || a.businessName.localeCompare(b.businessName));
  return { weeks, unpaidBillCents: Math.max(0, signed(row.unpaidBillCents)) };
}

/** The Monday after the week (when it is paid out): "YYYY-MM-DD". */
export function payoutDay(weekKey: string): string {
  const [y, m, d] = weekKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + 7 * 86_400_000).toISOString().slice(0, 10);
}

/** "Zelle" / "Bank" / "Other" (French "Virement" / "Autre"). */
export function methodLabel(method: string, lang: Lang): string {
  if (method === "zelle") return "Zelle";
  if (method === "bank") return lang === "fr" ? "Virement" : "Bank";
  return lang === "fr" ? "Autre" : "Other";
}

/** "Paid out" / "Versé", the word that opens a paid week's status. */
export function paidOutWord(lang: Lang): string {
  return lang === "fr" ? "Versé" : "Paid out";
}

export const LEDGER_LABELS: Record<LedgerType, { en: string; fr: string }> = {
  payment: { en: "Card payment", fr: "Paiement par carte" },
  stripe_fee: { en: "Card fee", fr: "Frais de carte" },
  refund: { en: "Refund", fr: "Remboursement" },
  chargeback: { en: "Chargeback", fr: "Contestation" },
  dispute_fee: { en: "Dispute fee", fr: "Frais de litige" },
  bill_offset: { en: "Taken off for your Laawol bill", fr: "Retiré pour votre facture Laawol" },
  payout: { en: "Paid out", fr: "Versé" },
  to_bill: { en: "Put on your Laawol bill", fr: "Porté sur votre facture Laawol" },
};

export function ledgerLabel(type: LedgerType | "", lang: Lang): string {
  return type ? LEDGER_LABELS[type][lang === "fr" ? "fr" : "en"] : "";
}

/** The weeks that need a Laawol admin: due (not paid out yet), most recent first. */
export function dueWeeks(weeks: readonly PayoutWeek[]): PayoutWeek[] {
  return weeks.filter((week) => week.status === "due");
}

/** The paid-out form: a method and a reference (a Zelle or bank confirmation). A week that nets to nothing or less goes onto the bill and needs neither. */
export function payoutProblems(input: { method: string; reference: string; netCents: number }): string[] {
  if (input.netCents <= 0) return [];
  const problems: string[] = [];
  if (!(PAYOUT_METHODS as readonly string[]).includes(input.method)) problems.push("payout_method_invalid");
  if (input.reference.trim().length > 120) problems.push("text_too_long");
  return problems;
}

export function payoutsPayload(businessId?: string) {
  return { action: "payouts" as const, ...(businessId ? { businessId } : {}) };
}

export function payoutPaidPayload(week: Pick<PayoutWeek, "businessId" | "weekKey" | "netCents">, method: string, reference: string) {
  return {
    action: "payout_paid" as const,
    businessId: week.businessId,
    weekKey: week.weekKey,
    method: week.netCents > 0 ? method : "other",
    reference: week.netCents > 0 ? reference.trim() : "",
  };
}

export const PAYOUT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  payout_method_invalid: "Choose how you paid.",
  text_too_long: "The reference is too long.",
});

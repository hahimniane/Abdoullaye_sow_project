/**
 * "Check bank" any time, console side (docs/ZELLE_BANK_CHECK.md, "Check bank
 * any time"). Staff type the exact amount a customer says they sent by Zelle
 * and when, and see whether it reached the business's bank - before anything
 * is recorded. A received deposit can then be used for a sale (or a credit
 * or package payment) of exactly that amount. The owner sees the month's
 * usage and sets the monthly limit of paid bank refreshes.
 *
 * The callables are the authority (`checkZellePayment` mode "standalone",
 * `confirmZelleCandidate` modes "records" / "use", `getBusinessBankStatus`,
 * `setBankCheckWindow {refreshLimit}`); this module is the pure half: who
 * sees the button, the requests, reading the answers, and the words.
 * Refusals read through zelle-check.ts `zelleFailureMessage`.
 * No Firebase, no React: `bank-check.test.ts`.
 */

import { dollarsToCents } from "./lot-ledger.ts";
import { AUTO_RECHECK_TEXT, asRow, cents, msOrNull, str, type BankStatus, type ZelleKind } from "./zelle-check.ts";

// ---- Who sees "Check bank" -------------------------------------------------

/**
 * The server's rule (`bankCheckerFor`): staff who can sell (the inventory
 * permission with the inventory service on) or take package payments (the
 * containers permission), and the owner.
 */
export function canCheckBank(input: {
  isOwner: boolean;
  inventoryPermission: boolean;
  inventoryService: boolean;
  containersPermission: boolean;
}): boolean {
  return input.isOwner || (input.inventoryPermission && input.inventoryService) || input.containersPermission;
}

export type CheckBankEntry = "button" | "connect_hint" | "reconnect_hint" | "none";

/**
 * What the console header shows: the button only for a connected, active
 * bank and someone who can check; the owner gets a hint to the bank card
 * otherwise; staff see nothing while the bank is not usable.
 */
export function checkBankEntry(status: Pick<BankStatus, "connected" | "status"> | null, canCheck: boolean, isOwner: boolean): CheckBankEntry {
  if (!status) return "none";
  if (status.connected && status.status === "active") return canCheck ? "button" : "none";
  if (!isOwner) return "none";
  return status.status === "needs_reauth" ? "reconnect_hint" : "connect_hint";
}

// ---- The standalone check --------------------------------------------------

export type BankSince = "15m" | "1h" | "today";

export const BANK_SINCE_OPTIONS: ReadonlyArray<{ value: BankSince; label: string }> = [
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "today", label: "Today" },
];

export const DEFAULT_SINCE: BankSince = "15m";

/** The server's own bound for a checked amount (bank_check.js MAX_CHECK_CENTS). */
export const MAX_CHECK_CENTS = 100_000_000;

export const AMOUNT_MESSAGE = "Enter the exact amount that was sent.";

/** The amount typed, in whole cents ("40", "40.00", "40,50"), or the sentence to show. */
export function readCheckAmount(input: string): { cents: number; error: "" } | { cents: null; error: string } {
  const value = dollarsToCents(input);
  if (value === null || !Number.isInteger(value) || value < 1 || value > MAX_CHECK_CENTS) {
    return { cents: null, error: AMOUNT_MESSAGE };
  }
  return { cents: value, error: "" };
}

/** `checkZellePayment` standalone. `auto` only on the screen's automatic re-checks. */
export function standaloneCheckRequest(businessId: string, amountCents: number, since: BankSince, auto = false) {
  return {
    businessId: str(businessId),
    mode: "standalone" as const,
    amountCents,
    since,
    ...(auto ? { auto: true as const } : {}),
  };
}

export type BankDeposit = {
  creditId: string;
  amountCents: number;
  /** Epoch ms; for a date-only deposit, noon UTC of its date (show the date). */
  atMs: number | null;
  timeKnown: boolean;
  /** As the bank shows it - user data, never translated. */
  senderName: string;
  pending: boolean;
};

export type StandaloneResult = "received" | "several" | "not_found";

export type StandaloneAnswer = {
  result: StandaloneResult;
  deposits: BankDeposit[];
  since: BankSince;
  fromMs: number | null;
  limitReached: boolean;
};

function sinceOf(value: unknown): BankSince {
  return value === "1h" || value === "today" ? value : "15m";
}

/** The standalone answer, read defensively: the result always agrees with the deposits listed. */
export function readStandaloneAnswer(data: unknown): StandaloneAnswer {
  const r = asRow(data);
  const deposits = (Array.isArray(r.deposits) ? r.deposits : [])
    .map((raw) => {
      const d = asRow(raw);
      return {
        creditId: str(d.creditId, 300),
        amountCents: cents(d.amountCents),
        atMs: msOrNull(d.atMs),
        timeKnown: d.timeKnown !== false,
        senderName: str(d.senderName, 80),
        pending: d.pending === true,
      };
    })
    .filter((d) => d.creditId);
  const result: StandaloneResult = deposits.length === 0 ? "not_found" : deposits.length === 1 ? "received" : "several";
  return { result, deposits, since: sinceOf(r.since), fromMs: msOrNull(r.fromMs), limitReached: r.limitReached === true };
}

export const STANDALONE_TEXT = {
  received: "Deposit received",
  several: "Several deposits of this amount arrived. Ask the customer which one is theirs:",
  notYet: "Not yet",
  notYetDetail: "No deposit of this amount has arrived in that time yet. Ask the customer to wait a minute, then check again.",
  limitReached: "This month's limit of paid bank refreshes is reached, so new deposits may take longer to show.",
  autoRecheck: AUTO_RECHECK_TEXT,
} as const;

// ---- Use for a sale --------------------------------------------------------

export type UseRecord = {
  kind: ZelleKind;
  id: string;
  amountCents: number;
  atMs: number | null;
  /** The business's own words (customer name): never translated. */
  who: string;
  /** Items or tracking code: never translated. */
  what: string;
};

export const RECORD_KIND_LABELS: Record<ZelleKind, string> = {
  inventory_sale: "Sale",
  inventory_credit_payment: "Credit payment",
  container_line_payment: "Package payment",
};

const KINDS = new Set<string>(Object.keys(RECORD_KIND_LABELS));

/** `confirmZelleCandidate` records: the recent ones (no query), or a search. */
export function useRecordsRequest(businessId: string, creditId: string, query = "") {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 80);
  return { businessId: str(businessId), mode: "records" as const, creditId: str(creditId, 300), ...(q ? { query: q } : {}) };
}

export function readUseRecords(data: unknown): { records: UseRecord[]; searched: boolean } {
  const r = asRow(data);
  const records = (Array.isArray(r.records) ? r.records : [])
    .map((raw) => {
      const row = asRow(raw);
      return {
        kind: String(row.kind) as ZelleKind,
        id: str(row.id, 300),
        amountCents: cents(row.amountCents),
        atMs: msOrNull(row.atMs),
        who: str(row.who, 80),
        what: str(row.what, 80),
      };
    })
    .filter((row) => row.id && KINDS.has(row.kind));
  return { records, searched: r.searched === true };
}

/** `confirmZelleCandidate` use: spends the deposit on that record. */
export function useDepositRequest(businessId: string, creditId: string, kind: ZelleKind, id: string) {
  return { businessId: str(businessId), mode: "use" as const, creditId: str(creditId, 300), kind, id: str(id, 300) };
}

export const USE_TEXT = {
  recent: "Recent payments of this amount",
  searched: "Search results",
  none: "No sale or payment of exactly this amount is waiting. Record the sale as Zelle first, or search for it.",
  noMatch: "Nothing of this amount matches that search.",
  confirmed: "Used for this payment. It now shows as Zelle confirmed.",
  already: "That payment was already confirmed by the bank.",
} as const;

// ---- Usage and the monthly limit (owner) ------------------------------------

export const DEFAULT_REFRESH_LIMIT = 100;
export const MAX_REFRESH_LIMIT = 1000;
export const TEAM_MEMBER = "Team member";

export type BankUsageStaff = { uid: string; name: string; checks: number; refreshes: number };

export type BankUsage = {
  month: string;
  checks: number;
  refreshes: number;
  refreshesFailed: number;
  estimatedCostCents: number;
  refreshLimit: number;
  limitReached: boolean;
  byStaff: BankUsageStaff[];
};

function limitOf(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_REFRESH_LIMIT && value !== null && value !== "" ? n : null;
}

/** The month's usage (owner status answer, or a bill's `bankUsage`), or null when the answer has none. */
export function readBankUsage(raw: unknown): BankUsage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = asRow(raw);
  const byStaff = (Array.isArray(r.byStaff) ? r.byStaff : [])
    .map((entry) => {
      const s = asRow(entry);
      return { uid: str(s.uid, 200), name: str(s.name, 80), checks: cents(s.checks), refreshes: cents(s.refreshes) };
    })
    .filter((s) => s.uid && (s.checks > 0 || s.refreshes > 0));
  const refreshes = cents(r.refreshes);
  const refreshLimit = limitOf(r.refreshLimit) ?? DEFAULT_REFRESH_LIMIT;
  return {
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(str(r.month, 7)) ? str(r.month, 7) : "",
    checks: cents(r.checks),
    refreshes,
    refreshesFailed: cents(r.refreshesFailed),
    estimatedCostCents: cents(r.estimatedCostCents),
    refreshLimit,
    limitReached: r.limitReached === true || refreshes >= refreshLimit,
    byStaff,
  };
}

/** The owner's `getBusinessBankStatus` extras: the limit and the month's usage. */
export function readOwnerBankExtras(data: unknown): { refreshLimit: number; usage: BankUsage | null } {
  const r = asRow(data);
  return { refreshLimit: limitOf(r.refreshLimit) ?? DEFAULT_REFRESH_LIMIT, usage: readBankUsage(r.usage) };
}

/** A staff member's name, or "" when the profile has none (the screen says TEAM_MEMBER). Never a uid. */
export function staffName(entry: Pick<BankUsageStaff, "name">): string {
  return entry.name.trim();
}

export const LIMIT_MESSAGE = "Enter a whole number from 0 to 1000.";

/** The limit typed, or the sentence to show. */
export function readRefreshLimit(input: string): { limit: number; error: "" } | { limit: null; error: string } {
  const value = String(input ?? "").trim();
  if (!/^\d{1,4}$/.test(value)) return { limit: null, error: LIMIT_MESSAGE };
  const n = Number(value);
  return n <= MAX_REFRESH_LIMIT ? { limit: n, error: "" } : { limit: null, error: LIMIT_MESSAGE };
}

export function setRefreshLimitRequest(businessId: string, refreshLimit: number) {
  return { businessId: str(businessId), refreshLimit };
}

export const USAGE_TEXT = {
  title: "This month",
  checks: "Checks",
  refreshes: "Paid refreshes",
  cost: "Estimated cost",
  byStaff: "By team member",
  none: "No bank checks this month yet.",
  limitReached: "This month's limit is reached: checks still work, but new deposits can take longer to show.",
  limitLabel: "Monthly limit of paid refreshes",
  limitHelp:
    "Each check may ask the bank for new deposits, which costs about $0.12. Past this many a month, checks still work but only read what the bank already sent, so new deposits can take longer to show. 0 means never pay for a refresh.",
  limitSaved: "Monthly limit saved.",
} as const;

/**
 * Zelle bank check, console side (docs/ZELLE_BANK_CHECK.md). The owner
 * connects the business's own bank (read-only, Plaid); anyone who can see a
 * payment recorded as Zelle can ask the server whether a deposit of exactly
 * that amount arrived. The callables are the authority
 * (`checkZellePayment`, `confirmZelleCandidate`, `getBusinessBankStatus`,
 * `createBankLinkToken`, `connectBusinessBank`, `setBankCheckWindow`,
 * `disconnectBusinessBank`); this module is the pure half: reading their
 * answers and a record's `bankCheck`, the requests, and the sentences.
 * No Firebase, no React: `zelle-check.test.ts`.
 */

type Row = Record<string, unknown>;

/** Shared readers (bank-check.ts uses them too). */
export function asRow(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

export function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function cents(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function msOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const row = asRow(value);
  if (typeof row.toMillis === "function") return (row.toMillis as () => number)();
  return null;
}

/** Plaid Link for the web, loaded only when the owner presses Connect. */
export const PLAID_LINK_SCRIPT_URL = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

export type ZelleKind = "inventory_sale" | "inventory_credit_payment" | "container_line_payment";

export type ZelleConfirmation = {
  amountCents: number;
  /** Epoch ms; for a date-only deposit, noon UTC of its date (show the date). */
  atMs: number | null;
  /** False when the bank gave a date but no time. */
  timeKnown: boolean;
  /** As the bank shows it - user data, never translated. */
  senderName: string;
  institutionName: string;
};

export type ZelleCandidate = {
  creditId: string;
  atMs: number | null;
  timeKnown: boolean;
  senderName: string;
  pending: boolean;
};

export type BankCheck =
  | ({ status: "confirmed"; creditId: string; checkedByUid: string } & ZelleConfirmation)
  | { status: "not_found"; checkedByUid: string };

function confirmationOf(raw: unknown): ZelleConfirmation {
  const r = asRow(raw);
  return {
    amountCents: cents(r.amountCents),
    atMs: msOrNull(r.atMs),
    timeKnown: r.timeKnown !== false,
    senderName: str(r.senderName, 80),
    institutionName: str(r.institutionName, 120),
  };
}

/** A record's `bankCheck` (server-written), or null when it has none. */
export function bankCheckFrom(raw: unknown): BankCheck | null {
  const r = asRow(raw);
  if (r.status === "confirmed") {
    return { status: "confirmed", creditId: str(r.creditId, 300), checkedByUid: str(r.checkedByUid), ...confirmationOf(r) };
  }
  if (r.status === "not_found") return { status: "not_found", checkedByUid: str(r.checkedByUid) };
  return null;
}

export function confirmationFromBankCheck(check: BankCheck | null): ZelleConfirmation | null {
  if (!check || check.status !== "confirmed") return null;
  return {
    amountCents: check.amountCents,
    atMs: check.atMs,
    timeKnown: check.timeKnown,
    senderName: check.senderName,
    institutionName: check.institutionName,
  };
}

/** Only money recorded as Zelle that still stands can be checked. */
export function zelleCheckable(payment: { method: string; amountCents: number; voided: boolean }): boolean {
  return payment.method === "zelle" && payment.amountCents > 0 && !payment.voided;
}

/**
 * `checkZellePayment` for a record. `auto` marks the screen's automatic
 * re-checks (every 20 s for 3 minutes after "not found yet"): the server
 * does not count them as a check a person started. A click sends none.
 */
export function checkZelleRequest(businessId: string, kind: ZelleKind, id: string, auto = false) {
  return { businessId: str(businessId), kind, id: str(id, 300), ...(auto ? { auto: true as const } : {}) };
}

export function confirmZelleCandidateRequest(businessId: string, kind: ZelleKind, id: string, creditId: string) {
  return { businessId: str(businessId), kind, id: str(id, 300), creditId: str(creditId, 300) };
}

/** After "not found yet", the screens check again on their own every 20 s for 3 minutes (free syncs, `auto: true`). */
export const RECHECK_INTERVAL_MS = 20_000;
export const RECHECK_WINDOW_MS = 3 * 60_000;
export const AUTO_RECHECK_TEXT = "Checking again on its own every 20 seconds for 3 minutes.";

/**
 * How long until the next automatic re-check of a run that started at
 * `startedAtMs` (re-checks fall at 20 s, 40 s, … 180 s after it), or null
 * once the 3 minutes are over.
 */
export function nextRecheckInMs(startedAtMs: number, nowMs: number): number | null {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return null;
  const elapsed = Math.max(0, nowMs - startedAtMs);
  const step = Math.floor(elapsed / RECHECK_INTERVAL_MS) + 1;
  const at = step * RECHECK_INTERVAL_MS;
  return at > RECHECK_WINDOW_MS ? null : at - elapsed;
}

export type ZelleCheckResult = "confirmed" | "already_confirmed" | "not_found" | "choose";

export type ZelleCheckAnswer = {
  result: ZelleCheckResult;
  confirmation: ZelleConfirmation | null;
  candidates: ZelleCandidate[];
};

/** `checkZellePayment` / `confirmZelleCandidate` answers, read defensively. */
export function readZelleCheckAnswer(data: unknown): ZelleCheckAnswer {
  const r = asRow(data);
  const result: ZelleCheckResult = r.result === "confirmed" || r.result === "already_confirmed" || r.result === "choose"
    ? r.result
    : "not_found";
  const candidates = (Array.isArray(r.candidates) ? r.candidates : [])
    .map((raw) => {
      const c = asRow(raw);
      return {
        creditId: str(c.creditId, 300),
        atMs: msOrNull(c.atMs),
        timeKnown: c.timeKnown !== false,
        senderName: str(c.senderName, 80),
        pending: c.pending === true,
      };
    })
    .filter((c) => c.creditId);
  const confirmation = r.confirmation && typeof r.confirmation === "object" ? confirmationOf(r.confirmation) : null;
  // "choose" with nothing to choose from is nothing found.
  if (result === "choose" && candidates.length === 0) return { result: "not_found", confirmation: null, candidates: [] };
  return { result, confirmation: result === "confirmed" || result === "already_confirmed" ? confirmation : null, candidates };
}

/** The refusals, in words; French in french-dom.ts. */
export const ZELLE_MESSAGES: Record<string, string> = {
  bank_owner_required: "Only the business owner can manage the bank connection.",
  bank_access_denied: "This account cannot use the bank check for this business.",
  bank_not_connected: "No bank is connected for Zelle checks. Ask the owner to connect one.",
  bank_needs_reauth: "The bank needs the owner to sign in to it again.",
  not_zelle: "That payment was not recorded as Zelle.",
  record_not_found: "That payment could not be found.",
  record_voided: "That payment was voided or reverted.",
  kind_invalid: "That kind of payment cannot be checked.",
  window_invalid: "The check window must be between 2 and 60 minutes.",
  platform_invalid: "Say which app is connecting: ios, android or web.",
  public_token_required: "The bank sign-in did not finish. Try connecting again.",
  no_depository_account: "That bank login has no checking or savings account.",
  candidate_invalid: "That deposit does not match this payment.",
  candidate_taken: "That deposit already confirmed another payment.",
  bank_error: "The bank could not be reached. Try again.",
  store_not_allowed: "You can only check payments of your own store.",
  service_disabled: "Inventory is not switched on for this business.",
  permission_denied: "You do not have access to this payment.",
  offline: "The check did not reach Laawol. Check the connection and try again.",
  link_not_loaded: "The bank sign-in window could not open. Try again.",
  // Check bank any time (bank-check.ts).
  mode_invalid: "That kind of bank check is not known.",
  check_amount_invalid: "Enter the exact amount that was sent.",
  since_invalid: "Choose when it was sent: last 15 minutes, last hour or today.",
  limit_invalid: "The monthly limit must be a whole number from 0 to 1000.",
  amount_mismatch: "That payment is not for the same amount as the deposit.",
};

/** `bank_error` says more in `details.bankError`; the ones a person can act on. */
export const BANK_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "The bank is busy right now. Try again in a minute.",
  not_ready: "The bank's history is still being prepared. Try again in a few minutes.",
  link_expired: ZELLE_MESSAGES.bank_needs_reauth,
};

const GENERIC = "The bank check did not finish. Try again.";

/** A callable's rejection as the sentence the card or button shows. */
export function zelleFailureMessage(error: unknown): string {
  const e = asRow(error);
  const details = asRow(e.details);
  const reason = str(details.reason, 60);
  if (reason === "bank_error") {
    const bankError = str(details.bankError, 60);
    if (bankError in BANK_ERROR_MESSAGES) return BANK_ERROR_MESSAGES[bankError];
  }
  if (reason && reason in ZELLE_MESSAGES) return ZELLE_MESSAGES[reason];
  const code = str(e.code, 60).replace(/^functions\//, "");
  if (code === "permission-denied") return ZELLE_MESSAGES.permission_denied;
  if (code === "unavailable" || code === "deadline-exceeded") return ZELLE_MESSAGES.offline;
  return GENERIC;
}

export type BankLinkStatus = "active" | "needs_reauth" | "disconnected";

export type BankStatus = {
  connected: boolean;
  status: BankLinkStatus;
  windowMinutes: number;
  /** Owner only; "" for staff. */
  institutionName: string;
  accountMask: string;
  accountName: string;
  lastSyncAtMs: number | null;
};

export const DEFAULT_WINDOW_MINUTES = 15;

/** `getBusinessBankStatus`, read defensively. */
export function readBankStatus(data: unknown): BankStatus {
  const r = asRow(data);
  const status: BankLinkStatus = r.status === "active" || r.status === "needs_reauth" ? r.status : "disconnected";
  const minutes = Number(r.windowMinutes);
  return {
    connected: r.connected === true && status !== "disconnected",
    status,
    windowMinutes: Number.isInteger(minutes) && minutes >= 2 && minutes <= 60 ? minutes : DEFAULT_WINDOW_MINUTES,
    institutionName: str(r.institutionName, 120),
    accountMask: str(r.accountMask, 10),
    accountName: str(r.accountName, 120),
    lastSyncAtMs: msOrNull(r.lastSyncAt),
  };
}

export const BANK_STATUS_LABELS: Record<BankLinkStatus, string> = {
  active: "Connected",
  needs_reauth: "Sign in again",
  disconnected: "Not connected",
};

/** status-pill.ts tones (ok / warn / muted). */
export const BANK_STATUS_TONES: Record<BankLinkStatus, "ok" | "warn" | "muted"> = {
  active: "ok",
  needs_reauth: "warn",
  disconnected: "muted",
};

export const BANK_WINDOW_OPTIONS: readonly number[] = [2, 5, 10, 15, 20, 30, 45, 60];

/** The window choices, with the stored value folded in when it is not one of them. */
export function windowOptions(current: number): number[] {
  const list = [...BANK_WINDOW_OPTIONS];
  if (Number.isInteger(current) && current >= 2 && current <= 60 && !list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

/** "15 min" - the same in both languages. */
export function windowLabel(minutes: number): string {
  return `${minutes} min`;
}

export function bankLinkTokenRequest(businessId: string, lang: string) {
  return { businessId: str(businessId), platform: "web" as const, language: lang === "fr" ? "fr" : "en" };
}

/** `connectBusinessBank` from Plaid Link's onSuccess: the account the owner picked, if Link says. */
export function connectBankRequest(businessId: string, publicToken: string, metadata: unknown) {
  const m = asRow(metadata);
  const accounts = Array.isArray(m.accounts) ? m.accounts : [];
  const accountId = str(asRow(accounts[0]).id, 200) || str(asRow(m.account).id, 200) || str(m.account_id, 200);
  return { businessId: str(businessId), publicToken: str(publicToken, 500), ...(accountId ? { accountId } : {}) };
}

export function setBankWindowRequest(businessId: string, minutes: number) {
  return { businessId: str(businessId), minutes };
}

/** "Chase ••1234" - user data. */
export function bankAccountText(status: Pick<BankStatus, "institutionName" | "accountMask" | "accountName">): string {
  const name = status.institutionName || status.accountName;
  return status.accountMask ? `${name} ••${status.accountMask}`.trim() : name;
}

/** Who manages the bank in the business console: the owner (a platform admin works from the admin console). */
export function canManageBank(profile: { role?: unknown; businessId?: unknown } | null | undefined, businessId: string): boolean {
  return Boolean(profile && profile.role === "businessOwner" && profile.businessId === businessId && businessId);
}

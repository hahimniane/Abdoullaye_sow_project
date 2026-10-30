/**
 * The console's side of "Staff balances" (docs/STAFF_BALANCES.md): who holds
 * the business's money, who owes it and who is owed, the two-step hand-overs
 * between people, and the "Business account" receiver choice every "Received
 * by" picker gains. Pure: no Firebase, no React. The arithmetic itself runs
 * on the server (`updateLotExpenseEntry` action `staff_balances`); this file
 * reads its answer, builds the requests of the other actions, decides who may
 * do what, and words the refusals (French in french-dom.ts).
 */

import { photoPathPartsUnder, photoPathUnder } from "./package-proof.ts";
import { dollarsToCents, staffCreditRefusalText } from "./staff-expense-console.ts";
import { currentWebLanguage } from "./language.ts";

type Row = Record<string, unknown>;

const text = (value: unknown, max = 300) => String(value ?? "").trim().slice(0, max);
const cents = (value: unknown) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
};
const rowOf = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});

// ---------------------------------------------------------------------------
// The Business account: a receiver that is not a person.
// ---------------------------------------------------------------------------

/** The receiver value stored for money paid straight to the business (Zelle, transfer, card, payment links). */
export const BUSINESS_ACCOUNT_RECEIVER = "business_account";

/** The first option of every "Received by" picker. */
export const BUSINESS_ACCOUNT_LABEL = "Business account (Zelle, transfer, card)";

/** The Business account as a name in a sentence or a list, in the page's language. */
export function businessAccountName(lang: string = currentWebLanguage()): string {
  return lang === "fr" ? "Compte de l’entreprise" : "Business account";
}

/** The "Received by" choices: the Business account first, then the people. */
export function receiverChoices(
  staffOptions: readonly { id: string; name: string }[],
): { id: string; name: string; businessAccount: boolean }[] {
  return [
    { id: BUSINESS_ACCOUNT_RECEIVER, name: BUSINESS_ACCOUNT_LABEL, businessAccount: true },
    ...staffOptions.map((s) => ({ id: s.id, name: s.name, businessAccount: false })),
  ];
}

/** Whether a receiver value names the Business account. */
export const isBusinessAccount = (id: unknown) => text(id, 128) === BUSINESS_ACCOUNT_RECEIVER;

// ---------------------------------------------------------------------------
// The answer of `staff_balances`.
// ---------------------------------------------------------------------------

export type HandoverMethod = "cash" | "zelle" | "check" | "deposit" | "other";
export const HANDOVER_METHODS: readonly { value: HandoverMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle transfer" },
  { value: "check", label: "Paper check" },
  { value: "deposit", label: "Bank deposit" },
  { value: "other", label: "Another method" },
];

export type HandoverStatus = "pending" | "confirmed" | "declined" | "voided";
export type HandoverKind = "handover" | "opening";

/** A `staffHandovers` document as the console reads it (times in ms, 0 = none). */
export type Handover = {
  id: string;
  businessId: string;
  kind: HandoverKind;
  fromStaffId: string;
  toId: string;
  amountCents: number;
  method: string;
  note: string;
  proofPath: string;
  status: HandoverStatus;
  createdByUid: string;
  createdAtMs: number;
  confirmedAtMs: number;
  declinedAtMs: number;
  declineNote: string;
  voidedAtMs: number;
  voidReason: string;
};

export type StaffBalanceRow = {
  staffId: string;
  name: string;
  collectedCents: number;
  collectedByMethod: Record<string, number>;
  handedOutCents: number;
  receivedFromOthersCents: number;
  pendingOutCents: number;
  pendingInCents: number;
  heldCents: number;
  parkingDueCents: number;
  expenseCreditCents: number;
  expenseOwedToThemCents: number;
  /** held + parking owed - expenses owed to them: positive = owes the business. */
  netCents: number;
};

export type StaffBalancesAnswer = {
  asOfMs: number;
  staff: StaffBalanceRow[];
  businessAccount: { receivedCents: number; pendingInCents: number };
  pending: Handover[];
};

/** A Firestore Timestamp, `{seconds}` / `{_seconds}`, a Date or a number as ms; 0 when there is none. */
export function timeMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object") {
    const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
    if (typeof v._seconds === "number") return v._seconds * 1000;
  }
  if (typeof value === "string") {
    const n = new Date(value).getTime();
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

const STATUSES: readonly HandoverStatus[] = ["pending", "confirmed", "declined", "voided"];

/** One handover document (or the server's copy of one) read defensively. */
export function handoverFrom(value: unknown): Handover {
  const r = rowOf(value);
  const status = text(r.status, 20) as HandoverStatus;
  return {
    id: text(r.id, 200),
    businessId: text(r.businessId, 200),
    kind: text(r.kind, 20) === "opening" ? "opening" : "handover",
    fromStaffId: text(r.fromStaffId, 200),
    toId: text(r.toId, 200),
    amountCents: Math.max(0, cents(r.amountCents)),
    method: text(r.method, 20),
    note: text(r.note, 300),
    proofPath: text(r.proofPath, 300),
    status: STATUSES.includes(status) ? status : "pending",
    createdByUid: text(r.createdByUid, 200),
    createdAtMs: timeMs(r.createdAt ?? r.createdAtMs),
    confirmedAtMs: timeMs(r.confirmedAt ?? r.confirmedAtMs),
    declinedAtMs: timeMs(r.declinedAt ?? r.declinedAtMs),
    declineNote: text(r.declineNote, 300),
    voidedAtMs: timeMs(r.voidedAt ?? r.voidedAtMs),
    voidReason: text(r.voidReason, 300),
  };
}

function balanceRowFrom(value: unknown): StaffBalanceRow {
  const r = rowOf(value);
  const methods: Record<string, number> = {};
  for (const [key, amount] of Object.entries(rowOf(r.collectedByMethod))) {
    const c = cents(amount);
    if (c !== 0) methods[text(key, 40)] = c;
  }
  return {
    staffId: text(r.staffId, 200),
    name: text(r.name, 200),
    collectedCents: cents(r.collectedCents),
    collectedByMethod: methods,
    handedOutCents: cents(r.handedOutCents),
    receivedFromOthersCents: cents(r.receivedFromOthersCents),
    pendingOutCents: cents(r.pendingOutCents),
    pendingInCents: cents(r.pendingInCents),
    heldCents: cents(r.heldCents),
    parkingDueCents: cents(r.parkingDueCents),
    expenseCreditCents: cents(r.expenseCreditCents),
    expenseOwedToThemCents: cents(r.expenseOwedToThemCents),
    netCents: cents(r.netCents),
  };
}

/** The `staff_balances` answer, normalised (a missing or odd answer reads as "nobody"). */
export function staffBalancesFrom(data: unknown): StaffBalancesAnswer {
  const r = rowOf(data);
  const account = rowOf(r.businessAccount);
  return {
    asOfMs: timeMs(r.asOfMs),
    staff: (Array.isArray(r.staff) ? r.staff : []).map(balanceRowFrom).filter((s) => s.staffId),
    businessAccount: { receivedCents: cents(account.receivedCents), pendingInCents: cents(account.pendingInCents) },
    pending: (Array.isArray(r.pending) ? r.pending : []).map(handoverFrom).filter((h) => h.id),
  };
}

// ---------------------------------------------------------------------------
// The rows on screen.
// ---------------------------------------------------------------------------

export type NetTone = "owes" | "owed" | "even";

/** The Net column: positive = the person owes the business, negative = the business owes them. */
export function netPhrase(netCents: number): { tone: NetTone; label: string; cents: number } {
  const n = cents(netCents);
  if (n > 0) return { tone: "owes", label: "Owes the business", cents: n };
  if (n < 0) return { tone: "owed", label: "The business owes them", cents: -n };
  return { tone: "even", label: "Settled up", cents: 0 };
}

/** The people, those with money in play first (largest net either way), then by name. */
export function sortedBalanceRows(rows: readonly StaffBalanceRow[]): StaffBalanceRow[] {
  const size = (r: StaffBalanceRow) =>
    Math.abs(r.netCents) + r.heldCents + r.pendingInCents + r.pendingOutCents;
  return [...rows].sort((a, b) => size(b) - size(a) || a.name.localeCompare(b.name) || a.staffId.localeCompare(b.staffId));
}

/** The totals above the list. */
export function balanceTotals(rows: readonly StaffBalanceRow[]) {
  let held = 0;
  let owedToBusiness = 0;
  let owedToStaff = 0;
  for (const r of rows) {
    held += Math.max(0, r.heldCents);
    if (r.netCents > 0) owedToBusiness += r.netCents;
    else if (r.netCents < 0) owedToStaff += -r.netCents;
  }
  return { heldCents: held, owedToBusinessCents: owedToBusiness, owedToStaffCents: owedToStaff };
}

/** The breakdown drawer's lines: label (a dictionary key), cents, and whether to show it when zero. */
export function breakdownLines(row: StaffBalanceRow): { key: string; label: string; cents: number; always: boolean }[] {
  return [
    { key: "collected", label: "Payments collected", cents: row.collectedCents, always: true },
    { key: "handedOut", label: "Handed over (confirmed)", cents: -row.handedOutCents, always: true },
    { key: "received", label: "Received from others (confirmed)", cents: row.receivedFromOthersCents, always: true },
    { key: "held", label: "Money held now", cents: row.heldCents, always: true },
    { key: "parking", label: "Parking bill", cents: row.parkingDueCents, always: true },
    { key: "expenses", label: "Expenses owed to them", cents: -row.expenseOwedToThemCents, always: true },
    { key: "net", label: "Net", cents: row.netCents, always: true },
  ];
}

/** "Cash $120.00 · Zelle $40.00": the methods a person collected by, largest first. */
export function collectedByMethodLines(row: StaffBalanceRow): { method: string; label: string; cents: number }[] {
  return Object.entries(row.collectedByMethod)
    .map(([method, amount]) => ({ method, label: handoverMethodLabel(method), cents: amount }))
    .sort((a, b) => b.cents - a.cents || a.method.localeCompare(b.method));
}

/** A method code in the console's words. */
export function handoverMethodLabel(code: unknown): string {
  const method = text(code, 40);
  const known = HANDOVER_METHODS.find((m) => m.value === method);
  if (known) return known.label;
  // The payment methods the lot ledger and packages record.
  const extra: Record<string, string> = {
    direct: "Cash",
    card: "Card",
    online: "Online",
    stripe: "Online",
    link: "Payment link",
  };
  return extra[method] ?? "Another method";
}

// ---------------------------------------------------------------------------
// Who may do what.
// ---------------------------------------------------------------------------

/** The person looking: their uid, and whether they are the business owner (or a platform admin). */
export type BalancesViewer = { uid: string; isOwner: boolean };

/** The business owner or a platform admin: who confirms money for the Business account and sets opening amounts. */
export const isBalancesOwner = (role: unknown) => role === "businessOwner" || role === "admin";

/** Whether this pending hand-over waits on the viewer's Confirm / Decline. */
export function waitingOnViewer(h: Handover, viewer: BalancesViewer): boolean {
  if (h.status !== "pending" || !viewer.uid) return false;
  if (h.toId === BUSINESS_ACCOUNT_RECEIVER) return viewer.isOwner;
  return h.toId === viewer.uid;
}

/** The pending hand-overs waiting on the viewer, oldest first (the first asked is answered first). */
export function waitingOnViewerRows(rows: readonly Handover[], viewer: BalancesViewer): Handover[] {
  return rows
    .filter((h) => waitingOnViewer(h, viewer))
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
}

/** Void: the giver while it is pending; the owner any time (never deleted - it stays, marked void). */
export function canVoidHandover(h: Handover, viewer: BalancesViewer): boolean {
  if (!viewer.uid) return false;
  if (viewer.isOwner) return h.status === "pending" || h.status === "confirmed";
  return h.status === "pending" && (h.fromStaffId === viewer.uid || h.createdByUid === viewer.uid);
}

/** Live `staffHandovers` rows merged with the answer's pending ones (live wins; the answer fills what the live read missed). */
export function mergeHandovers(live: readonly Handover[], fromAnswer: readonly Handover[]): Handover[] {
  const byId = new Map<string, Handover>();
  for (const h of fromAnswer) byId.set(h.id, h);
  for (const h of live) byId.set(h.id, h);
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// History.
// ---------------------------------------------------------------------------

/** The moment a hand-over last changed (its answer, its void, else its creation). */
export function handoverLatestMs(h: Handover): number {
  return Math.max(h.createdAtMs, h.confirmedAtMs, h.declinedAtMs, h.voidedAtMs);
}

/** Newest first. */
export function handoverHistory(rows: readonly Handover[]): Handover[] {
  return [...rows].sort((a, b) => handoverLatestMs(b) - handoverLatestMs(a) || b.id.localeCompare(a.id));
}

export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  pending: "Waiting for confirmation",
  confirmed: "Confirmed",
  declined: "Declined",
  voided: "Voided",
};
export const HANDOVER_STATUS_TONES: Record<HandoverStatus, "warning" | "ok" | "danger" | "muted"> = {
  pending: "warning",
  confirmed: "ok",
  declined: "danger",
  voided: "muted",
};

/** The name shown for a hand-over's giver or receiver. */
export function handoverPartyName(
  id: string,
  names: ReadonlyMap<string, string>,
  lang: string = currentWebLanguage(),
): string {
  if (id === BUSINESS_ACCOUNT_RECEIVER) return businessAccountName(lang);
  return names.get(id) || (lang === "fr" ? "Ancien membre de l’équipe" : "Former team member");
}

// ---------------------------------------------------------------------------
// Requests (the `updateLotExpenseEntry` actions of docs/STAFF_BALANCES.md §3).
// ---------------------------------------------------------------------------

export const staffBalancesRequest = (businessId: string) => ({ action: "staff_balances", businessId });

export type HandoverDraft = {
  toId: string;
  amount: string;
  method: string;
  note: string;
  proofPath: string;
};

export const emptyHandoverDraft = (): HandoverDraft => ({ toId: "", amount: "", method: "cash", note: "", proofPath: "" });

export type HandoverRefusal =
  | "handover_to_self"
  | "handover_amount_invalid"
  | "handover_method_invalid"
  | "handover_receiver_invalid"
  | "handover_not_receiver"
  | "handover_not_pending"
  | "opening_owner_only";

/** The server's refusals in the console's words (French in french-dom.ts). */
export const STAFF_BALANCES_REFUSAL_COPY: Record<HandoverRefusal, string> = {
  handover_to_self: "You cannot hand money to yourself.",
  handover_amount_invalid: "Enter an amount greater than $0.",
  handover_method_invalid: "Choose how the money was handed over.",
  handover_receiver_invalid: "Choose who is receiving the money: a team member or the Business account.",
  handover_not_receiver: "Only the person this money was handed to can confirm or decline it. For the Business account, that is the business owner.",
  handover_not_pending: "This hand-over was already answered or voided. Refresh the page.",
  opening_owner_only: "Only the business owner can set an opening amount.",
};

/** What is wrong with a hand-over before it is sent, or "". `memberIds`: the people it may go to. */
export function handoverProblem(draft: HandoverDraft, fromId: string, memberIds: readonly string[]): string {
  const to = text(draft.toId, 200);
  if (!to) return STAFF_BALANCES_REFUSAL_COPY.handover_receiver_invalid;
  if (to === fromId) return STAFF_BALANCES_REFUSAL_COPY.handover_to_self;
  if (to !== BUSINESS_ACCOUNT_RECEIVER && !memberIds.includes(to)) return STAFF_BALANCES_REFUSAL_COPY.handover_receiver_invalid;
  const amount = dollarsToCents(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) return STAFF_BALANCES_REFUSAL_COPY.handover_amount_invalid;
  if (!HANDOVER_METHODS.some((m) => m.value === draft.method)) return STAFF_BALANCES_REFUSAL_COPY.handover_method_invalid;
  return "";
}

/** `record_handover`: the caller is the giver. */
export function recordHandoverRequest(businessId: string, draft: HandoverDraft) {
  const note = text(draft.note, 300);
  return {
    action: "record_handover",
    businessId,
    toId: text(draft.toId, 200),
    amountCents: dollarsToCents(draft.amount),
    method: draft.method,
    ...(note ? { note } : {}),
    ...(draft.proofPath ? { proofPath: draft.proofPath } : {}),
  };
}

export const confirmHandoverRequest = (businessId: string, handoverId: string) =>
  ({ action: "confirm_handover", businessId, handoverId });

export function declineHandoverRequest(businessId: string, handoverId: string, note = "") {
  const clean = text(note, 300);
  return { action: "decline_handover", businessId, handoverId, ...(clean ? { note: clean } : {}) };
}

export function voidHandoverRequest(businessId: string, handoverId: string, reason = "") {
  const clean = text(reason, 300);
  return { action: "void_handover", businessId, handoverId, ...(clean ? { reason: clean } : {}) };
}

export type OpeningDraft = { staffId: string; amount: string; note: string };

/** What is wrong with an opening amount before it is sent, or "". */
export function openingProblem(draft: OpeningDraft, memberIds: readonly string[]): string {
  if (!memberIds.includes(text(draft.staffId, 200))) return "Choose the team member.";
  const amount = dollarsToCents(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) return STAFF_BALANCES_REFUSAL_COPY.handover_amount_invalid;
  return "";
}

/** `record_opening`: owner/admin only, recorded and confirmed in one step. */
export function recordOpeningRequest(businessId: string, draft: OpeningDraft) {
  const note = text(draft.note, 300);
  return {
    action: "record_opening",
    businessId,
    staffId: text(draft.staffId, 200),
    amountCents: dollarsToCents(draft.amount),
    ...(note ? { note } : {}),
  };
}

/** A callable's rejection in the console's words: this feature's refusals, then the staff-expense ones, never the raw text. */
export function staffBalancesRefusalText(error: unknown): string {
  const e = rowOf(error);
  const details = rowOf(e.details);
  const reasons = Array.isArray(details.reasons) ? details.reasons.map((r) => text(r, 80)) : [];
  const candidates = [text(details.reason, 80), ...reasons, text(details.code, 80), text(e.message, 400)];
  const codes = Object.keys(STAFF_BALANCES_REFUSAL_COPY) as HandoverRefusal[];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const hit = codes.find((code) => candidate === code) ?? codes.find((code) => candidate.includes(code));
    if (hit) return STAFF_BALANCES_REFUSAL_COPY[hit];
  }
  return staffCreditRefusalText(error);
}

// ---------------------------------------------------------------------------
// Proof photos: staffHandoverProofs/{businessId}/{uid}/{fileId}.jpg
// ---------------------------------------------------------------------------

export const STAFF_HANDOVER_PROOF_ROOT = "staffHandoverProofs";

export const staffHandoverProofPath = (businessId: string, uid: string, fileId: string) =>
  photoPathUnder(STAFF_HANDOVER_PROOF_ROOT, businessId, uid, fileId);

/** Whether a stored proof path is one of ours (so a stray value is never fetched as a photo). */
export const isStaffHandoverProofPath = (path: string) => photoPathPartsUnder(STAFF_HANDOVER_PROOF_ROOT, path) !== null;

// ---------------------------------------------------------------------------
// The sidebar badge and Today row.
// ---------------------------------------------------------------------------

/** The Today row and the badge: how many hand-overs wait on the viewer, and their total. */
export function waitingOnYou(pending: readonly Handover[], viewer: BalancesViewer): { count: number; amountCents: number } {
  const mine = waitingOnViewerRows(pending, viewer);
  return { count: mine.length, amountCents: mine.reduce((sum, h) => sum + h.amountCents, 0) };
}

/** The filter of the one equality query the badge asks: this business's pending hand-overs. */
export const PENDING_HANDOVERS_WHERE: readonly [string, "==", string][] = [["status", "==", "pending"]];

/** How long the page waits for its answer before it says so (loading always resolves). */
export const STAFF_BALANCES_TIMEOUT_MS = 15000;

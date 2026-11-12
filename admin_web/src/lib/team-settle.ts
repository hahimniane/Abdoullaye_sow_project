// "I paid everything" (docs/TEAM_SETTLE.md): a team member settles their
// month at once. The server's team_settle.js is the rule; the shared fixture
// (functions/test/fixtures/team-settle-cases.json) pins both to the same
// answers. The amount and the split are frozen when it is filed; it counts
// once the receiver confirms.

type Row = Record<string, unknown>;

export const SETTLE_SCOPES = ["everything", "cash", "parking"] as const;
export type SettleScope = (typeof SETTLE_SCOPES)[number];

export const SETTLE_REFUSAL = {
  NO_AMOUNT: "team_settle_no_amount",
  MORE_THAN_OWED: "team_settle_more_than_owed",
  NOTHING_OWED: "team_settle_nothing_owed",
  SCOPE_INVALID: "team_settle_scope_invalid",
} as const;

export const SETTLE_MESSAGES: Record<string, string> = {
  team_settle_no_amount: "Enter how much was paid.",
  team_settle_more_than_owed: "That is more than this statement asks for. Pay what is owed, or pick what it is for.",
  team_settle_nothing_owed: "Nothing is owed for that. Pick something else.",
  team_settle_scope_invalid: "Choose what the payment is for: everything, only the cash, or only the parking.",
  team_settle_method_invalid: "Choose how the money was paid.",
  team_settle_month_invalid: "Pick a month that has started (yyyy-mm).",
  team_settle_no_statement: "This person has no statement for this month.",
  team_settle_receiver_invalid: "Choose the owner, someone with Full access, or the Business account.",
  team_settle_not_own: "You can only say you paid for yourself. Ask the owner to record it for someone else.",
  team_settle_not_found: "This payment was not found.",
  team_settle_not_receiver: "Only the person who received this money can answer it.",
  team_settle_not_pending: "This payment was already answered.",
  team_settle_not_undoable: "This payment is already undone or declined.",
  team_settle_bill_changed: "The parking bill changed since it was filed, so it cannot be confirmed as it was. Decline it and ask for a new one.",
  team_settle_owner_only: "Only the owner or someone with Full access can do this.",
  team_payback_not_owed: "The business does not owe this person anything for this month.",
  team_payback_more_than_owed: "That is more than the business owes this person.",
};

const FALLBACKS = {
  permission_denied: "Your account is not allowed to do this.",
  unknown: "That did not save. Try again.",
};

export type SettleStatement = { parkingJobsCents: number; expenseCents: number; cashHeldCents: number };

const whole = (value: unknown): number => Math.round(Number(value) || 0);

/** What a statement can be paid on: the parking after expenses, and the cash (cut by expenses beyond the bill). */
export function settleLimits(statement: Partial<SettleStatement> | null | undefined): { parkingDueCents: number; cashDueCents: number } {
  const parking = whole(statement?.parkingJobsCents);
  const expense = Math.max(0, whole(statement?.expenseCents));
  const cash = whole(statement?.cashHeldCents);
  const credit = Math.max(0, expense - parking);
  return { parkingDueCents: Math.max(0, parking - expense), cashDueCents: Math.max(0, cash - credit) };
}

/** The full number the statement asks for ("Owes the business $X"); 0 when nothing is owed. */
export function defaultSettleCents(statement: Partial<SettleStatement> | null | undefined): number {
  const { parkingDueCents, cashDueCents } = settleLimits(statement);
  return parkingDueCents + cashDueCents;
}

export type SettlePlan = { ok: boolean; reason: string; cashCents: number; parkingCents: number; leftCents: number };

/** How one amount is split: everything = the cash first, then the parking; cash / parking = only that. */
export function teamSettlePlan(input: {
  statement?: Partial<SettleStatement> | null;
  cashHeldCents?: number;
  parkingDueCents?: number;
  amountCents: number;
  scope: string;
}): SettlePlan {
  const limits = settleLimits(input.statement);
  const cashDue = typeof input.cashHeldCents === "number" ? Math.max(0, whole(input.cashHeldCents)) : limits.cashDueCents;
  const parkingDue = typeof input.parkingDueCents === "number" ? Math.max(0, whole(input.parkingDueCents)) : limits.parkingDueCents;
  const total = cashDue + parkingDue;
  const refuse = (reason: string): SettlePlan => ({ ok: false, reason, cashCents: 0, parkingCents: 0, leftCents: total });
  if (!(SETTLE_SCOPES as readonly string[]).includes(input.scope)) return refuse(SETTLE_REFUSAL.SCOPE_INVALID);
  const allowed = input.scope === "cash" ? cashDue : input.scope === "parking" ? parkingDue : total;
  if (allowed <= 0) return refuse(SETTLE_REFUSAL.NOTHING_OWED);
  const raw = input.amountCents;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 || raw > 100000000) return refuse(SETTLE_REFUSAL.NO_AMOUNT);
  if (raw > allowed) return refuse(SETTLE_REFUSAL.MORE_THAN_OWED);
  let cashCents = 0;
  let parkingCents = 0;
  if (input.scope === "cash") cashCents = raw;
  else if (input.scope === "parking") parkingCents = raw;
  else {
    cashCents = Math.min(raw, cashDue);
    parkingCents = Math.min(raw - cashCents, parkingDue);
  }
  return { ok: true, reason: "", cashCents, parkingCents, leftCents: Math.max(0, total - raw) };
}

const PAYBACK_METHODS = ["cash", "zelle", "check", "other"];

/** Why "Paid them back" is refused, or "". */
export function paybackRefusal(input: { owesCents: number; amountCents: number; method: string }): string {
  const owes = whole(input.owesCents);
  if (owes >= 0) return "team_payback_not_owed";
  if (!PAYBACK_METHODS.includes(input.method)) return "team_settle_method_invalid";
  const raw = input.amountCents;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 || raw > 100000000) return SETTLE_REFUSAL.NO_AMOUNT;
  return raw > -owes ? "team_payback_more_than_owed" : "";
}

// ---------------------------------------------------------------------------
// Requests (updateLotExpenseEntry actions)
// ---------------------------------------------------------------------------

export const teamSettleRequest = (input: {
  businessId: string;
  monthKey: string;
  staffId?: string;
  amountCents: number;
  scope: SettleScope;
  receiverId: string;
  method: string;
  note: string;
}) => ({ action: "team_settle_request", ...input });
export const teamSettleConfirmRequest = (businessId: string, settlementId: string) => ({ action: "team_settle_confirm", businessId, settlementId });
export const teamSettleDeclineRequest = (businessId: string, settlementId: string, note: string) => ({ action: "team_settle_decline", businessId, settlementId, note });
export const teamSettleUndoRequest = (businessId: string, settlementId: string) => ({ action: "team_settle_undo", businessId, settlementId });
export const teamPaybackRequest = (input: { businessId: string; monthKey: string; staffId: string; amountCents: number; method: string; note: string }) => ({
  action: "team_payback",
  ...input,
});

/** A callable rejection in the console's words: `details.reason` when it is one of ours, else permission-denied / unknown. Never the raw text. */
export function teamSettleRefusalText(error: unknown): string {
  const e = (error && typeof error === "object" ? error : {}) as Row;
  const details = (e.details && typeof e.details === "object" ? e.details : {}) as Row;
  const reason = String(details.reason ?? "").slice(0, 80);
  if (Object.prototype.hasOwnProperty.call(SETTLE_MESSAGES, reason)) return SETTLE_MESSAGES[reason];
  if (/permission-denied$/.test(String(e.code ?? ""))) return FALLBACKS.permission_denied;
  return FALLBACKS.unknown;
}

// ---------------------------------------------------------------------------
// The month's settlements (`staffMonthSettlements`)
// ---------------------------------------------------------------------------

export type SettlementRecord = {
  id: string;
  staffId: string;
  monthKey: string;
  amountCents: number;
  scope: string;
  cashCents: number;
  parkingCents: number;
  statementOwedCents: number;
  receiverId: string;
  method: string;
  note: string;
  status: "pending" | "confirmed" | "declined" | "undone";
  requestedAtMs: number;
  requestedByUid: string;
  confirmedAtMs: number;
  declinedAtMs: number;
  declineNote: string;
  undoneAtMs: number;
  undoneByUid: string;
};

const STATUSES = ["pending", "confirmed", "declined", "undone"];

/** The settlements as rows the card can show, oldest first; anything odd is left out. */
export function settlementRecords(rows: readonly Row[] | null | undefined): SettlementRecord[] {
  const out: SettlementRecord[] = [];
  for (const row of rows ?? []) {
    const status = String(row.status ?? "");
    if (!STATUSES.includes(status) || !row.id) continue;
    out.push({
      id: String(row.id),
      staffId: String(row.staffId ?? ""),
      monthKey: String(row.monthKey ?? ""),
      amountCents: whole(row.amountCents),
      scope: String(row.scope ?? ""),
      cashCents: whole(row.cashCents),
      parkingCents: whole(row.parkingCents),
      statementOwedCents: whole(row.statementOwedCents),
      receiverId: String(row.receiverId ?? ""),
      method: String(row.method ?? ""),
      note: String(row.note ?? ""),
      status: status as SettlementRecord["status"],
      requestedAtMs: whole(row.requestedAtMs),
      requestedByUid: String(row.requestedByUid ?? ""),
      confirmedAtMs: whole(row.confirmedAtMs),
      declinedAtMs: whole(row.declinedAtMs),
      declineNote: String(row.declineNote ?? ""),
      undoneAtMs: whole(row.undoneAtMs),
      undoneByUid: String(row.undoneByUid ?? ""),
    });
  }
  return out.sort((a, b) => a.requestedAtMs - b.requestedAtMs || a.id.localeCompare(b.id));
}

/** The settlements of one team member. */
export function settlementsOf(records: readonly SettlementRecord[], staffId: string): SettlementRecord[] {
  return records.filter((r) => r.staffId === staffId);
}

/** Whether the signed-in person answers a pending settlement: named as the receiver (or the owner for the Business account), in a receiver role. */
export function mayAnswerSettlement(record: SettlementRecord, input: { uid: string; isReceiver: boolean }): boolean {
  if (record.status !== "pending" || !input.isReceiver) return false;
  return record.receiverId === "business_account" || record.receiverId === input.uid;
}

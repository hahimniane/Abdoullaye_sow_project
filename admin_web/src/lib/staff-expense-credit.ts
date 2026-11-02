/**
 * Staff expenses netted against their parking bill
 * (docs/STAFF_EXPENSE_CREDIT.md §3).
 *
 * A staff member who paid lot expenses out of pocket is owed that money; if
 * they also park cars, what they owe on parking is lowered by it. Both sides
 * are cumulative to the end of the month shown, so the netting never needs
 * history: applied = min(owed on parking, credit), and what is left of the
 * credit is what the business still owes them.
 *
 * Pure: no Firestore, no clock. An exact mirror of
 * `my_flutter_app/functions/staff_expense_credit.js` (and the app's
 * `staff_expense_credit.dart`); the shared fixture
 * `functions/test/fixtures/staff-expense-credit-cases.json` is run by all three.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type Row = Record<string, unknown>;

const cents = (value: unknown): number => {
  const n = Math.round(Number(value) || 0);
  return n > 0 ? n : 0;
};
const text = (value: unknown, max = 200): string => String(value ?? "").trim().slice(0, max);

/** "Paid by: the business" (EXPENSE_PAID_BY.md): nobody's credit. */
export const BUSINESS_PAYER = "business_account";

/** A person who paid, or "" for the business / nobody. */
const personPayer = (id: unknown): string => {
  const v = text(id, 128);
  return v && v !== BUSINESS_PAYER ? v : "";
};

/** At most this many months of a standing payer (3 years). */
const MAX_STANDING_MONTHS = 36;

/**
 * Who pays a monthly line in `month` (EXPENSE_PAID_BY.md §2): the payer with
 * the greatest `fromMonth <= month`. A staff id, or "" for the business.
 */
export function linePayerFor(line: Row | null | undefined, month: string): string {
  return linePayerEntryFor(line, month)?.staffId ?? "";
}

/**
 * The payers entry that applies to `month` ({fromMonth, staffId}), or null
 * when nobody (a person) pays: no entry yet, or the business pays.
 */
export function linePayerEntryFor(
  line: Row | null | undefined,
  month: string,
): { fromMonth: string; staffId: string } | null {
  let best: { from: string; id: string } | null = null;
  for (const p of (Array.isArray(line?.payers) ? line.payers : []) as Row[]) {
    const from = text(p?.fromMonth, 7);
    if (!MONTH.test(from) || from > month) continue;
    if (!best || from >= best.from) best = { from, id: text(p?.staffId, 128) };
  }
  const id = best ? personPayer(best.id) : "";
  return best && id ? { fromMonth: best.from, staffId: id } : null;
}

const nextMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/**
 * The months a monthly line's standing payer pays (EXPENSE_PAID_BY.md §3),
 * as virtual expense entries, so the netting reads them like purchases. A
 * real, non-voided purchase on the line for a month wins.
 */
export function standingPayerEntries(
  lines: readonly Row[] | null | undefined,
  entries: readonly Row[] | null | undefined,
  nowMonth: string,
): Row[] {
  const out: Row[] = [];
  if (!MONTH.test(String(nowMonth || ""))) return out;
  const logged = new Set<string>();
  for (const e of entries || []) {
    if (!e || e.voided === true) continue;
    logged.add(`${text(e.lineId, 128)}|${text(e.month, 7)}`);
  }
  for (const line of lines || []) {
    const lineId = text(line?.id, 128);
    if (!lineId || line.kind !== "fixed" || line.voided === true || line.active === false) continue;
    const amount = cents(line.recurringCents);
    if (amount <= 0) continue;
    const froms = (Array.isArray(line.payers) ? (line.payers as Row[]) : [])
      .map((p) => text(p?.fromMonth, 7)).filter((m) => MONTH.test(m)).sort();
    if (froms.length === 0) continue;
    const end = text(line.endMonth, 7);
    let month = froms[0];
    for (let n = 0; n < MAX_STANDING_MONTHS && month <= nowMonth; n++) {
      if (MONTH.test(end) && month > end) break;
      const payer = linePayerFor(line, month);
      if (payer && !logged.has(`${lineId}|${month}`)) {
        const [y, m] = month.split("-").map(Number);
        out.push({
          id: `standing:${lineId}:${month}`,
          lineId,
          month,
          amountCents: amount,
          paidByStaffId: payer,
          note: "",
          spentAtMs: Date.UTC(y, m - 1, 1, 12),
          standing: true,
        });
      }
      month = nextMonth(month);
    }
  }
  return out;
}

/** The entries every netting reads: the real ones plus the monthly lines' standing payers. */
export function withStandingPayers(
  entries: readonly Row[] | null | undefined,
  lines: readonly Row[] | null | undefined,
  nowMonth: string,
): Row[] {
  return [...(entries || []), ...standingPayerEntries(lines, entries, nowMonth)];
}

export type StaffCredit = { expensesCents: number; repaidCents: number; creditCents: number };
export type StaffParkingLink = {
  customerKey?: string;
  customerName?: string;
  customerPhone?: string;
  linkedAtMs?: number;
  linkedByUid?: string;
};
export type StaffParkingLinks = Record<string, StaffParkingLink | null | undefined>;

/** Each staff member's expenses, paid-back amounts and credit up to the end of `monthKey`. */
export function staffCredits(
  entries: readonly Row[] | null | undefined,
  repayments: readonly Row[] | null | undefined,
  monthKey: string,
): Record<string, StaffCredit> {
  const out: Record<string, StaffCredit> = {};
  if (!MONTH.test(String(monthKey || ""))) return out;
  const slot = (id: string) => {
    if (!out[id]) out[id] = { expensesCents: 0, repaidCents: 0, creditCents: 0 };
    return out[id];
  };
  for (const e of entries || []) {
    const id = personPayer(e?.paidByStaffId);
    const month = text(e?.month, 7);
    if (!id || e?.voided === true || !MONTH.test(month) || month > monthKey) continue;
    slot(id).expensesCents += cents(e.amountCents);
  }
  for (const r of repayments || []) {
    const id = text(r?.staffId, 128);
    const month = text(r?.month, 7);
    if (!id || r?.voided === true || !MONTH.test(month) || month > monthKey) continue;
    slot(id).repaidCents += cents(r.amountCents);
  }
  for (const s of Object.values(out)) {
    s.creditCents = Math.max(0, s.expensesCents - s.repaidCents);
  }
  return out;
}

/** The staff linked to each customer key, staff ids sorted. */
export function staffByCustomer(links: StaffParkingLinks | null | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [staffId, link] of Object.entries(links || {})) {
    const key = text(link?.customerKey, 200);
    if (!key) continue;
    if (!out[key]) out[key] = [];
    out[key].push(staffId);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

/**
 * Splits `amount` across staff in proportion to their credits; the rounding
 * remainder goes to the first. Every share is whole cents.
 */
export function splitByCredit(
  amount: number,
  staffIds: readonly string[],
  credits: Record<string, StaffCredit>,
): Record<string, number> {
  const total = staffIds.reduce((s, id) => s + (credits[id]?.creditCents || 0), 0);
  const out: Record<string, number> = {};
  if (amount <= 0 || total <= 0) {
    for (const id of staffIds) out[id] = 0;
    return out;
  }
  let given = 0;
  for (const id of staffIds) {
    out[id] = Math.floor(amount * (credits[id]?.creditCents || 0) / total);
    given += out[id];
  }
  out[staffIds[0]] += amount - given;
  return out;
}

export type StaffCreditContext = {
  entries?: readonly Row[] | null;
  repayments?: readonly Row[] | null;
  links?: StaffParkingLinks | null;
  monthKey: string;
  staffNames?: Record<string, string> | null;
};

export type BusinessOwesLine = { staffId: string; staffName: string; customerKey: string; owedCents: number };

export type NettedCustomer<C> = C & {
  linkedStaffIds: string[];
  dueBeforeExpensesCents: number;
  expenseCreditCents: number;
  dueCents: number;
};

/**
 * Nets staff credit into the month's customers and lists what the business
 * still owes its staff. Each customer gains `dueBeforeExpensesCents`,
 * `expenseCreditCents`, `linkedStaffIds` and has `dueCents` netted.
 */
export function netStaffExpenses<C extends { key: string; dueCents: number }>(
  customers: readonly C[] | null | undefined,
  ctx: StaffCreditContext | null | undefined,
): {
  customers: NettedCustomer<C>[];
  businessOwes: BusinessOwesLine[];
  businessOwesCents: number;
  expenseCreditCents: number;
} {
  const credits = staffCredits(ctx?.entries, ctx?.repayments, ctx?.monthKey ?? "");
  const byCustomer = staffByCustomer(ctx?.links);
  const list = customers || [];
  // A team member's own cars (`staff:{uid}`, PARKING_TEAM_CARS.md) are theirs
  // without any link.
  for (const customer of list) {
    const key = text(customer?.key, 200);
    if (!key.startsWith("staff:")) continue;
    const id = key.slice(6);
    if (!byCustomer[key]) byCustomer[key] = [];
    if (id && !byCustomer[key].includes(id)) byCustomer[key].push(id);
  }
  const names = ctx?.staffNames || {};
  // What each person's expenses can still cover: one credit, used once,
  // whichever of their bills it lands on - their own cars first.
  const left: Record<string, number> = {};
  for (const [id, c] of Object.entries(credits)) left[id] = c.creditCents;
  const order = list.map((_, i) => i).sort((a, b) =>
    Number(!text(list[a]?.key).startsWith("staff:")) -
      Number(!text(list[b]?.key).startsWith("staff:")) || a - b);
  const nettedAt: NettedCustomer<C>[] = new Array(list.length);
  for (const i of order) {
    const customer = list[i];
    const linked = byCustomer[customer.key] || [];
    const credit = linked.reduce((s, id) => s + (left[id] || 0), 0);
    const before = cents(customer.dueCents);
    const applied = Math.min(before, credit);
    if (linked.length) {
      const view: Record<string, StaffCredit> = Object.fromEntries(
        linked.map((id) => [id, { expensesCents: 0, repaidCents: 0, creditCents: left[id] || 0 }]));
      const used = splitByCredit(applied, linked, view);
      for (const id of linked) left[id] = Math.max(0, (left[id] || 0) - (used[id] || 0));
    }
    nettedAt[i] = {
      ...customer,
      linkedStaffIds: linked,
      dueBeforeExpensesCents: before,
      expenseCreditCents: applied,
      dueCents: before - applied,
    };
  }
  const netted = nettedAt;
  const owedByStaff = left;

  const keyOf: Record<string, string> = {};
  for (const [id, link] of Object.entries(ctx?.links || {})) keyOf[id] = text(link?.customerKey, 200);
  for (const customer of list) {
    const key = text(customer?.key, 200);
    if (key.startsWith("staff:")) keyOf[key.slice(6)] = key;
  }
  const businessOwes = Object.entries(owedByStaff)
    .filter(([, owed]) => owed > 0)
    .map(([staffId, owedCents]) => ({
      staffId,
      staffName: text(names[staffId], 120),
      customerKey: keyOf[staffId] || "",
      owedCents,
    }))
    .sort((a, b) => b.owedCents - a.owedCents ||
      a.staffName.localeCompare(b.staffName) ||
      a.staffId.localeCompare(b.staffId));
  return {
    customers: netted,
    businessOwes,
    businessOwesCents: businessOwes.reduce((s, x) => s + x.owedCents, 0),
    expenseCreditCents: netted.reduce((s, c) => s + c.expenseCreditCents, 0),
  };
}

export type MonthExpenseLine = {
  id: string;
  staffId: string;
  amountCents: number;
  note: string;
  lineId: string;
  /** The expense line's name, "" when unknown. */
  lineLabel: string;
  /** expenseLabel(lineLabel, note). */
  label: string;
  spentAtMs: number;
};

/** The expense lines' names (`lotExpenseLines.label`) by line id; unnamed lines left out. */
export function expenseLineLabels(lines: readonly Row[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines || []) {
    const id = text(l?.id, 128);
    const label = text(l?.label, 120);
    if (id && label) out[id] = label;
  }
  return out;
}

/**
 * What an expense reads as on a bill: its line's name, then its note
 * ("grosseries · tissu, cups"); one alone when the other is empty or the
 * same; "" when neither (each client then says "Expense").
 */
export function expenseLabel(lineLabel: unknown, note: unknown): string {
  const a = text(lineLabel, 120);
  const b = text(note, 200);
  if (a && b && a.toLowerCase() === b.toLowerCase()) return a;
  return [a, b].filter(Boolean).join(" · ");
}

/** This month's expenses of the given staff, for the bill's lines, oldest first. */
export function monthExpenseLines(
  entries: readonly Row[] | null | undefined,
  monthKey: string,
  staffIds: readonly string[] | null | undefined,
  lineLabels?: Record<string, string> | null,
): MonthExpenseLine[] {
  const wanted = new Set((staffIds || []).filter((id) => personPayer(id)));
  const names = lineLabels || {};
  return (entries || [])
    .filter((e) => e && e.voided !== true && wanted.has(e.paidByStaffId as string) &&
      text(e.month, 7) === monthKey && cents(e.amountCents) > 0)
    .map((e) => {
      const lineId = text(e.lineId, 128);
      const lineLabel = text(names[lineId], 120);
      const note = text(e.note, 200);
      return {
        id: text(e.id, 128),
        staffId: e.paidByStaffId as string,
        amountCents: cents(e.amountCents),
        note,
        lineId,
        lineLabel,
        label: expenseLabel(lineLabel, note),
        spentAtMs: Number(e.spentAtMs) || 0,
      };
    })
    .sort((a, b) => a.spentAtMs - b.spentAtMs || a.id.localeCompare(b.id));
}

/**
 * The part of "Less expenses" that came from expenses of earlier months:
 * what was taken off the bill beyond this month's listed lines. With it
 * listed, the lines add up to "Less expenses" whenever the credit covered
 * them (when it did not, the rest of the credit is in Business owes).
 */
export function earlierExpenseCents(
  appliedCents: number,
  lines: readonly { amountCents: number }[] | null | undefined,
): number {
  const applied = cents(appliedCents);
  const listed = (lines || []).reduce((s, l) => s + cents(l?.amountCents), 0);
  return applied - Math.min(applied, listed);
}

/**
 * Mark all paid's items after the expense credit: the credit covers the
 * first items (in order), only the rest is recorded as payments. Empty
 * items are dropped.
 */
export function itemsAfterCredit<T extends { amountCents: number }>(
  items: readonly T[] | null | undefined,
  creditCents: number,
): T[] {
  let left = cents(creditCents);
  const out: T[] = [];
  for (const item of items || []) {
    const amount = cents(item.amountCents);
    const covered = Math.min(amount, left);
    left -= covered;
    if (amount - covered > 0) out.push({ ...item, amountCents: amount - covered });
  }
  return out;
}

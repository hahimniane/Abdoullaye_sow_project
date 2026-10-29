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
    const id = text(e?.paidByStaffId, 128);
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
  const names = ctx?.staffNames || {};
  const owedByStaff: Record<string, number> = {};
  for (const [id, c] of Object.entries(credits)) owedByStaff[id] = c.creditCents;

  const netted = (customers || []).map((customer) => {
    const linked = byCustomer[customer.key] || [];
    const credit = linked.reduce((s, id) => s + (credits[id]?.creditCents || 0), 0);
    const before = cents(customer.dueCents);
    const applied = Math.min(before, credit);
    if (linked.length) {
      const used = splitByCredit(applied, linked, credits);
      for (const id of linked) {
        owedByStaff[id] = Math.max(0, (credits[id]?.creditCents || 0) - (used[id] || 0));
      }
    }
    return {
      ...customer,
      linkedStaffIds: linked,
      dueBeforeExpensesCents: before,
      expenseCreditCents: applied,
      dueCents: before - applied,
    };
  });

  const keyOf: Record<string, string> = {};
  for (const [id, link] of Object.entries(ctx?.links || {})) keyOf[id] = text(link?.customerKey, 200);
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

export type MonthExpenseLine = { id: string; staffId: string; amountCents: number; note: string; spentAtMs: number };

/** This month's expenses of the given staff, for the bill's lines, oldest first. */
export function monthExpenseLines(
  entries: readonly Row[] | null | undefined,
  monthKey: string,
  staffIds: readonly string[] | null | undefined,
): MonthExpenseLine[] {
  const wanted = new Set(staffIds || []);
  return (entries || [])
    .filter((e) => e && e.voided !== true && wanted.has(e.paidByStaffId as string) &&
      text(e.month, 7) === monthKey && cents(e.amountCents) > 0)
    .map((e) => ({
      id: text(e.id, 128),
      staffId: e.paidByStaffId as string,
      amountCents: cents(e.amountCents),
      note: text(e.note, 200),
      spentAtMs: Number(e.spentAtMs) || 0,
    }))
    .sort((a, b) => a.spentAtMs - b.spentAtMs || a.id.localeCompare(b.id));
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

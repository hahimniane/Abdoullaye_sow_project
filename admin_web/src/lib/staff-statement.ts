/**
 * Staff statements for parking businesses (docs/PARKING_INVOICES.md §6).
 *
 * A TEAM MEMBER (a person whose own cars are team cars - month-end customer
 * key `staff:{uid}` - and/or who is linked to a parking customer through
 * `staffParkingLinks`) gets ONE statement for the month, and Month end shows
 * the very same numbers as the WhatsApp statement:
 *
 *   parking + lot jobs of the month (plus anything unpaid from before)
 *   - the lot expenses they paid that are not yet credited (cumulative to
 *     the end of the month, so a September expense counts in October)
 *   + the cash they hold for the business at the END of the month
 *   = what they owe the business (negative: the business owes them)
 *
 * Pure: no Firebase, no clock. An exact mirror of
 * `my_flutter_app/functions/staff_statement.js`; the shared fixture
 * `functions/test/fixtures/staff-statement-cases.json` is run by both (and
 * by the app's `staff_statement.dart`). The cash itself comes from the
 * server (`staff_statement_cash`): it needs every payment and handover, not
 * only the month's cars.
 */

import {
  earlierExpenseCents,
  expenseLineLabels,
  monthExpenseLines,
  staffCredits,
} from "./staff-expense-credit.ts";
import {
  dayKeyOf,
  dayNumber,
  parkingMonthCustomerPaid,
  type ParkingMonthCustomer,
  type ParkingMonthExpenseLine,
} from "./parking-month-statement.ts";

type Row = Record<string, unknown>;

const text = (value: unknown, max = 200): string => String(value ?? "").trim().slice(0, max);
const signed = (value: unknown): number => Math.round(Number(value) || 0);

/** The fields of a netted month-end customer a statement reads. */
export type StatementCustomer = {
  key: string;
  customerName?: string;
  customerPhone?: string;
  linkedStaffIds?: string[];
  monthCents?: number;
  monthPaidCents?: number;
  monthUnpaidCents?: number;
  priorUnpaidCents?: number;
  dueBeforeExpensesCents?: number;
  cars?: { stillParked?: boolean }[];
  activities?: unknown[];
  olderActivities?: unknown[];
  olderCars?: unknown[];
};

export type StaffStatement<C extends StatementCustomer = StatementCustomer> = {
  staffId: string;
  name: string;
  /** The card that carries the statement (their own cars' card first). */
  key: string;
  customerKeys: string[];
  monthKey: string;
  monthCents: number;
  priorUnpaidCents: number;
  monthPaidCents: number;
  /** Parking and lot jobs: this month plus what was unpaid from before. */
  parkingJobsCents: number;
  /** Their lot expenses not yet credited (all of them, to the month's end). */
  expenseCents: number;
  expenseLines: ParkingMonthExpenseLine[];
  earlierExpenseCents: number;
  /** The cash they hold for the business at the month's end (signed). */
  cashHeldCents: number;
  /** parking and jobs - expenses + cash held. Negative: the business owes them. */
  owesCents: number;
  stillParked: boolean;
  /** All of the person's bills as one month-end customer, with the statement's money. */
  customer: C & Partial<ParkingMonthCustomer>;
};

export type StatementContext = {
  monthKey: string;
  /** lotExpenseEntries rows (standing payers included) with `spentAtMs`. */
  entries?: readonly Row[] | null;
  repayments?: readonly Row[] | null;
  lines?: readonly Row[] | null;
  staffNames?: Record<string, string> | null;
  /** `{[staffId]: cash held at the month's end, cents}`. */
  held?: Record<string, number> | null;
};

/**
 * The team member a month-end customer is billed under: the member whose own
 * cars they are (`staff:{uid}`), or the ONE member linked to them. A customer
 * linked to several members stays a customer.
 */
export function memberOf(customer: { key: string; linkedStaffIds?: string[] }): string {
  const key = text(customer?.key, 200);
  if (key.startsWith("staff:")) return key.slice(6);
  const ids = Array.isArray(customer?.linkedStaffIds) ? customer.linkedStaffIds.filter(Boolean) : [];
  return ids.length === 1 ? text(ids[0], 128) : "";
}

function mergedBill<C extends StatementCustomer>(bills: readonly C[], name: string): C & Partial<ParkingMonthCustomer> {
  const sum = (k: keyof StatementCustomer) => bills.reduce((s, b) => s + (Number(b[k]) || 0), 0);
  const all = (k: "cars" | "activities" | "olderActivities" | "olderCars") =>
    bills.flatMap((b) => (Array.isArray(b[k]) ? (b[k] as unknown[]) : []));
  const first = bills[0];
  const dueCents = sum("dueBeforeExpensesCents");
  const monthCents = sum("monthCents");
  return {
    ...first,
    customerName: name || text(first.customerName, 120),
    customerPhone: text(bills.find((b) => text(b.customerPhone))?.customerPhone, 40),
    cars: all("cars") as C["cars"],
    activities: all("activities") as C["activities"],
    olderActivities: all("olderActivities") as C["olderActivities"],
    olderCars: all("olderCars") as C["olderCars"],
    monthCents,
    monthPaidCents: sum("monthPaidCents"),
    monthUnpaidCents: sum("monthUnpaidCents"),
    priorUnpaidCents: sum("priorUnpaidCents"),
    dueCents,
    dueBeforeExpensesCents: dueCents,
    owes: dueCents > 0,
    paid: parkingMonthCustomerPaid({ monthCents, dueCents }),
  } as C & Partial<ParkingMonthCustomer>;
}

/**
 * Each team member's statement for the month.
 *
 * `customers` are the month's customers AFTER staff expenses were netted
 * (`parkingMonthSummary(...).customers`). `customerKeys` maps every
 * month-end customer key that belongs to a statement to its staff id: those
 * customers are NOT invoiced, and only the first of a member's bills carries
 * the figures.
 */
export function staffStatements<C extends StatementCustomer>(
  customers: readonly C[] | null | undefined,
  ctx: StatementContext,
): { statements: StaffStatement<C>[]; customerKeys: Record<string, string> } {
  const monthKey = text(ctx?.monthKey, 7);
  const names = ctx?.staffNames && typeof ctx.staffNames === "object" ? ctx.staffNames : {};
  const held = ctx?.held && typeof ctx.held === "object" ? ctx.held : {};
  const entries = (ctx?.entries ?? []).filter((x) => x && typeof x === "object");
  const credits = staffCredits(entries, ctx?.repayments, monthKey);
  const labels = expenseLineLabels(ctx?.lines ?? []);
  const byMember = new Map<string, C[]>();
  const customerKeys: Record<string, string> = {};
  for (const customer of customers ?? []) {
    const staffId = memberOf(customer);
    if (!staffId) continue;
    if (!byMember.has(staffId)) byMember.set(staffId, []);
    byMember.get(staffId)!.push(customer);
    customerKeys[text(customer.key, 200)] = staffId;
  }
  const statements: StaffStatement<C>[] = [];
  for (const [staffId, found] of byMember) {
    // The card that carries the statement: their own cars first.
    const bills = [...found].sort((a, b) =>
      Number(!text(a.key).startsWith("staff:")) - Number(!text(b.key).startsWith("staff:")) ||
      text(a.key).localeCompare(text(b.key)));
    const name = text(names[staffId], 120) ||
      text(bills.find((b) => text(b.key).startsWith("staff:"))?.customerName, 120) ||
      text(bills[0].customerName, 120);
    const merged = mergedBill(bills, name);
    const parkingJobsCents = merged.dueCents ?? 0;
    const expenseCents = credits[staffId]?.creditCents || 0;
    const expenseLines = monthExpenseLines(entries, monthKey, [staffId], labels).map((l) => {
      const day = l.spentAtMs > 0 ? dayNumber(new Date(l.spentAtMs)) : null;
      return {
        id: l.id,
        date: day === null ? "" : dayKeyOf(day),
        label: l.label,
        lineLabel: l.lineLabel,
        note: l.note,
        amountCents: l.amountCents,
        staffId,
        staffName: name,
      };
    });
    const cashHeldCents = signed(held[staffId]);
    const owesCents = parkingJobsCents - expenseCents + cashHeldCents;
    const earlier = earlierExpenseCents(expenseCents, expenseLines);
    statements.push({
      staffId,
      name,
      key: text(bills[0].key, 200),
      customerKeys: bills.map((b) => text(b.key, 200)),
      monthKey,
      monthCents: merged.monthCents ?? 0,
      priorUnpaidCents: merged.priorUnpaidCents ?? 0,
      monthPaidCents: merged.monthPaidCents ?? 0,
      parkingJobsCents,
      expenseCents,
      expenseLines,
      earlierExpenseCents: earlier,
      cashHeldCents,
      owesCents,
      stillParked: (merged.cars ?? []).some((b) => b.stillParked === true),
      customer: {
        ...merged,
        linkedStaffIds: [staffId],
        expenseCreditCents: expenseCents,
        expenseLines,
        earlierExpenseCents: earlier,
      },
    });
  }
  statements.sort((a, b) => a.name.localeCompare(b.name) || a.staffId.localeCompare(b.staffId));
  return { statements, customerKeys };
}

/**
 * What the Month end list shows for each customer once the statements are
 * known: the member's FIRST bill becomes their statement (all their bills as
 * one, with the cash line and "owes the business"); their other bills are
 * marked as included in it; everyone else is untouched.
 */
export function statementCards(
  customers: readonly ParkingMonthCustomer[],
  statements: readonly StaffStatement<ParkingMonthCustomer>[],
  customerKeys: Readonly<Record<string, string>>,
): ParkingMonthCustomer[] {
  const byStaff = new Map(statements.map((s) => [s.staffId, s]));
  return customers.map((c) => {
    const staffId = customerKeys[c.key];
    const st = staffId ? byStaff.get(staffId) : undefined;
    if (!st) return c;
    if (st.key !== c.key) return { ...c, includedInStatementOf: st.name };
    return {
      ...(st.customer as ParkingMonthCustomer),
      key: c.key,
      cashHeldCents: st.cashHeldCents,
      statementOwesCents: st.owesCents,
      statementStaffId: st.staffId,
    };
  });
}

/** Whether a card is on Month end's "Who owes" list: a statement by what the member owes, a customer as before. */
export function cardOwes(card: ParkingMonthCustomer): boolean {
  if (card.includedInStatementOf) return false;
  return card.statementOwesCents !== undefined ? card.statementOwesCents > 0 : card.owes;
}

/** Whether a card is on the "Paid" list: a statement once nothing is owed, a customer as before. */
export function cardPaid(card: ParkingMonthCustomer): boolean {
  if (card.includedInStatementOf) return false;
  return card.statementOwesCents !== undefined ? card.statementOwesCents <= 0 : card.paid;
}

/** The cash each person held at the end of a month (`updateLotExpenseEntry` action `staff_statement_cash`). */
export const staffStatementCashRequest = (businessId: string, monthKey: string) => ({
  action: "staff_statement_cash",
  businessId,
  monthKey,
});

/** The answer's `held`, normalised: `{[staffId]: whole cents}` (an odd answer reads as nobody holding anything). */
export function staffStatementCashFrom(value: unknown): Record<string, number> {
  const held = (value && typeof value === "object" ? (value as { held?: unknown }).held : null) as Record<string, unknown> | null;
  const out: Record<string, number> = {};
  if (!held || typeof held !== "object") return out;
  for (const [id, cents] of Object.entries(held)) {
    const n = Math.round(Number(cents));
    if (id && Number.isFinite(n)) out[id] = n;
  }
  return out;
}

/** Whether Month end needs the cash at all: some bill belongs to a team member. */
export function hasTeamBills(customers: readonly { key: string; linkedStaffIds?: string[] }[] | null | undefined): boolean {
  return (customers ?? []).some((c) => memberOf(c) !== "");
}

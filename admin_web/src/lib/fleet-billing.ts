/**
 * Fleet (TLC plate leasing) billing rules (docs/FLEET.md section 3). Mirrors
 * the server's `fleet_billing.js`, so the console shows exactly what the
 * server will bill. Day keys are "YYYY-MM-DD" in America/New_York; money is
 * integer cents.
 *
 * Pure: no React, no clock of its own (the caller passes day keys).
 */

type Row = Record<string, unknown>;

export const FLEET_MESSAGES: Record<string, string> = {
  fleet_no_amount: "Enter an amount greater than zero.",
};

export type RentPeriod = { periodFrom: string; periodTo: string; dueDayKey: string };
export type FleetSettings = {
  returnRule?: "full" | "days";
  lateFee?: { cents?: number; dayOfMonth?: number; firstMonth?: string };
};
export type FleetAssignment = {
  id?: string;
  businessId?: string;
  driverId?: string;
  carId?: string;
  startDayKey: string;
  endDayKey?: string | null;
  period: "weekly" | "monthly";
  dueDay: number;
  rentCents?: number;
};
export type FleetBill = {
  id: string;
  kind?: string;
  status?: string;
  amountCents?: number;
  paidCents?: number;
  dueDayKey?: string;
  label?: string;
  lateFeeForBillId?: string | null;
  [key: string]: unknown;
};
export type Allocation = { billId: string; cents: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86400000;

function parts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = String(key).split("-").map(Number);
  return { y, m, d };
}

function dayNum(key: string): number {
  const { y, m, d } = parts(key);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function dayKeyOf(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** The day key for a day of a month, clamped to the month's length (month may overflow). */
function monthDay(year: number, month: number, day: number): string {
  const y = year + Math.floor((month - 1) / 12);
  const m = ((((month - 1) % 12) + 12) % 12) + 1;
  const d = Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate());
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function usDate(key: string): string {
  const { y, m, d } = parts(key);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The rent periods from the start to the period holding throughDayKey (or endDayKey first). */
export function rentPeriods(assignment: FleetAssignment, throughDayKey: string): RentPeriod[] {
  const a = assignment || ({} as FleetAssignment);
  const start = parts(a.startDayKey);
  const stop = a.endDayKey && a.endDayKey < throughDayKey ? a.endDayKey : throughDayKey;
  const out: RentPeriod[] = [];
  for (let k = 0; k < 10000; k++) {
    let from: string;
    let to: string;
    let due: string;
    if (a.period === "weekly") {
      const f = dayNum(a.startDayKey) + 7 * k;
      from = dayKeyOf(f);
      to = dayKeyOf(f + 6);
      const weekday = ((((f + 3) % 7) + 7) % 7) + 1; // 1970-01-01 was Thursday
      due = dayKeyOf(f + ((Number(a.dueDay) - weekday + 7) % 7));
    } else {
      from = monthDay(start.y, start.m + k, start.d);
      const next = monthDay(start.y, start.m + k + 1, start.d);
      to = dayKeyOf(dayNum(next) - 1);
      const f = parts(from);
      due = monthDay(f.y, f.m, Number(a.dueDay));
    }
    if (from > stop) break;
    out.push({ periodFrom: from, periodTo: to, dueDayKey: due });
  }
  return out;
}

/**
 * Rent bills not yet created, through a day. Idempotent by bill id. The
 * period cut by endDayKey follows settings.returnRule ("full" by default, or
 * "days": pro rata, start and end inclusive).
 */
export function rentBillsToCreate(
  assignment: FleetAssignment,
  existingBillIds: string[],
  throughDayKey: string,
  settings?: FleetSettings,
): Row[] {
  const a = assignment || ({} as FleetAssignment);
  const have = new Set(existingBillIds || []);
  const days = Boolean(settings) && settings?.returnRule === "days";
  const out: Row[] = [];
  for (const p of rentPeriods(a, throughDayKey)) {
    const id = `${a.id}_${p.periodFrom}`;
    if (have.has(id)) continue;
    let amount = Math.round(Number(a.rentCents) || 0);
    if (days && a.endDayKey && a.endDayKey >= p.periodFrom && a.endDayKey < p.periodTo) {
      const used = dayNum(a.endDayKey) - dayNum(p.periodFrom) + 1;
      const total = dayNum(p.periodTo) - dayNum(p.periodFrom) + 1;
      amount = Math.round((amount * used) / total);
    }
    const f = parts(p.periodFrom);
    out.push({
      id,
      businessId: a.businessId || null,
      driverId: a.driverId || null,
      carId: a.carId || null,
      assignmentId: a.id,
      kind: "rent",
      label: a.period === "weekly" ? `Plate fee week of ${usDate(p.periodFrom)}` : `Plate fee ${MONTHS[f.m - 1]} ${f.y}`,
      periodFrom: p.periodFrom,
      periodTo: p.periodTo,
      dueDayKey: p.dueDayKey,
      amountCents: amount,
      paidCents: 0,
      status: "open",
    });
  }
  return out;
}

const remaining = (b: FleetBill): number => Math.max(0, (Number(b.amountCents) || 0) - (Number(b.paidCents) || 0));

/**
 * Late fees to create: one per open, unpaid rent bill whose fee day has come
 * (the office's day of the due month, or of the next month when the bill is
 * due after it), from firstMonth on, with no late fee yet.
 */
export function lateFeesToCreate(bills: FleetBill[], settings: FleetSettings | undefined, todayKey: string): Row[] {
  const lf = settings?.lateFee || {};
  const cents = Math.round(Number(lf.cents) || 0);
  const dom = Number(lf.dayOfMonth);
  if (cents <= 0 || !(dom >= 1) || !lf.firstMonth) return [];
  const charged = new Set((bills || []).filter((b) => b.kind === "late_fee").map((b) => b.lateFeeForBillId));
  const out: Row[] = [];
  for (const b of bills || []) {
    if (b.kind !== "rent" || b.status !== "open" || remaining(b) <= 0) continue;
    if (!b.dueDayKey || charged.has(b.id)) continue;
    if (b.dueDayKey.slice(0, 7) < lf.firstMonth) continue;
    const due = parts(b.dueDayKey);
    let fee = monthDay(due.y, due.m, dom);
    if (b.dueDayKey > fee) fee = monthDay(due.y, due.m + 1, dom);
    if (todayKey < fee) continue;
    out.push({
      id: `${b.id}_late`,
      businessId: b.businessId || null,
      driverId: b.driverId || null,
      carId: b.carId || null,
      assignmentId: b.assignmentId || null,
      kind: "late_fee",
      label: `Late fee — ${b.label || "Plate fee"}`,
      periodFrom: b.periodFrom || null,
      periodTo: b.periodTo || null,
      dueDayKey: fee,
      amountCents: cents,
      paidCents: 0,
      status: "open",
      lateFeeForBillId: b.id,
    });
  }
  return out;
}

/** Late fees first, then everything else; each by due day then id. */
function payOrder(bills: FleetBill[]): FleetBill[] {
  const rank = (b: FleetBill) => (b.kind === "late_fee" ? 0 : 1);
  return (bills || [])
    .filter((b) => b.status === "open" && remaining(b) > 0)
    .sort(
      (x, y) =>
        rank(x) - rank(y) ||
        String(x.dueDayKey).localeCompare(String(y.dueDayKey)) ||
        String(x.id).localeCompare(String(y.id)),
    );
}

function spend(bills: FleetBill[], cents: number): { allocations: Allocation[]; left: number } {
  let left = Math.max(0, Math.round(Number(cents) || 0));
  const allocations: Allocation[] = [];
  for (const b of payOrder(bills)) {
    if (left <= 0) break;
    const pay = Math.min(left, remaining(b));
    allocations.push({ billId: b.id, cents: pay });
    left -= pay;
  }
  return { allocations, left };
}

/** Spread a payment over open bills; the leftover becomes driver credit. */
export function allocatePayment(
  openBills: FleetBill[],
  amountCents: number,
): { ok: true; allocations: Allocation[]; creditAddedCents: number } | { ok: false; reason: string } {
  const amount = Number(amountCents);
  if (!Number.isFinite(amount) || Math.round(amount) <= 0) return { ok: false, reason: "fleet_no_amount" };
  const { allocations, left } = spend(openBills, amount);
  return { ok: true, allocations, creditAddedCents: left };
}

/** Use a driver's credit on open bills, same order as a payment. */
export function applyCredit(
  openBills: FleetBill[],
  creditCents: number,
): { allocations: Allocation[]; creditLeftCents: number } {
  const { allocations, left } = spend(openBills, creditCents);
  return { allocations, creditLeftCents: left };
}

/**
 * What a driver owes now. Waived, void and paid bills do not count. nextDue
 * is the soonest bill due today or later (that day's total), else null.
 */
export function driverBalance(
  bills: FleetBill[],
  creditCents: number,
  todayKey: string,
): {
  owedCents: number;
  lateCents: number;
  nextDue: { dueDayKey: string; cents: number } | null;
  creditCents: number;
} {
  let owed = 0;
  let late = 0;
  let nextDay: string | null = null;
  let nextCents = 0;
  for (const b of bills || []) {
    if (b.status !== "open") continue;
    const r = remaining(b);
    if (r <= 0) continue;
    const due = String(b.dueDayKey);
    owed += r;
    if (due < todayKey) {
      late += r;
    } else if (nextDay === null || due < nextDay) {
      nextDay = due;
      nextCents = r;
    } else if (due === nextDay) {
      nextCents += r;
    }
  }
  return {
    owedCents: owed,
    lateCents: late,
    nextDue: nextDay === null ? null : { dueDayKey: nextDay, cents: nextCents },
    creditCents: Math.max(0, Math.round(Number(creditCents) || 0)),
  };
}

/**
 * Personal cents (1-99, unique) for active drivers. A driver holding a valid
 * value nobody earlier holds keeps it; others get the lowest free value.
 * Order is createdAt then id. Beyond 99 drivers the extra get null.
 */
export function assignPersonalCents(
  activeDrivers: { id: string; personalCents?: number | null; createdAt?: number | string | null }[],
): Record<string, number | null> {
  const ordered = [...(activeDrivers || [])].sort((x, y) => {
    const a = Number(x.createdAt);
    const b = Number(y.createdAt);
    const byTime =
      Number.isFinite(a) && Number.isFinite(b)
        ? a - b
        : String(x.createdAt ?? "").localeCompare(String(y.createdAt ?? ""));
    return byTime || String(x.id).localeCompare(String(y.id));
  });
  const taken = new Set<number>();
  const result: Record<string, number | null> = {};
  for (const d of ordered) {
    const v = d.personalCents;
    if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 99 && !taken.has(v)) {
      taken.add(v);
      result[d.id] = v;
    }
  }
  let next = 1;
  for (const d of ordered) {
    if (d.id in result) continue;
    while (next <= 99 && taken.has(next)) next++;
    if (next > 99) {
      result[d.id] = null;
    } else {
      taken.add(next);
      result[d.id] = next;
    }
  }
  return result;
}

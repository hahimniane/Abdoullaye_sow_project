/**
 * Month-end parking bills. Mirrors
 * `my_flutter_app/functions/parking_month_statement.js` - the same numbers,
 * worked out live from the car: that month's days at the rate, anything
 * unpaid from before as its own line, payments applied oldest month first.
 */

import { lotActivityPaidCents } from "./lot-ledger.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
] as const;
export const MONTH_NAMES_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre",
] as const;

type Row = Record<string, unknown>;

const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const v = value as { toDate?: () => Date; seconds?: number };
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The UTC calendar day a moment falls on, as a day number. */
export function dayNumber(value: unknown): number | null {
  const date = toDate(value);
  if (!date) return null;
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS);
}

function dayKeyOf(day: number) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** "Sep 1, 2026" — a day key, US style, for the English text. Mirrors the server's. */
export function dayLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(key, 10));
  const name = match ? MONTH_NAMES_EN[Number(match[2]) - 1] : undefined;
  if (!match || !name) return text(key, 10);
  return `${name.slice(0, 3)} ${Number(match[3])}, ${match[1]}`;
}

export function monthDays(monthKey: string): { first: number; last: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(text(monthKey, 7));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return null;
  return {
    first: Math.floor(Date.UTC(year, month, 1) / DAY_MS),
    last: Math.floor(Date.UTC(year, month + 1, 1) / DAY_MS) - 1,
  };
}

export function previousMonthKey(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(text(monthKey, 7));
  if (!match) return monthKey;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function monthLabel(monthKey: string, language: "en" | "fr" = "en"): string {
  const match = /^(\d{4})-(\d{2})$/.exec(text(monthKey, 7));
  if (!match) return text(monthKey, 7);
  const names = language === "fr" ? MONTH_NAMES_FR : MONTH_NAMES_EN;
  return `${names[Number(match[2]) - 1] ?? ""} ${match[1]}`.trim();
}

function centsOf(row: Row, centsKeys: string[], dollarKeys: string[]) {
  for (const key of centsKeys) {
    const n = Number(row[key]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  for (const key of dollarKeys) {
    const n = Number(row[key]);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100);
  }
  return 0;
}

/** What the stay has run up by the end of a given day, in cents. */
export function accruedThroughCents(row: Row, day: number, today: number): number {
  const start = dayNumber(row.parkingDate);
  if (start === null || day < start) return 0;
  const leave = dayNumber(row.parkingEndDate);
  const end = leave === null ? today : leave;
  if (end < start) return 0;
  const through = Math.min(day, end);
  const days = through - start + 1;
  if (leave === null) {
    const daily = Math.round((Number(row.dailyRate) || 0) * 100);
    return daily > 0 ? days * daily : 0;
  }
  const total = centsOf(row, ["amountDueCents", "totalCostCents"], ["amountDue", "totalCost"]);
  const stayDays = end - start + 1;
  return stayDays > 0 ? Math.round(total * days / stayDays) : 0;
}

function paidCents(row: Row, today: number): number {
  const recorded = Math.round(Number(row.amountPaidCents) || 0);
  if (recorded > 0) return recorded;
  const status = text(row.paymentStatus, 40);
  if (status === "succeeded" || status === "paid") return accruedThroughCents(row, today, today);
  return 0;
}

export type ParkingMonthBill = {
  id: string;
  monthKey: string;
  periodFrom: string;
  periodTo: string;
  days: number;
  dayRateCents: number;
  monthCents: number;
  monthPaidCents: number;
  monthUnpaidCents: number;
  priorUnpaidCents: number;
  dueCents: number;
  owes: boolean;
  stillParked: boolean;
  partialMonth: boolean;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  vehicle: string;
  vinNumber: string;
  trackingCode: string;
  paymentMethod: string;
  /** A payment can be recorded by hand: a direct car the business entered. */
  recordable: boolean;
};

export function parkingMonthStatement(row: Row, monthKey: string, now: Date = new Date()): ParkingMonthBill | null {
  if (text(row.status, 40) === "cancelled") return null;
  // "not_required" is not skipped: open stays were saved that way by mistake
  // while still running up days. A truly free stay runs up $0 and drops out.
  const month = monthDays(monthKey);
  const start = dayNumber(row.parkingDate);
  const today = dayNumber(now);
  if (!month || start === null || today === null) return null;
  const leave = dayNumber(row.parkingEndDate);
  const lastDay = leave === null ? today : leave;
  const from = Math.max(start, month.first);
  const to = Math.min(lastDay, month.last);
  if (to < from) return null;

  const priorCents = accruedThroughCents(row, month.first - 1, today);
  const throughCents = accruedThroughCents(row, to, today);
  const monthCents = Math.max(0, throughCents - priorCents);
  if (monthCents <= 0) return null;

  const paid = paidCents(row, today);
  const priorUnpaidCents = Math.max(0, priorCents - paid);
  const towardMonth = Math.max(0, paid - priorCents);
  const monthPaidCents = Math.min(monthCents, towardMonth);
  const monthUnpaidCents = monthCents - monthPaidCents;
  const days = to - from + 1;

  return {
    id: text(row.id),
    monthKey,
    periodFrom: dayKeyOf(from),
    periodTo: dayKeyOf(to),
    days,
    dayRateCents: Math.round(monthCents / days),
    monthCents,
    monthPaidCents,
    monthUnpaidCents,
    priorUnpaidCents,
    dueCents: priorUnpaidCents + monthUnpaidCents,
    owes: monthUnpaidCents > 0,
    stillParked: lastDay > month.last,
    partialMonth: month.last > today,
    customerName: text(row.customerName) || text(row.ownerName),
    customerPhone: text(row.customerPhone, 40),
    customerEmail: text(row.customerEmail, 180),
    vehicle: [row.carYear, row.carMake, row.carModel].map((v) => text(v, 80)).filter(Boolean).join(" "),
    vinNumber: text(row.vinNumber, 17).toUpperCase(),
    trackingCode: text(row.trackingCode, 40),
    paymentMethod: text(row.paymentMethod, 40),
    recordable: text(row.paymentMethod, 40) === "direct" && (text(row.source, 40) === "business" || row.enteredByBusiness === true),
  };
}

/** One car on a customer's bill: its own bill plus the name it was
 * registered under when that differs from the customer's. */
export type ParkingMonthCar = ParkingMonthBill & { registeredTo: string };
export type ParkingMonthActivityLine = ParkingMonthActivity & { registeredTo: string };

export type ParkingMonthCustomer = {
  key: string;
  monthKey: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  cars: ParkingMonthCar[];
  activities: ParkingMonthActivityLine[];
  olderActivities: ParkingMonthActivityLine[];
  monthCents: number;
  monthPaidCents: number;
  monthUnpaidCents: number;
  priorUnpaidCents: number;
  dueCents: number;
  owes: boolean;
  partialMonth: boolean;
};

/** Who a bill goes to: the phone, last ten digits. Mirrors the server. */
export function parkingCustomerKey(bill: { customerPhone: string; customerName: string }): string {
  const digits = text(bill.customerPhone, 40).replace(/\D+/g, "").slice(-10);
  if (digits.length >= 7) return `phone:${digits}`;
  return `name:${text(bill.customerName).toLowerCase().replace(/\s+/g, " ")}`;
}

const normName = (v: unknown) => text(v).toLowerCase().replace(/\s+/g, " ");

/** The spelling used most often (capitals ignored), capitalised when typed so. */
export function mostUsedName(names: readonly string[]): string {
  const groups = new Map<string, string[]>();
  for (const raw of names) {
    const name = text(raw).replace(/\s+/g, " ");
    if (!name) continue;
    const key = normName(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(name);
  }
  const best = [...groups.entries()].sort((a, b) =>
    b[1].length - a[1].length || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0];
  if (!best) return "";
  const capitalised = (n: string) => n.split(" ").filter((w) => /^[A-ZÀ-Ý]/.test(w)).length;
  return [...best[1]].sort((a, b) => capitalised(b) - capitalised(a))[0];
}

/** One bill per phone: every car with its dates, every activity with its
 * date. Mirrors the server. */
export function parkingMonthCustomers(
  bills: readonly ParkingMonthBill[],
  activities: readonly ParkingMonthActivity[] = [],
): ParkingMonthCustomer[] {
  const groups = new Map<string, { cars: ParkingMonthBill[]; activities: ParkingMonthActivity[] }>();
  const group = (key: string) => {
    if (!groups.has(key)) groups.set(key, { cars: [], activities: [] });
    return groups.get(key)!;
  };
  for (const b of bills) group(parkingCustomerKey(b)).cars.push(b);
  for (const a of activities) group(parkingCustomerKey(a)).activities.push(a);
  const customers: ParkingMonthCustomer[] = [];
  for (const [key, g] of groups) {
    const all = [...g.cars, ...g.activities];
    const customerName = mostUsedName(all.map((x) => x.customerName));
    // Every line says whose name it was registered under, also when it is
    // the name at the top of the bill, so a line never looks unnamed.
    const reg = (name: string) => text(name).replace(/\s+/g, " ");
    const cars: ParkingMonthCar[] = [...g.cars]
      .sort((a, b) => a.periodFrom.localeCompare(b.periodFrom) || a.vehicle.localeCompare(b.vehicle))
      .map((b) => ({ ...b, registeredTo: reg(b.customerName) }));
    const acts: ParkingMonthActivityLine[] = [...g.activities]
      .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
      .map((a) => ({ ...a, registeredTo: reg(a.customerName) }));
    const inMonth = acts.filter((a) => !a.prior);
    const older = acts.filter((a) => a.prior);
    const sumCars = (k: "monthCents" | "monthPaidCents" | "monthUnpaidCents" | "priorUnpaidCents") => cars.reduce((s, b) => s + b[k], 0);
    const sumActs = (list: ParkingMonthActivityLine[], k: "feeCents" | "paidCents" | "dueCents") => list.reduce((s, a) => s + a[k], 0);
    const monthCents = sumCars("monthCents") + sumActs(inMonth, "feeCents");
    const monthPaidCents = sumCars("monthPaidCents") + sumActs(inMonth, "paidCents");
    const monthUnpaidCents = sumCars("monthUnpaidCents") + sumActs(inMonth, "dueCents");
    const priorUnpaidCents = sumCars("priorUnpaidCents") + sumActs(older, "dueCents");
    customers.push({
      key,
      monthKey: (cars[0] ?? acts[0]).monthKey,
      customerName,
      customerPhone: all.find((x) => x.customerPhone)?.customerPhone ?? "",
      customerEmail: all.find((x) => x.customerEmail)?.customerEmail ?? "",
      cars,
      activities: inMonth,
      olderActivities: older,
      monthCents,
      monthPaidCents,
      monthUnpaidCents,
      priorUnpaidCents,
      dueCents: monthUnpaidCents + priorUnpaidCents,
      owes: monthUnpaidCents + priorUnpaidCents > 0,
      partialMonth: cars.some((b) => b.partialMonth),
    });
  }
  return customers.sort((a, b) => b.dueCents - a.dueCents || a.customerName.localeCompare(b.customerName));
}

export type ParkingMonthSummary = {
  monthKey: string;
  carsOnLot: number;
  carsOwing: number;
  activitiesInMonth: number;
  customers: ParkingMonthCustomer[];
  customersOwing: ParkingMonthCustomer[];
  billedCents: number;
  collectedCents: number;
  owedCents: number;
  olderOwedCents: number;
  dueCents: number;
  owing: ParkingMonthBill[];
  bills: ParkingMonthBill[];
};

/** One ledger activity on a month's bill. Mirrors the server. */
export type ParkingMonthActivity = {
  id: string;
  kind: "activity";
  monthKey: string;
  date: string;
  label: string;
  feeCents: number;
  paidCents: number;
  dueCents: number;
  prior: boolean;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  vehicle: string;
  vinNumber: string;
  trackingCode: string;
};

/** An activity dated in the month is that month's; an older one still unpaid
 * comes along as "unpaid from before"; voided and free ones never appear. */
export function activityMonthItem(row: Row, monthKey: string): ParkingMonthActivity | null {
  if (row.voided === true) return null;
  const feeCents = Math.max(0, Math.round(Number(row.feeCents) || 0));
  if (feeCents <= 0) return null;
  const month = monthDays(monthKey);
  const day = dayNumber(row.activityDate) ?? dayNumber(row.createdAt);
  if (!month || day === null || day > month.last) return null;
  const paidCents = Math.min(feeCents, lotActivityPaidCents(row));
  const dueCents = Math.max(0, feeCents - paidCents);
  const prior = day < month.first;
  if (prior && dueCents <= 0) return null;
  const label = text(row.customLabel) || text(row.activityTypeLabel) || "Activity";
  return {
    id: text(row.id),
    kind: "activity",
    monthKey,
    date: dayKeyOf(day),
    label: label.charAt(0).toUpperCase() + label.slice(1),
    feeCents,
    paidCents,
    dueCents,
    prior,
    customerName: text(row.customerName),
    customerPhone: text(row.customerPhone, 40),
    customerEmail: text(row.customerEmail, 180),
    vehicle: [row.carYear, row.carMake, row.carModel].map((v) => text(v, 80)).filter(Boolean).join(" "),
    vinNumber: text(row.vinNumber, 17).toUpperCase(),
    trackingCode: text(row.trackingCode, 40),
  };
}

export function parkingMonthSummary(
  rows: readonly Row[],
  monthKey: string,
  now: Date = new Date(),
  activityRows: readonly Row[] = [],
): ParkingMonthSummary {
  const bills = rows
    .map((row) => parkingMonthStatement(row, monthKey, now))
    .filter((b): b is ParkingMonthBill => b !== null);
  const activities = activityRows
    .map((row) => activityMonthItem(row, monthKey))
    .filter((a): a is ParkingMonthActivity => a !== null);
  const owing = bills
    .filter((b) => b.owes)
    .sort((a, b) => b.dueCents - a.dueCents || a.customerName.localeCompare(b.customerName));
  const inMonth = activities.filter((a) => !a.prior);
  const sumBills = (k: "monthCents" | "monthPaidCents" | "monthUnpaidCents") => bills.reduce((s, b) => s + b[k], 0);
  const sumActs = (k: "feeCents" | "paidCents" | "dueCents") => inMonth.reduce((s, a) => s + a[k], 0);
  const customers = parkingMonthCustomers(bills, activities);
  const customersOwing = customers.filter((c) => c.owes);
  return {
    monthKey,
    carsOnLot: bills.length,
    carsOwing: owing.length,
    activitiesInMonth: inMonth.length,
    customers,
    customersOwing,
    billedCents: sumBills("monthCents") + sumActs("feeCents"),
    collectedCents: sumBills("monthPaidCents") + sumActs("paidCents"),
    owedCents: sumBills("monthUnpaidCents") + sumActs("dueCents"),
    olderOwedCents: customersOwing.reduce((s, c) => s + c.priorUnpaidCents, 0),
    dueCents: customersOwing.reduce((s, c) => s + c.dueCents, 0),
    owing,
    bills,
  };
}

/**
 * [start, end) of a "yyyy-mm" month in UTC milliseconds, or null. Mirrors
 * `monthBoundsMs` in my_flutter_app/functions/parking_month_statement.js.
 */
export function parkingMonthBoundsMs(monthKey: string): { startMs: number; endMs: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { startMs: Date.UTC(year, month - 1, 1), endMs: Date.UTC(year, month, 1) };
}

/**
 * The narrow reads a month's bills need - the same four the month-end notice
 * makes on the server (notifyParkingMonthEndFor), never the lot's history:
 *  - stays that end on or after the month starts (`occupancyEndMs`; the
 *    statement drops the ones that start after it);
 *  - activities dated in the month;
 *  - older activities not yet settled (they come along as "unpaid from
 *    before"; a settled one never appears);
 *  - the rare undated activities the statement dates by createdAt.
 * Each is complete (no cap): the month bounds it. Pure, so the replay test
 * can prove the narrow reads give the whole-history summary.
 */
export function parkingMonthQueryPlan(monthKey: string): {
  cars: { where: [string, ">=", number][] };
  inMonth: { where: [string, ">=" | "<", Date][]; orderBy: "activityDate"; direction: "desc" };
  unsettled: { where: [string, "!=", string][] };
  undated: { where: [string, "==", null][] };
} | null {
  const bounds = parkingMonthBoundsMs(monthKey);
  if (!bounds) return null;
  return {
    cars: { where: [["occupancyEndMs", ">=", bounds.startMs]] },
    inMonth: {
      where: [["activityDate", ">=", new Date(bounds.startMs)], ["activityDate", "<", new Date(bounds.endMs)]],
      orderBy: "activityDate",
      direction: "desc",
    },
    unsettled: { where: [["paymentStatus", "!=", "succeeded"]] },
    undated: { where: [["activityDate", "==", null]] },
  };
}

export function moneyText(cents: number): string {
  const n = Math.round(Number(cents) || 0);
  const whole = Math.trunc(Math.abs(n) / 100);
  const part = String(Math.abs(n) % 100).padStart(2, "0");
  return `${n < 0 ? "-" : ""}$${whole.toLocaleString("en-US")}.${part}`;
}

/** One customer's bill as WhatsApp text. Mirrors the server's byte for byte. */
export function parkingMonthCustomerText(c: ParkingMonthCustomer, businessName: string): string {
  const month = MONTH_NAMES_EN[Number(c.monthKey.slice(5, 7)) - 1] ?? "the month";
  const lines = [
    `${text(businessName) || "Parking"} — Monthly bill, ${monthLabel(c.monthKey)}`,
    `For: ${[c.customerName || "—", c.customerPhone].filter(Boolean).join(" · ")}`,
  ];
  const named = (x: { registeredTo: string }) => (x.registeredTo ? ` (registered to ${x.registeredTo})` : "");
  if (c.cars.length) lines.push("", "Parking");
  for (const b of c.cars) {
    lines.push([b.vehicle || "Car", b.vinNumber ? `VIN ${b.vinNumber}` : ""].filter(Boolean).join(" · ") + named(b));
    lines.push(`  ${dayLabel(b.periodFrom)} to ${dayLabel(b.periodTo)}: ${b.days} day${b.days === 1 ? "" : "s"} × ${moneyText(b.dayRateCents)} — ${moneyText(b.monthCents)}`);
    if (b.priorUnpaidCents > 0) lines.push(`  Unpaid from before — ${moneyText(b.priorUnpaidCents)}`);
    if (b.monthPaidCents > 0) lines.push(`  Paid — -${moneyText(b.monthPaidCents)}`);
  }
  if (c.activities.length) lines.push("", "Activities");
  for (const a of c.activities) {
    lines.push(`${dayLabel(a.date)} · ${a.label}${a.vehicle ? ` · ${a.vehicle}` : ""}${named(a)} — ${moneyText(a.feeCents)}`);
    if (a.paidCents > 0) lines.push(`  Paid — -${moneyText(a.paidCents)}`);
  }
  if (c.olderActivities.length) {
    lines.push("", "Unpaid from before");
    for (const a of c.olderActivities) {
      lines.push(`${dayLabel(a.date)} · ${a.label}${a.vehicle ? ` · ${a.vehicle}` : ""}${named(a)} — ${moneyText(a.dueCents)}`);
    }
  }
  lines.push("", `Total for ${month} — ${moneyText(c.monthCents)}`);
  if (c.priorUnpaidCents > 0) lines.push(`Unpaid from before — ${moneyText(c.priorUnpaidCents)}`);
  if (c.monthPaidCents > 0) lines.push(`Paid — -${moneyText(c.monthPaidCents)}`);
  lines.push(c.dueCents > 0 ? `BALANCE DUE: ${moneyText(c.dueCents)}` : "PAID IN FULL");
  return lines.join("\n");
}

/** The WhatsApp text. Mirrors the server's byte for byte. */
export function parkingMonthBillText(bill: ParkingMonthBill, businessName: string): string {
  const lines = [
    `${text(businessName) || "Parking"} — Parking bill, ${monthLabel(bill.monthKey)}`,
    `For: ${bill.customerName || "—"}`,
  ];
  const car = [bill.vehicle, bill.vinNumber ? `VIN ${bill.vinNumber}` : ""].filter(Boolean).join(" · ");
  if (car) lines.push(car);
  lines.push("", `${dayLabel(bill.periodFrom)} to ${dayLabel(bill.periodTo)}: ${bill.days} day${bill.days === 1 ? "" : "s"} × ${moneyText(bill.dayRateCents)} — ${moneyText(bill.monthCents)}`);
  if (bill.priorUnpaidCents > 0) lines.push(`Unpaid from before — ${moneyText(bill.priorUnpaidCents)}`);
  if (bill.monthPaidCents > 0) lines.push(`Paid — -${moneyText(bill.monthPaidCents)}`);
  lines.push(bill.dueCents > 0 ? `BALANCE DUE: ${moneyText(bill.dueCents)}` : "PAID IN FULL");
  return lines.join("\n");
}

export type MonthBillPaymentItem = { kind: "car" | "activity"; id: string; label: string; amountCents: number };

/** "Mark all paid": what to record against each line, through the payment
 * each line already takes. Payment-link cars are Stripe's. Mirrors the server. */
export function monthBillPaymentPlan(c: ParkingMonthCustomer): {
  items: MonthBillPaymentItem[];
  skipped: (MonthBillPaymentItem & { reason: "payment_link" | "online" })[];
  totalCents: number;
} {
  const items: MonthBillPaymentItem[] = [];
  const skipped: (MonthBillPaymentItem & { reason: "payment_link" | "online" })[] = [];
  for (const b of c.cars) {
    if (b.dueCents <= 0) continue;
    const entry: MonthBillPaymentItem = { kind: "car", id: b.id, label: b.vehicle || "Car", amountCents: b.dueCents };
    if (!b.recordable) skipped.push({ ...entry, reason: b.paymentMethod === "payment_link" ? "payment_link" : "online" });
    else items.push(entry);
  }
  for (const a of [...c.activities, ...c.olderActivities]) {
    if (a.dueCents <= 0) continue;
    items.push({ kind: "activity", id: a.id, label: `${a.label}${a.vehicle ? ` · ${a.vehicle}` : ""} (${dayLabel(a.date)})`, amountCents: a.dueCents });
  }
  return { items, skipped, totalCents: items.reduce((s, x) => s + x.amountCents, 0) };
}


/**
 * Month-end parking bills. Mirrors
 * `my_flutter_app/functions/parking_month_statement.js` - the same numbers,
 * worked out live from the car: that month's days at the rate, anything
 * unpaid from before as its own line, payments applied oldest month first.
 */

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
};

export function parkingMonthStatement(row: Row, monthKey: string, now: Date = new Date()): ParkingMonthBill | null {
  if (text(row.status, 40) === "cancelled") return null;
  if (text(row.paymentStatus, 40) === "not_required") return null;
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
  };
}

/** One car on a customer's bill: its own bill plus the name it was
 * registered under when that differs from the customer's. */
export type ParkingMonthCar = ParkingMonthBill & { registeredTo: string };

export type ParkingMonthCustomer = {
  key: string;
  monthKey: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  cars: ParkingMonthCar[];
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

/** One bill per phone, every car on it with its dates. Mirrors the server. */
export function parkingMonthCustomers(bills: readonly ParkingMonthBill[]): ParkingMonthCustomer[] {
  const groups = new Map<string, ParkingMonthBill[]>();
  for (const bill of bills) {
    const key = parkingCustomerKey(bill);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(bill);
  }
  const customers: ParkingMonthCustomer[] = [];
  for (const [key, list] of groups) {
    const customerName = mostUsedName(list.map((b) => b.customerName));
    const cars: ParkingMonthCar[] = [...list]
      .sort((a, b) => a.periodFrom.localeCompare(b.periodFrom) || a.vehicle.localeCompare(b.vehicle))
      .map((b) => ({ ...b, registeredTo: normName(b.customerName) === normName(customerName) ? "" : b.customerName }));
    const sum = (k: "monthCents" | "monthPaidCents" | "monthUnpaidCents" | "priorUnpaidCents" | "dueCents") =>
      cars.reduce((s, b) => s + b[k], 0);
    customers.push({
      key,
      monthKey: cars[0].monthKey,
      customerName,
      customerPhone: cars.find((b) => b.customerPhone)?.customerPhone ?? "",
      customerEmail: cars.find((b) => b.customerEmail)?.customerEmail ?? "",
      cars,
      monthCents: sum("monthCents"),
      monthPaidCents: sum("monthPaidCents"),
      monthUnpaidCents: sum("monthUnpaidCents"),
      priorUnpaidCents: sum("priorUnpaidCents"),
      dueCents: sum("dueCents"),
      owes: cars.some((b) => b.owes),
      partialMonth: cars.some((b) => b.partialMonth),
    });
  }
  return customers.sort((a, b) => b.dueCents - a.dueCents || a.customerName.localeCompare(b.customerName));
}

export type ParkingMonthSummary = {
  monthKey: string;
  carsOnLot: number;
  carsOwing: number;
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

export function parkingMonthSummary(rows: readonly Row[], monthKey: string, now: Date = new Date()): ParkingMonthSummary {
  const bills = rows
    .map((row) => parkingMonthStatement(row, monthKey, now))
    .filter((b): b is ParkingMonthBill => b !== null);
  const owing = bills
    .filter((b) => b.owes)
    .sort((a, b) => b.dueCents - a.dueCents || a.customerName.localeCompare(b.customerName));
  const sum = (list: ParkingMonthBill[], key: keyof ParkingMonthBill) =>
    list.reduce((s, b) => s + (b[key] as number), 0);
  const customers = parkingMonthCustomers(bills);
  return {
    monthKey,
    carsOnLot: bills.length,
    carsOwing: owing.length,
    customers,
    customersOwing: customers.filter((c) => c.owes),
    billedCents: sum(bills, "monthCents"),
    collectedCents: sum(bills, "monthPaidCents"),
    owedCents: sum(bills, "monthUnpaidCents"),
    olderOwedCents: sum(owing, "priorUnpaidCents"),
    dueCents: sum(owing, "dueCents"),
    owing,
    bills,
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
  const lines = [
    `${text(businessName) || "Parking"} — Parking bill, ${monthLabel(c.monthKey)}`,
    `For: ${[c.customerName || "—", c.customerPhone].filter(Boolean).join(" · ")}`,
    "",
  ];
  for (const b of c.cars) {
    const car = [b.vehicle || "Car", b.vinNumber ? `VIN ${b.vinNumber}` : ""].filter(Boolean).join(" · ");
    lines.push(car + (b.registeredTo ? ` (registered to ${b.registeredTo})` : ""));
    lines.push(`  ${b.periodFrom} to ${b.periodTo}: ${b.days} day${b.days === 1 ? "" : "s"} × ${moneyText(b.dayRateCents)} — ${moneyText(b.monthCents)}`);
  }
  lines.push("", `Total for ${MONTH_NAMES_EN[Number(c.monthKey.slice(5, 7)) - 1] ?? "the month"} — ${moneyText(c.monthCents)}`);
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
  lines.push("", `${bill.periodFrom} to ${bill.periodTo}: ${bill.days} day${bill.days === 1 ? "" : "s"} × ${moneyText(bill.dayRateCents)} — ${moneyText(bill.monthCents)}`);
  if (bill.priorUnpaidCents > 0) lines.push(`Unpaid from before — ${moneyText(bill.priorUnpaidCents)}`);
  if (bill.monthPaidCents > 0) lines.push(`Paid — -${moneyText(bill.monthPaidCents)}`);
  lines.push(bill.dueCents > 0 ? `BALANCE DUE: ${moneyText(bill.dueCents)}` : "PAID IN FULL");
  return lines.join("\n");
}

/**
 * Fleet (TLC plate leasing) console logic (docs/FLEET.md section 6). Pure:
 * no React, no Firebase, no clock of its own (callers pass day keys). The
 * billing rules themselves live in fleet-billing.ts; this file turns the five
 * Fleet collections into what the pages show, once per snapshot, never per
 * render of a row.
 *
 * Day keys are "YYYY-MM-DD" (America/New_York); money is integer cents.
 */

import { driverBalance, type FleetAssignment, type FleetBill } from "./fleet-billing.ts";

type Row = Record<string, unknown> & { id: string };

/** The server's refusal sentences (my_flutter_app/functions/fleet_handlers.js FLEET_REFUSALS). */
export const FLEET_REFUSALS: Record<string, string> = {
  fleet_off: "Fleet is not switched on for this business.",
  fleet_admin_only: "Only a Fleet admin can do this.",
  fleet_not_found: "That record was not found.",
  fleet_car_taken: "This car already has a driver. Return it first.",
  fleet_bad_input: "Some details are missing or not valid.",
  fleet_no_amount: "Enter an amount.",
  fleet_already_undone: "That payment was already undone.",
  fleet_not_open: "Only an open bill can be waived.",
  fleet_reason_required: "Say why.",
  fleet_staff_only: "This staff account is not allowed to manage Fleet.",
};

/** The sentence to show for a failed Fleet call: the server's reason, else its message, else a fallback. */
export function fleetErrorMessage(error: unknown): string {
  const e = error as { details?: { reason?: unknown }; message?: unknown } | null;
  const reason = String(e?.details?.reason ?? "");
  if (reason && FLEET_REFUSALS[reason]) return FLEET_REFUSALS[reason];
  const message = String(e?.message ?? "").trim();
  return message || "Something went wrong. Try again.";
}

// ---------------------------------------------------------------------------
// Days and months.
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

function dayNumber(key: string): number {
  const [y, m, d] = String(key).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Today in New York as a day key. */
export function newYorkDayKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const monthOf = (dayKey: string): string => String(dayKey || "").slice(0, 7);

/** The month key n months from a month key (n may be negative). */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** `count` months ending at `lastMonth`, oldest first (current month last). */
export function monthWindow(lastMonth: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftMonth(lastMonth, -i));
  return out;
}

/** "Nov 2026" in English, "nov. 2026" in French; read as that exact month in any time zone. */
export function monthLabel(month: string, language: "en" | "fr" = "en"): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, (m || 1) - 1, 1)));
}

/** Whole days from `fromKey` to `toKey` (negative when toKey is earlier). */
export function daysBetween(fromKey: string, toKey: string): number {
  return dayNumber(toKey) - dayNumber(fromKey);
}

// ---------------------------------------------------------------------------
// Money typed by a person.
// ---------------------------------------------------------------------------

/** "1,200.50" or "$1200" to cents; null when it is not a positive-or-zero amount. */
export function dollarsToCents(input: string): number | null {
  const cleaned = String(input ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Cents as the plain number a text box shows: 120050 -> "1200.50", 120000 -> "1200". */
export function centsToInput(cents: unknown): string {
  const n = Math.round(Number(cents) || 0);
  if (n === 0) return "";
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
}

/**
 * The Zelle amount a driver pays: the dollars owed plus their personal cents,
 * so the amount itself is the code ("Pays $1,200.07"). Null with no code.
 */
export function zelleAmountText(owedCents: number, personalCents: unknown): string | null {
  const p = Number(personalCents);
  if (!Number.isInteger(p) || p < 1 || p > 99) return null;
  const dollars = Math.floor(Math.max(0, Number(owedCents) || 0) / 100);
  return `$${dollars.toLocaleString("en-US")}.${String(p).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// The Fleet data, indexed once.
// ---------------------------------------------------------------------------

export type FleetData = {
  drivers: Row[];
  cars: Row[];
  assignments: Row[];
  bills: Row[];
  payments: Row[];
};

export type FleetIndex = {
  driverById: Map<string, Row>;
  carById: Map<string, Row>;
  billsByDriver: Map<string, FleetBill[]>;
  paymentsByDriver: Map<string, Row[]>;
  assignmentsByDriver: Map<string, Row[]>;
  assignmentsByCar: Map<string, Row[]>;
  /** carId -> the open assignment (no end day). */
  currentByCar: Map<string, Row>;
  /** driverId -> the open assignment. */
  currentByDriver: Map<string, Row>;
};

function pushTo<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Groups every collection by driver/car in one pass. */
export function indexFleet(data: FleetData): FleetIndex {
  const index: FleetIndex = {
    driverById: new Map(),
    carById: new Map(),
    billsByDriver: new Map(),
    paymentsByDriver: new Map(),
    assignmentsByDriver: new Map(),
    assignmentsByCar: new Map(),
    currentByCar: new Map(),
    currentByDriver: new Map(),
  };
  for (const d of data.drivers) index.driverById.set(d.id, d);
  for (const c of data.cars) index.carById.set(c.id, c);
  for (const b of data.bills) pushTo(index.billsByDriver, String(b.driverId), b as unknown as FleetBill);
  for (const p of data.payments) pushTo(index.paymentsByDriver, String(p.driverId), p);
  for (const a of data.assignments) {
    pushTo(index.assignmentsByDriver, String(a.driverId), a);
    pushTo(index.assignmentsByCar, String(a.carId), a);
    if (!a.endDayKey) {
      index.currentByCar.set(String(a.carId), a);
      index.currentByDriver.set(String(a.driverId), a);
    }
  }
  return index;
}

const str = (v: unknown): string => String(v ?? "").trim();
const num = (v: unknown): number => Math.round(Number(v) || 0);

// ---------------------------------------------------------------------------
// Payments grid.
// ---------------------------------------------------------------------------

export type CellState = "full" | "part" | "owed" | "none";
export type GridCell = { month: string; paidCents: number; dueCents: number; state: CellState };
export type GridRow = { driverId: string; name: string; search: string; cells: GridCell[]; totalCents: number };
export type PaymentsGrid = { months: string[]; rows: GridRow[]; totals: number[]; grandTotalCents: number };

/**
 * One row per driver, one column per month. A cell is what the driver paid
 * that month (recorded payments by paid day). Its colour comes from that
 * month's rent bills (by due day): paid in full, part, owed, or - with no rent
 * bill that month (history) - paid when they paid and empty when they did not.
 * Drivers who left show only when they have something in the window.
 */
export function paymentsGrid(data: FleetData, months: string[]): PaymentsGrid {
  const shown = new Set(months);
  const position = new Map(months.map((m, i) => [m, i]));
  const paid = new Map<string, number[]>();
  for (const p of data.payments) {
    if (p.status !== "recorded") continue;
    const at = position.get(monthOf(str(p.paidDayKey)));
    if (at === undefined) continue;
    const key = str(p.driverId);
    const row = paid.get(key) ?? new Array(months.length).fill(0);
    row[at] += num(p.amountCents);
    paid.set(key, row);
  }
  const due = new Map<string, { due: number[]; paid: number[] }>();
  for (const b of data.bills) {
    if (b.kind !== "rent" || b.status === "void" || b.status === "waived") continue;
    const month = monthOf(str(b.dueDayKey));
    if (!shown.has(month)) continue;
    const at = position.get(month) as number;
    const key = str(b.driverId);
    const row = due.get(key) ?? { due: new Array(months.length).fill(0), paid: new Array(months.length).fill(0) };
    row.due[at] += num(b.amountCents);
    row.paid[at] += num(b.paidCents);
    due.set(key, row);
  }
  const plateOfCar = new Map(data.cars.map((c) => [c.id, str(c.plate)]));
  const plateOfDriver = new Map<string, string>();
  for (const a of data.assignments) if (!a.endDayKey) plateOfDriver.set(str(a.driverId), plateOfCar.get(str(a.carId)) ?? "");
  const totals = new Array(months.length).fill(0);
  const rows: GridRow[] = [];
  for (const d of data.drivers) {
    const p = paid.get(d.id);
    const b = due.get(d.id);
    const cells: GridCell[] = months.map((month, i) => {
      const paidCents = p?.[i] ?? 0;
      const dueCents = b?.due[i] ?? 0;
      let state: CellState = "none";
      if (dueCents > 0) {
        const billPaid = b?.paid[i] ?? 0;
        state = billPaid >= dueCents ? "full" : billPaid > 0 || paidCents > 0 ? "part" : "owed";
      } else if (paidCents > 0) {
        state = "full";
      }
      return { month, paidCents, dueCents, state };
    });
    const active = cells.some((c) => c.paidCents > 0 || c.dueCents > 0);
    if (d.status === "left" && !active) continue;
    let total = 0;
    cells.forEach((c, i) => {
      totals[i] += c.paidCents;
      total += c.paidCents;
    });
    rows.push({ driverId: d.id, name: str(d.name), search: driverSearchText(d, plateOfDriver.get(d.id)), cells, totalCents: total });
  }
  rows.sort((x, y) => x.name.localeCompare(y.name));
  return { months, rows, totals, grandTotalCents: totals.reduce((a, b) => a + b, 0) };
}

// ---------------------------------------------------------------------------
// Drivers, cars.
// ---------------------------------------------------------------------------

function driverSearchText(driver: Row, plate: string | undefined): string {
  return [driver.name, driver.phone, plate].map((v) => str(v).toLowerCase()).join(" ");
}

/** Whether a lowercase haystack holds every word typed. */
export function matchesSearch(haystack: string, needle: string): boolean {
  const words = needle.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => haystack.includes(w));
}

export type DriverRow = {
  id: string;
  name: string;
  phone: string;
  status: string;
  plate: string;
  carId: string;
  owedCents: number;
  lateCents: number;
  creditCents: number;
  personalCents: number | null;
  search: string;
};

export function driverRows(data: FleetData, index: FleetIndex, todayKey: string): DriverRow[] {
  const rows = data.drivers.map((d): DriverRow => {
    const current = index.currentByDriver.get(d.id);
    const car = current ? index.carById.get(String(current.carId)) : undefined;
    const plate = str(car?.plate);
    const balance = driverBalance(index.billsByDriver.get(d.id) ?? [], num(d.creditCents), todayKey);
    const personal = Number(d.personalCents);
    return {
      id: d.id,
      name: str(d.name),
      phone: str(d.phone),
      status: str(d.status) || "active",
      plate,
      carId: car?.id ?? "",
      owedCents: balance.owedCents,
      lateCents: balance.lateCents,
      creditCents: balance.creditCents,
      personalCents: Number.isInteger(personal) && personal >= 1 ? personal : null,
      search: driverSearchText(d, plate),
    };
  });
  rows.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1));
  return rows;
}

export type Expiry = "missing" | "expired" | "soon" | "ok";

/** A car paper's state: past, within 60 days, not entered, or fine. */
export function expiryState(dayKey: unknown, todayKey: string, soonDays = 60): Expiry {
  const key = str(dayKey);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "missing";
  const left = daysBetween(todayKey, key);
  if (left < 0) return "expired";
  return left <= soonDays ? "soon" : "ok";
}

export type CarRow = {
  id: string;
  plate: string;
  company: string;
  status: string;
  driverId: string;
  driverName: string;
  registrationExpiry: string;
  diamondExpiry: string;
  registration: Expiry;
  diamond: Expiry;
  search: string;
};

export function carRows(data: FleetData, index: FleetIndex, todayKey: string): CarRow[] {
  const rows = data.cars.map((c): CarRow => {
    const current = index.currentByCar.get(c.id);
    const driver = current ? index.driverById.get(String(current.driverId)) : undefined;
    const plate = str(c.plate);
    return {
      id: c.id,
      plate,
      company: str(c.company),
      status: current ? "active" : "inactive",
      driverId: driver?.id ?? "",
      driverName: str(driver?.name),
      registrationExpiry: str(c.registrationExpiry),
      diamondExpiry: str(c.diamondExpiry),
      registration: expiryState(c.registrationExpiry, todayKey),
      diamond: expiryState(c.diamondExpiry, todayKey),
      search: [plate, c.company, c.vehicleType, driver?.name].map((v) => str(v).toLowerCase()).join(" "),
    };
  });
  rows.sort((a, b) => a.plate.localeCompare(b.plate));
  return rows;
}

const SEVERITY: Record<Expiry, number> = { expired: 0, soon: 1, missing: 2, ok: 3 };

export type PaperworkRow = CarRow & { worst: Expiry; soonestKey: string };

/** Cars by the soonest of registration/diamond expiry; cars with no date at all last. */
export function paperworkRows(cars: CarRow[]): PaperworkRow[] {
  const rows = cars.map((c): PaperworkRow => {
    const dates = [c.registrationExpiry, c.diamondExpiry].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const worst = (SEVERITY[c.registration] <= SEVERITY[c.diamond] ? c.registration : c.diamond) as Expiry;
    return { ...c, worst, soonestKey: dates[0] ?? "" };
  });
  rows.sort((a, b) => {
    if (!a.soonestKey !== !b.soonestKey) return a.soonestKey ? -1 : 1;
    return a.soonestKey.localeCompare(b.soonestKey) || a.plate.localeCompare(b.plate);
  });
  return rows;
}

export function paperworkCounts(rows: PaperworkRow[]): Record<Expiry, number> {
  const counts: Record<Expiry, number> = { expired: 0, soon: 0, missing: 0, ok: 0 };
  for (const r of rows) counts[r.worst] += 1;
  return counts;
}

export type TimelineEntry = {
  id: string;
  driverId: string;
  driverName: string;
  startDayKey: string;
  endDayKey: string;
  rentCents: number;
  period: string;
};

/** Who had a car and when, newest first. */
export function carTimeline(carId: string, index: FleetIndex): TimelineEntry[] {
  return (index.assignmentsByCar.get(carId) ?? [])
    .map((a) => ({
      id: a.id,
      driverId: str(a.driverId),
      driverName: str(index.driverById.get(str(a.driverId))?.name),
      startDayKey: str(a.startDayKey),
      endDayKey: str(a.endDayKey),
      rentCents: num(a.rentCents),
      period: str(a.period),
    }))
    .sort((a, b) => b.startDayKey.localeCompare(a.startDayKey));
}

/** Cars with no driver now (the ones "Give a car" may pick). */
export function freeCars(data: FleetData, index: FleetIndex): Row[] {
  return data.cars
    .filter((c) => !index.currentByCar.has(c.id))
    .sort((a, b) => str(a.plate).localeCompare(str(b.plate)));
}

// ---------------------------------------------------------------------------
// Tiles (Payments page and Today).
// ---------------------------------------------------------------------------

export type FleetTiles = { collectedCents: number; owedCents: number; lateDrivers: number };

/** Collected this month, owed now, and how many drivers have a late bill. */
export function fleetTiles(data: FleetData, index: FleetIndex, todayKey: string): FleetTiles {
  const month = monthOf(todayKey);
  let collected = 0;
  for (const p of data.payments) {
    if (p.status === "recorded" && monthOf(str(p.paidDayKey)) === month) collected += num(p.amountCents);
  }
  let owed = 0;
  let late = 0;
  for (const d of data.drivers) {
    const b = driverBalance(index.billsByDriver.get(d.id) ?? [], num(d.creditCents), todayKey);
    owed += b.owedCents;
    if (b.lateCents > 0) late += 1;
  }
  return { collectedCents: collected, owedCents: owed, lateDrivers: late };
}

/** The assignment the end-of-rent rule applies to, in a sentence. */
export function returnRuleText(rule: unknown): string {
  return rule === "days"
    ? "A car returned mid-period is billed for the days used."
    : "A car returned mid-period is billed the full period.";
}

// ---------------------------------------------------------------------------
// Whether Fleet is on, and who may do what.
// ---------------------------------------------------------------------------

/** Fleet is on when the business doc says so or lists the service. */
export function fleetEnabled(business: Record<string, unknown> | null | undefined): boolean {
  const fleet = business?.fleet as { enabled?: unknown } | undefined;
  if (fleet?.enabled === true) return true;
  return Array.isArray(business?.enabledServices) && business.enabledServices.some((s) => String(s) === "fleet");
}

export type FleetSettingsView = {
  lateFeeCents: number;
  lateFeeDay: number;
  lateFeeFirstMonth: string;
  returnRule: "full" | "days";
  driversSeeOnly: boolean;
  zelleName: string;
  zelleHandle: string;
};

/** The business's Fleet settings with their defaults (drivers-see-only is on unless turned off). */
export function readFleetSettings(business: Record<string, unknown> | null | undefined): FleetSettingsView {
  const s = ((business?.fleet as { settings?: Record<string, unknown> } | undefined)?.settings ?? {}) as Record<
    string,
    Record<string, unknown> | unknown
  >;
  const lateFee = (s.lateFee ?? {}) as Record<string, unknown>;
  const zelle = (s.zelle ?? {}) as Record<string, unknown>;
  return {
    lateFeeCents: num(lateFee.cents),
    lateFeeDay: num(lateFee.dayOfMonth) || 5,
    lateFeeFirstMonth: str(lateFee.firstMonth),
    returnRule: s.returnRule === "days" ? "days" : "full",
    driversSeeOnly: s.driversSeeOnlyThisBusiness !== false,
    zelleName: str(zelle.name),
    zelleHandle: str(zelle.handle),
  };
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180) for the spreadsheet import.
// ---------------------------------------------------------------------------

/**
 * Parses CSV text into rows of cells. Handles quoted fields holding commas,
 * doubled quotes and line breaks, CRLF/LF/CR endings and a leading BOM. Empty
 * rows at the end are dropped; empty rows in the middle stay, so column and
 * row positions are exactly the sheet's.
 */
export function parseCsv(input: string): string[][] {
  const text = String(input ?? "").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      started = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      started = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      started = false;
    } else {
      field += ch;
      started = true;
    }
  }
  if (started || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}

export type ImportPreview = {
  drivers: number;
  cars: number;
  assignments: number;
  payments: number;
  bills: number;
  paymentsCents: number;
  ownedBillsCents: number;
  warnings: { row: number; field: string; message: string }[];
};

/** Reads the server's dry-run answer into what the screen shows (missing parts read as zero). */
export function readImportPreview(result: unknown): ImportPreview {
  const r = (result ?? {}) as {
    counts?: Record<string, unknown>;
    totals?: Record<string, unknown>;
    warnings?: unknown;
  };
  const counts = r.counts ?? {};
  const totals = r.totals ?? {};
  const warnings = Array.isArray(r.warnings) ? r.warnings : [];
  return {
    drivers: num(counts.drivers),
    cars: num(counts.cars),
    assignments: num(counts.assignments),
    payments: num(counts.payments),
    bills: num(counts.bills),
    paymentsCents: num(totals.paymentsCents),
    ownedBillsCents: num(totals.ownedBillsCents),
    warnings: warnings.map((w) => {
      const x = (w ?? {}) as Record<string, unknown>;
      return { row: num(x.row), field: str(x.field), message: str(x.message) };
    }),
  };
}

export type { FleetAssignment, FleetBill };

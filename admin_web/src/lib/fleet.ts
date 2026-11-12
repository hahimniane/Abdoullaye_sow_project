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
  fleet_import_locked: "A payment brought in from the spreadsheet cannot be undone here.",
  fleet_friend_overlap: "Another friend already has this car on those days.",
  fleet_note_empty: "Write a note or attach a file.",
  fleet_note_voided: "That note was already removed.",
  fleet_bad_file: "A file is not allowed (images or PDF, up to 10 MB).",
  fleet_staff_only:"This staff account is not allowed to manage Fleet.",
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
  /** Office notes and files (fleetNotes), oldest to newest does not matter. */
  notes?: Row[];
  /** Friends who drove a car (fleetSubstitutes). */
  substitutes?: Row[];
};

export type FleetIndex = {
  /** driverId -> office notes (voided ones included, shown greyed). */
  notesByDriver: Map<string, Row[]>;
  /** driverId -> friend periods (voided ones included). */
  substitutesByDriver: Map<string, Row[]>;
  /** carId -> friend periods (voided ones included). */
  substitutesByCar: Map<string, Row[]>;
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
    notesByDriver: new Map(),
    substitutesByDriver: new Map(),
    substitutesByCar: new Map(),
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
  for (const n of data.notes ?? []) pushTo(index.notesByDriver, String(n.driverId), n);
  for (const f of data.substitutes ?? []) {
    pushTo(index.substitutesByDriver, String(f.driverId), f);
    pushTo(index.substitutesByCar, String(f.carId), f);
  }
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
  /** The current car's plate fee (rent), 0 when none is set or no car. */
  rentCents: number;
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
      rentCents: current ? Math.max(0, num(current.rentCents)) : 0,
      search: driverSearchText(d, plate),
    };
  });
  rows.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1));
  return rows;
}

// ---------------------------------------------------------------------------
// The Drivers list's filters (owner, 2026-11-12): who is active, who owes,
// who is late, who has credit, no car, no plate fee, and the order.

export type DriverView = "active" | "left" | "all";
export type DriverSort = "name" | "owed" | "cents";
export type DriverFilter = {
  view: DriverView;
  owes: boolean;
  late: boolean;
  credit: boolean;
  noCar: boolean;
  noFee: boolean;
  query: string;
  sort: DriverSort;
};

export const emptyDriverFilter: DriverFilter = {
  view: "active", owes: false, late: false, credit: false, noCar: false, noFee: false, query: "", sort: "name",
};

const isActive = (r: DriverRow) => r.status === "active";
const driverChecks = {
  owes: (r: DriverRow) => r.owedCents > 0,
  late: (r: DriverRow) => r.lateCents > 0,
  credit: (r: DriverRow) => r.creditCents > 0,
  noCar: (r: DriverRow) => isActive(r) && !r.carId,
  noFee: (r: DriverRow) => isActive(r) && Boolean(r.carId) && r.rentCents <= 0,
};

function inDriverView(r: DriverRow, view: DriverView): boolean {
  if (view === "active") return isActive(r);
  if (view === "left") return !isActive(r);
  return true;
}

/** The rows on screen: the view, every chip, the search, in the chosen order. */
export function filterDriverRows(rows: readonly DriverRow[], f: DriverFilter): DriverRow[] {
  const query = f.query.trim();
  const out = rows.filter(
    (r) =>
      inDriverView(r, f.view) &&
      (!f.owes || driverChecks.owes(r)) &&
      (!f.late || driverChecks.late(r)) &&
      (!f.credit || driverChecks.credit(r)) &&
      (!f.noCar || driverChecks.noCar(r)) &&
      (!f.noFee || driverChecks.noFee(r)) &&
      (!query || matchesSearch(r.search, query)),
  );
  const byName = (a: DriverRow, b: DriverRow) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  if (f.sort === "owed") return out.sort((a, b) => b.owedCents - a.owedCents || byName(a, b));
  if (f.sort === "cents") return out.sort((a, b) => (a.personalCents ?? 100) - (b.personalCents ?? 100) || byName(a, b));
  return out.sort(byName);
}

export type DriverCounts = { active: number; left: number; all: number; owes: number; late: number; credit: number; noCar: number; noFee: number };

/** The numbers on the view buttons (everyone) and the chips (within the view). */
export function driverFilterCounts(rows: readonly DriverRow[], view: DriverView): DriverCounts {
  const inView = rows.filter((r) => inDriverView(r, view));
  return {
    active: rows.filter(isActive).length,
    left: rows.filter((r) => !isActive(r)).length,
    all: rows.length,
    owes: inView.filter(driverChecks.owes).length,
    late: inView.filter(driverChecks.late).length,
    credit: inView.filter(driverChecks.credit).length,
    noCar: inView.filter(driverChecks.noCar).length,
    noFee: inView.filter(driverChecks.noFee).length,
  };
}

/** Whether a chip or the search narrows the list. */
export function driverFilterNarrowed(f: DriverFilter): boolean {
  return f.owes || f.late || f.credit || f.noCar || f.noFee || f.query.trim() !== "";
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
  /** Friends who drove the car during this assignment (not voided). */
  friends: { id: string; name: string; fromDayKey: string; toDayKey: string }[];
};

/** Who had a car and when, newest first; friends who drove it show under the driver. */
export function carTimeline(carId: string, index: FleetIndex): TimelineEntry[] {
  const friends = (index.substitutesByCar.get(carId) ?? []).filter((f) => f.voided !== true);
  return (index.assignmentsByCar.get(carId) ?? [])
    .map((a) => ({
      friends: friends
        .filter(
          (f) =>
            str(f.driverId) === str(a.driverId) &&
            str(f.fromDayKey) <= (str(a.endDayKey) || "9999-12-31") &&
            str(f.toDayKey) >= str(a.startDayKey),
        )
        .map((f) => ({ id: f.id, name: str(f.name), fromDayKey: str(f.fromDayKey), toDayKey: str(f.toDayKey) }))
        .sort((x, y) => y.fromDayKey.localeCompare(x.fromDayKey)),
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

// ---------------------------------------------------------------------------
// The driver profile: tenure and the track record.
// ---------------------------------------------------------------------------

/** A gap longer than this between two assignments reads as "left ... back". */
export const LEFT_GAP_DAYS = 30;

export type DriverTenure = {
  /** Start of the first assignment, "" when the driver never had a car. */
  joinedDayKey: string;
  /** Days a car was assigned (overlaps and gaps do not count). */
  days: number;
};

/** Joined = the first assignment's start; With the company = the assigned days added up. */
export function driverTenure(assignments: Row[], todayKey: string): DriverTenure {
  const spans = assignments
    .map((a) => ({ from: str(a.startDayKey), to: str(a.endDayKey) || todayKey }))
    .filter((x) => x.from && x.to >= x.from)
    .sort((a, b) => a.from.localeCompare(b.from));
  let days = 0;
  let curFrom = "";
  let curTo = "";
  for (const span of spans) {
    if (curFrom && span.from <= curTo) {
      if (span.to > curTo) curTo = span.to;
      continue;
    }
    if (curFrom) days += daysBetween(curFrom, curTo);
    curFrom = span.from;
    curTo = span.to;
  }
  if (curFrom) days += daysBetween(curFrom, curTo);
  return { joinedDayKey: spans[0]?.from ?? "", days };
}

/** "3 years 2 months" (French "3 ans 2 mois"); under a month: days. */
export function tenureText(days: number, language: "en" | "fr" = "en"): string {
  const total = Math.max(0, Math.round(days));
  let years = Math.floor(total / 365);
  let months = Math.floor((total - years * 365) / 30.4375);
  if (months >= 12) {
    years += 1;
    months = 0;
  }
  const fr = language === "fr";
  const parts: string[] = [];
  if (years > 0) parts.push(fr ? `${years} ${years === 1 ? "an" : "ans"}` : `${years} ${years === 1 ? "year" : "years"}`);
  if (months > 0) parts.push(fr ? `${months} mois` : `${months} ${months === 1 ? "month" : "months"}`);
  if (parts.length === 0) parts.push(fr ? `${total} ${total === 1 ? "jour" : "jours"}` : `${total} ${total === 1 ? "day" : "days"}`);
  return parts.join(" ");
}

export type ProfileKind =
  | "joined"
  | "car_given"
  | "car_returned"
  | "rent_change"
  | "left_back"
  | "license"
  | "friend"
  | "late_fee"
  | "charge"
  | "waived"
  | "note"
  | "edit";

export type ProfileFile = { path: string; name: string; contentType: string; size: number };

export type ProfileEntry = {
  key: string;
  kind: ProfileKind;
  /** The day it belongs to, newest first. */
  dayKey: string;
  plate?: string;
  rentCents?: number;
  /** rent_change: the rent before. */
  fromRentCents?: number;
  period?: string;
  /** left_back: the day the car came back, `leftDayKey` the day it was returned. */
  leftDayKey?: string;
  /** friend: the days; license: the old license's dates. */
  fromDayKey?: string;
  toDayKey?: string;
  license?: string;
  name?: string;
  label?: string;
  amountCents?: number;
  text?: string;
  files?: ProfileFile[];
  noteId?: string;
  voided?: boolean;
  by?: string;
  /** edit: which office edit. */
  action?: string;
};

/** One office edit from History (lotLedgerAudit), already read from Firestore. */
export type ProfileAudit = { id: string; action: string; atMs: number };

/** The audit actions worth a line on the profile (the rest are shown elsewhere or are noise). */
export const PROFILE_AUDIT_ACTIONS = ["fleet_driver_saved", "fleet_driver_added"] as const;

/**
 * A driver's track record, newest first, built from the driver's own records
 * once per snapshot: joined, cars given and returned, rent changes, left and
 * came back (a gap over LEFT_GAP_DAYS), license changes, friends who drove,
 * money events, office notes and office edits.
 */
export function driverTimeline(driver: Row, index: FleetIndex, audit: ProfileAudit[] = []): ProfileEntry[] {
  const entries: ProfileEntry[] = [];
  const add = (entry: Omit<ProfileEntry, "key">) => entries.push({ ...entry, key: `${entry.kind}:${entries.length}` });
  const plateOf = (carId: unknown) => str(index.carById.get(str(carId))?.plate);
  const assignments = [...(index.assignmentsByDriver.get(driver.id) ?? [])]
    .filter((a) => str(a.startDayKey))
    .sort((a, b) => str(a.startDayKey).localeCompare(str(b.startDayKey)));

  assignments.forEach((a, i) => {
    const plate = plateOf(a.carId);
    const start = str(a.startDayKey);
    if (i === 0) add({ kind: "joined", dayKey: start, plate });
    add({ kind: "car_given", dayKey: start, plate, rentCents: num(a.rentCents), period: str(a.period) });
    if (str(a.endDayKey)) add({ kind: "car_returned", dayKey: str(a.endDayKey), plate });
    const prev = assignments[i - 1];
    if (!prev) return;
    if (num(prev.rentCents) !== num(a.rentCents)) {
      add({ kind: "rent_change", dayKey: start, plate, fromRentCents: num(prev.rentCents), rentCents: num(a.rentCents), period: str(a.period) });
    }
    const prevEnd = str(prev.endDayKey);
    if (prevEnd && daysBetween(prevEnd, start) > LEFT_GAP_DAYS) {
      add({ kind: "left_back", dayKey: start, leftDayKey: prevEnd });
    }
  });

  const history = Array.isArray(driver.licenseHistory) ? (driver.licenseHistory as Record<string, unknown>[]) : [];
  for (const h of history) {
    if (!str(h.license)) continue;
    add({ kind: "license", dayKey: str(h.toDayKey), license: str(h.license), fromDayKey: str(h.fromDayKey), toDayKey: str(h.toDayKey) });
  }

  for (const f of index.substitutesByDriver.get(driver.id) ?? []) {
    if (f.voided === true) continue;
    add({ kind: "friend", dayKey: str(f.fromDayKey), name: str(f.name), plate: plateOf(f.carId), fromDayKey: str(f.fromDayKey), toDayKey: str(f.toDayKey) });
  }

  for (const b of index.billsByDriver.get(driver.id) ?? []) {
    const bill = b as unknown as Row;
    const label = str(bill.label);
    if (bill.status === "waived") {
      const atMs = Number((bill.waived as { atMs?: unknown } | undefined)?.atMs) || 0;
      add({
        kind: "waived",
        dayKey: atMs ? newYorkDayKey(new Date(atMs)) : str(bill.dueDayKey),
        label: label || str(bill.kind),
        amountCents: num(bill.amountCents),
        text: str((bill.waived as { reason?: unknown } | undefined)?.reason),
      });
    }
    if (bill.status === "void") continue;
    if (bill.kind === "late_fee") add({ kind: "late_fee", dayKey: str(bill.dueDayKey), label, amountCents: num(bill.amountCents) });
    else if (bill.kind === "charge") add({ kind: "charge", dayKey: str(bill.dueDayKey), label, amountCents: num(bill.amountCents) });
  }

  for (const n of index.notesByDriver.get(driver.id) ?? []) {
    const atMs = Number(n.atMs) || 0;
    add({
      kind: "note",
      dayKey: atMs ? newYorkDayKey(new Date(atMs)) : "",
      noteId: n.id,
      text: str(n.text),
      files: Array.isArray(n.files) ? (n.files as ProfileFile[]) : [],
      voided: Boolean(n.voided),
      by: str(n.byName),
    });
  }

  for (const a of audit) {
    if (!(PROFILE_AUDIT_ACTIONS as readonly string[]).includes(a.action) || !a.atMs) continue;
    add({ kind: "edit", dayKey: newYorkDayKey(new Date(a.atMs)), action: a.action, noteId: a.id });
  }

  // Newest first; on one day, what was added last (later in the build order) shows on top.
  const order = new Map(entries.map((e, i) => [e.key, i]));
  return entries.sort((a, b) => b.dayKey.localeCompare(a.dayKey) || (order.get(b.key) ?? 0) - (order.get(a.key) ?? 0));
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

export type FleetTiles = {
  collectedCents: number;
  owedCents: number;
  lateDrivers: number;
  /** Past due, summed over the late drivers. */
  lateCents: number;
  /** Drivers with anything owed. */
  owingDrivers: number;
  /** What this month's bills ask for (waived and void left out). */
  dueThisMonthCents: number;
};

/** Collected this month, owed now, and how many drivers have a late bill. */
export function fleetTiles(data: FleetData, index: FleetIndex, todayKey: string): FleetTiles {
  const month = monthOf(todayKey);
  let collected = 0;
  for (const p of data.payments) {
    if (p.status === "recorded" && monthOf(str(p.paidDayKey)) === month) collected += num(p.amountCents);
  }
  let owed = 0;
  let late = 0;
  let lateCents = 0;
  let owingDrivers = 0;
  for (const d of data.drivers) {
    const b = driverBalance(index.billsByDriver.get(d.id) ?? [], num(d.creditCents), todayKey);
    owed += b.owedCents;
    if (b.owedCents > 0) owingDrivers += 1;
    if (b.lateCents > 0) {
      late += 1;
      lateCents += b.lateCents;
    }
  }
  // Billed for this month: bills due this month that stand (not waived or void).
  let dueThisMonth = 0;
  for (const b of data.bills) {
    const status = str(b.status);
    if (status === "waived" || status === "void") continue;
    if (monthOf(str(b.dueDayKey)) === month) dueThisMonth += num(b.amountCents);
  }
  return { collectedCents: collected, owedCents: owed, lateDrivers: late, lateCents, owingDrivers, dueThisMonthCents: dueThisMonth };
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

// ---------------------------------------------------------------------------
// Filters on the other Fleet lists (owner, 2026-11-12: "on each page, filter
// and search where needed"). Pure, so each page only renders.

export type PaymentsFilter = {
  view: DriverView;
  /** The current month's cell: owes, part paid, paid in full. */
  month: "any" | "owed" | "part" | "paid";
  late: boolean;
  query: string;
  sort: "name" | "owed" | "total";
};

export const emptyPaymentsFilter: PaymentsFilter = { view: "active", month: "any", late: false, query: "", sort: "name" };

function gridDriver(rows: ReadonlyMap<string, DriverRow>, id: string): DriverRow | undefined {
  return rows.get(id);
}

function monthMatches(row: GridRow, month: PaymentsFilter["month"]): boolean {
  if (month === "any") return true;
  const last = row.cells[row.cells.length - 1];
  if (!last) return false;
  if (month === "owed") return last.state === "owed";
  if (month === "part") return last.state === "part";
  return last.state === "full";
}

function gridInView(row: GridRow, drivers: ReadonlyMap<string, DriverRow>, view: DriverView): boolean {
  const status = gridDriver(drivers, row.driverId)?.status ?? "active";
  if (view === "active") return status === "active";
  if (view === "left") return status !== "active";
  return true;
}

/** The Payments grid's rows after the view, the chips, the search and the order. */
export function filterGridRows(rows: readonly GridRow[], drivers: ReadonlyMap<string, DriverRow>, f: PaymentsFilter): GridRow[] {
  const query = f.query.trim();
  const out = rows.filter(
    (r) =>
      gridInView(r, drivers, f.view) &&
      monthMatches(r, f.month) &&
      (!f.late || (gridDriver(drivers, r.driverId)?.lateCents ?? 0) > 0) &&
      (!query || matchesSearch(r.search, query)),
  );
  const byName = (a: GridRow, b: GridRow) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  const owed = (r: GridRow) => gridDriver(drivers, r.driverId)?.owedCents ?? 0;
  if (f.sort === "owed") return out.sort((a, b) => owed(b) - owed(a) || byName(a, b));
  if (f.sort === "total") return out.sort((a, b) => b.totalCents - a.totalCents || byName(a, b));
  return out.sort(byName);
}

export type PaymentsCounts = { active: number; left: number; all: number; owed: number; part: number; paid: number; late: number };

export function gridFilterCounts(rows: readonly GridRow[], drivers: ReadonlyMap<string, DriverRow>, view: DriverView): PaymentsCounts {
  const inView = rows.filter((r) => gridInView(r, drivers, view));
  return {
    active: rows.filter((r) => gridInView(r, drivers, "active")).length,
    left: rows.filter((r) => gridInView(r, drivers, "left")).length,
    all: rows.length,
    owed: inView.filter((r) => monthMatches(r, "owed")).length,
    part: inView.filter((r) => monthMatches(r, "part")).length,
    paid: inView.filter((r) => monthMatches(r, "paid")).length,
    late: inView.filter((r) => (gridDriver(drivers, r.driverId)?.lateCents ?? 0) > 0).length,
  };
}

export type CarFilter = {
  view: "all" | "driver" | "free";
  paper: "any" | "expired" | "soon" | "missing";
  company: string;
  query: string;
  sort: "plate" | "expiry";
};

export const emptyCarFilter: CarFilter = { view: "all", paper: "any", company: "", query: "", sort: "plate" };

const carHasDriver = (r: CarRow) => Boolean(r.driverId);

/** Cars (and Paperwork) after the view, paperwork state, company, search and order. */
export function filterCarRows(rows: readonly CarRow[], f: CarFilter): PaperworkRow[] {
  const query = f.query.trim();
  const out = paperworkRows([...rows]).filter(
    (r) =>
      (f.view === "all" || (f.view === "driver" ? carHasDriver(r) : !carHasDriver(r))) &&
      (f.paper === "any" || r.worst === f.paper) &&
      (!f.company || r.company === f.company) &&
      (!query || matchesSearch(r.search, query)),
  );
  if (f.sort === "expiry") return out;
  return out.sort((a, b) => a.plate.localeCompare(b.plate, undefined, { numeric: true }));
}

export type CarCounts = { all: number; driver: number; free: number; expired: number; soon: number; missing: number };

export function carFilterCounts(rows: readonly CarRow[]): CarCounts {
  const paper = paperworkRows([...rows]);
  return {
    all: rows.length,
    driver: rows.filter(carHasDriver).length,
    free: rows.filter((r) => !carHasDriver(r)).length,
    expired: paper.filter((r) => r.worst === "expired").length,
    soon: paper.filter((r) => r.worst === "soon").length,
    missing: paper.filter((r) => r.worst === "missing").length,
  };
}

/** The companies on the cars, for the company picker. */
export function carCompanies(rows: readonly CarRow[]): string[] {
  return [...new Set(rows.map((r) => r.company).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** A driver's bills and payments on their page. */
export type BillView = "open" | "paid" | "waived" | "all";
export type PaymentView = "all" | "zelle" | "cash" | "import" | "other";

export function billInView(bill: Record<string, unknown>, view: BillView): boolean {
  const status = String(bill.status ?? "open");
  if (view === "all") return true;
  if (view === "waived") return status === "waived" || status === "void";
  return status === view;
}

export function paymentInView(payment: Record<string, unknown>, view: PaymentView): boolean {
  if (view === "all") return true;
  const method = payment.imported === true ? "import" : String(payment.method ?? "other");
  if (view === "other") return !["zelle", "cash", "import"].includes(method);
  return method === view;
}

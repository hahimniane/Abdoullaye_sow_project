// The Fleet page's front door (owner, 2026-11-26: "i love this new design"):
// one Fleet page with tabs instead of five menu items, a "Needs you" list of
// what the office must do today, and one search box that also answers "who
// had this plate on this day". Pure: the page reads the same snapshot every
// Fleet tab reads (useFleetData) and the bank status Payments already loads.

import { whoDroveAt, type DroveAssignment, type DroveSubstitute } from "./fleet-billing.ts";
import type { FleetBankStatus } from "./fleet-bank.ts";
import type { ClaimView } from "./fleet-claims.ts";
import {
  daysBetween,
  driverRows,
  expiryState,
  matchesSearch,
  shiftDayKey,
  type DriverRow,
  type Expiry,
  type FleetData,
  type FleetIndex,
} from "./fleet.ts";

/** The tabs of the Fleet page, and the settings the gear opens. */
export type FleetView = "needs" | "drivers" | "plates" | "payments" | "paperwork" | "settings";

/**
 * Where an old Fleet menu id lands now. The five items were their own
 * sidebar entries; pins, links and notifications may still name them.
 */
export function fleetViewForTab(tab: string): FleetView | null {
  switch (tab) {
    case "fleet":
      return "needs";
    case "fleetPayments":
      return "payments";
    case "fleetDrivers":
      return "drivers";
    case "fleetCars":
      return "plates";
    case "fleetPaperwork":
      return "paperwork";
    case "fleetSettings":
      return "settings";
    default:
      return null;
  }
}

const str = (v: unknown): string => String(v ?? "").trim();
const num = (v: unknown): number => Math.round(Number(v) || 0);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Idle plates: a plate with no driver earns nothing.
// ---------------------------------------------------------------------------

export type IdlePlate = {
  carId: string;
  plate: string;
  /** Days since the last driver gave it back; null when no driver ever had it. */
  idleDays: number | null;
  /** The last plate fee, prorated over the idle days; 0 when unknown. */
  missedCents: number;
};

/** Plates with no driver now, the longest idle (most rent missed) first. */
export function idlePlates(data: FleetData, index: FleetIndex, todayKey: string): IdlePlate[] {
  const out: IdlePlate[] = [];
  for (const car of data.cars) {
    if (index.currentByCar.has(car.id)) continue;
    if (str(car.status) === "retired") continue;
    const past = (index.assignmentsByCar.get(car.id) ?? [])
      .filter((a) => DAY.test(str(a.endDayKey)))
      .sort((a, b) => str(b.endDayKey).localeCompare(str(a.endDayKey)));
    const last = past[0];
    const idleDays = last ? Math.max(0, daysBetween(str(last.endDayKey), todayKey)) : null;
    const rent = last ? Math.max(0, num(last.rentCents)) : 0;
    const perDay = str(last?.period) === "weekly" ? rent / 7 : rent / 30;
    out.push({
      carId: car.id,
      plate: str(car.plate),
      idleDays,
      missedCents: idleDays === null ? 0 : Math.round(perDay * idleDays),
    });
  }
  return out.sort((a, b) => b.missedCents - a.missedCents || (b.idleDays ?? -1) - (a.idleDays ?? -1) || a.plate.localeCompare(b.plate));
}

// ---------------------------------------------------------------------------
// Needs you.
// ---------------------------------------------------------------------------

/** Paperwork shows in Needs you this many days before it runs out. */
export const NEEDS_PAPER_DAYS = 30;

export type NeedsItem =
  | { key: string; kind: "removed"; weightCents: number; driverId: string; name: string; amountCents: number; dayKey: string }
  | { key: string; kind: "claim"; weightCents: number; claimId: string; driverId: string; name: string; amountCents: number | null; match: boolean }
  | { key: string; kind: "deposit"; weightCents: number; depositId: string; senderName: string; amountCents: number; dayKey: string }
  | { key: string; kind: "late"; weightCents: number; driverId: string; name: string; plate: string; owedCents: number; lateCents: number; active: boolean }
  | { key: string; kind: "idle"; weightCents: number; carId: string; plate: string; idleDays: number | null; missedCents: number }
  | { key: string; kind: "paper"; weightCents: number; carId: string; plate: string; paper: "diamond" | "registration"; dayKey: string; daysLeft: number; driverName: string }
  | { key: string; kind: "missingPaper"; weightCents: number; count: number };

export type NeedsInput = {
  data: FleetData;
  index: FleetIndex;
  todayKey: string;
  /** Open claims (openClaimViews); empty while they load. */
  claims: readonly ClaimView[];
  /** bank_status; null while it loads or when it failed. */
  bank: FleetBankStatus | null;
};

/**
 * What the office must do, most money first. Bank take-backs and claims the
 * office has to decide come first at equal money because money already moved.
 * Paperwork carries no money, so it sorts after anything owed.
 */
export function needsItems({ data, index, todayKey, claims, bank }: NeedsInput): NeedsItem[] {
  const items: NeedsItem[] = [];
  const nameOf = (id: string) => str(index.driverById.get(id)?.name);
  const waiting = (bank?.waiting ?? []).filter((w) => !w.pending);

  for (const r of bank?.removed ?? []) {
    items.push({ key: `removed-${r.paymentId}`, kind: "removed", weightCents: r.amountCents + 2, driverId: r.driverId, name: nameOf(r.driverId), amountCents: r.amountCents, dayKey: r.paidDayKey });
  }
  for (const c of claims) {
    const match = c.amountCents !== null && waiting.some((w) => w.amountCents === c.amountCents);
    // A claim still talking to the driver is not the office's yet.
    if (c.state !== "office" && !(c.state === "waiting_bank" && match)) continue;
    items.push({ key: `claim-${c.id}`, kind: "claim", weightCents: (c.amountCents ?? 0) + 1, claimId: c.id, driverId: c.driverId, name: c.who, amountCents: c.amountCents, match });
  }
  for (const w of waiting) {
    items.push({ key: `deposit-${w.id}`, kind: "deposit", weightCents: w.amountCents, depositId: w.id, senderName: w.senderName, amountCents: w.amountCents, dayKey: w.dateKey });
  }
  for (const d of driverRows(data, index, todayKey)) {
    if (d.lateCents <= 0) continue;
    items.push({ key: `late-${d.id}`, kind: "late", weightCents: d.owedCents, driverId: d.id, name: d.name, plate: d.plate, owedCents: d.owedCents, lateCents: d.lateCents, active: d.status === "active" });
  }
  for (const p of idlePlates(data, index, todayKey)) {
    items.push({ key: `idle-${p.carId}`, kind: "idle", weightCents: p.missedCents, carId: p.carId, plate: p.plate, idleDays: p.idleDays, missedCents: p.missedCents });
  }
  let missing = 0;
  for (const car of data.cars) {
    if (str(car.status) === "retired") continue;
    const current = index.currentByCar.get(car.id);
    const driverName = current ? nameOf(str(current.driverId)) : "";
    for (const paper of ["diamond", "registration"] as const) {
      const dayKey = str(paper === "diamond" ? car.diamondExpiry : car.registrationExpiry);
      const state: Expiry = expiryState(dayKey, todayKey, NEEDS_PAPER_DAYS);
      if (state === "missing") {
        missing += 1;
        continue;
      }
      if (state === "ok") continue;
      items.push({ key: `paper-${car.id}-${paper}`, kind: "paper", weightCents: 0, carId: car.id, plate: str(car.plate), paper, dayKey, daysLeft: daysBetween(todayKey, dayKey), driverName });
    }
  }
  if (missing > 0) items.push({ key: "missing-paper", kind: "missingPaper", weightCents: -1, count: missing });

  // Among equal money (paperwork has none), a deadline comes before a plate never given out, the soonest first.
  const order = (i: NeedsItem) => (i.kind === "paper" ? 1_000_000 - i.daysLeft : 0);
  return items.sort((a, b) => b.weightCents - a.weightCents || order(b) - order(a) || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Search: drivers, plates, and "who had this plate on this day".
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  // French
  janv: 1, fev: 2, "fév": 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, aou: 8, "aoû": 8, sept: 9, octo: 10, nove: 11, dece: 12, "déc": 12,
};

const plateKey = (v: string) => v.toUpperCase().replace(/[\s-]/g, "");

/** A date written by hand ("Oct 3", "10/3", "10/3/2026", "2026-10-03", "3 oct"), as a day key; the latest such day not after today when no year is given. */
export function parseDayWords(words: string, todayKey: string): string {
  const w = words.trim().toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ");
  if (!w) return "";
  const iso = w.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let year = 0;
  let month = 0;
  let day = 0;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const slash = w.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    const named = w.match(/^([a-zéû]{3,9}) (\d{1,2})(?: (\d{4}))?$/) || w.match(/^(\d{1,2}) ([a-zéû]{3,9})(?: (\d{4}))?$/);
    if (slash) {
      month = Number(slash[1]);
      day = Number(slash[2]);
      year = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : 0;
    } else if (named) {
      const nameFirst = /^[a-z]/.test(named[1]);
      const name = nameFirst ? named[1] : named[2];
      const found = Object.keys(MONTHS).find((k) => name.startsWith(k) || k.startsWith(name.slice(0, 3)));
      month = found ? MONTHS[found] : 0;
      day = Number(nameFirst ? named[2] : named[1]);
      year = named[3] ? Number(named[3]) : 0;
    }
  }
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const thisYear = Number(todayKey.slice(0, 4));
  const key = `${year || thisYear}-${pad(month)}-${pad(day)}`;
  if (!year && key > todayKey) return `${thisYear - 1}-${pad(month)}-${pad(day)}`;
  // A day that does not exist (Feb 30) is refused.
  return shiftDayKey(key, 0) === key ? key : "";
}

export type PlateOnDay = {
  carId: string;
  plate: string;
  dayKey: string;
  future: boolean;
  driverId: string;
  driverName: string;
  /** The friend who drove it that day, if one was recorded. */
  friendName: string;
  /** The assignment's days, for "had it from … to …". */
  fromDayKey: string;
  toDayKey: string;
};

/** "T712 Oct 3": the plate, then a date. Null when the words are not a known plate and a date. */
export function plateOnDay(query: string, data: FleetData, index: FleetIndex, todayKey: string): PlateOnDay | null {
  const words = query.trim().split(/\s+/);
  if (words.length < 2) return null;
  const want = plateKey(words[0]);
  if (want.length < 3) return null;
  const car = data.cars.find((c) => plateKey(str(c.plate)) === want);
  if (!car) return null;
  const dayKey = parseDayWords(words.slice(1).join(" "), todayKey);
  if (!dayKey) return null;
  const plate = str(car.plate);
  if (dayKey > todayKey) {
    return { carId: car.id, plate, dayKey, future: true, driverId: "", driverName: "", friendName: "", fromDayKey: "", toDayKey: "" };
  }
  const assignments: DroveAssignment[] = (index.assignmentsByCar.get(car.id) ?? []).map((a) => ({
    carId: str(a.carId),
    driverId: str(a.driverId),
    startDayKey: str(a.startDayKey),
    endDayKey: str(a.endDayKey) || null,
  }));
  const substitutes: DroveSubstitute[] = (index.substitutesByCar.get(car.id) ?? []).map((s) => ({
    id: s.id,
    carId: str(s.carId),
    fromDayKey: str(s.fromDayKey),
    toDayKey: str(s.toDayKey),
    voided: Boolean(s.voided),
  }));
  const who = whoDroveAt(assignments, substitutes, car.id, dayKey);
  const held = who.driverId ? assignments.find((a) => a.driverId === who.driverId && a.startDayKey <= dayKey && (!a.endDayKey || a.endDayKey >= dayKey)) : undefined;
  const friend = who.substituteId ? (index.substitutesByCar.get(car.id) ?? []).find((s) => s.id === who.substituteId) : undefined;
  return {
    carId: car.id,
    plate,
    dayKey,
    future: false,
    driverId: who.driverId ?? "",
    driverName: who.driverId ? str(index.driverById.get(who.driverId)?.name) : "",
    friendName: str(friend?.name),
    fromDayKey: held?.startDayKey ?? "",
    toDayKey: held?.endDayKey ?? "",
  };
}

export type SearchHit =
  | { kind: "driver"; id: string; name: string; plate: string; owedCents: number; status: string }
  | { kind: "plate"; id: string; plate: string; company: string; driverName: string };

/** Up to six drivers and four plates matching the words (name, phone, plate, company). */
export function fleetSearch(query: string, data: FleetData, index: FleetIndex, rows: readonly DriverRow[]): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const d of rows) {
    if (hits.length >= 6) break;
    if (matchesSearch(d.search, q)) hits.push({ kind: "driver", id: d.id, name: d.name, plate: d.plate, owedCents: d.owedCents, status: d.status });
  }
  const want = plateKey(q.split(/\s+/)[0]);
  let plates = 0;
  for (const c of [...data.cars].sort((a, b) => str(a.plate).localeCompare(str(b.plate)))) {
    if (plates >= 4) break;
    const plate = str(c.plate);
    const company = str(c.company);
    if (plateKey(plate).includes(want) || (q.length >= 3 && company.toLowerCase().includes(q.toLowerCase()))) {
      const current = index.currentByCar.get(c.id);
      hits.push({ kind: "plate", id: c.id, plate, company, driverName: current ? str(index.driverById.get(str(current.driverId))?.name) : "" });
      plates += 1;
    }
  }
  return hits;
}

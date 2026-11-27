// Pure helpers behind the Fleet form pickers (docs/FLEET.md section 16): the
// lists a Fleet form offers instead of a typed box. The components live in
// components/business/fleet-pickers.tsx.

import { US_STATE_NAMES } from "./us-locations.ts";

export type FleetRowLike = { [key: string]: unknown };

/**
 * The values a business already uses for one field (plate companies,
 * insurers, who pays the insurance), spelled the first way they were saved,
 * with case and spacing differences folded together, sorted A to Z.
 */
export function knownValues(rows: readonly FleetRowLike[], key: string): string[] {
  const byLower = new Map<string, string>();
  for (const row of rows) {
    const value = String(row?.[key] ?? "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    const lower = value.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, value);
  }
  return [...byLower.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** The list a pick-or-add field shows: the known values plus the current one. */
export function optionsWith(known: readonly string[], current: string): string[] {
  const value = current.trim();
  if (!value || known.some((k) => k.toLowerCase() === value.toLowerCase())) return [...known];
  return [value, ...known];
}

/** The saved spelling of a typed value that is already in the list, if any. */
export function matchKnown(known: readonly string[], typed: string): string {
  const value = typed.replace(/\s+/g, " ").trim();
  return known.find((k) => k.toLowerCase() === value.toLowerCase()) ?? value;
}

/** Days a monthly bill can fall on: 1 to 28, so every month has the day. */
export const MONTH_DAYS: readonly number[] = Array.from({ length: 28 }, (_, i) => i + 1);

/** Weekdays for a weekly bill, 1 = Monday ... 7 = Sunday (the stored number). */
export const WEEKDAYS: readonly { day: number; label: string }[] = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 7, label: "Sunday" },
];

/**
 * Common reasons for a charge. A charge is saved as one label: the reason,
 * then " · " and the details ("Ticket · T712000C · Oct 3"); "Other" saves
 * the typed details alone.
 */
export const CHARGE_REASONS: readonly string[] = ["Ticket", "Toll", "Damage repair", "Insurance deductible"];

const CHARGE_JOIN = " · ";

/** Splits a label back into a reason from the list ("" = Other) and details. */
export function splitChargeLabel(label: string): { reason: string; details: string } {
  const value = String(label ?? "").trim();
  const lower = value.toLowerCase();
  for (const reason of CHARGE_REASONS) {
    const r = reason.toLowerCase();
    if (lower === r) return { reason, details: "" };
    if (lower.startsWith(r + CHARGE_JOIN)) return { reason, details: value.slice(reason.length + CHARGE_JOIN.length).trim() };
  }
  return { reason: "", details: value };
}

/** The label saved for a reason and its details. */
export function composeChargeLabel(reason: string, details: string): string {
  const d = details.trim();
  if (!reason) return d;
  return d ? `${reason}${CHARGE_JOIN}${d}` : reason;
}

const STATE_CODE_BY_NAME = new Map(Object.entries(US_STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));

/**
 * The two-letter code for a typed or saved US state ("ny", "New York" -> "NY").
 * Anything that is not a US state is returned as it was, so an old record
 * never loses what it said.
 */
export function stateCode(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const upper = value.toUpperCase();
  if (US_STATE_NAMES[upper]) return upper;
  return STATE_CODE_BY_NAME.get(value.toLowerCase()) ?? value;
}

export type VehicleParts = { make: string; model: string; year: string };

export type CarCatalogLookup = {
  makes: () => string[];
  models: (make: string) => string[];
  years: (make: string, model: string) => string[];
};

/** "Toyota Camry 2021": the one line a plate's car is saved as. */
export function composeVehicleType(parts: VehicleParts): string {
  return [parts.make, parts.model, parts.year].map((p) => p.trim()).filter(Boolean).join(" ");
}

/**
 * Reads a saved car line back into make, model and year using the catalog
 * ("Toyota Camry 2021", "2021 toyota camry", "Toyota RAV4"). Returns null
 * when the make is not in the catalog, so the form keeps the old text.
 */
export function splitVehicleType(text: string, catalog: CarCatalogLookup): VehicleParts | null {
  let rest = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!rest) return { make: "", model: "", year: "" };
  let year = "";
  const yearMatch = rest.match(/^(19|20)\d\d\b|\b(19|20)\d\d$/);
  if (yearMatch) {
    year = yearMatch[0];
    rest = (rest.slice(0, yearMatch.index) + rest.slice((yearMatch.index ?? 0) + year.length)).trim();
  }
  const lower = rest.toLowerCase();
  const make = [...catalog.makes()]
    .sort((a, b) => b.length - a.length)
    .find((m) => lower === m.toLowerCase() || lower.startsWith(`${m.toLowerCase()} `));
  if (!make) return null;
  const modelText = rest.slice(make.length).trim().toLowerCase();
  const model = modelText ? catalog.models(make).find((m) => m.toLowerCase() === modelText) ?? "" : "";
  if (modelText && !model) return null;
  const knownYear = year && model ? catalog.years(make, model).find((y) => String(y) === year) ?? "" : "";
  if (year && model && !knownYear) return null;
  return { make, model, year: knownYear };
}

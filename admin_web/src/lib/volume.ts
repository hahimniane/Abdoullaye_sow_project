// Monthly volume: what the Volume pages show (admin: every business; business
// console: its own). The numbers are counted on the server
// (my_flutter_app/functions/volume_counts.js) and read through
// getPlatformVolume / getBusinessVolume. This module holds the screen's pure
// half - months, labels, the CSV - so the components stay thin and the logic
// is tested without a browser.

export const VOLUME_TIME_ZONE = "America/New_York";

export type VolumeLanguage = "en" | "fr";

export type VolumeNumbers = {
  pieces: number;
  barrels: number;
  packages: number;
  cars: number;
  customerLines: number;
  containersShipped: number;
  containerPieces: number;
  avgPerContainer: number | null;
};

export type VolumeTotals = VolumeNumbers & {
  previousPieces: number;
  piecesChangePct: number | null;
};

export type VolumeBusinessRow = VolumeNumbers & {
  businessId: string;
  name: string;
};

export type VolumeContainer = {
  id: string;
  number: string;
  destination: string;
  status: string;
  sailedAtMs: number;
  pieces: number;
  barrels: number;
  packages: number;
  cars: number;
};

export type PlatformVolumeResponse = {
  month: string;
  timeZone: string;
  totals: VolumeTotals & { businesses: number };
  businesses: VolumeBusinessRow[];
  trend: Array<{ month: string; pieces: number }>;
  computedAtMs: number;
};

export type BusinessVolumeResponse = {
  month: string;
  timeZone: string;
  businessId: string;
  businessName: string;
  totals: VolumeTotals;
  containers: VolumeContainer[];
  containersTruncated: boolean;
  complete: boolean;
  computedAtMs: number | null;
};

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isVolumeMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

/** The month it is now in New York ("yyyy-mm") - the picker's default. */
export function currentVolumeMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VOLUME_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}`;
}

/** The month `delta` months away ("" for a bad month). */
export function shiftVolumeMonth(month: string, delta: number): string {
  const match = MONTH_RE.exec(month);
  if (!match) return "";
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 + Math.trunc(delta);
  const year = Math.floor(index / 12);
  const mm = index - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(mm).padStart(2, "0")}`;
}

/** Whether the picker may step forward: never past the current month. */
export function canStepForward(month: string, current: string = currentVolumeMonth()): boolean {
  return isVolumeMonth(month) && month < current;
}

/** The month a picker shows after a step, held to [anything, current]. */
export function stepVolumeMonth(
  month: string,
  delta: number,
  current: string = currentVolumeMonth(),
): string {
  const next = shiftVolumeMonth(isVolumeMonth(month) ? month : current, delta);
  if (!next) return current;
  return next > current ? current : next;
}

function monthDate(month: string): Date | null {
  const match = MONTH_RE.exec(month);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

/** "October 2026" (French: "octobre 2026"). */
export function formatVolumeMonth(month: string, language: VolumeLanguage = "en"): string {
  const date = monthDate(month);
  if (!date) return month;
  return new Intl.DateTimeFormat(language === "fr" ? "fr-FR" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** A chart label: "Oct" (French: "oct."), with the year on January. */
export function formatVolumeMonthShort(month: string, language: VolumeLanguage = "en"): string {
  const date = monthDate(month);
  if (!date) return month;
  const locale = language === "fr" ? "fr-FR" : "en-US";
  const short = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date);
  return date.getUTCMonth() === 0 ? `${short} ${date.getUTCFullYear()}` : short;
}

/** A whole count with the language's grouping: "1,284" / "1 284". */
export function formatVolumeCount(value: unknown, language: VolumeLanguage = "en"): string {
  const n = Math.max(0, Math.round(Number(value) || 0));
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US").format(n);
}

/** Average pieces per container: "42.5", or "—" when nothing shipped. */
export function formatVolumeAverage(value: number | null | undefined, language: VolumeLanguage = "en"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}

/** "+12%" / "−8%" / "0%"; "" when there is nothing to compare with. */
export function formatVolumeChange(pct: number | null | undefined, language: VolumeLanguage = "en"): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "";
  const rounded = Math.round(pct);
  const digits = new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US").format(Math.abs(rounded));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return language === "fr" ? `${sign}${digits} %` : `${sign}${digits}%`;
}

export function volumeChangeTone(pct: number | null | undefined): "up" | "down" | "flat" {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "flat";
  const rounded = Math.round(pct);
  return rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
}

export function emptyVolumeTotals(): VolumeTotals {
  return {
    pieces: 0,
    barrels: 0,
    packages: 0,
    cars: 0,
    customerLines: 0,
    containersShipped: 0,
    containerPieces: 0,
    avgPerContainer: null,
    previousPieces: 0,
    piecesChangePct: null,
  };
}

/** The bars of the 12-month chart, scaled to the tallest month. */
export function volumeTrendBars(trend: ReadonlyArray<{ month: string; pieces: number }>) {
  const max = Math.max(1, ...trend.map((point) => Math.max(0, Number(point.pieces) || 0)));
  return trend.map((point) => {
    const pieces = Math.max(0, Math.round(Number(point.pieces) || 0));
    return { month: point.month, pieces, ratio: pieces / max };
  });
}

// ---------------------------------------------------------------------------
// CSV: one row per business for the month, then the totals.
// ---------------------------------------------------------------------------

const CSV_HEADERS: Record<VolumeLanguage, string[]> = {
  en: [
    "Month",
    "Business",
    "Business ID",
    "Barrels",
    "Packages",
    "Cars",
    "Pieces",
    "Customer lines",
    "Containers shipped",
    "Pieces in containers",
    "Avg pieces / container",
  ],
  fr: [
    "Mois",
    "Entreprise",
    "ID de l’entreprise",
    "Barils",
    "Colis",
    "Voitures",
    "Pièces",
    "Envois clients",
    "Conteneurs expédiés",
    "Pièces dans les conteneurs",
    "Moyenne de pièces / conteneur",
  ],
};

/**
 * One CSV cell: quoted, quotes doubled, and a leading = + - @ (which a
 * spreadsheet would run as a formula) defused with an apostrophe. Business
 * names are typed by businesses, so they are untrusted.
 */
export function volumeCsvCell(value: unknown): string {
  let raw = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(raw)) raw = `'${raw}`;
  return `"${raw.replace(/"/g, '""')}"`;
}

function csvAverage(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "" : String(value);
}

/** The month's table as CSV text (numbers unformatted, for spreadsheets). */
export function volumeCsv(answer: PlatformVolumeResponse, language: VolumeLanguage = "en"): string {
  const month = answer.month;
  const rows: unknown[][] = [CSV_HEADERS[language]];
  for (const row of answer.businesses) {
    rows.push([
      month,
      row.name || row.businessId,
      row.businessId,
      row.barrels,
      row.packages,
      row.cars,
      row.pieces,
      row.customerLines,
      row.containersShipped,
      row.containerPieces,
      csvAverage(row.avgPerContainer),
    ]);
  }
  const totals = answer.totals;
  rows.push([
    month,
    language === "fr" ? "Total" : "Total",
    "",
    totals.barrels,
    totals.packages,
    totals.cars,
    totals.pieces,
    totals.customerLines,
    totals.containersShipped,
    totals.containerPieces,
    csvAverage(totals.avgPerContainer),
  ]);
  // A byte-order mark so a spreadsheet reads the accents as UTF-8.
  return `﻿${rows.map((cells) => cells.map(volumeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function volumeCsvFilename(month: string): string {
  return `laawol-volume-${isVolumeMonth(month) ? month : "month"}.csv`;
}

/** Hands the browser the CSV as a file to save. */
export function downloadVolumeCsv(answer: PlatformVolumeResponse, language: VolumeLanguage = "en") {
  const blob = new Blob([volumeCsv(answer, language)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = volumeCsvFilename(answer.month);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

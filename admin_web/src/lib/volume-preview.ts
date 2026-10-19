// Sample Volume numbers for the console's local preview (`?preview=1` on
// localhost), so the Volume pages can be checked in a browser without a
// signed-in admin or a server. Never read outside preview mode. The numbers
// are made up but add up the way the server's do (pieces = barrels +
// packages + cars, totals = sum of the rows, avg = container pieces /
// containers), and one business has an empty month to show that state.

import {
  VOLUME_TIME_ZONE,
  currentVolumeMonth,
  isVolumeMonth,
  shiftVolumeMonth,
  type BusinessVolumeResponse,
  type PlatformVolumeResponse,
  type VolumeBusinessRow,
  type VolumeContainer,
  type VolumeNumbers,
} from "./volume.ts";

type Seed = { businessId: string; name: string; barrels: number; packages: number; cars: number; lines: number; containers: number };

const SEEDS: Seed[] = [
  { businessId: "atlantic_exports", name: "Atlantic Exports", barrels: 26, packages: 14, cars: 0, lines: 17, containers: 2 },
  { businessId: "keren_auto_sales", name: "Keren Auto Sales", barrels: 18, packages: 9, cars: 3, lines: 11, containers: 2 },
  { businessId: "sahel_freight", name: "Sahel Freight", barrels: 4, packages: 2, cars: 0, lines: 3, containers: 0 },
];

const FACTORS = [1, 0.8, 1.15, 0.9, 1.2, 0.7];
const DESTINATIONS = ["Dakar, Senegal", "Conakry, Guinea", "Abidjan, Côte d’Ivoire"];

function monthsBack(month: string, current: string): number {
  const index = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
  return index(current) - index(month);
}

function numbers(barrels: number, packages: number, cars: number, lines: number, containers: number): VolumeNumbers {
  const pieces = barrels + packages + cars;
  const containerPieces = containers > 0 ? pieces : 0;
  return {
    pieces,
    barrels,
    packages,
    cars,
    customerLines: lines,
    containersShipped: containers,
    containerPieces,
    avgPerContainer: containers > 0 ? Math.round((containerPieces / containers) * 10) / 10 : null,
  };
}

/** The month's rows: nothing older than a year; Keren is empty two months back; Sahel only every other month. */
function previewRows(month: string, current: string): VolumeBusinessRow[] {
  const back = monthsBack(month, current);
  if (!isVolumeMonth(month) || back < 0 || back > 11) return [];
  const factor = FACTORS[back % FACTORS.length];
  const rows: VolumeBusinessRow[] = [];
  for (const seed of SEEDS) {
    if (seed.businessId === "keren_auto_sales" && back === 2) continue;
    if (seed.businessId === "sahel_freight" && back % 2 === 1) continue;
    const scale = (value: number) => Math.round(value * factor);
    rows.push({
      businessId: seed.businessId,
      name: seed.name,
      ...numbers(scale(seed.barrels), scale(seed.packages), seed.cars, scale(seed.lines), seed.containers),
    });
  }
  return rows.sort((a, b) => b.pieces - a.pieces);
}

function sumRows(rows: VolumeBusinessRow[]): VolumeNumbers {
  const total = rows.reduce(
    (acc, row) => ({
      barrels: acc.barrels + row.barrels,
      packages: acc.packages + row.packages,
      cars: acc.cars + row.cars,
      lines: acc.lines + row.customerLines,
      containers: acc.containers + row.containersShipped,
    }),
    { barrels: 0, packages: 0, cars: 0, lines: 0, containers: 0 },
  );
  const sum = numbers(total.barrels, total.packages, total.cars, total.lines, total.containers);
  const containerPieces = rows.reduce((acc, row) => acc + row.containerPieces, 0);
  return {
    ...sum,
    containerPieces,
    avgPerContainer: total.containers > 0 ? Math.round((containerPieces / total.containers) * 10) / 10 : null,
  };
}

function change(pieces: number, previous: number): number | null {
  return previous > 0 ? ((pieces - previous) / previous) * 100 : null;
}

export function previewPlatformVolume(month: string, current: string = currentVolumeMonth()): PlatformVolumeResponse {
  const rows = previewRows(month, current);
  const totals = sumRows(rows);
  const previousPieces = sumRows(previewRows(shiftVolumeMonth(month, -1), current)).pieces;
  const trend = Array.from({ length: 12 }, (_, index) => {
    const at = shiftVolumeMonth(month, index - 11);
    return { month: at, pieces: sumRows(previewRows(at, current)).pieces };
  });
  return {
    month,
    timeZone: VOLUME_TIME_ZONE,
    totals: { ...totals, businesses: rows.length, previousPieces, piecesChangePct: change(totals.pieces, previousPieces) },
    businesses: rows,
    trend,
    computedAtMs: Date.now(),
  };
}

/** Splits `total` over `parts` as evenly as whole numbers allow. */
function split(total: number, parts: number, index: number): number {
  return Math.floor(total / parts) + (index < total % parts ? 1 : 0);
}

/** A preview business's month; an id that is not a sample business borrows Atlantic Exports' numbers. */
export function previewBusinessVolume(
  businessId: string,
  month: string,
  current: string = currentVolumeMonth(),
): BusinessVolumeResponse {
  const known = SEEDS.some((seed) => seed.businessId === businessId);
  const sampleId = known ? businessId : SEEDS[0].businessId;
  const rowFor = (at: string) => previewRows(at, current).find((row) => row.businessId === sampleId) ?? null;
  const row = rowFor(month);
  const totals = row ? sumRows([row]) : sumRows([]);
  const previousPieces = rowFor(shiftVolumeMonth(month, -1))?.pieces ?? 0;
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const containers: VolumeContainer[] = Array.from({ length: totals.containersShipped }, (_, index) => {
    const parts = totals.containersShipped;
    const barrels = split(totals.barrels, parts, index);
    const packages = split(totals.packages, parts, index);
    const cars = split(totals.cars, parts, index);
    return {
      id: `${sampleId}-${month}-${index + 1}`,
      number: `MSKU${String(4072310 + monthIndex * 37 + index * 11).padStart(7, "0")}`,
      destination: DESTINATIONS[(monthIndex + index) % DESTINATIONS.length],
      status: monthsBack(month, current) === 0 ? "shipped" : "arrived",
      sailedAtMs: Date.UTC(year, monthIndex, 6 + index * 9, 15),
      pieces: barrels + packages + cars,
      barrels,
      packages,
      cars,
    };
  });
  return {
    month,
    timeZone: VOLUME_TIME_ZONE,
    businessId,
    businessName: known ? SEEDS.find((seed) => seed.businessId === businessId)?.name ?? businessId : businessId,
    totals: { ...totals, previousPieces, piecesChangePct: change(totals.pieces, previousPieces) },
    containers,
    containersTruncated: false,
    complete: true,
    computedAtMs: Date.now(),
  };
}

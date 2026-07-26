// AUTO-PORTED from my_flutter_app/lib/data/car_catalog.dart and its backing
// my_flutter_app/assets/data/car_models_flutter.json (copied verbatim as
// car-models-data.json). Keep in sync with the mobile app. This is the
// canonical source for any make/model/year picker on the web - do NOT
// hardcode a partial make/model list or accept free-text make/model anywhere;
// import getMakes/getModels/getYears instead, mirroring the mobile cascading
// dropdown so listing data stays consistent enough to search and filter on.
import carModelsData from "./car-models-data.json";

type RawEntry = {brand: string; model: string; startYear: number; endYear: number | string};

type CarModelEntry = {brand: string; model: string; startYear: number; endYear: number | null};

const CURRENT_YEAR = new Date().getFullYear();

function parseEndYear(value: number | string): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim().toLowerCase() === "present") return CURRENT_YEAR;
  return null;
}

const ENTRIES_BY_BRAND: Map<string, CarModelEntry[]> = new Map();
for (const raw of carModelsData as RawEntry[]) {
  const entry: CarModelEntry = {
    brand: raw.brand.trim(),
    model: raw.model.trim(),
    startYear: raw.startYear,
    endYear: parseEndYear(raw.endYear),
  };
  const bucket = ENTRIES_BY_BRAND.get(entry.brand);
  if (bucket) {
    bucket.push(entry);
  } else {
    ENTRIES_BY_BRAND.set(entry.brand, [entry]);
  }
}

function localeSort(values: Iterable<string>): string[] {
  return Array.from(values).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export function getMakes(): string[] {
  return localeSort(ENTRIES_BY_BRAND.keys());
}

export function getModels(make: string): string[] {
  const entries = ENTRIES_BY_BRAND.get(make) ?? [];
  const models = new Set<string>();
  for (const entry of entries) {
    if (entry.model) models.add(entry.model);
  }
  return localeSort(models);
}

export function getYears(make: string, model: string): string[] {
  const entries = ENTRIES_BY_BRAND.get(make) ?? [];
  const years = new Set<number>();
  for (const entry of entries) {
    if (entry.model !== model) continue;
    const endYear = entry.endYear ?? CURRENT_YEAR;
    for (let year = entry.startYear; year <= endYear; year += 1) {
      years.add(year);
    }
  }
  return Array.from(years)
    .sort((a, b) => b - a)
    .map((year) => String(year));
}

// AUTO-PORTED from my_flutter_app/lib/data/car_catalog.dart and its backing
// my_flutter_app/assets/data/car_models_flutter.json (copied verbatim as
// car-models-data.json). Keep in sync with the mobile app. This is the
// canonical source for any make/model/year picker on the web - do NOT
// hardcode a partial make/model list or accept free-text make/model anywhere;
// import getMakes/getModels/getYears instead, mirroring the mobile cascading
// dropdown so listing data stays consistent enough to search and filter on.
//
// The data (~200 KB) is fetched on demand, not shipped in the entry bundle:
// a picker calls useCarCatalog() (lib/use-car-catalog.ts) to load it and
// re-render once it is in, and async code awaits loadCarCatalog() before it
// matches. Until then the getters answer with empty lists.

type RawEntry = {brand: string; model: string; startYear: number; endYear: number | string};

type CarModelEntry = {brand: string; model: string; startYear: number; endYear: number | null};

const CURRENT_YEAR = new Date().getFullYear();

function parseEndYear(value: number | string): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim().toLowerCase() === "present") return CURRENT_YEAR;
  return null;
}

let ENTRIES_BY_BRAND: Map<string, CarModelEntry[]> = new Map();
// Records created before the cascading pickers existed carry free-text makes
// and models in whatever casing the customer typed ("toyota", "rav4"). An
// exact-key lookup returns nothing for those, which renders an empty dropdown
// the customer cannot change. Resolve to the catalog's own spelling first.
let BRAND_BY_LOWER: Map<string, string> = new Map();
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Install the catalog rows (the loader's job; tests call it directly). */
export function setCarCatalogData(rows: readonly RawEntry[]): void {
  const byBrand: Map<string, CarModelEntry[]> = new Map();
  for (const raw of rows) {
    const entry: CarModelEntry = {
      brand: raw.brand.trim(),
      model: raw.model.trim(),
      startYear: raw.startYear,
      endYear: parseEndYear(raw.endYear),
    };
    const bucket = byBrand.get(entry.brand);
    if (bucket) bucket.push(entry);
    else byBrand.set(entry.brand, [entry]);
  }
  const byLower = new Map<string, string>();
  for (const brand of byBrand.keys()) byLower.set(brand.toLowerCase(), brand);
  ENTRIES_BY_BRAND = byBrand;
  BRAND_BY_LOWER = byLower;
  loaded = true;
  listeners.forEach((listener) => listener());
}

export function carCatalogLoaded(): boolean {
  return loaded;
}

/** Fetch the catalog once; every later call shares the same promise. A failed
 * fetch is forgotten so the next caller can try again. */
export function loadCarCatalog(): Promise<void> {
  if (loaded) return Promise.resolve();
  loading ??= import("./car-models-data.json")
    .then((module) => setCarCatalogData((module.default ?? module) as unknown as RawEntry[]))
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}

export function subscribeCarCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function localeSort(values: Iterable<string>): string[] {
  return Array.from(values).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export function getMakes(): string[] {
  return localeSort(ENTRIES_BY_BRAND.keys());
}

/**
 * Canonical catalog spelling for a make, whatever casing was stored.
 * Returns "" when the make is not in the catalog at all.
 */
export function canonicalMake(make: string): string {
  const raw = String(make ?? "").trim();
  if (!raw) return "";
  return BRAND_BY_LOWER.get(raw.toLowerCase()) ?? "";
}

/**
 * Canonical catalog spelling for a model within a make.
 * Returns "" when the model is not in the catalog for that make.
 */
export function canonicalModel(make: string, model: string): string {
  const raw = String(model ?? "").trim();
  if (!raw) return "";
  const target = raw.toLowerCase();
  return getModels(make).find((m) => m.toLowerCase() === target) ?? "";
}

export function getModels(make: string): string[] {
  const entries = ENTRIES_BY_BRAND.get(canonicalMake(make) || make) ?? [];
  const models = new Set<string>();
  for (const entry of entries) {
    if (entry.model) models.add(entry.model);
  }
  return localeSort(models);
}

export function getYears(make: string, model: string): string[] {
  const entries = ENTRIES_BY_BRAND.get(canonicalMake(make) || make) ?? [];
  const target = String(model ?? "").trim().toLowerCase();
  const years = new Set<number>();
  for (const entry of entries) {
    if (entry.model.toLowerCase() !== target) continue;
    const endYear = entry.endYear ?? CURRENT_YEAR;
    for (let year = entry.startYear; year <= endYear; year += 1) {
      years.add(year);
    }
  }
  return Array.from(years)
    .sort((a, b) => b - a)
    .map((year) => String(year));
}

// Reads a 17-character VIN with the public NHTSA database and matches the
// answer to the make/model/year catalog the pickers use (car-catalog.ts).
// Shared by the car listing form and the Fleet plate form.

import { canonicalModel, getMakes, getModels, getYears, loadCarCatalog } from "./car-catalog.ts";

export type VinDecodeResult =
  | { kind: "filled"; make: string; model: string; year: string }
  | { kind: "unknownMake"; seen: string }
  | { kind: "unreadable" }
  | { kind: "offline" };

/** The VIN as the database wants it, or "" when it is not 17 characters yet. */
export function cleanVin(raw: string): string {
  const vin = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return vin.length === 17 ? vin : "";
}

export async function decodeVinForCatalog(vin: string): Promise<VinDecodeResult> {
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`,
    );
    const data = await res.json();
    const r = (data?.Results?.[0] ?? {}) as Record<string, unknown>;
    const dMake = String(r.Make ?? "").trim();
    const dModel = String(r.Model ?? "").trim();
    const dYear = String(r.ModelYear ?? "").trim();
    await loadCarCatalog();
    const make = getMakes().find((m) => m.toLowerCase() === dMake.toLowerCase()) ?? "";
    if (!make) {
      const seen = [dYear, dMake, dModel].filter(Boolean).join(" ");
      return seen ? { kind: "unknownMake", seen } : { kind: "unreadable" };
    }
    const canon = canonicalModel(make, dModel);
    const model = getModels(make).find((m) => m.toLowerCase() === (canon || dModel).toLowerCase()) ?? "";
    const year = model ? getYears(make, model).find((y) => String(y) === dYear) ?? "" : "";
    return { kind: "filled", make, model, year };
  } catch {
    return { kind: "offline" };
  }
}

/**
 * Filling a vehicle from its VIN — the one mechanism every business form
 * shares (the lot ledger's record form, the containers loading list).
 *
 * Two steps, in this order:
 *  1. The lot's own records first (`findVehicleRecordByVin`): a parked car
 *     or a past activity also carries who owns it, which a decoder never
 *     knows.
 *  2. Only for a VIN the yard has never seen, the public NHTSA decode
 *     (`decodeVinWithCatalog`), matched to the car catalog so the make /
 *     model / year selects hold a real option.
 *
 * Kept apart from React so the matching is unit-testable and so a second
 * form reuses it rather than forking the fetch.
 */

import { canonicalModel, getMakes, getModels, getYears } from "./car-catalog.ts";

type Row = Record<string, unknown>;

function s(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

/** The lot's record for this VIN — a parked car or an activity — if any. */
export function findVehicleRecordByVin(
  rows: readonly Row[],
  vin: string,
): Row | undefined {
  const wanted = s(vin, 17).toUpperCase();
  if (!wanted) return undefined;
  return rows.find((row) => s(row.vinNumber, 17).toUpperCase() === wanted);
}

export type VinDecodeResult = {
  /** Catalog make, or "" when the decoder's make is not one we carry. */
  make: string;
  model: string;
  year: string;
  /** What the decoder read ("2019 TOYOTA Camry"), for the hint when unmatched. */
  seen: string;
};

const NHTSA_DECODE = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/";

/**
 * Decode a full VIN and match it to the catalog. Throws when the service
 * cannot be reached; resolves with an empty make when it answered but with a
 * make the catalog does not carry.
 */
export async function decodeVinWithCatalog(
  vin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VinDecodeResult> {
  const res = await fetchImpl(`${NHTSA_DECODE}${encodeURIComponent(vin)}?format=json`);
  const data = (await res.json()) as { Results?: Row[] };
  return matchDecodedVehicle(data?.Results?.[0] ?? {});
}

/** The catalog match for a decoder row; exported so the matching is testable. */
export function matchDecodedVehicle(decoded: Row): VinDecodeResult {
  const dMake = s(decoded.Make, 80);
  const dModel = s(decoded.Model, 80);
  const dYear = s(decoded.ModelYear, 8);
  const make = getMakes().find((m) => m.toLowerCase() === dMake.toLowerCase()) ?? "";
  let model = "";
  let year = "";
  if (make) {
    const canon = canonicalModel(make, dModel);
    model = getModels(make).find((m) => m.toLowerCase() === (canon || dModel).toLowerCase()) ?? "";
    if (model) year = getYears(make, model).find((y) => String(y) === dYear) ?? "";
  }
  return { make, model, year, seen: [dYear, dMake, dModel].filter(Boolean).join(" ") };
}

/** The sentence under the VIN field once a decode has answered. */
export function vinDecodeHint(result: VinDecodeResult): string {
  if (!result.make) {
    return result.seen
      ? `VIN reads ${result.seen} — we don't carry that make; pick the closest.`
      : "Couldn't read that VIN. Enter the vehicle by hand.";
  }
  const filled = [result.year, result.make, result.model].filter(Boolean).join(" ");
  return result.model && result.year
    ? `Filled from VIN: ${filled}. You can change anything below.`
    : `Filled the make from VIN: ${filled} — set the model/year.`;
}

export const VIN_SERVICE_UNREACHABLE =
  "Couldn't reach the VIN service. Enter the vehicle by hand.";
export const VIN_LOOKING_UP = "Looking up the VIN…";

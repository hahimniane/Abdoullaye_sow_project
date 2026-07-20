"use strict";

// Pure freight home-pickup pricing logic, kept out of index.js so it can be
// unit-tested without the Firestore emulator. A business opts into pickup and
// chooses one model:
//   * "distance" — any country; fee = base + perKm * driving distance.
//   * "borough"  — New York only; a flat fee per NYC borough.

const NEW_YORK_STATE_ALIASES = new Set(["NY", "NEW YORK"]);
const NYC_BOROUGHS = [
  "Bronx",
  "Manhattan",
  "Brooklyn",
  "Queens",
  "Staten Island",
];

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function businessIsNewYorkBased(business) {
  const state = String(
      business?.state || business?.parkingState || "",
  ).trim().toUpperCase();
  return NEW_YORK_STATE_ALIASES.has(state);
}

// Keeps only the five NYC boroughs mapped to non-negative numeric fees.
function sanitizeBoroughPrices(input) {
  if (!input || typeof input !== "object") return null;
  const prices = {};
  for (const borough of NYC_BOROUGHS) {
    const value = Number(input[borough]);
    if (Number.isFinite(value) && value >= 0) {
      prices[borough] = Math.round(value * 100) / 100;
    }
  }
  return Object.keys(prices).length ? prices : null;
}

// Normalizes the pickup config from a business document, coercing borough back
// to distance for any non-New-York business so the model is always coherent.
function resolveFreightPickupConfig(business) {
  const data = business || {};
  const requestedModel = String(
      data.freightPickupModel || "distance",
  ).toLowerCase();
  const model = requestedModel === "borough" && businessIsNewYorkBased(data) ?
    "borough" :
    "distance";
  const boroughPrices =
    data.freightPickupBoroughPrices &&
    typeof data.freightPickupBoroughPrices === "object" ?
      data.freightPickupBoroughPrices :
      null;
  return {
    enabled: data.freightPickupAvailable === true,
    model,
    baseFee: Math.max(0, Number(data.freightPickupBaseFee ?? 0)),
    perKm: Math.max(0, Number(data.freightPickupPerKm ?? 0)),
    minFee: Math.max(0, Number(data.freightPickupMinFee ?? 0)),
    maxKm: Math.max(0, Number(data.freightPickupMaxKm ?? 0)),
    originAddress: String(
        data.freightPickupOriginAddress || data.addressLine1 || "",
    ).trim(),
    originLat: clampNumber(data.freightPickupOriginLat, -90, 90),
    originLng: clampNumber(data.freightPickupOriginLng, -180, 180),
    boroughPrices,
  };
}

// Distance-model fee, rounded to cents and floored at the configured minimum.
function distancePickupFee({config, distanceKm}) {
  const raw = config.baseFee + Number(distanceKm) * config.perKm;
  return Math.round(Math.max(config.minFee, raw) * 100) / 100;
}

// Borough-model fee; returns null when the borough is not served.
function boroughPickupFee({config, borough}) {
  const key = String(borough || "").trim();
  const price = config.boroughPrices ? config.boroughPrices[key] : undefined;
  if (price == null) return null;
  return Math.max(0, Number(price));
}

module.exports = {
  NYC_BOROUGHS,
  businessIsNewYorkBased,
  sanitizeBoroughPrices,
  resolveFreightPickupConfig,
  distancePickupFee,
  boroughPickupFee,
};

"use strict";

const DEFAULT_BOROUGH_PRICES = Object.freeze({
  Bronx: 40,
  Manhattan: 64,
  Queens: 84,
  Brooklyn: 108,
  "Staten Island": 148,
});

const NYC_BOROUGHS = Object.freeze(Object.keys(DEFAULT_BOROUGH_PRICES));

function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeBarrelPickupPricing(data) {
  const pricing = data && typeof data === "object" ? data : {};
  const boroughPrices = {...DEFAULT_BOROUGH_PRICES};
  const legacyMiles =
    pricing.boroughMiles && typeof pricing.boroughMiles === "object" ?
      pricing.boroughMiles :
      {};
  const baseFee = finiteNonNegative(pricing.basePickupFee, 20);
  const perMileFee = finiteNonNegative(pricing.perMileFee, 4);
  const minimumFee = finiteNonNegative(pricing.minimumPickupFee, 35);
  for (const borough of NYC_BOROUGHS) {
    const miles = Number(legacyMiles[borough]);
    if (Number.isFinite(miles) && miles >= 0) {
      boroughPrices[borough] = Math.max(
          minimumFee,
          baseFee + miles * perMileFee,
      );
    }
  }
  const configuredPrices =
    pricing.boroughPrices && typeof pricing.boroughPrices === "object" ?
      pricing.boroughPrices :
      {};
  for (const borough of NYC_BOROUGHS) {
    const fee = Number(configuredPrices[borough]);
    if (Number.isFinite(fee) && fee >= 0) boroughPrices[borough] = fee;
  }
  return {
    officeAddress:
      String(pricing.officeAddress || "Bronx, NY").trim() || "Bronx, NY",
    boroughPrices,
    baseFee,
    perMileFee,
    minimumFee,
    maxMiles: finiteNonNegative(pricing.maxPickupMiles, 0),
  };
}

function barrelBoroughPickupFee(pricing, borough) {
  const key = NYC_BOROUGHS.find(
      (candidate) =>
        candidate.toLowerCase() === String(borough || "").trim().toLowerCase(),
  );
  if (!key) return null;
  const fee = Number(pricing?.boroughPrices?.[key]);
  return Number.isFinite(fee) && fee >= 0 ? fee : null;
}

function barrelDistancePickupFee(pricing, distanceMiles) {
  const miles = Number(distanceMiles);
  if (!Number.isFinite(miles) || miles < 0) return null;
  if (pricing.maxMiles > 0 && miles > pricing.maxMiles) return null;
  const fee = Math.max(
      pricing.minimumFee,
      pricing.baseFee + miles * pricing.perMileFee,
  );
  return Math.round(fee * 100) / 100;
}

module.exports = {
  DEFAULT_BOROUGH_PRICES,
  NYC_BOROUGHS,
  normalizeBarrelPickupPricing,
  barrelBoroughPickupFee,
  barrelDistancePickupFee,
};

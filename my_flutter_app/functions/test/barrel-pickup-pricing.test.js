"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  barrelBoroughPickupFee,
  barrelDistancePickupFee,
  normalizeBarrelPickupPricing,
} = require("../barrel_pickup_pricing");

describe("barrel pickup pricing", () => {
  it("keeps configured NYC fees without falling back for another area", () => {
    const pricing = normalizeBarrelPickupPricing({
      boroughPrices: {Bronx: 45, Brooklyn: 110},
    });
    assert.equal(barrelBoroughPickupFee(pricing, "Bronx"), 45);
    assert.equal(barrelBoroughPickupFee(pricing, "Brooklyn"), 110);
    assert.equal(barrelBoroughPickupFee(pricing, "Newark"), null);
    assert.equal(barrelBoroughPickupFee(pricing, ""), null);
  });

  it("prices non-NYC pickup by distance with minimum and range limits", () => {
    const pricing = normalizeBarrelPickupPricing({
      basePickupFee: 20,
      perMileFee: 4,
      minimumPickupFee: 35,
      maxPickupMiles: 50,
    });
    assert.equal(barrelDistancePickupFee(pricing, 2), 35);
    assert.equal(barrelDistancePickupFee(pricing, 10), 60);
    assert.equal(barrelDistancePickupFee(pricing, 51), null);
    assert.equal(barrelDistancePickupFee(pricing, Number.NaN), null);
  });

  it("keeps legacy mileage configuration compatible", () => {
    const pricing = normalizeBarrelPickupPricing({
      basePickupFee: 20,
      perMileFee: 4,
      minimumPickupFee: 35,
      boroughMiles: {Bronx: 5, Brooklyn: 22},
    });
    assert.equal(barrelBoroughPickupFee(pricing, "Bronx"), 40);
    assert.equal(barrelBoroughPickupFee(pricing, "Brooklyn"), 108);
  });
});

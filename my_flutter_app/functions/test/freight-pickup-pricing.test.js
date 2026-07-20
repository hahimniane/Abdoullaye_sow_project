const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  resolveFreightPickupConfig,
  sanitizeBoroughPrices,
  distancePickupFee,
  boroughPickupFee,
  businessIsNewYorkBased,
} = require("../freight_pickup_pricing");

describe("resolveFreightPickupConfig", () => {
  it("defaults to the distance model", () => {
    const config = resolveFreightPickupConfig({freightPickupAvailable: true});
    assert.equal(config.model, "distance");
    assert.equal(config.enabled, true);
  });

  it("keeps borough only for New York businesses", () => {
    const ny = resolveFreightPickupConfig({
      freightPickupModel: "borough",
      state: "NY",
    });
    assert.equal(ny.model, "borough");
  });

  it("coerces borough to distance outside New York", () => {
    const other = resolveFreightPickupConfig({
      freightPickupModel: "borough",
      state: "NJ",
    });
    assert.equal(other.model, "distance");
  });

  it("reports enabled only when explicitly opted in", () => {
    assert.equal(resolveFreightPickupConfig({}).enabled, false);
  });

  it("falls back the origin to the business street address", () => {
    const config = resolveFreightPickupConfig({addressLine1: "100 Test Ave"});
    assert.equal(config.originAddress, "100 Test Ave");
  });
});

describe("distancePickupFee", () => {
  it("charges base plus per-km distance", () => {
    const config = {baseFee: 10, perKm: 2, minFee: 0};
    assert.equal(distancePickupFee({config, distanceKm: 5}), 20);
  });

  it("never drops below the configured minimum", () => {
    const config = {baseFee: 0, perKm: 1, minFee: 15};
    assert.equal(distancePickupFee({config, distanceKm: 3}), 15);
  });

  it("rounds to whole cents", () => {
    const config = {baseFee: 10.999, perKm: 0, minFee: 0};
    assert.equal(distancePickupFee({config, distanceKm: 0}), 11);
  });
});

describe("boroughPickupFee", () => {
  const config = {boroughPrices: {Bronx: 40, Manhattan: 64}};

  it("returns the flat fee for a served borough", () => {
    assert.equal(boroughPickupFee({config, borough: "Bronx"}), 40);
  });

  it("returns null for an unserved borough", () => {
    assert.equal(boroughPickupFee({config, borough: "Queens"}), null);
  });
});

describe("sanitizeBoroughPrices", () => {
  it("keeps only valid NYC boroughs with non-negative fees", () => {
    const result = sanitizeBoroughPrices({
      Bronx: 40,
      Queens: -5,
      Chicago: 10,
    });
    assert.deepEqual(result, {Bronx: 40});
  });

  it("returns null when nothing is valid", () => {
    assert.equal(sanitizeBoroughPrices({Chicago: 10}), null);
    assert.equal(sanitizeBoroughPrices(null), null);
  });
});

describe("businessIsNewYorkBased", () => {
  it("matches NY and full state name, case-insensitively", () => {
    assert.equal(businessIsNewYorkBased({state: "ny"}), true);
    assert.equal(businessIsNewYorkBased({state: "New York"}), true);
    assert.equal(businessIsNewYorkBased({state: "CA"}), false);
  });
});

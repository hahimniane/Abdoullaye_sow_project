"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  normalizePickupConfig,
  normalizePickupPlan,
  resolveServicePickup,
  computePickupFeeCents,
} = require("../pickup_plan");

const NY = {isNewYork: true};
const NJ = {isNewYork: false};

describe("pickup config validation", () => {
  it("treats anything not explicitly enabled as disabled", () => {
    for (const raw of [undefined, null, {}, {enabled: false}, {mode: "flat"}]) {
      const {config, errors} = normalizePickupConfig(raw, NJ);
      assert.deepEqual(config, {enabled: false});
      assert.deepEqual(errors, []);
    }
  });

  it("requires the travel cap - an uncapped radius is the $11,000 bug", () => {
    const {config, errors} = normalizePickupConfig(
        {enabled: true, mode: "flat", flatFee: 25}, NJ);
    assert.equal(config, null);
    assert.deepEqual(errors, ["pickup_travel_cap_required"]);
  });

  it("accepts a complete flat config", () => {
    const {config, errors} = normalizePickupConfig(
        {enabled: true, mode: "flat", flatFee: 25, maxPickupMiles: 30}, NJ);
    assert.deepEqual(errors, []);
    assert.deepEqual(config, {
      enabled: true, mode: "flat", flatFee: 25, maxPickupMiles: 30,
    });
  });

  it("requires every distance fee to be present, not defaulted", () => {
    // "Enabled but unconfigured = free pickup forever" was a real leak;
    // presence is the guard.
    const {errors} = normalizePickupConfig(
        {enabled: true, mode: "distance", maxPickupMiles: 20,
          originAddress: "1 Main St"}, NJ);
    assert.deepEqual(errors.sort(), [
      "pickup_base_fee_required",
      "pickup_minimum_fee_required",
      "pickup_per_mile_fee_required",
    ]);
  });

  it("requires an origin address for distance mode", () => {
    const {errors} = normalizePickupConfig(
        {enabled: true, mode: "distance", maxPickupMiles: 20,
          baseFee: 10, perMileFee: 2, minimumFee: 15}, NJ);
    assert.deepEqual(errors, ["pickup_origin_address_required"]);
  });

  it("refuses borough mode outside New York", () => {
    const {errors} = normalizePickupConfig(
        {enabled: true, mode: "borough", boroughPrices: {Bronx: 40}}, NJ);
    assert.ok(errors.includes("pickup_borough_requires_new_york"));
  });

  it("accepts borough mode for a New York business", () => {
    const {config, errors} = normalizePickupConfig(
        {enabled: true, mode: "borough",
          boroughPrices: {bronx: 40, "STATEN ISLAND": 148}}, NY);
    assert.deepEqual(errors, []);
    // Keys are canonicalized to the borough's own spelling.
    assert.deepEqual(config.boroughPrices,
        {"Bronx": 40, "Staten Island": 148});
  });

  it("rejects unknown boroughs and negative fees", () => {
    const {errors} = normalizePickupConfig(
        {enabled: true, mode: "borough",
          boroughPrices: {Yonkers: 30, Bronx: -5}}, NY);
    assert.ok(errors.includes("pickup_unknown_borough:Yonkers"));
    assert.ok(errors.includes("pickup_borough_fee_invalid:Bronx"));
  });
});

describe("pickup plan validation", () => {
  const SHARED = {enabled: true, mode: "flat", flatFee: 30, maxPickupMiles: 25};

  it("accepts a shared plan with inherit and override entries", () => {
    const {plan, errors} = normalizePickupPlan({
      shared: SHARED,
      services: {
        freight: {inherit: true},
        parking: {enabled: true, mode: "flat", flatFee: 10,
          maxPickupMiles: 10},
      },
    }, NJ);
    assert.deepEqual(errors, []);
    assert.equal(plan.version, 1);
    assert.deepEqual(plan.services.freight, {inherit: true});
    assert.equal(plan.services.parking.inherit, false);
    assert.equal(plan.services.parking.flatFee, 10);
  });

  it("prefixes override errors with the service name", () => {
    const {errors} = normalizePickupPlan({
      shared: SHARED,
      services: {barrels: {enabled: true, mode: "flat", flatFee: 20}},
    }, NJ);
    assert.deepEqual(errors, ["barrels.pickup_travel_cap_required"]);
  });

  it("rejects services outside the known set", () => {
    const {errors} = normalizePickupPlan(
        {shared: SHARED, services: {sharedBarrels: {inherit: true}}}, NJ);
    assert.deepEqual(errors, ["pickup_unknown_service:sharedBarrels"]);
  });
});

describe("resolving the effective config for a service", () => {
  const plan = {
    version: 1,
    shared: {enabled: true, mode: "flat", flatFee: 30, maxPickupMiles: 25},
    services: {
      freight: {inherit: true},
      parking: {inherit: false, enabled: true, mode: "flat", flatFee: 10,
        maxPickupMiles: 10},
      carTransport: {inherit: false, enabled: false},
    },
  };

  it("an absent service key inherits the shared plan", () => {
    assert.equal(resolveServicePickup(plan, "barrels").flatFee, 30);
  });

  it("an explicit inherit entry resolves to the shared plan", () => {
    assert.equal(resolveServicePickup(plan, "freight").flatFee, 30);
  });

  it("an override wins over the shared plan", () => {
    assert.equal(resolveServicePickup(plan, "parking").flatFee, 10);
  });

  it("a disabled override turns pickup off for that service only", () => {
    assert.equal(resolveServicePickup(plan, "carTransport"), null);
    assert.equal(resolveServicePickup(plan, "barrels").enabled, true);
  });

  it("no plan, or a disabled shared plan, means no pickup", () => {
    assert.equal(resolveServicePickup(null, "barrels"), null);
    assert.equal(resolveServicePickup(
        {version: 1, shared: {enabled: false}, services: {}}, "barrels"),
    null);
  });
});

describe("computing the fee from a server-derived measurement", () => {
  it("flat: one price inside the cap, refusal beyond it", () => {
    const config = {enabled: true, mode: "flat", flatFee: 30,
      maxPickupMiles: 25};
    assert.deepEqual(computePickupFeeCents(config, {miles: 24.9}),
        {ok: true, feeCents: 3000});
    assert.deepEqual(computePickupFeeCents(config, {miles: 25.1}),
        {ok: false, reason: "out_of_area"});
  });

  it("distance: base + per-mile with a floor, capped", () => {
    const config = {enabled: true, mode: "distance", baseFee: 10,
      perMileFee: 2, minimumFee: 18, maxPickupMiles: 40};
    // 10 + 2*3 = 16 -> floor 18
    assert.deepEqual(computePickupFeeCents(config, {miles: 3}),
        {ok: true, feeCents: 1800});
    // 10 + 2*12 = 34
    assert.deepEqual(computePickupFeeCents(config, {miles: 12}),
        {ok: true, feeCents: 3400});
    assert.deepEqual(computePickupFeeCents(config, {miles: 41}),
        {ok: false, reason: "out_of_area"});
  });

  it("borough: the price of the derived borough, case-insensitively", () => {
    const config = {enabled: true, mode: "borough",
      boroughPrices: {"Bronx": 40, "Staten Island": 148}};
    assert.deepEqual(computePickupFeeCents(config, {borough: "bronx"}),
        {ok: true, feeCents: 4000});
    // Priced boroughs bound the area: anything else is a refusal, never a
    // fallback to some other borough's price.
    assert.deepEqual(computePickupFeeCents(config, {borough: "Queens"}),
        {ok: false, reason: "out_of_area"});
  });

  it("refuses to price without a measurement instead of guessing", () => {
    const flat = {enabled: true, mode: "flat", flatFee: 30,
      maxPickupMiles: 25};
    const borough = {enabled: true, mode: "borough",
      boroughPrices: {"Bronx": 40}};
    assert.deepEqual(computePickupFeeCents(flat, {}),
        {ok: false, reason: "measurement_missing"});
    assert.deepEqual(computePickupFeeCents(borough, {}),
        {ok: false, reason: "measurement_missing"});
  });

  it("returns integer cents, never floats", () => {
    const config = {enabled: true, mode: "distance", baseFee: 10.10,
      perMileFee: 0.33, minimumFee: 0, maxPickupMiles: 50};
    const result = computePickupFeeCents(config, {miles: 7});
    assert.equal(result.ok, true);
    assert.equal(Number.isInteger(result.feeCents), true);
    assert.equal(result.feeCents, 1241); // 10.10 + 7 * 0.33 = 12.41
  });
});

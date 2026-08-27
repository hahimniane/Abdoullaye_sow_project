"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  businessServicePlatformFeePct,
  businessPlatformFeePctFromBusiness,
  servicePlatformFeePctFromPricing,
  resolvePlatformFeePct,
  servicePlatformFeePctForBusiness,
} = require("../platform_fees");

const PRICING = {
  parkingPlatformFeePct: 0.1,
  freightPlatformFeePct: 0.08,
  barrelPlatformFeePct: 0.12,
};
const PARKING = ["parkingPlatformFeePct"];
const FREIGHT = ["freightPlatformFeePct"];
const SHARED_BARREL = ["sharedBarrelPlatformFeePct", "barrelPlatformFeePct"];

describe("three-level fee resolution", () => {
  it("a per-service override wins over everything", () => {
    const business = {
      platformFeePct: 0.025,
      servicePlatformFeePct: {parkingPlatformFeePct: 0.05},
    };
    assert.equal(
        servicePlatformFeePctForBusiness(PRICING, business, PARKING), 0.05);
    // ...and only for that service: freight still falls to the business rate.
    assert.equal(
        servicePlatformFeePctForBusiness(PRICING, business, FREIGHT), 0.025);
  });

  it("without a per-service override, the business rate applies", () => {
    const business = {platformFeePct: 0.025};
    assert.equal(
        servicePlatformFeePctForBusiness(PRICING, business, PARKING), 0.025);
  });

  it("without any business rate, the platform's service rate applies", () => {
    assert.equal(servicePlatformFeePctForBusiness(PRICING, {}, PARKING), 0.1);
    assert.equal(servicePlatformFeePctForBusiness(PRICING, {}, FREIGHT), 0.08);
  });

  it("reports which level decided, so an admin can see what is winning", () => {
    const business = {
      platformFeePct: 0.025,
      servicePlatformFeePct: {parkingPlatformFeePct: 0.05},
    };
    assert.deepEqual(resolvePlatformFeePct(PRICING, business, PARKING), {
      pct: 0.05, source: "business_service", key: "parkingPlatformFeePct",
    });
    assert.equal(
        resolvePlatformFeePct(PRICING, business, FREIGHT).source, "business");
    assert.equal(
        resolvePlatformFeePct(PRICING, {}, PARKING).source, "platform");
  });

  it("an unusable override falls THROUGH rather than being applied", () => {
    // A typo must never charge a customer 500%; it must be ignored so the
    // next level decides.
    for (const bad of [5, -0.1, 1, "abc", NaN, Infinity]) {
      const business = {
        platformFeePct: 0.025,
        servicePlatformFeePct: {parkingPlatformFeePct: bad},
      };
      assert.equal(
          servicePlatformFeePctForBusiness(PRICING, business, PARKING),
          0.025,
          `${bad} should be ignored`,
      );
    }
  });

  it("zero is a real rate, not a missing one", () => {
    const business = {
      platformFeePct: 0.025,
      servicePlatformFeePct: {parkingPlatformFeePct: 0},
    };
    assert.equal(
        servicePlatformFeePctForBusiness(PRICING, business, PARKING), 0);
  });

  it("respects the shared-barrel fallback order at the override level", () => {
    // A business override on plain barrels must still apply to shared
    // barrels, exactly as the platform defaults do.
    const business = {servicePlatformFeePct: {barrelPlatformFeePct: 0.03}};
    assert.equal(
        servicePlatformFeePctForBusiness(PRICING, business, SHARED_BARREL),
        0.03);
    // ...and a shared-barrel-specific override beats the barrel one.
    const specific = {
      servicePlatformFeePct: {
        sharedBarrelPlatformFeePct: 0.01,
        barrelPlatformFeePct: 0.03,
      },
    };
    assert.equal(
        servicePlatformFeePctForBusiness(PRICING, specific, SHARED_BARREL),
        0.01);
  });

  it("ignores a malformed override map instead of throwing", () => {
    for (const overrides of ["nope", 5, [], null]) {
      const business = {
        platformFeePct: 0.025, servicePlatformFeePct: overrides,
      };
      assert.equal(
          servicePlatformFeePctForBusiness(PRICING, business, PARKING), 0.025);
    }
  });
});

describe("behaviour that must not change", () => {
  it("the legacy platformCommissionPct field is still honoured", () => {
    assert.equal(
        businessPlatformFeePctFromBusiness({platformCommissionPct: 0.04}),
        0.04);
  });

  it("an explicit null in pricing falls through to the default", () => {
    // The original resolution treated null as "not set"; a change here would
    // silently start charging 0 on a service.
    assert.equal(
        servicePlatformFeePctFromPricing(
            {parkingPlatformFeePct: null}, PARKING),
        0.1);
  });

  it("a present but unusable pricing value reads as zero", () => {
    assert.equal(
        servicePlatformFeePctFromPricing({parkingPlatformFeePct: 5}, PARKING),
        0,
    );
  });

  it("no pricing document at all falls back to the platform default", () => {
    assert.equal(servicePlatformFeePctFromPricing(null, PARKING), 0.1);
    assert.equal(servicePlatformFeePctFromPricing({}, PARKING), 0.1);
  });

  it("businessServicePlatformFeePct returns null when there is nothing", () => {
    assert.equal(businessServicePlatformFeePct({}, PARKING), null);
    assert.equal(businessServicePlatformFeePct(null, PARKING), null);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalDestinationServiceAvailability,
  destinationCanActivate,
  destinationDepartureDays,
  destinationRateError,
  destinationServiceAvailability,
  EMPTY_DESTINATION_SERVICE_AVAILABILITY,
} from "./destination-pricing.ts";

const noRates = {
  barrelShippingPrice: 0,
  freightAirPricePerKg: 0,
  freightSeaPricePerKg: 0,
};

describe("destination pricing gates", () => {
  it("requires a rate only for a selected paid service", () => {
    assert.match(
      destinationRateError(
        ["barrelShipping"],
        { ...EMPTY_DESTINATION_SERVICE_AVAILABILITY, barrelShipping: true },
        noRates,
      ),
      /barrel shipping price/,
    );
    assert.equal(
      destinationCanActivate(
        ["barrelShipping"],
        { ...EMPTY_DESTINATION_SERVICE_AVAILABILITY, barrelShipping: true },
        {
          ...noRates,
          barrelShippingPrice: 225,
        },
      ),
      true,
    );
  });

  it("validates air and sea freight independently", () => {
    assert.match(
      destinationRateError(
        ["freight"],
        { ...EMPTY_DESTINATION_SERVICE_AVAILABILITY, freightAir: true },
        noRates,
      ),
      /air freight/,
    );
    assert.equal(
      destinationCanActivate(
        ["freight"],
        { ...EMPTY_DESTINATION_SERVICE_AVAILABILITY, freightSea: true },
        { ...noRates, freightSeaPricePerKg: 5 },
      ),
      true,
    );
  });

  it("allows quote-based car transport without a fixed rate", () => {
    assert.equal(
      destinationCanActivate(
        ["carTransport"],
        { ...EMPTY_DESTINATION_SERVICE_AVAILABILITY, carTransport: true },
        noRates,
      ),
      true,
    );
  });

  it("masks country coverage that the business does not offer globally", () => {
    assert.deepEqual(
      canonicalDestinationServiceAvailability(
        ["freight"],
        {
          barrelShipping: true,
          freightAir: true,
          freightSea: false,
          carTransport: true,
        },
      ),
      {
        barrelShipping: false,
        freightAir: true,
        freightSea: false,
        carTransport: false,
      },
    );
  });

  it("never infers legacy car transport from a generic active flag", () => {
    assert.deepEqual(
      destinationServiceAvailability({
        isActive: true,
        barrelShippingPrice: 225,
      }),
      {
        barrelShipping: true,
        freightAir: false,
        freightSea: false,
        carTransport: false,
      },
    );
  });

  it("treats missing keys in a v2 map as disabled", () => {
    assert.deepEqual(
      destinationServiceAvailability({
        isActive: true,
        barrelShippingPrice: 225,
        serviceAvailability: { freightAir: true },
      }),
      {
        barrelShipping: false,
        freightAir: true,
        freightSea: false,
        carTransport: false,
      },
    );
  });

  it("normalizes freight departure days into calendar order", () => {
    assert.deepEqual(
      destinationDepartureDays([
        "thursday",
        "monday",
        "thursday",
        "funday",
      ]),
      ["monday", "thursday"],
    );
    assert.deepEqual(destinationDepartureDays("monday"), []);
  });
});

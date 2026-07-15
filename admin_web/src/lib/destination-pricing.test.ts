import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  destinationCanActivate,
  destinationRateError,
} from "./destination-pricing.ts";

const noRates = {
  barrelShippingPrice: 0,
  freightAirPricePerKg: 0,
  freightSeaPricePerKg: 0,
};

describe("destination pricing gates", () => {
  it("requires a barrel rate only for businesses offering barrels", () => {
    assert.match(
      destinationRateError(["barrelShipping"], noRates),
      /barrel shipping price/,
    );
    assert.equal(
      destinationCanActivate(["barrelShipping"], {
        ...noRates,
        barrelShippingPrice: 225,
      }),
      true,
    );
  });

  it("accepts either an air or sea rate for a freight-only business", () => {
    assert.match(destinationRateError(["freight"], noRates), /air or sea/);
    assert.equal(
      destinationCanActivate(["freight"], {
        ...noRates,
        freightSeaPricePerKg: 5,
      }),
      true,
    );
    assert.equal(
      destinationCanActivate(["freight"], {
        ...noRates,
        freightAirPricePerKg: 12.5,
      }),
      true,
    );
  });

  it("requires both service configurations when both are offered", () => {
    assert.equal(
      destinationCanActivate(["barrelShipping", "freight"], {
        ...noRates,
        barrelShippingPrice: 225,
        freightAirPricePerKg: 12.5,
      }),
      true,
    );
    assert.match(
      destinationRateError(["barrelShipping", "freight"], {
        ...noRates,
        freightAirPricePerKg: 12.5,
      }),
      /barrel shipping price/,
    );
  });
});

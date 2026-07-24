import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { customerCarListingIsEligible } from "./customer-service-eligibility.ts";

test("customer car listings mirror the mobile business capability gate", () => {
  assert.equal(
    customerCarListingIsEligible({
      status: "active",
      businessStatus: "approved",
      enabledServices: ["carSales"],
    }),
    true,
  );
  assert.equal(
    customerCarListingIsEligible({
      status: "active",
      businessStatus: "approved",
      enabledServices: ["barrelShipping"],
    }),
    false,
  );
  assert.equal(
    customerCarListingIsEligible({
      status: "active",
      businessStatus: "pending",
      enabledServices: ["carSales"],
    }),
    false,
  );
  assert.equal(
    customerCarListingIsEligible({
      status: "sold",
      businessStatus: "approved",
      enabledServices: ["carSales"],
    }),
    false,
  );
  assert.equal(customerCarListingIsEligible({ status: "active" }), true);
});

test("an open car detail closes when its listing becomes ineligible", () => {
  const source = readFileSync(
    new URL("../components/customer-cars.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /selectedCar[\s\S]*!state\.rows\.some\(\(car\) => car\.id === selectedCar\.id\)[\s\S]*setSelectedCar\(null\)[\s\S]*setAction\(null\)/,
  );
  assert.match(
    source,
    /That car listing is no longer available\. Choose another listing\./,
  );
});

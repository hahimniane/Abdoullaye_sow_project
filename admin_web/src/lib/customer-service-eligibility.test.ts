import assert from "node:assert/strict";
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

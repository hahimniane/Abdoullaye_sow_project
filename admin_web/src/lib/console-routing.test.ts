import assert from "node:assert/strict";
import test from "node:test";

import { resolveConsoleKind, serviceEntryApplies } from "./console-routing.ts";

test("routes every supported account role to its own console", () => {
  assert.equal(resolveConsoleKind("admin"), "admin");
  assert.equal(resolveConsoleKind("businessOwner"), "business");
  assert.equal(resolveConsoleKind("staff"), "business");
  assert.equal(resolveConsoleKind("customer"), "customer");
});

test("fails closed for missing and unknown account roles", () => {
  assert.equal(resolveConsoleKind(undefined), "unsupported");
  assert.equal(resolveConsoleKind(null), "unsupported");
  assert.equal(resolveConsoleKind("owner"), "unsupported");
  assert.equal(resolveConsoleKind(""), "unsupported");
});

test("service links open the guest service page for guests and customers, as before", () => {
  for (const service of ["barrel", "freight", "car-transport", "parking", "shared-barrels", "cars", "tracking"]) {
    assert.equal(serviceEntryApplies(service, null), true, `${service} for a guest`);
    assert.equal(serviceEntryApplies(service, "customer"), true, `${service} for a customer`);
  }
  assert.equal(serviceEntryApplies(null, null), false);
  assert.equal(serviceEntryApplies("", "customer"), false);
});

test("a package label's tracking link opens the tracking page for business and admin accounts too", () => {
  assert.equal(serviceEntryApplies("tracking", "business"), true);
  assert.equal(serviceEntryApplies("tracking", "admin"), true);
  // Every other service link keeps them in their own console.
  for (const service of ["barrel", "freight", "car-transport", "parking", "shared-barrels", "cars"]) {
    assert.equal(serviceEntryApplies(service, "business"), false, `${service} for a business account`);
    assert.equal(serviceEntryApplies(service, "admin"), false, `${service} for an admin`);
  }
  // An unsupported role still fails closed to the router's own handling.
  assert.equal(serviceEntryApplies("tracking", "unsupported"), false);
});

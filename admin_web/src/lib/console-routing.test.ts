import assert from "node:assert/strict";
import test from "node:test";

import { consoleAccessLost, resolveConsoleKind, serviceEntryApplies } from "./console-routing.ts";

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

test("an inventory tag's page opens for everyone who has a console, and for guests", () => {
  for (const kind of [null, "customer", "business", "admin"] as const) {
    assert.equal(serviceEntryApplies("item-tag", kind), true, `item-tag for ${kind}`);
  }
  // An unsupported role still fails closed to the router's own handling.
  assert.equal(serviceEntryApplies("item-tag", "unsupported"), false);
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

test("a staff invitation's page opens for guests, customers, staff and admins alike", () => {
  for (const kind of [null, "customer", "business", "admin"] as const) {
    assert.equal(serviceEntryApplies("staff-invite", kind), true, `staff-invite for ${kind}`);
  }
  assert.equal(serviceEntryApplies("staff-invite", "unsupported"), false);
});

test("losing business or platform access is noticed from the live profile; gaining it is not", () => {
  const staff = { role: "staff", businessId: "biz1" };
  // Removed: role customer, moved to another business, or the profile gone.
  assert.equal(consoleAccessLost(staff, { role: "customer", businessId: "" }), true);
  assert.equal(consoleAccessLost(staff, { role: "staff", businessId: "biz2" }), true);
  assert.equal(consoleAccessLost(staff, null), true);
  assert.equal(consoleAccessLost({ role: "admin" }, { role: "customer" }), true);
  assert.equal(consoleAccessLost({ role: "businessOwner", businessId: "biz1" }, { role: "suspended" }), true);
  // Unchanged access, an owner handing ownership over within the business.
  assert.equal(consoleAccessLost(staff, { ...staff, fullName: "New name" } as never), false);
  assert.equal(consoleAccessLost({ role: "businessOwner", businessId: "biz1" }, staff), false);
  assert.equal(consoleAccessLost({ role: "admin" }, { role: "admin" }), false);
  // A customer accepting an invitation gains access: nothing to cut.
  assert.equal(consoleAccessLost({ role: "customer" }, staff), false);
  assert.equal(consoleAccessLost(null, staff), false);
  assert.equal(consoleAccessLost({ role: "customer" }, null), false);
});

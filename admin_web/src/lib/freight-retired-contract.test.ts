import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { businessServiceLabel } from "./business-verification.ts";

// Freight folded into Send a package (docs/PACKAGE_PRICE_LIST.md decision 12).
// Businesses and admins no longer see it as a service to pick, but a business
// that already has it keeps it, and its old records stay readable.
const read = (path: string) => readFileSync(`src/${path}`, "utf8");

test("a business that still has the retired service reads as retired, never as a live service", () => {
  assert.equal(businessServiceLabel("freight"), "Freight (retired)");
  assert.match(read("components/business-console.tsx"), /freight: "Freight \(retired\)"/);
});

test("the admin console offers no Freight service or permission to pick", () => {
  const admin = read("components/admin-console.tsx");
  const businessServices = admin.slice(
    admin.indexOf("const businessServices = ["),
    admin.indexOf("const retiredBusinessServices"),
  );
  assert.doesNotMatch(businessServices, /"freight"/);
  const platform = admin.slice(
    admin.indexOf("const PLATFORM_SERVICES"),
    admin.indexOf("const RETIRED_PLATFORM_SERVICE"),
  );
  assert.doesNotMatch(platform, /"freight"/);
  const permissions = admin.slice(
    admin.indexOf("const businessStaffPermissionOptions = ["),
    admin.indexOf("] as const;", admin.indexOf("const businessStaffPermissionOptions = [")),
  );
  assert.doesNotMatch(permissions, /"freight"/);
  // A business that already has it is still named, not shown as a raw id.
  assert.match(admin, /retiredBusinessServices = \[\{ id: "freight", label: "Freight \(retired\)" \}\]/);
  // The destination row no longer offers Air/Sea freight.
  assert.doesNotMatch(admin, /toggleService\("freightAir"/);
  assert.doesNotMatch(admin, /toggleService\("freightSea"/);
});

test("the business profile offers no Freight service and grants no new Freight permission", () => {
  const profile = read("components/business/profile-support-people.tsx");
  assert.match(profile, /service\.id !== "freight"/);
  assert.match(profile, /option\.id !== "freight" \|\| held\.includes\(option\.id\)/);
  assert.match(profile, /visiblePermissionOptions\(draft\.businessPermissions\)/);
  assert.match(profile, /visiblePermissionOptions\(permissions\)/);
  // No separate Freight choice among the pickup rows; the stored override is kept.
  assert.match(profile, /pickupRowServices = enabledPickupServices\.filter/);
});

test("the Shipping page shows the Freight step only while there are old freight records", () => {
  const console_ = read("components/business-console.tsx");
  assert.match(console_, /useBusinessHasRecords\("freightShipments"/);
  assert.match(console_, /useBusinessHasRecords\("freightQuoteRequests"/);
  assert.match(console_, /\{hasFreightRecords\}/);
});

test("country coverage no longer offers or shows Air/Sea freight, and keeps what is stored", () => {
  const operations = read("components/business/operations-panels.tsx");
  assert.doesNotMatch(operations, /title="Freight — Air"/);
  assert.doesNotMatch(operations, /title="Freight — Sea"/);
  assert.doesNotMatch(operations, /Enable barrel shipping, freight, or car transport/);
  // The save still writes the stored freight values back.
  assert.match(operations, /freightAirPricePerKg: rates\.freightAirPricePerKg/);
  assert.match(operations, /serviceAvailability: availability/);
});

test("no customer path leads into the old freight booking", () => {
  const guest = read("components/guest-tracking.tsx");
  assert.doesNotMatch(guest, /service=freight/);
  assert.doesNotMatch(guest, /Continue to booking/);
  assert.doesNotMatch(read("components/customer-console.tsx"), /Continue to booking/);
});

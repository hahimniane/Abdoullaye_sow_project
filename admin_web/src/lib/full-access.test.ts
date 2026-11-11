import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { FULL_ACCESS_EXPLAINED, effectiveProfile, fullAccessRequest, hasFullAccess, isRealOwner } from "./full-access.ts";

const require = createRequire(import.meta.url);
const server = require("../../../my_flutter_app/functions/staff_full_access.js");

const staff = (extra: Record<string, unknown> = {}) => ({ id: "s1", role: "staff", businessId: "b1", ...extra });

test("the console sees a full-access member as the server does", () => {
  for (const profile of [staff({ fullAccess: true }), staff(), staff({ fullAccess: "true" }),
    staff({ fullAccess: true, businessId: "" }), { role: "businessOwner", businessId: "b1" },
    { role: "customer", fullAccess: true }, { role: "admin", fullAccess: true }]) {
    assert.deepEqual(effectiveProfile(profile), server.effectiveUser(profile), JSON.stringify(profile));
  }
  assert.equal(effectiveProfile(staff({ fullAccess: true })).role, "businessOwner");
});

test("only the real owner of that business is the real owner", () => {
  assert.equal(isRealOwner({ role: "businessOwner", businessId: "b1" }, "b1"), true);
  assert.equal(isRealOwner({ role: "businessOwner", businessId: "b2" }, "b1"), false);
  assert.equal(isRealOwner(effectiveProfile(staff({ fullAccess: true })), "b1"), false);
  assert.equal(isRealOwner(staff(), "b1"), false);
  assert.equal(isRealOwner(null, "b1"), false);
  assert.equal(hasFullAccess(staff({ fullAccess: true })), true);
  assert.equal(hasFullAccess(staff()), false);
  assert.equal(hasFullAccess({ role: "businessOwner", fullAccess: true }), false);
});

test("the switch keeps the permissions and names the flag the server reads", () => {
  assert.deepEqual(fullAccessRequest("b1", "s1", ["parking"], true),
    { businessId: "b1", staffUid: "s1", businessPermissions: ["parking"], fullAccess: true });
  const source = readFileSync("../my_flutter_app/functions/index.js", "utf8");
  assert.match(source, /typeof request\.data\?\.fullAccess === "boolean"/);
  const french = readFileSync("src/lib/french-dom.ts", "utf8");
  for (const english of [FULL_ACCESS_EXPLAINED, "Full access", "Give full access", "Remove full access"]) {
    assert.ok(french.includes(JSON.stringify(english) + ":"), english);
  }
});

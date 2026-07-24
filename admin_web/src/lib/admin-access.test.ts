import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  resolveAdminRoleKey,
  resolveAssignableAdminRole,
} from "./admin-access.ts";

test("missing administrator roles fail closed outside preview mode", () => {
  assert.equal(resolveAdminRoleKey(undefined, false), "");
  assert.equal(resolveAdminRoleKey(null, false), "");
  assert.equal(resolveAdminRoleKey("", false), "");
  assert.equal(resolveAdminRoleKey("   ", false), "");
});

test("explicit administrator roles are normalized", () => {
  assert.equal(
    resolveAdminRoleKey("  operationsManager  ", false),
    "operationsManager",
  );
});

test("preview mode remains an explicit super-admin fixture", () => {
  assert.equal(resolveAdminRoleKey(undefined, true), "superAdmin");
});

test("unassigned and unknown administrator roles are never displayed as super admin", () => {
  const roleKeys = ["superAdmin", "operationsManager"];
  assert.equal(resolveAssignableAdminRole(undefined, roleKeys), "");
  assert.equal(resolveAssignableAdminRole("legacyRole", roleKeys), "");
  assert.equal(
    resolveAssignableAdminRole("operationsManager", roleKeys),
    "operationsManager",
  );
});

test("non-current administrators can lose admin access without account deletion", () => {
  const source = readFileSync(
    "src/components/admin-console.tsx",
    "utf8",
  );
  const start = source.indexOf("function PersonDetailWorkspace");
  const end = source.indexOf("function buildRolesDraft", start);
  const section = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(section, /kind === "admin" && !isCurrentUser/);
  assert.match(section, /updateRole\(userId,\s*"customer"\)/);
  assert.match(section, /Remove admin access/);
  assert.match(section, /confirmFr:/);
});

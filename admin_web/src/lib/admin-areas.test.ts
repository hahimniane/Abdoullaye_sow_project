import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adminAreaIds,
  adminAreas,
  nonGrantableAreas,
  roleCapabilityAreas,
  roleEditableAreas,
  roleGrantableAreas,
} from "./admin-areas.ts";

const consoleSource = readFileSync("src/components/admin-console.tsx", "utf8");

test("every area declares how access to it is decided", () => {
  // The point of the list: adding an area forces the decision rather than
  // letting it default to invisible-to-every-role.
  for (const area of adminAreas) {
    assert.ok(area.id, "an area has no id");
    assert.ok(area.label, `${area.id} has no label`);
    assert.ok(
      ["always", "role", "capability", "superAdmin"].includes(area.governance),
      `${area.id} has no governance`,
    );
  }
});

test("anything a role can be granted carries the capability it confers", () => {
  for (const area of roleGrantableAreas) {
    assert.ok(
      area.cap,
      `${area.id} is grantable but names no capability, so "manage" would grant nothing`,
    );
  }
});

test("area ids are unique", () => {
  assert.equal(new Set(adminAreaIds).size, adminAreaIds.length);
});

test("the console derives its tab list from this one", () => {
  // The regression this file exists to prevent: a second hand-written copy of
  // the same list drifting from it. If someone reintroduces a literal tab
  // array, this fails and points at why.
  assert.match(
    consoleSource,
    /const tabs = adminAreaIds/,
    "admin-console no longer derives tabs from adminAreaIds",
  );
  assert.doesNotMatch(
    consoleSource,
    /const SUPER_ADMIN_TABS: Tab\[\] = \[\s*"today"/,
    "SUPER_ADMIN_TABS is a hand-written copy again",
  );
  assert.doesNotMatch(
    consoleSource,
    /const EDITABLE_SECTIONS: Array<\{[\s\S]{0,200}?\}> = \[\s*\{ tab:/,
    "EDITABLE_SECTIONS is a hand-written copy again",
  );
});

test("every grantable area reaches the role editor", () => {
  // What the user actually asked for: a new capability shows up as something a
  // new role can be given, without anyone remembering to add it twice.
  assert.equal(
    roleEditableAreas.length + roleCapabilityAreas.length,
    roleGrantableAreas.length,
  );
  assert.ok(roleGrantableAreas.length >= 7);
  for (const id of ["businesses", "people", "marketplace", "operations", "finance", "website", "support"]) {
    assert.ok(
      roleGrantableAreas.some((area) => area.id === id),
      `${id} is no longer grantable to a role`,
    );
  }
});

test("areas outside the role editor are deliberate, not forgotten", () => {
  assert.deepEqual(
    nonGrantableAreas.map((area) => area.id).sort(),
    ["settings", "today", "tools"],
  );
});

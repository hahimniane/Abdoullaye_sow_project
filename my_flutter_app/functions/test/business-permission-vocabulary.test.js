// The staff-permission vocabulary lives in four places: this backend list
// (the only one that is enforced - anything else is stripped from every
// invitation and permission edit), the web sidebar, the web People panel, and
// the Flutter permission constants. On 2026-09-03 the "ledger" tab shipped on
// web and app without the backend key, so no staff could ever be granted it.
// This test keeps the four lists in step by reading the source files.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

function backendPermissions() {
  const source = read("my_flutter_app", "functions", "index.js");
  const block = source.match(
      /const VALID_BUSINESS_PERMISSIONS = \[([^\]]*)\];/,
  );
  assert.ok(block, "VALID_BUSINESS_PERMISSIONS not found");
  return [...block[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
}

function sidebarPermissions() {
  const source = read("admin_web", "src", "lib", "business-sidebar.ts");
  return [...new Set(
      [...source.matchAll(/permission: "([a-z]+)"/g)].map((m) => m[1]),
  )];
}

function peoplePanelPermissions() {
  const source = read(
      "admin_web", "src", "components", "business",
      "profile-support-people.tsx",
  );
  const block = source.match(
      /const businessPermissionOptions = \[([^\]]*)\];/,
  );
  assert.ok(block, "businessPermissionOptions not found");
  return [...block[1].matchAll(/id: "([a-z]+)"/g)].map((m) => m[1]);
}

function flutterPermissions() {
  const source = read(
      "my_flutter_app", "lib", "utils", "business_permissions.dart");
  return [...source.matchAll(/static const [a-z]+ = '([a-z]+)';/g)]
      .map((m) => m[1]);
}

test("every permission a console tab gates on is accepted by the backend",
    () => {
      const backend = new Set(backendPermissions());
      for (const key of sidebarPermissions()) {
        assert.ok(
            backend.has(key),
            `sidebar tab permission "${key}" is stripped by the backend`);
      }
    });

test("the web People panel offers exactly the backend vocabulary", () => {
  assert.deepEqual(
      peoplePanelPermissions().sort(), backendPermissions().sort());
});

test("the Flutter permission constants match the backend vocabulary", () => {
  assert.deepEqual(flutterPermissions().sort(), backendPermissions().sort());
});

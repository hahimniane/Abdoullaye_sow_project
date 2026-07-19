const assert = require("node:assert/strict");
const test = require("node:test");

const {
  explicitAccessUpdate,
  parseArgs,
} = require("../scripts/migrate-explicit-access");

test("legacy access gets explicit least-privilege assignments", () => {
  assert.equal(explicitAccessUpdate({role: "customer"}), null);
  assert.equal(explicitAccessUpdate({
    role: "admin",
    adminRole: "financeManager",
  }), null);
  assert.deepEqual(explicitAccessUpdate({role: "admin"}), {
    adminRole: "supportAdmin",
    accessMigrationNote: "Legacy admin defaulted to least privilege",
  });
  assert.deepEqual(explicitAccessUpdate({
    role: "staff",
    businessPermissions: [],
  }), {
    businessPermissions: ["profile"],
    accessMigrationNote: "Legacy staff defaulted to profile-only access",
  });
});

test("apply mode requires an exact project confirmation", () => {
  assert.deepEqual(parseArgs(["--project", "demo"]), {
    apply: false,
    project: "demo",
  });
  assert.throws(
      () => parseArgs(["--project", "prod", "--apply"]),
      /exactly match/,
  );
});

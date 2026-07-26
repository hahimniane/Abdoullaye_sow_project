const assert = require("node:assert/strict");
const test = require("node:test");

const {
  backfillUserClaims,
  claimsFromProfile,
  parseArgs,
} = require("../scripts/backfill-user-claims");

test("backfill arguments require an exact project confirmation", () => {
  assert.deepEqual(
      parseArgs(["--project", "demo-laawol", "--confirm", "demo-laawol"]),
      {projectId: "demo-laawol", dryRun: false},
  );
  assert.throws(
      () => parseArgs(["--project", "production", "--confirm", "staging"]),
      /exactly match/,
  );
});

test("claimsFromProfile ignores malformed fields instead of throwing", () => {
  assert.deepEqual(
      claimsFromProfile({
        role: "staff",
        businessId: "biz-1",
        businessPermissions: ["profile", 42, "listings"],
      }),
      {
        role: "staff",
        businessId: "biz-1",
        adminRole: null,
        businessPermissions: ["profile", "listings"],
      },
  );
  assert.deepEqual(
      claimsFromProfile({role: 7, businessPermissions: "not-a-list"}),
      {role: null, businessId: null, adminRole: null, businessPermissions: []},
  );
});

function fakeSdk({users, authUsers}) {
  const written = {};
  return {
    sdk: {
      apps: [{}],
      firestore: () => ({
        collection: (name) => {
          assert.equal(name, "users");
          return {
            get: async () => ({
              size: users.length,
              docs: users.map((user) => ({
                id: user.uid,
                data: () => user.data,
              })),
            }),
          };
        },
      }),
      auth: () => ({
        getUser: async (uid) => {
          const found = authUsers.find((user) => user.uid === uid);
          if (!found) throw new Error(`no such user: ${uid}`);
          return found;
        },
        setCustomUserClaims: async (uid, claims) => {
          written[uid] = claims;
        },
      }),
    },
    written,
  };
}

test(
    "sets claims only for users whose Firestore profile disagrees " +
    "with their token",
    async () => {
      const {sdk, written} = fakeSdk({
        users: [
          {
            uid: "already-synced",
            data: {role: "customer", businessId: null},
          },
          {
            uid: "needs-update",
            data: {role: "businessOwner", businessId: "biz-1"},
          },
        ],
        authUsers: [
          {
            uid: "already-synced",
            customClaims: {role: "customer", businessId: null},
          },
          {
            uid: "needs-update",
            customClaims: {role: "customer", businessId: null},
          },
        ],
      });

      const result = await backfillUserClaims({projectId: "demo-laawol"}, sdk);

      assert.equal(result.total, 2);
      assert.equal(result.updated, 1);
      assert.equal(result.skipped, 1);
      assert.equal(result.failed, 0);
      assert.deepEqual(written["needs-update"], {
        role: "businessOwner",
        businessId: "biz-1",
        adminRole: null,
        businessPermissions: [],
      });
      assert.equal(written["already-synced"], undefined);
    },
);

test("preserves unrelated existing custom claims (e.g. platformAdmin)",
    async () => {
      const {sdk, written} = fakeSdk({
        users: [
          {uid: "admin-1", data: {role: "admin", adminRole: "superAdmin"}},
        ],
        authUsers: [
          {
            uid: "admin-1",
            customClaims: {platformAdmin: true, role: "customer"},
          },
        ],
      });

      await backfillUserClaims({projectId: "demo-laawol"}, sdk);

      assert.deepEqual(written["admin-1"], {
        platformAdmin: true,
        role: "admin",
        businessId: null,
        adminRole: "superAdmin",
        businessPermissions: [],
      });
    });

test("dry run reports planned changes without writing claims", async () => {
  const {sdk, written} = fakeSdk({
    users: [{uid: "needs-update", data: {role: "staff", businessId: "biz-2"}}],
    authUsers: [{uid: "needs-update", customClaims: {}}],
  });

  const result = await backfillUserClaims(
      {projectId: "demo-laawol", dryRun: true},
      sdk,
  );

  assert.equal(result.updated, 1);
  assert.equal(written["needs-update"], undefined);
});

test("records a per-user failure without aborting the whole run", async () => {
  const {sdk} = fakeSdk({
    users: [
      {uid: "missing-auth-user", data: {role: "customer"}},
      {uid: "fine", data: {role: "customer"}},
    ],
    authUsers: [{uid: "fine", customClaims: {role: "staff"}}],
  });

  const result = await backfillUserClaims({projectId: "demo-laawol"}, sdk);

  assert.equal(result.total, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.updated, 1);
});

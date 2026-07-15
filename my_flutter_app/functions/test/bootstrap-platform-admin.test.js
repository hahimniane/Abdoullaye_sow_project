const assert = require("node:assert/strict");
const test = require("node:test");

const {
  bootstrapPlatformAdmin,
  parseBootstrapArgs,
} = require("../scripts/bootstrap-platform-admin");

test("bootstrap arguments require an exact project confirmation", () => {
  assert.deepEqual(
      parseBootstrapArgs([
        "--project", "demo-laawol",
        "--email", "Admin@Example.com",
        "--confirm", "demo-laawol",
      ]),
      {projectId: "demo-laawol", email: "admin@example.com"},
  );
  assert.throws(
      () => parseBootstrapArgs([
        "--project", "production",
        "--email", "admin@example.com",
        "--confirm", "staging",
      ]),
      /exactly match/,
  );
});

test(
    "bootstrap refuses unverified accounts before granting claims",
    async () => {
      let claimsWritten = false;
      const sdk = {
        apps: [{}],
        auth: () => ({
          getUserByEmail: async () => ({
            uid: "candidate",
            disabled: false,
            emailVerified: false,
          }),
          setCustomUserClaims: async () => {
            claimsWritten = true;
          },
        }),
      };

      await assert.rejects(
          bootstrapPlatformAdmin({
            projectId: "demo-laawol",
            email: "admin@example.com",
          }, sdk),
          /Verify the user's email/,
      );
      assert.equal(claimsWritten, false);
    },
);

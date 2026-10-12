"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");
const {
  CURRENT_PROJECT_CONFIG,
  NEW_PROJECT_CONFIG,
  firebaseWebApiKey,
  runtimeProjectId,
  storageBucketName,
} = require("../project_config");

describe("function project configuration", () => {
  it("keeps the current project as the registered production default", () => {
    assert.equal(CURRENT_PROJECT_CONFIG.projectId, "car-selling-flutter-app");
    assert.equal(CURRENT_PROJECT_CONFIG.projectNumber, "577373430777");
    assert.equal(NEW_PROJECT_CONFIG.projectId, "laawol-a855a");
    assert.equal(NEW_PROJECT_CONFIG.projectNumber, "127318353394");
  });

  it("reads the project from the runtime, never from a literal", () => {
    assert.equal(runtimeProjectId({GCLOUD_PROJECT: "abc-123"}), "abc-123");
    assert.equal(runtimeProjectId({GCP_PROJECT: "xyz-789"}), "xyz-789");
    assert.equal(runtimeProjectId({}), "");
  });

  it("uses the registered web API key for the project it runs in", () => {
    assert.equal(
        firebaseWebApiKey({GCLOUD_PROJECT: CURRENT_PROJECT_CONFIG.projectId}),
        CURRENT_PROJECT_CONFIG.webApiKey,
    );
    // Emulators and unset environments keep the long-standing default.
    assert.equal(firebaseWebApiKey({}), CURRENT_PROJECT_CONFIG.webApiKey);
    assert.equal(
        firebaseWebApiKey({GCLOUD_PROJECT: "demo-laawol-e2e"}),
        CURRENT_PROJECT_CONFIG.webApiKey,
    );
  });

  it("fails closed in the new project until its key is registered", () => {
    const env = {GCLOUD_PROJECT: NEW_PROJECT_CONFIG.projectId};
    if (!NEW_PROJECT_CONFIG.webApiKey) {
      assert.equal(firebaseWebApiKey(env), "");
    }
    assert.notEqual(
        firebaseWebApiKey(env),
        CURRENT_PROJECT_CONFIG.webApiKey,
        "the new project must never borrow the old project's key",
    );
  });

  it("lets FIREBASE_WEB_API_KEY override any project", () => {
    assert.equal(
        firebaseWebApiKey({
          GCLOUD_PROJECT: NEW_PROJECT_CONFIG.projectId,
          FIREBASE_WEB_API_KEY: " from-env ",
        }),
        "from-env",
    );
  });

  it("derives the default bucket from the runtime project", () => {
    assert.equal(
        storageBucketName({GCLOUD_PROJECT: "laawol-a855a"}),
        "laawol-a855a.firebasestorage.app",
    );
    assert.equal(
        storageBucketName({
          GCLOUD_PROJECT: "laawol-a855a",
          STORAGE_BUCKET: "custom-bucket",
        }),
        "custom-bucket",
    );
    assert.equal(
        storageBucketName({
          FIREBASE_STORAGE_BUCKET: "first",
          STORAGE_BUCKET: "second",
        }),
        "first",
    );
    assert.equal(storageBucketName({}), "");
  });

  it("is the only function source that names a project id", () => {
    const root = path.join(__dirname, "..");
    const offenders = fs.readdirSync(root)
        .filter((name) => name.endsWith(".js") && name !== "project_config.js")
        .filter((name) => /car-selling-flutter-app|577373430777/.test(
            fs.readFileSync(path.join(root, name), "utf8"),
        ));
    assert.deepEqual(offenders, []);
  });
});

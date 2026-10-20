import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACTIVE_FIREBASE_CONFIG,
  CURRENT_PROJECT_CONFIG,
  DEFAULT_PROJECT_TARGET,
  NEW_PROJECT_CONFIG,
  firebaseConsoleUrl,
  resolveFirebaseConfig,
} from "./project-config.ts";

test("production stays on the current project until the switch is flipped", () => {
  assert.equal(DEFAULT_PROJECT_TARGET, "current");
  assert.equal(CURRENT_PROJECT_CONFIG.projectId, "car-selling-flutter-app");
  assert.equal(CURRENT_PROJECT_CONFIG.messagingSenderId, "577373430777");
  assert.deepEqual(resolveFirebaseConfig({}), CURRENT_PROJECT_CONFIG);
  assert.equal(
    ACTIVE_FIREBASE_CONFIG.projectId,
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      CURRENT_PROJECT_CONFIG.projectId,
  );
});

test("the new project is registered with its project number", () => {
  assert.equal(NEW_PROJECT_CONFIG.projectId, "laawol-a855a");
  assert.equal(NEW_PROJECT_CONFIG.messagingSenderId, "127318353394");
  assert.equal(NEW_PROJECT_CONFIG.authDomain, "laawol-a855a.firebaseapp.com");
});

test("selecting the new target fails closed while its placeholders are empty", () => {
  const placeholders = (["apiKey", "appId"] as const).filter(
    (field) => !NEW_PROJECT_CONFIG[field],
  );
  if (placeholders.length) {
    assert.throws(
      () => resolveFirebaseConfig({ NEXT_PUBLIC_FIREBASE_PROJECT_TARGET: "new" }),
      /missing apiKey, appId/,
    );
  }
  // Never borrow the old project's key for the new target.
  assert.notEqual(NEW_PROJECT_CONFIG.apiKey, CURRENT_PROJECT_CONFIG.apiKey);
  assert.notEqual(NEW_PROJECT_CONFIG.appId, CURRENT_PROJECT_CONFIG.appId);
});

test("per-field environment variables override the selected target", () => {
  const config = resolveFirebaseConfig({
    NEXT_PUBLIC_FIREBASE_PROJECT_TARGET: "new",
    NEXT_PUBLIC_FIREBASE_API_KEY: "key-from-env",
    NEXT_PUBLIC_FIREBASE_APP_ID: "1:127318353394:web:fromenv",
  });
  assert.equal(config.projectId, "laawol-a855a");
  assert.equal(config.apiKey, "key-from-env");
  assert.equal(config.appId, "1:127318353394:web:fromenv");
  assert.equal(
    resolveFirebaseConfig({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: "other" }).projectId,
    "other",
  );
});

test("an unknown target is rejected instead of silently using production", () => {
  assert.throws(
    () => resolveFirebaseConfig({ NEXT_PUBLIC_FIREBASE_PROJECT_TARGET: "prod" }),
    /must be "current" or "new"/,
  );
});

test("console help links follow the active project", () => {
  assert.equal(
    firebaseConsoleUrl("extensions", "abc-123"),
    "https://console.firebase.google.com/project/abc-123/extensions",
  );
  assert.ok(
    firebaseConsoleUrl("extensions").includes(ACTIVE_FIREBASE_CONFIG.projectId),
  );
});

test("only project-config.ts names a project in the console source", () => {
  const firebase = readFileSync(new URL("./firebase.ts", import.meta.url), "utf8");
  assert.ok(!/car-selling-flutter-app|577373430777/.test(firebase));
  assert.ok(firebase.includes("project-config"));
});

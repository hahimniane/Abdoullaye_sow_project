const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const indexSource = fs.readFileSync(
    path.join(__dirname, "..", "index.js"),
    "utf8",
);

test("deployed callables enforce App Check", () => {
  assert.doesNotMatch(indexSource, /enforceAppCheck:\s*false/);
  assert.doesNotMatch(indexSource, /onCall\(async/);

  const callableCount = (indexSource.match(/= onCall\(/g) || []).length;
  const appCheckCount = (
    indexSource.match(/enforceAppCheck:\s*ENFORCE_APP_CHECK/g) || []
  ).length;
  assert.equal(appCheckCount, callableCount);
});

test("administrator and staff permissions fail closed", () => {
  assert.match(
      indexSource,
      /return String\(user\.adminRole \|\| ""\)\.trim\(\);/,
  );
  assert.doesNotMatch(indexSource, /role \|\| "superAdmin"/);
  assert.match(indexSource, /return permissions\.includes\(section\);/);
  assert.doesNotMatch(
      indexSource,
      /permissions\.length === 0 \|\| permissions\.includes\(section\)/,
  );
});

test("credential-bearing callable payloads are not logged", () => {
  assert.doesNotMatch(
      indexSource,
      /logger\.(?:info|warn|error)\([^;]*data:\s*request\.data/s,
  );
});

test("runtime code does not bootstrap a hard-coded administrator", () => {
  const adminConsoleSource = fs.readFileSync(
      path.join(
          __dirname,
          "..", "..", "..",
          "admin_web", "src", "components", "admin-console.tsx",
      ),
      "utf8",
  );
  assert.doesNotMatch(indexSource, /PLATFORM_ADMIN_EMAIL/);
  assert.doesNotMatch(indexSource, /ensurePlatformAdminProfile/);
  assert.doesNotMatch(indexSource, /admin@gmail\.com/i);
  assert.doesNotMatch(adminConsoleSource, /ensurePlatformAdminProfile/);
  assert.doesNotMatch(adminConsoleSource, /admin@gmail\.com/i);
});

test("sign-in resolution does not disclose phone alias emails", () => {
  const resolver = indexSource.slice(
      indexSource.indexOf("exports.resolveSignInIdentifier"),
      indexSource.indexOf("exports.createCustomerUser"),
  );
  assert.doesNotMatch(resolver, /phoneSignInAliases/);
  assert.doesNotMatch(resolver, /normalizePhoneAlias/);
});

test("Firestore sentinels use the supported modular Admin SDK export", () => {
  assert.match(
      indexSource,
      /FieldValue:\s*FirestoreFieldValue[\s\S]*firebase-admin\/firestore/,
  );
  assert.doesNotMatch(indexSource, /admin\.firestore\.FieldValue/);
});

test("the Functions emulator cannot send outbound push notifications", () => {
  const start = indexSource.indexOf(
      "async function sendPreferenceNotification",
  );
  const end = indexSource.indexOf(
      "async function notifyAdminsForPlatformEvent",
      start,
  );
  const notificationSource = indexSource.slice(start, end);
  const emulatorGuard = notificationSource.indexOf(
      "process.env.FUNCTIONS_EMULATOR === \"true\"",
  );
  const outboundSend = notificationSource.indexOf(
      "admin.messaging().sendEachForMulticast",
  );

  assert.ok(emulatorGuard >= 0, "missing Functions emulator push guard");
  assert.ok(
      emulatorGuard < outboundSend,
      "the emulator guard must run before the outbound FCM call",
  );
});

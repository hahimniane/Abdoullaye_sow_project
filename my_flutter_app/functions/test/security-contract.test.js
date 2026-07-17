const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const indexSource = fs.readFileSync(
    path.join(__dirname, "..", "index.js"),
    "utf8",
);
const storageRulesSource = fs.readFileSync(
    path.join(__dirname, "..", "storage.rules"),
    "utf8",
);

function exportedFunctionSource(name, nextName) {
  const start = indexSource.indexOf(`exports.${name} =`);
  const end = nextName ?
    indexSource.indexOf(`exports.${nextName} =`, start) :
    indexSource.length;
  assert.ok(start >= 0 && end > start, `missing function source for ${name}`);
  return indexSource.slice(start, end);
}

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

test("Firestore values use the supported modular Admin SDK export", () => {
  assert.match(
      indexSource,
      /FieldValue:\s*FirestoreFieldValue,[\s\S]*firebase-admin\/firestore/,
  );
  assert.match(indexSource, /Timestamp:\s*FirestoreTimestamp,/);
  assert.doesNotMatch(indexSource, /admin\.firestore\.FieldValue/);
  assert.doesNotMatch(indexSource, /admin\.firestore\.Timestamp/);
});

test("payment cancellation never cancels a successful or in-flight charge",
    () => {
      const cancellations = [
        ["cancelPendingParkingReservation", "createStaffUser"],
        ["cancelPendingBarrelPoolDeposit", "decideBarrelPoolJoin"],
        ["cancelPendingBarrelShipment", "completeBarrelOrderPayment"],
        ["cancelPendingBarrelOrder", "createFreightShipmentPaymentIntent"],
        ["cancelPendingFreightShipment", "confirmFreightShipmentWeight"],
        [
          "cancelPendingBarrelDestinationChange",
          "createCarDepositPaymentIntent",
        ],
        ["cancelPendingCarPurchase", "completeCarDepositReservation"],
      ];
      for (const [name, nextName] of cancellations) {
        const source = exportedFunctionSource(name, nextName);
        assert.match(source, /retrieveStripePaymentIntent/);
        assert.match(source, /intent\.status === "succeeded"/);
        assert.match(source, /intent\.status === "processing"/);
        assert.match(source, /intent\.status === "requires_capture"/);
        assert.match(source, /cancelStripePaymentIntent/);
        assert.match(source, /recoveredPayment:\s*true/);
      }
    });

test("payment completions reject simulated IDs outside simulation", () => {
  const completions = [
    ["completeParkingReservation", "cancelPendingParkingReservation"],
    ["completeBarrelPoolDepositPayment", "cancelPendingBarrelPoolDeposit"],
    ["completeBarrelPoolBalancePayment", "markBarrelPoolBalanceCollected"],
    ["completeBarrelShipmentPayment", "cancelPendingBarrelShipment"],
    ["completeBarrelOrderPayment", "cancelPendingBarrelOrder"],
    ["completeFreightShipmentPayment", "cancelPendingFreightShipment"],
    ["completeFreightSettlementPayment", "retryFreightSettlementRefunds"],
    ["completeBarrelDestinationChange", "cancelPendingBarrelDestinationChange"],
    ["completeCarPurchase", "cancelPendingCarPurchase"],
    ["completeCarDepositReservation", "markPaidHoldSold"],
    ["completePaidHoldExtensionPayment", "expirePaidCarHolds"],
  ];
  for (const [name, nextName] of completions) {
    const source = exportedFunctionSource(name, nextName);
    assert.match(source, /SIMULATE_PAYMENTS/, name);
    assert.match(source, /startsWith\("simulated_"\)/, name);
    assert.match(source, /Simulated [^"]+ payments? (?:are|is) disabled/, name);
    assert.doesNotMatch(
        source,
        /SIMULATE_PAYMENTS\s*\|\|[\s\S]{0,120}startsWith\("simulated_"\)/,
        name,
    );
  }
});

test("paid destination changes cannot redirect completed payouts", () => {
  const changeSource = exportedFunctionSource(
      "changeBarrelShipmentDestination",
      "completeBarrelDestinationChange",
  );
  assert.match(changeSource, /requireBarrelDestinationPayoutSafe/);
  assert.match(changeSource, /payoutStatus:\s*"destination_change_pending"/);
  assert.match(changeSource, /previousPayoutStatus/);
  assert.match(changeSource, /businessPayoutCents/);
  assert.match(changeSource, /platformFeeCents/);

  const completionSource = exportedFunctionSource(
      "completeBarrelDestinationChange",
      "cancelPendingBarrelDestinationChange",
  );
  assert.match(completionSource, /finalizePaidBarrelDestinationChange/);

  const cancellationSource = exportedFunctionSource(
      "cancelPendingBarrelDestinationChange",
      "createCarDepositPaymentIntent",
  );
  assert.match(cancellationSource, /finalizePaidBarrelDestinationChange/);
  assert.match(cancellationSource, /previousPayoutStatus/);
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

test("support attachment access evaluates admin permissions once", () => {
  const start = storageRulesSource.indexOf("function canAccessSupportCase");
  const end = storageRulesSource.indexOf(
      "function validSupportUpload",
      start,
  );
  const supportAccessSource = storageRulesSource.slice(start, end);

  assert.ok(start >= 0 && end > start, "missing support access rules");
  assert.match(supportAccessSource, /hasAdminCapability\('support'\)/);
  assert.match(
      supportAccessSource,
      /canManageBusinessSupportAsMember\(firestore\.get/,
  );
  assert.doesNotMatch(
      supportAccessSource,
      /canManageBusinessSupport\(firestore\.get/,
  );
});

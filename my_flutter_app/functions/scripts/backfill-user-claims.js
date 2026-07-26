#!/usr/bin/env node

// One-off backfill for the role/businessId/adminRole/businessPermissions
// custom claims that functions/index.js's syncUserCustomClaims trigger now
// keeps up to date going forward. Existing users only pick up that trigger
// on their NEXT users/{uid} write, so this script sets claims for everyone
// once so Storage rules (which can't read Firestore in this project - see
// storage-rules-cross-service-broken memory) work immediately for accounts
// created before this fix shipped.

const admin = require("firebase-admin");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    values[key] = value.trim();
    index += 1;
  }
  const projectId = values.project || "";
  const confirmation = values.confirm || "";
  if (!projectId) {
    throw new Error("--project is required");
  }
  if (confirmation !== projectId) {
    throw new Error("--confirm must exactly match --project");
  }
  return {projectId, dryRun: values["dry-run"] === "true"};
}

function claimsFromProfile(data) {
  return {
    role: typeof data.role === "string" ? data.role : null,
    businessId: typeof data.businessId === "string" ? data.businessId : null,
    adminRole: typeof data.adminRole === "string" ? data.adminRole : null,
    businessPermissions: Array.isArray(data.businessPermissions) ?
      data.businessPermissions.filter((item) => typeof item === "string") :
      [],
  };
}

function claimsAreEqual(a, b) {
  return (
    a.role === b.role &&
    a.businessId === b.businessId &&
    a.adminRole === b.adminRole &&
    JSON.stringify(a.businessPermissions) ===
      JSON.stringify(b.businessPermissions)
  );
}

async function backfillUserClaims({projectId, dryRun = false}, sdk = admin) {
  if (sdk.apps.length === 0) {
    sdk.initializeApp({
      credential: sdk.credential.applicationDefault(),
      projectId,
    });
  }
  const auth = sdk.auth();
  const db = sdk.firestore();
  const snapshot = await db.collection("users").get();

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const doc of snapshot.docs) {
    const uid = doc.id;
    const nextClaims = claimsFromProfile(doc.data() || {});
    try {
      const user = await auth.getUser(uid);
      const existingClaims = claimsFromProfile(user.customClaims || {});
      if (claimsAreEqual(existingClaims, nextClaims)) {
        skipped += 1;
        continue;
      }
      if (!dryRun) {
        await auth.setCustomUserClaims(uid, {
          ...(user.customClaims || {}),
          ...nextClaims,
        });
      }
      updated += 1;
      process.stdout.write(
          `${dryRun ? "[dry-run] would update" : "updated"} ${uid} -> ` +
          `${JSON.stringify(nextClaims)}\n`,
      );
    } catch (error) {
      failed += 1;
      process.stderr.write(
          `failed for ${uid}: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
      );
    }
  }
  return {total: snapshot.size, updated, skipped, failed};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await backfillUserClaims(args);
  process.stdout.write(
      `Done. ${result.updated} updated, ${result.skipped} already correct, ` +
      `${result.failed} failed, out of ${result.total} users.\n`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {backfillUserClaims, parseArgs, claimsFromProfile};

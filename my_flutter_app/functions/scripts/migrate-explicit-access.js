#!/usr/bin/env node

const admin = require("firebase-admin");

function explicitAccessUpdate(profile) {
  if (profile.role === "admin" &&
      !String(profile.adminRole || "").trim()) {
    return {
      adminRole: "supportAdmin",
      accessMigrationNote: "Legacy admin defaulted to least privilege",
    };
  }
  if (profile.role === "staff" &&
      (!Array.isArray(profile.businessPermissions) ||
       profile.businessPermissions.length === 0)) {
    return {
      businessPermissions: ["profile"],
      accessMigrationNote: "Legacy staff defaulted to profile-only access",
    };
  }
  return null;
}

function parseArgs(argv) {
  const values = {apply: false};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      values.apply = true;
      continue;
    }
    if (!argument.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values[argument.slice(2)] = value.trim();
    index += 1;
  }
  if (!values.project) throw new Error("--project is required");
  if (values.apply && values.confirm !== values.project) {
    throw new Error("--confirm must exactly match --project when applying");
  }
  return values;
}

async function migrateExplicitAccess(options, sdk = admin) {
  if (sdk.apps.length === 0) {
    sdk.initializeApp({
      credential: sdk.credential.applicationDefault(),
      projectId: options.project,
    });
  }
  const db = sdk.firestore();
  const users = await db.collection("users").get();
  const changes = users.docs.map((snapshot) => ({
    snapshot,
    update: explicitAccessUpdate(snapshot.data() || {}),
  })).filter((item) => item.update);
  if (!options.apply) {
    return {applied: false, changes: changes.map((item) => item.snapshot.id)};
  }

  for (let offset = 0; offset < changes.length; offset += 400) {
    const batch = db.batch();
    for (const item of changes.slice(offset, offset + 400)) {
      batch.set(item.snapshot.ref, {
        ...item.update,
        accessMigratedAt: sdk.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    await batch.commit();
  }
  return {applied: true, changes: changes.map((item) => item.snapshot.id)};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await migrateExplicitAccess(options);
  const action = result.applied ? "Updated" : "Would update";
  process.stdout.write(`${action} ${result.changes.length} user profiles.\n`);
  for (const uid of result.changes) process.stdout.write(`- ${uid}\n`);
  if (!result.applied) {
    process.stdout.write(
        "Dry run only. Re-run with --apply --confirm PROJECT_ID.\n",
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {explicitAccessUpdate, migrateExplicitAccess, parseArgs};

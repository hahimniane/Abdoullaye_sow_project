#!/usr/bin/env node

const admin = require("firebase-admin");

function parseBootstrapArgs(argv) {
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
  const email = String(values.email || "").toLowerCase();
  const confirmation = values.confirm || "";
  if (!projectId || !email) {
    throw new Error("--project and --email are required");
  }
  if (confirmation !== projectId) {
    throw new Error("--confirm must exactly match --project");
  }
  return {projectId, email};
}

async function bootstrapPlatformAdmin({projectId, email}, sdk = admin) {
  if (sdk.apps.length === 0) {
    sdk.initializeApp({
      credential: sdk.credential.applicationDefault(),
      projectId,
    });
  }

  const auth = sdk.auth();
  const user = await auth.getUserByEmail(email);
  if (user.disabled) {
    throw new Error("The selected Firebase Auth user is disabled");
  }
  if (!user.emailVerified) {
    throw new Error("Verify the user's email before granting platform access");
  }

  const claims = {
    ...(user.customClaims || {}),
    platformAdmin: true,
    adminRole: "superAdmin",
  };
  await auth.setCustomUserClaims(user.uid, claims);

  const db = sdk.firestore();
  const batch = db.batch();
  const timestamp = sdk.firestore.FieldValue.serverTimestamp();
  batch.set(db.collection("users").doc(user.uid), {
    email,
    role: "admin",
    platformAdmin: true,
    adminRole: "superAdmin",
    updatedAt: timestamp,
    bootstrapSource: "secure_cli",
  }, {merge: true});
  batch.set(db.collection("adminAuditLogs").doc(), {
    action: "platform_admin_bootstrapped",
    actorUid: user.uid,
    targetCollection: "users",
    targetId: user.uid,
    targetLabel: email,
    nextValue: "superAdmin",
    source: "secure_cli",
    createdAt: timestamp,
    expiresAt: sdk.firestore.Timestamp.fromMillis(
        Date.now() + 400 * 24 * 60 * 60 * 1000,
    ),
  });
  await batch.commit();
  return {uid: user.uid, email, projectId};
}

async function main() {
  const args = parseBootstrapArgs(process.argv.slice(2));
  const result = await bootstrapPlatformAdmin(args);
  process.stdout.write(
      `Bootstrapped ${result.email} in ${result.projectId} (${result.uid})\n`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {bootstrapPlatformAdmin, parseBootstrapArgs};

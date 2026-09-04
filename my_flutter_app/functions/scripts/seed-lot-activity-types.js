"use strict";

/**
 * Seed a lot business with the four default activity types (the Keren
 * workbook). Idempotent: skips a label the business already has, so a re-run
 * never duplicates. Run after deploy, once the lotActivityTypes collection is
 * live.
 *
 *   node scripts/seed-lot-activity-types.js \
 *     --project car-selling-flutter-app --business keren_auto_sales_llc
 *
 * Add --dry-run to print what it would write without writing.
 */

const admin = require("firebase-admin");
const {LOT_ACTIVITY_SEED_TYPES} = require("../lot_ledger");

function readArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [rawKey, inline] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
    if (inline != null) {
      args[key] = inline;
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const businessId = String(args.business || "").trim();
  if (!businessId) {
    throw new Error("Pass --business <businessId>");
  }
  const projectId = String(args.project || process.env.GCLOUD_PROJECT || "")
      .trim();
  admin.initializeApp(projectId ? {projectId} : undefined);
  const db = admin.firestore();

  const existing = await db.collection("lotActivityTypes")
      .where("businessId", "==", businessId)
      .get();
  const haveLabels = new Set(
      existing.docs.map((d) => String(d.data().label || "").toLowerCase()),
  );

  let written = 0;
  for (const seed of LOT_ACTIVITY_SEED_TYPES) {
    if (haveLabels.has(seed.label.toLowerCase())) {
      console.log(`skip (exists): ${seed.label}`);
      continue;
    }
    if (args.dryRun) {
      console.log(`would seed: ${seed.label}`);
      continue;
    }
    await db.collection("lotActivityTypes").add({
      ...seed,
      businessId,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    written += 1;
    console.log(`seeded: ${seed.label}`);
  }
  console.log(`Done. ${written} seeded, ${haveLabels.size} already present.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

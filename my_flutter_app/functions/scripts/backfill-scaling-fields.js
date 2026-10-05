#!/usr/bin/env node

// Up-front backfill for the fields the scaling fixes query on (scaling audit,
// 2026-10). Every one of these also backfills itself lazily from the deployed
// functions, so running this is optional - it just moves the one-time cost
// out of the first customer search / scheduled run after the deploy.
//
//   parking   parkedCars.occupancyEndMs, per lot, + the lot's marker
//             (availability and month-end read by it)
//   carrier   barrel/freight/transport carrierTrackingDone + marker
//             (pollContainerTracking queries carrierTrackingDone == false)
//   viewings  carPurchases.respondByAt for pending proposals that predate it
//             (expireStaleCarViewings queries by respondByAt)
//
// Dry-run unless --commit is passed. Idempotent: a second run updates
// nothing. Writes are guarded by each document's updateTime, so it is safe to
// run while the app is live.
//
//   node scripts/backfill-scaling-fields.js --project <id> --confirm <id>
//   node scripts/backfill-scaling-fields.js --project <id> --confirm <id> \
//     --only parking --commit
//
// Order on deploy: deploy firestore indexes first (wait for them to finish
// building), then functions, then (optionally) this script.

const admin = require("firebase-admin");
const {
  backfillCarrierTrackingDone,
  backfillParkingOccupancy,
  backfillViewingRespondBy,
} = require("../scaling_backfills");
const {TRACKING_SECTION_BY_COLLECTION} = require("../shipment_tracking");

const PARTS = ["parking", "carrier", "viewings"];
const RUN_FOR_MS = 60 * 60 * 1000;

function parseArgs(argv) {
  const values = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      flags.add(key);
      continue;
    }
    values[key] = value.trim();
    index += 1;
  }
  const projectId = values.project || "";
  if (!projectId) throw new Error("--project is required");
  if ((values.confirm || "") !== projectId) {
    throw new Error("--confirm must exactly match --project");
  }
  const only = values.only ? values.only.split(",").map((s) => s.trim()) :
    PARTS;
  const unknown = only.filter((part) => !PARTS.includes(part));
  if (unknown.length > 0) {
    throw new Error(`--only takes ${PARTS.join(", ")}; got ${unknown}`);
  }
  return {projectId, commit: flags.has("commit"), only};
}

async function run({projectId, commit, only}, sdk = admin) {
  if (sdk.apps.length === 0) {
    sdk.initializeApp({
      credential: sdk.credential.applicationDefault(),
      projectId,
    });
  }
  const db = sdk.firestore();
  const deadlineMs = Date.now() + RUN_FOR_MS;
  const report = {};
  if (only.includes("parking")) {
    const lots = await db.collection("businesses").get();
    report.parking = {lots: 0, scanned: 0, updated: 0, raced: 0,
      failed: 0, incomplete: []};
    for (const lot of lots.docs) {
      const stats = await backfillParkingOccupancy(db, lot.id,
          {commit, deadlineMs});
      report.parking.lots += 1;
      for (const key of ["scanned", "updated", "raced", "failed"]) {
        report.parking[key] += stats[key];
      }
      if (!stats.complete) report.parking.incomplete.push(lot.id);
    }
  }
  if (only.includes("carrier")) {
    report.carrier = await backfillCarrierTrackingDone(
        db, Object.keys(TRACKING_SECTION_BY_COLLECTION),
        {commit, deadlineMs, force: true});
  }
  if (only.includes("viewings")) {
    report.viewings = await backfillViewingRespondBy(db,
        {commit, deadlineMs, force: true});
  }
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await run(args);
  process.stdout.write(`${args.commit ? "COMMITTED" : "[dry-run]"} ` +
    `${JSON.stringify(report, null, 2)}\n`);
  const incomplete = (report.parking?.incomplete || []).length > 0 ||
    report.carrier?.complete === false || report.viewings?.complete === false;
  if (incomplete) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {parseArgs, run};

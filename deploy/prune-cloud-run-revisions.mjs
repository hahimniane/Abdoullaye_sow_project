// Delete Cloud Run revisions that serve no traffic.
//
// Cloud Run never garbage-collects revisions, and a Ready revision keeps
// holding its cpu x maxInstances against the region's "Total allowable CPU"
// quota at zero traffic, forever. Every deploy leaves one more behind on every
// function, so the reservation grows monotonically until a deploy cannot fit.
//
// This project reached 4,605 revisions across ~178 functions before the
// ceiling was hit on 2026-08-07. The failure mode is nasty: functions are left
// on a revision that cannot serve, so live traffic gets 429s and 503s, and the
// deploy that caused it reports quota errors rather than anything resembling
// "your site is down".
//
// Only the serving revision of each service is kept. Cloud Run refuses to
// delete the newest revision even when it is a failed one, so those are
// skipped and reported rather than retried.
//
// Usage: node prune-cloud-run-revisions.mjs [--dry-run]

import { spawnSync } from "node:child_process";

const PROJECT = process.env.FIREBASE_PROJECT || "car-selling-flutter-app";
const REGION = process.env.CLOUD_RUN_REGION || "us-central1";
const DRY_RUN = process.argv.includes("--dry-run");
const CONCURRENCY = Number(process.env.PRUNE_CONCURRENCY || 6);

function gcloud(args) {
  const result = spawnSync("gcloud", args, {encoding: "utf8"});
  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function listServices() {
  const result = gcloud([
    "run", "services", "list",
    "--project", PROJECT, "--region", REGION,
    "--format", "value(metadata.name)",
  ]);
  if (!result.ok) return [];
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function pruneService(service) {
  const serving = gcloud([
    "run", "services", "describe", service,
    "--project", PROJECT, "--region", REGION,
    "--format", "value(status.latestReadyRevisionName)",
  ]).stdout.trim();

  // Without a known serving revision this cannot tell a live revision from a
  // dead one, and guessing would take the site down. Skip loudly instead.
  if (!serving) return {service, skipped: true, deleted: 0, kept: ""};

  const revisions = gcloud([
    "run", "revisions", "list",
    "--service", service,
    "--project", PROJECT, "--region", REGION,
    "--format", "value(metadata.name)",
  ]).stdout.split("\n").map((line) => line.trim()).filter(Boolean);

  let deleted = 0;
  for (const revision of revisions) {
    if (revision === serving) continue;
    if (DRY_RUN) {
      deleted += 1;
      continue;
    }
    const result = gcloud([
      "run", "revisions", "delete", revision,
      "--project", PROJECT, "--region", REGION, "--quiet",
    ]);
    if (result.ok) deleted += 1;
  }
  return {service, skipped: false, deleted, kept: serving};
}

async function main() {
  const services = listServices();
  if (services.length === 0) {
    console.log("No Cloud Run services found; nothing to prune.");
    return;
  }
  console.log(
      `${DRY_RUN ? "Would prune" : "Pruning"} idle revisions across ` +
      `${services.length} services in ${REGION}...`,
  );

  const queue = [...services];
  let deleted = 0;
  let skipped = 0;
  const workers = Array.from(
      {length: Math.max(1, Math.min(CONCURRENCY, queue.length))},
      async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const result = pruneService(next);
          if (result.skipped) {
            skipped += 1;
            console.log(`SKIP ${result.service} (no serving revision)`);
          } else {
            deleted += result.deleted;
          }
        }
      },
  );
  await Promise.all(workers);

  console.log(
      `${DRY_RUN ? "Would delete" : "Deleted"} ${deleted} idle revisions` +
      (skipped ? `; skipped ${skipped} services` : ""),
  );
}

await main();

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

import { spawn, spawnSync } from "node:child_process";
import { resolveProjectId, resolveRegion } from "./project-config.mjs";
import { revisionsToPrune } from "./prune-plan.mjs";

const PROJECT = resolveProjectId();
const REGION = resolveRegion({projectId: PROJECT, envName: "CLOUD_RUN_REGION"});
const DRY_RUN = process.argv.includes("--dry-run");
const CONCURRENCY = Number(process.env.PRUNE_CONCURRENCY || 8);

// Two bulk reads (every service, every revision in the region) instead of two
// gcloud calls per service: the old per-service loop used spawnSync inside
// "parallel" workers, which blocked the event loop, so it really ran one
// service at a time - about 20 minutes for 318 services (2026-10-21).
function gcloudJson(args) {
  const result = spawnSync("gcloud", [...args, "--format", "json"], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`gcloud ${args.slice(0, 3).join(" ")} failed: ` +
      String(result.stderr || "").slice(0, 300));
  }
  return JSON.parse(result.stdout || "[]");
}

// Deletes run truly in parallel: async child processes, not spawnSync.
function gcloudAsync(args) {
  return new Promise((resolve) => {
    const child = spawn("gcloud", args, {stdio: ["ignore", "ignore", "pipe"]});
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ok: code === 0, stderr}));
    child.on("error", (error) => resolve({ok: false, stderr: String(error)}));
  });
}

async function main() {
  const where = ["--project", PROJECT, "--region", REGION];
  const services = gcloudJson(["run", "services", "list", ...where]);
  if (services.length === 0) {
    console.log("No Cloud Run services found; nothing to prune.");
    return;
  }
  const revisions = gcloudJson(["run", "revisions", "list", ...where]);
  const plan = revisionsToPrune(services, revisions);
  console.log(
      `${DRY_RUN ? "Would prune" : "Pruning"} ${plan.delete.length} idle ` +
      `revisions across ${services.length} services in ${REGION}` +
      (plan.skippedServices.length ?
        ` (skipped ${plan.skippedServices.length}: no serving revision)` : "") +
      "...",
  );
  for (const service of plan.skippedServices) {
    console.log(`SKIP ${service} (no serving revision)`);
  }
  if (DRY_RUN || plan.delete.length === 0) {
    console.log(`${DRY_RUN ? "Would delete" : "Deleted"} ` +
      `${DRY_RUN ? plan.delete.length : 0} idle revisions`);
    return;
  }
  const queue = [...plan.delete];
  let deleted = 0;
  let failed = 0;
  const workers = Array.from(
      {length: Math.max(1, Math.min(CONCURRENCY, queue.length))},
      async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const result = await gcloudAsync(["run", "revisions", "delete",
            next, ...where, "--quiet"]);
          if (result.ok) deleted += 1;
          else failed += 1;
        }
      },
  );
  await Promise.all(workers);
  console.log(`Deleted ${deleted} idle revisions` +
    (failed ? `; ${failed} could not be deleted (usually the newest of a ` +
      "service, which Cloud Run protects)" : ""));
}

await main();

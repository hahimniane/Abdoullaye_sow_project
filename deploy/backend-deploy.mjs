// Guarded Firebase backend deploy for Laawol.
//
// Runs backend preflight first, then deploys the compatible backend set through
// one Firebase CLI invocation. Functions are listed first so a callable update
// is available before rules that may depend on it.
// This script is intentionally separate from Hostinger FTP static upload.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  batchFunctionNames,
  safeDeployBatchSize,
} from "./cloud-run-capacity-lib.mjs";
import {
  deploymentChildEnvironment,
  deploymentJavaEnvironment,
  firebaseDryRunConfig,
} from "./preflight-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT_ID = process.env.FIREBASE_PROJECT || "car-selling-flutter-app";
const APP_DIR = path.join(ROOT, "my_flutter_app");
const BATCH_ATTEMPTS = Number(process.env.DEPLOY_BATCH_ATTEMPTS || 4);
const BATCH_RETRY_SECONDS = Number(process.env.DEPLOY_BATCH_RETRY_SECONDS || 45);
const BATCH_GAP_SECONDS = Number(process.env.DEPLOY_BATCH_GAP_SECONDS || 45);
const commandEnvironment = deploymentChildEnvironment(
    deploymentJavaEnvironment({
      environment: process.env,
      candidateHomes: [
        "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
        "/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
      ],
    }),
);

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || commandEnvironment,
    stdio: "inherit",
  });
}

// The prune is not skippable. It was once, and the skip caused an outage:
// a run started with 150 failed revisions left over from earlier attempts,
// and Cloud Run kept trying to start them - each attempt drawing boosted
// startup CPU against the same 20 vCPU the rollout and live traffic needed.
// Batches that fit on paper failed against pressure the arithmetic could not
// see. On a clean project the prune finds nothing and costs a few minutes;
// on a dirty one it is the difference between a deploy and an outage.
console.log("Pruning idle Cloud Run revisions to reclaim headroom...");
try {
  run("node", [path.join(__dirname, "prune-cloud-run-revisions.mjs")]);
} catch {
  // A failed prune is not a failed deploy: the preflight headroom check is
  // the gate, and it will refuse the deploy if this left too little room.
  console.warn("Revision prune did not complete; continuing to preflight.");
}

console.log("\nRunning backend deploy preflight...");
try {
  run("node", [path.join(__dirname, "preflight.mjs")], {
    env: {
      ...commandEnvironment,
      PREFLIGHT_SCOPE: "backend",
    },
  });
} catch {
  console.error("\nBackend deploy preflight failed. Fix the checks above and retry.");
  process.exit(1);
}

// Rules, indexes and Storage first: they are one small write each and carry no
// Cloud Run cost, so getting them out of the way keeps the batching below
// purely about functions.
console.log("\nDeploying rules, indexes, and Storage...");
run("firebase", [
  "deploy",
  "--only",
  "firestore:rules,firestore:indexes,storage",
  "--project",
  PROJECT_ID,
], {cwd: APP_DIR, env: commandEnvironment});

// Functions go out in batches, because the region allows 20 vCPU of
// concurrently allocated CPU and every function being rolled out starts a
// container to pass its health check. Asking for ~175 at once asks for ~175
// vCPU against that ceiling: on 2026-08-07 that stranded 30 and then 157
// functions on revisions that could not serve, and took parking receipts and
// payment links down with them. Deploying two at a time had worked fine the
// same afternoon - the count was always the variable, not the code.
const functionNames = Array.from(new Set(
    (fs.readFileSync(
        path.join(APP_DIR, "functions", "index.js"),
        "utf8",
    ).match(/^exports\.[A-Za-z0-9_]+/gm) || [])
        .map((line) => line.slice("exports.".length)),
));
const batches = batchFunctionNames(functionNames, safeDeployBatchSize());
console.log(
    `\nDeploying ${functionNames.length} functions in ${batches.length} ` +
    `batches of up to ${safeDeployBatchSize()}...`,
);

// The predeploy hook runs lint and the whole test suite. That is exactly right
// once, and preflight has already done it for this commit; running it again per
// batch would add ten minutes to each of fifteen batches and prove nothing new
// about code that has not changed between them. So the batches deploy through a
// config with the hook stripped - the same mechanism preflight uses for its dry
// run - and the temp file is always removed.
const batchConfigPath = path.join(
    APP_DIR,
    `.firebase-batch-${process.pid}.json`,
);
try {
  fs.writeFileSync(
      batchConfigPath,
      JSON.stringify(
          firebaseDryRunConfig(
              JSON.parse(fs.readFileSync(path.join(APP_DIR, "firebase.json"), "utf8")),
          ),
          null,
          2,
      ),
  );
  for (const [index, batch] of batches.entries()) {
    console.log(`\n  Batch ${index + 1}/${batches.length} (${batch.length})`);
    // Every `firebase deploy` asks the Cloud Billing API whether the project
    // is on a paid plan, and that API's "all requests per minute" quota is
    // billed to a shared consumer - other people's traffic counts against it
    // too. Fifteen invocations in a row tripped it on the first attempt, which
    // killed the run before a single function had been touched. So a batch
    // that fails is retried rather than being taken as a verdict, and batches
    // are spaced out to stop the run causing the problem in the first place.
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        run("firebase", [
          "deploy",
          "--only",
          batch.map((name) => `functions:${name}`).join(","),
          "--project",
          PROJECT_ID,
          "--config",
          batchConfigPath,
          // Functions removed from source are deleted without prompting.
          // Preflight has already listed what this commit exports.
          "--force",
        ], {cwd: APP_DIR, env: commandEnvironment});
        break;
      } catch (error) {
        if (attempt >= BATCH_ATTEMPTS) {
          console.error(
              `\n  Batch ${index + 1} failed ${attempt} times. Stopping so the ` +
              "rest of the rollout does not pile onto whatever is wrong.",
          );
          throw error;
        }
        const backoffSeconds = BATCH_RETRY_SECONDS * attempt;
        console.warn(
            `\n  Batch ${index + 1} failed (attempt ${attempt}). Retrying in ` +
            `${backoffSeconds}s...`,
        );
        execFileSync("sleep", [String(backoffSeconds)], {stdio: "ignore"});
      }
    }
    if (index < batches.length - 1) {
      execFileSync("sleep", [String(BATCH_GAP_SECONDS)], {stdio: "ignore"});
    }
  }
} finally {
  fs.rmSync(batchConfigPath, {force: true});
}

console.log("\nRunning read-only backend smoke checks...");
run("node", [path.join(__dirname, "post-deploy-smoke.mjs")], {
  env: {...commandEnvironment, SMOKE_SCOPE: "backend"},
});

console.log("\nBackend deploy complete.");

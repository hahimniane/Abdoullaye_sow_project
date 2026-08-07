// Guarded Firebase backend deploy for Laawol.
//
// Runs backend preflight first, then deploys the compatible backend set through
// one Firebase CLI invocation. Functions are listed first so a callable update
// is available before rules that may depend on it.
// This script is intentionally separate from Hostinger FTP static upload.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deploymentChildEnvironment,
  deploymentJavaEnvironment,
} from "./preflight-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT_ID = process.env.FIREBASE_PROJECT || "car-selling-flutter-app";
const APP_DIR = path.join(ROOT, "my_flutter_app");
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

// Before the preflight measures headroom, reclaim what is free to reclaim.
// Cloud Run keeps every revision forever and each one holds its reservation at
// zero traffic, so without this the ceiling creeps up with every deploy until
// one cannot fit - and the deploy that finds the ceiling leaves functions
// stranded on revisions that cannot serve. Skippable for a fast redeploy when
// the headroom is known to be there.
if (process.env.SKIP_REVISION_PRUNE === "true") {
  console.log("Skipping Cloud Run revision prune (SKIP_REVISION_PRUNE=true).");
} else {
  console.log("Pruning idle Cloud Run revisions to reclaim CPU quota...");
  try {
    run("node", [path.join(__dirname, "prune-cloud-run-revisions.mjs")]);
  } catch {
    // A failed prune is not a failed deploy: the headroom check below is the
    // gate, and it will refuse the deploy if this left too little room.
    console.warn("Revision prune did not complete; continuing to preflight.");
  }
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

console.log("\nDeploying Functions, rules, indexes, and Storage as one release...");
run("firebase", [
  "deploy",
  "--only",
  "functions,firestore:rules,firestore:indexes,storage",
  "--project",
  PROJECT_ID,
], {cwd: APP_DIR, env: commandEnvironment});

console.log("\nRunning read-only backend smoke checks...");
run("node", [path.join(__dirname, "post-deploy-smoke.mjs")], {
  env: {...commandEnvironment, SMOKE_SCOPE: "backend"},
});

console.log("\nBackend deploy complete.");

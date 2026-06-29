// Guarded Firebase backend deploy for Laawol.
//
// Runs backend preflight first, then deploys rules/indexes/storage/functions.
// This script is intentionally separate from Hostinger FTP static upload.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT_ID = process.env.FIREBASE_PROJECT || "car-selling-flutter-app";
const APP_DIR = path.join(ROOT, "my_flutter_app");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    stdio: "inherit",
  });
}

console.log("Running backend deploy preflight...");
try {
  run("node", [path.join(__dirname, "preflight.mjs")], {
    env: {
      ...process.env,
      PREFLIGHT_SCOPE: "backend",
    },
  });
} catch {
  console.error("\nBackend deploy preflight failed. Fix the checks above and retry.");
  process.exit(1);
}

console.log("\nDeploying Firestore rules/indexes and Storage rules...");
run("firebase", [
  "deploy",
  "--only",
  "firestore:rules,firestore:indexes,storage",
  "--project",
  PROJECT_ID,
], {cwd: APP_DIR});

console.log("\nDeploying Cloud Functions...");
run("firebase", [
  "deploy",
  "--only",
  "functions",
  "--project",
  PROJECT_ID,
], {cwd: APP_DIR});

console.log("\nBackend deploy complete.");

// Non-destructive production readiness checks for Laawol deploys.
// This script prints only secret shape/availability, never secret values.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT_ID = process.env.FIREBASE_PROJECT || "car-selling-flutter-app";
const SCOPE = process.env.PREFLIGHT_SCOPE || "full";
const VALID_SCOPES = new Set(["backend", "full", "static"]);
const STATIC_TRANSPORT = process.env.STATIC_TRANSPORT || "ftp";

if (!VALID_SCOPES.has(SCOPE)) {
  console.error("PREFLIGHT_SCOPE must be 'static', 'backend', or 'full'.");
  process.exit(1);
}

const checks = [];
const checksStatic = SCOPE === "static" || SCOPE === "full";
const checksBackend = SCOPE === "backend" || SCOPE === "full";

function addCheck(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  const icon = ok ? "OK" : "FAIL";
  console.log(`${icon} ${name}${detail ? ` - ${detail}` : ""}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    env: process.env,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
  };
}

function runInherit(command, args, options = {}) {
  try {
    execFileSync(command, args, {
      cwd: options.cwd || ROOT,
      env: process.env,
      stdio: "inherit",
    });
    return true;
  } catch {
    return false;
  }
}

function parseJsonFromOutput(output) {
  const indexesStart = output.lastIndexOf("{\n  \"indexes\"");
  const start = indexesStart >= 0 ? indexesStart : output.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(output.slice(start));
  } catch {
    return null;
  }
}

console.log(
    `Production preflight (${SCOPE}) for Firebase project: ${PROJECT_ID}\n`,
);

// Gate every deploy on a committed working tree. What we ship must be in
// version control so it is reviewable and revertable. Untracked files do not
// block (new docs, local notes); modified/staged tracked files do. Emergency
// override: ALLOW_DIRTY_DEPLOY=1.
{
  const dirty = run("git", ["status", "--porcelain", "--untracked-files=no"]);
  const isClean = dirty.ok && dirty.stdout.trim() === "";
  const overridden = process.env.ALLOW_DIRTY_DEPLOY === "1";
  addCheck(
      "Clean git tree (deploy only committed code)",
      isClean || overridden,
      isClean ?
        "working tree matches HEAD" :
        overridden ?
          "OVERRIDDEN via ALLOW_DIRTY_DEPLOY=1 — uncommitted changes will ship" :
          "commit or stash your changes, or set ALLOW_DIRTY_DEPLOY=1 to override",
  );
}

if (checksStatic) {
  if (STATIC_TRANSPORT === "ssh") {
    addCheck(
        "Static transport",
        true,
        "using SSH/rsync; FTP credentials are not required",
    );
  } else {
    addCheck(
        "FTP credentials present",
        Boolean(process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASS),
        process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASS ?
          "FTP_HOST/FTP_USER/FTP_PASS are set" :
          "set FTP_HOST, FTP_USER, and FTP_PASS before static deploy",
    );
  }

  const publicVerifierOk = runInherit("node", [
    path.join(ROOT, "public_site", "verify-cms.mjs"),
  ]);
  addCheck("Public CMS/privacy verifier", publicVerifierOk);

  const adminDir = path.join(ROOT, "admin_web");

  // Run the admin/business console unit tests before shipping. These lock in
  // regression guards (e.g. the translation engine must converge and stay
  // within its time budget) that static typechecking cannot catch.
  const adminTestsOk = runInherit("npm", ["--prefix", adminDir, "test"]);
  addCheck("Admin/business unit tests", adminTestsOk);

  // Build from source so the deployed bundle always matches the committed
  // source — never a stale or hand-edited admin_web/out. `next build` also runs
  // the TypeScript compiler, so a type error fails the deploy here.
  const adminBuildOk = adminTestsOk &&
    runInherit("npm", ["--prefix", adminDir, "run", "build"]);
  addCheck("Admin/business build from source", adminBuildOk);

  const adminOut = path.join(adminDir, "out", "index.html");
  addCheck(
      "Admin/business static build output",
      fs.existsSync(adminOut),
      fs.existsSync(adminOut) ? "admin_web/out/index.html present" :
        "build did not produce admin_web/out/index.html",
  );
}

if (checksBackend) {
  const firebaseLogin = run("firebase", ["login:list"]);
  addCheck(
      "Firebase CLI authenticated",
      firebaseLogin.ok && /Logged in as /.test(firebaseLogin.stdout),
      (firebaseLogin.stdout.match(/Logged in as .+/)?.[0] || "").trim(),
  );

  const projects = run("firebase", ["projects:list", "--json"]);
  const projectData = parseJsonFromOutput(projects.stdout);
  const projectVisible = Boolean(
      projectData?.result?.some((project) => project.projectId === PROJECT_ID),
  );
  addCheck(
      "Firebase project visible",
      projects.ok && projectVisible,
      projectVisible ? PROJECT_ID : "project not found in firebase projects:list",
  );

  const stripeSecret = run("firebase", [
    "functions:secrets:access",
    "STRIPE_SECRET_KEY",
    "--project",
    PROJECT_ID,
  ]);
  const secretPayload = stripeSecret.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) || "";
  const stripeKeyShapeOk = /^sk_(test|live)_/.test(secretPayload);
  addCheck(
      "Stripe secret shape",
      stripeSecret.ok && stripeKeyShapeOk,
      stripeSecret.ok ?
        (stripeKeyShapeOk ? "STRIPE_SECRET_KEY looks like a Stripe secret key" :
          "STRIPE_SECRET_KEY does not start with sk_test_ or sk_live_") :
        "STRIPE_SECRET_KEY could not be accessed",
  );

  const indexes = run("firebase", [
    "firestore:indexes",
    "--project",
    PROJECT_ID,
  ]);
  const indexData = parseJsonFromOutput(indexes.stdout);
  const collectionGroups = new Set(
      (indexData?.indexes || []).map((index) => index.collectionGroup),
  );
  addCheck(
      "Shared-barrel Firestore indexes present",
      indexes.ok &&
        collectionGroups.has("openBarrels") &&
        collectionGroups.has("barrelPools"),
      indexes.ok ?
        `found: ${["openBarrels", "barrelPools"].filter((name) =>
          collectionGroups.has(name),
        ).join(", ") || "none"}` :
        "could not list Firestore indexes",
  );

  if (process.env.SKIP_FUNCTIONS_DRY_RUN === "true") {
    addCheck(
        "Functions deploy dry-run",
        true,
        "skipped because SKIP_FUNCTIONS_DRY_RUN=true",
    );
  } else {
    const functionsDryRun = run("firebase", [
      "deploy",
      "--only",
      "functions",
      "--project",
      PROJECT_ID,
      "--dry-run",
    ], {
      cwd: path.join(ROOT, "my_flutter_app"),
    });
    const functionsOutput = `${functionsDryRun.stdout}\n${functionsDryRun.stderr}`;
    const computeApiDisabled =
      /Compute Engine API has not been used|compute\.googleapis\.com/.test(
          functionsOutput,
      );
    addCheck(
        "Functions deploy dry-run",
        functionsDryRun.ok && !computeApiDisabled,
        computeApiDisabled ?
          "Compute Engine API is disabled or inaccessible for Cloud Functions" :
          functionsDryRun.ok ? "dry run completed" : "dry run failed",
    );
  }
}

const summary = checks.reduce(
    (result, check) => {
      result[check.ok ? "passed" : "failed"] += 1;
      return result;
    },
    { passed: 0, failed: 0 },
);

console.log(`\nPreflight: ${summary.passed} passed, ${summary.failed} failed.`);
if (summary.failed > 0) {
  process.exitCode = 1;
}

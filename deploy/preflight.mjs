// Non-destructive production readiness checks for Laawol deploys.
// This script prints only secret shape/availability, never secret values.

import { execFileSync, spawnSync } from "node:child_process";
import { resolve4, resolve6 } from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PRODUCTION_PROJECT,
  HOSTINGER_PRODUCTION_IPV4,
  PRODUCTION_STATIC_HOSTS,
  assessStaticDnsHost,
  appCheckWebConfig,
  deploymentJavaEnvironment,
  deploymentMode,
  firebaseDryRunConfig,
  javaMajorVersion,
  paymentModeEvidence,
  stripeKeyMode,
} from "./preflight-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT_ID = process.env.FIREBASE_PROJECT || "car-selling-flutter-app";
const PRODUCTION_PROJECT_ID = process.env.PRODUCTION_FIREBASE_PROJECT ||
  DEFAULT_PRODUCTION_PROJECT;
const SCOPE = process.env.PREFLIGHT_SCOPE || "full";
const VALID_SCOPES = new Set(["backend", "full", "static"]);
const STATIC_TRANSPORT = process.env.STATIC_TRANSPORT || "ftp";
const commandEnvironment = deploymentJavaEnvironment({
  environment: process.env,
  candidateHomes: [
    "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
    "/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  ],
});

if (!VALID_SCOPES.has(SCOPE)) {
  console.error("PREFLIGHT_SCOPE must be 'static', 'backend', or 'full'.");
  process.exit(1);
}

const checks = [];
const checksStatic = SCOPE === "static" || SCOPE === "full";
const checksBackend = SCOPE === "backend" || SCOPE === "full";
const resolvedDeploymentMode = deploymentMode({
  projectId: PROJECT_ID,
  productionProjectId: PRODUCTION_PROJECT_ID,
  deployEnvironment: process.env.DEPLOY_ENV,
});

function addCheck(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  const icon = ok ? "OK" : "FAIL";
  console.log(`${icon} ${name}${detail ? ` - ${detail}` : ""}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    env: commandEnvironment,
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
      env: commandEnvironment,
      stdio: "inherit",
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveDns(resolver, hostname) {
  try {
    return {status: "ok", addresses: await resolver(hostname)};
  } catch (error) {
    const errorCode = String(error?.code || "UNKNOWN");
    return {
      status: ["ENODATA", "ENOTFOUND"].includes(errorCode) ? "absent" : "error",
      addresses: [],
      errorCode,
    };
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

// Production releases must correspond to a successful CI run for the exact
// commit being deployed. The GitHub CLI is used so private repositories work
// with the operator's existing authenticated session.
if (resolvedDeploymentMode.mode === "production") {
  const head = run("git", ["rev-parse", "HEAD"]);
  const commit = head.stdout.trim();
  const ci = commit ? run("gh", [
    "run", "list",
    "--workflow", "CI",
    "--commit", commit,
    "--json", "conclusion,status,headSha,url",
    "--limit", "10",
  ]) : {ok: false, stdout: ""};
  let greenRun;
  try {
    const runs = JSON.parse(ci.stdout || "[]");
    greenRun = runs.find((item) =>
      item.headSha === commit && item.status === "completed" &&
      item.conclusion === "success");
  } catch {
    greenRun = null;
  }
  const overridden = process.env.ALLOW_UNVERIFIED_CI === "1";
  addCheck(
      "Green CI for deployed commit",
      Boolean(greenRun) || overridden,
      greenRun ? greenRun.url :
        overridden ? "OVERRIDDEN via ALLOW_UNVERIFIED_CI=1" :
          "install/authenticate gh and push the commit until required CI is green",
  );
}

if (checksStatic) {
  for (const hostname of PRODUCTION_STATIC_HOSTS) {
    const [ipv4Result, ipv6Result] = await Promise.all([
      resolveDns(resolve4, hostname),
      resolveDns(resolve6, hostname),
    ]);
    const dns = assessStaticDnsHost({
      hostname,
      expectedIPv4: HOSTINGER_PRODUCTION_IPV4,
      ipv4Result,
      ipv6Result,
    });
    addCheck(`Static DNS for ${hostname}`, dns.ok, dns.detail);
  }

  const appCheck = appCheckWebConfig({
    siteKey: process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY,
    debugToken: process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN,
    production: resolvedDeploymentMode.mode === "production",
  });
  addCheck("Admin/business App Check configuration", appCheck.ok, appCheck.detail);

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
  const adminBuildOk = adminTestsOk && appCheck.ok &&
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
  const functionsDir = path.join(ROOT, "my_flutter_app", "functions");
  const mode = resolvedDeploymentMode;
  const javaRuntime = run("java", ["-version"]);
  const javaOutput = `${javaRuntime.stdout}\n${javaRuntime.stderr}`;
  const javaMajor = javaMajorVersion(javaOutput);
  addCheck(
      "Java runtime is compatible with Firebase",
      javaRuntime.ok && javaMajor !== null && javaMajor >= 21,
      javaMajor === null ? "install Java 21 or set DEPLOY_JAVA_HOME" :
        `Java ${javaMajor}${javaMajor >= 21 ? "" : " is too old; install Java 21"}`,
  );
  addCheck("Deployment environment is explicit and safe", mode.ok, mode.detail);

  const paymentEvidence = paymentModeEvidence({
    functionsDir,
    processValue: process.env.SIMULATE_PAYMENTS,
  });
  addCheck(
      "Production payment simulation is disabled",
      mode.mode !== "production" || !paymentEvidence.simulationEnabled,
      paymentEvidence.simulationEnabled ?
        `enabled by ${paymentEvidence.enabledSources.join(", ")}` :
        "SIMULATE_PAYMENTS is not enabled",
  );

  const functionsLintOk = runInherit("npm", ["run", "lint"], {
    cwd: functionsDir,
  });
  addCheck("Cloud Functions lint", functionsLintOk);

  const functionsTestsOk = functionsLintOk && runInherit("npm", ["test"], {
    cwd: functionsDir,
  });
  addCheck("Cloud Functions unit/emulator/rules tests", functionsTestsOk);

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
  const secretMode = stripeKeyMode(secretPayload);
  const stripeKeyOk = mode.mode === "production" ?
    secretMode === "live" :
    paymentEvidence.simulationEnabled || secretMode !== "invalid";
  addCheck(
      "Stripe key matches deployment mode",
      mode.ok && stripeKeyOk &&
        (stripeSecret.ok || (mode.mode !== "production" &&
          paymentEvidence.simulationEnabled)),
      mode.mode === "production" ?
        (secretMode === "live" ? "live Stripe key is configured" :
          "production requires STRIPE_SECRET_KEY to start with sk_live_") :
        paymentEvidence.simulationEnabled ?
          "non-production payment simulation; Stripe secret is optional" :
          `${secretMode} Stripe key`,
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
    const appDir = path.join(ROOT, "my_flutter_app");
    const sourceConfig = JSON.parse(fs.readFileSync(
        path.join(appDir, "firebase.json"),
        "utf8",
    ));
    const dryRunConfigPath = path.join(
        appDir,
        `.firebase-preflight-${process.pid}.json`,
    );
    let functionsDryRun;
    try {
      // Lint and the complete emulator/rules suite passed immediately above.
      // Remove only the duplicate predeploy hooks so the dry run focuses on
      // function discovery, production API access, and secret resolution.
      fs.writeFileSync(
          dryRunConfigPath,
          `${JSON.stringify(firebaseDryRunConfig(sourceConfig), null, 2)}\n`,
      );
      functionsDryRun = run("firebase", [
        "deploy",
        "--only",
        "functions",
        "--project",
        PROJECT_ID,
        "--config",
        dryRunConfigPath,
        "--dry-run",
      ], {cwd: appDir});
    } finally {
      fs.rmSync(dryRunConfigPath, {force: true});
    }
    const functionsOutput = `${functionsDryRun.stdout}\n${functionsDryRun.stderr}`;
    const computeApiDisabled = [
      /Compute Engine API has not been used/i,
      /Compute Engine API.*(?:disabled|inaccessible)/i,
      /compute\.googleapis\.com.*(?:disabled|has not been used|permission denied)/i,
    ].some((pattern) => pattern.test(functionsOutput));
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
